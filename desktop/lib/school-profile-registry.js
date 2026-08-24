'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseBuiltinResourceDocument } = require('./campus-resource-contract');
const {
  createSchoolProfileView,
  validateSchoolProfileDocument,
} = require('./school-profile-schema');

const REGISTRY_SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_ID = 'hkustgz';
const DEFAULT_MANIFEST_PATH = 'assets/profiles/manifest.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_PROFILES = 16;
const MAX_ASSETS_PER_PROFILE = 32;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SAFE_ASSET_KEY = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]{0,158}[a-zA-Z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ASSET_KINDS = Object.freeze([
  'engine-config',
  'branding',
  'builtin-resources',
]);

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, allowed, required, name) {
  const object = plainObject(value, name);
  const keys = Object.keys(object);
  if (keys.some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(object, key))) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return object;
}

function safeId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`${name} has an invalid value`);
  }
  return value;
}

function safeAssetKey(value, name) {
  if (typeof value !== 'string' || !SAFE_ASSET_KEY.test(value) ||
      value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
    throw new TypeError(`${name} has an invalid value`);
  }
  return value;
}

function safeRelativePath(value, name) {
  if (typeof value !== 'string' || !value || value.length > 240 ||
      value.startsWith('/') || value.startsWith('.') || value.includes('\\') ||
      value.includes('\0') || value.split('/').some((part) => (
        !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/u.test(part)
      ))) {
    throw new TypeError(`${name} must be a safe package-relative path`);
  }
  return value;
}

function expectedSha256(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function parseJson(data, name) {
  try {
    return JSON.parse(data.toString('utf8'));
  } catch {
    throw new TypeError(`${name} is not valid JSON`);
  }
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' &&
    !path.isAbsolute(relative));
}

function realpath(fsImpl, value) {
  if (typeof fsImpl.realpathSync?.native === 'function') {
    return fsImpl.realpathSync.native(value);
  }
  if (typeof fsImpl.realpathSync !== 'function') {
    throw new TypeError('profile registry filesystem is incomplete');
  }
  return fsImpl.realpathSync(value);
}

function modeIsWritableByOthers(stat) {
  return Number.isInteger(stat?.mode) && (stat.mode & 0o022) !== 0;
}

