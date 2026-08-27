'use strict';

const I18N = Object.freeze({
  zh: Object.freeze({
    title: '校园工作台', auto: '自动选择网络', rules: '网站规则', official: '学校官方门户',
    favorites: '我的收藏', recent: '最近打开', services: '学校建议服务', manage: '管理', done: '完成',
    createGroup: '＋ 新建分组', ungrouped: '未分组', unverified: '未审核', campus: '校园', direct: '直连',
    automatic: '自动', all: '全部', saved: '已收藏', common: '常用', academic: '教务与学习',
    campusService: '校园服务', custom: '自定义', empty: '还没有收藏的网站',
    createTitle: '新建分组', renameTitle: '重命名分组', groupName: '分组名称', cancel: '取消', save: '保存',
    edit: '重命名', remove: '删除', invalidName: '请输入 1–30 个字符的分组名称',
    search: '搜索收藏、最近使用或校园服务', noMatch: '没有符合条件的校园服务',
    noMatchHint: '尝试清除搜索或选择其他分类。', clear: '清除筛选', favorite: '收藏', unfavorite: '取消收藏',
    confirmDelete: '确认删除',
    moveUp: '上移', moveDown: '下移',
  }),
  en: Object.freeze({
    title: 'Campus Workspace', auto: 'Automatic network selection', rules: 'Site Rules', official: 'Official Portal',
    favorites: 'Favorites', recent: 'Recently Opened', services: 'Recommended Services', manage: 'Manage', done: 'Done',
    createGroup: '+ New Group', ungrouped: 'Ungrouped', unverified: 'Unreviewed', campus: 'Campus', direct: 'Direct',
    automatic: 'Auto', all: 'All', saved: 'Favorites', common: 'Common', academic: 'Academic',
    campusService: 'Campus Services', custom: 'Custom', empty: 'No favorite sites yet',
    createTitle: 'New Group', renameTitle: 'Rename Group', groupName: 'Group name', cancel: 'Cancel', save: 'Save',
    edit: 'Rename', remove: 'Delete', invalidName: 'Enter a group name between 1 and 30 characters',
    search: 'Search favorites, recent sites, or campus services', noMatch: 'No matching campus services',
    noMatchHint: 'Clear the search or choose another category.', clear: 'Clear filters', favorite: 'Favorite', unfavorite: 'Remove favorite',
    confirmDelete: 'Confirm delete',
    moveUp: 'Move up', moveDown: 'Move down',
  }),
});

const ICONS = Object.freeze({
  common: '<path d="M7 4.5h10M8 3h8v3H8zM6 5.5h12v15H6zM9 10h6M9 14h6M9 18h4"/>',
  academic: '<path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4zM20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
  'campus-service': '<path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13zM9 19.5v-6h6v6M3.5 20h17"/>',
  custom: '<path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.9M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
});

let state = null;
let view = 'all';
let query = '';
let manageMode = false;
let editingGroupId = null;
let draggedGroupId = null;

const $ = (id) => document.getElementById(id);
const text = () => I18N[state?.locale === 'en' ? 'en' : 'zh'];
const command = (name, payload = {}) => window.campusWorkspace?.command(name, payload) === true;

function resourceIcon(resource) {
  const category = Object.hasOwn(ICONS, resource.category) ? resource.category : 'custom';
  const span = document.createElement('span');
  span.className = `resource-icon${category === 'custom' ? ' custom' : ''}`;
  span.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICONS[category];
  span.appendChild(svg);
  return span;
}

function routeText(resource) {
  return `${text().automatic} · ${resource.route === 'direct' ? text().direct : text().campus}`;
}

