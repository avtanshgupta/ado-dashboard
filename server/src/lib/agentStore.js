/**
 * Agent session store — JSON file persistence for Copilot CLI sessions.
 * One file per user: server/data/agents/<userId>.json
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';

const agentsDir = join(config.dataDir, 'agents');

function ensureDir() {
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
}

function safeId(userId) {
  return String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function filePath(userId) {
  return join(agentsDir, `${safeId(userId)}.json`);
}

export function loadSessions(userId) {
  ensureDir();
  const path = filePath(userId);
  if (!existsSync(path)) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { sessions: [] };
  }
}

export function saveSessions(userId, data) {
  ensureDir();
  writeJsonAtomic(filePath(userId), data);
}
