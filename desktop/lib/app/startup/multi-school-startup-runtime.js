'use strict';

const { CustomProfileProvisioningRuntime } = require('../../profiles/provisioning/custom-profile-provisioning-runtime');
const { ProfileCandidateDirectory } = require('../../profiles/registry/profile-candidate-directory');
const { validateSchoolProfileDocument } = require('../../profiles/schema/school-profile-schema');

class MultiSchoolStartupRuntime {
  constructor({
    userData,
    packageRoot,
    isPackaged,
    resourcesPath,
    desktopDir,
    ProvisioningRuntimeClass = CustomProfileProvisioningRuntime,
    CandidateDirectoryClass = ProfileCandidateDirectory,
  } = {}) {
    if (typeof ProvisioningRuntimeClass !== 'function' ||
        typeof CandidateDirectoryClass !== 'function') {
      throw new TypeError('multi-school startup runtime dependencies are invalid');
    }
    this.options = { userData, packageRoot, isPackaged, resourcesPath, desktopDir };
    this.ProvisioningRuntimeClass = ProvisioningRuntimeClass;
    this.CandidateDirectoryClass = CandidateDirectoryClass;
    this.state = null;
    this.directory = null;
  }

  initialize({ mode, authority, withProfileDocument } = {}) {
    if (this.state) return this.state;
    if (mode === 'legacy-flat') {
      this.state = Object.freeze({
        ready: true,
        mode,
        provisioningStatus: 'not_applicable',
        profileCount: 0,
      });
      return this.state;
    }
    if (mode !== 'profile-workspace' || !authority ||
        typeof withProfileDocument !== 'function') {
      throw new TypeError('multi-school startup authority is invalid');
    }
    const provisioning = new this.ProvisioningRuntimeClass({
      userData: this.options.userData,
    }).recover();
    let sourceDocument = null;
    const access = withProfileDocument((value) => { sourceDocument = value; });
    if (access && typeof access.then === 'function' || !sourceDocument) {
      throw new TypeError('active reviewed Profile access must be synchronous');
    }
    const profile = validateSchoolProfileDocument(sourceDocument);
    if (authority.profile?.profileId !== profile.profileId ||
        authority.profile?.profileRevision !== profile.profileRevision) {
      throw new Error('startup Profile does not match persistence authority');
    }
    const directory = new this.CandidateDirectoryClass(this.options);
    if (profile.evidenceClass === 'builtin-reviewed') {
      directory.anchorReviewedCurrent({
        profileId: profile.profileId,
        profileKey: authority.globalSettings.activeProfileKey,
        accountKey: authority.globalSettings.activeAccountKey,
      });
    } else {
      let matched = false;
      directory.withCandidate(profile.profileId, (record) => {
        matched = record.context.profileKey === authority.layout.identity.profileKey &&
          record.context.accountKey === authority.account.accountKey &&
          record.context.workspaceKey === authority.account.workspaceKey &&
          record.context.activeContextEpoch === authority.workspaceState.activeContextEpoch;
      });
      if (!matched) throw new Error('startup custom Profile candidate does not match authority');
    }
    this.directory = directory;
    this.state = Object.freeze({
      ready: true,
      mode,
      provisioningStatus: provisioning.status,
      profileCount: directory.listViews({ locale: 'en' }).length,
    });
    return this.state;
  }

  listViews(options) {
    if (!this.directory) return Object.freeze([]);
    return this.directory.listViews(options);
  }
}

module.exports = { MultiSchoolStartupRuntime };
