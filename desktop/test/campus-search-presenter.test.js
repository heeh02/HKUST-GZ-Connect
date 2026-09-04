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
  }, {
    id: 'e-tender', name: 'E-Tender 采购系统', description: '采购、招标与相关报销前置流程',
    keywords: ['采购', '招标', 'E-Tender', '报销'], route: 'campus',
  }, {
    id: 'e-form', name: 'E-Form 在线申请', description: '请假、课程、学籍、差旅与行政申请',
    keywords: ['E-Form', '差旅', '报销', '行政'], route: 'direct',
  }],
}, {
  id: 'documents', name: '申请、证明与毕业', items: [{
    id: 'academic-edoc', name: '教务电子文件申请', description: '在读证明、成绩单与教务证明申请',
    keywords: ['证明', '在读证明', '成绩单', 'E-Doc'], route: 'direct',
  }],
}, {
  id: 'tools', name: '协作、图书馆与 IT', items: [{
    id: 'library', name: '图书馆', description: '馆藏、数据库与学习资源',
    keywords: ['图书馆', '数据库', '馆藏'], route: 'direct',
  }, {
    id: 'microsoft-365', name: 'Microsoft 365', description: '学校授权的 Office',
    keywords: ['Word', 'Excel'], route: 'direct',
  }],
}];

test('exact site names outrank category and broad keyword matches', () => {
  const result = presenter.present(categories, 'HPC2');
  assert.deepEqual(result.flatMap(({ items }) => items.map(({ resource }) => resource.id)), ['hpc2-login']);
  assert.equal(result[0].items[0].audience, '研究生 / 博士');
});

test('natural-language search returns purpose-bearing results without unrelated categories', () => {
  const result = presenter.present(categories, '我想报销');
  assert.deepEqual(result.map(({ id }) => id), ['expenses']);
  assert.deepEqual(result[0].items.map(({ resource }) => resource.id), ['pbms', 'e-tender', 'e-form']);
  assert.deepEqual(result[0].items.map(({ audience }) => audience), [
    '科研项目负责人 / 项目成员', '教职工 / 项目采购', '学生 / 教职工',
  ]);
  assert.deepEqual(result[0].items.map(({ useCase }) => useCase), [
    '科研项目经费报销', '采购与招标前置流程', '差旅与行政申请',
  ]);
});

test('a concrete site match suppresses broad category-only fan-out', () => {
  const result = presenter.present(categories, '图书馆');
  assert.deepEqual(result.flatMap(({ items }) => items.map(({ resource }) => resource.id)), ['library']);
});

test('student phrasing finds the reviewed certificate application directly', () => {
  const result = presenter.present(categories, '我要申请在读证明');
  assert.deepEqual(result.flatMap(({ items }) => items.map(({ resource }) => resource.id)), ['academic-edoc']);
  assert.equal(result[0].items[0].useCase, '在读证明与成绩单申请');
  assert.equal(result[0].items[0].audience, '学生');
});

test('reviewed purpose hints follow the resource locale', () => {
  const result = presenter.present([{ id: 'expenses', name: 'Expenses', items: [{
    id: 'pbms', name: 'Project Budget Management', description: 'Research funding and expense management',
    keywords: ['expense'], route: 'campus',
  }] }], 'expense');
  assert.equal(result[0].items[0].audience, 'Project leads / members');
  assert.equal(result[0].items[0].useCase, 'Research expense claims');
});

test('highlighting escapes source text before adding bounded mark elements', () => {
  const markup = presenter.highlight('<HPC2 & login>', 'hpc2', (value) => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  assert.equal(markup, '&lt;<mark>HPC2</mark> &amp; login&gt;');
});
