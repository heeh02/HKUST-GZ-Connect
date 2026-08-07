'use strict';

// The main process passes the resolved UI locale as ?lang= on loadFile, and
// can switch it live later through campusBrowserUI.setLocale.
let locale = 'zh';
let t = window.I18N.createT(locale);

function applyLang(lang) {
  locale = window.I18N.resolveLocale(lang);
  t = window.I18N.createT(locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  window.I18N.applyStatic(t, document);
  document.title = t('browser.title');
}

applyLang(new URLSearchParams(location.search).get('lang'));

if (/Macintosh|Mac OS X/.test(navigator.userAgent)) {
  document.documentElement.classList.add('macos');
} else if (/Windows/.test(navigator.userAgent)) {
  document.documentElement.classList.add('windows');
}

const address = document.getElementById('address');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const reload = document.getElementById('reload');
const state = document.getElementById('state');
const tabs = document.getElementById('tabs');
const routeSelector = document.getElementById('routeSelector');
const security = document.getElementById('security');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');

function command(name, value = '') {
  const values = new URLSearchParams({
    command: name,
    value,
    nonce: String(Date.now()),
  });
  window.location.hash = values.toString();
}

back.addEventListener('click', () => command('back'));
forward.addEventListener('click', () => command('forward'));
reload.addEventListener('click', () => command('reload'));
document.getElementById('credential').addEventListener(
  'click',
  () => command('manage-credential'),
);
document.getElementById('newTab').addEventListener('click', () => command('new-tab'));
document.getElementById('addressForm').addEventListener('submit', (event) => {
  event.preventDefault();
  command('navigate', address.value);
});
routeSelector.addEventListener('change', () => command('set-route', routeSelector.value));

findInput.addEventListener('input', () => command('find', findInput.value));
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    command(event.shiftKey ? 'find-prev' : 'find-next');
  } else if (event.key === 'Escape') {
    event.preventDefault();
    command('find-close');
  }
});
document.getElementById('findPrev').addEventListener('click', () => command('find-prev'));
document.getElementById('findNext').addEventListener('click', () => command('find-next'));
document.getElementById('findClose').addEventListener('click', () => command('find-close'));

function renderTabs(items, activeTabId) {
  const previousScroll = tabs.scrollLeft;
  const fragment = document.createDocumentFragment();
  for (const item of items || []) {
    const tab = document.createElement('button');
    tab.className = `tab${item.id === activeTabId ? ' active' : ''}`;
    tab.type = 'button';
    tab.dataset.tabId = String(item.id);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(item.id === activeTabId));
    tab.title = item.title || t('browser.newTabFallback');

    if (item.loading) {
      const loading = document.createElement('span');
      loading.className = 'tab-loading';
      loading.setAttribute('aria-hidden', 'true');
      tab.appendChild(loading);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = item.title || t('browser.newTabFallback');
    tab.appendChild(title);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.dataset.closeTabId = String(item.id);
    close.title = t('browser.closeTab');
    close.setAttribute('aria-label', t('browser.closeTab'));
    close.textContent = '×';
    tab.appendChild(close);
    fragment.appendChild(tab);
  }
  tabs.replaceChildren(fragment);
  tabs.scrollLeft = previousScroll;
  tabs.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

tabs.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-tab-id]');
  if (close) {
    command('close-tab', close.dataset.closeTabId);
    return;
  }
  const tab = event.target.closest('[data-tab-id]');
  if (tab) command('switch-tab', tab.dataset.tabId);
});

window.campusBrowserUI = {
  setLocale(lang) {
    applyLang(lang);
  },
  setState(next) {
    renderTabs(next.tabs, next.activeTabId);
    if (document.activeElement !== address) address.value = next.url || '';
    back.disabled = !next.canGoBack;
    forward.disabled = !next.canGoForward;
    routeSelector.value = next.route === 'direct' ? 'direct' : 'campus';
    security.textContent = next.route === 'direct' ? t('browser.badgeDirect') : t('browser.badgeCampus');
    security.classList.toggle('direct', next.route === 'direct');
    security.title = next.route === 'direct' ? t('browser.viaDirect') : t('browser.viaCampus');
    state.textContent = next.loading
      ? (next.slow ? t('browser.loadingSlow') : t('browser.loading'))
      : (next.routeLabel || t('browser.routeCampus'));
    state.classList.toggle('loading', !!next.loading);
    findBar.hidden = !next.findOpen;
    document.title = next.title ? `${next.title} - HKUST(GZ)` : t('browser.title');
  },
  focusAddress() {
    address.focus();
    address.select();
  },
  focusFind() {
    findInput.focus();
    findInput.select();
  },
};
