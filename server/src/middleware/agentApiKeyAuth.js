/**
 * API-key authentication for the reporter heartbeat.
 *
 * Unlike the browser routes (which use a session cookie + vaulted Azure token),
 * the heartbeat is called by a headless reporter on a VM that only has a per-user
 * API key. This middleware resolves that key to a userId and establishes a minimal
 * request context — no Azure token, since the heartbeat never calls Azure DevOps.
 */
import { runWithCtx } from '../lib/context.js';
import { resolveUserIdByApiKey } from '../lib/agentApiKeys.js';

function unauth(res, code, message) {
  return res.status(401).json({ error: message, status: 401, code });
}

export function agentApiKeyAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return unauth(res, 'no_api_key', 'Missing API key. Generate one in Settings → Agents and set it in reporter.json.');
  }
  const key = auth.slice(7).trim();
  const userId = resolveUserIdByApiKey(key);
  if (!userId) {
    return unauth(res, 'invalid_api_key', 'Invalid or revoked API key. Regenerate one in Settings → Agents.');
  }
  runWithCtx({ user: { id: userId } }, () => next());
}
