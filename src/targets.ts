import type { Suite, Target, Trial, Run } from './types.js';

export const regions = {
  browserbase: ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-southeast-1'],
  browserless: ['sfo', 'lon', 'ams'],
};
export function validateTargets(input: unknown): Target[] {
  if (!Array.isArray(input) || !input.length || input.length > 20) throw new Error('targets: provide 1–20 configurations');
  const ids = new Set<string>();
  return input.map(t => {
    if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k => !['id', 'provider', 'engine', 'region'].includes(k))) throw new Error('Invalid target properties');
    if (typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('Target IDs must be unique identifiers');
    ids.add(t.id);
    if (!['local', 'browserbase', 'browserless'].includes(t.provider) || !['chrome', 'lightpanda'].includes(t.engine)) throw new Error('Invalid target provider or engine');
    if (t.provider === 'local') {
      if (t.region !== undefined) throw new Error('Local targets do not have a provider region');
      return { id: t.id, provider: t.provider, engine: t.engine };
    }
    if (t.engine !== 'chrome') throw new Error('Hosted targets currently support Chrome only');
    const allowed = regions[t.provider as keyof typeof regions];
    const region = t.region ?? allowed[0];
    if (!allowed.includes(region)) throw new Error(`Invalid region for ${t.provider}`);
    return { id: t.id, provider: t.provider, engine: t.engine, region };
  });
}
export function suiteTargets(suite: Suite): Target[] {
  return suite.version === 1 ? suite.engines.map(engine => ({ id: engine, provider: 'local', engine })) : [...suite.targets];
}
export function selectTargets(value: string): Target[] {
  return validateTargets(value.split(',').map(id => ({ id, provider: ['chrome', 'lightpanda'].includes(id) ? 'local' : id, engine: id === 'lightpanda' ? 'lightpanda' : 'chrome' })));
}
export function targetId(item: Trial | Run['configurations'][number]): string {
  return 'testId' in item ? item.targetId ?? item.engine : item.id ?? item.engine;
}
export function targetSettings(c: Run['configurations'][number]) {
  return { provider: c.provider ?? 'local', engine: c.engine, region: c.region ?? null, proxy: c.proxy ?? false, stealth: c.stealth ?? false };
}
export function requireCredentials(targets: Target[]) {
  for (const target of targets) {
    const name = target.provider === 'browserbase' ? 'BROWSERBASE_API_KEY' : target.provider === 'browserless' ? 'BROWSERLESS_API_KEY' : undefined;
    if (name && !process.env[name]?.trim()) throw new Error(`Missing ${name}. Store it locally and use --env-file .env.`);
  }
}
export function credentialValues(): string[] {
  return ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID', 'BROWSERLESS_API_KEY'].flatMap(k => process.env[k] ? [process.env[k]!] : []);
}
export function remoteUrlCheck(suite: Suite) {
  if (!suiteTargets(suite).some(t => t.provider !== 'local')) return;
  for (const test of suite.tests) for (const step of test.steps) if (step.action === 'open') {
    const u = new URL(step.url), h = u.hostname.toLowerCase();
    if (u.username || u.password) throw new Error('Keep URL credentials out of suites; use a fill.env step');
    if (u.protocol !== 'https:' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '[::1]' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) throw new Error('Remote targets need reachable HTTPS pages. The local demo cannot be used remotely; use --fixture-url with a hosted fixture.');
  }
}
