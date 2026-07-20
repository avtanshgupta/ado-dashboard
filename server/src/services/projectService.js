import { adoGet, orgApiUrl } from '../lib/adoClient.js';
import { config, apiVersion } from '../config.js';
import { currentConfig } from '../lib/context.js';
import { parseRepoUrl, orgBaseFromUrl } from '../lib/repoLink.js';
import { projectFromAdoUrl } from '../lib/workItemLinks.js';

const DEFAULT_ORG = config.organizationUrl.replace(/\/$/, '');

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

/** Web URL for a project under a given org base. */
function projectWebUrl(orgBase, name) {
  return `${(orgBase || DEFAULT_ORG).replace(/\/$/, '')}/${encodeURIComponent(name)}`;
}

/**
 * Resolve a project reference — a project URL (…/<project>) or a plain project
 * name — into a verified { name, id, url, org } so a user can add a monitored
 * project by pasting its link. Supports multiple organizations: the org is taken
 * from the URL (falling back to the default org for a bare name). 404s an unknown
 * project.
 */
export async function resolveProjectLink(ref) {
  const raw = String(ref || '').trim();
  if (!raw) throw badRequest('Enter a project URL or name.');

  let name;
  let orgBase = DEFAULT_ORG;
  if (/^https?:\/\//i.test(raw) || /dev\.azure\.com|visualstudio\.com/i.test(raw)) {
    orgBase = orgBaseFromUrl(raw) || DEFAULT_ORG;
    name = projectFromAdoUrl(raw);
    if (!name) throw badRequest('Could not read a project from that URL. Expected a link like https://…/<project>.');
  } else {
    throw badRequest('Paste a project URL (e.g. https://dev.azure.com/<org>/<project>) — adding by name is not supported.');
  }

  let data;
  try {
    data = await adoGet(orgApiUrl(orgBase, `_apis/projects/${encodeURIComponent(name)}`), { query: { 'api-version': apiVersion }, cache: false });
  } catch (err) {
    if (err && (err.status === 404 || err.status === 403)) {
      const e = new Error(`Project “${name}” was not found (or you lack access) in ${orgBase}.`);
      e.status = err.status;
      throw e;
    }
    throw err;
  }
  return {
    name: data.name,
    id: data.id,
    org: orgBase,
    url: projectWebUrl(orgBase, data.name),
  };
}

/**
 * Resolve a repository reference — either a full ADO repo URL or a plain repo
 * name — into a verified, canonical descriptor so the caller can start tracking
 * it. Multi-org: the org is taken from the repo URL (falling back to the default
 * org for a bare name). The repo's project must be one of the monitored projects.
 *
 * Returns { repo, repoId, project, projectId, org, defaultBranch, webUrl }.
 */
export async function resolveRepoLink(ref) {
  const raw = String(ref || '').trim();
  if (!raw) throw badRequest('Enter a repository URL or name.');

  const parsed = parseRepoUrl(raw);
  let project;
  let repo;
  let orgBase = DEFAULT_ORG;

  if (parsed) {
    project = parsed.project;
    repo = parsed.repo;
    orgBase = orgBaseFromUrl(raw) || DEFAULT_ORG;
  } else {
    throw badRequest('Paste a repository URL (…/_git/<repo>) — adding by name is no longer supported.');
  }

  const url = orgApiUrl(orgBase, `${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`);
  let data;
  try {
    data = await adoGet(url, { query: { 'api-version': apiVersion }, cache: false });
  } catch (err) {
    if (err && err.status === 404) {
      const e = new Error(`Repository “${repo}” was not found in project “${project}”.`);
      e.status = 404;
      throw e;
    }
    throw err;
  }

  const resolvedProject = data.project?.name || project;
  // Repos are monitored only within the configured projects (manual-but-scoped).
  const cfg = currentConfig();
  if (cfg?.projectSet?.size && !cfg.projectSet.has(String(resolvedProject).toLowerCase())) {
    throw badRequest(`“${data.name}” is in project “${resolvedProject}”, which isn't one of your monitored projects. Add the project first, then add the repo.`);
  }

  return {
    repo: data.name,
    repoId: data.id,
    project: resolvedProject,
    projectId: data.project?.id || '',
    org: orgBase,
    defaultBranch: data.defaultBranch || null,
    webUrl: data.webUrl || null,
  };
}
