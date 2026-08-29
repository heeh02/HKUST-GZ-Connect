'use strict';

(function initializeCampusCategoryStacks(globalScope) {
  let current = null;
  let observer = null;
  let preferredCategoryId = null;
  let resizeFrame = null;

  function getLayoutCapacity(width, height) {
    const safeWidth = Math.max(0, Number(width) || 0);
    const safeHeight = Math.max(0, Number(height) || 0);
    const columns = safeWidth >= 1280 ? 4 : safeWidth >= 930 ? 3 : safeWidth >= 610 ? 2 : 1;
    const rows = safeHeight >= 780 ? 2 : 1;
    return Object.freeze({ columns, rows, slotCount: columns * rows });
  }

  function balancedPartitions(items, count) {
    const safe = Array.isArray(items) ? items : [];
    const partitions = [];
    const slots = Math.max(1, Math.min(safe.length || 1, Number(count) || 1));
    let cursor = 0;
    for (let index = 0; index < slots; index += 1) {
      const size = Math.ceil((safe.length - cursor) / (slots - index));
      partitions.push(safe.slice(cursor, cursor + size));
      cursor += size;
    }
    return partitions;
  }

  function categoryProjection(resources, groups, translate) {
    const favorites = (Array.isArray(resources) ? resources : []).filter(({ favorite }) => favorite === true);
    const byId = new Map(favorites.map((resource) => [resource.id, resource]));
    const assigned = new Set();
    const projected = (Array.isArray(groups) ? groups : []).map((group) => {
      const items = (Array.isArray(group.resourceIds) ? group.resourceIds : []).map((id) => byId.get(id)).filter(Boolean);
      items.forEach(({ id }) => assigned.add(id));
      return { id: group.id, name: group.name, items };
    }).filter(({ id, name }) => typeof id === 'string' && typeof name === 'string' && name.trim());
    const ungrouped = favorites.filter(({ id }) => !assigned.has(id));
    if (ungrouped.length) projected.unshift({ id: 'ungrouped', name: translate('browser.ungrouped'), items: ungrouped });
    return projected;
  }

  function siteIcon(resource) {
    const category = String(resource.category || 'custom');
    const paths = category === 'learning' || category === 'courses'
      ? '<path d="M4 6h6.5A2.5 2.5 0 0 1 13 8.5V19a2.5 2.5 0 0 0-2.5-2.5H4zM20 6h-4.5A2.5 2.5 0 0 0 13 8.5V19a2.5 2.5 0 0 1 2.5-2.5H20z"/>'
      : '<rect x="5" y="5" width="5" height="5"/><rect x="14" y="5" width="5" height="5"/><rect x="5" y="14" width="5" height="5"/><rect x="14" y="14" width="5" height="5"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  function siteRows(items, translate, escapeHtml) {
    const esc = escapeHtml;
    if (!items.length) return `<p class="category-empty">${esc(translate('browser.emptyCategory'))}</p>`;
    return items.map((resource) => {
      const route = resource.route === 'direct' ? translate('resources.routeDirect') : translate('resources.routeCampus');
      return `<div class="category-site" data-campus-id="${esc(resource.id)}">`
        + `<button class="category-site-open" type="button" data-resource-action="open" title="${esc(resource.name)}">`
        + `<span class="category-site-icon">${siteIcon(resource)}</span><span class="category-site-copy">`
        + `<strong>${esc(resource.name)}</strong><small>${esc(route)}</small></span></button>`
        + `<button class="resource-favorite active" type="button" data-resource-action="favorite" title="${esc(translate('resources.unfavorite'))}" aria-label="${esc(translate('resources.unfavorite'))}">★</button></div>`;
    }).join('');
  }

  function renderSearch(categories, query, translate, escapeHtml) {
    const needle = query.toLocaleLowerCase();
    const sections = categories.map((category) => {
      const groupMatch = category.name.toLocaleLowerCase().includes(needle);
      const items = category.items.filter((resource) => groupMatch || [resource.name, resource.description, resource.url]
        .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
      return items.length ? `<section class="category-search-section"><h3>${escapeHtml(category.name)}<span>${items.length}</span></h3>${siteRows(items, translate, escapeHtml)}</section>` : '';
    }).join('');
    return `<div class="category-search-results">${sections || `<div class="category-empty-state"><strong>${escapeHtml(translate('resources.empty'))}</strong><span>${escapeHtml(translate('resources.emptyFilteredHint'))}</span></div>`}</div>`;
  }

  function renderStack(stack, index, translate, escapeHtml) {
    const active = stack.find(({ id }) => id === preferredCategoryId) || stack[0];
    const tabs = stack.filter(({ id }) => id !== active.id).map((category) => `<button class="stacked-category-tab" type="button" data-stack-activate="${escapeHtml(category.id)}" aria-pressed="false"><span>${escapeHtml(category.name)}</span><small>${category.items.length}</small></button>`).join('');
    return `<section class="category-stack${stack.length > 1 ? ' layered' : ''}" data-stack-index="${index}"><div class="category-stack-tabs">${tabs}</div>`
      + `<article class="category-card" data-category-id="${escapeHtml(active.id)}"><header><h3>${escapeHtml(active.name)}</h3><span>${active.items.length}</span></header>`
      + `<div class="category-site-list">${siteRows(active.items, translate, escapeHtml)}</div></article></section>`;
  }

  function performRender() {
    if (!current) return;
    const { container, resources, groups, query, translate, escapeHtml } = current;
    const categories = categoryProjection(resources, groups, translate);
    if (!preferredCategoryId || !categories.some(({ id }) => id === preferredCategoryId)) preferredCategoryId = categories[0]?.id || null;
    const rect = container.getBoundingClientRect();
    const availableHeight = Math.max(rect.height, window.innerHeight - rect.top - 28);
    const capacity = getLayoutCapacity(rect.width || window.innerWidth - 120, availableHeight);
    const summary = document.getElementById('categoryLayoutSummary');
    if (summary) summary.textContent = categories.length ? translate('browser.categoryCount', { count: categories.length }) : '';
    container.style.setProperty('--stack-columns', String(capacity.columns));
    if (String(query || '').trim()) {
      container.classList.add('searching');
      container.innerHTML = renderSearch(categories, String(query).trim(), translate, escapeHtml);
      return;
    }
    container.classList.remove('searching');
    if (!categories.length) {
      container.innerHTML = `<div class="category-empty-state"><strong>${escapeHtml(translate('browser.noCategories'))}</strong><span>${escapeHtml(translate('browser.noCategoriesHint'))}</span><button class="mini" type="button" data-resource-empty-action="manage">${escapeHtml(translate('resources.manage'))}</button></div>`;
      return;
    }
    container.innerHTML = balancedPartitions(categories, capacity.slotCount)
      .map((stack, index) => renderStack(stack, index, translate, escapeHtml)).join('');
  }

  function render(options = {}) {
    if (!options.container || typeof options.translate !== 'function' || typeof options.escapeHtml !== 'function') {
      throw new TypeError('category stack dependencies are incomplete');
    }
    current = options;
    if (!observer && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(performRender);
      });
      observer.observe(options.container);
    }
    performRender();
  }

  function start({ document } = {}) {
    const container = document?.getElementById('campusResources');
    if (!container) throw new TypeError('category stack container is missing');
    container.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-stack-activate]');
      if (!tab || tab.getAttribute('aria-pressed') === 'true') return;
      preferredCategoryId = tab.dataset.stackActivate;
      container.classList.add('reordering');
      performRender();
      window.setTimeout(() => container.classList.remove('reordering'), 280);
    });
  }

  const api = Object.freeze({ balancedPartitions, getLayoutCapacity, render, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.campusCategoryStacks = api;
})(typeof window !== 'undefined' ? window : null);
