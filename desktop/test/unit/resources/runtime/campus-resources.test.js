'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const desktopRoot = path.resolve(__dirname, '..', '..', '..', '..');
const {
  mergeCampusResources,
  mergeWebResourceLibrary,
  normalizeCustomResources,
  normalizeResource,
  projectCampusResources,
  projectWebResourceLibrary,
  resourceActivityAliases,
} = require('../../../../lib/resources/runtime/campus-resources');
const {
  MAX_BUILTIN_RESOURCES,
  parseBuiltinResourceDocument,
  validateBuiltinResourceDocument,
} = require('../../../../lib/resources/schema/campus-resource-contract');
const {
  ROUTE_CAMPUS,
  ROUTE_DIRECT,
  partitionForRoute,
  proxyConfigForRoute,
  routeForUrl,
} = require('../../../../lib/routing/policy/campus-route');

test('bundled campus resources are unique reviewed HTTPS links', () => {
  const resources = parseBuiltinResourceDocument(fs.readFileSync(path.join(
    desktopRoot,
    'assets',
    'profiles',
    'hkustgz',
    'builtin-resources.json',
  )));
  assert.ok(resources.length >= 3);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
  for (const resource of resources) {
    assert.match(resource.url, /^https:\/\/[^/]+/);
    assert.ok(resource.name.length > 0);
  }
});

test('reviewed resources fail closed instead of truncating or filtering', () => {
  const resource = (index, overrides = {}) => ({
    id: `resource-${index}`,
    name: `Resource ${index}`,
    description: '',
    url: `https://resource-${index}.example.edu/`,
    route: 'campus',
    ...overrides,
  });
  assert.throws(
    () => validateBuiltinResourceDocument(Array.from(
      { length: MAX_BUILTIN_RESOURCES + 1 },
      (_, index) => resource(index),
    )),
    /resource count/u,
  );
  for (const overrides of [
    { name: 'n'.repeat(41) },
    { description: 'd'.repeat(81) },
    { route: 'unknown' },
    { url: 'http://reviewed.example.edu/' },
    { url: 'https://127.0.0.1/', route: 'direct' },
    { script: true },
  ]) assert.throws(() => validateBuiltinResourceDocument([resource(1, overrides)]));
});

test('invalid or executable resource entries are rejected', () => {
  assert.equal(normalizeResource({ id: 'bad space', name: 'Bad', url: 'https://example.com' }), null);
  assert.equal(normalizeResource({ id: 'bad', name: 'Bad', url: 'javascript:alert(1)' }), null);
});

test('generic URL fallback contains no school or partner defaults and fails safe to campus', () => {
  assert.equal(routeForUrl('https://outlook.office.com/owa/'), ROUTE_CAMPUS);
  assert.equal(routeForUrl('https://hkust-gz.instructure.com/'), ROUTE_CAMPUS);
  assert.equal(routeForUrl('https://onestop-online.hkust-gz.edu.cn/'), ROUTE_CAMPUS);
});

test('route proxy configs stay isolated from system networking', () => {
  assert.deepEqual(proxyConfigForRoute(ROUTE_CAMPUS, 6180), {
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:6180',
    proxyBypassRules: '<-loopback>',
  });
  assert.deepEqual(proxyConfigForRoute(ROUTE_DIRECT, 6180), { mode: 'direct' });
  assert.equal(partitionForRoute(ROUTE_CAMPUS), 'persist:campus-workspace-campus');
  assert.equal(partitionForRoute(ROUTE_DIRECT), 'persist:campus-workspace-direct');
});

test('custom resources are bounded, normalized, and merged after built-ins', () => {
  const custom = normalizeCustomResources([
    { id: 'portal', name: '自定义门户', url: 'https://example.com', route: 'direct' },
    { id: 'portal', name: '重复', url: 'https://duplicate.example.com' },
    { id: 'bad', name: '', url: 'https://bad.example.com' },
  ]);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].route, ROUTE_DIRECT);
  const merged = mergeCampusResources(validateBuiltinResourceDocument([
    {
      id: 'home', name: '学校主页', description: '',
      url: 'https://www.hkust-gz.edu.cn/', route: ROUTE_CAMPUS,
      category: 'common', keywords: [],
    },
  ]), custom);
  assert.deepEqual(merged.map((resource) => resource.id), ['home', 'portal']);
  assert.equal(merged[0].builtin, true);
  assert.equal(merged[1].builtin, false);
});

test('legacy direct private shortcuts are migrated to the campus tunnel', () => {
  const [resource] = normalizeCustomResources([{
    id: 'legacy-router',
    name: 'Legacy private site',
    description: '',
    url: 'http://192.168.1.10:8080/',
    route: 'direct',
  }]);
  assert.equal(resource.route, 'campus');
});

test('runtime projection retains lossless sources while preserving the 32-visible compatibility cap', () => {
  const builtins = validateBuiltinResourceDocument(Array.from({ length: 32 }, (_, index) => ({
    id: `builtin-${index}`,
    name: `Builtin ${index}`,
    description: '',
    url: `https://builtin-${index}.example.edu/`,
    route: 'campus',
  })));
  const custom = Array.from({ length: 32 }, (_, index) => ({
    id: `custom-${index}`,
    name: `Custom ${index}`,
    description: '',
    url: `https://custom-${index}.example.edu/`,
    route: 'campus',
  }));
  const projection = projectCampusResources(builtins, custom);
  assert.equal(projection.resources.length, 32);
  assert.deepEqual(projection.receipt, {
    sourceCount: 64,
    visibleCount: 32,
    conflictCount: 0,
    hiddenCount: 32,
  });
  assert.equal(custom.length, 32, 'projection must not rewrite the custom source');
});

test('P8 WebResource library exposes both bounded sources without the legacy shelf cap', () => {
  const builtins = validateBuiltinResourceDocument(Array.from({ length: 32 }, (_, index) => ({
    id: `builtin-${index}`,
    name: `Builtin ${index}`,
    description: '',
    url: `https://builtin-${index}.example.edu/`,
    route: 'campus',
  })));
  const custom = Array.from({ length: 32 }, (_, index) => ({
    id: `custom-${index}`,
    name: `Custom ${index}`,
    description: '',
    url: `https://custom-${index}.example.edu/`,
    route: 'campus',
  }));
  const projection = projectWebResourceLibrary(builtins, custom);
  assert.equal(projection.resources.length, 64);
  assert.equal(projection.receipt.hiddenCount, 0);
  assert.equal(mergeWebResourceLibrary(builtins, custom).length, 64);
});

test('legacy cross-source duplicates keep builtin-first startup behavior and produce a receipt', () => {
  const builtins = validateBuiltinResourceDocument([{
    id: 'home',
    name: 'Home',
    description: '',
    url: 'https://www.example.edu/',
    route: 'campus',
  }]);
  const custom = [{
    id: 'legacy-home-copy',
    name: 'Old duplicate',
    description: '',
    url: 'https://www.example.edu/',
    route: 'campus',
  }];
  const projection = projectCampusResources(builtins, custom);
  assert.deepEqual(projection.resources.map(({ id }) => id), ['home']);
  assert.deepEqual(projection.receipt, {
    sourceCount: 2,
    visibleCount: 1,
    conflictCount: 1,
    hiddenCount: 0,
  });
  assert.equal(custom.length, 1, 'legacy duplicate remains in settings so the user can delete it');
  assert.deepEqual(mergeCampusResources(builtins, custom), projection.resources);
  assert.deepEqual(resourceActivityAliases(builtins, custom), [{
    from: 'legacy-home-copy', to: 'home',
  }]);
});
