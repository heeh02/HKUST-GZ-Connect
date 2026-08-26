'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AUTO_CHECK_INTERVAL_MS,
  PRERELEASES_API_URL,
  RELEASES_API_URL,
  RELEASES_URL_PREFIX,
  checkForUpdate,
  compareVersions,
  isBetaFinalPromotion,
  isAllowedReleaseUrl,
  shouldAutoCheck,
} = require('../../../../lib/platform/update/update-check');

test('compareVersions orders plain numeric versions', () => {
  assert.equal(compareVersions('1.0.7', '1.0.7'), 0);
  assert.equal(compareVersions('1.0.8', '1.0.7'), 1);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.7', '1.0.8'), -1);
  assert.equal(compareVersions('1.0.7', '1.1.0'), -1);
  assert.equal(compareVersions('1.0.7', '2.0.0'), -1);
});

test('compareVersions tolerates leading v and short forms', () => {
  assert.equal(compareVersions('v1.0.8', '1.0.7'), 1);
  assert.equal(compareVersions('1.1', '1.1.0'), 0);
  assert.equal(compareVersions(' 1.0.8 ', '1.0.7'), 1);
});

test('compareVersions applies SemVer prerelease ordering', () => {
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0-beta.1'), 1);
  assert.equal(compareVersions('2.0.0-beta.10', '2.0.0-beta.2'), 1);
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0-beta.9'), 1);
  assert.equal(compareVersions('2.0.0-alpha.2', '2.0.0-alpha.10'), -1);
});

test('only the same release-line Beta can promote to its patch-zero final', () => {
  assert.equal(isBetaFinalPromotion('2.0.0', '2.0.1-beta.4'), true);
  assert.equal(isBetaFinalPromotion('2.0.0', '2.0.0-beta.4'), true);
  assert.equal(isBetaFinalPromotion('2.0.1', '2.0.2-beta.4'), false);
  assert.equal(isBetaFinalPromotion('2.1.0', '2.0.1-beta.4'), false);
  assert.equal(isBetaFinalPromotion('2.0.0-beta.5', '2.0.1-beta.4'), false);
});

test('compareVersions refuses unparsable input instead of guessing', () => {
  assert.equal(compareVersions('latest', '1.0.7'), null);
  assert.equal(compareVersions('1.0.7', ''), null);
  assert.equal(compareVersions(null, '1.0.7'), null);
  assert.equal(compareVersions(undefined, undefined), null);
});

test('checkForUpdate reports a newer release with its allowlisted page', async () => {
  const release = {
    tag_name: 'v1.1.0',
    html_url: `${RELEASES_URL_PREFIX}/tag/v1.1.0`,
  };
  const result = await checkForUpdate('1.0.7', async () => release);
  assert.deepEqual(result, {
    updateAvailable: true,
    latestVersion: '1.1.0',
    url: release.html_url,
  });
});

test('checkForUpdate passes the releases API URL to the fetcher', async () => {
  let requested = null;
  await checkForUpdate('1.0.7', async (url) => {
    requested = url;
    return { tag_name: 'v1.0.7' };
  });
  assert.equal(requested, RELEASES_API_URL);
});

test('prerelease builds query the release list and discover a newer Beta', async () => {
  let requested = null;
  const release = {
    tag_name: 'v2.0.1-beta.2',
    prerelease: true,
    html_url: `${RELEASES_URL_PREFIX}/tag/v2.0.1-beta.2`,
  };
  const result = await checkForUpdate('2.0.0-beta.1', async (url) => {
    requested = url;
    return [{ tag_name: 'v1.2.3', prerelease: false }, release];
  });
  assert.equal(requested, PRERELEASES_API_URL);
  assert.deepEqual(result, {
    updateAvailable: true,
    latestVersion: '2.0.1-beta.2',
    url: release.html_url,
  });
});

test('the evidence-gated final supersedes a numerically higher maintenance Beta', async () => {
  const release = {
    tag_name: 'v2.0.0',
    prerelease: false,
    html_url: `${RELEASES_URL_PREFIX}/tag/v2.0.0`,
  };
  const result = await checkForUpdate('2.0.1-beta.7', async () => [
    { tag_name: 'v2.0.1-beta.8', prerelease: true },
    release,
  ]);
  assert.deepEqual(result, {
    updateAvailable: true,
    latestVersion: '2.0.0',
    url: release.html_url,
  });
});

