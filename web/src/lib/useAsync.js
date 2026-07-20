import { useState, useEffect, useCallback, useRef } from 'react';

function depsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Generic async data hook with manual refetch + polling support.
 *
 * When `deps` change (e.g. switching tab or a filter that drives a new request),
 * the previous query's `data` is dropped synchronously so consumers immediately
 * render their loader instead of briefly showing stale results. A request token
 * ensures a slow in-flight response from an old query can never overwrite a newer
 * one. Manual `refetch()` (Refresh button, post-action) keeps the current data so
 * the list updates in place without a jarring full loader.
 */
export function useAsync(fn, deps = [], { pollMs } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);
  const depsRef = useRef(deps);
  const runIdRef = useRef(0);

  // Inputs changed since last render → reset to a clean loading state now, before
  // paint, so no stale data is shown. (Guarded setState-during-render: the React
  // "store info from previous renders" pattern; the no-op branch avoids a loop.)
  if (!depsEqual(depsRef.current, deps)) {
    depsRef.current = deps;
    setState((s) =>
      s.data === null && s.loading && !s.error ? s : { data: null, loading: true, error: null }
    );
  }

  const run = useCallback(async (silent = false) => {
    const myRun = ++runIdRef.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (mounted.current && myRun === runIdRef.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (mounted.current && myRun === runIdRef.current) setState((s) => ({ ...s, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
