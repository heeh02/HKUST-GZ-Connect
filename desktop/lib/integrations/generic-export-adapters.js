'use strict';

const {
  validateProfileNetworkRules,
} = require('./profile-network-rules');

const GENERIC_EXPORT_ADAPTERS = Object.freeze([
  'clash_yaml', 'mihomo_yaml', 'pac', 'manual_export',
]);
const MAX_GENERIC_EXPORT_BYTES = 512 * 1024;
const LOCAL_PROXY_SECRET = /^[A-Za-z0-9_-]{16,128}$/u;

function port(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1025 || result > 65535) {
    throw new TypeError('integration proxy port is invalid');
  }
  return result;
}

function withCredential(credential, callback) {
  if (!credential || typeof credential.withStrings !== 'function' || typeof callback !== 'function') {
    throw new TypeError('integration proxy credential is unavailable');
  }
  return credential.withStrings((username, password) => {
    if (!LOCAL_PROXY_SECRET.test(username) || !LOCAL_PROXY_SECRET.test(password) ||
        username === password) {
      throw new TypeError('integration proxy credential is invalid');
    }
    return callback(username, password);
  });
}

function nodeName(profileId) {
  return `Campus Connect - ${profileId}`;
}

function clashRuleLines(rulesValue, proxyName) {
  const rules = validateProfileNetworkRules(rulesValue);
  const result = [];
  const seen = new Set();
  const add = (kind, value, target, suffix = '') => {
    const line = `${kind},${value},${target}${suffix}`;
    if (!seen.has(line)) { seen.add(line); result.push(line); }
  };
  for (const host of rules.gatewayBypass) add('DOMAIN', host, 'DIRECT');
  for (const [source, kind] of [
    ['userExact', 'DOMAIN'],
    ['userSubdomains', 'DOMAIN-SUFFIX'],
    ['customExact', 'DOMAIN'],
    ['builtinSubdomains', 'DOMAIN-SUFFIX'],
    ['serverExact', 'DOMAIN'],
  ]) {
    for (const entry of rules.domainPolicy[source]) {
      add(kind, entry.host, entry.route === 'campus' ? proxyName : 'DIRECT');
    }
  }
  for (const cidr of rules.campusCidrs) add('IP-CIDR', cidr, proxyName, ',no-resolve');
  return Object.freeze(result);
}

function buildClashCompatibleYaml({ adapterId, port: rawPort, credential, networkRules } = {}) {
  if (!['clash_yaml', 'mihomo_yaml'].includes(adapterId)) {
    throw new TypeError('Clash-compatible adapter is invalid');
  }
  const rules = validateProfileNetworkRules(networkRules);
  const name = nodeName(rules.profileId);
  return withCredential(credential, (username, password) => {
    const lines = [
      `# Campus Connect ${adapterId === 'mihomo_yaml' ? 'Mihomo' : 'Clash'} export`,
      `# Profile: ${rules.profileId}; rules: ${rules.rulesDigest}`,
      'proxies:',
      `  - name: ${JSON.stringify(name)}`,
      '    type: "socks5"',
      '    server: "127.0.0.1"',
      `    port: ${port(rawPort)}`,
      `    username: ${JSON.stringify(username)}`,
      `    password: ${JSON.stringify(password)}`,
      '    udp: false',
      'rules:',
      ...clashRuleLines(rules, name).map((rule) => `  - ${JSON.stringify(rule)}`),
    ];
    return `${lines.join('\n')}\n`;
  });
}

function buildManualProxyExport({ port: rawPort, credential, networkRules } = {}) {
  const rules = validateProfileNetworkRules(networkRules);
  return withCredential(credential, (username, password) => `${JSON.stringify({
    schemaVersion: 1,
    profileId: rules.profileId,
    profileRevision: rules.profileRevision,
    rulesDigest: rules.rulesDigest,
    proxy: {
      type: 'socks5', host: '127.0.0.1', port: port(rawPort), username, password, udp: false,
    },
  }, null, 2)}\n`);
}

