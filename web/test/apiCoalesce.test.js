import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill sessionStorage so the imported browser modules load under node.
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.sessionStorage = new MemStorage();

const { api } = await import('../src/lib/api.js');

function fakeRes(bodyObj, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(bodyObj);
  return { ok, status, statusText: 'OK', headers: { get: () => null }, text: async () => text };
}

let calls;
beforeEach(() => {
  calls = [];
});

test('concurrent identical GETs share a single network round-trip', async () => {
  let resolveFetch;
  globalThis.fetch = (url, init) => {
    calls.push(init.method);
    return new Promise((r) => { resolveFetch = () => r(fakeRes({ authenticated: false })); });
  };
  const p1 = api.me();
  const p2 = api.me(); // same path, in flight → must reuse p1's promise
  resolveFetch();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 1); // coalesced into one fetch
  assert.deepEqual(a, { authenticated: false });
  assert.deepEqual(b, { authenticated: false });
});

test('a GET issued after the previous one settles is not coalesced', async () => {
  globalThis.fetch = (url, init) => {
    calls.push(init.method);
    return Promise.resolve(fakeRes({ x: 1 }));
  };
  await api.me();
  await api.me();
  assert.equal(calls.length, 2); // fresh call each time; coalescing is only for in-flight
});

test('mutations are never coalesced', async () => {
  globalThis.fetch = (url, init) => {
    calls.push(init.method);
    return Promise.resolve(fakeRes({ ok: true }));
  };
  await Promise.all([api.logout(), api.logout()]); // two concurrent POSTs
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ['POST', 'POST']);
});
