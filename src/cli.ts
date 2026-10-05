#!/usr/bin/env node
import { loadEnvFile } from 'node:process';
import { suiteTargets, selectTargets, requireCredentials, credentialValues, targetId } from './targets.js';
import { redact } from './runner.js';
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { mkdir, access, copyFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadSuite, selectEngines, hashSuite, validateSuite } from './schema.js';
import { runSuite, atomicJson } from './runner.js';
import { compareRuns, defaultCompare, loadRun, runPassed } from './compare.js';
import { writeReports } from './report.js';
import { demoSuite, startFixtures } from './fixtures.js';
import { AgentBrowser, checkInstall, createConfig } from './adapter.js';
import type { Comparison, Run, Suite } from './types.js';

const help = `BrowserLab 0.2.0 — browser correctness and regression checks

Usage:
  browserlab init [suite.json]             Create a portable starter suite
  browserlab doctor [--engines chrome]     Check actual engine startup and cleanup
  browserlab demo                          Execute 20 reference cases
  browserlab fixtures --out DIRECTORY     Export reference pages for HTTPS hosting
  browserlab run <suite.json>              Execute a suite
  browserlab baseline accept <results>     Accept a passing result set
  browserlab compare <current> <baseline>  Compare saved result sets
  browserlab report <results>              Regenerate HTML and JUnit reports

Options:
  --engines chrome,lightpanda   Select local engines (legacy suites supported)
  --targets chrome,browserbase,browserless  Select execution targets
  --env-file FILE              Load local credentials (existing environment wins)
  --fixture-url HTTPS_URL      Use hosted reference pages with demo
  --repetitions N              Override repetitions (1–100)
  --out DIRECTORY             Report directory (must not contain results.json)
  --baseline FILE             Compare after execution; fail on regressions
  --min-samples N             Passing first attempts for timing gate (default 5)
  --max-slowdown N            Maximum median slowdown percent (default 25)
  --min-delta N               Minimum slowdown in milliseconds (default 100)
  --help                      Show this help
  --version                   Show version

Exit codes: 0 expected outcomes; 1 failed checks/regressions; 2 configuration/setup
error; 130 cancelled. Remote targets use paid provider sessions. Reports stay local. No telemetry.
`;

