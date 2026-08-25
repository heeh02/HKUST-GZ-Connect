'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AUTO_CHECK_INTERVAL_MS,
  RELEASES_API_URL,
  RELEASES_URL_PREFIX,
  checkForUpdate,
  compareVersions,
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
