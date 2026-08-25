'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  BASELINE,
  architectureErrors,
  architectureSnapshot,
  domainDependencyErrors,
  dependencyLayerErrors,
  findCycles,
  moduleExportNames,
  relativeRequires,
  rootLibraryDebtErrors,
  transitiveDependencies,
} = require('../scripts/check-architecture');

test('dependency parser accepts only static relative CommonJS imports', () => {
  assert.deepEqual(relativeRequires(`
    require('./local');
    require("../shared.js");
    require('node:fs');
    require(variable);
  `), ['./local', '../shared.js']);
});

test('transitive dependency and barrel metrics expose hidden facade complexity', () => {
  const graph = new Map([
    ['main', ['facade']],
    ['facade', ['a', 'b']],
    ['a', ['b']],
    ['b', []],
  ]);
  assert.deepEqual([...transitiveDependencies(graph, 'main')].sort(), ['a', 'b', 'facade']);
  assert.deepEqual(moduleExportNames(`
    module.exports = {
      first,
      second,
    };
  `), ['first', 'second']);
});

test('domain rules reject reverse dependencies while root legacy remains migration-compatible', () => {
  const root = path.resolve('/fixture/desktop');
  const graph = new Map([
    [path.join(root, 'lib', 'browser', 'view.js'), [
      path.join(root, 'lib', 'routing', 'policy.js'),
      path.join(root, 'lib', 'persistence', 'migration.js'),
    ]],
    [path.join(root, 'lib', 'legacy.js'), [path.join(root, 'lib', 'browser', 'view.js')]],
  ]);
  assert.deepEqual(domainDependencyErrors(graph, root), [
    'domain violation: lib/browser/view.js -> lib/persistence/migration.js',
  ]);
});

test('root debt rejects additions and requires explicit ratcheting after moves', () => {
  assert.deepEqual(rootLibraryDebtErrors(['a.js', 'new.js'], ['a.js', 'old.js']), [
    'architecture root debt was not ratcheted after moving: old.js',
    'new desktop/lib root file is forbidden: new.js',
  ]);
});

test('cycle detection reports a closed dependency path', () => {
  const graph = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
  ]);
  assert.deepEqual(findCycles(graph), [['a', 'b', 'c', 'a']]);
});

test('production dependency layers reject reverse imports into renderer, tests or build code', () => {
  const root = path.resolve('/fixture/desktop');
  const graph = new Map([
    [path.join(root, 'main.js'), [path.join(root, 'lib', 'service.js')]],
    [path.join(root, 'lib', 'service.js'), [path.join(root, 'renderer', 'app.js')]],
    [path.join(root, 'renderer', 'feature.js'), [path.join(root, 'test', 'fixture.js')]],
  ]);
  assert.deepEqual(dependencyLayerErrors(graph, root), [
    'layer violation: lib/service.js -> renderer/app.js',
    'layer violation: renderer/feature.js -> test/fixture.js',
  ]);
});

test('current production graph has no cycle and stays within debt growth caps', () => {
  const snapshot = architectureSnapshot(path.join(__dirname, '..'));
  assert.deepEqual(architectureErrors(snapshot), []);
  assert.equal(snapshot.cycles.length, 0);
  assert.deepEqual(snapshot.layerErrors, []);
  assert.ok(snapshot.mainDirectDependencies <= BASELINE.mainDirectDependencies);
  assert.ok(snapshot.mainTransitiveDependencies <= BASELINE.mainTransitiveDependencies);
  assert.ok(snapshot.mainLines <= BASELINE.mainLines);
  assert.ok(snapshot.rendererLines <= BASELINE.rendererLines);
  assert.ok(snapshot.libMaxFanIn <= BASELINE.libMaxFanIn);
  assert.ok(snapshot.libMaxFanOut <= BASELINE.libMaxFanOut);
  assert.ok(snapshot.appDataDirExports <= BASELINE.appDataDirExports);
  assert.deepEqual(snapshot.domainLayerErrors, []);
  assert.deepEqual(snapshot.rootLibraryDebtErrors, []);
});

test('growth beyond any explicit baseline fails the gate', () => {
  const snapshot = {
    cycles: [],
    mainDirectDependencies: BASELINE.mainDirectDependencies + 1,
    mainTransitiveDependencies: BASELINE.mainTransitiveDependencies + 1,
    mainLines: BASELINE.mainLines + 1,
    rendererLines: BASELINE.rendererLines + 1,
    libMaxFanIn: BASELINE.libMaxFanIn + 1,
    libMaxFanOut: BASELINE.libMaxFanOut + 1,
    appDataDirExports: BASELINE.appDataDirExports + 1,
  };
  assert.deepEqual(architectureErrors(snapshot), [
    `mainDirectDependencies grew from ${BASELINE.mainDirectDependencies} to ${snapshot.mainDirectDependencies}`,
    `mainTransitiveDependencies grew from ${BASELINE.mainTransitiveDependencies} to ${snapshot.mainTransitiveDependencies}`,
    `mainLines grew from ${BASELINE.mainLines} to ${snapshot.mainLines}`,
    `rendererLines grew from ${BASELINE.rendererLines} to ${snapshot.rendererLines}`,
    `libMaxFanIn grew from ${BASELINE.libMaxFanIn} to ${snapshot.libMaxFanIn}`,
    `libMaxFanOut grew from ${BASELINE.libMaxFanOut} to ${snapshot.libMaxFanOut}`,
    `appDataDirExports grew from ${BASELINE.appDataDirExports} to ${snapshot.appDataDirExports}`,
  ]);
});
