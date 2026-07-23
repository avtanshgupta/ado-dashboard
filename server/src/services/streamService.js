import { getCtx, runWithCtx } from '../lib/context.js';
import { effectiveConfig } from '../lib/userConfig.js';
import { poll } from './notificationsService.js';
import { PollRegistry } from '../lib/pollHub.js';

// How often the server re-polls ADO for changes, per USER (not per connection).
// poll() is heavy (it enriches all tracked lists), so a single shared loop per
// user — fanned out to all their tabs/devices — keeps ADO load flat as the same
// user opens more clients.
const POLL_MS = 60000;
const HEARTBEAT_MS = 25000; // keep proxies (Azure App Service) from closing idle streams

// One registry for the whole process; one poll loop per user id.
const registry = new PollRegistry();
const loops = new Map(); // userId -> { timer, ticking, store }

// Never write after the client has gone away (avoids ERR_STREAM_WRITE_AFTER_END).
function writeSse(res, event, data) {
  if (res.writableEnded) return;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client went away between the check and the write */
  }
}

/** Run one poll for a user and fan the result out to all their connected clients. */
async function tick(userId) {
  const loop = loops.get(userId);
  if (!loop || loop.ticking) return; // single-flight: never overlap a slow poll
  loop.ticking = true;
  try {
    // Rebuild the user's config each tick so setting changes (repos, prefs, muted
    // repos) take effect without reconnecting. All of a user's SSE connections
    // share the same vaulted token, so any live client's captured auth works.
    const freshStore = { ...loop.store, userConfig: effectiveConfig(loop.store.user) };
    const result = await runWithCtx(freshStore, () => poll());
    if (result && (result.newItems?.length || typeof result.unread === 'number')) {
      const payload = { newItems: result.newItems || [], unread: result.unread || 0 };
      for (const res of registry.clients(userId)) writeSse(res, 'notifications', payload);
    }
  } catch (err) {
    if (err && err.status === 401) {
      // The user's token expired — tell every client to re-auth, then tear the
      // loop down. Clients reconnect (recreating the loop) after re-authenticating.
      for (const res of registry.clients(userId)) writeSse(res, 'auth', { code: 'token_expired' });
      stopLoop(userId);
      return;
    }
    // Other errors are transient — keep the loop running and retry next tick.
  } finally {
    const current = loops.get(userId);
    if (current) current.ticking = false;
  }
}

function startLoop(userId, store) {
  if (loops.has(userId)) return;
  const timer = setInterval(() => tick(userId), POLL_MS);
  if (timer.unref) timer.unref();
  loops.set(userId, { timer, ticking: false, store });
}

function stopLoop(userId) {
  const loop = loops.get(userId);
  if (!loop) return;
  clearInterval(loop.timer);
  loops.delete(userId);
}

/**
 * Server-Sent Events endpoint (C1): pushes new notifications to the browser so
 * the bell + views update live. The request already ran through sessionContext,
 * so we capture that per-request store; a single per-user timer re-enters it on
 * each tick (AsyncLocalStorage doesn't survive across setInterval on its own).
 */
export function sseHandler(req, res) {
  const store = getCtx();
  const userId = store?.user?.id;
  if (!store || !userId) {
    res.status(401).json({ error: 'Not authenticated', status: 401, code: 'no_session' });
    return;
  }

  let closed = false;
  let heartbeat = null;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    const { isEmpty } = registry.remove(userId, res);
    if (isEmpty) stopLoop(userId);
    try { res.end(); } catch { /* already closed */ }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  res.write('retry: 5000\n\n');
  writeSse(res, 'hello', { ok: true, at: new Date().toISOString() });

  // Register this client; start the shared per-user loop if it's the first one,
  // otherwise refresh the loop's captured store to this newest connection so a
  // client reconnecting after re-auth supplies the freshest token for polling.
  const { isFirst } = registry.add(userId, res);
  if (isFirst) startLoop(userId, store);
  else {
    const loop = loops.get(userId);
    if (loop) loop.store = store;
  }

  heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  req.on('close', cleanup);
  res.on('error', cleanup);
}
