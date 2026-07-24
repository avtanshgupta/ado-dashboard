import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExport,
  parseImport,
  EXPORT_TYPE,
  EXPORT_VERSION,
  EXPORTABLE_KEYS,
} from '../src/lib/configPortability.js';

test('buildExport wraps only the editable keys, dropping identity/derived fields', () => {
  const cfg = {
    me: { id: 'u1', displayName: 'Ada' }, // identity — must NOT be exported
    organizationUrl: 'https://x', // derived/constant — must NOT be exported
    projects: [{ name: 'Alpha', id: 'a1' }],
    slaDays: 5,
    uiPrefs: { density: 'compact', timezone: 'UTC' },
  };
  const bundle = buildExport(cfg, new Date('2024-05-01T00:00:00Z'));
  assert.equal(bundle._type, EXPORT_TYPE);
  assert.equal(bundle._version, EXPORT_VERSION);
  assert.equal(bundle.exportedAt, '2024-05-01T00:00:00.000Z');
  assert.deepEqual(bundle.settings.projects, [{ name: 'Alpha', id: 'a1' }]);
  assert.equal(bundle.settings.slaDays, 5);
  assert.equal('me' in bundle.settings, false);
  assert.equal('organizationUrl' in bundle.settings, false);
});

test('buildExport → parseImport round-trips the editable settings', () => {
  const cfg = {};
  for (const k of EXPORTABLE_KEYS) cfg[k] = k === 'slaDays' ? 9 : [];
  cfg.uiPrefs = { density: 'compact' };
  const bundle = buildExport(cfg);
  const restored = parseImport(JSON.stringify(bundle));
  assert.equal(restored.slaDays, 9);
  assert.deepEqual(restored.uiPrefs, { density: 'compact' });
  assert.equal('me' in restored, false);
});

test('parseImport accepts a bare settings object and keeps only known keys', () => {
  const restored = parseImport(JSON.stringify({ slaDays: 3, bogusKey: 'x', team: ['a@b.com'] }));
  assert.deepEqual(restored, { slaDays: 3, team: ['a@b.com'] });
});

test('parseImport rejects invalid JSON', () => {
  assert.throws(() => parseImport('{not json'), /not valid JSON/);
});

test('parseImport rejects a wrapped bundle of the wrong type', () => {
  assert.throws(
    () => parseImport(JSON.stringify({ _type: 'something-else', settings: { slaDays: 1 } })),
    /Unrecognized settings file/
  );
});

test('parseImport rejects an object with no recognized settings', () => {
  assert.throws(() => parseImport(JSON.stringify({ nope: 1, alsoNope: 2 })), /No recognized settings/);
});

test('parseImport rejects arrays and null', () => {
  assert.throws(() => parseImport(JSON.stringify([1, 2, 3])), /Unrecognized settings file/);
  assert.throws(() => parseImport('null'), /Unrecognized settings file/);
});