async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
function numeric(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Expected a number from ${min} to ${max}, received ${value}`);
  return n;
}
async function main() {
  const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: {
    'env-file': { type: 'string' }, 'fixture-url': { type: 'string' }, targets: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, engines: { type: 'string' }, repetitions: { type: 'string' }, out: { type: 'string' }, baseline: { type: 'string' },
    'min-samples': { type: 'string' }, 'max-slowdown': { type: 'string' }, 'min-delta': { type: 'string' },
  } });
  if (flags['env-file']) loadEnvFile(resolve(flags['env-file']));
  if (flags.targets && flags.engines) throw new Error('Use either --targets or --engines');
  if (flags.version) { console.log('0.2.0'); return; }
  if (flags.help || !positionals.length) { console.log(help); return; }
  const [command, ...args] = positionals;
  const maxArgs: Record<string, number> = { init: 1, doctor: 0, demo: 0, fixtures: 0, run: 1, baseline: 2, compare: 2, report: 1 };
  if (!(command! in maxArgs) || args.length > maxArgs[command!]!) throw new Error('Unknown command or extra arguments. Use --help.');
  const engines = flags.engines ? selectEngines(flags.engines) : undefined;
  const compareOptions = {
    minSamples: numeric(flags['min-samples'], defaultCompare.minSamples, 3, 100),
    maxSlowdownPct: numeric(flags['max-slowdown'], defaultCompare.maxSlowdownPct, 0, 10000),
    minDeltaMs: numeric(flags['min-delta'], defaultCompare.minDeltaMs, 0, 600000),
  };
  if (!Number.isInteger(compareOptions.minSamples)) throw new Error('--min-samples must be an integer');
  if (command === 'init') {
    const path = resolve(args[0] ?? 'browserlab.json');
    const suite: Suite = { version: 1, name: 'My first browser comparison', engines: ['chrome', 'lightpanda'], repetitions: 3, timeoutMs: 30000, tests: [{ id: 'page-heading', name: 'Read the example page', steps: [{ action: 'open', url: 'https://example.com' }, { action: 'extract', as: 'heading', selector: 'h1', kind: 'text' }], assertions: [{ path: '/heading', op: 'equals', value: 'Example Domain' }] }] };
    await writeFile(path, JSON.stringify(suite, null, 2) + '\n', { flag: 'wx' });
    console.log(`Created ${path}\nEdit the URL, selectors, and assertions, then run: browserlab run ${path}`); return;
  }
  if (command === 'fixtures') {
    if (!flags.out) throw new Error('Use fixtures --out DIRECTORY');
    const fixture = await startFixtures();
    try {
      const dir = resolve(flags.out); await mkdir(dir, { recursive: true });
      for (const [route, file] of [['/', 'index.html'], ['/next', 'next/index.html'], ['/api/items', 'api/items']]) {
        const path = join(dir, file!); await mkdir(dirname(path), { recursive: true });
        const text = await (await fetch(fixture.url + route)).text();
        await writeFile(path, text.replaceAll('href="/next"', 'href="./next/"').replaceAll("fetch('/api/items')", "fetch('./api/items')"), { flag: 'wx' });
      }
      console.log(`Fixture pages: ${dir}. Host this directory at an HTTPS URL, then use demo --fixture-url URL.`);
    } finally { await fixture.close(); }
    return;
  }
  if (command === 'doctor') {
    const targets = flags.targets ? selectTargets(flags.targets) : (engines ?? ['chrome', 'lightpanda']).map(engine => ({ id: engine, provider: 'local' as const, engine: engine as 'chrome' | 'lightpanda' }));
    requireCredentials(targets);
    const install = await checkInstall(); console.log(`Adapter: ${install.version} (package ${install.pinned})`);
    const dir = await mkdtemp(join(tmpdir(), 'browserlab-doctor-'));
    const config = await createConfig(dir);
    try {
      for (const target of targets) {
        const adapter = new AgentBrowser(target, `doctor-${Date.now()}`, config);
        try { await adapter.start(60000); console.log(`${target.id}: ready · ${await adapter.version()}`); }
        catch (error) { console.error(redact(`${target.id}: ${error instanceof Error ? error.message : error}`, [...credentialValues(), ...adapter.secrets])); process.exitCode = 2; }
        finally { await adapter.close().catch(e => { console.error(redact(e.message, [...credentialValues(), ...adapter.secrets])); process.exitCode = 2; }); }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
    if (process.exitCode) console.error('Install engines: npx agent-browser install; install Lightpanda from https://lightpanda.io/docs/open-source/installation. Set BROWSERLAB_LIGHTPANDA to its executable if needed.');
    return;
  }
  if (command === 'baseline') {
    if (args[0] !== 'accept' || !args[1]) throw new Error('Use: browserlab baseline accept <results.json> --out <baseline directory>');
    const run = await loadRun(args[1]);
    if (!runPassed(run)) throw new Error('Cannot accept a baseline with unexpected outcomes or interrupted execution');
    const dir = resolve(flags.out ?? '.browserlab/baselines'); await mkdir(dir, { recursive: true });
    const dest = join(dir, 'baseline.json');
    if (await exists(dest)) throw new Error('Baseline already exists. Use a new --out directory to keep the previous baseline.');
    await atomicJson(dest, run); console.log(`Accepted baseline: ${dest}`); return;
  }
  if (command === 'compare' || command === 'report') {
    if (!args[0] || (command === 'compare' && !args[1])) throw new Error(`Missing result file. Use --help.`);
    const run = await loadRun(args[0]);
    const comparison = command === 'compare' ? compareRuns(run, await loadRun(args[1]!), compareOptions) : undefined;
    const dir = resolve(flags.out ?? dirname(args[0])); await mkdir(dir, { recursive: true });
    if (resolve(args[0]) !== join(dir, 'results.json')) {
      if (await exists(join(dir, 'results.json'))) throw new Error('Output already contains results.json. Use a new --out directory.');
      await copyFile(args[0], join(dir, 'results.json'));
      for (const path of new Set(run.trials.flatMap(t => t.artifacts))) {
        const destination = join(dir, path); await mkdir(dirname(destination), { recursive: true });
        await copyFile(join(dirname(resolve(args[0])), path), destination);
      }
    }
    await writeReports(run, dir, comparison);
    if (comparison) { await atomicJson(join(dir, 'comparison.json'), comparison); for (const f of comparison.findings) console.log(`${f.severity}: ${f.testId}/${f.targetId ?? f.engine}: ${f.message}`); }
    console.log(`Report: ${join(dir, 'report.html')}`);
    process.exitCode = runPassed(run) && !comparison?.findings.some(f => f.severity === 'regression') ? 0 : 1; return;
  }
  if (command === 'run' && !args[0]) throw new Error('A suite file is required');
  const out = resolve(flags.out ?? join('.browserlab', 'runs', new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid));
  if (await exists(join(out, 'results.json'))) throw new Error('Output already contains results.json. Use a new --out directory.');
  const baseline = flags.baseline ? await loadRun(flags.baseline) : undefined;
  const abort = new AbortController();
  const cancel = () => { console.error('\nStopping this session and saving partial results…'); abort.abort(); };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let fixture: Awaited<ReturnType<typeof startFixtures>> | undefined;
  try {
    if (command === 'demo' && !flags['fixture-url']) fixture = await startFixtures();
    let suite: Suite = command === 'demo' ? demoSuite(fixture?.url ?? flags['fixture-url']!) : await loadSuite(args[0]!);
    if (flags['fixture-url'] && command !== 'demo') throw new Error('--fixture-url is only available with demo');
    if (flags['fixture-url']) {
      suite.tests.find(t => t.id === 'timeout')!.timeoutMs = 30000;
      const url = new URL(flags['fixture-url']); if (url.search || url.hash) throw new Error('Fixture URL must have no query or fragment');
      suite.tests.forEach(t => { const step = t.steps[0]!; if (step.action === 'open') step.url = url.href.endsWith('/') ? url.href : url.href + '/'; });
      const link = suite.tests.find(t => t.id === 'attribute')!; link.assertions[0]!.value = './next/';
      // Allow provider startup time; the explicit negative timeout keeps its own deadline.
      suite.timeoutMs = 60000;
    }
    if (engines) suite = { version: 1, name: suite.name, engines, repetitions: suite.repetitions, timeoutMs: suite.timeoutMs, tests: suite.tests };
    if (flags.targets) suite = { version: 2, name: suite.name, targets: selectTargets(flags.targets), repetitions: suite.repetitions, timeoutMs: suite.timeoutMs, tests: suite.tests };
    if (flags.repetitions) suite.repetitions = numeric(flags.repetitions, 3, 1, 100);
    suite = validateSuite(suite);
    console.log(`BrowserLab · ${suite.name}\n${suite.tests.length} cases × ${suiteTargets(suite).length} targets × ${suite.repetitions} repetitions\n`);
    const run = await runSuite(suite, { out, signal: abort.signal, contractHash: fixture ? hashSuite(demoSuite('http://fixture.browserlab', suite.repetitions)) : undefined,
      onTrial: t => console.log(`${t.matchedExpectation ? '✓' : '✕'} ${targetId(t).padEnd(12)} ${t.testId.padEnd(18)} ${t.status.padEnd(11)} ${Math.round(t.workflowMs)} ms${t.expectedStatus !== 'pass' ? ` (expected ${t.expectedStatus})` : ''}${t.attempt ? ` retry ${t.attempt}` : ''}`),
    });
    let comparison: Comparison | undefined;
    if (baseline) { comparison = compareRuns(run, baseline, compareOptions); await atomicJson(join(out, 'comparison.json'), comparison); }
    await writeReports(run, out, comparison);
    console.log(`\nReport: ${join(out, 'report.html')}\nResults: ${join(out, 'results.json')}`);
    process.exitCode = run.interrupted ? 130 : runPassed(run) && !comparison?.findings.some(f => f.severity === 'regression') ? 0 : 1;
  } finally {
    await fixture?.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
main().catch(error => { console.error(redact(`BrowserLab: ${error instanceof Error ? error.message : error}`, credentialValues())); process.exitCode = 2; });
