'use strict';

function exactExecutablePattern(executablePath) {
  if (typeof executablePath !== 'string' || !executablePath.length) return '';
  const escaped = executablePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}( |$)`;
}

module.exports = { exactExecutablePattern };