function electronOriginalFs() {
  if (!process.versions?.electron) return null;
  try { return require('original-fs'); } catch { return null; }
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
    if (Number.isFinite(left[key]) && Number.isFinite(right[key]) && left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

class PackagedFileReader {
  constructor({
    fsImpl = fs,
    physicalFs = electronOriginalFs(),
    packageRoot,
    platform = process.platform,
  } = {}) {
    if (!fsImpl || typeof fsImpl.lstatSync !== 'function' ||
        typeof fsImpl.openSync !== 'function' || typeof fsImpl.fstatSync !== 'function' ||
        typeof fsImpl.readFileSync !== 'function' || typeof fsImpl.closeSync !== 'function') {
      throw new TypeError('profile registry filesystem is incomplete');
    }
    if (typeof packageRoot !== 'string' || !packageRoot) {
      throw new TypeError('profile registry package root is required');
    }
    const rootPath = path.resolve(packageRoot);
    const rootLstat = fsImpl.lstatSync(rootPath);
    if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink()) {
      throw new Error('profile registry package root must be a real directory');
    }
    this.fs = fsImpl;
    this.platform = platform;
    this.rootPath = rootPath;
    this.rootReal = realpath(fsImpl, rootPath);
    this.rootStat = fsImpl.lstatSync(this.rootReal);
    this.assertOwnerBoundary(this.rootStat, '.');
    this.physicalFs = physicalFs;
    this.archiveStat = null;
    if (path.basename(rootPath).endsWith('.asar') && physicalFs) {
      const physical = physicalFs.lstatSync(rootPath);
      if (physical.isSymbolicLink() || !physical.isFile()) {
        throw new Error('profile registry ASAR root must be a real archive file');
      }
      this.assertOwnerBoundary(physical, path.basename(rootPath));
      this.archiveStat = physical;
    }
  }

  assertOwnerBoundary(stat, displayPath) {
    if (this.platform === 'win32') return;
    if (Number.isInteger(this.rootStat?.uid) && Number.isInteger(stat?.uid) &&
        stat.uid !== this.rootStat.uid) {
      throw new Error(`packaged path owner differs from package root: ${displayPath}`);
    }
    if (modeIsWritableByOthers(stat)) {
      throw new Error(`packaged path is group/world writable: ${displayPath}`);
    }
  }

  assertArchiveBoundary() {
    if (!this.archiveStat) return;
    const current = this.physicalFs.lstatSync(this.rootPath);
    if (current.isSymbolicLink() || !current.isFile() ||
        !sameFileIdentity(this.archiveStat, current)) {
      throw new Error('packaged ASAR archive changed while loading the school profile');
    }
    this.assertOwnerBoundary(current, path.basename(this.rootPath));
  }

  candidate(relativePath) {
    const safePath = safeRelativePath(relativePath, 'packaged asset path');
    const components = safePath.split('/');
    let current = this.rootReal;
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index]);
      const stat = this.fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`packaged asset uses a symlink: ${safePath}`);
      this.assertOwnerBoundary(stat, components.slice(0, index + 1).join('/'));
      const final = index === components.length - 1;
      if (final ? !stat.isFile() : !stat.isDirectory()) {
        throw new Error(`packaged asset path has an invalid type: ${safePath}`);
      }
    }
    const resolved = realpath(this.fs, current);
    if (!withinRoot(this.rootReal, resolved)) {
      throw new Error(`packaged asset escapes the package root: ${safePath}`);
    }
    return { safePath, resolved, lstat: this.fs.lstatSync(resolved) };
  }

  read(relativePath, maxBytes) {
    this.assertArchiveBoundary();
    const candidate = this.candidate(relativePath);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError('packaged asset size limit is invalid');
    }
    if (candidate.lstat.size < 0 || candidate.lstat.size > maxBytes) {
      throw new Error(`packaged asset exceeds its size limit: ${candidate.safePath}`);
    }
    const noFollow = Number(this.fs.constants?.O_NOFOLLOW || 0);
    const descriptor = this.fs.openSync(
      candidate.resolved,
      Number(this.fs.constants?.O_RDONLY || 0) | noFollow,
    );
    try {
      const opened = this.fs.fstatSync(descriptor);
      if (!opened.isFile() || (Number.isInteger(opened.dev) && Number.isInteger(opened.ino) &&
          !this.archiveStat &&
          (opened.dev !== candidate.lstat.dev || opened.ino !== candidate.lstat.ino))) {
        throw new Error(`packaged asset changed while opening: ${candidate.safePath}`);
      }
      const data = this.fs.readFileSync(descriptor);
      if (!Buffer.isBuffer(data) || data.length > maxBytes || data.length !== opened.size ||
          data.length !== candidate.lstat.size) {
        throw new Error(`packaged asset changed while reading: ${candidate.safePath}`);
      }
      this.assertArchiveBoundary();
      return data;
    } finally {
      this.fs.closeSync(descriptor);
    }
  }
}

function normalizeManifestAsset(value, index) {
  const asset = exactKeys(value, ['key', 'kind', 'path', 'sha256'],
    ['key', 'kind', 'path', 'sha256'], `manifest asset ${index}`);
  if (!ASSET_KINDS.includes(asset.kind)) throw new TypeError('manifest asset kind is unsupported');
  return Object.freeze({
    key: safeAssetKey(asset.key, 'manifest asset key'),
    kind: asset.kind,
    path: safeRelativePath(asset.path, 'manifest asset path'),
    sha256: expectedSha256(asset.sha256, 'manifest asset digest'),
  });
}

