import { adoGet, orgUrl } from '../lib/adoClient.js';
import { config } from '../config.js';
import { currentConfig } from '../lib/context.js';
import { parseRepoUrl, orgFromUrl } from '../lib/repoLink.js';

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

/**
 * Resolve a repository reference — either a full ADO repo URL or a plain repo
 * name — into a verified, canonical descriptor so the caller can start tracking
 * it. The repo is fetched from ADO to confirm it exists and to obtain its
 * canonical name/casing and owning project (name + id).
 *
 * Returns { repo, repoId, project, projectId, defaultBranch, webUrl }.
 * Throws 400 for a bad/foreign-org link, 404 when the repo doesn't exist.
 */
export async function resolveRepoLink(ref) {
  const raw = String(ref || '').trim();
  if (!raw) throw badRequest('Enter a repository URL or name.');

  const parsed = parseRepoUrl(raw);
  let project;
  let repo;

  if (parsed) {
    const cfgOrg = orgFromUrl(config.organizationUrl);
    if (cfgOrg && parsed.org && parsed.org.toLowerCase() !== cfgOrg) {
      throw badRequest(
        `That link points to organization “${parsed.org}”, but this dashboard is connected to “${cfgOrg}”.`
      );
    }
    project = parsed.project;
    repo = parsed.repo;
  } else if (/_git|https?:\/\/|dev\.azure\.com|visualstudio\.com/i.test(raw)) {
    // Looked like a URL but wasn't a parseable repo link.
    throw badRequest('Could not read a repository from that URL. Expected a link like https://…/_git/<repo>.');
  } else {
    // Plain name → track it under the currently active project.
    project = currentConfig().project;
    repo = raw;
  }

  const url = orgUrl(`${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}`);
  let data;
  try {
    data = await adoGet(url, { query: { 'api-version': '7.1' }, cache: false });
  } catch (err) {
    if (err && err.status === 404) {
      const e = new Error(`Repository “${repo}” was not found in project “${project}”.`);
      e.status = 404;
      throw e;
    }
    throw err;
  }

  return {
    repo: data.name,
    repoId: data.id,
    project: data.project?.name || project,
    projectId: data.project?.id || '',
    defaultBranch: data.defaultBranch || null,
    webUrl: data.webUrl || null,
  };
}

