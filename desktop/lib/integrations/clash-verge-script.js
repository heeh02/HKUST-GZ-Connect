'use strict';

const path = require('node:path');
const vm = require('node:vm');
const {
  clashRuleLines,
  withIntegrationCredential,
} = require('./generic-export-adapters');
const {
  managedBlockMatches,
  removeManagedBlock,
  upsertManagedBlock,
} = require('./managed-text-block');
const {
  validateProfileNetworkRules,
} = require('./profile-network-rules');

const CLASH_VERGE_BLOCK = Object.freeze({
  commentPrefix: '//',
  blockId: 'clash-verge-rev',
});

function proxyPort(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1025 || result > 65535) {
    throw new TypeError('Clash Verge Rev proxy port is invalid');
  }
  return result;
}

function assertScriptTarget(value) {
  if (typeof value !== 'string' || path.basename(value) !== 'Script.js') {
    throw new TypeError('Clash Verge Rev managed target must be its selected global Script.js');
  }
  return value;
}

function buildClashVergeManagedBlock({ port, credential, networkRules } = {}) {
  const rules = validateProfileNetworkRules(networkRules);
  const name = `Campus Connect - ${rules.profileId}`;
  return withIntegrationCredential(credential, (username, password) => {
    const proxy = {
      name,
      type: 'socks5',
      server: '127.0.0.1',
      port: proxyPort(port),
      username,
      password,
      udp: false,
    };
    const managedRules = clashRuleLines(rules, name);
    return [
      'main = (function(__campusConnectManagedV1PreviousMain) {',
      `  const managedProfile = ${JSON.stringify(rules.profileId)};`,
      `  const managedRulesDigest = ${JSON.stringify(rules.rulesDigest)};`,
      `  const managedProxy = ${JSON.stringify(proxy)};`,
      `  const managedRules = ${JSON.stringify(managedRules)};`,
      '  return function(config, profileName) {',
      '    const next = __campusConnectManagedV1PreviousMain(config, profileName) || config || {};',
      '    const previousProxies = Array.isArray(next.proxies) ? next.proxies : [];',
      '    next.proxies = [managedProxy].concat(previousProxies.filter(function(proxy) {',
      '      return !proxy || proxy.name !== managedProxy.name;',
      '    }));',
      '    const previousRules = Array.isArray(next.rules) ? next.rules : [];',
      '    next.rules = managedRules.concat(previousRules.filter(function(rule) {',
      '      return managedRules.indexOf(rule) === -1;',
      '    }));',
      '    return next;',
      '  };',
      '})(typeof main === "function" ? main : function(config) { return config; });',
    ].join('\n');
  });
}

function installClashVergeManagedScript(source, options) {
  return upsertManagedBlock(
    source,
    buildClashVergeManagedBlock(options),
    CLASH_VERGE_BLOCK,
  );
}

function removeClashVergeManagedScript(source) {
  return removeManagedBlock(source, CLASH_VERGE_BLOCK);
}

function validateClashVergeManagedScript(source, options) {
  let block;
  try {
    block = buildClashVergeManagedBlock(options);
    if (!managedBlockMatches(source, block, CLASH_VERGE_BLOCK)) return false;
    new vm.Script(source, { filename: 'Script.js' });
    return true;
  } catch { return false; }
}

module.exports = {
  CLASH_VERGE_BLOCK,
  assertClashVergeScriptTarget: assertScriptTarget,
  buildClashVergeManagedBlock,
  installClashVergeManagedScript,
  removeClashVergeManagedScript,
  validateClashVergeManagedScript,
};
