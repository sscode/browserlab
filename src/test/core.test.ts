import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../assertions.js';
import { validateSuite, hashSuite, pointer } from '../schema.js';
import { demoSuite } from '../fixtures.js';
import { compareRuns, defaultCompare, median, percentile, runPassed } from '../compare.js';
import { descendants, parseProcessRows, execute, ProcessFailure } from '../process.js';
import { renderReport, junit } from '../report.js';
import { redact } from '../runner.js';
import type { Run, Trial } from '../types.js';

export function sampleRun(): Run {
  const trial: Trial = { id: 'trial', testId: 'catalog', testName: 'Catalog', engine: 'chrome', repetition: 0, attempt: 0, expectedStatus: 'pass', status: 'pass', matchedExpectation: true, startedAt: '2026-01-01', durationMs: 200, startupMs: 100, workflowMs: 100, peakRssKb: null, cpuMs: null, measurementMethod: 'Unavailable', steps: [], assertions: [], output: { items: ['one'] }, artifacts: [] };
  return { version: 1, id: 'run', suiteName: 'Test', suiteHash: 'same', createdAt: '2026-01-01', configurations: [{ engine: 'chrome', version: '1' }], host: { platform: 'linux', arch: 'x64', release: '1', cpus: 2, memoryBytes: 100, node: '24' }, adapterVersion: '1', repetitions: 5, testCases: [{ id: 'catalog', expectedStatus: 'pass' }], interrupted: false, trials: Array.from({ length: 5 }, (_, repetition) => ({ ...structuredClone(trial), id: String(repetition), repetition })) };
}

