import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal sessionStorage polyfill so the browser cache module runs under node.
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.sessionStorage = new MemStorage();

const { cacheGet, cacheSet, cacheClear } = await import('../src/lib/dataCache.js');

beforeEach(() => cacheClear());

test('cacheGet returns undefined for a missing key', () => {
  assert.equal(cacheGet('nope'), undefined);
});

test('set then get round-trips data', () => {
  cacheSet('k1', [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(cacheGet('k1'), [{ id: 1 }, { id: 2 }]);
});

test('cacheClear wipes everything', () => {
  cacheSet('k2', { a: 1 });
  cacheClear();
  assert.equal(cacheGet('k2'), undefined);
});

test('empty/undefined keys are ignored safely', () => {
  cacheSet('', { x: 1 });
  assert.equal(cacheGet(''), undefined);
  assert.equal(cacheGet(), undefined);
});

test('data survives a fresh module load (persisted to storage)', async () => {
  cacheSet('persist-key', { hello: 'world' });
  // Re-import with a cache-busting query to force a new module instance; it must
  // rehydrate from the shared sessionStorage polyfill.
  const fresh = await import('../src/lib/dataCache.js?reload=1');
  assert.deepEqual(fresh.cacheGet('persist-key'), { hello: 'world' });
});
