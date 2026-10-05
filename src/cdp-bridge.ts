import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { ProcessFailure } from './process.js';

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };

/** One authenticated upstream connection, kept alive until explicit stop.
 * The adapter receives only a random, loopback capability URL. Provider credentials
 * stay in this process. A new downstream connection never creates a new browser.
 */
export class CdpBridge {
  private upstream?: WebSocket;
  private server?: Server;
  private sockets?: WebSocketServer;
  private downstream?: WebSocket;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private forwarded = new Map<number, number>();
  private lifetime?: ReturnType<typeof setTimeout>;
  private ended = false;
  connected = false;
  closeConfirmed = false;
  url?: string;
  async create(endpoint: string, headers: Record<string, string>, timeoutMs: number, lifetimeMs: number, signal?: AbortSignal) {
    const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    if (abort.aborted) throw new ProcessFailure('Execution cancelled', 'cancelled');
    const upstream = this.upstream = new WebSocket(endpoint, { headers, followRedirects: false, handshakeTimeout: timeoutMs, maxPayload: 16 * 1024 * 1024 });
    upstream.on('error', () => this.failPending());
    upstream.on('close', () => { this.failPending(); this.downstream?.close(); });
    upstream.on('message', data => {
      let message: Record<string, any>;
      try { message = JSON.parse(data.toString()); } catch { this.failPending(); upstream.terminate(); return; }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error('Provider rejected CDP command'));
          else pending.resolve(message.result ?? {});
          return;
        }
        const original = this.forwarded.get(message.id);
        if (original === undefined) return;
        this.forwarded.delete(message.id); message.id = original;
      }
      if (this.downstream?.readyState === WebSocket.OPEN) this.downstream.send(JSON.stringify(message));
    });
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { upstream.terminate(); finish(new ProcessFailure('Provider connection timed out or was cancelled', signal?.aborted ? 'cancelled' : 'timeout')); };
      const fail = () => finish(new ProcessFailure('Provider WebSocket connection failed'));
      const ready = () => { this.connected = true; finish(); };
      const finish = (error?: Error) => {
        abort.removeEventListener('abort', cancel); upstream.off('open', ready); upstream.off('error', fail); upstream.off('close', fail);
        if (error) reject(error); else resolve();
      };
      upstream.once('open', ready); upstream.once('error', fail); upstream.once('close', fail); abort.addEventListener('abort', cancel, { once: true });
      if (abort.aborted) cancel();
    });
    const token = randomBytes(32).toString('hex');
    const server = this.server = createServer((_req, res) => { res.writeHead(404); res.end(); });
    const sockets = this.sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== `/${token}` || req.headers.origin || this.downstream || this.ended || upstream.readyState !== WebSocket.OPEN) { socket.destroy(); return; }
      sockets.handleUpgrade(req, socket, head, client => {
        this.downstream = client;
        client.on('error', () => client.terminate());
        client.on('close', () => { if (this.downstream === client) this.downstream = undefined; this.forwarded.clear(); });
        client.on('message', data => {
          try {
            const message = JSON.parse(data.toString());
            if (!Number.isSafeInteger(message.id) || typeof message.method !== 'string' || this.forwarded.size > 10000) throw new Error();
            const id = ++this.sequence; this.forwarded.set(id, message.id); message.id = id;
            if (upstream.readyState !== WebSocket.OPEN) throw new Error();
            upstream.send(JSON.stringify(message));
          } catch { client.close(1008, 'Invalid CDP request'); }
        });
      });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    server.on('error', () => this.failPending());
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot bind private CDP bridge');
    this.url = `ws://127.0.0.1:${address.port}/${token}`;
    this.lifetime = setTimeout(() => { void this.stop().catch(() => {}); }, lifetimeMs).unref();
  }
  async command(method: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    if (this.upstream?.readyState !== WebSocket.OPEN) throw new Error('Provider CDP connection is not open');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Provider CDP command timed out')); }, timeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.upstream!.send(JSON.stringify({ id, method }));
    });
  }
  async inspect() {
    const data = await this.command('Browser.getVersion');
    return { state: 'active' as const, browserVersion: typeof data.product === 'string' ? data.product : undefined };
  }
  async stop() {
    if (this.ended) { if (!this.closeConfirmed) throw new Error('Provider CDP stop was not confirmed'); return; }
    this.ended = true;
    try {
      if (!this.connected) throw new Error('Provider connection outcome is unknown; check the provider dashboard');
      await this.command('Browser.close'); this.closeConfirmed = true;
    } finally {
      clearTimeout(this.lifetime); this.failPending();
      for (const client of this.sockets?.clients ?? []) client.terminate();
      this.upstream?.terminate(); this.sockets?.close();
      if (this.server?.listening) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    }
  }
  private failPending() {
    for (const pending of this.pending.values()) pending.reject(new Error('Provider CDP connection closed before confirmation'));
    this.pending.clear();
  }
}
