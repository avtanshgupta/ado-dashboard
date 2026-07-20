import { useEffect, useRef, useState } from 'react';

/**
 * A closable multi-select dropdown (checkbox list) with a Clear action. Shared
 * by the PR and work-item filter bars so their facet pickers stay consistent.
 *
 * - `options`  : array of raw values
 * - `selected` : array of chosen values
 * - `onToggle(value)` / `onClear()`
 * - `render(value)` : optional label renderer
 * - `icon` : optional leading icon component for the toggle button
 */
export function MultiSelect({ label, options, selected, onToggle, onClear, render = (o) => o, icon: Icon, minWidth = 220, allLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  if (!options.length) return null;
  const text =
    selected.length === 0
      ? allLabel || `All ${label.toLowerCase()}`
      : selected.length === 1
        ? render(selected[0])
        : `${selected.length} ${label.toLowerCase()}`;
  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="dropdown-toggle"
        onClick={() => setOpen((o) => !o)}
        title={`Filter by ${label.toLowerCase()}`}
        style={Icon ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : undefined}
      >
        {Icon && <Icon size={14} />} {text}
      </button>
      {open && (
        <div className="dropdown-menu" style={{ minWidth, maxHeight: 320, overflowY: 'auto' }}>
          <div className="dd-head">
            <span>{label}</span>
            {selected.length > 0 && <button type="button" className="btn sm" onClick={onClear}>Clear</button>}
          </div>
          {options.map((o) => (
            <label key={o} className="dd-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{render(o)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
