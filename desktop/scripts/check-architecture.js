'use strict';

const fs = require('node:fs');
const path = require('node:path');

// These are growth caps, not target sizes. They make the current debt explicit
// and prevent another feature from enlarging either God Module while the code
// is extracted incrementally behind tests.
const BASELINE = Object.freeze({
  mainDirectDependencies: 35,
  mainLines: 1596,
  rendererLines: 558,
});

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'release']);

function collectJavaScriptFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.resolve(directory, entry.name));
      }
    }
  };
  visit(path.resolve(root));
  return files.sort();
}

function relativeRequires(source) {
  return [...String(source).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'));
}

function resolveLocalModule(fromFile, specifier, files) {
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  for (const resolved of [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]) {
    if (files.has(resolved)) return resolved;
  }
  return null;
}

function buildDependencyGraph(files) {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map();
  for (const file of fileSet) {
    const dependencies = relativeRequires(fs.readFileSync(file, 'utf8'))
      .map((specifier) => resolveLocalModule(file, specifier, fileSet))
      .filter(Boolean);
    graph.set(file, [...new Set(dependencies)].sort());
  }
  return graph;
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();

  const visit = (node) => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const dependency of graph.get(node) || []) {
      if (!state.has(dependency)) {
        visit(dependency);
      } else if (state.get(dependency) === 'visiting') {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const identity = [...new Set(cycle.slice(0, -1))].sort().join('\n');
        if (!seen.has(identity)) {
          seen.add(identity);
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    state.set(node, 'visited');
  };

  for (const node of graph.keys()) {
    if (!state.has(node)) visit(node);
  }
  return cycles;
}

function lineCount(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

function architectureSnapshot(root = path.resolve(__dirname, '..')) {
  const files = collectJavaScriptFiles(root);
  const graph = buildDependencyGraph(files);
  const mainFile = path.join(root, 'main.js');
  const rendererFile = path.join(root, 'renderer', 'app.js');
  return {
    cycles: findCycles(graph),
    edgeCount: [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0),
    fileCount: files.length,
    mainDirectDependencies: graph.get(mainFile)?.length || 0,
    mainLines: lineCount(mainFile),
    rendererLines: lineCount(rendererFile),
  };
}

function architectureErrors(snapshot) {
  const errors = [];
  if (snapshot.cycles.length) errors.push(`CommonJS cycles: ${snapshot.cycles.length}`);
  for (const key of ['mainDirectDependencies', 'mainLines', 'rendererLines']) {
    if (snapshot[key] > BASELINE[key]) {
      errors.push(`${key} grew from ${BASELINE[key]} to ${snapshot[key]}`);
    }
  }
  return errors;
}

function run() {
  const root = path.resolve(__dirname, '..');
  const snapshot = architectureSnapshot(root);
  const errors = architectureErrors(snapshot);
  if (errors.length) {
    for (const error of errors) process.stderr.write(`architecture gate: ${error}\n`);
    for (const cycle of snapshot.cycles) {
      process.stderr.write(`${cycle.map((file) => path.relative(root, file)).join(' -> ')}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `architecture gate: PASS (files=${snapshot.fileCount}, edges=${snapshot.edgeCount}, ` +
    `mainDeps=${snapshot.mainDirectDependencies}, mainLines=${snapshot.mainLines}, ` +
    `rendererLines=${snapshot.rendererLines})\n`,
  );
}

if (require.main === module) run();

module.exports = {
  BASELINE,
  architectureErrors,
  architectureSnapshot,
  buildDependencyGraph,
  collectJavaScriptFiles,
  findCycles,
  relativeRequires,
};
