import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentBrowser } from '../adapter.js';
import { acceptProviders } from '../acceptance.js';
import { selectTargets } from '../targets.js';
import { hostedDemoSuite } from '../fixtures.js';
import { ProcessFailure } from '../process.js';

test('acceptance saves independent workflow/cancellation reports and refuses reused output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browserlab-accept-mock-'));
  const methods = { start: AgentBrowser.prototype.start, version: AgentBrowser.prototype.version, step: AgentBrowser.prototype.step, close: AgentBrowser.prototype.close };
  const oldKey = process.env.BROWSERBASE_API_KEY;
  let closes = 0, waits = 0, failCleanup = false;
  const base = hostedDemoSuite('https://fixture.example/');
  const names = base.tests.find(t => t.id === 'names')!.assertions[0]!.value;
  try {
    process.env.BROWSERBASE_API_KEY = 'acceptance-test-only-key';
    AgentBrowser.prototype.start = async () => undefined;
    AgentBrowser.prototype.version = async () => 'Chrome/mock-acceptance';
    AgentBrowser.prototype.step = async (step, _timeout, signal) => {
      if (step.action === 'extract') {
        if (step.selector === '[') throw new ProcessFailure('Invalid selector');
        return step.kind === 'texts' ? names : 'Field equipment';
      }
      if (step.action === 'wait') {
        if (++waits % 2 === 1) throw new ProcessFailure('Mock workflow timeout', 'timeout');
        await new Promise<void>((_resolve, reject) => {
          const cancel = () => reject(new ProcessFailure('Execution cancelled', 'cancelled'));
          if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
        });
      }
    };
    AgentBrowser.prototype.close = async () => { closes++; if (failCleanup) throw new Error('Mock stop failure'); return 'provider-confirmed'; };
    const out = join(dir, 'pass');
    assert.equal(await acceptProviders(selectTargets('browserbase'), 'https://fixture.example/', out), true);
    assert.equal(closes, 6);
    const summary = JSON.parse(await readFile(join(out, 'acceptance.json'), 'utf8'));
    assert.equal(summary.complete, true); assert.equal(summary.passed, true);
    const cancellation = JSON.parse(await readFile(join(out, 'browserbase/cancellation/results.json'), 'utf8'));
    assert.equal(cancellation.trials[0].status, 'cancelled'); assert.equal(cancellation.trials[0].failurePhase, 'workflow');
    assert.ok(!(await readFile(join(out, 'browserbase/workflows/report.html'), 'utf8')).includes(process.env.BROWSERBASE_API_KEY));
    await assert.rejects(acceptProviders(selectTargets('browserbase'), 'https://fixture.example/', out), /already exists/);
    failCleanup = true;
    assert.equal(await acceptProviders(selectTargets('browserbase'), 'https://fixture.example/', join(dir, 'fail')), false);
    assert.equal(JSON.parse(await readFile(join(dir, 'fail/acceptance.json'), 'utf8')).results[0].checks.cancellationCleanup, false);
    const aborted = join(dir, 'cancelled');
    assert.equal(await acceptProviders(selectTargets('browserbase'), 'https://fixture.example/', aborted, AbortSignal.abort()), false);
    assert.equal(JSON.parse(await readFile(join(aborted, 'acceptance.json'), 'utf8')).complete, false);
  } finally {
    Object.assign(AgentBrowser.prototype, methods);
    if (oldKey === undefined) delete process.env.BROWSERBASE_API_KEY; else process.env.BROWSERBASE_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});
