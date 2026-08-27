'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const fixture = require('../../../../e2e/fixtures/2.0.1-workspace-upgrade.json');
const packageDocument = require('../../../../package.json');
const {
  parseBuiltinResourceDocument,
} = require('../../../../lib/resources/schema/campus-resource-contract');
const {
  mergeWebResourceLibrary,
} = require('../../../../lib/resources/runtime/campus-resources');
const {
  projectResourceActivity,
} = require('../../../../lib/resources/runtime/resource-activity');
const {
  ResourceActivityStore,
} = require('../../../../lib/resources/runtime/resource-activity-store');
const {
  validateLocalResourcesDocument,
} = require('../../../../lib/persistence/schema/profile-workspace-documents');
const {
  loadRoutingRules,
} = require('../../../../lib/routing/rules/routing-rule-store');

const desktopRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reviewedResourcesFile = path.join(
  desktopRoot, 'assets', 'profiles', 'hkustgz', 'builtin-resources.json',
);

function writeFixture(file, document) {
  fs.writeFileSync(file, `${JSON.stringify(document)}\n`, { mode: 0o600 });
}

test('2.0 workspace upgrade keeps URLs favorites recents hidden sites and routing', (t) => {
  assert.equal(packageDocument.name, 'hkustgzconnect');
  assert.equal(packageDocument.build.appId, 'cn.edu.hkust-gz.connect');

  const reviewed = parseBuiltinResourceDocument(fs.readFileSync(reviewedResourcesFile));
  const reviewedIds = new Set(reviewed.map(({ id }) => id));
  for (const id of fixture.previousBuiltinResourceIds) {
    assert.equal(reviewedIds.has(id), true, `published resource ID disappeared: ${id}`);
  }

  const local = validateLocalResourcesDocument(fixture.localResources);
  const resources = mergeWebResourceLibrary(
    reviewed, local.resources, local.hiddenBuiltinResourceIds,
  );
  assert.equal(resources.some(({ id }) => id === 'room-booking'), false);
  assert.equal(resources.some(({ id, url }) => id === 'custom-upgrade-fixture' &&
    url === 'https://portal.upgrade-fixture.example.edu/'), true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-upgrade-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const favoritesFile = path.join(root, 'favorites.json');
  const recentFile = path.join(root, 'recent-resources.json');
  const routingFile = path.join(root, 'routing-rules.json');
  writeFixture(favoritesFile, fixture.favorites);
  writeFixture(recentFile, fixture.recentResources);
  writeFixture(routingFile, fixture.routingRules);

  const restarted = new ResourceActivityStore({ favoritesFile, recentFile });
  assert.deepEqual(restarted.snapshot(), {
    favorites: fixture.favorites,
    recent: fixture.recentResources,
  });
  const projected = projectResourceActivity(
    resources, fixture.favorites, fixture.recentResources,
  );
  for (const id of fixture.favorites.entries) {
    assert.equal(projected.find((resource) => resource.id === id)?.favorite, true, id);
  }
  assert.equal(projected.find(({ id }) => id === 'custom-upgrade-fixture')?.lastOpenedAt,
    1700000002000);
  assert.deepEqual(loadRoutingRules(routingFile), fixture.routingRules.rules);
});
