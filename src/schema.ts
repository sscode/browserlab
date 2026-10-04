import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Suite, Engine, Json } from './types.js';

const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail(where: string, message: string): never { throw new Error(`${where}: ${message}`); }
function keys(x: Record<string, unknown>, allowed: string[], where: string) {
  for (const key of Object.keys(x)) if (!allowed.includes(key)) fail(where, `unknown property ${key}`);
}
function str(x: unknown, where: string): asserts x is string {
  if (typeof x !== 'string' || !x.trim() || x.length > 10000) fail(where, 'expected a nonempty string of at most 10,000 characters');
}
function integer(x: unknown, lo: number, hi: number, where: string) {
  if (!Number.isInteger(x) || (x as number) < lo || (x as number) > hi) fail(where, `expected an integer from ${lo} to ${hi}`);
}
const ops = ['required', 'equals', 'contains', 'count', 'min', 'max', 'type', 'unique'];
function rule(x: Record<string, unknown>, where: string) {
  if (!ops.includes(String(x.op))) fail(where, 'unknown assertion operator');
  if (!['required', 'unique'].includes(String(x.op)) && !Object.hasOwn(x, 'value')) fail(where, 'value is required');
  if (['count', 'min', 'max'].includes(String(x.op)) && (typeof x.value !== 'number' || !Number.isFinite(x.value))) fail(where, 'value must be a finite number');
  if (x.op === 'count') integer(x.value, 0, 1e9, where);
  if (x.op === 'type' && !['string', 'number', 'boolean', 'array', 'object', 'null'].includes(String(x.value))) fail(where, 'invalid type');
  if (x.field !== undefined) { str(x.field, `${where}.field`); if (!x.field.startsWith('/')) fail(where, 'field must be a JSON Pointer'); }
}
export function validateSuite(input: unknown): Suite {
  if (!object(input)) fail('suite', 'expected an object');
  keys(input, ['version', 'name', 'engines', 'repetitions', 'timeoutMs', 'tests'], 'suite');
  if (input.version !== 1) fail('suite.version', 'only version 1 is supported');
  str(input.name, 'suite.name');
  const engines = input.engines ?? ['chrome', 'lightpanda'];
  if (!Array.isArray(engines) || !engines.length || engines.some(e => e !== 'chrome' && e !== 'lightpanda') || new Set(engines).size !== engines.length) fail('suite.engines', 'use unique chrome and/or lightpanda entries');
  const repetitions = input.repetitions ?? 3, timeoutMs = input.timeoutMs ?? 30000;
  integer(repetitions, 1, 100, 'suite.repetitions'); integer(timeoutMs, 100, 600000, 'suite.timeoutMs');
  if (!Array.isArray(input.tests) || !input.tests.length || input.tests.length > 1000) fail('suite.tests', 'expected 1–1,000 tests');
  const ids = new Set<string>();
  for (const [i, t] of input.tests.entries()) {
    const p = `tests[${i}]`;
    if (!object(t)) fail(p, 'expected object');
    keys(t, ['id', 'name', 'steps', 'assertions', 'timeoutMs', 'retries', 'expectedStatus'], p);
    str(t.id, `${p}.id`); str(t.name, `${p}.name`);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) fail(p, 'id must be unique, 1–80 letters, numbers, underscores, or hyphens');
    ids.add(t.id);
    if (t.timeoutMs !== undefined) integer(t.timeoutMs, 100, 600000, `${p}.timeoutMs`);
    if (t.retries !== undefined) integer(t.retries, 0, 3, `${p}.retries`);
    if (t.expectedStatus !== undefined && !['pass', 'fail', 'timeout', 'error', 'unsupported'].includes(String(t.expectedStatus))) fail(p, 'invalid expectedStatus');
    if (!Array.isArray(t.steps) || !t.steps.length || t.steps.length > 100) fail(p, 'expected 1–100 steps');
    if (!object(t.steps[0]) || t.steps[0].action !== 'open') fail(p, 'first step must open a URL');
    const outputs = new Set<string>();
    for (const [j, s] of t.steps.entries()) {
      const q = `${p}.steps[${j}]`;
      if (!object(s)) fail(q, 'expected object');
      const allowed: Record<string, string[]> = {
        open: ['url'], click: ['selector'], fill: ['selector', 'value', 'env'], wait: ['selector'],
        extract: ['as', 'selector', 'kind', 'attribute', 'fields'], screenshot: ['name'],
      };
      const props = allowed[String(s.action)];
      if (!props) fail(q, 'unknown action');
      keys(s, ['action', ...props], q);
      if (s.action === 'open') { str(s.url, q); if (!/^https?:\/\//.test(s.url)) fail(q, 'only http(s) URLs are supported'); }
      if (['click', 'fill', 'wait', 'extract'].includes(String(s.action))) { str(s.selector, q); if (s.selector.startsWith('@')) fail(q, 'temporary element refs cannot be used in portable workflows'); }
      if (s.action === 'fill') {
        if ((s.value === undefined) === (s.env === undefined)) fail(q, 'provide exactly one of value or env');
        if (s.value !== undefined && typeof s.value !== 'string') fail(q, 'value must be a string');
        if (s.env !== undefined) { str(s.env, q); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.env)) fail(q, 'invalid environment variable name'); }
      }
      if (s.action === 'screenshot') { str(s.name, q); if (!/^[a-zA-Z0-9_-]+\.png$/.test(s.name)) fail(q, 'use a simple .png filename'); }
      if (s.action === 'extract') {
        str(s.as, q);
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(s.as) || outputs.has(s.as)) fail(q, 'extraction names must be unique identifiers');
        outputs.add(s.as);
        if (!['text', 'texts', 'count', 'value', 'attribute', 'table'].includes(String(s.kind))) fail(q, 'unknown extraction kind');
        if (s.kind === 'attribute') str(s.attribute, q);
        if (s.kind === 'table') {
          if (!object(s.fields) || !Object.keys(s.fields).length) fail(q, 'table requires fields');
          for (const [name, f] of Object.entries(s.fields)) {
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || !object(f)) fail(q, 'invalid table field');
            keys(f, ['selector', 'kind', 'attribute'], q);
            if (f.selector !== undefined) str(f.selector, q);
            if (f.kind !== undefined && !['text', 'value', 'attribute'].includes(String(f.kind))) fail(q, 'invalid field kind');
            if (f.kind === 'attribute') str(f.attribute, q);
          }
        }
      }
    }
    if (!Array.isArray(t.assertions)) fail(p, 'assertions must be an array');
    if (!t.assertions.length && (t.expectedStatus ?? 'pass') === 'pass') fail(p, 'passing tests require at least one assertion');
    for (const a of t.assertions) {
      if (!object(a)) fail(p, 'assertion must be an object');
      keys(a, ['path', 'op', 'value', 'field', 'rule'], p);
      if (typeof a.path !== 'string' || (a.path !== '' && !a.path.startsWith('/'))) fail(p, 'assertion path must be a JSON Pointer, such as /products');
      if (a.op === 'every') {
        if (!object(a.rule)) fail(p, 'every requires a rule');
        if (a.field !== undefined) { str(a.field, p); if (!a.field.startsWith('/')) fail(p, 'field must be a JSON Pointer'); }
        keys(a.rule, ['op', 'value', 'field'], p); rule(a.rule, p);
      } else rule(a, p);
    }
  }
  return { ...input, engines, repetitions, timeoutMs } as unknown as Suite;
}
export async function loadSuite(path: string) { return validateSuite(JSON.parse(await readFile(path, 'utf8'))); }
export function hashSuite(suite: Suite): string {
  // Engine selection and repetition count may change without changing the task contract.
  return createHash('sha256').update(JSON.stringify({ version: suite.version, timeoutMs: suite.timeoutMs, tests: suite.tests })).digest('hex');
}
export function selectEngines(value: string): Engine[] {
  const engines = value.split(',');
  if (!engines.length || engines.some(x => x !== 'chrome' && x !== 'lightpanda') || new Set(engines).size !== engines.length) throw new Error('Engines must be chrome, lightpanda, or chrome,lightpanda');
  return engines as Engine[];
}
export function pointer(root: unknown, path: string): unknown {
  if (path === '') return root;
  return path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((v, key) => {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, key)) return undefined;
    return (v as Record<string, Json>)[key];
  }, root);
}
