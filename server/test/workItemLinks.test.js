import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFromAdoUrl, parseQueryRef } from '../src/lib/workItemLinks.js';

test('projectFromAdoUrl: dev.azure.com and visualstudio.com', () => {
  assert.equal(projectFromAdoUrl('https://dev.azure.com/fabrikam/Northwind/_queries'), 'Northwind');
  assert.equal(projectFromAdoUrl('https://microsoft.visualstudio.com/Windows%20Defender/_workitems'), 'Windows Defender');
  assert.equal(projectFromAdoUrl('https://microsoft.visualstudio.com/DefaultCollection/WD/_queries'), 'WD');
  assert.equal(projectFromAdoUrl('https://example.com/x'), null);
  assert.equal(projectFromAdoUrl('not a url'), null);
});

test('parseQueryRef: bare GUID', () => {
  assert.deepEqual(parseQueryRef('a1b2c3d4-1111-2222-3333-444455556666'), { guid: 'a1b2c3d4-1111-2222-3333-444455556666', project: null, org: null });
});

test('parseQueryRef: query URL with project', () => {
  const r = parseQueryRef('https://microsoft.visualstudio.com/Windows%20Defender/_queries/query/A1B2C3D4-1111-2222-3333-444455556666/');
  assert.equal(r.guid, 'a1b2c3d4-1111-2222-3333-444455556666');
  assert.equal(r.project, 'Windows Defender');
  assert.equal(r.org, 'https://microsoft.visualstudio.com');
});

test('parseQueryRef: query-edit URL (dev.azure.com)', () => {
  const r = parseQueryRef('https://dev.azure.com/fabrikam/Northwind/_queries/query-edit/a1b2c3d4-1111-2222-3333-444455556666');
  assert.equal(r.guid, 'a1b2c3d4-1111-2222-3333-444455556666');
  assert.equal(r.project, 'Northwind');
  assert.equal(r.org, 'https://dev.azure.com/fabrikam');
});

test('parseQueryRef: cross-org MSecProductSecurity query URL (the reported failure)', () => {
  const r = parseQueryRef('https://dev.azure.com/MSecProductSecurity/AI%20Vuln%20Scanning/_queries/query/e7a2744b-1b26-4f3d-96d5-a48436dad015/');
  assert.equal(r.guid, 'e7a2744b-1b26-4f3d-96d5-a48436dad015');
  assert.equal(r.project, 'AI Vuln Scanning');
  assert.equal(r.org, 'https://dev.azure.com/MSecProductSecurity');
});

test('parseQueryRef: rejects non-query input', () => {
  assert.equal(parseQueryRef('https://microsoft.visualstudio.com/WD/_queries'), null); // no guid
  assert.equal(parseQueryRef('just text'), null);
  assert.equal(parseQueryRef(''), null);
});
