'use strict';

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
    tab.title = item.title || '新标签页';

    if (item.loading) {
      const loading = document.createElement('span');
      loading.className = 'tab-loading';
      loading.setAttribute('aria-hidden', 'true');
      tab.appendChild(loading);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = item.title || '新标签页';
    tab.appendChild(title);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.dataset.closeTabId = String(item.id);
    close.title = '关闭标签页';
    close.setAttribute('aria-label', '关闭标签页');
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
  setState(next) {
    renderTabs(next.tabs, next.activeTabId);
    if (document.activeElement !== address) address.value = next.url || '';
    back.disabled = !next.canGoBack;
    forward.disabled = !next.canGoForward;
    state.textContent = next.loading ? '正在加载…' : '校园网络';
    state.classList.toggle('loading', !!next.loading);
    document.title = next.title ? `${next.title} - HKUST(GZ)` : 'HKUST(GZ) 校园浏览器';
  },
  focusAddress() {
    address.focus();
    address.select();
  },
};
