import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { trapFocus } from './focusTrap.js';
import { X } from './icons.jsx';

// `g` then one of these navigates (GitHub-style). Kept in sync with the sidebar.
const GOTO = {
  h: '/',
  c: '/action-center',
  p: '/pull-requests',
  w: '/work-items',
  i: '/pipelines',
  a: '/agents',
  s: '/settings',
};

const SECTIONS = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘K', 'Ctrl-K'], sep: '/', desc: 'Open the command palette' },
      { keys: ['?'], desc: 'Show this shortcuts help' },
      { keys: ['Esc'], desc: 'Close a dialog, palette, or menu' },
    ],
  },
  {
    title: 'Go to — press g, then',
    items: [
      { keys: ['g', 'h'], sep: 'then', desc: 'Dashboard' },
      { keys: ['g', 'c'], sep: 'then', desc: 'Action Center' },
      { keys: ['g', 'p'], sep: 'then', desc: 'Pull Requests' },
      { keys: ['g', 'w'], sep: 'then', desc: 'Work Items' },
      { keys: ['g', 'i'], sep: 'then', desc: 'Pipelines' },
      { keys: ['g', 'a'], sep: 'then', desc: 'Agents' },
      { keys: ['g', 's'], sep: 'then', desc: 'Settings' },
    ],
  },
  {
    title: 'Command palette',
    items: [
      { keys: ['↑', '↓'], sep: '/', desc: 'Move between results' },
      { keys: ['↵'], desc: 'Run the selected command' },
      { keys: ['#123'], desc: 'Jump straight to work item #123' },
    ],
  },
];

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global keyboard shortcuts: a `?` help overlay plus GitHub-style `g <key>`
 * navigation. Mounted once in the Layout. Never hijacks typing (inputs, text
 * areas, selects, contenteditable) or modifier combos (⌘K is handled by the
 * command palette). Also openable from the user menu via the `ado-show-shortcuts`
 * event.
 */
export function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const pendingG = useRef(0);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const now = Date.now();
      // Complete a `g <key>` sequence if one is pending and still fresh.
      if (pendingG.current && now - pendingG.current < 1200) {
        const dest = GOTO[e.key?.toLowerCase()];
        pendingG.current = 0;
        if (dest) {
          e.preventDefault();
          navigate(dest);
          return;
        }
      }

      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
        return;
      }
      if (e.key?.toLowerCase() === 'g') pendingG.current = now;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, open, close]);

  useEffect(() => {
    function onShow() {
      setOpen(true);
    }
    window.addEventListener('ado-show-shortcuts', onShow);
    return () => window.removeEventListener('ado-show-shortcuts', onShow);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => closeRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="cmdk-backdrop" onClick={close}>
      <div
        className="shortcuts-dialog"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapFocus(dialogRef.current, e)}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="shortcuts-head">
          <h3>Keyboard shortcuts</h3>
          <button className="btn-icon" ref={closeRef} onClick={close} aria-label="Close shortcuts help">
            <X size={16} />
          </button>
        </div>
        <div className="shortcuts-body">
          {SECTIONS.map((section) => (
            <div className="shortcuts-section" key={section.title}>
              <div className="shortcuts-section-title muted">{section.title}</div>
              <table className="shortcuts-table">
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.desc}>
                      <td className="sc-keys">
                        {item.keys.map((k, i) => (
                          <span key={k}>
                            {i > 0 && <span className="sc-sep">{item.sep || '+'}</span>}
                            <kbd>{k}</kbd>
                          </span>
                        ))}
                      </td>
                      <td className="sc-desc">{item.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
