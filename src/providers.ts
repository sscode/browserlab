import { setTimeout as delay } from 'node:timers/promises';
import { ProcessFailure } from './process.js';
import { CdpBridge } from './cdp-bridge.js';
import { credentials } from './provider-config.js';
import type { Target } from './types.js';

export interface SessionInspection { state: 'active' | 'stopped' | 'unknown'; browserVersion?: string }
export type StopEvidence = 'provider-confirmed' | 'cdp-confirmed' | 'not-created';
export interface ProviderSession {
  create(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  connect(): string;
  inspect(signal?: AbortSignal): Promise<SessionInspection>;
  stop(): Promise<StopEvidence>;
}
type Data = Record<string, any>;

/** Own the lifecycle, including provider-specific evidence of release. Never
 * retry session creation: a lost response can still leave a billable browser.
 */
export class RemoteSession implements ProviderSession {
  id?: string;
  connectUrl?: string;
  readonly secrets: string[] = [];
  private stopUrl?: string;
  private creationStarted = false;
  private rejected = false;
  private stopped = false;
  private bridge?: CdpBridge;
  private evidence: StopEvidence = 'not-created';
  constructor(readonly target: Target, private transport: typeof fetch = fetch, private bridgeFactory: () => CdpBridge = () => new CdpBridge()) {}
  private get key() { return process.env[credentials[this.target.provider][0]!]!; }
  private get headers(): Record<string, string> {
    const name = { browserbase: 'X-BB-API-Key', steel: 'steel-api-key', 'browser-use': 'X-Browser-Use-API-Key', hyperbrowser: 'x-api-key', anchor: 'anchor-api-key' }[this.target.provider as string];
    return { 'Content-Type': 'application/json', ...(name ? { [name]: this.key } : {}) };
  }
  private get endpoint() {
    const base: Record<string, string> = { browserbase: 'https://api.browserbase.com/v1/sessions', steel: 'https://api.steel.dev/v1/sessions', 'browser-use': 'https://api.browser-use.com/api/v4/browsers', hyperbrowser: 'https://api.hyperbrowser.ai/api/session', anchor: 'https://api.anchorbrowser.io/v1/sessions' };
    return base[this.target.provider]!;
  }
  private remember(value: string) {
    this.secrets.push(value);
    try { for (const v of new URL(value).searchParams.values()) if (v) this.secrets.push(v); } catch { /* not a URL */ }
    return value;
  }
  private async request(url: string, init: RequestInit, signal: AbortSignal, allowAbsent = false, discardBody = false): Promise<Data> {
    let response: Response;
    try { response = await this.transport(url, { ...init, signal, redirect: 'error' }); }
    catch { throw new ProcessFailure(`${this.target.provider} API request ${signal.aborted ? 'timed out or was cancelled' : 'failed'}`, signal.aborted ? 'timeout' : 'error'); }
    if (allowAbsent && [404, 410].includes(response.status)) { await response.body?.cancel(); return {}; }
    if (!response.ok) {
      if (!this.id && !this.stopUrl && [400, 401, 402, 403, 404, 422, 429].includes(response.status)) this.rejected = true;
      await response.body?.cancel();
      throw new ProcessFailure(`${this.target.provider} API returned HTTP ${response.status}`);
    }
    if (discardBody) { await response.body?.cancel(); return {}; }
    let text = '';
    try {
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder(); let size = 0;
        try { while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 100000) throw new Error(); text += decoder.decode(value, { stream: true });
        } text += decoder.decode(); } finally { await reader.cancel(); }
      }
    } catch { throw new ProcessFailure(`${this.target.provider} response was interrupted or too large`); }
    if (!text.trim()) return {};
    let data: Data;
    try { data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
    catch { throw new ProcessFailure(`${this.target.provider} returned an invalid session response`); }
    if (data.error || data.success === false) throw new ProcessFailure(`${this.target.provider} rejected the session operation`);
    return data;
  }
  private sessionId(value: unknown) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new ProcessFailure(`${this.target.provider} returned no valid session ID; check the provider dashboard`);
    this.id = value;
  }
  async create(timeoutMs: number, signal?: AbortSignal) {
    if (this.creationStarted) throw new Error('A session can only be created once');
    const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)))]) : AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
    if (abort.aborted) throw new ProcessFailure('Execution cancelled', 'cancelled');
    this.creationStarted = true;
    const ttlMs = Math.max(60000, Math.min(660000, timeoutMs + 30000));
    if (this.target.provider === 'brightdata') {
      const auth = Buffer.from(`${process.env.BRIGHT_DATA_BROWSER_USERNAME}:${process.env.BRIGHT_DATA_BROWSER_PASSWORD}`).toString('base64'); this.remember(auth);
      this.bridge = this.bridgeFactory();
      await this.bridge.create('wss://brd.superproxy.io:9222', { Authorization: `Basic ${auth}` }, Math.max(1, Math.floor(timeoutMs)), ttlMs, signal);
      this.connectUrl = this.remember(this.bridge.url!); return;
    }
    if (this.target.provider === 'browserless') {
      const url = new URL('/session', `https://production-${this.target.region ?? 'sfo'}.browserless.io`); url.searchParams.set('token', this.key);
      const data = await this.request(url.href, { method: 'POST', headers: this.headers, body: JSON.stringify({ ttl: ttlMs, stealth: false, browser: 'chrome' }) }, abort);
      this.stopUrl = this.checkUrl(data.stop, 'https:', ['browserless.io']);
      this.connectUrl = this.checkUrl(data.connect, 'wss:', ['browserless.io']); return;
    }
    const bodies: Record<string, Data> = {
      browserbase: { ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}), region: this.target.region, proxies: false, keepAlive: false, timeout: Math.ceil(ttlMs / 1000), browserSettings: { recordSession: false, logSession: false, solveCaptchas: false, advancedStealth: false } },
      steel: { timeout: ttlMs, region: this.target.region ?? 'us-east', useProxy: false, solveCaptcha: false },
      'browser-use': { timeout: Math.ceil(ttlMs / 60000), proxyCountryCode: null, solveCaptchas: false, enableRecording: false },
      hyperbrowser: { timeoutMinutes: Math.ceil(ttlMs / 60000), region: this.target.region ?? 'us', useProxy: false, useStealth: false, useUltraStealth: false, solveCaptchas: false, enableWebRecording: false, enableVideoWebRecording: false },
      anchor: { session: { timeout: { max_duration: Math.ceil(ttlMs / 60000), idle_timeout: 1 }, proxy: { active: false }, recording: { active: false } }, browser: { adblock: { active: false }, popup_blocker: { active: false }, captcha_solver: { active: false }, extra_stealth: { active: false } } },
    };
    if (!bodies[this.target.provider]) throw new Error('Unsupported remote provider');
    const response = await this.request(this.endpoint, { method: 'POST', headers: this.headers, body: JSON.stringify(bodies[this.target.provider]) }, abort);
    const data = this.target.provider === 'anchor' ? response.data ?? {} : response;
    this.sessionId(data.id);
    const urls: Record<string, { value: unknown; domains: string[] }> = {
      browserbase: { value: data.connectUrl, domains: ['browserbase.com'] },
      steel: { value: `wss://connect.steel.dev?apiKey=${encodeURIComponent(this.key)}&sessionId=${encodeURIComponent(this.id!)}`, domains: ['steel.dev'] },
      'browser-use': { value: data.cdpUrl, domains: ['browser-use.com'] },
      hyperbrowser: { value: data.wsEndpoint, domains: ['hyperbrowser.ai'] },
      anchor: { value: data.cdp_url, domains: ['anchorbrowser.io', 'anchorforge.io'] },
    };
    const url = urls[this.target.provider]!; this.connectUrl = this.checkUrl(url.value, 'wss:', url.domains);
  }
  connect() { if (!this.connectUrl || this.stopped) throw new Error('Session is not ready to connect'); return this.connectUrl; }
  async start(timeoutMs: number, signal?: AbortSignal) { await this.create(timeoutMs, signal); return this.connect(); }
  private checkUrl(value: unknown, protocol: string, domains: string[]) {
    if (typeof value !== 'string') throw new ProcessFailure(`${this.target.provider} response is missing a session URL`);
    this.remember(value);
    let url: URL; try { url = new URL(value); } catch { throw new ProcessFailure('Invalid provider session URL'); }
    if (url.protocol !== protocol || !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || url.username || url.password || (url.port && url.port !== '443')) throw new ProcessFailure('Unexpected provider session URL');
    return value;
  }
  async inspect(signal = AbortSignal.timeout(5000)): Promise<SessionInspection> {
    if (this.stopped) return { state: 'stopped' };
    if (this.bridge) return this.bridge.inspect();
    if (!this.id) return { state: 'unknown' }; // Browserless has a stop capability, not a session-status API.
    const response = await this.request(`${this.endpoint}/${this.id}`, { headers: this.headers }, signal);
    const data = this.target.provider === 'anchor' ? response.data ?? {} : response;
    return { state: this.state(data.status) };
  }
  private state(status: unknown): SessionInspection['state'] {
    const terminal: Record<string, string[]> = { browserbase: ['COMPLETED', 'TIMED_OUT', 'ERROR'], steel: ['released', 'failed'], 'browser-use': ['stopped'], hyperbrowser: ['closed'], anchor: ['stopped', 'completed', 'terminated', 'deleted'] };
    if (typeof status === 'string' && terminal[this.target.provider]?.includes(status)) return 'stopped';
    if (['RUNNING', 'live', 'active', 'running'].includes(String(status))) return 'active';
    return 'unknown';
  }
  async stop(): Promise<StopEvidence> {
    if (this.stopped) return this.evidence;
    if (!this.creationStarted || this.rejected) return 'not-created';
    if (this.bridge) { await this.bridge.stop(); this.stopped = true; return this.evidence = 'cdp-confirmed'; }
    if (!this.id && !this.stopUrl) throw new Error(`${this.target.provider}: session creation was not confirmed. Check the provider dashboard; the requested session lifetime is bounded.`);
    const signal = AbortSignal.timeout(12000);
    if (this.target.provider === 'browserless') {
      await this.request(this.stopUrl!, { method: 'DELETE' }, signal, true, true);
      this.stopped = true; return this.evidence = 'provider-confirmed';
    }
    const url = `${this.endpoint}/${this.id}`, headers = this.headers;
    let data: Data;
    switch (this.target.provider) {
      case 'browserbase': data = await this.request(url, { method: 'POST', headers, body: JSON.stringify({ status: 'REQUEST_RELEASE', ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}) }) }, signal); break;
      case 'steel': data = await this.request(`${url}/release`, { method: 'POST', headers }, signal); if (data.success !== true) throw new Error('Steel release was not acknowledged'); break;
      case 'browser-use': data = await this.request(url, { method: 'PATCH', headers, body: JSON.stringify({ action: 'stop' }) }, signal); break;
      case 'hyperbrowser': data = await this.request(`${url}/stop`, { method: 'PUT', headers }, signal); if (data.success !== true) throw new Error('Hyperbrowser stop was not acknowledged'); break;
      case 'anchor':
        // The documented 200 response means this specific session has ended.
        await this.request(url, { method: 'DELETE', headers }, signal);
        this.stopped = true; return this.evidence = 'provider-confirmed';
      default: throw new Error('Unsupported remote provider');
    }
    for (let i = 0; i < 10; i++) {
      if (this.state(data.status) === 'stopped' || (await this.inspect(signal)).state === 'stopped') { this.stopped = true; return this.evidence = 'provider-confirmed'; }
      await delay(250, undefined, { signal });
    }
    throw new Error(`${this.target.provider} session stop was not confirmed`);
  }
  async close() { return this.stop(); }
}