test('the controlled suite contains 20 validated cases with explicit negative expectations', () => {
  const suite = validateSuite(demoSuite('http://127.0.0.1:3000'));
  assert.equal(suite.tests.length, 20);
  assert.equal(suite.tests.filter(t => t.expectedStatus).length, 6);
});
test('schema rejects silent typos, duplicate IDs, temporary refs and missing correctness checks', () => {
  const mutate = (f: (s: any) => void) => { const suite = demoSuite('http://localhost'); f(suite); assert.throws(() => validateSuite(suite)); };
  mutate(s => s.repetitons = 2);
  mutate(s => s.tests[1].id = s.tests[0].id);
  mutate(s => s.tests[0].steps[1].selector = '@e3');
  mutate(s => s.tests[0].assertions = []);
  mutate(s => s.tests[0].steps[0].url = 'file:///etc/passwd');
  mutate(s => s.tests[0].steps[1].as = '__proto__');
  mutate(s => s.tests[0].assertions[0].op = 'eqauls');
  mutate(s => s.repetitions = 1.5);
});
test('hash excludes engine order and repetitions, but includes assertions and time limits', () => {
  const a = demoSuite('http://localhost'), b = structuredClone(a);
  b.engines.reverse(); b.repetitions = 9;
  assert.equal(hashSuite(a), hashSuite(b));
  b.tests[0]!.assertions[0]!.value = 'new';
  assert.notEqual(hashSuite(a), hashSuite(b));
});
test('JSON Pointer handles escaped keys and never reads prototype properties', () => {
  assert.equal(pointer({ 'a/b': { '~': 42 } }, '/a~1b/~0'), 42);
  assert.equal(pointer({}, '/constructor'), undefined);
});
test('empty extraction cannot satisfy every or unique', () => {
  assert.equal(evaluate({ rows: [] }, [{ path: '/rows', op: 'every', rule: { op: 'required' } }])[0]!.passed, false);
  assert.equal(evaluate({ rows: [] }, [{ path: '/rows', op: 'unique' }])[0]!.passed, false);
});
test('assertions detect missing fields, wrong types, duplicates and numeric bounds', () => {
  const output = { rows: [{ id: 'a', price: '10' }, { id: 'a', price: null }], count: 2 };
  const results = evaluate(output, [
    { path: '/rows', op: 'count', value: 2 },
    { path: '/rows', op: 'unique', field: '/id' },
    { path: '/rows', op: 'every', field: '/price', rule: { op: 'required' } },
    { path: '/rows/0/price', op: 'type', value: 'number' },
    { path: '/count', op: 'min', value: 1 },
    { path: '/count', op: 'max', value: 3 },
    { path: '/missing', op: 'required' },
  ]);
  assert.deepEqual(results.map(r => r.passed), [true, false, false, false, true, true, false]);
});
test('deep equality handles record field order and rejects missing output', () => {
  assert.equal(evaluate({ row: { a: 1, b: 2 } }, [{ path: '/row', op: 'equals', value: { b: 2, a: 1 } }])[0]!.passed, true);
  assert.equal(evaluate({}, [{ path: '/x', op: 'equals', value: null }])[0]!.passed, false);
});
test('baselines catch correctness regressions and missing configurations', () => {
  const base = sampleRun(), now = sampleRun();
  now.trials[0]!.matchedExpectation = false; now.trials[0]!.status = 'fail';
  assert.ok(compareRuns(now, base).findings.some(f => f.severity === 'regression' && f.message.includes('outcome')));
  now.trials = [];
  assert.ok(compareRuns(now, base).findings.some(f => f.message.includes('missing')));
});
test('performance gates require repeated samples, equivalent hosts and absolute plus relative limits', () => {
  const base = sampleRun(), now = sampleRun();
  now.trials.forEach(t => t.workflowMs = 250);
  assert.ok(compareRuns(now, base).findings.some(f => f.message.includes('Median')));
  now.trials = now.trials.slice(0, 2);
  assert.ok(!compareRuns(now, base).findings.some(f => f.message.includes('Median')));
  now.trials = sampleRun().trials; now.trials.forEach(t => t.workflowMs = 250); now.host.cpus = 8;
  assert.ok(!compareRuns(now, base).findings.some(f => f.message.includes('Median')));
  now.host = base.host; now.trials.forEach(t => t.workflowMs = 150);
  assert.ok(!compareRuns(now, base).findings.some(f => f.message.includes('Median')));
});
test('a retry cannot hide a first-attempt regression or a failed release', () => {
  const base = sampleRun(), now = sampleRun();
  now.trials[0]!.status = 'error'; now.trials[0]!.matchedExpectation = false;
  now.trials.push({ ...structuredClone(base.trials[0]!), attempt: 1 });
  assert.equal(runPassed(now), false);
  assert.ok(compareRuns(now, base).findings.some(f => f.severity === 'regression'));
});
test('changed contracts block a direct comparison', () => {
  const base = sampleRun(), now = sampleRun(); now.suiteHash = 'changed';
  assert.equal(compareRuns(now, base).compatible, false);
});
test('partial runs fail and expected negative cases do not create impossible performance warnings', () => {
  const partial = sampleRun(); partial.trials.pop();
  assert.equal(runPassed(partial), false);
  assert.match(junit(partial), /Execution is interrupted or incomplete/);
  const negative = sampleRun(); negative.testCases[0]!.expectedStatus = 'fail';
  negative.trials.forEach(t => { t.status = 'fail'; t.expectedStatus = 'fail'; });
  assert.deepEqual(compareRuns(negative, negative).findings, []);
});
test('JUnit includes performance regressions even when assertions pass', () => {
  const base = sampleRun(), now = sampleRun(); now.trials.forEach(t => t.workflowMs = 500);
  const xml = junit(now, compareRuns(now, base));
  assert.match(xml, /classname="baseline"/); assert.match(xml, /failures="1"/);
});
test('percentiles and medians include even and empty samples', () => {
  assert.equal(median([]), null); assert.equal(median([4, 1, 3, 2]), 2.5); assert.equal(percentile([1, 2, 3, 4], .95), 4);
});
test('process sampling includes only the owned tree and parses CPU time', () => {
  const rows = parseProcessRows('10 1 100 00:01.20\n11 10 200 01:00.00\n12 11 300 00:00.01\n13 1 999 00:00.00');
  assert.deepEqual(descendants(rows, 10).map(r => r.pid), [10, 11, 12]);
  assert.equal(rows[0]!.cpuMs, 1200); assert.equal(rows[1]!.cpuMs, 60000);
});
test('command timeout and cancellation terminate the child', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 70 }), e => e instanceof ProcessFailure && e.kind === 'timeout');
  const abort = new AbortController();
  const promise = execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal });
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(promise, e => e instanceof ProcessFailure && e.kind === 'cancelled');
});
test('arguments are passed without shell interpretation', async () => {
  const value = '$(echo unexpected); `echo bad`';
  assert.equal(await execute(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]), value);
});
test('secret values are removed from nested output and error text', () => {
  assert.deepEqual(redact({ output: ['x top-secret y'], error: 'top-secret' }, ['top-secret']), { output: ['x [REDACTED] y'], error: '[REDACTED]' });
});
test('HTML and XML escape untrusted website content', () => {
  const run = sampleRun(); run.trials[0]!.output = { attack: '</script><script>alert(1)</script>' }; run.trials[0]!.testName = '<img src=x onerror=alert(1)>';
  const html = renderReport(run);
  assert.ok(!html.includes('<script>alert(1)')); assert.ok(html.includes('&lt;script&gt;'));
  run.trials[0]!.status = 'error'; run.trials[0]!.matchedExpectation = false; run.trials[0]!.error = '<bad>&"';
  assert.ok(junit(run).includes('&lt;bad&gt;&amp;&quot;'));
});
test('expected negative tests stay explicit in HTML and JUnit', () => {
  const run = sampleRun(); run.trials[0]!.status = 'fail'; run.trials[0]!.expectedStatus = 'fail';
  assert.ok(renderReport(run).includes('negative test'));
  assert.ok(junit(run).includes('failures="0"'));
});
