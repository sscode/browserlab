import { stripVTControlCharacters } from 'node:util';
import { runPassed } from './compare.js';
import { targetId } from './targets.js';
import type { Comparison, Run, Trial } from './types.js';

// Page data and error messages must not emit terminal control sequences.
const text = (value: string) => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
export function trialLine(t: Trial): string {
  const line = `${t.matchedExpectation ? 'PASS' : 'FAIL'} ${targetId(t).padEnd(12)} ${t.testId} [${t.repetition + 1}.${t.attempt}] ${t.status} ${Math.round(t.workflowMs)} ms${t.expectedStatus !== 'pass' ? ` (expected ${t.expectedStatus})` : ''}`;
  const details = t.matchedExpectation ? [] : [t.error, ...t.assertions.filter(a => !a.passed).map(a => `${a.path}: ${a.message}`), t.cleanupError && `Cleanup: ${t.cleanupError}`].filter(Boolean) as string[];
  return [line, ...details.map(detail => `  ${detail}`)].map(text).join('\n');
}
export function summary(run: Run, comparison?: Comparison): string {
  const passed = runPassed(run) && !comparison?.findings.some(f => f.severity === 'regression');
  const planned = run.testCases.length * run.configurations.length * run.repetitions;
  const first = run.trials.filter(t => t.attempt === 0).length;
  const lines = [run.interrupted ? 'CANCELLED' : passed ? 'PASS' : 'FAIL', `Trials: ${first}/${planned} first attempts; ${run.trials.length - first} retries`, '', 'Target        Expected outcomes    Cleanup failures'];
  for (const config of run.configurations) {
    const trials = run.trials.filter(t => targetId(t) === targetId(config));
    lines.push(`${targetId(config).padEnd(14)}${`${trials.filter(t => t.matchedExpectation).length}/${trials.length}`.padEnd(21)}${trials.filter(t => t.cleanupError).length}`);
  }
  if (comparison) lines.push('', ...comparison.findings.map(f => `${f.severity.toUpperCase()} ${f.testId}/${f.targetId ?? f.engine}: ${f.message}`));
  return lines.map(text).join('\n');
}
