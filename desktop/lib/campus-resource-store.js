'use strict';

const crypto = require('crypto');
const {
  normalizeCustomResources,
  normalizeResource,
  MAX_RESOURCES,
} = require('./campus-resources');
const { normalizeCampusUrl } = require('./campus-browser');

const BUILTIN_IDS = new Set(['home', 'one-stop', 'library', 'new-student', 'outlook', 'canvas']);

function generatedId(url, existing) {
  const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
  let id = `custom-${digest}`;
  let suffix = 2;
  while (existing.some((resource) => resource.id === id)) id = `custom-${digest}-${suffix++}`;
  return id;
}

function normalizedInput(payload, existing) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (!String(source.name || '').trim()) throw new Error('网站名称不能为空');
  const id = String(source.id || '').trim() || generatedId(String(source.url || '').trim(), existing);
  if (BUILTIN_IDS.has(id)) throw new Error('内置网站不能被覆盖');
  let url;
  try {
    url = normalizeCampusUrl(source.url);
  } catch (error) {
    throw new Error(error.message);
  }
  const resource = normalizeResource({ ...source, id, url });
  if (!resource) throw new Error('网站名称、描述或网址无效');
  return resource;
}

function upsertCustomResource(current, payload) {
  const resources = normalizeCustomResources(current);
  const resource = normalizedInput(payload, resources);
  const index = resources.findIndex((item) => item.id === resource.id);
  const duplicate = resources.find((item, itemIndex) =>
    item.url === resource.url && itemIndex !== index);
  if (duplicate) throw new Error('该网址已经存在');
  const next = index === -1
    ? [...resources, resource]
    : resources.map((item, itemIndex) => (itemIndex === index ? resource : item));
  if (next.length > MAX_RESOURCES) throw new Error(`自定义网站最多保存 ${MAX_RESOURCES} 个`);
  return { resource, resources: next };
}

function deleteCustomResource(current, id) {
  const key = String(id || '').trim();
  if (BUILTIN_IDS.has(key)) throw new Error('内置网站不能删除');
  const resources = normalizeCustomResources(current);
  if (!resources.some((resource) => resource.id === key)) throw new Error('自定义网站不存在');
  return resources.filter((resource) => resource.id !== key);
}

function reorderCustomResources(current, ids) {
  const resources = normalizeCustomResources(current);
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const ordered = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const resource = byId.get(String(id));
    if (resource && !ordered.includes(resource)) ordered.push(resource);
  }
  for (const resource of resources) if (!ordered.includes(resource)) ordered.push(resource);
  return ordered;
}

module.exports = {
  deleteCustomResource,
  reorderCustomResources,
  upsertCustomResource,
};
