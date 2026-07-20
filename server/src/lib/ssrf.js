import { lookup } from 'node:dns/promises';

// Basic SSRF guard for user-supplied outbound URLs (chat webhooks). Requires
// https, then resolves the host and rejects private / loopback / link-local /
// cloud-metadata destinations so an authenticated user can't make the server
// POST into the internal network.

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // treat unparseable as unsafe
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true; // link-local + ULA
  if (s.startsWith('::ffff:')) return isPrivateIPv4(s.slice(7)); // IPv4-mapped
  return false;
}

function isPrivateAddress(addr, family) {
  return family === 6 ? isPrivateIPv6(addr) : isPrivateIPv4(addr);
}

/**
 * Throw (status 400) unless `rawUrl` is an https URL that resolves only to
 * public addresses. Returns the parsed URL on success.
 */
export async function assertPublicHttpsUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { const e = new Error('Invalid URL.'); e.status = 400; throw e; }
  if (url.protocol !== 'https:') { const e = new Error('Webhook URL must use https.'); e.status = 400; throw e; }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    const e = new Error('Webhook host is not allowed.'); e.status = 400; throw e;
  }
  let results;
  try {
    results = await lookup(host, { all: true });
  } catch {
    const e = new Error('Could not resolve webhook host.'); e.status = 400; throw e;
  }
  for (const r of results) {
    if (isPrivateAddress(r.address, r.family)) {
      const e = new Error('Webhook host resolves to a private / disallowed address.'); e.status = 400; throw e;
    }
  }
  return url;
}
