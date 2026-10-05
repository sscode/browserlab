import { CdpBridge } from '../cdp-bridge.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startFixtures, demoSuite } from '../fixtures.js';
import { loadRun } from '../compare.js';
import { AgentBrowser, createConfig } from '../adapter.js';
import type { Suite } from '../types.js';

// Deliberately separate from fast unit tests. These tests require real engines.
const root = resolve('.browserlab', `integration-${Date.now()}`);
await mkdir(root, { recursive: true });
const fixture = await startFixtures();
async function cli(args: string[], expected: number, cancelAfterMs?: number, extraEnv: NodeJS.ProcessEnv = {}) {
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const cancel = cancelAfterMs ? setTimeout(() => child.kill('SIGINT'), cancelAfterMs) : undefined;
    const limit = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Integration command exceeded 90 seconds')); }, 90000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(limit); if (cancel) clearTimeout(cancel); resolve({ code, output }); });
  });
  assert.equal(result.code, expected, `Unexpected CLI exit for ${args.join(' ')}\n${result.output}`);
  return result.output;
}
async function suiteFile(name: string, suite: Suite) {
  const file = join(root, `${name}.json`); await writeFile(file, JSON.stringify(suite)); return file;
}
try {
  const base = demoSuite(fixture.url, 1); base.tests = base.tests.slice(0, 1);
  const file = await suiteFile('workflow', base);
  const terminal = await cli(['run', file, '--out', join(root, 'before')], 0);
  assert.match(terminal, /Trials: 2\/2 first attempts/);
  assert.match(terminal, /Cleanup failures/);
  await assert.rejects(access(join(root, 'before/report.html')));
  assert.equal((await loadRun(join(root, 'before/results.json'))).adapterLaunch, 'native');
  await cli(['report', join(root, 'before/results.json')], 0);
  assert.match(await readFile(join(root, 'before/report.html'), 'utf8'), /BrowserLab/);
  await cli(['baseline', 'accept', join(root, 'before/results.json'), '--out', join(root, 'accepted')], 0);
  fixture.setRegression(true);
  const failure = await cli(['run', file, '--baseline', join(root, 'accepted/baseline.json'), '--out', join(root, 'broken')], 1);
  assert.match(failure, /REGRESSION/);
  assert.match(failure, /FAIL chrome/);
  const broken = await loadRun(join(root, 'broken/results.json'));
  assert.ok(broken.trials.every(t => t.status === 'fail' && !t.matchedExpectation));
  const junit = await readFile(join(root, 'broken/junit.xml'), 'utf8');
  assert.match(junit, /classname="baseline"/);
  await cli(['baseline', 'accept', join(root, 'broken/results.json'), '--out', join(root, 'rejected')], 2);
  fixture.setRegression(false);
  console.log('✓ Real page regression fails both engines, CI, JUnit, and baseline acceptance');

  const visual = demoSuite(fixture.url, 1); visual.engines = ['chrome']; visual.tests = visual.tests.slice(0, 1); visual.tests[0]!.steps.push({ action: 'screenshot', name: 'page.png' });
  const visualFile = await suiteFile('visual', visual);
  await cli(['run', visualFile, '--out', join(root, 'visual')], 0);
  const visualRun = await loadRun(join(root, 'visual/results.json'));
  const png = await readFile(join(root, 'visual', visualRun.trials[0]!.artifacts[0]!));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await cli(['run', visualFile, '--engines', 'lightpanda', '--out', join(root, 'unsupported')], 1);
  const unsupported = await loadRun(join(root, 'unsupported/results.json'));
  assert.equal(unsupported.trials[0]!.status, 'unsupported');
  assert.equal(unsupported.trials[0]!.startupMs, 0);
  console.log('✓ Chrome screenshot artifact and Lightpanda capability preflight');

  const secret = 'browserlab-integration-secret';
  const secrets = demoSuite(fixture.url, 1); secrets.tests = [secrets.tests.find(t => t.id === 'fill')!];
  secrets.tests[0]!.steps[1] = { action: 'fill', selector: '#query', env: 'BROWSERLAB_TEST_SECRET' };
  secrets.tests[0]!.assertions = [{ path: '/value', op: 'required' }];
  const secretFile = await suiteFile('secrets', secrets);
  await cli(['run', secretFile, '--html', '--out', join(root, 'secrets')], 0, undefined, { BROWSERLAB_TEST_SECRET: secret });
  for (const name of ['results.json', 'report.html', 'junit.xml']) assert.ok(!(await readFile(join(root, 'secrets', name), 'utf8')).includes(secret));
  console.log('✓ Environment-based fill works and secret values stay out of reports');

  const cancellation = demoSuite(fixture.url, 1); cancellation.engines = ['chrome']; cancellation.tests = [{ id: 'cancel', name: 'Cancel an active session', steps: [{ action: 'open', url: fixture.url }, { action: 'wait', selector: '#never' }], assertions: [{ path: '/not-produced', op: 'required' }], timeoutMs: 20000 }];
  const cancelFile = await suiteFile('cancel', cancellation);
  await cli(['run', cancelFile, '--out', join(root, 'cancelled')], 130, 1500);
  const cancelled = await loadRun(join(root, 'cancelled/results.json'));
  assert.equal(cancelled.interrupted, true);
  assert.equal(cancelled.trials[0]!.status, 'cancelled');
  assert.equal(cancelled.trials[0]!.cleanupError, undefined);
  assert.match(await readFile(join(root, 'cancelled/junit.xml'), 'utf8'), /Execution is interrupted or incomplete/);
  console.log('✓ SIGINT preserves partial results, fails CI, and closes the active session');
  const config = await createConfig(join(root, 'cdp'));
  const owner = new AgentBrowser('chrome', `owner-${Date.now()}`, config);
  let attached: AgentBrowser | undefined;
  try {
    await owner.start(15000);
    const endpoint = await owner.command(['get', 'cdp-url']);
    assert.equal(typeof endpoint.cdpUrl, 'string');
    const attachedConfig = join(root, 'cdp', 'attached.json');
    await writeFile(attachedConfig, JSON.stringify({ cdp: endpoint.cdpUrl }), { mode: 0o600 });
    attached = new AgentBrowser('chrome', `attached-${Date.now()}`, attachedConfig);
    await attached.start(15000);
    await attached.command(['open', fixture.url]);
    const heading = await attached.command(['eval', 'document.querySelector("h1").textContent']);
    assert.equal(heading.result, 'Field equipment');
    assert.equal((await attached.command(['get', 'cdp-url'])).cdpUrl, endpoint.cdpUrl);
    await attached.close(); attached = undefined;
    assert.equal((await owner.command(['eval', 'document.querySelector("h1").textContent'])).result, 'Field equipment');
    console.log('✓ Private CDP configuration connects to an existing browser and detaches cleanly');
  } finally { if (attached) await attached.close(); await owner.close(); }
  const bridgeOwner = new AgentBrowser('chrome', `bridge-owner-${Date.now()}`, config);
  const bridge = new CdpBridge();
  let bridgeClient: AgentBrowser | undefined;
  try {
    await bridgeOwner.start(15000);
    const endpoint = await bridgeOwner.command(['get', 'cdp-url']);
    await bridge.create(String(endpoint.cdpUrl), {}, 10000, 60000);
    const bridgeConfig = join(root, 'cdp', 'bridge.json');
    await writeFile(bridgeConfig, JSON.stringify({ cdp: bridge.url }), { mode: 0o600 });
    bridgeClient = new AgentBrowser('chrome', `bridge-client-${Date.now()}`, bridgeConfig);
    await bridgeClient.start(15000);
    await bridgeClient.command(['open', fixture.url]);
    assert.equal((await bridgeClient.command(['eval', 'document.querySelector("h1").textContent'])).result, 'Field equipment');
    assert.match((await bridge.inspect()).browserVersion!, /^Chrome\//);
    await bridgeClient.close(); bridgeClient = undefined;
    assert.equal((await bridge.inspect()).state, 'active');
    await bridge.stop(); assert.equal(bridge.closeConfirmed, true);
    console.log('✓ Private WebSocket bridge drives real Chrome, detaches, and confirms Browser.close');
  } finally { if (bridgeClient) await bridgeClient.close(); await bridge.stop().catch(() => {}); await bridgeOwner.close(); }
  console.log(`Integration evidence: ${root}`);
} finally { await fixture.close(); }
