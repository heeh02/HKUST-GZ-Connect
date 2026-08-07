'use strict';

// Check-and-notify only: the macOS builds are ad-hoc signed, so in-app
// downloads cannot be trusted to install. This module only asks GitHub for
// the latest release tag and compares it with the running version; the UI
// then points the user at the release page. Every failure (offline, API
// limit, malformed payload) collapses to `null` so a broken network can
// never surface as an error in the main loop.
const https = require('https');

const RELEASES_API_URL = 'https://api.github.com/repos/heeh02/HKUST-GZ-Connect/releases/latest';
const RELEASES_URL_PREFIX = 'https://github.com/heeh02/HKUST-GZ-Connect/releases';
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1024 * 1024;
const USER_AGENT = 'hkustgzconnect-update-check';

// shell.openExternal targets from the renderer are confined to this prefix so
// a compromised or buggy page cannot hand the OS an arbitrary URL.
function isAllowedReleaseUrl(url) {
  return typeof url === 'string'
    && (url === RELEASES_URL_PREFIX || url.startsWith(`${RELEASES_URL_PREFIX}/`));
}

function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

// Returns 1 / 0 / -1 like a comparator, or null when either side is not a
// plain numeric version. Callers treat null as "cannot tell", never as
// "update available".
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function defaultFetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`release check failed with HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) req.destroy(new Error('release response too large'));
      });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('release check timed out')));
    req.on('error', reject);
  });
}

// fetchJson is injectable so tests never touch the network. The release page
// URL is only trusted when it stays inside the releases allowlist; anything
// else falls back to the releases index.
async function checkForUpdate(currentVersion, fetchJson = defaultFetchJson) {
  try {
    const release = await fetchJson(RELEASES_API_URL);
    if (!release || typeof release.tag_name !== 'string') return null;
    const latestVersion = release.tag_name.trim().replace(/^v/i, '');
    const comparison = compareVersions(latestVersion, currentVersion);
    if (!latestVersion || comparison === null) return null;
    return {
      updateAvailable: comparison > 0,
      latestVersion,
      url: isAllowedReleaseUrl(release.html_url) ? release.html_url : RELEASES_URL_PREFIX,
    };
  } catch {
    return null;
  }
}

// Automatic checks are throttled: at most one per interval, persisted across
// restarts via settings.updateCheckedAt. A missing/unparseable timestamp or a
// previous failed check (timestamp left at 0) means "check now".
function shouldAutoCheck(lastCheckedAt, now = Date.now(), intervalMs = AUTO_CHECK_INTERVAL_MS) {
  const last = Number(lastCheckedAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last >= intervalMs;
}

module.exports = {
  AUTO_CHECK_INTERVAL_MS,
  RELEASES_API_URL,
  RELEASES_URL_PREFIX,
  REQUEST_TIMEOUT_MS,
  checkForUpdate,
  compareVersions,
  isAllowedReleaseUrl,
  shouldAutoCheck,
};
