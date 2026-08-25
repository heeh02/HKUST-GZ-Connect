'use strict';

const MAX_MANAGED_TEXT_BYTES = 1024 * 1024;
const BLOCK_ID = /^[a-z0-9][a-z0-9._-]{2,126}[a-z0-9]$/u;

function normalizedText(value, name) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_MANAGED_TEXT_BYTES ||
      value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function markers(commentPrefix, blockId) {
  if (!['#', '//'].includes(commentPrefix) || typeof blockId !== 'string' ||
      !BLOCK_ID.test(blockId)) {
    throw new TypeError('managed block identity is invalid');
  }
  return Object.freeze({
    start: `${commentPrefix} BEGIN CAMPUS-CONNECT MANAGED ${blockId}`,
    end: `${commentPrefix} END CAMPUS-CONNECT MANAGED ${blockId}`,
  });
}

function inspectManagedBlock(sourceValue, options = {}) {
  const source = normalizedText(sourceValue, 'managed text source');
  const marker = markers(options.commentPrefix, options.blockId);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    if (line === marker.start) starts.push(index);
    if (line === marker.end) ends.push(index);
  });
  if (starts.length !== ends.length || starts.length > 1 ||
      (starts.length === 1 && starts[0] >= ends[0])) {
    throw new Error('managed block markers conflict with existing content');
  }
  if (!starts.length) return Object.freeze({ present: false, newline, start: -1, end: -1 });
  return Object.freeze({
    present: true,
    newline,
    start: starts[0],
    end: ends[0],
    content: lines.slice(starts[0] + 1, ends[0]).join(newline),
  });
}

function normalizedBlockContent(value, marker, newline) {
  const content = normalizedText(value, 'managed block content').replace(/\r?\n/gu, newline);
  if (!content.trim() || content.split(newline).some((line) => (
    line === marker.start || line === marker.end ||
    /^\s*(?:#|\/\/)\s*(?:BEGIN|END) CAMPUS-CONNECT MANAGED/u.test(line)
  ))) {
    throw new TypeError('managed block content contains a marker or is empty');
  }
  let result = content;
  while (result.endsWith(newline)) result = result.slice(0, -newline.length);
  return result;
}

function upsertManagedBlock(sourceValue, contentValue, options = {}) {
  const source = normalizedText(sourceValue, 'managed text source');
  const marker = markers(options.commentPrefix, options.blockId);
  const observed = inspectManagedBlock(source, options);
  const content = normalizedBlockContent(contentValue, marker, observed.newline);
  const block = [marker.start, content, marker.end].join(observed.newline);
  const lines = source.split(/\r?\n/u);
  if (observed.present) {
    lines.splice(observed.start, observed.end - observed.start + 1, block);
    return lines.join(observed.newline);
  }
  const trimmed = source.replace(/[\r\n]+$/u, '');
  return trimmed ? `${trimmed}${observed.newline}${observed.newline}${block}${observed.newline}`
    : `${block}${observed.newline}`;
}

function removeManagedBlock(sourceValue, options = {}) {
  const source = normalizedText(sourceValue, 'managed text source');
  const observed = inspectManagedBlock(source, options);
  if (!observed.present) return source;
  const lines = source.split(/\r?\n/u);
  lines.splice(observed.start, observed.end - observed.start + 1);
  while (lines.length > 1 && !lines.at(-1) && !lines.at(-2)) lines.pop();
  return lines.join(observed.newline);
}

function managedBlockMatches(source, content, options = {}) {
  try {
    const observed = inspectManagedBlock(source, options);
    if (!observed.present) return false;
    const marker = markers(options.commentPrefix, options.blockId);
    return observed.content === normalizedBlockContent(content, marker, observed.newline);
  } catch { return false; }
}

module.exports = {
  MAX_MANAGED_TEXT_BYTES,
  inspectManagedBlock,
  managedBlockMatches,
  removeManagedBlock,
  upsertManagedBlock,
};