function resourceItem(resource, { official = false, groups = [] } = {}) {
  const item = document.createElement('div');
  item.className = official ? 'resource-item official-resource' : 'resource-item';
  item.dataset.resourceId = resource.id;
  item.dataset.category = resource.category;
  item.dataset.favorite = String(resource.favorite);
  item.dataset.recent = String(Number.isSafeInteger(resource.lastOpenedAt));
  item.dataset.search = `${resource.name} ${resource.category} ${(resource.keywords || []).join(' ')}`.toLocaleLowerCase();

  const open = document.createElement('button');
  open.type = 'button';
  open.className = official ? 'resource-open official-resource-open' : 'resource-open';
  open.appendChild(resourceIcon(resource));
  const copy = document.createElement('span');
  copy.className = 'resource-copy';
  const name = document.createElement('span');
  name.className = 'resource-name';
  name.textContent = resource.name;
  const route = document.createElement('span');
  route.className = `resource-route${resource.route === 'direct' ? ' direct' : ''}`;
  route.textContent = routeText(resource);
  copy.append(name, route);
  open.appendChild(copy);
  open.addEventListener('click', () => command('open-resource', { resourceId: resource.id }));
  item.appendChild(open);

  if (official) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `resource-star${resource.favorite ? ' active' : ''}`;
    star.textContent = resource.favorite ? '★' : '☆';
    star.setAttribute('aria-label', resource.favorite ? text().unfavorite : text().favorite);
    star.addEventListener('click', () => command('toggle-favorite', { resourceId: resource.id }));
    item.appendChild(star);
    return item;
  }

  const select = document.createElement('select');
  select.className = 'resource-group-select';
  const ungrouped = document.createElement('option');
  ungrouped.value = '';
  ungrouped.textContent = text().ungrouped;
  select.appendChild(ungrouped);
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    option.selected = group.resourceIds.includes(resource.id);
    select.appendChild(option);
  }
  select.addEventListener('change', () => command('move-resource', {
    resourceId: resource.id,
    groupId: select.value || null,
    index: 64,
  }));
  item.appendChild(select);

  const star = document.createElement('button');
  star.type = 'button';
  star.className = `resource-star${resource.favorite ? ' active' : ''}`;
  star.textContent = resource.favorite ? '★' : '☆';
  star.setAttribute('aria-label', resource.favorite ? text().unfavorite : text().favorite);
  star.addEventListener('click', () => command('toggle-favorite', { resourceId: resource.id }));
  item.appendChild(star);
  return item;
}

function filtered(resources) {
  return resources.filter((resource) => {
    const matchesView = view === 'all' || view === 'favorites' && resource.favorite ||
      view === 'recent' && Number.isSafeInteger(resource.lastOpenedAt) ||
      resource.category === view;
    return matchesView && (!query || `${resource.name} ${resource.category} ${(resource.keywords || []).join(' ')}`.toLocaleLowerCase().includes(query));
  });
}

function renderFilters() {
  const filters = [
    ['all', text().all], ['favorites', text().saved], ['recent', text().recent],
    ['common', text().common], ['academic', text().academic],
    ['campus-service', text().campusService], ['custom', text().custom],
  ];
  const target = $('workspaceFilters');
  target.replaceChildren(...filters.map(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-button${view === id ? ' active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(view === id));
    button.addEventListener('click', () => { view = id; render(); });
    return button;
  }));
}

function renderGrid(target, resources, options = {}) {
  target.replaceChildren(...resources.map((resource) => resourceItem(resource, options)));
}

function groupSection(group, resources) {
  const section = document.createElement('section');
  section.className = 'favorite-group';
  section.dataset.groupId = group?.id || '';
  section.draggable = manageMode && !!group;
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  const title = document.createElement('h3');
  title.textContent = group?.name || text().ungrouped;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = String(resources.length);
  heading.append(title, count);
  if (group) {
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    const move = (offset) => {
      const ids = state.groups.map(({ id }) => id);
      const from = ids.indexOf(group.id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      command('reorder-groups', { groupIds: ids });
    };
    for (const [label, offset] of [[text().moveUp, -1], [text().moveDown, 1]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'group-action'; button.textContent = label;
      button.addEventListener('click', () => move(offset)); actions.appendChild(button);
    }
    for (const [label, action] of [[text().edit, 'rename'], [text().remove, 'delete']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'group-action';
      button.textContent = label;
      button.addEventListener('click', () => {
        if (action === 'rename') { openGroupDialog(group); return; }
        if (button.dataset.confirm !== '1') {
          button.dataset.confirm = '1';
          button.textContent = text().confirmDelete;
          return;
        }
        command('delete-group', { groupId: group.id });
      });
      actions.appendChild(button);
    }
    heading.appendChild(actions);
    section.addEventListener('dragstart', () => { draggedGroupId = group.id; section.classList.add('dragging'); });
    section.addEventListener('dragend', () => { draggedGroupId = null; section.classList.remove('dragging'); });
    section.addEventListener('dragover', (event) => event.preventDefault());
    section.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!draggedGroupId || draggedGroupId === group.id) return;
      const ids = state.groups.map(({ id }) => id);
      const from = ids.indexOf(draggedGroupId);
      const to = ids.indexOf(group.id);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      command('reorder-groups', { groupIds: ids });
    });
  }
  section.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'resource-grid';
  renderGrid(grid, resources, { groups: state.groups });
  section.appendChild(grid);
  return section;
}

