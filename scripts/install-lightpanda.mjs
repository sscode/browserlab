#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, chmod, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const version = process.argv[2] ?? '1.0.0';
const target = ({ darwin: { x64: 'x86_64-macos', arm64: 'aarch64-macos' }, linux: { x64: 'x86_64-linux', arm64: 'aarch64-linux' } })[process.platform]?.[process.arch];
if (!target) throw new Error('Lightpanda installation supports macOS and Linux on x64/arm64.');
const manifestResponse = await fetch('https://get.lightpanda.io/versions.json', { signal: AbortSignal.timeout(30000) });
if (!manifestResponse.ok) throw new Error(`Version manifest returned HTTP ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
const asset = manifest[version]?.[target];
if (!asset?.download_url || !/^[a-f0-9]{64}$/i.test(asset.shasum)) throw new Error(`No verified ${version} asset for ${target}`);
if (!asset.download_url.startsWith('https://')) throw new Error('Engine download must use HTTPS');
const destination = resolve(process.env.BROWSERLAB_LIGHTPANDA || join(homedir(), '.cache', 'lightpanda-node', 'lightpanda'));
const dir = dirname(destination);
const existing = await readFile(destination).catch(() => null);
if (existing && createHash('sha256').update(existing).digest('hex').toLowerCase() === asset.shasum.toLowerCase()) {
  await chmod(destination, 0o700);
  console.log(`Lightpanda ${version} is already installed. Publisher checksum verified.\n${destination}`);
  process.exit(0);
}
console.log(`Downloading Lightpanda ${version} for ${target}…`);
const response = await fetch(asset.download_url, { signal: AbortSignal.timeout(600000) });
if (!response.ok) throw new Error(`Engine download returned HTTP ${response.status}`);
if (!response.body) throw new Error('Engine download has no body');
await mkdir(dir, { recursive: true });
const temp = join(dir, `lightpanda.${process.pid}.tmp`);
const hash = createHash('sha256');
let received = 0, lastProgress = Date.now(), actual;
const meter = new Transform({ transform(chunk, _encoding, callback) {
  received += chunk.length;
  if (received > 512 * 1024 * 1024) return callback(new Error('Engine download exceeds 512 MiB'));
  hash.update(chunk);
  if (Date.now() - lastProgress > 5000) { console.log(`Received ${(received / 1024 / 1024).toFixed(1)} MiB…`); lastProgress = Date.now(); }
  callback(null, chunk);
} });
try {
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temp, { mode: 0o700, flags: 'wx' }));
  actual = hash.digest('hex');
  if (actual.toLowerCase() !== asset.shasum.toLowerCase()) throw new Error('Engine checksum mismatch; nothing installed');
  await chmod(temp, 0o700); await rename(temp, destination);
}
finally { await rm(temp, { force: true }); }
console.log(`Installed ${destination}\nSHA-256: ${actual}`);
