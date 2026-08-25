'use strict';

const fs = require('node:fs');
const path = require('node:path');

// These are growth caps, not target sizes. They make the current debt explicit
// and prevent another feature from enlarging either God Module while the code
// is extracted incrementally behind tests.
const BASELINE = Object.freeze({
  mainDirectDependencies: 35,
  mainTransitiveDependencies: 153,
  mainLines: 1659,
  rendererLines: 564,
  libMaxFanIn: 45,
  libMaxFanOut: 14,
  runtimeCompositionExports: 1,
});

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'release']);
const DOMAIN_DEPENDENCIES = Object.freeze({
  app: Object.freeze(['app', 'connection', 'profiles', 'profile-core', 'persistence', 'switching', 'browser',
    'resources', 'resource-core', 'routing', 'integrations', 'ipc', 'platform', 'diagnostics', 'legacy']),
  connection: Object.freeze(['connection', 'profiles', 'profile-core', 'platform', 'diagnostics', 'legacy']),
  'profile-core': Object.freeze(['profile-core', 'resource-core', 'platform', 'diagnostics', 'legacy']),
  profiles: Object.freeze(['profiles', 'profile-core', 'persistence', 'resources', 'resource-core',
    'routing', 'platform', 'diagnostics', 'legacy']),
  persistence: Object.freeze(['persistence', 'profile-core', 'resource-core', 'routing', 'platform',
    'diagnostics', 'legacy']),
  switching: Object.freeze(['switching', 'persistence', 'connection', 'browser', 'profiles', 'profile-core',
    'platform', 'diagnostics', 'legacy']),
  browser: Object.freeze(['browser', 'resources', 'resource-core', 'routing', 'profiles', 'profile-core',
    'platform', 'diagnostics', 'legacy']),
  'resource-core': Object.freeze(['resource-core', 'routing', 'platform', 'diagnostics', 'legacy']),
  resources: Object.freeze(['resources', 'resource-core', 'routing', 'profiles', 'profile-core',
    'platform', 'diagnostics', 'legacy']),
  routing: Object.freeze(['routing', 'profiles', 'profile-core', 'platform', 'diagnostics', 'legacy']),
  integrations: Object.freeze(['integrations', 'resources', 'resource-core', 'routing', 'profiles',
    'profile-core', 'connection', 'platform', 'diagnostics', 'legacy']),
  ipc: Object.freeze(['ipc', 'connection', 'profiles', 'profile-core', 'persistence', 'switching', 'browser',
    'routing', 'integrations', 'platform', 'diagnostics', 'legacy']),
  platform: Object.freeze(['platform', 'diagnostics', 'legacy']),
  diagnostics: Object.freeze(['diagnostics', 'platform', 'legacy']),
});

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

function unresolvedRelativeRequireErrors(files, root) {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const errors = [];
  for (const file of fileSet) {
    const relativeFile = path.relative(root, file).replaceAll(path.sep, '/');
    const productionSource = relativeFile === 'main.js' || relativeFile === 'preload.js' ||
      relativeFile === 'campus-preload.js' || relativeFile.startsWith('lib/') ||
      relativeFile.startsWith('renderer/');
    if (!productionSource) continue;
    for (const specifier of relativeRequires(fs.readFileSync(file, 'utf8'))) {
      if (resolveLocalModule(file, specifier, fileSet)) continue;
      errors.push(`unresolved relative require: ${relativeFile} -> ${specifier}`);
    }
  }
  return errors.sort();
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

function transitiveDependencies(graph, start) {
  const visited = new Set();
  const visit = (node) => {
    for (const dependency of graph.get(node) || []) {
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      visit(dependency);
    }
  };
  visit(start);
  return visited;
}

function graphFanMetrics(graph, root) {
  const fanIn = new Map([...graph.keys()].map((file) => [file, 0]));
  for (const dependencies of graph.values()) {
    for (const dependency of dependencies) fanIn.set(dependency, (fanIn.get(dependency) || 0) + 1);
  }
  const library = [...graph.keys()].filter((file) => (
    path.relative(root, file).replaceAll(path.sep, '/').startsWith('lib/')
  ));
  return Object.freeze({
    libMaxFanIn: Math.max(0, ...library.map((file) => fanIn.get(file) || 0)),
    libMaxFanOut: Math.max(0, ...library.map((file) => graph.get(file)?.length || 0)),
  });
}

function moduleExportNames(source) {
  const match = String(source).match(/module\.exports\s*=\s*\{([\s\S]*?)\};/u);
  if (!match) return Object.freeze([]);
  const names = [...match[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/gmu)]
    .map((value) => value[1]);
  return Object.freeze([...new Set(names)].sort());
}

function rootLibraryFiles(root) {
  const library = path.join(root, 'lib');
  return Object.freeze(fs.readdirSync(library, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort());
}

function loadRootLibraryDebt(root) {
  const debtPath = path.join(root, 'scripts', 'architecture-root-debt.json');
  const value = JSON.parse(fs.readFileSync(debtPath, 'utf8'));
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.rootFiles) ||
      value.rootFiles.some((file) => typeof file !== 'string' || !/^[a-z0-9-]+\.js$/u.test(file)) ||
      new Set(value.rootFiles).size !== value.rootFiles.length) {
    throw new TypeError('architecture root debt has an invalid schema');
  }
  return Object.freeze([...value.rootFiles].sort());
}

function rootLibraryDebtErrors(current, expected) {
  const actualSet = new Set(current);
  const expectedSet = new Set(expected);
  return Object.freeze([
    ...current.filter((file) => !expectedSet.has(file))
      .map((file) => `new desktop/lib root file is forbidden: ${file}`),
    ...expected.filter((file) => !actualSet.has(file))
      .map((file) => `architecture root debt was not ratcheted after moving: ${file}`),
  ].sort());
}

