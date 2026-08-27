'use strict';

const I18N = Object.freeze({
  zh: Object.freeze({
    title: '校园工作台', auto: '自动选择网络', rules: '网站规则', official: '学校官方门户',
    favorites: '我的收藏', recent: '最近打开', discover: '全部服务', results: '搜索结果', manage: '管理', done: '完成',
    createGroup: '＋ 新建分组', ungrouped: '未分组', unverified: '未审核', campus: '校园', direct: '直连',
    automatic: '自动', all: '全部', saved: '已收藏', gettingStarted: '入学与学籍',
    learning: '上课与考试', research: '科研与实验', finance: '缴费与报销', career: '实习与发展',
    campusLife: '校园生活', applications: '申请与离校', services: '通用工具', custom: '自定义',
    empty: '还没有收藏的网站',
    createTitle: '新建分组', renameTitle: '重命名分组', groupName: '分组名称', cancel: '取消', save: '保存',
    edit: '重命名', remove: '删除', invalidName: '请输入 1–30 个字符的分组名称',
    renameSite: '重命名网页', deleteSite: '删除网页', invalidSiteName: '请输入 1–40 个字符的网站名称',
    search: '搜索收藏、最近使用或校园服务', noMatch: '没有符合条件的校园服务',
    noMatchHint: '尝试清除搜索或选择其他分类。', clear: '清除筛选', favorite: '收藏', unfavorite: '取消收藏',
    confirmDelete: '确认删除',
    moveUp: '上移', moveDown: '下移',
  }),
  en: Object.freeze({
    title: 'Campus Workspace', auto: 'Automatic network selection', rules: 'Site Rules', official: 'Official Portal',
    favorites: 'Favorites', recent: 'Recently Opened', discover: 'All Services', results: 'Search Results', manage: 'Manage', done: 'Done',
    createGroup: '+ New Group', ungrouped: 'Ungrouped', unverified: 'Unreviewed', campus: 'Campus', direct: 'Direct',
    automatic: 'Auto', all: 'All', saved: 'Favorites', gettingStarted: 'Getting Started',
    learning: 'Classes & Exams', research: 'Research & Labs', finance: 'Fees & Expenses',
    career: 'Career & Internships', campusLife: 'Campus Life', applications: 'Requests & Leaving',
    services: 'General Tools', custom: 'Custom', empty: 'No favorite sites yet',
    createTitle: 'New Group', renameTitle: 'Rename Group', groupName: 'Group name', cancel: 'Cancel', save: 'Save',
    edit: 'Rename', remove: 'Delete', invalidName: 'Enter a group name between 1 and 30 characters',
    renameSite: 'Rename Site', deleteSite: 'Delete Site', invalidSiteName: 'Enter a site name between 1 and 40 characters',
    search: 'Search favorites, recent sites, or campus services', noMatch: 'No matching campus services',
    noMatchHint: 'Clear the search or choose another category.', clear: 'Clear filters', favorite: 'Favorite', unfavorite: 'Remove favorite',
    confirmDelete: 'Confirm delete',
    moveUp: 'Move up', moveDown: 'Move down',
  }),
});

const ICONS = Object.freeze({
  'getting-started': '<path d="m4 9 8-5 8 5M6 10v9h12v-9M9 19v-5h6v5"/>',
  learning: '<path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4zM20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
  research: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M8 15h8"/>',
  finance: '<path d="M5 4h14v16H5zM8 8h8M8 12h3M14 12h2M8 16h3M14 16h2"/>',
  career: '<path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16M10 12v2h4v-2"/>',
  'campus-life': '<path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13zM9 19.5v-6h6v6M3.5 20h17"/>',
  applications: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6M9 19h4"/>',
  services: '<path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/>',
  custom: '<path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.9M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
});
const CATEGORY_ALIASES = Object.freeze({
  common: 'services', academic: 'learning', 'campus-service': 'campus-life',
});
const TASK_CATEGORIES = Object.freeze([
  ['getting-started', 'gettingStarted'], ['learning', 'learning'], ['research', 'research'],
  ['finance', 'finance'], ['career', 'career'], ['campus-life', 'campusLife'],
  ['applications', 'applications'], ['services', 'services'], ['custom', 'custom'],
]);

