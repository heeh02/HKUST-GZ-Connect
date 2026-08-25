'use strict';

const { ROUTE_CAMPUS, ROUTE_DIRECT, routeForUrl } = require('../../routing/policy/campus-route');
const { isIsolatedNetworkHost } = require('../../routing/policy/host-safety');

const MAX_BUILTIN_RESOURCES = 32;
const MAX_CUSTOM_RESOURCES = 32;
// P1 retains the 1.x visible shelf limit. Builtin and custom source documents
// remain independently lossless up to their own limits; projection decides
// which entries are currently visible without rewriting the stored sources.
const MAX_MERGED_RESOURCES = 32;
const MAX_RESOURCE_DOCUMENT_BYTES = 256 * 1024;
const MAX_RESOURCE_ID_LENGTH = 40;
const MAX_RESOURCE_NAME_LENGTH = 40;
const MAX_RESOURCE_DESCRIPTION_LENGTH = 80;
const MAX_RESOURCE_URL_LENGTH = 2048;
const MAX_RESOURCE_KEYWORDS = 12;
const MAX_RESOURCE_KEYWORD_LENGTH = 40;
const BUILTIN_RESOURCE_DOCUMENT_VERSION = 1;
const RESOURCE_CATEGORIES = Object.freeze([
  'common',
  'academic',
  'campus-service',
  'custom',
]);
const SAFE_RESOURCE_ID = /^[a-z0-9-]+$/u;
const SAFE_RESOURCE_REF = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, allowed, required, name) {
  const source = plainObject(value, name);
  if (Object.keys(source).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(source, key))) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return source;
}

