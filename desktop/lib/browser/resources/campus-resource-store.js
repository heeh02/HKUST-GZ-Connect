'use strict';

const crypto = require('crypto');
const {
  normalizeCustomResources,
  normalizeResource,
  MAX_CUSTOM_RESOURCES,
} = require('../../resources/runtime/campus-resources');
const { sanitizeCustomResourceUrl } = require('../../resources/schema/campus-resource-contract');
const { normalizeCampusUrl } = require('../session/campus-browser');
const { isIsolatedNetworkHost } = require('../../routing/policy/host-safety');

function builtinIdentity(resources) {
  const builtins = (Array.isArray(resources) ? resources : [])
    .filter((resource) => resource?.builtin === true)
  return {
    ids: new Set(builtins.map((resource) => resource.id)),
    urls: new Set(builtins.map((resource) => resource.url)),
  };
}

function generatedId(url, existing) {
  const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 8);
  let id = `custom-${digest}`;
  let suffix = 2;
  while (existing.some((resource) => resource.id === id)) id = `custom-${digest}-${suffix++}`;
  return id;
}

function normalizedInput(payload, existing, builtins) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (!String(source.name || '').trim()) throw new Error('网站名称不能为空');
  const id = String(source.id || '').trim() || generatedId(String(source.url || '').trim(), existing);
  const previous = existing.find((resource) => resource.id === id) || null;
  if (builtins.ids.has(id)) throw new Error('内置网站不能被覆盖');
  if (!String(source.url || '').trim()) throw new Error('网站网址不能为空');
  let url;
  try {
    url = sanitizeCustomResourceUrl(normalizeCampusUrl(source.url), { rejectSensitive: true });
  } catch (error) {
    throw new Error(error.message);
  }
  if (source.route === 'direct' && isIsolatedNetworkHost(new URL(url).hostname)) {
    throw new Error('本机、私网和特殊地址不能设为直连');
  }
  const normalized = normalizeResource({
    ...source,
    id,
    url,
    ...(previous?.favoriteOnly === true ? { favoriteOnly: true } : {}),
  });
  if (!normalized) throw new Error('网站名称、描述或网址无效');
  const resource = normalizeCustomResources([normalized])[0];
  if (!resource) throw new Error('网站名称、描述或网址无效');
  if (builtins.urls.has(resource.url)) throw new Error('该网址已经是内置网站');
  return resource;
}

function upsertCustomResource(current, payload, { builtinResources = [] } = {}) {
  const resources = normalizeCustomResources(current);
  const resource = normalizedInput(payload, resources, builtinIdentity(builtinResources));
  const index = resources.findIndex((item) => item.id === resource.id);
  const duplicate = resources.find((item, itemIndex) =>
    item.url === resource.url && itemIndex !== index);
  if (duplicate) throw new Error('该网址已经存在');
  const next = index === -1
    ? [...resources, resource]
    : resources.map((item, itemIndex) => (itemIndex === index ? resource : item));
  if (next.length > MAX_CUSTOM_RESOURCES) {
    throw new Error(`自定义网站最多保存 ${MAX_CUSTOM_RESOURCES} 个`);
  }
  return { resource, resources: next };
}

function deleteCustomResource(current, id, { builtinResources = [] } = {}) {
  const key = String(id || '').trim();
  if (builtinIdentity(builtinResources).ids.has(key)) throw new Error('内置网站不能删除');
  const resources = normalizeCustomResources(current);
  if (!resources.some((resource) => resource.id === key)) throw new Error('自定义网站不存在');
  return resources.filter((resource) => resource.id !== key);
}

function hideBuiltinResource(current, id, { builtinResources = [] } = {}) {
  const key = String(id || '').trim();
  if (!builtinIdentity(builtinResources).ids.has(key)) throw new Error('内置网站不存在');
  const hidden = Array.isArray(current) ? [...current] : [];
  if (!hidden.includes(key)) hidden.push(key);
  return hidden;
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
  hideBuiltinResource,
  reorderCustomResources,
  upsertCustomResource,
};
