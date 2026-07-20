import { writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Durably write text to a file: write to a temp sibling, then atomically rename
 * over the target. Prevents torn/partial files when concurrent writers race
 * (e.g. a notification poll and a Settings save touching the same user file).
 * The rename is atomic on the same filesystem, so readers see either the old or
 * the new content — never a half-written mix.
 */
export function writeFileAtomic(path, text, { mode } = {}) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Unique-ish temp name so two writers to the same target don't collide.
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text, mode ? { mode } : undefined);
  renameSync(tmp, path);
}

/** Atomically write a value as pretty JSON. */
export function writeJsonAtomic(path, value, opts) {
  writeFileAtomic(path, JSON.stringify(value, null, 2), opts);
}
