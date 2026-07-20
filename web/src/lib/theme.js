const KEY = 'ado-theme'; // 'light' | 'dark' | 'system'
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return mq().matches ? 'dark' : 'light';
}

/** Apply the resolved theme to <html data-theme>. */
export function applyTheme(pref = getThemePref()) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

export function setThemePref(pref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage disabled — still apply for this session */
  }
  applyTheme(pref);
}

/** Call once at startup: apply the saved theme and follow the OS when in 'system'. */
export function initTheme() {
  applyTheme();
  mq().addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
