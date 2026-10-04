import { isDeepStrictEqual } from 'node:util';
import { pointer } from './schema.js';
import type { Assertion, AssertionResult, Rule } from './types.js';

function check(actual: unknown, rule: Rule): boolean {
  switch (rule.op) {
    case 'required': return actual !== undefined && actual !== null && actual !== '';
    case 'equals': return isDeepStrictEqual(actual, rule.value);
    case 'contains': return typeof actual === 'string' && typeof rule.value === 'string' ? actual.includes(rule.value) : Array.isArray(actual) && actual.some(v => isDeepStrictEqual(v, rule.value));
    case 'count': return Array.isArray(actual) && actual.length === rule.value;
    case 'min': return typeof actual === 'number' && actual >= (rule.value as number);
    case 'max': return typeof actual === 'number' && actual <= (rule.value as number);
    case 'type': return (actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual) === rule.value;
    case 'unique': {
      if (!Array.isArray(actual) || actual.length === 0) return false;
      const values = actual.map(v => rule.field ? pointer(v, rule.field) : v);
      return values.every((v, i) => v !== undefined && !values.slice(0, i).some(prior => isDeepStrictEqual(prior, v)));
    }
  }
}
export function evaluate(output: unknown, assertions: Assertion[]): AssertionResult[] {
  return assertions.map(a => {
    const actual = pointer(output, a.path);
    const passed = a.op === 'every'
      ? Array.isArray(actual) && actual.length > 0 && actual.every(v => check(a.field ? pointer(v, a.field) : v, a.rule!))
      : check(actual, a as Rule);
    return { path: a.path, op: a.op, passed, message: passed ? 'Requirement met' : `${a.op} requirement not met at ${a.path || '/'}${a.field ? ` (${a.field})` : ''}` };
  });
}