function normalizeManifestProfile(value, index) {
  const profile = exactKeys(value, ['profileId', 'default', 'document', 'assets'],
    ['profileId', 'default', 'document', 'assets'], `manifest profile ${index}`);
  const document = exactKeys(profile.document, ['path', 'sha256'], ['path', 'sha256'],
    `manifest profile ${index} document`);
  if (typeof profile.default !== 'boolean' || !Array.isArray(profile.assets) ||
      !profile.assets.length || profile.assets.length > MAX_ASSETS_PER_PROFILE) {
    throw new TypeError(`manifest profile ${index} has an invalid value`);
  }
  const assets = profile.assets.map(normalizeManifestAsset);
  if (new Set(assets.map((asset) => asset.key)).size !== assets.length ||
      new Set(assets.map((asset) => asset.path)).size !== assets.length) {
    throw new TypeError(`manifest profile ${index} contains duplicate assets`);
  }
  return Object.freeze({
    profileId: safeId(profile.profileId, 'manifest profileId'),
    default: profile.default,
    document: Object.freeze({
      path: safeRelativePath(document.path, 'profile document path'),
      sha256: expectedSha256(document.sha256, 'profile document digest'),
    }),
    assets: Object.freeze(assets),
  });
}

function normalizeManifest(value) {
  const manifest = exactKeys(value, ['schemaVersion', 'profiles'],
    ['schemaVersion', 'profiles'], 'profile manifest');
  if (manifest.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(manifest.profiles) ||
      !manifest.profiles.length || manifest.profiles.length > MAX_PROFILES) {
    throw new TypeError('profile manifest version or profile count is unsupported');
  }
  const profiles = manifest.profiles.map(normalizeManifestProfile);
  if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length) {
    throw new TypeError('profile manifest contains duplicate profile IDs');
  }
  const defaults = profiles.filter((profile) => profile.default);
  if (defaults.length !== 1 || defaults[0].profileId !== DEFAULT_PROFILE_ID) {
    throw new TypeError('profile manifest requires exactly one default hkustgz profile');
  }
  if (profiles.length !== 1 || profiles[0].profileId !== DEFAULT_PROFILE_ID) {
    throw new TypeError('P1 profile manifest supports only the reviewed hkustgz profile');
  }
  return Object.freeze({ schemaVersion: REGISTRY_SCHEMA_VERSION, profiles: Object.freeze(profiles) });
}

function descriptor(asset) {
  return Object.freeze({
    key: asset.key,
    kind: asset.kind,
    path: asset.path,
    sha256: asset.sha256,
  });
}

class SchoolProfileRegistry {
  constructor({
    packageRoot = path.resolve(__dirname, '..'),
    manifestPath = DEFAULT_MANIFEST_PATH,
    fsImpl = fs,
    physicalFs = electronOriginalFs(),
    platform = process.platform,
    validateProfile = validateSchoolProfileDocument,
    createProfileView = createSchoolProfileView,
  } = {}) {
    if (typeof validateProfile !== 'function' || typeof createProfileView !== 'function') {
      throw new TypeError('profile registry schema dependencies are required');
    }
    this.reader = new PackagedFileReader({ fsImpl, physicalFs, packageRoot, platform });
    this.manifestPath = safeRelativePath(manifestPath, 'profile manifest path');
    this.validateProfile = validateProfile;
    this.createProfileView = createProfileView;
    this.loaded = false;
    this.records = new Map();
    this.defaultProfileId = null;
  }

