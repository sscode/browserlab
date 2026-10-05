import { setTimeout as delay } from 'node:timers/promises';
import { ProcessFailure } from './process.js';
import type { Target } from './types.js';

// BrowserLab owns the provider lifecycle. The pinned upstream provider adapters
// ignore failed stop requests, which is insufficient evidence for our reports.
export class RemoteSession {
  id?: string;
  connectUrl?: string;
  readonly secrets: string[] = [];
  private stopUrl?: string;
  private creationStarted = false;
  private rejected = false;
  private stopped = false;
  constructor(readonly target: Target, private transport: typeof fetch = fetch) {}
  private get key() { return process.env[this.target.provider === 'browserbase' ? 'BROWSERBASE_API_KEY' : 'BROWSERLESS_API_KEY']!; }
  private remember(value: string) {
    this.secrets.push(value);
    try { for (const v of new URL(value).searchParams.values()) if (v) this.secrets.push(v); } catch { /* not a URL */ }
    return value;
  }
  private async request(url: string, init: RequestInit, signal: AbortSignal, allowAbsent = false): Promise<Record<string, any>> {
    let response: Response;
    try { response = await this.transport(url, { ...init, signal, redirect: 'error' }); }
    catch {
      throw new ProcessFailure(`${this.target.provider} API request ${signal.aborted ? 'timed out or was cancelled' : 'failed'}`, signal.aborted ? 'timeout' : 'error');
    }
    if (allowAbsent && [404, 410].includes(response.status)) return {};
    if (!response.ok) {
      if (!this.id && !this.stopUrl && [400, 401, 403, 422, 429].includes(response.status)) this.rejected = true;
      throw new ProcessFailure(`${this.target.provider} API returned HTTP ${response.status}`);
    }
    if (init.method === 'DELETE') return {};
    let text: string;
    try { text = await response.text(); } catch { throw new ProcessFailure(`${this.target.provider} response was interrupted`); }
    if (!text.trim()) return {};
    try {
      if (text.length > 100000) throw new Error();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data;
    } catch { throw new ProcessFailure(`${this.target.provider} returned an invalid session response`); }
  }
  async start(timeoutMs: number, signal?: AbortSignal) {
    const timed = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
    const abort = signal ? AbortSignal.any([signal, timed]) : timed;
    if (abort.aborted) throw new ProcessFailure('Execution cancelled', 'cancelled');
    this.creationStarted = true;
    const ttlMs = Math.max(60000, Math.min(660000, timeoutMs + 30000));
    if (this.target.provider === 'browserbase') {
      const data = await this.request('https://api.browserbase.com/v1/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': this.key },
        body: JSON.stringify({ ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}), region: this.target.region, proxies: false, keepAlive: false, timeout: Math.ceil(ttlMs / 1000), browserSettings: { recordSession: false, logSession: false, solveCaptchas: false, advancedStealth: false } }),
      }, abort);
      if (typeof data.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(data.id)) this.id = data.id;
      if (!this.id) throw new ProcessFailure('Browserbase returned no session ID; check the provider dashboard');
      this.connectUrl = this.checkUrl(data.connectUrl, 'wss:', 'browserbase.com');
    } else {
      const base = `https://production-${this.target.region ?? 'sfo'}.browserless.io`;
      const url = new URL('/session', base); url.searchParams.set('token', this.key);
      const data = await this.request(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: ttlMs, stealth: false, browser: 'chrome' }) }, abort);
      this.stopUrl = this.checkUrl(data.stop, 'https:', 'browserless.io');
      // Stop URLs can contain credentials; only the provider name is persisted.
      this.connectUrl = this.checkUrl(data.connect, 'wss:', 'browserless.io');
    }
    return this.connectUrl!;
  }
  private checkUrl(value: unknown, protocol: string, domain: string) {
    if (typeof value !== 'string') throw new ProcessFailure(`${this.target.provider} response is missing a session URL`);
    this.remember(value);
    let url: URL;
    try { url = new URL(value); } catch { throw new ProcessFailure('Invalid provider session URL'); }
    if (url.protocol !== protocol || !(url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || url.username || url.password) throw new ProcessFailure('Unexpected provider session URL');
    return value;
  }
  async close() {
    if (this.stopped || !this.creationStarted || this.rejected) return;
    if (!this.id && !this.stopUrl) throw new Error(`${this.target.provider}: session creation was not confirmed. Check the provider dashboard; the requested session lifetime is bounded.`);
    const signal = AbortSignal.timeout(12000);
    if (this.target.provider === 'browserbase') {
      const url = `https://api.browserbase.com/v1/sessions/${this.id}`;
      const headers = { 'Content-Type': 'application/json', 'X-BB-API-Key': this.key };
      const released = await this.request(url, { method: 'POST', headers, body: JSON.stringify({ status: 'REQUEST_RELEASE', ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}) }) }, signal);
      let data = released;
      for (let i = 0; i < 10; i++) {
        if (['COMPLETED', 'TIMED_OUT', 'ERROR'].includes(data.status)) { this.stopped = true; return; }
        data = await this.request(url, { headers }, signal);
        if (['COMPLETED', 'TIMED_OUT', 'ERROR'].includes(data.status)) { this.stopped = true; return; }
        await delay(250, undefined, { signal });
      }
      throw new Error('Browserbase session stop was not confirmed');
    }
    await this.request(this.stopUrl!, { method: 'DELETE' }, signal, true);
    this.stopped = true;
  }
}
