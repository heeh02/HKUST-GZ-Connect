'use strict';

(function initializeLoginFlow(globalScope) {
  function translated(translate, key, fallback) {
    if (typeof translate !== 'function') return fallback;
    const value = translate(key);
    return typeof value === 'string' && value ? value : fallback;
  }

  function evaluateLoginProgress(pending, state = {}, translate = null) {
    if (!pending) {
      return { pending: false, view: null, clearPassword: false, error: '' };
    }
    if (state.connected) {
      return { pending: false, view: 'dash', clearPassword: true, error: '' };
    }
    if (!state.connecting && state.lastError) {
      return {
        pending: false,
        view: 'login',
        clearPassword: false,
        error: String(state.lastError),
      };
    }
    return {
      pending: true,
      view: 'login',
      clearPassword: false,
      error: translated(translate, 'login.connecting', '正在连接…'),
    };
  }

  const loginFlowApi = { evaluateLoginProgress };
  if (typeof module !== 'undefined' && module.exports) module.exports = loginFlowApi;
  if (globalScope) globalScope.loginFlow = loginFlowApi;
})(typeof window !== 'undefined' ? window : null);
