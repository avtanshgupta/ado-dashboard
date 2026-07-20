import { useState } from 'react';
import { api } from '../lib/api.js';
import { Check, TriangleAlert } from '../components/icons.jsx';
import { BrandMark } from '../components/BrandMark.jsx';

const RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
// Cross-platform: print the token to stdout (works on macOS, Linux, Windows).
// The in-browser Copy button copies this command; users copy the printed token.
const CMD = `az account get-access-token --resource ${RESOURCE} --query accessToken -o tsv`;
// Optional shortcut to send the token straight to the OS clipboard.
const CLIPBOARD_TIPS = [
  { os: 'macOS', pipe: '| pbcopy' },
  { os: 'Windows', pipe: '| clip' },
  { os: 'Linux', pipe: '| xclip -selection clipboard' },
];

/**
 * Token-paste sign-in. Used as a full-page screen for the first sign-in
 * (mode="login") and as a compact re-paste card when the token expires
 * (mode="reauth"). On success it calls onAuthed(result).
 *
 * Tip: run scripts/token-pusher.sh on your machine after the first sign-in and
 * the backend is kept refreshed for you — you stay signed in until you log out.
 */
export function Login({ mode = 'login', knownUser, reason, onAuthed }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const reauth = mode === 'reauth';

  async function submit(e) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = reauth ? await api.pushToken(token.trim()) : await api.login(token.trim());
      setToken('');
      onAuthed?.(result);
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the user can select the text manually */
    }
  }

  const form = (
    <form onSubmit={submit} className="login-form">
      <ol className="login-steps">
        <li>
          Run this in your terminal, then copy the printed token:
          <div className="login-cmd">
            <code>{CMD}</code>
            <button type="button" className="btn sm" onClick={copyCmd}>
              {copied ? <><Check size={13} /> Copied</> : 'Copy'}
            </button>
          </div>
          <div className="login-tip muted">
            Tip: pipe it straight to your clipboard —{' '}
            {CLIPBOARD_TIPS.map((t, i) => (
              <span key={t.os}>
                {i > 0 && ', '}
                <code>{t.pipe}</code> ({t.os})
              </span>
            ))}
            .
          </div>
        </li>
        <li>Paste the token below and sign in.</li>
      </ol>
      <textarea
        className="login-token"
        placeholder="Paste your Azure access token (eyJ0…)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        spellCheck={false}
        autoFocus
        rows={4}
      />
      {error && <div className="login-error"><TriangleAlert size={15} /> {error}</div>}
      <button type="submit" className="btn accent" disabled={busy || !token.trim()}>
        {busy ? 'Signing in…' : reauth ? 'Update token' : 'Sign in'}
      </button>
      <p className="login-hint">
        Tokens last ~75 minutes. Run the optional <code>token-pusher</code> helper on your
        machine to refresh automatically so you stay signed in until you log out.
      </p>
    </form>
  );

  if (reauth) {
    return (
      <div className="reauth-card">
        <h3>Session token expired</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {knownUser ? `Signed in as ${knownUser.displayName}. ` : ''}
          Paste a fresh Azure token to keep going — you won't lose your place.
        </p>
        {form}
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card card">
        <div className="login-brand">
          <span className="logo"><BrandMark size={24} /></span>
          <div>
            <div className="login-title">ADO Dashboard</div>
            <div className="muted" style={{ fontSize: 13 }}>Azure DevOps · Windows Defender</div>
          </div>
        </div>
        {reason === 'forbidden' ? (
          <div className="login-error" style={{ marginBottom: 12 }}>
            Your account isn't a member of the MDE Linux group.
          </div>
        ) : null}
        {form}
      </div>
    </div>
  );
}
