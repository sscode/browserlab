import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { RemoteSession } from '../providers.js';
import { CdpBridge } from '../cdp-bridge.js';
import { selectTargets, validateTargets, requireCredentials, credentialValues, targetSettings } from '../targets.js';
import { providerSettings, credentials } from '../provider-config.js';
import { cleanEnvironment } from '../adapter.js';
import { hostedDemoSuite } from '../fixtures.js';
import { acceptanceChecks } from '../acceptance.js';
import { redact } from '../runner.js';
import type { Run } from '../types.js';
const reply = (data: object, status = 200) => new Response(JSON.stringify(data), { status });
const mock = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => (async (url: any, init: any) => fn(String(url), init)) as typeof fetch;

test('all five targets validate; unknown regions and credential-in-suite fields fail', () => {
  const targets = selectTargets('steel,browser-use,brightdata,hyperbrowser,anchor');
  assert.equal(targets.length, 5);
  assert.deepEqual(targets.map(t => t.region), ['us-east', undefined, undefined, 'us', undefined]);
  for (const id of ['browser-use', 'brightdata', 'anchor']) assert.throws(() => validateTargets([{ id, provider: id, engine: 'chrome', region: 'us' }]));
  assert.throws(() => validateTargets([{ id: 's', provider: 'steel', engine: 'chrome', region: 'us-west' }]));
  assert.throws(() => validateTargets([{ id: 's', provider: 'steel', engine: 'chrome', apiKey: 'secret' }]));
  const steel = providerSettings(targets[0]!); assert.equal(steel.proxy, false); assert.equal(steel.stealth, 'provider-managed');
  const bright = providerSettings(targets[2]!); assert.equal(bright.proxy, 'provider-managed'); assert.equal(bright.sessionTimeout, 'client-only');
  assert.notDeepEqual(targetSettings({ ...targets[0]!, ...steel, version: null }), targetSettings({ ...targets[0]!, proxy: false, stealth: false, version: null }));
});
test('each provider requires only its own credentials and keeps all keys out of the adapter environment', () => {
  const names = [...new Set(Object.values(credentials).flat())];
  const saved = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    assert.doesNotThrow(() => requireCredentials(selectTargets('chrome')));
    for (const target of selectTargets('steel,browser-use,brightdata,hyperbrowser,anchor')) {
      for (const name of credentials[target.provider]) {
        assert.throws(() => requireCredentials([target]), new RegExp(name));
        process.env[name] = `${name}-private`;
      }
      assert.doesNotThrow(() => requireCredentials([target]));
    }
    const env = cleanEnvironment(); for (const name of names) assert.equal(env[name], undefined);
    const masked = redact(names.map(name => process.env[name] ?? ''), credentialValues());
    assert.ok(masked.every(v => !v.includes('-private')));
  } finally { names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; }); }
});
for (const provider of ['steel', 'browser-use', 'hyperbrowser', 'anchor']) {
  test(`${provider}: create, connect, inspect, stop use the documented API contract`, async () => {
    const target = selectTargets(provider)[0]!;
    const calls: { url: string; init: RequestInit }[] = [];
    const session = new RemoteSession(target, mock((url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        const body = JSON.parse(String(init.body));
        if (provider === 'steel') { assert.equal(body.timeout, 90000); assert.equal(body.region, 'us-east'); assert.equal(body.useProxy, false); }
        if (provider === 'browser-use') { assert.equal(body.timeout, 2); assert.equal(body.proxyCountryCode, null); assert.equal(body.solveCaptchas, false); }
        if (provider === 'hyperbrowser') { assert.equal(body.timeoutMinutes, 2); assert.equal(body.useUltraStealth, false); }
        if (provider === 'anchor') { assert.equal(body.session.timeout.max_duration, 2); assert.equal(body.session.recording.active, false); }
        return reply(provider === 'anchor' ? { data: { id: 'one', cdp_url: 'wss://connect.anchorbrowser.io/one' } } : { id: 'one', cdpUrl: 'wss://cdp.browser-use.com/one', wsEndpoint: 'wss://connect.hyperbrowser.ai/one' });
      }
      if (calls.length === 2) return reply(provider === 'anchor' ? { data: { status: 'running' } } : { status: provider === 'steel' ? 'live' : 'active' });
      if (calls.length === 3) {
        if (provider === 'steel') { assert.ok(url.endsWith('/one/release')); assert.equal(init.method, 'POST'); return reply({ success: true }); }
        if (provider === 'browser-use') { assert.equal(init.method, 'PATCH'); assert.deepEqual(JSON.parse(String(init.body)), { action: 'stop' }); return reply({ status: 'stopped' }); }
        if (provider === 'hyperbrowser') { assert.ok(url.endsWith('/one/stop')); assert.equal(init.method, 'PUT'); return reply({ success: true }); }
        assert.equal(init.method, 'DELETE'); return reply({ data: { status: 'success' } });
      }
      return reply({ status: provider === 'steel' ? 'released' : 'closed' });
    }));
    await session.create(60000);
    assert.ok(session.connect().startsWith('wss://'));
    assert.equal((await session.inspect()).state, 'active');
    assert.equal(await session.stop(), 'provider-confirmed');
    const count = calls.length; assert.equal(await session.stop(), 'provider-confirmed'); assert.equal(calls.length, count);
    assert.equal((await session.inspect()).state, 'stopped');
    await assert.rejects(session.create(1000), /only be created once/);
  });
  test(`${provider}: failed stop is never claimed confirmed; malformed connection still permits cleanup`, async () => {
    let count = 0;
    const session = new RemoteSession(selectTargets(provider)[0]!, mock(() => {
      if (++count === 1) return reply(provider === 'anchor' ? { data: { id: 'one', cdp_url: 'wss://evil.example/' } } : { id: 'one', cdpUrl: 'wss://evil.example/', wsEndpoint: 'wss://evil.example/' });
      return reply({ secret: 'private' }, 503);
    }));
    if (provider === 'steel') await session.create(1000); else await assert.rejects(session.create(1000), /Unexpected provider/);
    await assert.rejects(session.stop(), /HTTP 503/); assert.equal(count, 2);
  });
}
test('provider responses reject success:false and oversized bodies without leaking response text', async () => {
  const bad = new RemoteSession(selectTargets('steel')[0]!, mock(() => reply({ success: false, message: 'private' })));
  await assert.rejects(bad.create(1000), e => e instanceof Error && !e.message.includes('private'));
  await assert.rejects(bad.stop(), /not confirmed/);
  const large = new RemoteSession(selectTargets('steel')[0]!, mock(() => reply({ padding: 'secret'.repeat(20000) })));
  await assert.rejects(large.create(1000), /too large/);
});
test('cancellation before creation does not start a session; cancellation during creation stays uncertain', async () => {
  let called = false;
  const untouched = new RemoteSession(selectTargets('steel')[0]!, mock(() => { called = true; return reply({}); }));
  await assert.rejects(untouched.create(1000, AbortSignal.abort()), /cancelled/);
  assert.equal(await untouched.stop(), 'not-created'); assert.equal(called, false);
  const abort = new AbortController();
  const pending = new RemoteSession(selectTargets('steel')[0]!, mock((_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new Error('secret')), { once: true }); abort.abort();
  })));
  await assert.rejects(pending.create(1000, abort.signal), /cancelled/);
  await assert.rejects(pending.stop(), /not confirmed/);
});
test('hosted fixtures use directory URLs and acceptance rejects cleanup or setup failures', () => {
  const suite = hostedDemoSuite('https://fixture.example/sub');
  assert.deepEqual(suite.tests[0]!.steps[0], { action: 'open', url: 'https://fixture.example/sub/' });
  assert.equal(suite.tests.find(t => t.id === 'attribute')!.assertions[0]!.value, './next/');
  assert.throws(() => hostedDemoSuite('https://u:p@fixture.example/'));
  const run = { trials: [], testCases: [], configurations: [], interrupted: false } as unknown as Run;
  const checks = acceptanceChecks(run, run); assert.equal(checks.workflows, false); assert.equal(checks.cleanup, false); assert.equal(checks.cancellation, false);
});

