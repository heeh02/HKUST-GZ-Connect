'use strict';

function localizeResource(resource, locale = 'zh') {
  if (!resource || typeof resource !== 'object' || !['zh', 'en'].includes(locale)) {
    throw new TypeError('localized resource input is invalid');
  }
  const name = resource.localizedName?.[locale];
  const description = resource.localizedDescription?.[locale];
  if (typeof name !== 'string' || !name || typeof description !== 'string') {
    throw new TypeError('localized resource text is unavailable');
  }
  return Object.freeze({ ...resource, name, description });
}

function localizeResources(resources, locale = 'zh') {
  if (!Array.isArray(resources) || resources.length > 64) {
    throw new TypeError('localized resource list is invalid');
  }
  return Object.freeze(resources.map((resource) => localizeResource(resource, locale)));
}

module.exports = { localizeResource, localizeResources };