  load() {
    if (this.loaded) return this;
    const manifest = normalizeManifest(parseJson(
      this.reader.read(this.manifestPath, MAX_MANIFEST_BYTES),
      'profile manifest',
    ));
    const records = new Map();
    let defaultProfileId = null;
    for (const entry of manifest.profiles) {
      const documentData = this.reader.read(entry.document.path, MAX_PROFILE_BYTES);
      if (sha256(documentData) !== entry.document.sha256) {
        throw new Error(`profile document hash mismatch: ${entry.profileId}`);
      }
      const sourceDocument = deepFreeze(parseJson(
        documentData,
        `profile document ${entry.profileId}`,
      ));
      const profile = this.validateProfile(sourceDocument);
      if (!profile || profile.profileId !== entry.profileId ||
          profile.evidenceClass !== 'builtin-reviewed') {
        throw new Error(`profile document identity mismatch: ${entry.profileId}`);
      }

      const assets = new Map();
      for (const asset of entry.assets) {
        const data = this.reader.read(asset.path, MAX_ASSET_BYTES);
        if (sha256(data) !== asset.sha256) {
          throw new Error(`profile asset hash mismatch: ${entry.profileId}/${asset.key}`);
        }
        assets.set(asset.key, { ...asset, data });
      }
      const engineAsset = assets.get(profile.gateway.engineConfigRef);
      if (!engineAsset || engineAsset.kind !== 'engine-config') {
        throw new Error(`profile engine config reference is not declared: ${entry.profileId}`);
      }
      const brandingAsset = assets.get(profile.branding.bundledAssetKey);
      if (!brandingAsset || brandingAsset.kind !== 'branding') {
        throw new Error(`profile branding reference is not declared: ${entry.profileId}`);
      }
      const resourceAsset = assets.get(profile.browser.builtinResourcesRef);
      if (!resourceAsset || resourceAsset.kind !== 'builtin-resources') {
        throw new Error(`profile builtin resource reference is not declared: ${entry.profileId}`);
      }
      const builtinResources = parseBuiltinResourceDocument(resourceAsset.data);
      if (assets.size !== 3) {
        throw new Error(`profile contains an unbound packaged asset: ${entry.profileId}`);
      }
      records.set(entry.profileId, Object.freeze({
        profile,
        sourceDocument,
        document: Object.freeze({ ...entry.document }),
        assets,
        builtinResources,
      }));
      if (entry.default) defaultProfileId = entry.profileId;
    }
    this.records = records;
    this.defaultProfileId = defaultProfileId;
    this.loaded = true;
    return this;
  }

  ensureLoaded() {
    if (!this.loaded) this.load();
  }

  getProfile(profileId) {
    this.ensureLoaded();
    const record = this.records.get(String(profileId || ''));
    if (!record) throw new Error('school profile is not present in the packaged manifest');
    return record.profile;
  }

  getDefaultProfile() {
    this.ensureLoaded();
    return this.getProfile(this.defaultProfileId);
  }

  getBuiltinResources(profileId) {
    this.ensureLoaded();
    const record = this.records.get(String(profileId || ''));
    if (!record) throw new Error('school profile is not present in the packaged manifest');
    return record.builtinResources;
  }

  createView(profileId, options) {
    this.ensureLoaded();
    const record = this.records.get(String(profileId || ''));
    if (!record) throw new Error('school profile is not present in the packaged manifest');
    return this.createProfileView(record.sourceDocument, options);
  }

  createDefaultView(options) {
    this.ensureLoaded();
    return this.createView(this.defaultProfileId, options);
  }

  listViews(options) {
    this.ensureLoaded();
    return Object.freeze([...this.records.keys()].map((profileId) => (
      this.createView(profileId, options)
    )));
  }

  resolveAsset(profileId, assetKey, expectedKind = null) {
    this.ensureLoaded();
    const record = this.records.get(String(profileId || ''));
    if (!record) throw new Error('school profile is not present in the packaged manifest');
    const asset = record.assets.get(String(assetKey || ''));
    if (!asset || (expectedKind !== null && asset.kind !== expectedKind)) {
      throw new Error('school profile asset is not present in the packaged manifest');
    }
    return descriptor(asset);
  }

  readAsset(profileId, assetKey, expectedKind = null) {
    this.ensureLoaded();
    const record = this.records.get(String(profileId || ''));
    const asset = record?.assets.get(String(assetKey || ''));
    if (!asset || (expectedKind !== null && asset.kind !== expectedKind)) {
      throw new Error('school profile asset is not present in the packaged manifest');
    }
    return Buffer.from(asset.data);
  }
}

module.exports = {
  ASSET_KINDS,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_PROFILE_ID,
  PackagedFileReader,
  REGISTRY_SCHEMA_VERSION,
  SchoolProfileRegistry,
  normalizeManifest,
  safeRelativePath,
};
