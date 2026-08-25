'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  buildSshProxyCommand,
} = require('./external-proxy-config');
const {
  inspectManagedBlock,
  managedBlockMatches,
  removeManagedBlock,
  upsertManagedBlock,
} = require('./managed-text-block');
const {
  validateProfileNetworkRules,
} = require('./profile-network-rules');

const OPENSSH_INCLUDE = 'Include ~/.ssh/campus-connect/*.conf';
const OPENSSH_INCLUDE_BLOCK = Object.freeze({ commentPrefix: '#', blockId: 'openssh-include' });

function pathFlavor(value) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\)/u.test(value) ? path.win32 : path.posix;
}

function assertOpenSshMainTarget(value) {
  if (typeof value !== 'string') throw new TypeError('OpenSSH config target is invalid');
  const flavor = pathFlavor(value);
  if (!flavor.isAbsolute(value) || flavor.normalize(value) !== value ||
      flavor.basename(value) !== 'config' || flavor.basename(flavor.dirname(value)) !== '.ssh') {
    throw new TypeError('OpenSSH managed target must be the selected .ssh/config');
  }
  return value;
}

function openSshProfileTarget(mainConfigFile, profileId) {
  const main = assertOpenSshMainTarget(mainConfigFile);
  if (typeof profileId !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(profileId)) {
    throw new TypeError('OpenSSH Profile identity is invalid');
  }
  const flavor = pathFlavor(main);
  return flavor.join(flavor.dirname(main), 'campus-connect', `${profileId}.conf`);
}

function rulePatterns(kind, host) {
  return kind === 'DOMAIN-SUFFIX' ? `${host} *.${host}` : host;
}

function buildOpenSshProfileBlock({ networkRules, helperPath, credentialFile } = {}) {
  const rules = validateProfileNetworkRules(networkRules);
  const proxyCommand = buildSshProxyCommand({
    helperPath, credentialFile, profileId: rules.profileId,
  }).split('\n').at(-1);
  const blocks = [];
  const seen = new Set();
  let campusCount = 0;
  const add = (kind, host, route, source) => {
    const patterns = rulePatterns(kind, host);
    if (seen.has(patterns)) return;
    seen.add(patterns);
    if (route === 'campus') campusCount += 1;
    blocks.push([
      `# ${source}: ${route}`,
      `Host ${patterns}`,
      `    ${route === 'campus' ? proxyCommand : 'ProxyCommand none'}`,
    ].join('\n'));
  };
  for (const host of rules.gatewayBypass) add('DOMAIN', host, 'direct', 'gateway-bypass');
  for (const [source, kind] of [
    ['userExact', 'DOMAIN'],
    ['userSubdomains', 'DOMAIN-SUFFIX'],
    ['customExact', 'DOMAIN'],
    ['builtinSubdomains', 'DOMAIN-SUFFIX'],
    ['serverExact', 'DOMAIN'],
  ]) {
    for (const entry of rules.domainPolicy[source]) add(kind, entry.host, entry.route, source);
  }
  if (!campusCount) {
    const error = new Error('OpenSSH adapter has no campus hostname rule');
    error.code = 'INTEGRATION_ADAPTER_UNAVAILABLE';
    throw error;
  }
  return [
    `# Profile ${rules.profileId}; network rules ${rules.rulesDigest}`,
    '# OpenSSH Port remains the remote SSH service port; Campus proxying uses only ProxyCommand.',
    ...blocks,
  ].join('\n\n');
}

function installOpenSshInclude(source) {
  const observed = inspectManagedBlock(source, OPENSSH_INCLUDE_BLOCK);
  if (!observed.present && source.split(/\r?\n/u).some((line) => line.trim() === OPENSSH_INCLUDE)) {
    return Object.freeze({ source, owned: false, state: 'preexisting' });
  }
  return Object.freeze({
    source: upsertManagedBlock(source, OPENSSH_INCLUDE, OPENSSH_INCLUDE_BLOCK),
    owned: true,
    state: observed.present ? 'update' : 'install',
  });
}

function removeOpenSshInclude(source) {
  return removeManagedBlock(source, OPENSSH_INCLUDE_BLOCK);
}

function installOpenSshProfile(source, options) {
  const rules = validateProfileNetworkRules(options?.networkRules);
  return upsertManagedBlock(
    source,
    buildOpenSshProfileBlock(options),
    { commentPrefix: '#', blockId: `openssh-profile-${rules.profileId}` },
  );
}

function removeOpenSshProfile(source, profileId) {
  return removeManagedBlock(source, {
    commentPrefix: '#', blockId: `openssh-profile-${profileId}`,
  });
}

function validateOpenSshManagedFiles({ mainSource, profileSource, options } = {}) {
  try {
    const rules = validateProfileNetworkRules(options?.networkRules);
    const includePresent = managedBlockMatches(
      mainSource, OPENSSH_INCLUDE, OPENSSH_INCLUDE_BLOCK,
    ) || mainSource.split(/\r?\n/u).some((line) => line.trim() === OPENSSH_INCLUDE);
    return includePresent && managedBlockMatches(
      profileSource,
      buildOpenSshProfileBlock(options),
      { commentPrefix: '#', blockId: `openssh-profile-${rules.profileId}` },
    );
  } catch { return false; }
}

function openSshManagedBlockDigest(source, blockId) {
  const observed = inspectManagedBlock(source, { commentPrefix: '#', blockId });
  if (!observed.present) return null;
  return crypto.createHash('sha256').update(observed.content, 'utf8').digest('hex');
}

function validateOpenSshMainSource(source) {
  try {
    return managedBlockMatches(source, OPENSSH_INCLUDE, OPENSSH_INCLUDE_BLOCK) ||
      source.split(/\r?\n/u).some((line) => line.trim() === OPENSSH_INCLUDE);
  } catch { return false; }
}

function validateOpenSshProfileSource(source, options) {
  try {
    const rules = validateProfileNetworkRules(options?.networkRules);
    return managedBlockMatches(
      source,
      buildOpenSshProfileBlock(options),
      { commentPrefix: '#', blockId: `openssh-profile-${rules.profileId}` },
    );
  } catch { return false; }
}

function validateOpenSshRemovedSource(source, blockId) {
  try { return !inspectManagedBlock(source, { commentPrefix: '#', blockId }).present; }
  catch { return false; }
}

module.exports = {
  OPENSSH_INCLUDE,
  OPENSSH_INCLUDE_BLOCK,
  assertOpenSshMainTarget,
  buildOpenSshProfileBlock,
  installOpenSshInclude,
  installOpenSshProfile,
  openSshProfileTarget,
  openSshManagedBlockDigest,
  removeOpenSshInclude,
  removeOpenSshProfile,
  validateOpenSshManagedFiles,
  validateOpenSshMainSource,
  validateOpenSshProfileSource,
  validateOpenSshRemovedSource,
};
