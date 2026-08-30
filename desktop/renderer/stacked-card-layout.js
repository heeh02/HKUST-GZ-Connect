'use strict';

(function initializeStackedCardLayout(globalScope) {
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

  const api = Object.freeze({ balancedPartitions });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.stackedCardLayout = api;
})(typeof window !== 'undefined' ? window : null);
