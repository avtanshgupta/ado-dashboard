import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);
let azCache = null;
let azGraphCache = null;

/** Fetch a fresh Azure DevOps bearer token from the host's `az` CLI. */
export async function getAzToken(force = false) {
  const skewMs = 5 * 60 * 1000;
  if (!force && azCache && azCache.expiresAt - skewMs > Date.now()) return azCache.token;
  const { stdout } = await execFileAsync(
    'az',
    ['account', 'get-access-token', '--resource', config.adoResourceId, '-o', 'json'],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout);
  let expiresAt;
  if (data.expires_on) expiresAt = Number(data.expires_on) * 1000;
  else if (data.expiresOn) expiresAt = new Date(data.expiresOn.replace(' ', 'T')).getTime();
  else expiresAt = Date.now() + 50 * 60 * 1000;
  azCache = { token: data.accessToken, expiresAt };
  return data.accessToken;
}

/** Fetch a Microsoft Graph bearer token from the host's `az` CLI (for To Do). */
export async function getAzGraphToken(force = false) {
  const skewMs = 5 * 60 * 1000;
  if (!force && azGraphCache && azGraphCache.expiresAt - skewMs > Date.now()) return azGraphCache.token;
  try {
    const { stdout } = await execFileAsync(
      'az',
      ['account', 'get-access-token', '--resource', 'https://graph.microsoft.com', '-o', 'json'],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);
    let expiresAt;
    if (data.expires_on) expiresAt = Number(data.expires_on) * 1000;
    else if (data.expiresOn) expiresAt = new Date(data.expiresOn.replace(' ', 'T')).getTime();
    else expiresAt = Date.now() + 50 * 60 * 1000;
    azGraphCache = { token: data.accessToken, expiresAt };
    return data.accessToken;
  } catch {
    // Graph token is optional — return null if az CLI can't get one.
    return null;
  }
}
