'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const desktopRoot = path.resolve(__dirname, '..', '..', '..', '..');
const {
  MAX_BUILTIN_RESOURCES,
  MAX_CUSTOM_RESOURCES,
  normalizeCustomResources,
  parseBuiltinResourceDocument,
  validateBuiltinResourceDocument,
  validateBuiltinResourcesRef,
  validateCustomResourceDocument,
  validateRuntimeBuiltinResources,
} = require('../../../../lib/resources/schema/campus-resource-contract');

const sourceFile = path.join(
  desktopRoot,
  'assets',
  'profiles',
  'hkustgz',
  'builtin-resources.json',
);

function resource(index, overrides = {}) {
  return {
    id: `resource-${index}`,
    name: `Resource ${index}`,
    description: '',
    url: `https://resource-${index}.example.edu/`,
    route: 'campus',
    ...overrides,
  };
}

test('the sole reviewed resource document is bounded, frozen and route-compatible', () => {
  const resources = parseBuiltinResourceDocument(fs.readFileSync(sourceFile));
  assert.equal(resources.length, 15);
  assert.equal(resources[0].route, 'campus');
  assert.equal(resources[4].route, 'direct');
  assert.equal(resources[0].category, 'campus-service');
  assert.deepEqual(resources[5].keywords, ['Canvas', '课程', '作业', '教学']);
  assert.equal(resources[0].schemaVersion, 1);
  assert.equal(resources[0].reviewed, true);
  assert.deepEqual(resources[0].localizedName, { zh: '学校主页', en: 'School Homepage' });
  assert.equal(resources[0].iconKey, null);
  for (const id of [
    'sis', 'class-schedule', 'grade-reporting', 'exam-scheduling', 'room-booking',
    'class-enrollment-request', 'thesis-exam', 'academic-edoc', 'ug-major-selection',
  ]) assert.equal(resources.some((resource) => resource.id === id), true, id);
  assert.equal(Object.isFrozen(resources), true);
  assert.equal(Object.isFrozen(resources[0]), true);
  assert.equal(validateBuiltinResourcesRef('hkustgz-builtin-resources'), 'hkustgz-builtin-resources');
});

test('reviewed resource errors are explicit and never truncate or filter', () => {
  assert.throws(() => validateBuiltinResourceDocument(Array.from(
    { length: MAX_BUILTIN_RESOURCES + 1 },
    (_, index) => resource(index),
  )), /resource count/u);
  for (const overrides of [
    { name: 'n'.repeat(41) },
    { description: 'd'.repeat(81) },
    { route: 'unknown' },
    { url: 'http://resource.example.edu/' },
    { url: 'https://127.0.0.1/', route: 'direct' },
    { unknown: true },
  ]) assert.throws(() => validateBuiltinResourceDocument([resource(1, overrides)]));
  assert.throws(() => validateBuiltinResourceDocument([resource(1), resource(1)]), /duplicate/u);
  assert.throws(() => parseBuiltinResourceDocument('{not-json}'), /valid JSON/u);
  assert.throws(
    () => parseBuiltinResourceDocument(JSON.stringify({ schemaVersion: 2, resources: [] })),
    /version/u,
  );
  assert.throws(() => parseBuiltinResourceDocument(JSON.stringify([])), /plain object/u);
  assert.throws(() => validateBuiltinResourcesRef('../resources.json'), /invalid/u);
  assert.throws(() => validateBuiltinResourceDocument([
    resource(1, { url: `https://resource.example.edu/${'界'.repeat(600)}` }),
  ]), /URL has an invalid value/u);
});

test('reviewed normalization is idempotent across package and runtime validation', () => {
  const first = validateBuiltinResourceDocument([resource(1)]);
  const second = validateRuntimeBuiltinResources(first);
  assert.deepEqual(second, first);
});

test('runtime custom resources have a separate strict limit and validation boundary', () => {
  assert.equal(validateCustomResourceDocument([resource(1)]).length, 1);
  assert.throws(() => validateCustomResourceDocument(Array.from(
    { length: MAX_CUSTOM_RESOURCES + 1 },
    (_, index) => resource(index),
  )), /resource count/u);
  assert.throws(() => validateCustomResourceDocument([resource(1, { name: 'n'.repeat(41) })]));
});

test('legacy custom resources are projected without persisted query material', () => {
  const [projected] = normalizeCustomResources([resource(1, {
    url: 'https://resource.example.edu/start?ticket=temporary&view=student',
  })]);
  assert.equal(projected.url, 'https://resource.example.edu/start');
});
