(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.capabilityPresentation = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const STATES = new Set(['supported', 'unsupported', 'unavailable']);
  const CAPABILITY = /^[a-z][a-z0-9_.-]{0,63}$/u;
  const SECONDARY_AUTH = Object.freeze([
    'auth.captcha', 'auth.sms', 'auth.token', 'auth.certificate', 'auth.hid',
    'auth.sso', 'auth.device', 'auth.unknown_secondary',
  ]);

  function aggregate(states) {
    if (states.includes('supported')) return 'supported';
    if (states.includes('unavailable')) return 'unavailable';
    return 'unsupported';
  }

  function capabilityView(value) {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.schemaVersion !== 1 || typeof value.profileId !== 'string' ||
        !/^[a-z0-9-]{1,64}$/u.test(value.profileId) ||
        !value.effective || typeof value.effective !== 'object' ||
        Array.isArray(value.effective)) return null;
    const entries = Object.entries(value.effective);
    if (!entries.length || entries.length > 64 || entries.some(([name, state]) => (
      !CAPABILITY.test(name) || !STATES.has(state)
    ))) return null;
    const effective = Object.fromEntries(entries);
    const state = (name) => effective[name] || 'unavailable';
    return Object.freeze({
      profileId: value.profileId,
      items: Object.freeze([
        Object.freeze({ id: 'password', state: state('auth.password') }),
        Object.freeze({ id: 'secondary', state: aggregate(SECONDARY_AUTH.map(state)) }),
        Object.freeze({ id: 'l3', state: state('transport.l3') }),
        Object.freeze({ id: 'webVpn', state: state('transport.web_vpn') }),
        Object.freeze({ id: 'resources', state: state('resource.catalogue') }),
      ]),
    });
  }

  function createCapabilityPresentation({ document, translate } = {}) {
    if (!document || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function' || typeof translate !== 'function') {
      throw new TypeError('capability presentation environment is incomplete');
    }
    const rootElement = document.getElementById('capabilitySummary');
    const list = document.getElementById('capabilityList');
    if (!rootElement || !list) throw new TypeError('capability presentation markup is incomplete');
    let t = translate;
    let current = null;

    function render(value) {
      if (arguments.length) current = capabilityView(value);
      rootElement.hidden = current === null;
      if (!current) {
        list.replaceChildren();
        return false;
      }
      list.replaceChildren(...current.items.map((item) => {
        const row = document.createElement('div');
        row.className = 'capability-item';
        const name = document.createElement('span');
        name.className = 'capability-name';
        name.textContent = t(`capability.item.${item.id}`);
        const status = document.createElement('span');
        status.className = `capability-state ${item.state}`;
        status.textContent = t(`capability.state.${item.state}`);
        row.append(name, status);
        return row;
      }));
      return true;
    }

    function setTranslator(next) {
      if (typeof next !== 'function') return false;
      t = next;
      render();
      return true;
    }

    return Object.freeze({ render, setTranslator });
  }

  return { capabilityView, createCapabilityPresentation };
});

if (typeof window !== 'undefined' && window.document && window.I18N) {
  const locale = () => window.document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en';
  const feature = window.capabilityPresentation.createCapabilityPresentation({
    document: window.document,
    translate: window.I18N.createT(locale()),
  });
  for (const eventName of ['app-state-refreshed', 'app-status-updated']) {
    window.document.addEventListener(eventName, (event) => {
      feature.render(event.detail?.capabilitySnapshot);
    });
  }
  window.document.addEventListener('app-locale-changed', () => {
    feature.setTranslator(window.I18N.createT(locale()));
  });
  feature.render(null);
  window.capabilityPresentationFeature = feature;
}
