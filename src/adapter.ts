import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execute, ProcessFailure, processRows, descendants } from './process.js';
import type { Engine, Json, Step, Target } from './types.js';

import { RemoteSession } from './providers.js';

const require = createRequire(import.meta.url);
export function binaryPath(): string {
  if (process.env.BROWSERLAB_AGENT_BROWSER) return resolve(process.env.BROWSERLAB_AGENT_BROWSER);
  const pkg = require.resolve('agent-browser/package.json');
  // Use the package launcher so Linux musl detection stays with the upstream tool.
  return join(dirname(pkg), 'bin', 'agent-browser.js');
}
function invocation(args: string[]): [string, string[]] {
  const path = binaryPath();
  return path.endsWith('.js') ? [process.execPath, [path, ...args]] : [path, args];
}
export function cleanEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LOCALAPPDATA', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'LANG']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  result.NO_COLOR = '1'; result.LIGHTPANDA_DISABLE_TELEMETRY = 'true';
  return result;
}
export async function adapterVersion() {
  return execute(...invocation(['--version']), { timeoutMs: 5000, env: cleanEnvironment() });
}
export class AgentBrowser {
  readonly env = cleanEnvironment();
  private pid?: number;
  private remote?: RemoteSession;
  private temporaryConfig?: string;
  private commandStarted = false;
  readonly target: Target;
  readonly engine: Engine;
  constructor(target: Target | Engine, readonly session: string, private config: string) {
    this.target = typeof target === 'string' ? { id: target, provider: 'local', engine: target } : target;
    this.engine = this.target.engine;
    if (this.target.provider !== 'local') this.remote = new RemoteSession(this.target);
  }
  get secrets() { return this.remote?.secrets ?? []; }
  get remoteSessionId() { return this.remote?.id; }
  private executable() {
    const cached = join(homedir(), '.cache', 'lightpanda-node', 'lightpanda');
    if (this.target.provider !== 'local') return undefined;
    const specified = process.env[this.engine === 'chrome' ? 'BROWSERLAB_CHROME' : 'BROWSERLAB_LIGHTPANDA'];
    if (specified) return resolve(specified);
    if (this.engine === 'lightpanda') {
      for (const path of [cached, join(homedir(), '.lightpanda', 'lightpanda'), join(homedir(), '.local', 'bin', 'lightpanda')]) if (existsSync(path)) return path;
    }
    return undefined;
  }
  private flags() {
    const flags = ['--namespace', 'browserlab', '--session', this.session, '--engine', this.engine, '--config', this.config, '--json', '--no-webmcp', '--idle-timeout', '30s'];
    const executable = this.executable();
    if (executable) flags.push('--executable-path', resolve(executable));
    return flags;
  }
  async command(args: string[], timeoutMs = 30000, signal?: AbortSignal, input?: string): Promise<Record<string, unknown>> {
    // Keep launch settings identical across commands. Changing the upstream timeout
    // environment causes agent-browser to relaunch the browser and discard the page.
    this.env.AGENT_BROWSER_DEFAULT_TIMEOUT = '25000';
    this.commandStarted = true;
    const stdout = await execute(...invocation([...this.flags(), ...args]), { env: this.env, timeoutMs, signal, input });
    let response: { success: boolean; data?: Record<string, unknown>; error?: unknown };
    try { response = JSON.parse(stdout); } catch { throw new ProcessFailure('agent-browser returned invalid JSON'); }
    if (Array.isArray(response)) {
      if (!response.length || response.some(r => r.success !== true)) throw new ProcessFailure('A batch command failed');
      return { results: response };
    }
    if (response.success !== true) throw new ProcessFailure(typeof response.error === 'string' ? response.error : JSON.stringify(response.error ?? 'Browser command failed'));
    return response.data ?? {};
  }
  async start(timeout: number, signal?: AbortSignal) {
    const started = performance.now();
    if (this.remote) {
      const cdp = await this.remote.start(timeout, signal);
      this.temporaryConfig = await mkdtemp(join(tmpdir(), 'browserlab-remote-'));
      this.config = join(this.temporaryConfig, 'config.json');
      await writeFile(this.config, JSON.stringify({ cdp }), { mode: 0o600 });
    }
    await this.command(['open', 'about:blank'], Math.max(1, timeout - (performance.now() - started)), signal);
    const info = await this.command(['session', 'info'], 3000, signal);
    if (typeof info.pid === 'number' && info.namespace === 'browserlab' && info.session === this.session) this.pid = info.pid;
    return this.pid;
  }
  async version() {
    if (this.engine === 'lightpanda') {
      // Lightpanda's CDP Browser.getVersion advertises a Chrome compatibility
      // version. Read the engine binary itself instead of mislabelling that value.
      try { return `Lightpanda ${await execute(this.executable() ?? 'lightpanda', ['version'], { env: this.env, timeoutMs: 2000 })}`; }
      catch { const data = await this.command(['eval', 'navigator.userAgent'], 2000); return typeof data.result === 'string' ? `User agent only: ${data.result}` : null; }
    }
    try {
      const data = await this.command(['get', 'cdp-url'], 2000);
      if (typeof data.cdpUrl === 'string') {
        const version = await new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(data.cdpUrl as string);
          const timer = setTimeout(() => { socket.close(); reject(new Error('Version lookup timed out')); }, 1500);
          socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })));
          socket.addEventListener('message', event => {
            try {
              const message = JSON.parse(String(event.data));
              if (message.id !== 1) return;
              clearTimeout(timer); socket.close();
              if (typeof message.result?.product === 'string') resolve(`${message.result.product}${message.result.revision ? ` (${message.result.revision})` : ''}`);
              else reject(new Error('Version lookup unsupported'));
            } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
          });
          socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); reject(new Error('Version connection failed')); });
        });
        return version;
      }
    } catch { /* Some engines expose only a user-agent version. */ }
    const data = await this.command(['eval', 'navigator.userAgent'], 3000);
    return typeof data.result === 'string' ? `User agent only: ${data.result}` : null;
  }
  async step(step: Step, timeout: number, signal: AbortSignal | undefined, artifacts: string): Promise<Json | undefined> {
    switch (step.action) {
      case 'open': await this.command(['open', step.url], timeout, signal); break;
      case 'click': await this.command(['click', step.selector], timeout, signal); break;
      case 'fill': {
        const value = step.env ? process.env[step.env] : step.value;
        if (value === undefined) throw new ProcessFailure(`Missing environment variable ${step.env}`);
        // stdin keeps credential values out of command-line process listings.
        const result = await this.command(['batch', '--bail'], timeout, signal, JSON.stringify([['fill', step.selector, value]]));
        if (result.failed || (Array.isArray(result.results) && result.results.some((r: any) => r.success === false))) throw new ProcessFailure('Fill command failed');
        break;
      }
      case 'wait': {
        // Presence is portable. A layout/visibility wait would make Lightpanda incomparable.
        const js = `Boolean(document.querySelector(${JSON.stringify(step.selector)}))`;
        const end = performance.now() + timeout;
        while (true) {
          const remaining = Math.floor(end - performance.now());
          if (remaining <= 0) throw new ProcessFailure('Wait time limit exceeded', 'timeout');
          const data = await this.command(['eval', js], remaining, signal);
          if (data.result === true) break;
          try { await delay(Math.min(75, Math.max(1, end - performance.now())), undefined, { signal }); }
          catch { throw new ProcessFailure('Execution cancelled', 'cancelled'); }
        }
        break;
      }
      case 'extract': {
        const data = await this.command(['eval', extractionScript(step)], timeout, signal);
        if (!Object.hasOwn(data, 'result')) throw new ProcessFailure('Extraction returned no result');
        return data.result as Json;
      }
      case 'screenshot': {
        await mkdir(artifacts, { recursive: true });
        await this.command(['screenshot', join(artifacts, step.name)], timeout, signal); break;
      }
    }
  }
  async close(): Promise<'graceful' | 'forced' | 'provider-confirmed'> {
    let method: 'graceful' | 'forced' = 'graceful';
    const errors: string[] = [];
    try { if (this.commandStarted) method = await this.closeLocal(); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    try { await this.remote?.close(); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    finally { if (this.temporaryConfig) await rm(this.temporaryConfig, { recursive: true, force: true }); }
    if (errors.length) throw new Error(errors.join('; '));
    return this.remote ? 'provider-confirmed' : method;
  }
  private async closeLocal(): Promise<'graceful' | 'forced'> {
    // Capture only this session's process tree before a potentially blocked close.
    if (!this.pid) {
      try { const info = await this.command(['session', 'info'], 2000); if (info.namespace === 'browserlab' && info.session === this.session && typeof info.pid === 'number') this.pid = info.pid; } catch { /* startup may have failed */ }
    }
    const rows = this.pid ? await processRows().catch(() => []) : [];
    const owned = this.pid ? descendants(rows, this.pid) : [];
    try { await this.command(['close'], 5000); return 'graceful'; }
    catch (error) {
      if (process.platform !== 'win32') {
        for (const row of owned.reverse()) { try { process.kill(row.pid, 'SIGKILL'); } catch { /* already gone */ } }
        await delay(100);
        const alive = await processRows().catch(() => null);
        if (owned.length && alive && !alive.some(row => owned.some(p => p.pid === row.pid) && row.rss > 0)) return 'forced';
      }
      throw new Error(`Session cleanup failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
export function extractionScript(step: Extract<Step, { action: 'extract' }>): string {
  // Only our fixed projection runs in the page. Selector/field input is encoded as data.
  return `(() => {
    const spec = ${JSON.stringify(step)};
    const rows = Array.from(document.querySelectorAll(spec.selector));
    const read = (el, field) => {
      if (!el) return null;
      if (field.kind === 'attribute') return el.getAttribute(field.attribute);
      if (field.kind === 'value') return el.value === undefined ? null : String(el.value);
      return (el.textContent || '').trim();
    };
    if (spec.kind === 'count') return rows.length;
    if (spec.kind === 'texts') return rows.map(el => read(el, {}));
    if (spec.kind === 'table') return rows.map(row => Object.fromEntries(Object.entries(spec.fields).map(([name, field]) => [name, read(field.selector ? row.querySelector(field.selector) : row, field)])));
    return read(rows[0], spec);
  })()`;
}
export async function createConfig(dir: string) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'agent-browser.json');
  await writeFile(path, '{}\n', { mode: 0o600 });
  return path;
}
export async function checkInstall() {
  const version = await adapterVersion();
  const pkg = JSON.parse(await readFile(require.resolve('agent-browser/package.json'), 'utf8'));
  return { version, pinned: pkg.version };
}