function renderFavorites(resources) {
  const favorites = resources.filter(({ favorite }) => favorite);
  const byId = new Map(favorites.map((resource) => [resource.id, resource]));
  const assigned = new Set();
  const groups = [];
  for (const group of state.groups) {
    const items = group.resourceIds.map((id) => byId.get(id)).filter(Boolean);
    for (const item of items) assigned.add(item.id);
    groups.push(groupSection(group, items));
  }
  const ungrouped = favorites.filter(({ id }) => !assigned.has(id));
  if (ungrouped.length || !groups.length) groups.push(groupSection(null, ungrouped));
  $('favoriteGroups').classList.toggle('manage-mode', manageMode);
  $('favoriteGroups').replaceChildren(...groups);
}

function render() {
  if (!state) return;
  const strings = text();
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
  document.title = `${strings.title} · ${state.schoolName}`;
  $('workspaceSchool').textContent = state.schoolName;
  $('workspaceReady').textContent = strings.auto;
  $('workspaceTrust').hidden = !state.unverified;
  $('workspaceTrust').textContent = strings.unverified;
  $('manageRules').textContent = strings.rules;
  $('officialTitle').textContent = strings.official;
  $('favoritesTitle').textContent = strings.favorites;
  $('recentTitle').textContent = strings.recent;
  $('servicesTitle').textContent = strings.services;
  $('workspaceSearch').placeholder = strings.search;
  $('emptyTitle').textContent = strings.noMatch;
  $('emptyHint').textContent = strings.noMatchHint;
  $('clearWorkspaceFilter').textContent = strings.clear;
  $('groupNameLabel').textContent = strings.groupName;
  $('cancelGroup').textContent = strings.cancel;
  $('saveGroup').textContent = strings.save;
  $('toggleManage').textContent = manageMode ? strings.done : strings.manage;
  $('createGroup').textContent = strings.createGroup;
  renderFilters();

  const visible = filtered(state.resources);
  const official = visible.find(({ id }) => id === state.officialPortalResourceId);
  $('officialModule').hidden = !official;
  $('officialContent').replaceChildren(...(official ? [resourceItem(official, { official: true })] : []));

  renderFavorites(visible);
  const recent = visible.filter(({ lastOpenedAt, favorite }) => !favorite && Number.isSafeInteger(lastOpenedAt))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .filter(({ id }) => id !== state.officialPortalResourceId)
    .slice(0, 12);
  renderGrid($('recentGrid'), recent, { groups: state.groups });
  $('recentModule').hidden = recent.length === 0;

  const favoriteIds = new Set(visible.filter(({ favorite }) => favorite).map(({ id }) => id));
  const recentIds = new Set(recent.map(({ id }) => id));
  const service = visible.filter(({ id }) => id !== state.officialPortalResourceId &&
    !favoriteIds.has(id) && !recentIds.has(id))
    .slice(0, 24);
  renderGrid($('servicesGrid'), service, { groups: state.groups });
  $('servicesModule').hidden = service.length === 0;
  $('favoritesModule').hidden = !visible.some(({ favorite }) => favorite);
  $('workspaceEmpty').hidden = !!official || visible.length > 0;
}

function openGroupDialog(group = null) {
  editingGroupId = group?.id || null;
  $('groupDialogTitle').textContent = group ? text().renameTitle : text().createTitle;
  $('groupName').value = group?.name || '';
  $('groupError').textContent = '';
  $('groupDialog').showModal();
  $('groupName').focus();
}

$('workspaceSearch').addEventListener('input', (event) => {
  query = event.target.value.trim().toLocaleLowerCase();
  render();
});
$('manageRules').addEventListener('click', () => command('manage-rules'));
$('toggleManage').addEventListener('click', () => { manageMode = !manageMode; render(); });
$('createGroup').addEventListener('click', () => openGroupDialog());
$('clearWorkspaceFilter').addEventListener('click', () => {
  query = ''; view = 'all'; $('workspaceSearch').value = ''; render();
});
$('groupDialog').addEventListener('close', () => { editingGroupId = null; });
$('saveGroup').addEventListener('click', (event) => {
  event.preventDefault();
  const name = $('groupName').value.trim();
  if (!name || name.length > 30) { $('groupError').textContent = text().invalidName; return; }
  command(editingGroupId ? 'rename-group' : 'create-group', editingGroupId
    ? { groupId: editingGroupId, name } : { name });
  $('groupDialog').close();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); $('workspaceSearch').focus(); $('workspaceSearch').select();
  }
});

window.campusWorkspace?.onState((next) => { state = next; render(); });
window.campusWorkspace?.onFocus((target) => {
  if (target === 'search') { $('workspaceSearch').focus(); $('workspaceSearch').select(); }
});
command('ready');
