'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const categoryStacks = require('../renderer/campus-category-stacks');
const { balancedPartitions, getLayoutCapacity } = categoryStacks;
const stackedCardLayout = require('../renderer/stacked-card-layout');

test('responsive capacity keeps six categories in three stable stacks before tall expansion', () => {
  assert.equal(balancedPartitions, stackedCardLayout.balancedPartitions,
    'Campus Browser and routing rules share one stack partition implementation');
  assert.deepEqual(getLayoutCapacity(1009, 640), { columns: 3, rows: 1, slotCount: 3 });
  assert.deepEqual(getLayoutCapacity(1009, 800), { columns: 3, rows: 2, slotCount: 6 });
  assert.deepEqual(balancedPartitions([1, 2, 3, 4, 5, 6], 3), [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(balancedPartitions([1, 2, 3, 4, 5, 6], 6), [[1], [2], [3], [4], [5], [6]]);
});

test('category partitioning is contiguous, balanced, and deterministic', () => {
  const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const first = balancedPartitions(values, 3);
  assert.deepEqual(first, [['a', 'b', 'c'], ['d', 'e'], ['f', 'g']]);
  assert.deepEqual(balancedPartitions(values, 3), first);
  assert.ok(Math.max(...first.map((part) => part.length)) - Math.min(...first.map((part) => part.length)) <= 1);
});

test('category activation focuses the replacement heading and stable resize does not rebuild it', () => {
  const originals = {
    window: global.window,
    document: global.document,
    ResizeObserver: global.ResizeObserver,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
  };
  let resizeCallback;
  let clickHandler;
  let writes = 0;
  let headings = [];
  let activeElement = null;
  const classNames = new Set();
  const container = {
    dataset: {},
    style: { setProperty() {} },
    classList: {
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name),
    },
    getBoundingClientRect: () => ({ width: 500, height: 300, top: 100 }),
    querySelectorAll: (selector) => selector === '[data-category-heading]' ? headings : [],
    addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler; },
  };
  Object.defineProperty(container, 'innerHTML', {
    set(markup) {
      writes += 1;
      headings = [...markup.matchAll(/data-category-heading="([^"]+)"/gu)].map((match) => ({
        dataset: { categoryHeading: match[1] },
        focus(options) { activeElement = this; this.focusOptions = options; },
      }));
    },
  });
  const summary = { textContent: '' };
  const fakeDocument = {
    get activeElement() { return activeElement; },
    getElementById(id) {
      if (id === 'campusResources') return container;
      if (id === 'categoryLayoutSummary') return summary;
      return null;
    },
  };

  try {
    global.window = { innerHeight: 700, innerWidth: 620, setTimeout: (callback) => callback() };
    global.document = fakeDocument;
    global.ResizeObserver = class FakeResizeObserver {
      constructor(callback) { resizeCallback = callback; }
      observe() {}
      disconnect() {}
    };
    global.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.cancelAnimationFrame = () => {};
    const options = {
      container,
      resources: [
        { id: 'alpha', name: 'Alpha', favorite: true, route: 'campus' },
        { id: 'beta', name: 'Beta', favorite: true, route: 'direct' },
      ],
      groups: [
        { id: 'alpha-group', name: 'Alpha group', resourceIds: ['alpha'] },
        { id: 'beta-group', name: 'Beta group', resourceIds: ['beta'] },
      ],
      query: '',
      translate: (key) => key,
      escapeHtml: (value) => String(value),
    };
    categoryStacks.render(options);
    categoryStacks.start({ document: fakeDocument });
    assert.equal(writes, 1);
    clickHandler({ target: { closest: () => ({ dataset: { stackActivate: 'beta-group' } }) } });
    assert.equal(writes, 2);
    assert.equal(fakeDocument.activeElement.dataset.categoryHeading, 'beta-group');
    assert.deepEqual(fakeDocument.activeElement.focusOptions, { preventScroll: true });
    const focusedHeading = fakeDocument.activeElement;
    resizeCallback();
    assert.equal(writes, 2, 'same-layout ResizeObserver notifications must not replace the DOM');
    assert.equal(fakeDocument.activeElement, focusedHeading, 'stable resize must preserve heading focus');
    assert.equal(classNames.has('searching'), false);
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete global[name]; else global[name] = value;
    }
  }
});
