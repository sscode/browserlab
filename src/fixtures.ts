import { createServer } from 'node:http';
import type { LegacySuite, TestCase, Step, Assertion } from './types.js';

export async function startFixtures() {
  let regression = false;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/api/items') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ name: 'Remote sensor', price: '49.00' }])); return; }
    if (req.url === '/next') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><h1>Second page</h1><p id="result">Navigation complete</p></body></html>'); return; }
    if (req.url !== '/') { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BrowserLab controlled catalog</title></head><body>
      <h1>${regression ? 'Unexpected catalog heading' : 'Field equipment'}</h1><p id="unicode">Café · 東京 · 🚲</p>
      <p id="escaped">A &amp; B &lt;safe&gt; "quoted"</p><p id="empty"></p>
      <ul id="catalog">
        <li class="product" data-id="p1"><span class="name">Trail camera</span><span class="price">129.00</span><span class="stock">In stock</span><a href="/next">Details</a></li>
        <li class="product" data-id="p2"><span class="name">Field recorder</span><span class="price">89.00</span><span class="stock">Out of stock</span><a href="/next">Details</a></li>
        <li class="product" data-id="p3"><span class="name">Weather meter</span><span class="price">59.00</span><span class="stock">In stock</span><a href="/next">Details</a></li>
      </ul>
      <label for="query">Search</label><input id="query" value="initial"><button id="search">Search</button><p id="search-result"></p>
      <button id="load">Load more</button><div id="remote"></div><a id="next" href="/next">Next page</a>
      <ul id="duplicates"><li data-id="same">One</li><li data-id="same">Two</li></ul>
      <script>
      document.querySelector('#search').addEventListener('click', () => { document.querySelector('#search-result').textContent = document.querySelector('#query').value; });
      document.querySelector('#load').addEventListener('click', async () => { const rows = await (await fetch('/api/items')).json(); document.querySelector('#remote').textContent = rows[0].name; document.querySelector('#remote').setAttribute('data-ready', 'yes'); });
      setTimeout(() => { const p = document.createElement('p'); p.id = 'delayed'; p.textContent = 'Ready'; document.body.appendChild(p); }, 150);
      </script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a port');
  return { url: `http://127.0.0.1:${address.port}`, setRegression: (value: boolean) => { regression = value; }, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

export function demoSuite(baseUrl: string, repetitions = 3): LegacySuite {
  const tests: TestCase[] = [];
  const add = (id: string, name: string, steps: Step[], assertions: Assertion[], extra: Partial<TestCase> = {}) => tests.push({ id, name, steps: [{ action: 'open', url: baseUrl }, ...steps], assertions, ...extra });
  const text = (selector: string, as = 'value'): Step => ({ action: 'extract', as, selector, kind: 'text' });
  const eq = (value: string | number | string[], path = '/value'): Assertion => ({ path, op: 'equals', value });
  add('heading', 'Read the page heading', [text('h1')], [eq('Field equipment')]);
  add('count', 'Count all product records', [{ action: 'extract', as: 'value', selector: '.product', kind: 'count' }], [eq(3)]);
  add('names', 'Read product names in order', [{ action: 'extract', as: 'value', selector: '.name', kind: 'texts' }], [eq(['Trail camera', 'Field recorder', 'Weather meter'])]);
  const table: Step = { action: 'extract', as: 'products', selector: '.product', kind: 'table', fields: { id: { kind: 'attribute', attribute: 'data-id' }, name: { selector: '.name' }, price: { selector: '.price' } } };
  add('table', 'Extract complete product records', [table], [{ path: '/products', op: 'count', value: 3 }, { path: '/products', op: 'every', field: '/price', rule: { op: 'required' } }]);
  add('unique', 'Require unique product identifiers', [table], [{ path: '/products', op: 'unique', field: '/id' }]);
  add('attribute', 'Read a link attribute', [{ action: 'extract', as: 'value', selector: '#next', kind: 'attribute', attribute: 'href' }], [eq('/next')]);
  add('input', 'Read an input value', [{ action: 'extract', as: 'value', selector: '#query', kind: 'value' }], [eq('initial')]);
  add('fill', 'Fill and read a search field', [{ action: 'fill', selector: '#query', value: 'weather' }, { action: 'extract', as: 'value', selector: '#query', kind: 'value' }], [eq('weather')]);
  add('click', 'Submit a local search', [{ action: 'fill', selector: '#query', value: 'camera' }, { action: 'click', selector: '#search' }, text('#search-result')], [eq('camera')]);
  add('dynamic', 'Wait for delayed page content', [{ action: 'wait', selector: '#delayed' }, text('#delayed')], [eq('Ready')]);
  add('fetch', 'Read content from a local API', [{ action: 'click', selector: '#load' }, { action: 'wait', selector: '[data-ready="yes"]' }, text('#remote')], [eq('Remote sensor')]);
  add('navigation', 'Follow a link to a second page', [{ action: 'click', selector: '#next' }, { action: 'wait', selector: '#result' }, text('h1')], [eq('Second page')]);
  add('unicode', 'Preserve Unicode content', [text('#unicode')], [eq('Café · 東京 · 🚲')]);
  add('escaping', 'Preserve punctuation and markup text', [text('#escaped')], [eq('A & B <safe> "quoted"')]);
  add('wrong-value', 'Detect an incorrect expected value', [text('h1')], [eq('Wrong heading')], { expectedStatus: 'fail' });
  add('missing-field', 'Detect a missing required field', [text('#missing')], [{ path: '/value', op: 'required' }], { expectedStatus: 'fail' });
  add('duplicates', 'Detect duplicate record identifiers', [{ action: 'extract', as: 'value', selector: '#duplicates li', kind: 'table', fields: { id: { kind: 'attribute', attribute: 'data-id' } } }], [{ path: '/value', op: 'unique', field: '/id' }], { expectedStatus: 'fail' });
  add('empty-result', 'Reject an empty extraction', [{ action: 'extract', as: 'value', selector: '.missing', kind: 'texts' }], [{ path: '/value', op: 'every', rule: { op: 'required' } }], { expectedStatus: 'fail' });
  add('invalid-selector', 'Report an invalid selector as an error', [text('[')], [], { expectedStatus: 'error' });
  add('timeout', 'Stop a wait at the trial time limit', [{ action: 'wait', selector: '#never-appears' }], [], { expectedStatus: 'timeout', timeoutMs: 3000 });
  return { version: 1, name: 'Controlled browser compatibility suite', engines: ['chrome', 'lightpanda'], repetitions, timeoutMs: 15000, tests };
}
