'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CONTRACT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'governance',
  'repository-governance-contract.json',
);
const REPOSITORY_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;
const PHASES = new Set(['pre-transfer', 'post-transfer']);

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, name) {
  const object = plainObject(value, name);
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has an invalid schema`);
  }
  return object;
}

function readContract(file = CONTRACT_PATH, fileSystem = fs) {
  const document = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
  exactKeys(document, [
    'schemaVersion', 'repository', 'merge', 'actions', 'requiredChecks',
    'releaseTagRuleset', 'releaseEnvironment', 'security', 'preTransfer', 'postTransfer',
  ], 'governance contract');
  if (document.schemaVersion !== 1 || !Array.isArray(document.requiredChecks) ||
      !Array.isArray(document.releaseTagRuleset?.include) ||
      !Array.isArray(document.releaseTagRuleset?.immutableRules)) {
    throw new TypeError('governance contract has an unsupported schema');
  }
  return Object.freeze(document);
}

function githubApi(endpoint, execute = execFileSync) {
  if (typeof endpoint !== 'string' || !/^(?:repos|orgs)\//u.test(endpoint)) {
    throw new TypeError('GitHub governance endpoint is invalid');
  }
  const output = execute('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function status(value) {
  return typeof value?.status === 'string' ? value.status : 'unavailable';
}

function enabled(value) {
  return value?.enabled === true;
}

function requiredReviewers(environment) {
  const rule = Array.isArray(environment?.protection_rules)
    ? environment.protection_rules.find((candidate) => candidate?.type === 'required_reviewers')
    : null;
  return Array.isArray(rule?.reviewers) ? rule.reviewers.length : 0;
}

function captureLiveSnapshot(repository, {
  execute = execFileSync,
  releaseTeamOwner = null,
  releaseTeamSlug = null,
} = {}) {
  if (typeof repository !== 'string' || !REPOSITORY_SLUG.test(repository)) {
    throw new TypeError('repository must be an exact owner/name slug');
  }
  const hasReleaseTeam = releaseTeamOwner !== null || releaseTeamSlug !== null;
  if (hasReleaseTeam && (typeof releaseTeamOwner !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(releaseTeamOwner) ||
      typeof releaseTeamSlug !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(releaseTeamSlug))) {
    throw new TypeError('release team owner and slug must be supplied together');
  }
  const repo = githubApi(`repos/${repository}`, execute);
  const workflow = githubApi(`repos/${repository}/actions/permissions/workflow`, execute);
  const actions = githubApi(`repos/${repository}/actions/permissions`, execute);
  const protection = githubApi(`repos/${repository}/branches/main/protection`, execute);
  const rulesets = githubApi(`repos/${repository}/rulesets`, execute);
  const matchingRulesets = Array.isArray(rulesets)
    ? rulesets.filter((candidate) => candidate?.name === 'release-tag-immutability')
    : [];
  if (matchingRulesets.length !== 1 || !Number.isSafeInteger(matchingRulesets[0].id)) {
    throw new Error('release tag Ruleset is missing or ambiguous');
  }
  const tagRuleset = githubApi(`repos/${repository}/rulesets/${matchingRulesets[0].id}`, execute);
  const environment = githubApi(`repos/${repository}/environments/release`, execute);
  const vulnerability = githubApi(
    `repos/${repository}/private-vulnerability-reporting`,
    execute,
  );
  const releaseTeam = hasReleaseTeam
    ? githubApi(`orgs/${releaseTeamOwner}/teams/${releaseTeamSlug}`, execute)
    : null;
  const checks = protection.required_status_checks?.checks;
  const review = protection.required_pull_request_reviews;
  return Object.freeze({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    repository: Object.freeze({
      id: repo.id,
      name: repo.name,
      owner: repo.owner?.login,
      ownerType: repo.owner?.type,
      visibility: repo.visibility,
      defaultBranch: repo.default_branch,
    }),
    merge: Object.freeze({
      allowSquash: repo.allow_squash_merge === true,
      allowMergeCommit: repo.allow_merge_commit === true,
      allowRebase: repo.allow_rebase_merge === true,
      deleteBranchOnMerge: repo.delete_branch_on_merge === true,
      linearHistory: enabled(protection.required_linear_history),
      conversationResolution: enabled(protection.required_conversation_resolution),
      forcePush: enabled(protection.allow_force_pushes),
      branchDeletion: enabled(protection.allow_deletions),
    }),
    actions: Object.freeze({
      enabled: actions.enabled === true,
      defaultWorkflowPermissions: workflow.default_workflow_permissions,
      canApproveReviews: workflow.can_approve_pull_request_reviews === true,
      shaPinningRequired: actions.sha_pinning_required === true,
      allowedActions: actions.allowed_actions,
    }),
    mainProtection: Object.freeze({
      strict: protection.required_status_checks?.strict === true,
      checks: Object.freeze(Array.isArray(checks)
        ? checks.map((check) => check?.context).filter(Boolean).sort()
        : []),
      approvals: review?.required_approving_review_count,
      dismissStaleReviews: review?.dismiss_stale_reviews === true,
      enforceAdmins: enabled(protection.enforce_admins),
      codeOwnerReviews: review?.require_code_owner_reviews === true,
      lastPushApproval: review?.require_last_push_approval === true,
    }),
    releaseTagRuleset: Object.freeze({
      id: tagRuleset.id,
      name: tagRuleset.name,
      enforcement: tagRuleset.enforcement,
      include: Object.freeze([...(tagRuleset.conditions?.ref_name?.include || [])].sort()),
      rules: Object.freeze((tagRuleset.rules || []).map((rule) => rule?.type).filter(Boolean).sort()),
      bypassActors: Object.freeze((tagRuleset.bypass_actors || []).map((actor) => Object.freeze({
        actorId: actor?.actor_id,
        actorType: actor?.actor_type,
        bypassMode: actor?.bypass_mode,
      })).sort((left, right) => (
        `${left.actorType}:${left.actorId}`.localeCompare(`${right.actorType}:${right.actorId}`)
      ))),
    }),
    releaseTeam: releaseTeam === null ? null : Object.freeze({
      id: releaseTeam.id,
      slug: releaseTeam.slug,
    }),
    releaseEnvironment: Object.freeze({
      name: environment.name,
      reviewerCount: requiredReviewers(environment),
    }),
    security: Object.freeze({
      privateVulnerabilityReporting: vulnerability.enabled === true,
      dependabotSecurityUpdates: status(repo.security_and_analysis?.dependabot_security_updates),
      secretScanning: status(repo.security_and_analysis?.secret_scanning),
      pushProtection: status(repo.security_and_analysis?.secret_scanning_push_protection),
      nonProviderPatterns: status(repo.security_and_analysis?.secret_scanning_non_provider_patterns),
      validityChecks: status(repo.security_and_analysis?.secret_scanning_validity_checks),
    }),
  });
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function auditSnapshot(contract, snapshot, {
  phase,
  expectedOwner,
  expectedReleaseTeam = null,
} = {}) {
  if (!PHASES.has(phase) || typeof expectedOwner !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(expectedOwner)) {
    throw new TypeError('governance audit phase or owner is invalid');
  }
  exactKeys(snapshot, [
    'schemaVersion', 'capturedAt', 'repository', 'merge', 'actions', 'mainProtection',
    'releaseTagRuleset', 'releaseTeam', 'releaseEnvironment', 'security',
  ], 'governance snapshot');
  if (snapshot.schemaVersion !== 1 || !Number.isFinite(Date.parse(snapshot.capturedAt))) {
    throw new TypeError('governance snapshot has an unsupported schema');
  }
  const errors = [];
  const requireEqual = (label, actual, expected) => {
    if (actual !== expected) errors.push(`${label}: expected ${expected}, received ${actual}`);
  };
  for (const key of ['id', 'name', 'visibility', 'defaultBranch']) {
    requireEqual(`repository.${key}`, snapshot.repository?.[key], contract.repository[key]);
  }
  requireEqual('repository.owner', snapshot.repository?.owner, expectedOwner);
  for (const [key, expected] of Object.entries(contract.merge)) {
    requireEqual(`merge.${key}`, snapshot.merge?.[key], expected);
  }
  for (const [key, expected] of Object.entries(contract.actions)) {
    requireEqual(`actions.${key}`, snapshot.actions?.[key], expected);
  }
  requireEqual('mainProtection.strict', snapshot.mainProtection?.strict, true);
  requireEqual('mainProtection.dismissStaleReviews',
    snapshot.mainProtection?.dismissStaleReviews, true);
  if (!sameArray(snapshot.mainProtection?.checks, [...contract.requiredChecks].sort())) {
    errors.push('mainProtection.checks do not match the required stable contexts');
  }
  requireEqual('releaseTagRuleset.name',
    snapshot.releaseTagRuleset?.name, contract.releaseTagRuleset.name);
  requireEqual('releaseTagRuleset.enforcement',
    snapshot.releaseTagRuleset?.enforcement, contract.releaseTagRuleset.enforcement);
  if (!sameArray(snapshot.releaseTagRuleset?.include, [...contract.releaseTagRuleset.include].sort())) {
    errors.push('releaseTagRuleset.include does not match the v* boundary');
  }
  const rules = new Set(snapshot.releaseTagRuleset?.rules || []);
  for (const rule of contract.releaseTagRuleset.immutableRules) {
    if (!rules.has(rule)) errors.push(`releaseTagRuleset is missing ${rule}`);
  }
  requireEqual('releaseEnvironment.name',
    snapshot.releaseEnvironment?.name, contract.releaseEnvironment);
  for (const [key, expected] of Object.entries(contract.security)) {
    requireEqual(`security.${key}`, snapshot.security?.[key], expected);
  }

  if (phase === 'pre-transfer') {
    const expected = contract.preTransfer;
    requireEqual('repository.ownerType', snapshot.repository?.ownerType, expected.ownerType);
    requireEqual('preTransfer.owner', expectedOwner, expected.owner);
    requireEqual('mainProtection.approvals', snapshot.mainProtection?.approvals, expected.approvals);
    for (const key of ['enforceAdmins', 'codeOwnerReviews', 'lastPushApproval']) {
      requireEqual(`mainProtection.${key}`, snapshot.mainProtection?.[key], expected[key]);
    }
    requireEqual('releaseEnvironment.reviewerCount',
      snapshot.releaseEnvironment?.reviewerCount, expected.releaseReviewers);
    requireEqual('releaseTagRuleset.creationRestricted',
      rules.has('creation'), expected.tagCreationRestricted);
    requireEqual('releaseTeam', snapshot.releaseTeam, null);
  } else {
    const expected = contract.postTransfer;
    if (typeof expectedReleaseTeam !== 'string' ||
        !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(expectedReleaseTeam)) {
      throw new TypeError('post-transfer governance audit requires the exact Release-team slug');
    }
    requireEqual('repository.ownerType', snapshot.repository?.ownerType, expected.ownerType);
    if (!Number.isSafeInteger(snapshot.mainProtection?.approvals) ||
        snapshot.mainProtection.approvals < expected.minimumApprovals) {
      errors.push(`mainProtection.approvals must be at least ${expected.minimumApprovals}`);
    }
    for (const key of ['enforceAdmins', 'codeOwnerReviews', 'lastPushApproval']) {
      requireEqual(`mainProtection.${key}`, snapshot.mainProtection?.[key], expected[key]);
    }
    if (!Number.isSafeInteger(snapshot.releaseEnvironment?.reviewerCount) ||
        snapshot.releaseEnvironment.reviewerCount < expected.minimumReleaseReviewers) {
      errors.push(`releaseEnvironment.reviewerCount must be at least ${expected.minimumReleaseReviewers}`);
    }
    requireEqual('releaseTagRuleset.creationRestricted',
      rules.has('creation'), expected.tagCreationRestricted);
    requireEqual('releaseTeam.slug', snapshot.releaseTeam?.slug, expectedReleaseTeam);
    if (!Number.isSafeInteger(snapshot.releaseTeam?.id) || snapshot.releaseTeam.id <= 0) {
      errors.push('releaseTeam.id is invalid');
    }
    if (expected.releaseTeamBypassRequired && !(snapshot.releaseTagRuleset?.bypassActors || [])
      .some((actor) => actor?.actorType === 'Team' &&
        actor.actorId === snapshot.releaseTeam?.id && actor.bypassMode === 'always')) {
      errors.push('releaseTagRuleset has no Release-team bypass');
    }
  }

  const deferred = [];
  if (snapshot.security?.nonProviderPatterns !== 'enabled') {
    deferred.push('secret scanning non-provider patterns unavailable');
  }
  if (snapshot.security?.validityChecks !== 'enabled') {
    deferred.push('secret scanning validity checks unavailable');
  }
  if (snapshot.actions?.allowedActions === 'all') {
    deferred.push('Actions allowlist remains broad; full-SHA pinning is required');
  }
  return Object.freeze({
    ok: errors.length === 0,
    phase,
    repositoryId: snapshot.repository?.id,
    owner: snapshot.repository?.owner,
    capturedAt: snapshot.capturedAt,
    errors: Object.freeze(errors.sort()),
    deferred: Object.freeze(deferred.sort()),
    snapshot,
  });
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || ![6, 8].includes(argv.length) || argv[0] !== '--live' ||
      argv[2] !== '--phase' || argv[4] !== '--expected-owner') {
    throw new TypeError(
      'usage: audit-live-github-governance.js --live owner/name --phase pre-transfer|post-transfer --expected-owner owner [--expected-release-team slug]',
    );
  }
  const options = { repository: argv[1], phase: argv[3], expectedOwner: argv[5] };
  if (argv.length === 8) {
    if (argv[6] !== '--expected-release-team') throw new TypeError('invalid Release-team argument');
    options.expectedReleaseTeam = argv[7];
  }
  if (options.phase === 'post-transfer' && !options.expectedReleaseTeam ||
      options.phase === 'pre-transfer' && options.expectedReleaseTeam) {
    throw new TypeError('Release-team slug is required only after transfer');
  }
  return options;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = auditSnapshot(readContract(), captureLiveSnapshot(options.repository, {
    ...(options.expectedReleaseTeam ? {
      releaseTeamOwner: options.expectedOwner,
      releaseTeamSlug: options.expectedReleaseTeam,
    } : {}),
  }), options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    process.stderr.write(`GitHub governance audit: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT_PATH,
  auditSnapshot,
  captureLiveSnapshot,
  githubApi,
  parseArguments,
  readContract,
  requiredReviewers,
  run,
};
