(function initializeCampusSearchPresenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusSearchPresenter = api;
})(typeof self !== 'undefined' ? self : globalThis, function campusSearchPresenterFactory() {
  'use strict';

  function normalized(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  const REVIEWED_HINTS = Object.freeze({
    'pbms': Object.freeze({
      zh: Object.freeze({ audience: '科研项目负责人 / 项目成员', useCase: '科研项目经费报销' }),
      en: Object.freeze({ audience: 'Project leads / members', useCase: 'Research expense claims' }),
    }),
    'e-tender': Object.freeze({
      zh: Object.freeze({ audience: '教职工 / 项目采购', useCase: '采购与招标前置流程' }),
      en: Object.freeze({ audience: 'Staff / project buyers', useCase: 'Procurement and tender workflow' }),
    }),
    'e-form': Object.freeze({
      zh: Object.freeze({ audience: '学生 / 教职工', useCase: '差旅与行政申请' }),
      en: Object.freeze({ audience: 'Students / staff', useCase: 'Travel and administrative requests' }),
    }),
    'academic-edoc': Object.freeze({
      zh: Object.freeze({ audience: '学生', useCase: '在读证明与成绩单申请' }),
      en: Object.freeze({ audience: 'Students', useCase: 'Enrollment certificates and transcripts' }),
    }),
  });

  function reviewedHint(resource) {
    const hint = REVIEWED_HINTS[resource?.id];
    if (!hint) return null;
    const content = `${resource?.name || ''} ${resource?.description || ''}`;
    return /[\u3400-\u9fff]/u.test(content) ? hint.zh : hint.en;
  }

  function audienceFor(resource) {
    const reviewed = reviewedHint(resource);
    if (reviewed?.audience) return reviewed.audience;
    const values = [resource?.name, resource?.description, ...(Array.isArray(resource?.keywords) ? resource.keywords : [])]
      .map(normalized);
    const includes = (...terms) => values.some((value) => terms.some((term) => value.includes(term)));
    const chinese = /[\u3400-\u9fff]/u.test(values.join(' '));
    const audiences = [];
    if (includes('本科生', '本科', 'undergraduate')) audiences.push(chinese ? '本科生' : 'Undergraduates');
    if (includes('研究生', '硕士', 'mphil', 'postgraduate')) audiences.push(chinese ? '研究生' : 'Postgraduates');
    if (includes('博士', 'phd')) audiences.push(chinese ? '博士' : 'PhD students');
    if (includes('教师', '导师', 'faculty', 'supervisor')) audiences.push(chinese ? '教师' : 'Faculty');
    return audiences.join(' / ');
  }

  function candidateTerms(resource, categoryName) {
    return [
      resource?.name,
      ...(Array.isArray(resource?.keywords) ? resource.keywords : []),
      resource?.description,
      categoryName,
    ].map(normalized).filter(Boolean);
  }

  function score(resource, categoryName, needle) {
    const name = normalized(resource?.name);
    const description = normalized(resource?.description);
    const keywords = (Array.isArray(resource?.keywords) ? resource.keywords : []).map(normalized);
    const queryContains = (value) => value.length >= 2 && needle.includes(value);
    if (name === needle) return { value: 500, term: name };
    if (name.includes(needle)) return { value: 400, term: needle };
    if (queryContains(name)) return { value: 390, term: name };
    const exactKeyword = keywords.find((keyword) => keyword === needle);
    if (exactKeyword) return { value: 350, term: exactKeyword };
    const containedKeyword = keywords.find((keyword) => keyword.includes(needle));
    if (containedKeyword) return { value: 300, term: needle };
    const queryKeyword = keywords.find(queryContains);
    if (queryKeyword) return { value: 290, term: queryKeyword };
    if (description.includes(needle)) return { value: 250, term: needle };
    const descriptionTerm = candidateTerms(resource, categoryName)
      .slice(0, -1).find((term) => term.length >= 2 && description.includes(term) && needle.includes(term));
    if (descriptionTerm) return { value: 240, term: descriptionTerm };
    const category = normalized(categoryName);
    if (category.includes(needle)) return { value: 100, term: needle };
    if (queryContains(category)) return { value: 90, term: category };
    return { value: 0, term: '' };
  }

  function present(categories, query) {
    const needle = normalized(query);
    if (!needle) return Object.freeze([]);
    const candidates = [];
    for (const category of Array.isArray(categories) ? categories : []) {
      const items = (Array.isArray(category?.items) ? category.items : [])
        .map((resource, index) => ({ resource, index, match: score(resource, category.name, needle) }))
        .filter(({ match }) => match.value > 0);
      if (items.length) candidates.push({ id: category.id, name: category.name, items });
    }
    const strongest = Math.max(0, ...candidates.flatMap(({ items }) => items.map(({ match }) => match.value)));
    const concreteCutoff = strongest >= 400 ? 350 : 200;
    const result = candidates.map((category) => {
      const items = category.items
        .filter(({ match }) => strongest < 200 || match.value >= concreteCutoff)
        .sort((left, right) => right.match.value - left.match.value || left.index - right.index)
        .slice(0, strongest < 200 ? 4 : undefined)
        .map(({ resource, match }) => Object.freeze({
          resource,
          score: match.value,
          matchedTerm: match.term,
          audience: audienceFor(resource),
          useCase: reviewedHint(resource)?.useCase || '',
        }));
      return items.length
        ? Object.freeze({ id: category.id, name: category.name, items: Object.freeze(items) }) : null;
    }).filter(Boolean);
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
