import { readFile } from 'node:fs/promises';
import type { Comparison, Engine, Run, Trial } from './types.js';

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)]!;
}
export function groups(run: Run) {
  const map = new Map<string, Trial[]>();
  for (const trial of run.trials) { const key = `${trial.testId}:${trial.engine}`; map.set(key, [...(map.get(key) ?? []), trial]); }
  return map;
}
export function runPassed(run: Run) {
  if (!run.trials.length || run.interrupted || !run.trials.every(t => t.status === t.expectedStatus && !t.cleanupError && t.matchedExpectation)) return false;
  for (const test of run.testCases) for (const config of run.configurations) for (let rep = 0; rep < run.repetitions; rep++) {
    if (!run.trials.some(t => t.testId === test.id && t.engine === config.engine && t.repetition === rep && t.attempt === 0)) return false;
  }
  return true;
}
export async function loadRun(path: string): Promise<Run> {
  const run = JSON.parse(await readFile(path, 'utf8'));
  if (run.version !== 1 || typeof run.id !== 'string' || !run.id || typeof run.suiteHash !== 'string' || !run.suiteHash || typeof run.suiteName !== 'string' || typeof run.createdAt !== 'string' || !Array.isArray(run.trials) || !Array.isArray(run.configurations) || !run.configurations.length || !run.host || !Array.isArray(run.testCases) || !run.testCases.length || !Number.isInteger(run.repetitions) || run.repetitions < 1 || run.repetitions > 100 || typeof run.interrupted !== 'boolean') throw new Error('Invalid BrowserLab result file');
  const statuses = ['pass', 'fail', 'error', 'timeout', 'unsupported', 'cancelled'];
  const ids = new Set<string>(), engines = new Set<string>(), trials = new Set<string>();
  for (const t of run.testCases) {
    if (!t || typeof t.id !== 'string' || ids.has(t.id) || !statuses.includes(t.expectedStatus)) throw new Error('Invalid test case manifest');
    ids.add(t.id);
  }
  for (const c of run.configurations) {
    if (!c || !['chrome', 'lightpanda'].includes(c.engine) || engines.has(c.engine)) throw new Error('Invalid engine manifest');
    engines.add(c.engine);
  }
  for (const t of run.trials) {
    const key = `${t?.testId}:${t?.engine}:${t?.repetition}:${t?.attempt}`;
    if (!t || !ids.has(t.testId) || !engines.has(t.engine) || trials.has(key) || !statuses.includes(t.status) || !statuses.includes(t.expectedStatus) || typeof t.testName !== 'string' || !Array.isArray(t.steps) || !Array.isArray(t.assertions) || !Array.isArray(t.artifacts) || !t.output || typeof t.output !== 'object' || !Number.isInteger(t.repetition) || t.repetition < 0 || t.repetition >= run.repetitions || !Number.isInteger(t.attempt) || t.attempt < 0 || [t.workflowMs, t.startupMs, t.durationMs].some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid trial in result file');
    if (t.expectedStatus !== run.testCases.find((c: {id: string}) => c.id === t.testId).expectedStatus) throw new Error('Trial expectation differs from manifest');
    if (t.assertions.some((a: any) => !a || typeof a.passed !== 'boolean' || typeof a.path !== 'string' || typeof a.op !== 'string' || typeof a.message !== 'string')) throw new Error('Invalid assertion results');
    if (t.status === 'pass' && t.assertions.some((a: any) => !a.passed)) throw new Error('Passing trial contains failed assertions');
    if (t.status === 'pass' && t.expectedStatus === 'pass' && !t.assertions.length) throw new Error('Passing trial has no correctness assertions');
    if (t.artifacts.some((p: unknown) => typeof p !== 'string' || !/^artifacts\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_-]+\.png$/.test(p))) throw new Error('Invalid artifact path');
    t.matchedExpectation = t.status === t.expectedStatus && !t.cleanupError;
    trials.add(key);
  }
  return run as Run;
}
export interface CompareOptions { maxSlowdownPct: number; minSamples: number; minDeltaMs: number }
export const defaultCompare: CompareOptions = { maxSlowdownPct: 25, minSamples: 5, minDeltaMs: 100 };
export function compareRuns(current: Run, baseline: Run, options: CompareOptions = defaultCompare): Comparison {
  const result: Comparison = { baselineId: baseline.id, compatible: current.suiteHash === baseline.suiteHash, findings: [] };
  const finding = (severity: 'regression' | 'warning', testId: string, engine: Engine, message: string) => result.findings.push({ severity, testId, engine, message });
  if (!result.compatible) {
    finding('regression', '*', current.configurations[0]!.engine, 'Test contract changed. Review and accept a new baseline; results are not directly comparable.');
    return result;
  }
  const before = groups(baseline), after = groups(current);
  const sameHost = JSON.stringify(current.host) === JSON.stringify(baseline.host);
  if (!sameHost) finding('warning', '*', current.configurations[0]!.engine, 'Host configuration differs. Performance gates are disabled.');
  if (current.adapterVersion !== baseline.adapterVersion) finding('warning', '*', current.configurations[0]!.engine, 'agent-browser version changed; this comparison includes an adapter change.');
  for (const [key, oldTrials] of before) {
    const sample = oldTrials[0]!, newTrials = after.get(key);
    if (!newTrials?.length) { finding('regression', sample.testId, sample.engine, 'Baseline test/configuration is missing from this run.'); continue; }
    const first = newTrials.filter(t => t.attempt === 0), oldFirst = oldTrials.filter(t => t.attempt === 0);
    const failures = first.filter(t => !t.matchedExpectation).length, oldFailures = oldFirst.filter(t => !t.matchedExpectation).length;
    if (failures / first.length > oldFailures / oldFirst.length) finding('regression', sample.testId, sample.engine, `Unexpected outcome rate increased: ${oldFailures}/${oldFirst.length} → ${failures}/${first.length}.`);
    if (newTrials.some(t => t.cleanupError)) finding('regression', sample.testId, sample.engine, 'A session did not close cleanly.');
    if (sample.expectedStatus !== 'pass') continue;
    const a = first.filter(t => t.status === 'pass' && t.matchedExpectation).map(t => t.workflowMs);
    const b = oldFirst.filter(t => t.status === 'pass' && t.matchedExpectation).map(t => t.workflowMs);
    if (a.length < options.minSamples || b.length < options.minSamples) {
      finding('warning', sample.testId, sample.engine, `Performance gate needs ${options.minSamples} passing first attempts in both runs.`); continue;
    }
    const now = median(a)!, old = median(b)!;
    if (sameHost && now - old > options.minDeltaMs && now > old * (1 + options.maxSlowdownPct / 100)) finding('regression', sample.testId, sample.engine, `Median workflow time increased from ${Math.round(old)} ms to ${Math.round(now)} ms (limit ${options.maxSlowdownPct}%, minimum ${options.minDeltaMs} ms).`);
  }
  return result;
}