async function upstreamServer(ackClose = true) {
  const server = createServer(); const sockets = new WebSocketServer({ server });
  let connections = 0, auth: string | undefined;
  sockets.on('connection', (socket, request) => {
    connections++; auth = request.headers.authorization;
    socket.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.method === 'Browser.close' && !ackClose) { socket.close(); return; }
      socket.send(JSON.stringify({ id: m.id, result: m.method === 'Browser.getVersion' ? { product: 'Chrome/mock' } : { echoed: m.method } }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { url: `ws://127.0.0.1:${address.port}`, count: () => connections, auth: () => auth, close: async () => { for (const socket of sockets.clients) socket.terminate(); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test('Bright Data bridge isolates credentials, multiplexes CDP IDs and stops the same upstream session', async () => {
  const upstream = await upstreamServer(), bridge = new CdpBridge();
  try {
    await bridge.create(upstream.url, { Authorization: 'Basic private' }, 2000, 60000);
    assert.equal(upstream.auth(), 'Basic private'); assert.ok(!bridge.url!.includes('private'));
    for (const makeSocket of [() => new WebSocket(bridge.url! + '-wrong'), () => new WebSocket(bridge.url!, { origin: 'https://untrusted.example' })]) {
      await once(makeSocket(), 'error');
    }
    const browser = new WebSocket(bridge.url!); await once(browser, 'open');
    const response = once(browser, 'message'); browser.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
    const inspection = bridge.inspect();
    assert.equal(JSON.parse(String((await response)[0])).id, 1); assert.equal((await inspection).browserVersion, 'Chrome/mock');
    browser.close(); await once(browser, 'close');
    assert.equal((await bridge.inspect()).state, 'active');
    assert.equal(upstream.count(), 1);
    await bridge.stop(); assert.equal(bridge.closeConfirmed, true); await bridge.stop();
  } finally { await bridge.stop().catch(() => {}); await upstream.close(); }
});
test('Bright Data disconnect without Browser.close acknowledgement is not reported as successful cleanup', async () => {
  const upstream = await upstreamServer(false), bridge = new CdpBridge();
  try {
    await bridge.create(upstream.url, {}, 2000, 60000);
    await assert.rejects(bridge.stop(), /closed before confirmation/); assert.equal(bridge.closeConfirmed, false);
    await assert.rejects(bridge.stop(), /not confirmed/);
  } finally { await upstream.close(); }
});
test('Bright Data facade uses a single authenticated bridge and preserves stop evidence', async () => {
  const bridge = new CdpBridge(); let endpoint: string | undefined;
  bridge.create = async url => { endpoint = url; bridge.url = 'ws://127.0.0.1:1234/private-capability'; };
  bridge.inspect = async () => ({ state: 'active', browserVersion: 'Chrome/mock' });
  bridge.stop = async () => {};
  const session = new RemoteSession(selectTargets('brightdata')[0]!, mock(() => { throw new Error('Bright Data must not create via REST'); }), () => bridge);
  await session.create(60000); assert.equal(endpoint, 'wss://brd.superproxy.io:9222');
  assert.equal(session.connect(), bridge.url); assert.ok(session.secrets.includes(bridge.url!));
  assert.equal((await session.inspect()).browserVersion, 'Chrome/mock'); assert.equal(await session.stop(), 'cdp-confirmed');
});
