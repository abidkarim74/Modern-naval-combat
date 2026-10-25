import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const publicFile = path => new URL(`../public/${path}`, import.meta.url);

test('home-screen metadata references valid PNG icons at installable sizes', async () => {
  const manifest = JSON.parse(await readFile(publicFile('manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  assert.ok(manifest.name && manifest.short_name);
  for (const size of ['192x192', '512x512']) {
    assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.purpose === 'any'));
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = await readFile(publicFile(icon.src.slice(1)));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon.png"/);
});

async function workerFixture() {
  const handlers = new Map();
  const offline = new Response('<h1>Connect to play</h1>', { headers: { 'Content-Type': 'text/html' } });
  const stored = new Map();
  const deleted = [];
  const networkRequests = [];
  let networkResponse = new Response('Current game');
  let networkError = null;
  vm.runInNewContext(await readFile(publicFile('sw.js'), 'utf8'), {
    self: { location: { origin: 'https://naval.test' }, addEventListener: (type, listener) => handlers.set(type, listener) },
    URL, Response,
    caches: {
      open: async () => ({ add: async path => stored.set(path, offline), match: async path => stored.get(path) }),
      keys: async () => ['naval-combat-offline-v0', 'naval-combat-offline-v1', 'other-app-cache'],
      delete: async name => { deleted.push(name); return true; },
    },
    fetch: async request => { networkRequests.push(request); if (networkError) throw networkError; return networkResponse; },
  });
  return {
    offline, stored, deleted, networkRequests,
    offlineNetwork() { networkError = new Error('Network offline'); },
    respond(response) { networkResponse = response; },
    async lifecycle(type) {
      let work;
      handlers.get(type)({ waitUntil: promise => { work = promise; } });
      await work;
    },
    request(overrides = {}) {
      let response;
      handlers.get('fetch')({
        request: { url: 'https://naval.test/', method: 'GET', mode: 'navigate', ...overrides },
        respondWith: promise => { response = promise; },
      });
      return response;
    },
  };
}

test('service worker caches only the connection screen and cleans up only its own old caches', async () => {
  const worker = await workerFixture();
  await worker.lifecycle('install');
  assert.deepEqual([...worker.stored.keys()], ['/offline.html']);
  await worker.lifecycle('activate');
  assert.deepEqual(worker.deleted, ['naval-combat-offline-v0']);
});

test('navigations get current network responses, with an offline screen only when the network fails', async () => {
  const worker = await workerFixture();
  await worker.lifecycle('install');
  assert.equal(await (await worker.request()).text(), 'Current game');
  const unavailable = new Response('Maintenance', { status: 503 });
  worker.respond(unavailable);
  assert.strictEqual(await worker.request(), unavailable, 'server error responses should pass through');
  worker.offlineNetwork();
  assert.strictEqual(await worker.request(), worker.offline);
});

test('game bundles, audio, API requests and other origins bypass the service worker', async () => {
  const worker = await workerFixture();
  for (const request of [
    { url: 'https://naval.test/assets/game.js', mode: 'cors' },
    { url: 'https://naval.test/audio/herring-gull-flight-calls.wav', mode: 'no-cors' },
    { url: 'https://naval.test/health', mode: 'cors' },
    { url: 'https://another.test/', mode: 'navigate' },
    { method: 'POST' },
  ]) assert.equal(worker.request(request), undefined);
  assert.equal(worker.networkRequests.length, 0);
});
