'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { ROUTE_CAMPUS, ROUTE_DIRECT } = require('../routing/policy/campus-route');
const {
  normalizeDomainRoutePolicy,
  normalizeResourceRoutes,
} = require('../routing/policy/domain-route-policy');
const { normalizeRoutingRules, normalizeRuleHost } = require('../routing/rules/routing-rule-store');
const {
  normalizeGatewayOrigin,
  validateProfileId,
  validateSchoolProfileDocument,
} = require('../profiles/schema/school-profile-schema');

const PROFILE_NETWORK_RULES_VERSION = 1;
const MAX_CAMPUS_CIDRS = 64;
const SHA256 = /^[a-f0-9]{64}$/u;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function ipv4Integer(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) ||
      value < 0 || value > 255)) {
    throw new TypeError('campus CIDR address is invalid');
  }
  return octets.reduce((result, value) => ((result << 8) | value) >>> 0, 0);
}

function normalizeCampusCidr(value) {
  if (typeof value !== 'string' || value.length > 32 ||
      !/^[0-9.]+\/(?:[0-9]|[12][0-9]|3[0-2])$/u.test(value)) {
    throw new TypeError('campus CIDR is invalid');
  }
  const [address, prefixText] = value.split('/');
  if (net.isIP(address) !== 4) throw new TypeError('campus CIDR must be canonical IPv4');
  const prefix = Number(prefixText);
  const numeric = ipv4Integer(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if ((numeric & mask) >>> 0 !== numeric) {
    throw new TypeError('campus CIDR must use its network address');
  }
  return `${address}/${prefix}`;
}

function canonicalCampusCidrs(value) {
  if (!Array.isArray(value) || value.length > MAX_CAMPUS_CIDRS) {
    throw new TypeError('campus CIDRs must be a bounded array');
  }
  const cidrs = value.map(normalizeCampusCidr).sort();
  if (new Set(cidrs).size !== cidrs.length) throw new TypeError('campus CIDRs are duplicated');
  return cidrs;
}

function canonicalUserRules(value) {
  if (!Array.isArray(value)) throw new TypeError('account domain rules must be an array');
  const rules = normalizeRoutingRules(value);
  if (rules.length !== value.length) {
    throw new TypeError('account domain rules must already be canonical and unique');
  }
  return rules;
}

function canonicalResources(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const routes = normalizeResourceRoutes(value);
  if (routes.length !== value.length) {
    throw new TypeError(`${name} must contain canonical unique HTTP resources`);
  }
  return value;
}

function canonicalAccountCampusDomains(value) {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError('account campus domains must be a bounded array');
  }
  const domains = value.map((entry) => normalizeRuleHost(entry));
  if (new Set(domains).size !== domains.length) {
    throw new TypeError('account campus domains are duplicated');
  }
  return domains;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function createProfileNetworkRules({
  profileDocument,
  accountCampusDomains = [],
  userRules = [],
  customResources = [],
  serverResources = [],
  campusCidrs = [],
} = {}) {
  const profile = validateSchoolProfileDocument(profileDocument);
  const gateway = normalizeGatewayOrigin(profileDocument.gateway.origin);
  const schoolDomains = [...new Set([
    ...profile.browser.campusDomains,
    ...canonicalAccountCampusDomains(accountCampusDomains),
  ])];
  const domainPolicy = normalizeDomainRoutePolicy({
    userRules: canonicalUserRules(userRules),
    customResources: canonicalResources(customResources, 'custom resources'),
    schoolDomains,
    directPartnerDomains: profile.browser.directPartnerDomains,
    serverResources: canonicalResources(serverResources, 'server resources'),
  });
  const unsigned = {
    schemaVersion: PROFILE_NETWORK_RULES_VERSION,
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    profileCredentialBindingRevision: profile.profileCredentialBindingRevision,
    defaultRoute: ROUTE_CAMPUS,
    gatewayBypass: [gateway.hostname],
    campusCidrs: canonicalCampusCidrs(campusCidrs),
    domainPolicy,
  };
  return deepFreeze({ ...unsigned, rulesDigest: sha256(unsigned) });
}

function positive(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} is invalid`);
  return value;
}

function validateDomainEntries(value, name) {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError(`${name} must be a bounded array`);
  }
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.getPrototypeOf(entry) !== Object.prototype ||
        JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['host', 'route']) ||
        ![ROUTE_CAMPUS, ROUTE_DIRECT].includes(entry.route)) {
      throw new TypeError(`${name} contains an invalid entry`);
    }
    return Object.freeze({ host: normalizeRuleHost(entry.host), route: entry.route });
  });
  if (new Set(entries.map((entry) => `${entry.host}\0${entry.route}`)).size !== entries.length) {
    throw new TypeError(`${name} contains a duplicate`);
  }
  return Object.freeze(entries);
}

function validateDomainPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('domain policy is invalid');
  }
  const keys = [
    'userExact', 'userSubdomains', 'customExact', 'builtinSubdomains', 'serverExact',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new TypeError('domain policy has an invalid schema');
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [
    key, validateDomainEntries(value[key], `domain policy ${key}`),
  ])));
}

function validateProfileNetworkRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'campusCidrs', 'defaultRoute', 'domainPolicy', 'gatewayBypass',
        'profileCredentialBindingRevision', 'profileId', 'profileRevision',
        'rulesDigest', 'schemaVersion',
      ].sort()) || !SHA256.test(String(value.rulesDigest || '')) ||
      value.schemaVersion !== PROFILE_NETWORK_RULES_VERSION || value.defaultRoute !== ROUTE_CAMPUS ||
      !Array.isArray(value.gatewayBypass) || value.gatewayBypass.length !== 1) {
    throw new TypeError('Profile network rules are invalid');
  }
  const gateway = normalizeGatewayOrigin(`https://${value.gatewayBypass[0]}`);
  if (gateway.hostname !== value.gatewayBypass[0]) {
    throw new TypeError('Gateway bypass host is not canonical');
  }
  const normalized = {
    schemaVersion: PROFILE_NETWORK_RULES_VERSION,
    profileId: validateProfileId(value.profileId),
    profileRevision: positive(value.profileRevision, 'profileRevision'),
    profileCredentialBindingRevision: positive(
      value.profileCredentialBindingRevision,
      'profileCredentialBindingRevision',
    ),
    defaultRoute: ROUTE_CAMPUS,
    gatewayBypass: [gateway.hostname],
    campusCidrs: canonicalCampusCidrs(value.campusCidrs),
    domainPolicy: validateDomainPolicy(value.domainPolicy),
  };
  if (sha256(normalized) !== value.rulesDigest) {
    throw new TypeError('Profile network rules failed their digest binding');
  }
  return deepFreeze({ ...normalized, rulesDigest: value.rulesDigest });
}

function profileNetworkRulesView(value) {
  const rules = validateProfileNetworkRules(value);
  const domainEntries = Object.values(rules.domainPolicy)
    .reduce((count, entries) => count + entries.length, 0);
  return Object.freeze({
    schemaVersion: PROFILE_NETWORK_RULES_VERSION,
    profileId: rules.profileId,
    profileRevision: rules.profileRevision,
    rulesDigest: rules.rulesDigest,
    domainRuleCount: domainEntries,
    campusCidrCount: rules.campusCidrs.length,
  });
}

module.exports = {
  MAX_CAMPUS_CIDRS,
  PROFILE_NETWORK_RULES_VERSION,
  createProfileNetworkRules,
  normalizeCampusCidr,
  profileNetworkRulesView,
  validateProfileNetworkRules,
};