let state = null;
let view = 'all';
let query = '';
let manageMode = false;
let editingGroupId = null;
let editingResourceId = null;
let draggedGroupId = null;
let draggedResourceId = null;

const $ = (id) => document.getElementById(id);
const text = () => I18N[state?.locale === 'en' ? 'en' : 'zh'];
const command = (name, payload = {}) => window.campusWorkspace?.command(name, payload) === true;

function taskCategory(resource) {
  return CATEGORY_ALIASES[resource.category] || resource.category;
}

function resourceIcon(resource) {
  const normalized = taskCategory(resource);
  const category = Object.hasOwn(ICONS, normalized) ? normalized : 'custom';
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

function resourceItem(resource, { groups = [] } = {}) {
  const item = document.createElement('div');
  item.className = 'resource-item';
  item.dataset.resourceId = resource.id;
  item.dataset.category = taskCategory(resource);
  item.dataset.favorite = String(resource.favorite);
  item.dataset.recent = String(Number.isSafeInteger(resource.lastOpenedAt));
  item.dataset.search = `${resource.name} ${resource.category} ${(resource.keywords || []).join(' ')}`.toLocaleLowerCase();
  item.draggable = true;
  item.addEventListener('dragstart', (event) => {
    draggedResourceId = resource.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', resource.id);
    item.classList.add('resource-dragging');
  });
  item.addEventListener('dragend', () => {
    draggedResourceId = null;
    item.classList.remove('resource-dragging');
    document.querySelectorAll('.favorite-group.drop-target').forEach((target) =>
      target.classList.remove('drop-target'));
  });

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'resource-open';
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
  const manageRow = document.createElement('div');
  manageRow.className = 'resource-manage-row';
  manageRow.appendChild(select);
  if (!resource.builtin) {
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'resource-manage-action resource-rename';
    rename.textContent = text().edit;
    rename.addEventListener('click', () => openResourceDialog(resource));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'resource-manage-action danger resource-delete';
    remove.textContent = text().remove;
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm !== '1') {
        remove.dataset.confirm = '1';
        remove.textContent = text().confirmDelete;
        return;
      }
      command('delete-resource', { resourceId: resource.id });
    });
    manageRow.append(rename, remove);
  }
  item.appendChild(manageRow);

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
      taskCategory(resource) === view;
    return matchesView && (!query || `${resource.name} ${resource.category} ${(resource.keywords || []).join(' ')}`.toLocaleLowerCase().includes(query));
  });
}

