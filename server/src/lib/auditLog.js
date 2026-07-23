/**
 * Append-only per-user audit log for state-changing actions (B2).
 *
 * Each user gets a newline-delimited JSON file at `DATA_DIR/audit/<id>.jsonl`.
 * We only record non-sensitive request metadata — HTTP method, route path,
 * response status, and latency — never tokens, bodies, comment text, or any
 * secret. Writes are best-effort: an audit failure must never break the request
 * it is describing. The file is trimmed to a bounded number of lines so it can't
 * grow without limit (preserving the no-database, per-user-JSON model).
 */
import { existsSync, mkdirSync, appendFileSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { writeFileAtomic } from './atomicFile.js';

const dir = join(config.dataDir, 'audit');
// Keep at most this many recent entries per user; trim when the file gets large.
const MAX_LINES = 2000;
const TRIM_AT_BYTES = 512 * 1024; // ~0.5 MB before we compact

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function fileFor(userId) {
  return join(dir, `${safeId(userId)}.jsonl`);
}
function ensureDir() {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Keep only the last MAX_LINES entries when a file grows past the byte cap. */
function trimIfLarge(file) {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < TRIM_AT_BYTES) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_LINES) return;
    writeFileAtomic(file, `${lines.slice(-MAX_LINES).join('\n')}\n`);
  } catch {
    /* trimming is best-effort */
  }
}

/**
 * Append one audit entry for a user. `entry` is caller-provided metadata; a
 * timestamp is added if absent. Never throws.
 */
export function appendAudit(userId, entry) {
  if (!userId) return;
  try {
    ensureDir();
    const record = { t: new Date().toISOString(), ...entry };
    const file = fileFor(userId);
    appendFileSync(file, `${JSON.stringify(record)}\n`);
    trimIfLarge(file);
  } catch {
    /* auditing must never break the request path */
  }
}

/**
 * Read a user's most recent audit entries, newest first. Returns [] on any error
 * (missing file, malformed lines are skipped individually).
 */
export function readAudit(userId, { limit = 100 } = {}) {
  try {
    const file = fileFor(userId);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const out = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip a corrupt line */
      }
    }
    out.reverse();
    return out.slice(0, Math.max(1, Math.min(Number(limit) || 100, MAX_LINES)));
  } catch {
    return [];
  }
}
