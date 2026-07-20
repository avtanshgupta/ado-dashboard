import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheGet, cacheSet } from './dataCache.js';

function depsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Generic async data hook with manual refetch, polling, and stale-while-
 * revalidate caching.
 *
 * Pass a `cacheKey` to opt a query into the persistent client cache: on mount
 * (or when the key changes) the last successful payload renders immediately
 * while a fresh request runs in the background. Whenever data is already on
 * screen (manual refresh or poll), `loading` stays false and `revalidating`
 * flips true — so pages keep their content and can show a lightweight
 * "updating…" indicator instead of a blanking full-page loader. A request token
 * ensures a slow response from an old query can never overwrite a newer one.
 */
export function useAsync(fn, deps = [], { pollMs, cacheKey } = {}) {
  const initial = cacheKey ? cacheGet(cacheKey) : undefined;
  const [state, setState] = useState({
    data: initial !== undefined ? initial : null,
    loading: initial === undefined,
    error: null,
    revalidating: false,
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const mounted = useRef(true);
  const depsRef = useRef(deps);
  const runIdRef = useRef(0);

  // Inputs changed since last render → reset before paint. With a cacheKey we
  // seed from the cache (instant stale render); otherwise we drop to a loader.
  if (!depsEqual(depsRef.current, deps)) {
    depsRef.current = deps;
    const cached = cacheKey ? cacheGet(cacheKey) : undefined;
    setState((s) => {
      const next = {
        data: cached !== undefined ? cached : null,
        loading: cached === undefined,
        error: null,
        revalidating: false,
      };
      if (s.data === next.data && s.loading === next.loading && !s.error && !s.revalidating) return s;
      return next;
    });
  }

  const run = useCallback(async (silent = false) => {
    const myRun = ++runIdRef.current;
    setState((s) => {
      const hasData = s.data != null;
      // Keep content on screen whenever we have data: show `revalidating`
      // instead of the full loader (manual refresh or background poll).
      if (hasData || silent) return { ...s, loading: false, revalidating: true, error: silent ? s.error : null };
      return { ...s, loading: true, revalidating: false, error: null };
    });
    try {
      const data = await fnRef.current();
      if (mounted.current && myRun === runIdRef.current) {
        if (cacheKeyRef.current) cacheSet(cacheKeyRef.current, data);
        setState({ data, loading: false, error: null, revalidating: false });
      }
    } catch (error) {
      if (mounted.current && myRun === runIdRef.current) setState((s) => ({ ...s, loading: false, revalidating: false, error }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    run();
    let timer;
    if (pollMs) timer = setInterval(() => run(true), pollMs);
    return () => {
      mounted.current = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, refetch: run };
}
