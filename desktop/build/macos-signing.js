'use strict';

const PREFERRED_IDENTITIES = [
  ['Developer ID Application:', 'developer-id'],
  ['Apple Development:', 'apple-development'],
];

function parseCodeSigningIdentities(output) {
  return String(output || '').split('\n').flatMap((line) => {
    const match = line.match(/^\s*\d+\)\s+([A-F0-9]{6,40})\s+"([^"]+)"/i);
    if (!match) return [];
    const preferred = PREFERRED_IDENTITIES.find(([prefix]) => match[2].startsWith(prefix));
    if (!preferred) return [];
    return [{ hash: match[1].toUpperCase(), name: match[2], kind: preferred[1] }];
  });
}

function selectLocalAppleIdentity(identities) {
  for (const kind of ['developer-id', 'apple-development']) {
    const selected = identities.find((identity) => identity.kind === kind);
    if (selected) return selected;
  }
  return null;
}

function shouldDelegateSigning(environment = {}) {
  return Boolean(environment.CSC_LINK) || environment.CSC_IDENTITY_AUTO_DISCOVERY === 'true';
}

function classifyMacSignature(codesignDetails) {
  const details = String(codesignDetails || '');
  const team = details.match(/^TeamIdentifier=(.+)$/m);
  if (team && team[1].trim() && team[1].trim().toLowerCase() !== 'not set') return 'apple';
  if (/^Signature=adhoc$/mi.test(details)) return 'adhoc';
  return 'unknown';
}

module.exports = {
  classifyMacSignature,
  parseCodeSigningIdentities,
  selectLocalAppleIdentity,
  shouldDelegateSigning,
};