function renderFilters() {
  const filters = [
    ['all', text().all], ['favorites', text().saved], ['recent', text().recent],
    ['getting-started', text().gettingStarted], ['learning', text().learning],
    ['research', text().research], ['finance', text().finance], ['career', text().career],
    ['campus-life', text().campusLife], ['applications', text().applications],
    ['services', text().services], ['custom', text().custom],
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

function categoryLabel(category) {
  const key = TASK_CATEGORIES.find(([id]) => id === category)?.[1] || 'custom';
  return text()[key];
}

function renderServiceGroups(target, resources) {
  target.className = 'task-service-groups';
  const sections = [];
  for (const [category] of TASK_CATEGORIES) {
    const items = resources.filter((resource) => taskCategory(resource) === category);
    if (!items.length) continue;
    const section = document.createElement('section');
    section.className = 'task-service-group';
    const heading = document.createElement('div');
    heading.className = 'group-heading';
    const title = document.createElement('h3');
    title.textContent = categoryLabel(category);
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(items.length);
    heading.append(title, count);
    const grid = document.createElement('div');
    grid.className = 'resource-grid';
    renderGrid(grid, items, { groups: state.groups });
    section.append(heading, grid);
    sections.push(section);
  }
  target.replaceChildren(...sections);
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
  }
  section.addEventListener('dragover', (event) => {
    if (!draggedResourceId && !draggedGroupId) return;
    event.preventDefault();
    if (draggedResourceId) section.classList.add('drop-target');
  });
  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget)) section.classList.remove('drop-target');
  });
  section.addEventListener('drop', (event) => {
    event.preventDefault();
    section.classList.remove('drop-target');
    if (draggedResourceId) {
      command('move-resource', {
        resourceId: draggedResourceId, groupId: group?.id || null, index: resources.length,
      });
      draggedResourceId = null;
      return;
    }
    if (!group || !draggedGroupId || draggedGroupId === group.id) return;
    const ids = state.groups.map(({ id }) => id);
    const from = ids.indexOf(draggedGroupId);
    const to = ids.indexOf(group.id);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    command('reorder-groups', { groupIds: ids });
  });
  section.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'resource-grid';
  renderGrid(grid, resources, { groups: state.groups });
  if (!resources.length) {
    const empty = document.createElement('p');
    empty.className = 'favorite-group-empty';
    empty.textContent = text().empty;
    grid.appendChild(empty);
  }
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
  if (ungrouped.length || !groups.length || manageMode) groups.push(groupSection(null, ungrouped));
  $('favoriteGroups').classList.toggle('manage-mode', manageMode);
  document.body.classList.toggle('workspace-managing', manageMode);
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
  $('favoritesTitle').textContent = strings.favorites;
  $('recentTitle').textContent = strings.recent;
  $('servicesTitle').textContent = query ? strings.results
    : view === 'all' ? strings.discover : categoryLabel(view);
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
  const official = state.resources.find(({ id }) => id === state.officialPortalResourceId);
  $('officialLaunch').hidden = !official;
  $('officialLaunch').textContent = official?.name || strings.official;

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
  if (view === 'all' && !query) {
    renderServiceGroups($('servicesGrid'), service);
  } else {
    $('servicesGrid').className = 'resource-grid';
    renderGrid($('servicesGrid'), service, { groups: state.groups });
  }
  $('servicesModule').hidden = service.length === 0;
  $('favoritesModule').hidden = !visible.some(({ favorite, builtin }) => favorite || !builtin) &&
    state.groups.length === 0;
  $('workspaceEmpty').hidden = visible.length > 0;
}

function openGroupDialog(group = null) {
  editingGroupId = group?.id || null;
  editingResourceId = null;
  $('groupDialogTitle').textContent = group ? text().renameTitle : text().createTitle;
  $('groupName').value = group?.name || '';
  $('groupError').textContent = '';
  $('groupDialog').showModal();
  $('groupName').focus();
}

function openResourceDialog(resource) {
  if (!resource || resource.builtin) return;
  editingGroupId = null;
  editingResourceId = resource.id;
  $('groupDialogTitle').textContent = text().renameSite;
  $('groupName').value = resource.name;
  $('groupError').textContent = '';
  $('groupDialog').showModal();
  $('groupName').focus();
  $('groupName').select();
}

$('workspaceSearch').addEventListener('input', (event) => {
  query = event.target.value.trim().toLocaleLowerCase();
  render();
});
$('manageRules').addEventListener('click', () => command('manage-rules'));
$('officialLaunch').addEventListener('click', () => {
  if (state?.officialPortalResourceId) {
    command('open-resource', { resourceId: state.officialPortalResourceId });
  }
});
$('toggleManage').addEventListener('click', () => { manageMode = !manageMode; render(); });
$('createGroup').addEventListener('click', () => openGroupDialog());
$('clearWorkspaceFilter').addEventListener('click', () => {
  query = ''; view = 'all'; $('workspaceSearch').value = ''; render();
});
$('groupDialog').addEventListener('close', () => {
  editingGroupId = null;
  editingResourceId = null;
});
$('saveGroup').addEventListener('click', (event) => {
  event.preventDefault();
  const name = $('groupName').value.trim();
  const maxLength = editingResourceId ? 40 : 30;
  if (!name || name.length > maxLength) {
    $('groupError').textContent = editingResourceId ? text().invalidSiteName : text().invalidName;
    return;
  }
  if (editingResourceId) {
    command('rename-resource', { resourceId: editingResourceId, name });
  } else {
    command(editingGroupId ? 'rename-group' : 'create-group', editingGroupId
      ? { groupId: editingGroupId, name } : { name });
  }
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
