// Portable per-user settings. `buildExport` turns the live config into a JSON
// bundle containing only the user-editable keys (never identity or tokens);
// `parseImport` safely extracts those same keys from an uploaded file. The caller
// downloads/uploads the file and reuses PUT /config, which validates on write.

export const EXPORTABLE_KEYS = [
  'projects', 'repositories', 'repoProjects', 'team', 'reviewerGroups',
  'defaultTimeRangeMonths', 'pipelines', 'notificationPrefs', 'commentTemplates',
  'prTemplates', 'savedViews', 'mutedRepos', 'uiPrefs', 'slaDays',
  'workItemSavedQueries', 'agents',
];

export const EXPORT_TYPE = 'ado-dashboard-settings';
export const EXPORT_VERSION = 1;

/** Build a portable bundle from the live config (only the editable keys). */
export function buildExport(config, now = new Date()) {
  const settings = {};
  for (const k of EXPORTABLE_KEYS) {
    if (config && config[k] !== undefined) settings[k] = config[k];
  }
  return {
    _type: EXPORT_TYPE,
    _version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings,
  };
}

/**
 * Parse + sanitize an imported bundle. Accepts either a wrapped bundle
 * ({ _type, settings }) or a bare settings object, and returns only recognized
 * keys. Throws a user-facing Error on invalid JSON, a wrong bundle type, or when
 * nothing recognizable is found.
 */
export function parseImport(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unrecognized settings file.');
  }

  let source;
  if (parsed._type !== undefined || parsed.settings !== undefined) {
    // Looks like a wrapped bundle — it must be the right type and shape.
    if (
      parsed._type !== EXPORT_TYPE ||
      !parsed.settings ||
      typeof parsed.settings !== 'object' ||
      Array.isArray(parsed.settings)
    ) {
      throw new Error('Unrecognized settings file.');
    }
    source = parsed.settings;
  } else {
    source = parsed; // bare settings object (hand-made or legacy)
  }

  const out = {};
  for (const k of EXPORTABLE_KEYS) {
    if (source[k] !== undefined) out[k] = source[k];
  }
  if (Object.keys(out).length === 0) {
    throw new Error('No recognized settings found in that file.');
  }
  return out;
}
