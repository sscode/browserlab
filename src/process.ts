import { spawn } from 'node:child_process';

export class ProcessFailure extends Error {
  constructor(message: string, public kind: 'error' | 'timeout' | 'cancelled' = 'error') { super(message); }
}
export interface ExecOptions { env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal; input?: string; cwd?: string }
export function execute(file: string, args: string[], options: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new ProcessFailure('Execution cancelled', 'cancelled')); return; }
    const child = spawn(file, args, { env: options.env, cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let out = '', err = '', failure: ProcessFailure | undefined;
    let force: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
    };
    const stop = (cause: ProcessFailure) => { if (failure) return; failure = cause; kill('SIGTERM'); force = setTimeout(() => kill('SIGKILL'), 300); };
    const timer = setTimeout(() => stop(new ProcessFailure('Execution time limit exceeded', 'timeout')), options.timeoutMs ?? 30000);
    const abort = () => stop(new ProcessFailure('Execution cancelled', 'cancelled'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const finish = () => { clearTimeout(timer); if (force) clearTimeout(force); options.signal?.removeEventListener('abort', abort); };
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 8_000_000) stop(new ProcessFailure('Command output exceeds the 8 MB limit')); });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-16000); });
    child.stdin.on('error', () => { /* exit event reports failure */ });
    child.on('error', e => { finish(); reject(new ProcessFailure(`${file}: ${e.message}`)); });
    child.on('close', code => {
      finish();
      if (failure) reject(failure);
      else if (code !== 0) reject(new ProcessFailure(err.trim() || out.trim() || `Command exited with code ${code}`));
      else resolve(out.trim());
    });
    child.stdin.end(options.input);
  });
}

export interface ProcessRow { pid: number; ppid: number; rss: number; cpuMs: number }
export function parseProcessRows(text: string): ProcessRow[] {
  return text.split('\n').flatMap(line => {
    const [pid, ppid, rss, time] = line.trim().split(/\s+/);
    if (!pid || !ppid || !rss || !time || !/^\d+$/.test(pid)) return [];
    const parts = time.split(/[-:]/).map(Number);
    let seconds = parts.pop() ?? 0;
    seconds += (parts.pop() ?? 0) * 60 + (parts.pop() ?? 0) * 3600 + (parts.pop() ?? 0) * 86400;
    return [{ pid: +pid, ppid: +ppid, rss: +rss, cpuMs: seconds * 1000 }];
  });
}
export function descendants(rows: ProcessRow[], root: number): ProcessRow[] {
  const pids = new Set([root]);
  for (let changed = true; changed;) { changed = false; for (const r of rows) if (pids.has(r.ppid) && !pids.has(r.pid)) { pids.add(r.pid); changed = true; } }
  return rows.filter(r => pids.has(r.pid));
}
export async function processRows() { return parseProcessRows(await execute('ps', ['-axo', 'pid=,ppid=,rss=,time='], { timeoutMs: 2000 })); }
export class Sampler {
  peakRssKb: number | null = null;
  cpuMs: number | null = null;
  private samples = new Map<number, number>();
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  constructor(private pid: number) {}
  private async sample() {
    try {
      const rows = descendants(await processRows(), this.pid);
      if (!rows.length) return;
      this.peakRssKb = Math.max(this.peakRssKb ?? 0, rows.reduce((n, r) => n + r.rss, 0));
      for (const row of rows) this.samples.set(row.pid, Math.max(this.samples.get(row.pid) ?? 0, row.cpuMs));
      this.cpuMs = [...this.samples.values()].reduce((a, b) => a + b, 0);
    } catch { /* unavailable is null, never zero */ }
  }
  start() {
    if (process.platform === 'win32') return;
    const tick = () => { this.pending = this.sample().finally(() => { if (this.timer) this.timer = setTimeout(tick, 150); }); };
    this.timer = setTimeout(tick, 0);
  }
  async stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; await this.pending; await this.sample(); }
}
