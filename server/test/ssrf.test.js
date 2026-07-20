import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpsUrl } from '../src/lib/ssrf.js';

test('rejects non-https URLs', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('http://example.com/hook'), /https/);
});

test('rejects loopback + private IP literals', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('https://127.0.0.1/x'), /private|disallowed/);
  await assert.rejects(() => assertPublicHttpsUrl('https://10.0.0.5/x'), /private|disallowed/);
  await assert.rejects(() => assertPublicHttpsUrl('https://192.168.1.1/x'), /private|disallowed/);
  await assert.rejects(() => assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data'), /private|disallowed/);
  await assert.rejects(() => assertPublicHttpsUrl('https://[::1]/x'), /private|disallowed/);
});

test('rejects localhost + .internal hostnames', async () => {
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/x'), /not allowed/);
  await assert.rejects(() => assertPublicHttpsUrl('https://foo.internal/x'), /not allowed/);
});

test('allows a public IP literal', async () => {
  const url = await assertPublicHttpsUrl('https://8.8.8.8/hook');
  assert.equal(url.hostname, '8.8.8.8');
});