function productionDomain(relativePath) {
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (normalized.startsWith('lib/profiles/schema/')) return 'profile-core';
  if (normalized.startsWith('lib/resources/schema/')) return 'resource-core';
  const match = normalized.match(/^lib\/([^/]+)\//u);
  if (!match) return normalized.startsWith('lib/') ? 'legacy' : null;
  return Object.hasOwn(DOMAIN_DEPENDENCIES, match[1]) ? match[1] : 'unknown';
}

function domainDependencyErrors(graph, root) {
  const errors = [];
  const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');
  for (const [source, dependencies] of graph) {
    const sourcePath = relative(source);
    const sourceDomain = productionDomain(sourcePath);
    if (!sourceDomain || sourceDomain === 'legacy') continue;
    if (sourceDomain === 'unknown') {
      errors.push(`unknown desktop domain: ${sourcePath}`);
      continue;
    }
    const allowed = new Set(DOMAIN_DEPENDENCIES[sourceDomain]);
    for (const dependency of dependencies) {
      const dependencyPath = relative(dependency);
      const dependencyDomain = productionDomain(dependencyPath);
      if (dependencyDomain && !allowed.has(dependencyDomain)) {
        errors.push(`domain violation: ${sourcePath} -> ${dependencyPath}`);
      }
    }
  }
  return errors.sort();
}

function dependencyLayerErrors(graph, root) {
  const errors = [];
  const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/');
  const browserShared = new Set([
    'lib/browser/auth/login-flow.js',
    'lib/resources/presentation/resource-view.js',
  ]);
  for (const [source, dependencies] of graph) {
    const sourcePath = relative(source);
    const productionSource = sourcePath === 'main.js' || sourcePath === 'preload.js' ||
      sourcePath === 'campus-preload.js' || sourcePath.startsWith('lib/') ||
      sourcePath.startsWith('renderer/');
    if (!productionSource) continue;
    for (const dependency of dependencies) {
      const dependencyPath = relative(dependency);
      let allowed = true;
      if (sourcePath === 'main.js' || sourcePath === 'preload.js' ||
          sourcePath === 'campus-preload.js' || sourcePath.startsWith('lib/')) {
        allowed = dependencyPath.startsWith('lib/');
      } else if (sourcePath.startsWith('renderer/')) {
        allowed = dependencyPath.startsWith('renderer/') || browserShared.has(dependencyPath);
      }
      if (!allowed) errors.push(`layer violation: ${sourcePath} -> ${dependencyPath}`);
    }
  }
  return errors.sort();
}

function architectureSnapshot(root = path.resolve(__dirname, '..')) {
  const files = collectJavaScriptFiles(root);
  const graph = buildDependencyGraph(files);
  const mainFile = path.join(root, 'main.js');
  const rendererFile = path.join(root, 'renderer', 'app.js');
  const runtimeCompositionFile = path.join(root, 'lib', 'app', 'desktop-runtime-composition.js');
  const rootFiles = rootLibraryFiles(root);
  const rootDebt = loadRootLibraryDebt(root);
  const fan = graphFanMetrics(graph, root);
  return {
    cycles: findCycles(graph),
    unresolvedRequireErrors: unresolvedRelativeRequireErrors(files, root),
    layerErrors: dependencyLayerErrors(graph, root),
    domainLayerErrors: domainDependencyErrors(graph, root),
    rootLibraryDebtErrors: rootLibraryDebtErrors(rootFiles, rootDebt),
    edgeCount: [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0),
    fileCount: files.length,
    mainDirectDependencies: graph.get(mainFile)?.length || 0,
    mainTransitiveDependencies: transitiveDependencies(graph, mainFile).size,
    mainLines: lineCount(mainFile),
    rendererLines: lineCount(rendererFile),
    runtimeCompositionExports: moduleExportNames(
      fs.readFileSync(runtimeCompositionFile, 'utf8'),
    ).length,
    rootLibraryFileCount: rootFiles.length,
    ...fan,
  };
}

function architectureErrors(snapshot) {
  const errors = [];
  if (snapshot.cycles.length) errors.push(`CommonJS cycles: ${snapshot.cycles.length}`);
  errors.push(...(snapshot.unresolvedRequireErrors || []));
  errors.push(...(snapshot.layerErrors || []));
  errors.push(...(snapshot.domainLayerErrors || []));
  errors.push(...(snapshot.rootLibraryDebtErrors || []));
  for (const key of [
    'mainDirectDependencies', 'mainTransitiveDependencies', 'mainLines', 'rendererLines',
    'libMaxFanIn', 'libMaxFanOut', 'runtimeCompositionExports',
  ]) {
    if (!Number.isFinite(snapshot[key])) continue;
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
    `mainDeps=${snapshot.mainDirectDependencies}/${snapshot.mainTransitiveDependencies}, ` +
    `libFan=${snapshot.libMaxFanOut}/${snapshot.libMaxFanIn}, rootDebt=${snapshot.rootLibraryFileCount}, ` +
    `compositionExports=${snapshot.runtimeCompositionExports}, mainLines=${snapshot.mainLines}, ` +
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
  domainDependencyErrors,
  dependencyLayerErrors,
  findCycles,
  graphFanMetrics,
  loadRootLibraryDebt,
  moduleExportNames,
  relativeRequires,
  rootLibraryDebtErrors,
  rootLibraryFiles,
  transitiveDependencies,
  unresolvedRelativeRequireErrors,
};
