import { getCtx, runWithCtx } from '../lib/context.js';
import { effectiveConfig } from '../lib/userConfig.js';
import { poll } from './notificationsService.js';

// How often the server re-polls ADO for changes per connected client. poll() is
// heavy (it enriches all tracked lists), so keep this gentle — it still beats the
// old 120s client interval and updates arrive without a manual refresh.
const POLL_MS = 60000;
const HEARTBEAT_MS = 25000; // keep proxies (Azure App Service) from closing idle streams

/**
 * Server-Sent Events endpoint (C1): pushes new notifications to the browser so
 * the bell + views update live. The request already ran through sessionContext,
 * so we capture that per-request store and re-enter it on every timer tick
 * (AsyncLocalStorage doesn't survive across setInterval boundaries on its own).
 */
export function sseHandler(req, res) {
  const store = getCtx();
  if (!store) {
    res.status(401).json({ error: 'Not authenticated', status: 401, code: 'no_session' });
    return;
  }

  let closed = false;
  let ticking = false;
  let heartbeat = null;
  let poller = null;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (poller) clearInterval(poller);
    try { res.end(); } catch { /* already closed */ }
  }

  // Never write after the client has gone away (avoids ERR_STREAM_WRITE_AFTER_END,
  // which would otherwise surface as an unhandled error).
  const send = (event, data) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  res.write('retry: 5000\n\n');
  send('hello', { ok: true, at: new Date().toISOString() });

  const tick = async () => {
    if (closed || ticking) return; // single-flight: never overlap a slow poll
    ticking = true;
    try {
      // Rebuild the user's config each tick so setting changes (repos, prefs,
      // muted repos, webhooks) take effect without reconnecting the stream.
      const freshStore = { ...store, userConfig: effectiveConfig(store.user) };
      const result = await runWithCtx(freshStore, () => poll());
      // The client may have disconnected while poll() was in flight.
      if (closed) return;
      if (result && (result.newItems?.length || typeof result.unread === 'number')) {
        send('notifications', { newItems: result.newItems || [], unread: result.unread || 0 });
      }
    } catch (err) {
      if (closed) return;
      if (err && err.status === 401) {
        send('auth', { code: 'token_expired' });
        cleanup();
      }
      // Other errors are transient — keep the stream open and retry next tick.
    } finally {
      ticking = false;
    }
  };

  heartbeat = setInterval(() => { if (!closed && !res.writableEnded) res.write(': ping\n\n'); }, HEARTBEAT_MS);
  poller = setInterval(tick, POLL_MS);

  req.on('close', cleanup);
  res.on('error', cleanup);
}
