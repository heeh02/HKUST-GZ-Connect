'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  hkustPortalCatalogSource,
  normalizePortalCatalog,
} = require('../../../lib/browser/session/myportal-catalog');

const app = {
  appId: 101,
  appName: 'Canvas',
  name: 'Canvas Teaching Platform',
  appDetail: '课程、作业与测验',
  appType: '教学科研',
  appTypeId: '30',
  appUrl: 'https://canvas.example.edu/',
  entranceUrl: 'https://canvas.example.edu/',
  applyUserScope: '学生',
};
const service = {
  appId: 201,
  appName: 'Transcript',
  name: 'Official Transcript',
  appDetail: 'Official records',
  appType: '学术管理',
  appTypeId: '40',
  appUrl: 'https://records.example.edu/',
  entranceUrl: 'https://records.example.edu/',
  applyUserScope: 'Students',
};

function response(payload) {
  return {
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

test('reviewed myPortal catalog preserves current account order categories and URLs', async () => {
  const calls = [];
  const catalog = await hkustPortalCatalogSource.read({
    session: { fetch: async (url, options) => {
      calls.push({ url, options });
      const path = new URL(url).pathname;
      if (path.endsWith('getMyFavoriteAppsByCategory.jsp')) {
        return response({ result: '1', data: [
          { id: 0, name: '全部', list: [app] },
          { id: '30', name: '教学科研', list: [app] },
        ] });
      }
      if (path.endsWith('getPortalCenterTermByStrategy.jsp')) {
        return response({ result: '1', data: [{ id: 40, typeName: '学术管理' }] });
      }
      return response({ result: '1', data: { total: 1, appList: [service] } });
    } },
    portalUrl: 'https://myportal.hkust-gz.edu.cn/',
    checkedAt: 1_800_000_000_000,
    timeoutMs: 500,
  });
  assert.equal(catalog.state, 'ready');
  assert.deepEqual(catalog.applicationGroups, [
    { id: 'portal-app-group-30', name: '教学科研' },
  ]);
  assert.equal(catalog.applications[0].id, 'portal-app-101');
  assert.equal(catalog.applications[0].name, 'Canvas Teaching Platform');
  assert.equal(catalog.applications[0].url, 'https://canvas.example.edu/');
  assert.deepEqual(catalog.applications[0].groups, ['portal-app-group-30']);
  assert.deepEqual(catalog.serviceGroups, [
    { id: 'portal-service-group-40', name: '学术管理' },
  ]);
  assert.deepEqual(catalog.serviceItems[0].groups, ['portal-service-group-40']);
  assert.equal(calls.length, 3);
  assert.equal(calls.every(({ options }) => options.credentials === 'include' &&
    options.headers.Accept === '*/*'), true);
  const appsUrl = new URL(calls.find(({ url }) => url.includes('getMyFavoriteAppsByCategory')).url);
  assert.equal(appsUrl.searchParams.get('parentCategoryId'), '27');
  assert.equal(appsUrl.searchParams.get('clientType'), '2');
});

test('catalog normalization strips session material and rejects undeclared groups', () => {
  const base = {
    state: 'ready', source: 'myportal-catalog', fetchedAt: 1_800_000_000_000,
    applicationGroups: [{ id: 'portal-app-group-30', name: '教学科研' }],
    applications: [{
      id: 'portal-app-1', name: 'App', url: 'https://app.example.edu/', route: 'auto',
      groups: ['portal-app-group-30'], useCase: 'Course work', audience: 'Students', aliases: [],
    }],
    serviceGroups: [{ id: 'portal-service-group-40', name: '学术管理' }],
    serviceItems: [{
      id: 'portal-service-1', name: 'Service', url: 'https://service.example.edu/', route: 'auto',
      groups: ['portal-service-group-40'], useCase: 'Records', audience: 'Students', aliases: [],
    }],
  };
  assert.equal(normalizePortalCatalog(base).applications.length, 1);
  assert.equal(normalizePortalCatalog({
    ...base,
    applications: [{ ...base.applications[0], url: 'https://app.example.edu/?token=secret' }],
  }).applications[0].url, 'https://app.example.edu/');
  assert.throws(() => normalizePortalCatalog({
    ...base,
    serviceItems: [{ ...base.serviceItems[0], groups: ['portal-service-group-999'] }],
  }), /groups/u);
});