function validatePacSource(value) {
  if (typeof value !== 'string' || !value.includes('function FindProxyForURL') ||
      Buffer.byteLength(value, 'utf8') < 32 ||
      Buffer.byteLength(value, 'utf8') > MAX_GENERIC_EXPORT_BYTES) {
    throw new TypeError('PAC export source is invalid');
  }
  return value;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateClashCompatibleText(text) {
  const lines = text.trimEnd().split('\n');
  if (lines.length < 12 || !/^# Campus Connect (?:Clash|Mihomo) export$/u.test(lines[0]) ||
      !/^# Profile: [a-z0-9-]{1,64}; rules: [a-f0-9]{64}$/u.test(lines[1]) ||
      lines[2] !== 'proxies:' || lines[4] !== '    type: "socks5"' ||
      lines[5] !== '    server: "127.0.0.1"' || lines[10] !== 'rules:') return false;
  let name;
  let username;
  let password;
  let proxyPort;
  try {
    name = JSON.parse(lines[3].replace(/^  - name: /u, ''));
    username = JSON.parse(lines[7].replace(/^    username: /u, ''));
    password = JSON.parse(lines[8].replace(/^    password: /u, ''));
    proxyPort = port(Number(lines[6].slice('    port: '.length)));
  } catch { return false; }
  const profileId = lines[1].match(/^# Profile: ([a-z0-9-]{1,64});/u)?.[1];
  if (name !== `Campus Connect - ${profileId}` ||
      !/^    port: (?:[1-9][0-9]{3,4})$/u.test(lines[6]) ||
      proxyPort < 1025 ||
      !LOCAL_PROXY_SECRET.test(username) || !LOCAL_PROXY_SECRET.test(password) ||
      username === password || lines[9] !== '    udp: false') return false;
  for (const line of lines.slice(11)) {
    if (!line.startsWith('  - ')) return false;
    let rule;
    try { rule = JSON.parse(line.slice(4)); } catch { return false; }
    const fields = String(rule).split(',');
    if (!['DOMAIN', 'DOMAIN-SUFFIX', 'IP-CIDR'].includes(fields[0]) ||
        !fields[1] || !['DIRECT', name].includes(fields[2]) ||
        (fields.length === 4 && (fields[0] !== 'IP-CIDR' || fields[3] !== 'no-resolve')) ||
        fields.length < 3 || fields.length > 4) return false;
  }
  return true;
}

function validateManualText(text) {
  let value;
  try { value = JSON.parse(text); } catch { return false; }
  if (!exactKeys(value, ['schemaVersion', 'profileId', 'profileRevision', 'rulesDigest', 'proxy']) ||
      value.schemaVersion !== 1 || !/^[a-z0-9-]{1,64}$/u.test(value.profileId) ||
      !Number.isSafeInteger(value.profileRevision) || value.profileRevision <= 0 ||
      !/^[a-f0-9]{64}$/u.test(value.rulesDigest) ||
      !exactKeys(value.proxy, ['type', 'host', 'port', 'username', 'password', 'udp']) ||
      value.proxy.type !== 'socks5' || value.proxy.host !== '127.0.0.1' ||
      value.proxy.udp !== false || !LOCAL_PROXY_SECRET.test(value.proxy.username) ||
      !LOCAL_PROXY_SECRET.test(value.proxy.password) ||
      value.proxy.username === value.proxy.password) return false;
  try { port(value.proxy.port); } catch { return false; }
  return true;
}

function validateGenericExportPayload(adapterId, payload) {
  if (!GENERIC_EXPORT_ADAPTERS.includes(adapterId) || !Buffer.isBuffer(payload) ||
      !payload.length || payload.length > MAX_GENERIC_EXPORT_BYTES) return false;
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) return false;
  if (adapterId === 'clash_yaml' || adapterId === 'mihomo_yaml') {
    return validateClashCompatibleText(text);
  }
  if (adapterId === 'manual_export') return validateManualText(text);
  try { return validatePacSource(text) === text; } catch { return false; }
}

function buildGenericExport({
  adapterId,
  port: rawPort,
  credential = null,
  networkRules,
  pacSource = null,
} = {}) {
  if (!GENERIC_EXPORT_ADAPTERS.includes(adapterId)) {
    throw new TypeError('generic export adapter is unsupported');
  }
  let source;
  if (adapterId === 'clash_yaml' || adapterId === 'mihomo_yaml') {
    source = buildClashCompatibleYaml({
      adapterId, port: rawPort, credential, networkRules,
    });
  } else if (adapterId === 'manual_export') {
    source = buildManualProxyExport({ port: rawPort, credential, networkRules });
  } else {
    validateProfileNetworkRules(networkRules);
    source = validatePacSource(pacSource);
  }
  const payload = Buffer.from(source, 'utf8');
  if (!payload.length || payload.length > MAX_GENERIC_EXPORT_BYTES) {
    payload.fill(0);
    throw new TypeError('generic export payload exceeds its bound');
  }
  return Object.freeze({
    adapterId,
    payload,
    containsLocalProxyCredential: adapterId !== 'pac',
    ruleCount: adapterId === 'pac'
      ? 0
      : clashRuleLines(networkRules, nodeName(networkRules.profileId)).length,
  });
}

module.exports = {
  GENERIC_EXPORT_ADAPTERS,
  MAX_GENERIC_EXPORT_BYTES,
  buildClashCompatibleYaml,
  buildGenericExport,
  buildManualProxyExport,
  clashRuleLines,
  validateGenericExportPayload,
  withIntegrationCredential: withCredential,
};
