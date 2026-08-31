'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');
const { normalizeRoutingTarget } = require('../routing/rules/routing-rule-store');

const SAFE_SOURCES = new Set([
  'safety', 'user-exact', 'user-subdomain', 'custom-resource', 'builtin',
  'server-resource', 'inherited', 'default',
]);

function routingIdentityFromIpc(value) {
  const source = allowedKeys(value, ['host', 'includeSubdomains']);
  if (typeof source.includeSubdomains !== 'boolean') {
    throw new TypeError('路由规则范围无效');
  }
  return {
    host: boundedString(source.host, { minLength: 1, maxLength: 253, trim: true }),
    includeSubdomains: source.includeSubdomains,
  };
}

function routingRuleFromIpc(value) {
  const source = allowedKeys(value, [
    'host', 'target', 'includeSubdomains', 'route', 'previous',
  ]);
  if (source.route !== 'campus' && source.route !== 'direct') {
    throw new TypeError('路由规则路径无效');
  }
  if ((source.host == null) === (source.target == null)) {
    throw new TypeError('路由规则目标无效');
  }
  const host = normalizeRoutingTarget(boundedString(source.target ?? source.host, {
    minLength: 1, maxLength: 2048, trim: true,
  })).host;
  return {
    ...routingIdentityFromIpc({
      host,
      includeSubdomains: source.includeSubdomains,
    }),
    route: source.route,
    ...(source.previous == null ? {} : { previous: routingIdentityFromIpc(source.previous) }),
  };
}

function safeRules(policy) {
  try { return policy.list(); } catch { return []; }
}

function registerRoutingRuleIpc({ register, policy, runTransaction } = {}) {
  if (typeof register !== 'function' || !policy || typeof policy.list !== 'function' ||
      typeof policy.upsert !== 'function' || typeof policy.remove !== 'function' ||
      typeof policy.replace !== 'function' || typeof policy.resolve !== 'function' ||
      typeof runTransaction !== 'function') {
    throw new TypeError('routing rule IPC dependencies are incomplete');
  }
  register('list-routing-rules', () => {
    try {
      return { ok: true, rules: policy.list() };
    } catch (error) {
      return { ok: false, error: error.message, rules: safeRules(policy) };
    }
  });
  register('preview-routing-target', (_event, rawTarget) => {
    try {
      const target = normalizeRoutingTarget(boundedString(rawTarget, {
        minLength: 1, maxLength: 2048, trim: true,
      }));
      const resolution = policy.resolve(`https://${target.host}/`);
      return {
        ok: true,
        target,
        resolution: {
          route: resolution?.route === 'direct' ? 'direct' : 'campus',
          source: SAFE_SOURCES.has(resolution?.source) ? resolution.source : 'default',
          matchedRule: resolution?.matchedRule && typeof resolution.matchedRule.host === 'string'
            ? {
              host: resolution.matchedRule.host,
              includeSubdomains: resolution.matchedRule.includeSubdomains === true,
            } : null,
        },
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  register('save-routing-rule', async (_event, payload) => {
    try {
      const rule = routingRuleFromIpc(payload);
      const result = await runTransaction(() => {
        const previousRules = policy.list();
        return {
          commit: () => policy.upsert(rule),
          rollback: () => policy.replace(previousRules),
        };
      });
      return { ok: true, ...result, warning: null };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        rules: safeRules(policy),
      };
    }
  });
  register('delete-routing-rule', async (_event, payload) => {
    try {
      const identity = routingIdentityFromIpc(payload);
      const rules = await runTransaction(() => {
        const previousRules = policy.list();
        return {
          commit: () => policy.remove(identity),
          rollback: () => policy.replace(previousRules),
        };
      });
      return { ok: true, rules, warning: null };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        rollbackIncomplete: error.rollbackIncomplete === true,
        rules: safeRules(policy),
      };
    }
  });
}

module.exports = {
  registerRoutingRuleIpc,
  routingIdentityFromIpc,
  routingRuleFromIpc,
};
