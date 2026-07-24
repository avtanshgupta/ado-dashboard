import { recordPartial } from './context.js';

/**
 * Fan out `mapper` over `keys` with graceful degradation: unlike Promise.all,
 * one rejected task does NOT fail the whole batch. Fulfilled values are returned
 * in `results` (index-aligned with the fulfilled keys) and each rejection is
 * recorded as a per-request partial failure (surfaced to the client) and returned
 * in `failed`.
 *
 * @param keys    the items to map over (e.g. repo names)
 * @param mapper  async (key) => value
 * @param label   a source-type prefix for the partial-failure record (e.g. 'repo')
 * @returns { results: value[], failed: { key, message }[] }
 */
export async function settleAll(keys, mapper, { label = 'source' } = {}) {
  const settled = await Promise.allSettled(keys.map((k) => mapper(k)));
  const results = [];
  const failed = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      const key = keys[i];
      const message = (s.reason && s.reason.message) || String(s.reason || 'Failed to load');
      failed.push({ key, message });
      recordPartial(`${label}:${key}`, message);
      console.warn(`[partial] ${label} "${key}" failed: ${message}`);
    }
  });
  return { results, failed };
}

/**
 * Convenience wrapper for the common case where each task resolves to an array
 * and the caller wants them flattened. Returns just the flattened results;
 * failures are still recorded as partials.
 */
export async function settleFlat(keys, mapper, opts) {
  const { results } = await settleAll(keys, mapper, opts);
  return results.flat();
}
