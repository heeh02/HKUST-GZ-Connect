(function initializeCampusSearchPresenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusSearchPresenter = api;
})(typeof self !== 'undefined' ? self : globalThis, function campusSearchPresenterFactory() {
  'use strict';

  function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function audienceFor(resource) {
    const values = [resource?.name, resource?.description, ...(Array.isArray(resource?.keywords) ? resource.keywords : [])]
      .map(normalized);
    const includes = (...terms) => values.some((value) => terms.some((term) => value.includes(term)));
    const audiences = [];
    if (includes('本科生', '本科')) audiences.push('本科生');
    if (includes('研究生', '硕士', 'mphil')) audiences.push('研究生');
    if (includes('博士', 'phd')) audiences.push('博士');
    if (includes('教师', '导师')) audiences.push('教师');
    return audiences.join(' / ');
  }

  function score(resource, categoryName, needle) {
    const name = normalized(resource?.name);
    const description = normalized(resource?.description);
    const keywords = (Array.isArray(resource?.keywords) ? resource.keywords : []).map(normalized);
    if (name === needle) return 500;
    if (name.includes(needle)) return 400;
    if (keywords.includes(needle)) return 350;
    if (keywords.some((keyword) => keyword.includes(needle))) return 300;
    if (description.includes(needle)) return 250;
    if (normalized(categoryName).includes(needle)) return 100;
    return 0;
  }

  function present(categories, query) {
    const needle = normalized(query);
    if (!needle) return Object.freeze([]);
    const result = [];
    for (const category of Array.isArray(categories) ? categories : []) {
      const items = (Array.isArray(category?.items) ? category.items : [])
        .map((resource, index) => ({ resource, index, score: score(resource, category.name, needle) }))
        .filter(({ score: value }) => value > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ resource, score: value }) => Object.freeze({
          resource,
          score: value,
          audience: audienceFor(resource),
        }));
      if (items.length) result.push(Object.freeze({ id: category.id, name: category.name, items: Object.freeze(items) }));
    }
    return Object.freeze(result);
  }

  function highlight(value, query, escapeHtml) {
    const source = String(value || '');
    const needle = String(query || '').trim();
    if (!needle || typeof escapeHtml !== 'function') return escapeHtml(source);
    const lower = source.toLocaleLowerCase();
    const index = lower.indexOf(needle.toLocaleLowerCase());
    if (index < 0) return escapeHtml(source);
    return `${escapeHtml(source.slice(0, index))}<mark>${escapeHtml(source.slice(index, index + needle.length))}</mark>${escapeHtml(source.slice(index + needle.length))}`;
  }

  return Object.freeze({ audienceFor, highlight, present });
});
