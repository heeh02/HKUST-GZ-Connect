'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeCampusUrl } = require('./campus-browser');

const RESOURCE_FILE = path.join(__dirname, '..', 'assets', 'campus-resources.json');
const MAX_RESOURCES = 32;

function normalizeResource(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const name = String(value.name || '').trim();
  const description = String(value.description || '').trim();
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !name || name.length > 40 || description.length > 80) {
    return null;
  }
  try {
    return {
      id,
      name,
      description,
      url: normalizeCampusUrl(value.url),
    };
  } catch {
    return null;
  }
}

function loadCampusResources(file = RESOURCE_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .slice(0, MAX_RESOURCES)
      .map(normalizeResource)
      .filter((resource) => {
        if (!resource || seen.has(resource.id)) return false;
        seen.add(resource.id);
        return true;
      });
  } catch {
    return [];
  }
}

module.exports = { MAX_RESOURCES, RESOURCE_FILE, loadCampusResources, normalizeResource };
