'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SchoolProfileRegistry,
} = require('../lib/profiles/registry/school-profile-registry');

function reviewedProfileConfigs({ desktopRoot = path.resolve(__dirname, '..'), fileSystem = fs } = {}) {
  const root = path.resolve(desktopRoot);
  const registry = new SchoolProfileRegistry({ packageRoot: root, fsImpl: fileSystem }).load();
  return Object.freeze(registry.listViews({ locale: 'en', compatibility: 'reviewed' }).map((view) => {
    let profile = null;
    registry.withProfileDocument(view.profileId, (value) => { profile = value; });
    const data = registry.readAsset(
      profile.profileId, profile.gateway.engineConfigRef, 'engine-config',
    );
    let config;
    try { config = JSON.parse(data.toString('utf8')); }
    catch { throw new Error('reviewed Profile Engine config is not valid JSON'); }
    if (new URL(config.base_url).origin !== view.normalizedGatewayOrigin) {
      throw new Error(`reviewed Profile Engine origin mismatch: ${profile.profileId}`);
    }
    return Object.freeze({ profileId: profile.profileId, filename: `${profile.profileId}.json`, data });
  }));
}

function stageReviewedProfileConfigs({
  desktopRoot = path.resolve(__dirname, '..'),
  engineDirectory = path.join(path.resolve(desktopRoot), 'engine'),
  fileSystem = fs,
} = {}) {
  const configs = reviewedProfileConfigs({ desktopRoot, fileSystem });
  fileSystem.mkdirSync(engineDirectory, { recursive: true });
  const expected = new Set(configs.map(({ filename }) => filename));
  for (const entry of fileSystem.readdirSync(engineDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.json$/u.test(entry.name) &&
        !expected.has(entry.name)) fileSystem.unlinkSync(path.join(engineDirectory, entry.name));
  }
  for (const config of configs) {
    const target = path.join(engineDirectory, config.filename);
    const temporary = path.join(engineDirectory, `.${config.profileId}.${process.pid}.tmp`);
    fileSystem.writeFileSync(temporary, config.data, { mode: 0o600, flag: 'wx' });
    try {
      fileSystem.renameSync(temporary, target);
      if (process.platform !== 'win32') fileSystem.chmodSync(target, 0o600);
    } finally {
      try { fileSystem.unlinkSync(temporary); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return Object.freeze(configs.map(({ profileId, filename }) => Object.freeze({ profileId, filename })));
}

module.exports = { reviewedProfileConfigs, stageReviewedProfileConfigs };

if (require.main === module) {
  const staged = stageReviewedProfileConfigs();
  process.stdout.write(`staged reviewed Profile configs: ${staged.map(({ filename }) => filename).join(', ')}\n`);
}
