import { mkdir, open, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { hostedDemoSuite } from './fixtures.js';
import { runSuite, atomicJson } from './runner.js';
import { runPassed } from './compare.js';
import { writeReports } from './report.js';
import { requireCredentials, remoteUrlCheck } from './targets.js';
import type { Run, Target, TargetSuite } from './types.js';

export function acceptanceChecks(workflows: Run, cancelled: Run) {
  const confirmed = (run: Run) => run.trials.length > 0 && run.trials.every(t => !t.cleanupError && ['provider-confirmed', 'cdp-confirmed'].includes(t.cleanupMethod ?? ''));
  return {
    workflows: runPassed(workflows),
    negativeCases: ['wrong-value', 'invalid-selector', 'timeout'].every(id => {
      const trial = workflows.trials.find(t => t.testId === id);
      if (!trial || trial.steps[0]?.action !== 'open' || trial.steps[0].error) return false;
      if (id === 'wrong-value') return trial.status === 'fail' && trial.assertions.some(a => !a.passed);
      return trial.failurePhase === 'workflow' && trial.steps.at(-1)?.index === 1 && Boolean(trial.steps.at(-1)?.error);
    }),
    version: workflows.configurations.every(c => Boolean(c.version)),
    cleanup: confirmed(workflows),
    cancellation: cancelled.interrupted && cancelled.trials.length === 1 && cancelled.trials[0]!.status === 'cancelled' && cancelled.trials[0]!.failurePhase === 'workflow',
    cancellationCleanup: confirmed(cancelled),
  };
}
export async function acceptProviders(targets: Target[], fixtureUrl: string, out: string, signal?: AbortSignal) {
  if (!targets.length || targets.some(t => t.provider === 'local')) throw new Error('Provider acceptance requires explicit hosted targets');
  const base = hostedDemoSuite(fixtureUrl, 1);
  const { engines: _engines, version: _version, ...common } = base;
  const suite: TargetSuite = { ...common, version: 2, targets, tests: base.tests.filter(t => ['heading', 'names', 'wrong-value', 'invalid-selector', 'timeout'].includes(t.id)) };
  requireCredentials(targets); remoteUrlCheck(suite);
  await mkdir(out, { recursive: true });
  const lockPath = join(out, 'acceptance.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Acceptance output is locked; use a new directory'); });
  try {
    if (await access(join(out, 'acceptance.json')).then(() => true, () => false)) throw new Error('Acceptance output already exists; use a new directory');
    const summary: { targetId: string; passed: boolean; checks: ReturnType<typeof acceptanceChecks> }[] = [];
    for (const target of targets) {
      if (signal?.aborted) break;
      const dir = join(out, target.id);
      const workflows = await runSuite({ ...suite, targets: [target] }, { out: join(dir, 'workflows'), signal });
      await writeReports(workflows, join(dir, 'workflows'));
      if (signal?.aborted) break;
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancelled: Run;
      try {
        cancelled = await runSuite({ ...suite, targets: [target], tests: [{ id: 'cancel', name: 'Cancel an active provider session', steps: [{ action: 'open', url: base.tests[0]!.steps[0]!.action === 'open' ? base.tests[0]!.steps[0]!.url : fixtureUrl }, { action: 'wait', selector: '#never-appears' }], assertions: [], timeoutMs: 60000 }] }, {
          out: join(dir, 'cancellation'), signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
          onStep: (_test, _target, index) => { if (index === 0) timer = setTimeout(() => abort.abort(), 250); },
        });
      } finally { clearTimeout(timer); }
      await writeReports(cancelled, join(dir, 'cancellation'));
      const checks = acceptanceChecks(workflows, cancelled);
      summary.push({ targetId: target.id, passed: Object.values(checks).every(Boolean), checks });
      await atomicJson(join(out, 'acceptance.json'), { version: 1, createdAt: new Date().toISOString(), fixtureUrl, results: summary });
      console.log(`${target.id}: ${summary.at(-1)!.passed ? 'accepted' : 'needs review'}`);
    }
    const complete = summary.length === targets.length && !signal?.aborted;
    await atomicJson(join(out, 'acceptance.json'), { version: 1, createdAt: new Date().toISOString(), fixtureUrl, complete, passed: complete && summary.every(s => s.passed), results: summary });
    return complete && summary.every(s => s.passed);
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
