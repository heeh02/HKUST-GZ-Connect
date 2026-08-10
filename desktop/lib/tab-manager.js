'use strict';

const DEFAULT_MAX_TABS = 24;

class TabLimitError extends Error {
  constructor(maxTabs) {
    super(`tab limit reached: ${maxTabs}`);
    this.name = 'TabLimitError';
    this.maxTabs = maxTabs;
  }
}

class TabManager {
  constructor({ maxTabs = DEFAULT_MAX_TABS } = {}) {
    const limit = Number(maxTabs);
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('maxTabs must be positive');
    this.maxTabs = limit;
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
  }

  get size() {
    return this.tabs.length;
  }

  canAdd() {
    return this.tabs.length < this.maxTabs;
  }

  contains(tab) {
    return this.tabs.includes(tab);
  }

  find(id) {
    return this.tabs.find((tab) => tab.id === id) || null;
  }

  at(index) {
    return this.tabs.at(index) || null;
  }

  active() {
    return this.find(this.activeTabId);
  }

  add(tab) {
    if (!tab || typeof tab !== 'object') throw new TypeError('tab must be an object');
    if (!this.canAdd()) throw new TabLimitError(this.maxTabs);
    if (tab.id == null) {
      tab.id = this.nextTabId++;
    } else {
      const id = Number(tab.id);
      if (!Number.isSafeInteger(id) || id < 1 || this.find(id)) {
        throw new TypeError('tab id must be a unique positive integer');
      }
      tab.id = id;
      this.nextTabId = Math.max(this.nextTabId, id + 1);
    }
    this.tabs.push(tab);
    return tab;
  }

  select(id) {
    const tab = this.find(id);
    if (!tab) return null;
    this.activeTabId = tab.id;
    return tab;
  }

  replace(id, replacement) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1 || !replacement || typeof replacement !== 'object') return null;
    replacement.id = id;
    const previous = this.tabs[index];
    this.tabs[index] = replacement;
    return { previous, replacement, index, active: this.activeTabId === id };
  }

  remove(id) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return null;
    const wasActive = this.activeTabId === id;
    const [tab] = this.tabs.splice(index, 1);
    let replacement = null;
    if (!this.tabs.length) {
      this.activeTabId = null;
    } else if (wasActive) {
      replacement = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeTabId = replacement.id;
    }
    return { tab, index, wasActive, replacement, empty: this.tabs.length === 0 };
  }

  replaceAll(tabs, { activeTabId = null } = {}) {
    if (!Array.isArray(tabs)) throw new TypeError('tabs must be an array');
    if (tabs.length > this.maxTabs) throw new TabLimitError(this.maxTabs);
    const ids = new Set();
    let highestId = 0;
    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object') throw new TypeError('tab must be an object');
      if (tab.id == null) continue;
      const id = Number(tab.id);
      if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) {
        throw new TypeError('tab ids must be unique positive integers');
      }
      tab.id = id;
      ids.add(id);
      highestId = Math.max(highestId, id);
    }
    let allocation = this.nextTabId;
    for (const tab of tabs) {
      if (tab.id != null) continue;
      while (ids.has(allocation)) allocation++;
      tab.id = allocation++;
      ids.add(tab.id);
      highestId = Math.max(highestId, tab.id);
    }
    this.tabs = tabs;
    this.nextTabId = Math.max(allocation, highestId + 1);
    this.activeTabId = ids.has(activeTabId) ? activeTabId : null;
    return this.tabs;
  }

  clear() {
    const previous = this.tabs;
    this.tabs = [];
    this.activeTabId = null;
    return previous;
  }
}

module.exports = {
  DEFAULT_MAX_TABS,
  TabLimitError,
  TabManager,
};
