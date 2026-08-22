'use strict';

const { allowedKeys, boundedString } = require('./ipc-guard');

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
  const source = allowedKeys(value, ['host', 'includeSubdomains', 'route', 'previous']);
  if (source.route !== 'campus' && source.route !== 'direct') {
    throw new TypeError('路由规则路径无效');
  }
  return {
    ...routingIdentityFromIpc({
      host: source.host,
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
      typeof policy.replace !== 'function' || typeof runTransaction !== 'function') {
    throw new TypeError('routing rule IPC dependencies are incomplete');
  }
  register('list-routing-rules', () => {
    try {
      return { ok: true, rules: policy.list() };
    } catch (error) {
      return { ok: false, error: error.message, rules: safeRules(policy) };
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
