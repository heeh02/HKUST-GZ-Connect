'use strict';

(function initializeCampusCategoryStacks(globalScope, stackLayout) {
  let current = null;
  let observer = null;
  let preferredCategoryId = null;
  let resizeFrame = null;
  let renderedContainer = null;
  let renderSignature = '';

  function getLayoutCapacity(width, height) {
    const safeWidth = Math.max(0, Number(width) || 0);
    const safeHeight = Math.max(0, Number(height) || 0);
    const columns = safeWidth >= 1280 ? 4 : safeWidth >= 930 ? 3 : safeWidth >= 610 ? 2 : 1;
    const rows = safeHeight >= 780 ? 2 : 1;
    return Object.freeze({ columns, rows, slotCount: columns * rows });
  }

  if (!stackLayout?.balancedPartitions) throw new TypeError('stacked card layout is required');
  const { balancedPartitions } = stackLayout;

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
    const panelId = `campus-category-panel-${index}`;
    const headingId = `campus-category-heading-${index}`;
    const tabs = stack.filter(({ id }) => id !== active.id).map((category) => `<button class="stacked-category-tab" type="button" data-stack-activate="${escapeHtml(category.id)}" aria-controls="${panelId}"><span>${escapeHtml(category.name)}</span><small>${category.items.length}</small></button>`).join('');
    return `<section class="category-stack${stack.length > 1 ? ' layered' : ''}" data-stack-index="${index}" role="group" aria-labelledby="${headingId}"><div class="category-stack-tabs">${tabs}</div>`
      + `<article id="${panelId}" class="category-card" data-category-id="${escapeHtml(active.id)}" role="region" aria-labelledby="${headingId}"><header><h3 id="${headingId}" tabindex="-1" data-category-heading="${escapeHtml(active.id)}">${escapeHtml(active.name)}</h3><span>${active.items.length}</span></header>`
      + `<div class="category-site-list">${siteRows(active.items, translate, escapeHtml)}</div></article></section>`;
  }

  function focusCategoryHeading(container, categoryId) {
    if (!categoryId) return false;
    const heading = [...container.querySelectorAll('[data-category-heading]')]
      .find((candidate) => candidate.dataset.categoryHeading === categoryId);
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    return true;
  }

  function performRender({ focusCategoryId = null } = {}) {
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
    container.dataset.stackColumns = String(capacity.columns);
    let mode = 'stacks';
    let markup;
    if (String(query || '').trim()) {
      mode = 'search';
      container.classList.add('searching');
      markup = renderSearch(categories, String(query).trim(), translate, escapeHtml);
    } else {
      container.classList.remove('searching');
      if (!categories.length) {
        mode = 'empty';
        markup = `<div class="category-empty-state"><strong>${escapeHtml(translate('browser.noCategories'))}</strong><span>${escapeHtml(translate('browser.noCategoriesHint'))}</span><button class="mini" type="button" data-resource-empty-action="manage">${escapeHtml(translate('resources.manage'))}</button></div>`;
      } else {
        markup = balancedPartitions(categories, capacity.slotCount)
          .map((stack, index) => renderStack(stack, index, translate, escapeHtml)).join('');
      }
    }
    const nextSignature = `${capacity.columns}\u0000${mode}\u0000${markup}`;
    const changed = renderedContainer !== container || renderSignature !== nextSignature;
    if (changed) {
      container.innerHTML = markup;
      renderedContainer = container;
      renderSignature = nextSignature;
    }
    if (focusCategoryId) focusCategoryHeading(container, focusCategoryId);
    return changed;
  }

  function render(options = {}) {
    if (!options.container || typeof options.translate !== 'function' || typeof options.escapeHtml !== 'function') {
      throw new TypeError('category stack dependencies are incomplete');
    }
    if (current?.container && current.container !== options.container) {
      observer?.disconnect?.();
      observer = null;
      renderedContainer = null;
      renderSignature = '';
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
      if (!tab) return;
      preferredCategoryId = tab.dataset.stackActivate;
      container.classList.add('reordering');
      performRender({ focusCategoryId: preferredCategoryId });
      window.setTimeout(() => container.classList.remove('reordering'), 280);
    });
  }

  const api = Object.freeze({ balancedPartitions, getLayoutCapacity, render, start });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.campusCategoryStacks = api;
})(typeof window !== 'undefined' ? window : null,
  typeof module !== 'undefined' && module.exports
    ? require('./stacked-card-layout')
    : globalThis.stackedCardLayout);
