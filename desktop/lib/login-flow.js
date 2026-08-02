'use strict';

function evaluateLoginProgress(pending, state = {}) {
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
  return { pending: true, view: 'login', clearPassword: false, error: '正在连接…' };
}

const api = { evaluateLoginProgress };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.loginFlow = api;
