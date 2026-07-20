import { useState, useRef, useEffect } from 'react';
import { useConfig } from '../lib/AppContext.jsx';
import { MessageSquare, ChevronDown } from './icons.jsx';

/**
 * Dropdown that inserts a saved reply template (A4) into a compose box. Templates
 * are managed per-user in Settings and read from config. Renders nothing when the
 * user has no templates, so it stays out of the way until configured.
 */
export function TemplateMenu({ onPick, size = 'xs' }) {
  const config = useConfig();
  const templates = config?.commentTemplates || [];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!templates.length) return null;

  return (
    <div className="tmpl-menu" ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={`btn ${size}`} onClick={() => setOpen((o) => !o)} title="Insert a saved reply template">
        <MessageSquare size={12} /> Templates <ChevronDown size={11} />
      </button>
      {open && (
        <div className="dropdown-menu tmpl-dropdown" style={{ right: 0, minWidth: 220, maxHeight: 280, overflowY: 'auto' }}>
          {templates.map((t) => (
            <button
              type="button"
              key={t.id}
              className="dd-item tmpl-item"
              title={t.body}
              onClick={() => { onPick(t.body); setOpen(false); }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
