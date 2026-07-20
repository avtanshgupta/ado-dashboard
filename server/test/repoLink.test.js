import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoUrl, orgFromUrl, orgBaseFromUrl } from '../src/lib/repoLink.js';

test('parses dev.azure.com repo URL', () => {
  assert.deepEqual(
    parseRepoUrl('https://dev.azure.com/microsoft/Windows%20Defender/_git/WD.Client.Linux'),
    { org: 'microsoft', project: 'Windows Defender', repo: 'WD.Client.Linux' }
  );
});

test('parses visualstudio.com repo URL', () => {
  assert.deepEqual(
    parseRepoUrl('https://microsoft.visualstudio.com/Windows%20Defender/_git/WD.Client.Linux'),
    { org: 'microsoft', project: 'Windows Defender', repo: 'WD.Client.Linux' }
  );
});

test('parses visualstudio.com URL with DefaultCollection', () => {
  assert.deepEqual(
    parseRepoUrl('https://microsoft.visualstudio.com/DefaultCollection/MyProj/_git/MyRepo'),
    { org: 'microsoft', project: 'MyProj', repo: 'MyRepo' }
  );
});

test('ignores query string and trailing path (e.g. deep link into a file)', () => {
  assert.deepEqual(
    parseRepoUrl('https://dev.azure.com/microsoft/Proj/_git/Repo?path=/src/x.c&version=GBmain'),
    { org: 'microsoft', project: 'Proj', repo: 'Repo' }
  );
});

test('parses clone URL with embedded user', () => {
  assert.deepEqual(
    parseRepoUrl('https://microsoft@dev.azure.com/microsoft/Proj/_git/Repo'),
    { org: 'microsoft', project: 'Proj', repo: 'Repo' }
  );
});

test('parses SSH clone URL', () => {
  assert.deepEqual(
    parseRepoUrl('git@ssh.dev.azure.com:v3/microsoft/Proj/Repo'),
    { org: 'microsoft', project: 'Proj', repo: 'Repo' }
  );
});

test('strips a trailing .git suffix', () => {
  assert.deepEqual(
    parseRepoUrl('https://dev.azure.com/microsoft/Proj/_git/Repo.git'),
    { org: 'microsoft', project: 'Proj', repo: 'Repo' }
  );
});

test('returns null for non-repo URLs and junk', () => {
  assert.equal(parseRepoUrl('https://dev.azure.com/microsoft/Proj/_build?definitionId=1'), null);
  assert.equal(parseRepoUrl('https://example.com/foo/_git/bar'), null);
  assert.equal(parseRepoUrl('not a url'), null);
  assert.equal(parseRepoUrl(''), null);
  assert.equal(parseRepoUrl(null), null);
});

test('orgFromUrl extracts the org from both host styles', () => {
  assert.equal(orgFromUrl('https://microsoft.visualstudio.com'), 'microsoft');
  assert.equal(orgFromUrl('https://dev.azure.com/microsoft'), 'microsoft');
  assert.equal(orgFromUrl('https://dev.azure.com/Contoso/'), 'contoso');
  assert.equal(orgFromUrl('garbage'), '');
});

test('orgBaseFromUrl returns the org base URL for both host styles', () => {
  assert.equal(orgBaseFromUrl('https://microsoft.visualstudio.com/Windows%20Defender'), 'https://microsoft.visualstudio.com');
  assert.equal(orgBaseFromUrl('https://dev.azure.com/MSecProductSecurity/AI%20Vuln%20Scanning/_git/repo'), 'https://dev.azure.com/MSecProductSecurity');
  assert.equal(orgBaseFromUrl('https://dev.azure.com/MSecProductSecurity'), 'https://dev.azure.com/MSecProductSecurity');
  assert.equal(orgBaseFromUrl('https://example.com/x'), null);
  assert.equal(orgBaseFromUrl('not a url'), null);
});
