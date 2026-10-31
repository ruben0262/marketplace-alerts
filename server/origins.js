// A browser may use localhost, an IP, or the public proxy hostname. Validate the
// origin it is actually visiting, not only APP_URL (which is the canonical URL
// used for links). Forwarded host/protocol count only behind a trusted proxy.
export function isSameOriginRequest(req, canonicalOrigin) {
  if (req.get('X-Requested-With') !== 'marketplace-alerts') return false;
  const origin = req.get('Origin');
  if (!origin) return req.get('Sec-Fetch-Site') !== 'cross-site';
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
  if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
  const trusted = req.app.get('trust proxy fn')?.(req.socket.remoteAddress, 0);
  const host = trusted && req.get('X-Forwarded-Host') ? req.get('X-Forwarded-Host').split(',')[0].trim() : req.get('Host');
  if (parsed.origin === `${req.protocol}://${host}`) return true;
  // Vite forwards API requests to a different local port without changing Origin.
  // Allow only an explicitly configured canonical origin on that proxy path.
  return parsed.origin === canonicalOrigin;
}
