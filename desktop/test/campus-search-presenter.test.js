'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const presenter = require('../renderer/campus-search-presenter');

const categories = [{
  id: 'research', name: '科研、进度与计算', items: [{
    id: 'hpc-guide', name: 'HPC 与 AI 智算指南', description: 'HPC 文档与作业调度说明',
    keywords: ['HPC', '研究生', '博士'], route: 'direct',
  }, {
    id: 'hpc2-login', name: 'HPC2 登录节点', description: 'HPC2 登录、SSH 与交互式计算入口',
    keywords: ['HPC2', 'SSH', '研究生', '博士'], route: 'campus',
  }, {
    id: 'rpms', name: '科研项目管理系统 RPMS', description: '科研项目申报、管理与结题',
    keywords: ['科研', '项目管理'], route: 'campus',
  }],
}, {
  id: 'expenses', name: '经费、采购与报销', items: [{
    id: 'pbms', name: '项目资金管理系统 PBMS', description: '科研项目经费、预算与报销管理',
    keywords: ['PBMS', '报销', '研究生'], route: 'campus',
  }],
}];

test('exact site names outrank category and broad keyword matches', () => {
  const result = presenter.present(categories, 'HPC2');
  assert.deepEqual(result.flatMap(({ items }) => items.map(({ resource }) => resource.id)), ['hpc2-login']);
  assert.equal(result[0].items[0].audience, '研究生 / 博士');
});

test('natural-language search returns purpose-bearing results without unrelated categories', () => {
  const result = presenter.present(categories, '报销');
  assert.deepEqual(result.map(({ id }) => id), ['expenses']);
  assert.equal(result[0].items[0].resource.description, '科研项目经费、预算与报销管理');
});

test('highlighting escapes source text before adding bounded mark elements', () => {
  const markup = presenter.highlight('<HPC2 & login>', 'hpc2', (value) => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  assert.equal(markup, '&lt;<mark>HPC2</mark> &amp; login&gt;');
});
