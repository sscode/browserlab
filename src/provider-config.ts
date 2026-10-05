import type { Provider, Target } from './types.js';

export const providerNames = ['local', 'browserbase', 'browserless', 'steel', 'browser-use', 'brightdata', 'hyperbrowser', 'anchor'] as const;
export const credentials: Record<Provider, readonly string[]> = {
  local: [], browserbase: ['BROWSERBASE_API_KEY'], browserless: ['BROWSERLESS_API_KEY'],
  steel: ['STEEL_API_KEY'], 'browser-use': ['BROWSER_USE_API_KEY'],
  brightdata: ['BRIGHT_DATA_BROWSER_USERNAME', 'BRIGHT_DATA_BROWSER_PASSWORD'],
  hyperbrowser: ['HYPERBROWSER_API_KEY'], anchor: ['ANCHOR_API_KEY'],
};
export const regions: Partial<Record<Provider, readonly string[]>> = {
  browserbase: ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-southeast-1'],
  browserless: ['sfo', 'lon', 'ams'], steel: ['us-east'],
  hyperbrowser: ['us', 'us-central', 'us-west', 'us-east', 'asia-south', 'europe-west'],
};
export function providerSettings(target: Target) {
  const provider = target.provider;
  return {
    settingsVersion: 1,
    proxy: provider === 'brightdata' ? 'provider-managed' as const : false as const,
    stealth: ['browserbase', 'steel', 'browser-use', 'brightdata', 'anchor'].includes(provider) ? 'provider-managed' as const : false as const,
    regionPolicy: target.region ? 'requested' as const : provider === 'local' ? 'local' as const : 'provider-managed' as const,
    sessionTimeout: provider === 'local' ? 'local' as const : provider === 'brightdata' ? 'client-only' as const : 'requested' as const,
  };
}
