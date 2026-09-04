(function initializeCampusSearchPresenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusSearchPresenter = api;
})(typeof self !== 'undefined' ? self : globalThis, function campusSearchPresenterFactory() {
  'use strict';

  // §13.2: task phrasing is stripped before matching so "我要申请在读证明"
  // reaches the "在读证明" entry. Structured aliases/useCase/audience live in
  // the reviewed service-desk document — no hardcoded per-site hints here.
  const TASK_PHRASING = /我要申请|我想申请|我要|我想|请问|怎么|如何|一下|办理/gu;

  function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function taskTerms(value) {
    return normalized(value).replace(TASK_PHRASING, '').replace(/\s+/gu, '');
  }

  // name > alias > useCase > audience; plain substring scoring, no search library.
  function scoreEntry(entry, needle) {
    const query = taskTerms(needle);
    if (!query) return { value: 0, term: '' };
    const name = taskTerms(entry?.name);
    if (name) {
      if (name === query) return { value: 500, term: name };
      if (name.includes(query)) return { value: 400, term: query };
      if (query.length >= 2 && query.includes(name)) return { value: 390, term: name };
    }
    let aliasScore = 0;
    for (const alias of Array.isArray(entry?.aliases) ? entry.aliases : []) {
      const term = taskTerms(alias);
      if (!term) continue;
      if (term === query) aliasScore = Math.max(aliasScore, 350);
      else if (term.includes(query)) aliasScore = Math.max(aliasScore, 300);
      else if (query.length >= 2 && query.includes(term)) aliasScore = Math.max(aliasScore, 290);
      if (aliasScore === 350) return { value: 350, term };
    }
    if (aliasScore) return { value: aliasScore, term: query };
    const useCase = taskTerms(entry?.useCase);
    if (useCase && useCase.includes(query)) return { value: 250, term: query };
    const audience = taskTerms(entry?.audience);
    if (audience && audience.includes(query)) return { value: 150, term: query };
    return { value: 0, term: '' };
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

  return Object.freeze({ highlight, normalized, scoreEntry, taskTerms });
});