test('prerelease selection ignores drafts and older stable releases', async () => {
  const result = await checkForUpdate('2.0.0-beta.3', async () => [
    { tag_name: 'v2.0.0-beta.4', prerelease: true, draft: true },
    { tag_name: 'v1.2.3', prerelease: false },
    { tag_name: 'not-a-version', prerelease: true },
  ]);
  assert.deepEqual(result, {
    updateAvailable: false,
    latestVersion: '2.0.0-beta.3',
    url: RELEASES_URL_PREFIX,
  });
});

test('checkForUpdate treats same or older tags as no update', async () => {
  for (const tag of ['v1.0.7', '1.0.7', 'v1.0.6', 'v0.9.9']) {
    const result = await checkForUpdate('1.0.7', async () => ({ tag_name: tag }));
    assert.equal(result.updateAvailable, false, tag);
    assert.equal(result.latestVersion, tag.replace(/^v/, ''));
    assert.equal(result.url, RELEASES_URL_PREFIX);
  }
});

test('checkForUpdate replaces off-allowlist release URLs with the releases index', async () => {
  const result = await checkForUpdate('1.0.7', async () => ({
    tag_name: 'v2.0.0',
    html_url: 'https://evil.example.com/releases/tag/v2.0.0',
  }));
  assert.equal(result.updateAvailable, true);
  assert.equal(result.url, RELEASES_URL_PREFIX);
});

test('checkForUpdate collapses every failure mode to null', async () => {
  assert.equal(await checkForUpdate('1.0.7', async () => { throw new Error('offline'); }), null);
  assert.equal(await checkForUpdate('1.0.7', async () => null), null);
  assert.equal(await checkForUpdate('1.0.7', async () => ({})), null);
  assert.equal(await checkForUpdate('1.0.7', async () => ({ tag_name: 42 })), null);
  assert.equal(await checkForUpdate('1.0.7', async () => ({ tag_name: 'not-a-version' })), null);
  assert.equal(await checkForUpdate('not-a-version', async () => ({ tag_name: 'v1.0.8' })), null);
});

test('isAllowedReleaseUrl only trusts the GitHub releases prefix', () => {
  assert.equal(isAllowedReleaseUrl(RELEASES_URL_PREFIX), true);
  assert.equal(isAllowedReleaseUrl(`${RELEASES_URL_PREFIX}/tag/v1.0.8`), true);
  assert.equal(isAllowedReleaseUrl(`http://github.com/heeh02/HKUST-GZ-Connect/releases/tag/v1`), false);
  assert.equal(isAllowedReleaseUrl('https://github.com/heeh02/HKUST-GZ-Connect/releases.evil.com/x'), false);
  assert.equal(isAllowedReleaseUrl('https://github.com/heeh02/HKUST-GZ-Connect/issues/1'), false);
  assert.equal(isAllowedReleaseUrl('https://example.com'), false);
  assert.equal(isAllowedReleaseUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedReleaseUrl(''), false);
  assert.equal(isAllowedReleaseUrl(null), false);
  assert.equal(isAllowedReleaseUrl(undefined), false);
});

test('automatic checks are throttled to one per interval', () => {
  const now = 1786100000000;
  assert.equal(shouldAutoCheck(0, now), true, 'never checked');
  assert.equal(shouldAutoCheck(undefined, now), true, 'missing timestamp');
  assert.equal(shouldAutoCheck('junk', now), true, 'unparseable timestamp');
  assert.equal(shouldAutoCheck(now - AUTO_CHECK_INTERVAL_MS + 1000, now), false, 'inside the window');
  assert.equal(shouldAutoCheck(now - AUTO_CHECK_INTERVAL_MS, now), true, 'window elapsed');
  assert.equal(shouldAutoCheck(now - 2 * AUTO_CHECK_INTERVAL_MS, now), true, 'long overdue');
});