function boundedText(value, maxLength, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be text`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maxLength ||
      /[\u0000-\u001f\u007f<>]/u.test(result)) {
    throw new TypeError(`${name} has an invalid value`);
  }
  return result;
}

function normalizedWebUrl(value, { reviewed = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > MAX_RESOURCE_URL_LENGTH) {
    throw new TypeError('resource URL has an invalid value');
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('resource URL is invalid'); }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash ||
      !['http:', 'https:'].includes(parsed.protocol) || (reviewed && parsed.protocol !== 'https:')) {
    throw new TypeError('resource URL has an unsafe origin');
  }
  const canonical = parsed.href;
  if (canonical.length > MAX_RESOURCE_URL_LENGTH) {
    throw new TypeError('resource URL has an invalid value');
  }
  return canonical;
}

function normalizedResource(value, {
  builtin,
  reviewed,
  exact,
  defaultRoute = ROUTE_CAMPUS,
} = {}) {
  const source = exact
    ? exactKeys(value, ['id', 'name', 'description', 'url', 'route', 'category', 'keywords'],
      ['id', 'name', 'description', 'url'], 'WebResource')
    : plainObject(value, 'WebResource');
  const id = boundedText(source.id, MAX_RESOURCE_ID_LENGTH, 'resource id');
  if (!SAFE_RESOURCE_ID.test(id)) throw new TypeError('resource id has an invalid value');
  const route = source.route == null ? defaultRoute : source.route;
  if (route !== ROUTE_CAMPUS && route !== ROUTE_DIRECT) {
    throw new TypeError('resource route is unsupported');
  }
  const category = source.category == null
    ? (builtin === true ? 'common' : 'custom')
    : source.category;
  if (!RESOURCE_CATEGORIES.includes(category) || (builtin !== true && category !== 'custom')) {
    throw new TypeError('resource category is unsupported');
  }
  const rawKeywords = source.keywords == null ? [] : source.keywords;
  if (!Array.isArray(rawKeywords) || rawKeywords.length > MAX_RESOURCE_KEYWORDS) {
    throw new TypeError('resource keywords have an invalid count');
  }
  const keywords = rawKeywords.map((keyword) => (
    boundedText(keyword, MAX_RESOURCE_KEYWORD_LENGTH, 'resource keyword')
  ));
  if (new Set(keywords).size !== keywords.length) {
    throw new TypeError('resource keywords contain a duplicate');
  }
  const url = normalizedWebUrl(source.url, { reviewed });
  if (route === ROUTE_DIRECT && isIsolatedNetworkHost(new URL(url).hostname)) {
    throw new TypeError('private or local resources cannot use the Direct route');
  }
  return deepFreeze({
    id,
    name: boundedText(source.name, MAX_RESOURCE_NAME_LENGTH, 'resource name'),
    description: boundedText(
      source.description,
      MAX_RESOURCE_DESCRIPTION_LENGTH,
      'resource description',
      { allowEmpty: true },
    ),
    url,
    route,
    category,
    keywords: deepFreeze(keywords),
    builtin: builtin === true,
  });
}

function validateUniqueResources(resources, name) {
  if (new Set(resources.map(({ id }) => id)).size !== resources.length ||
      new Set(resources.map(({ url }) => url)).size !== resources.length) {
    throw new TypeError(`${name} contains a duplicate resource`);
  }
  return deepFreeze(resources);
}

function validateBuiltinResourcesRef(value) {
  if (typeof value !== 'string' || !SAFE_RESOURCE_REF.test(value)) {
    throw new TypeError('builtinResourcesRef has an invalid value');
  }
  return value;
}

function validateBuiltinResourceDocument(value) {
  if (!Array.isArray(value) || value.length > MAX_BUILTIN_RESOURCES) {
    throw new TypeError('builtin resource document has an invalid resource count');
  }
  return validateUniqueResources(value.map((resource) => normalizedResource(resource, {
    builtin: true,
    reviewed: true,
    exact: true,
  })), 'builtin resource document');
}

function validateRuntimeBuiltinResources(value) {
  if (!Array.isArray(value) || value.length > MAX_BUILTIN_RESOURCES) {
    throw new TypeError('runtime builtin resources have an invalid resource count');
  }
  return validateUniqueResources(value.map((resource) => {
    const source = exactKeys(
      resource,
      ['id', 'name', 'description', 'url', 'route', 'category', 'keywords', 'builtin'],
      ['id', 'name', 'description', 'url', 'route', 'category', 'keywords', 'builtin'],
      'RuntimeWebResource',
    );
    if (source.builtin !== true) throw new TypeError('runtime builtin resource lost its origin');
    const { builtin: _builtin, ...document } = source;
    return normalizedResource(document, {
      builtin: true,
      reviewed: true,
      exact: true,
    });
  }), 'runtime builtin resources');
}

function parseBuiltinResourceDocument(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (!data.length || data.length > MAX_RESOURCE_DOCUMENT_BYTES) {
    throw new TypeError('builtin resource document has an invalid size');
  }
  let parsed;
  try { parsed = JSON.parse(data.toString('utf8')); }
  catch { throw new TypeError('builtin resource document is not valid JSON'); }
  const document = exactKeys(
    parsed,
    ['schemaVersion', 'resources'],
    ['schemaVersion', 'resources'],
    'builtin resource document',
  );
  if (document.schemaVersion !== BUILTIN_RESOURCE_DOCUMENT_VERSION) {
    throw new TypeError('builtin resource document version is unsupported');
  }
  return validateBuiltinResourceDocument(document.resources);
}

function validateCustomResourceDocument(value) {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_RESOURCES) {
    throw new TypeError('custom resource document has an invalid resource count');
  }
  return validateUniqueResources(value.map((resource) => normalizedResource(resource, {
    builtin: false,
    reviewed: false,
    exact: true,
  })), 'custom resource document');
}

function normalizeLegacyCustomResource(value, defaultRoute) {
  try {
    return normalizedResource(value, {
      builtin: false,
      reviewed: false,
      exact: false,
      defaultRoute,
    });
  } catch {
    return null;
  }
}

function normalizeResource(value) {
  if (!value || typeof value !== 'object') return null;
  let route = value.route === ROUTE_DIRECT || value.route === ROUTE_CAMPUS
    ? value.route
    : routeForUrl(value.url);
  try {
    if (route === ROUTE_DIRECT && isIsolatedNetworkHost(new URL(value.url).hostname)) {
      route = ROUTE_CAMPUS;
    }
  } catch {}
  return normalizeLegacyCustomResource({
    id: String(value.id || '').trim(),
    name: String(value.name || '').trim(),
    description: String(value.description || '').trim(),
    url: String(value.url || '').trim(),
    route,
    category: value.category,
    keywords: value.keywords,
  }, route);
}

function normalizeCustomResources(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const seenUrls = new Set();
  return input
    .slice(0, MAX_CUSTOM_RESOURCES)
    .map((value) => normalizeResource(value))
    .filter((resource) => {
      if (!resource || seenIds.has(resource.id) || seenUrls.has(resource.url)) return false;
      seenIds.add(resource.id);
      seenUrls.add(resource.url);
      return true;
    })
    .map(({ builtin, ...resource }) => resource);
}

module.exports = {
  BUILTIN_RESOURCE_DOCUMENT_VERSION,
  MAX_BUILTIN_RESOURCES,
  MAX_CUSTOM_RESOURCES,
  MAX_MERGED_RESOURCES,
  MAX_RESOURCE_DESCRIPTION_LENGTH,
  MAX_RESOURCE_DOCUMENT_BYTES,
  MAX_RESOURCE_ID_LENGTH,
  MAX_RESOURCE_NAME_LENGTH,
  MAX_RESOURCE_URL_LENGTH,
  MAX_RESOURCE_KEYWORDS,
  MAX_RESOURCE_KEYWORD_LENGTH,
  RESOURCE_CATEGORIES,
  normalizeCustomResources,
  normalizeLegacyCustomResource,
  normalizeResource,
  parseBuiltinResourceDocument,
  validateBuiltinResourceDocument,
  validateBuiltinResourcesRef,
  validateCustomResourceDocument,
  validateRuntimeBuiltinResources,
};
