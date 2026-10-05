import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteSession } from '../providers.js';
import { validateSuite, hashSuite } from '../schema.js';
import { selectTargets, suiteTargets, remoteUrlCheck } from '../targets.js';
import { demoSuite } from '../fixtures.js';
import { groups, compareRuns, runPassed, loadRun } from '../compare.js';
import { renderReport, junit } from '../report.js';
import { execute } from '../process.js';
import { runSuite } from '../runner.js';
import type { Run, Target, TargetSuite } from '../types.js';

const bb: Target = { id: 'bb', provider: 'browserbase', engine: 'chrome', region: 'us-west-2' };
const bl: Target = { id: 'bl', provider: 'browserless', engine: 'chrome', region: 'sfo' };
const reply = (data: object, status = 200) => new Response(JSON.stringify(data), { status });
const requestMock = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => (async (url: any, init: any) => fn(String(url), init)) as typeof fetch;
function multiRun(): Run {
  return { version: 2, id: 'run', suiteName: 'Provider test', suiteHash: 'same', createdAt: '2026-10-04', configurations: [bb, bl].map(t => ({ ...t, version: 'Chrome/154' })), host: { platform: 'linux', arch: 'x64', cpus: 2, memoryBytes: 100, release: '1', node: '24' }, repetitions: 1, testCases: [{ id: 'heading', expectedStatus: 'pass' }], adapterVersion: '0.38.2', interrupted: false, trials: [bb, bl].map(t => ({ id: t.id, targetId: t.id, testId: 'heading', testName: 'Read heading', engine: 'chrome', repetition: 0, attempt: 0, status: 'pass', expectedStatus: 'pass', matchedExpectation: true, startedAt: '2026-10-04', startupMs: 10, workflowMs: 20, durationMs: 30, peakRssKb: null, cpuMs: null, measurementMethod: 'Remote resources unavailable', output: { heading: 'Catalog' }, artifacts: [], steps: [], assertions: [{ path: '/heading', op: 'equals', passed: true, message: 'Requirement met' }] })) };
}
test('v2 targets retain separate identities; v1 task hashes stay compatible', () => {
  const legacy = demoSuite('https://fixture.example/');
  const { engines, version, ...common } = legacy;
  const current = validateSuite({ ...common, version: 2, targets: [bb, bl] });
  assert.equal(hashSuite(current), hashSuite(legacy));
  assert.deepEqual(suiteTargets(current), [bb, bl]);
  suiteTargets(current).reverse();
  assert.deepEqual(suiteTargets(current), [bb, bl], "execution order must not mutate the suite");
  assert.deepEqual(selectTargets('chrome,browserbase,browserless').map(t => t.provider), ['local', 'browserbase', 'browserless']);
  for (const targets of [[bb, bb], [{ ...bb, engine: 'lightpanda' }], [{ ...bl, region: 'wrong' }], [{ ...bb, apiKey: 'never-in-suite' }]]) assert.throws(() => validateSuite({ ...common, version: 2, targets }));
});
test('reports, JUnit, coverage and baselines distinguish providers using Chrome', () => {
  const run = multiRun(); assert.equal(groups(run).size, 2); assert.equal(runPassed(run), true);
  const html = renderReport(run); assert.match(html, /value="bb"/); assert.match(html, /value="bl"/);
  assert.match(junit(run), /classname="bb"/); assert.match(junit(run), /classname="bl"/);
  const missing = structuredClone(run); missing.trials.pop(); assert.equal(runPassed(missing), false);
  assert.ok(compareRuns(missing, run).findings.some(f => f.targetId === 'bl' && f.message.includes('missing')));
  const changed = structuredClone(run); changed.configurations[0]!.region = 'eu-central-1';
  assert.equal(compareRuns(changed, run).compatible, false);
});
test('saved results reject engine substitution and preserve startup failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browserlab-load-'));
  try {
    const file = join(dir, 'results.json'), run = multiRun();
    run.trials[0]!.status = 'error'; run.trials[0]!.expectedStatus = 'error'; run.testCases[0]!.expectedStatus = 'error'; run.trials[1]!.expectedStatus = 'error';
    run.trials[0]!.failurePhase = 'setup';
    await writeFile(file, JSON.stringify(run));
    assert.equal((await loadRun(file)).trials[0]!.matchedExpectation, false);
    run.trials[0]!.engine = 'lightpanda'; await writeFile(file, JSON.stringify(run));
    await assert.rejects(loadRun(file), /target manifest/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('cloud suites reject loopback and credential-bearing pages before execution', () => {
  const base = demoSuite('https://fixture.example/');
  const suite: TargetSuite = { version: 2, name: base.name, targets: [bb], repetitions: 1, timeoutMs: 30000, tests: [base.tests[0]!] };
  assert.doesNotThrow(() => remoteUrlCheck(suite));
  for (const url of ['http://127.0.0.1:8000', 'https://localhost/', 'https://127.1/', 'https://user:pass@example.com/']) {
    suite.tests[0]!.steps[0] = { action: 'open', url }; assert.throws(() => remoteUrlCheck(suite));
  }
});
test('Browserbase configures bounded sessions and verifies terminal release status', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const session = new RemoteSession(bb, requestMock((url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return reply({ id: 'session-1', connectUrl: 'wss://connect.browserbase.com?apiKey=private' });
    return reply({ status: calls.length === 2 ? 'RUNNING' : 'COMPLETED' });
  }));
  await session.create(30000); await session.stop(); await session.stop();
  assert.equal(calls.length, 3);
  const body = JSON.parse(String(calls[0]!.init.body)); assert.equal(body.timeout, 60); assert.equal(body.proxies, false); assert.equal(body.keepAlive, false);
  assert.equal(JSON.parse(String(calls[1]!.init.body)).status, 'REQUEST_RELEASE');
  assert.equal(calls[2]!.url, 'https://api.browserbase.com/v1/sessions/session-1');
  assert.ok(session.secrets.includes('private'));
});
test('Browserless uses selected region and reports failed stop requests', async () => {
  let requests = 0;
  const session = new RemoteSession({ ...bl, region: 'lon' }, requestMock((url, init) => {
    requests++;
    if (requests === 1) {
      assert.equal(new URL(url).hostname, 'production-lon.browserless.io');
      assert.deepEqual(JSON.parse(String(init.body)), { ttl: 90000, stealth: false, browser: 'chrome' });
      return reply({ connect: 'wss://production-lon.browserless.io/cdp?token=private', stop: 'https://production-lon.browserless.io/session/one?token=private' });
    }
    assert.equal(init.method, 'DELETE'); return reply({ error: 'must-not-leak' }, 503);
  }));
  await session.create(60000); await assert.rejects(session.stop(), /HTTP 503/);
});
test('creation rejection is safe to close; unknown creation and malformed responses are not claimed stopped', async () => {
  const denied = new RemoteSession(bb, requestMock(() => reply({ secret: 'hidden' }, 401)));
  await assert.rejects(denied.create(1000), /HTTP 401/); await denied.stop();
  const unknown = new RemoteSession(bb, requestMock(() => { throw new Error('https://secret.invalid/?token=private'); }));
  await assert.rejects(unknown.create(1000), /API request failed/); await assert.rejects(unknown.stop(), /not confirmed/);
  let calls = 0;
  const malformed = new RemoteSession(bb, requestMock(() => ++calls === 1 ? reply({ id: 'known', connectUrl: 'wss://evil.example/' }) : reply({ status: 'COMPLETED' })));
  await assert.rejects(malformed.create(1000), /Unexpected provider/); await malformed.stop(); assert.equal(calls, 2);
});
test('local environment files load credentials without echoing their contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browserlab-env-'));
  try {
    const file = join(dir, '.env'); await writeFile(file, 'BROWSERBASE_API_KEY=private-test-key\n', { mode: 0o600 });
    const output = await execute(process.execPath, ['dist/cli.js', '--env-file', file, '--help']);
    assert.match(output, /--targets/); assert.ok(!output.includes('private-test-key'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('runner uses private CDP config and cleans remote session after a page failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browserlab-provider-run-'));
  const oldFetch = globalThis.fetch, oldBinary = process.env.BROWSERLAB_AGENT_BROWSER, oldKey = process.env.BROWSERBASE_API_KEY;
  let stopped = 0;
  const fake = join(dir, 'adapter.js');
  try {
    await writeFile(fake, `const fs=require('node:fs'); const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('agent-browser test-double'); process.exit(0); }
const config=args[args.indexOf('--config')+1]; const json=JSON.parse(fs.readFileSync(config));
fs.writeFileSync(${JSON.stringify(join(dir, 'observed.json'))},JSON.stringify({config,mode:fs.statSync(config).mode&511,args,envKey:process.env.BROWSERBASE_API_KEY,cdp:json.cdp}));
if(args.includes('session')) console.log(JSON.stringify({success:true,data:{}}));
else if(args.includes('get')) console.log(JSON.stringify({success:true,data:{}}));
else if(args.includes('eval')) console.log(JSON.stringify({success:true,data:{result:'test-browser'}}));
else if(args.includes('open')&&!args.includes('about:blank')) console.log(JSON.stringify({success:false,error:'Page error: private-session-token'}));
else console.log(JSON.stringify({success:true,data:{}}));`);
    process.env.BROWSERLAB_AGENT_BROWSER = fake; process.env.BROWSERBASE_API_KEY = 'private-api-key';
    globalThis.fetch = requestMock((url, init) => {
      if (url.endsWith('/sessions')) return reply({ id: 'known-session', connectUrl: 'wss://connect.browserbase.com/?apiKey=private-session-token' });
      stopped++; return reply({ status: 'COMPLETED' });
    });
    const base = demoSuite('https://fixture.example/');
    const suite: TargetSuite = { version: 2, name: 'Mock provider contract', targets: [bb], repetitions: 1, timeoutMs: 10000, tests: [base.tests[0]!] };
    const run = await runSuite(suite, { out: join(dir, 'run') });
    assert.equal(stopped, 1); assert.equal(run.trials[0]!.status, 'error');
    assert.equal(run.trials[0]!.cleanupMethod, 'provider-confirmed');
    assert.equal(run.trials[0]!.peakRssKb, null); assert.equal(run.trials[0]!.cpuMs, null);
    assert.ok(!JSON.stringify(run).includes('private-session-token'));
    const observed = JSON.parse(await readFile(join(dir, 'observed.json'), 'utf8'));
    assert.equal(observed.mode, 0o600); assert.equal(observed.envKey, undefined);
    assert.ok(!JSON.stringify(observed.args).includes('private-session-token'));
    await assert.rejects(readFile(observed.config));
    assert.equal((await loadRun(join(dir, 'run/results.json'))).trials[0]!.matchedExpectation, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBinary === undefined) delete process.env.BROWSERLAB_AGENT_BROWSER; else process.env.BROWSERLAB_AGENT_BROWSER = oldBinary;
    if (oldKey === undefined) delete process.env.BROWSERBASE_API_KEY; else process.env.BROWSERBASE_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});
