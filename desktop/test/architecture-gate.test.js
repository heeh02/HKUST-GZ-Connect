'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  BASELINE,
  architectureErrors,
  architectureSnapshot,
  findCycles,
  relativeRequires,
} = require('../scripts/check-architecture');

test('dependency parser accepts only static relative CommonJS imports', () => {
  assert.deepEqual(relativeRequires(`
    require('./local');
    require("../shared.js");
    require('node:fs');
    require(variable);
  `), ['./local', '../shared.js']);
});

test('cycle detection reports a closed dependency path', () => {
  const graph = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
  ]);
  assert.deepEqual(findCycles(graph), [['a', 'b', 'c', 'a']]);
});

test('current production graph has no cycle and stays within debt growth caps', () => {
  const snapshot = architectureSnapshot(path.join(__dirname, '..'));
  assert.deepEqual(architectureErrors(snapshot), []);
  assert.equal(snapshot.cycles.length, 0);
  assert.ok(snapshot.mainDirectDependencies <= BASELINE.mainDirectDependencies);
  assert.ok(snapshot.mainLines <= BASELINE.mainLines);
  assert.ok(snapshot.rendererLines <= BASELINE.rendererLines);
});

test('growth beyond any explicit baseline fails the gate', () => {
  const snapshot = {
    cycles: [],
    mainDirectDependencies: BASELINE.mainDirectDependencies + 1,
    mainLines: BASELINE.mainLines + 1,
    rendererLines: BASELINE.rendererLines + 1,
  };
  assert.deepEqual(architectureErrors(snapshot), [
    `mainDirectDependencies grew from ${BASELINE.mainDirectDependencies} to ${snapshot.mainDirectDependencies}`,
    `mainLines grew from ${BASELINE.mainLines} to ${snapshot.mainLines}`,
    `rendererLines grew from ${BASELINE.rendererLines} to ${snapshot.rendererLines}`,
  ]);
});
