(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.managerView = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[character]));
  }

  function collectionFromResult(result, key) {
    if (Array.isArray(result)) return result;
    return Array.isArray(result?.[key]) ? result[key] : null;
  }

  function operationError(result, fallback) {
    const message = typeof result?.error === 'string' ? result.error.trim() : '';
    return message ? message.slice(0, 300) : fallback;
  }

  function formatManagerTime(value, translate, doc) {
    const numeric = value === null || value === undefined || value === ''
      ? Number.NaN
      : Number(value);
    const instant = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value || ''));
    if (!Number.isFinite(instant.getTime())) return translate('common.unknownTime');
    try {
      return new Intl.DateTimeFormat(doc.documentElement.lang || 'zh-CN', {
        dateStyle: 'medium', timeStyle: 'short',
      }).format(instant);
    } catch {
      return instant.toLocaleString();
    }
  }

  return {
    collectionFromResult,
    escapeHtml,
    formatManagerTime,
    operationError,
  };
});
