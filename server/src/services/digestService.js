import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { loadUserConfig } from '../lib/userConfig.js';
import { writeJsonAtomic } from '../lib/atomicFile.js';

// C3 — scheduled digest email. Runs off the per-user notification store (no live
// ADO token needed), so it works for any user who has notifications recorded.
// Scheduling + summary building are pure so they're unit-testable; the scan +
// send loop is best-effort and swallows per-user errors.

const notifDir = join(config.dataDir, 'notif');
const DAY = 86400000;

/** Whether a digest is due given the cadence + when we last sent one. */
export function isDigestDue(cadence, lastSentAt, now = Date.now()) {
  if (cadence !== 'daily' && cadence !== 'weekly') return false;
  if (!lastSentAt) return true;
  const elapsed = now - lastSentAt;
  return cadence === 'daily' ? elapsed >= DAY : elapsed >= 7 * DAY;
}

/** Build a plain-text digest from notification items created since `sinceMs`. */
export function buildDigestText(items, sinceMs, { cadence = 'daily' } = {}) {
  const recent = (items || []).filter((i) => {
    const t = new Date(i.timestamp).getTime();
    return !Number.isNaN(t) && t >= sinceMs;
  });
  if (!recent.length) return null;
  const byRepo = new Map();
  for (const i of recent) {
    const list = byRepo.get(i.repo) || [];
    list.push(i);
    byRepo.set(i.repo, list);
  }
  const sections = [...byRepo.entries()].map(([repo, list]) => {
    const lines = list.map((i) => `  • ${i.message}${i.webUrl ? `\n    ${i.webUrl}` : ''}`);
    return `[${repo}] (${list.length})\n${lines.join('\n')}`;
  });
  const title = `Your ${cadence} ADO PR digest — ${recent.length} update${recent.length === 1 ? '' : 's'}`;
  return `${title}\n\n${sections.join('\n\n')}`;
}

async function sendDigestEmail(to, subject, text) {
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  await transport.sendMail({ from: config.email.from, to, subject, text });
}

/** One scan pass: send digests to every user whose cadence is due. */
export async function runDigestOnce(now = Date.now()) {
  if (!config.email.enabled || !existsSync(notifDir)) return { sent: 0 };
  let sent = 0;
  for (const file of readdirSync(notifDir)) {
    if (!file.endsWith('.json')) continue;
    const path = join(notifDir, file);
    try {
      const store = JSON.parse(readFileSync(path, 'utf8'));
      const userKey = file.slice(0, -5);
      const uc = loadUserConfig(userKey);
      const cadence = uc.notificationPrefs?.digest || 'off';
      if (!isDigestDue(cadence, store.digestSentAt, now)) continue;
      const since = store.digestSentAt || now - (cadence === 'weekly' ? 7 * DAY : DAY);
      const text = buildDigestText(store.items, since, { cadence });
      if (text && store.email) {
        await sendDigestEmail(store.email, `ADO PR Dashboard: ${cadence} digest`, text);
        sent += 1;
      }
      // Re-read the store after the (awaited) send so a concurrent poll's new
      // notifications aren't clobbered — only the digest marker is updated.
      const fresh = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : store;
      fresh.digestSentAt = now;
      writeJsonAtomic(path, fresh);
    } catch (e) {
      console.warn(`[digest] ${file} failed: ${e.message}`);
    }
  }
  return { sent };
}

/** Start the hourly digest scheduler (no-op without SMTP). */
export function startDigestScheduler() {
  if (!config.email.enabled) return;
  const run = () => runDigestOnce().catch((e) => console.error('[digest] scan failed:', e.message));
  setInterval(run, 60 * 60 * 1000).unref?.();
  setTimeout(run, 30 * 1000).unref?.(); // first pass shortly after boot
}
