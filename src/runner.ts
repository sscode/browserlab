import { randomUUID } from 'node:crypto';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rename, open, rm, access } from 'node:fs/promises';
import { AgentBrowser, adapterVersion, createConfig } from './adapter.js';
import { evaluate } from './assertions.js';
import { hashSuite } from './schema.js';
import { Sampler, ProcessFailure } from './process.js';
import type { Engine, Run, Suite, TestCase, Trial } from './types.js';

export interface RunOptions { out: string; signal?: AbortSignal; onTrial?: (trial: Trial) => void; contractHash?: string }
export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
export function redact<T>(value: T, secrets: string[]): T {
  function visit(x: unknown): unknown {
    if (typeof x === 'string') return secrets.filter(Boolean).reduce((s, secret) => s.split(secret).join('[REDACTED]'), x);
    if (Array.isArray(x)) return x.map(visit);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, visit(v)]));
    return x;
  }
  return visit(value) as T;
}
export async function runSuite(suite: Suite, options: RunOptions): Promise<Run> {
  await mkdir(options.out, { recursive: true });
  const lockPath = join(options.out, 'run.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Output directory is locked by another run. Use a new output directory.'); });
  try {
    const occupied = await access(join(options.out, 'results.json')).then(() => true, () => false);
    if (occupied) throw new Error('Output directory already contains results.json. Use a new output directory.');
    return await runSuiteUnlocked(suite, options);
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
async function runSuiteUnlocked(suite: Suite, options: RunOptions): Promise<Run> {
  const config = await createConfig(options.out);
  const run: Run = {
    version: 1, id: randomUUID(), suiteName: suite.name, suiteHash: options.contractHash ?? hashSuite(suite), createdAt: new Date().toISOString(),
    configurations: suite.engines.map(engine => ({ engine, version: null })),
    host: { platform: platform(), arch: arch(), release: release(), cpus: cpus().length, memoryBytes: totalmem(), node: process.version },
    adapterVersion: await adapterVersion(), repetitions: suite.repetitions, trials: [], interrupted: false,
    testCases: suite.tests.map(t => ({ id: t.id, expectedStatus: t.expectedStatus ?? 'pass' })),
  };
  const secrets = suite.tests.flatMap(t => t.steps.flatMap(s => s.action === 'fill' && s.env && process.env[s.env] ? [process.env[s.env]!] : []));
  for (let rep = 0; rep < suite.repetitions; rep++) {
    for (const [index, test] of suite.tests.entries()) {
      const engines = (rep + index) % 2 ? [...suite.engines].reverse() : suite.engines;
      for (const engine of engines) {
        if (options.signal?.aborted) { run.interrupted = true; break; }
        for (let attempt = 0; attempt <= (test.retries ?? 0); attempt++) {
          const trial = await runTrial(test, engine, rep, attempt, suite.timeoutMs, config, options, run);
          const clean = redact(trial, secrets);
          run.trials.push(clean);
          await atomicJson(join(options.out, 'results.json'), run);
          options.onTrial?.(clean);
          if (trial.matchedExpectation || trial.status === 'unsupported' || trial.status === 'cancelled') break;
        }
      }
      if (run.interrupted) break;
    }
    if (run.interrupted) break;
  }
  if (options.signal?.aborted) run.interrupted = true;
  await atomicJson(join(options.out, 'results.json'), run);
  return run;
}
async function runTrial(test: TestCase, engine: Engine, repetition: number, attempt: number, defaultTimeout: number, config: string, options: RunOptions, run: Run): Promise<Trial> {
  const id = randomUUID();
  const trial: Trial = {
    id, testId: test.id, testName: test.name, engine, repetition, attempt, expectedStatus: test.expectedStatus ?? 'pass',
    status: 'error', matchedExpectation: false, startedAt: new Date().toISOString(), durationMs: 0, startupMs: 0, workflowMs: 0,
    peakRssKb: null, cpuMs: null, measurementMethod: 'Unavailable', steps: [], assertions: [], output: {}, artifacts: [],
  };
  if (engine === 'lightpanda' && test.steps.some(s => s.action === 'screenshot')) {
    trial.status = 'unsupported'; trial.error = 'Lightpanda does not support webpage screenshots';
    trial.matchedExpectation = trial.status === trial.expectedStatus; return trial;
  }
  for (const s of test.steps) if (s.action === 'fill' && s.env && process.env[s.env] === undefined) {
    trial.error = `Missing environment variable ${s.env}`;
    trial.matchedExpectation = trial.status === trial.expectedStatus; return trial;
  }
  const adapter = new AgentBrowser(engine, `bl-${id}`, config);
  const started = performance.now(), deadline = started + (test.timeoutMs ?? defaultTimeout);
  const remaining = () => {
    if (options.signal?.aborted) throw new ProcessFailure('Execution cancelled', 'cancelled');
    const ms = Math.floor(deadline - performance.now());
    if (ms <= 0) throw new ProcessFailure('Trial time limit exceeded', 'timeout');
    return ms;
  };
  let sampler: Sampler | undefined;
  let workflowStarted: number | undefined;
  try {
    const pid = await adapter.start(remaining(), options.signal);
    trial.startupMs = performance.now() - started;
    if (pid) { sampler = new Sampler(pid); sampler.start(); }
    const configuration = run.configurations.find(c => c.engine === engine)!;
    if (!configuration.version) configuration.version = await adapter.version().catch(() => null);
    workflowStarted = performance.now();
    for (const [index, step] of test.steps.entries()) {
      const stepStarted = performance.now();
      try {
        const value = await adapter.step(step, remaining(), options.signal, join(options.out, 'artifacts', id));
        if (step.action === 'extract' && value !== undefined) trial.output[step.as] = value;
        if (step.action === 'screenshot') trial.artifacts.push(`artifacts/${id}/${step.name}`);
        trial.steps.push({ index, action: step.action, durationMs: performance.now() - stepStarted });
      } catch (e) {
        trial.steps.push({ index, action: step.action, durationMs: performance.now() - stepStarted, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }
    trial.assertions = evaluate(trial.output, test.assertions);
    trial.status = trial.assertions.every(a => a.passed) ? 'pass' : 'fail';
  } catch (error) {
    trial.status = error instanceof ProcessFailure ? error.kind : 'error';
    trial.error = error instanceof Error ? error.message : String(error);
  } finally {
    trial.durationMs = performance.now() - started;
    trial.workflowMs = workflowStarted === undefined ? 0 : performance.now() - workflowStarted;
    if (sampler) {
      await sampler.stop();
      trial.peakRssKb = sampler.peakRssKb; trial.cpuMs = sampler.cpuMs;
      if (sampler.peakRssKb !== null) trial.measurementMethod = 'ps sampled at 150 ms: session daemon + browser descendants; summed RSS (shared pages can be counted twice); CPU is a sampled lower bound; startup peak excluded';
    }
    try { trial.cleanupMethod = await adapter.close(); } catch (error) { trial.cleanupError = error instanceof Error ? error.message : String(error); }
  }
  trial.matchedExpectation = trial.status === trial.expectedStatus && !trial.cleanupError;
  return trial;
}
