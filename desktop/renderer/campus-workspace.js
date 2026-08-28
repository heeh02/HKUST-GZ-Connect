'use strict';

const I18N = Object.freeze({
  zh: Object.freeze({
    title: '校园工作台', auto: '自动选择网络', rules: '网站规则', unverified: '未审核',
    home: '校园服务', manage: '整理收藏', search: '搜索校园服务', clear: '清除',
    favorites: '我的收藏', recent: '最近使用', starter: '常用入口', catalogTitle: '全部服务',
    manageTitle: '整理收藏', resourcePool: '收藏', groups: '书签文件夹', createGroup: '＋ 新建分组',
    allSites: '网站库', allFavorites: '全部收藏',
    myGroups: '我的分组', systemViews: '系统视图', categories: '按类别', chooseCategory: '选择类别',
    searchResults: '搜索结果', ungrouped: '未分组', emptyFavorites: '还没有收藏的网站',
    noMatch: '没有符合条件的校园服务', noMatchHint: '尝试其他关键词。', clearSearch: '清除搜索',
    createTitle: '新建分组', renameTitle: '重命名分组', renameSite: '重命名网页', groupName: '名称',
    cancel: '取消', save: '保存', edit: '重命名', remove: '删除', confirmDelete: '确认删除',
    confirmDeleteGroup: '删除分组（网站保留）',
    moveUp: '上移', moveDown: '下移', favorite: '收藏', unfavorite: '取消收藏',
    invalidGroupName: '请输入 1–30 个字符的分组名称', invalidSiteName: '请输入 1–40 个字符的网站名称',
    selectPage: '选择本页', selectedCount: '已选择 {count} 项', chooseGroup: '选择分组',
    addToGroup: '加入分组', clearSelection: '取消选择', memberships: '所在分组',
    campus: '校园', direct: '直连', automatic: '自动',
    newcomer: '新生入学', courses: '课程与考试', research: '科研与计算', labs: '实验与仪器',
    studentFinance: '财务缴费', expenses: '报销与采购', career: '实习与就业', campusLife: '校园生活',
    documents: '证明、毕业与离校', tools: '通用工具', staff: '教职工工具', custom: '自定义',
  }),
  en: Object.freeze({
    title: 'Campus Workspace', auto: 'Automatic network', rules: 'Site Rules', unverified: 'Unreviewed',
    home: 'Campus Services', manage: 'Organize Favorites', search: 'Search campus services', clear: 'Clear',
    favorites: 'Favorites', recent: 'Recently Used', starter: 'Common Services', catalogTitle: 'All Services',
    manageTitle: 'Organize Favorites', resourcePool: 'Favorites', groups: 'Bookmark Folders', createGroup: '+ New Group',
    allSites: 'Site Library', allFavorites: 'All Favorites',
    myGroups: 'My Groups', systemViews: 'System Views', categories: 'Category', chooseCategory: 'Choose Category',
    searchResults: 'Search Results', ungrouped: 'Ungrouped', emptyFavorites: 'No favorite sites yet',
    noMatch: 'No matching campus services', noMatchHint: 'Try another search term.', clearSearch: 'Clear Search',
    createTitle: 'New Group', renameTitle: 'Rename Group', renameSite: 'Rename Site', groupName: 'Name',
    cancel: 'Cancel', save: 'Save', edit: 'Rename', remove: 'Delete', confirmDelete: 'Confirm delete',
    confirmDeleteGroup: 'Delete Group (keep sites)',
    moveUp: 'Move up', moveDown: 'Move down', favorite: 'Favorite', unfavorite: 'Remove favorite',
    invalidGroupName: 'Enter a group name between 1 and 30 characters', invalidSiteName: 'Enter a site name between 1 and 40 characters',
    selectPage: 'Select Page', selectedCount: '{count} selected', chooseGroup: 'Choose Group',
    addToGroup: 'Add to Group', clearSelection: 'Clear Selection', memberships: 'Groups',
    campus: 'Campus', direct: 'Direct', automatic: 'Auto',
    newcomer: 'New Student', courses: 'Courses & Exams', research: 'Research & Computing', labs: 'Labs & Instruments',
    studentFinance: 'Student Finance', expenses: 'Expenses & Procurement', career: 'Career & Internships', campusLife: 'Campus Life',
    documents: 'Documents & Graduation', tools: 'General Tools', staff: 'Staff Tools', custom: 'Custom',
  }),
});

const ICONS = Object.freeze({
  newcomer: '<path d="m4 9 8-5 8 5M6 10v9h12v-9M9 19v-5h6v5"/>',
  courses: '<path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2.5 2.5 0 0 0-2.5-2.5H4zM20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2.5 2.5 0 0 1 2.5-2.5H20z"/>',
  research: '<path d="M4 18h16M7 18v-5l5-3 5 3v5M9 8a3 3 0 1 1 6 0M12 5V3"/>',
  labs: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M8 15h8"/>',
  'student-finance': '<path d="M4 6h16v12H4zM7 10h10M7 14h5M16 14h1"/>',
  expenses: '<path d="M5 4h14v16H5zM8 8h8M8 12h3M14 12h2M8 16h3M14 16h2"/>',
  career: '<path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16M10 12v2h4v-2"/>',
  'campus-life': '<path d="m4 9 8-5 8 5M5.5 9.5h13v10h-13zM9 19.5v-6h6v6M3.5 20h17"/>',
  documents: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6M9 19h4"/>',
  tools: '<path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/>',
  staff: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 21a7 7 0 0 1 14 0M17 9h4M19 7v4"/>',
  custom: '<path d="M10 13.5a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7L11 6.9M14 10.5a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
});

const model = window.campusWorkspaceModel;
let state = null;
let navigation = model.normalizeNavigation({ screen: 'home' });
let editingGroupId = null;
let editingResourceId = null;
let draggedGroupId = null;
let draggedResourceId = null;
let selectedManageFolder = 'favorites';
let selectedServiceView = null;
let servicePage = 0;
let searchPage = 0;
let managePage = 0;
let currentManagePageIds = [];
const selectedResourceIds = new Set();

const $ = (id) => document.getElementById(id);
const text = () => I18N[state?.locale === 'en' ? 'en' : 'zh'];
const command = (name, payload = {}) => window.campusWorkspace?.command(name, payload) === true;
const categoryLabel = (category) => text()[model.TASK_CATEGORIES.find(({ id }) => id === category)?.labelKey || 'custom'];

function routeText(resource) {
  return `${text().automatic} · ${resource.route === 'direct' ? text().direct : text().campus}`;
}

function resourceIcon(resource) {
  const category = model.categoryOf(resource);
  const span = document.createElement('span');
  span.className = `resource-icon${category === 'custom' ? ' custom' : ''}`;
  span.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = ICONS[category] || ICONS.custom;
  span.appendChild(svg);
  return span;
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

function resourceItem(resource, { management = false } = {}) {
  const item = document.createElement('div');
  item.className = 'resource-item';
  item.dataset.resourceId = resource.id;
  item.draggable = management;
  if (management) {
    const selection = document.createElement('label');
    selection.className = 'resource-selection';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = selectedResourceIds.has(resource.id);
    checkbox.setAttribute('aria-label', `${text().favorite}: ${resource.name}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedResourceIds.add(resource.id);
      else selectedResourceIds.delete(resource.id);
      renderBulkActions();
    });
    selection.appendChild(checkbox); item.appendChild(selection);
    item.addEventListener('dragstart', (event) => {
      draggedResourceId = resource.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', resource.id);
      item.classList.add('resource-dragging');
    });
    item.addEventListener('dragend', () => {
      draggedResourceId = null;
      item.classList.remove('resource-dragging');
      document.querySelectorAll('.favorite-group.drop-target').forEach((target) => target.classList.remove('drop-target'));
    });
  }

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

  if (management) {
    const manageRow = document.createElement('div');
    manageRow.className = 'resource-manage-row';
    const membership = document.createElement('span'); membership.className = 'resource-memberships';
    const names = state.groups.filter(({ resourceIds }) => resourceIds.includes(resource.id))
      .map(({ name: groupName }) => groupName);
    membership.textContent = `${text().memberships}: ${names.join(' · ') || text().ungrouped}`;
    manageRow.appendChild(membership);
    if (!resource.builtin) {
      for (const [label, className, action] of [
        [text().edit, 'resource-rename', () => openResourceDialog(resource)],
        [text().remove, 'resource-delete danger', (button) => {
          if (button.dataset.confirm !== '1') {
            button.dataset.confirm = '1';
            button.textContent = text().confirmDelete;
            return;
          }
          command('delete-resource', { resourceId: resource.id });
        }],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `resource-manage-action ${className}`;
        button.textContent = label;
        button.addEventListener('click', () => action(button));
        manageRow.appendChild(button);
      }
    }
    item.appendChild(manageRow);
  }

  const star = document.createElement('button');
  star.type = 'button';
  star.className = `resource-star${resource.favorite ? ' active' : ''}`;
  star.textContent = resource.favorite ? '★' : '☆';
  star.setAttribute('aria-label', resource.favorite ? text().unfavorite : text().favorite);
  star.addEventListener('click', () => command('toggle-favorite', { resourceId: resource.id }));
  item.appendChild(star);
  return item;
}

function renderGrid(target, resources, options = {}) {
  target.replaceChildren(...resources.map((resource) => resourceItem(resource, options)));
}

function pageCapacity(target) {
  if (!target) return 4;
  const style = getComputedStyle(target);
  const columns = Math.max(1, style.gridTemplateColumns
    .split(' ').filter(Boolean).length);
  const rowHeight = Number.parseFloat(style.getPropertyValue('--resource-row-height')) || 60;
  const rows = Math.max(1, Math.floor(target.clientHeight / rowHeight));
  return Math.max(columns, Math.min(64, columns * rows));
}

function paged(items, page, target) {
  const size = pageCapacity(target);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { current, pages, items: items.slice(current * size, (current + 1) * size) };
}

function renderPager(target, pages, current, selectPage) {
  target.hidden = pages <= 1;
  target.replaceChildren(...Array.from({ length: pages }, (_, index) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `pager-dot${index === current ? ' active' : ''}`;
    button.textContent = '•'; button.title = `${index + 1} / ${pages}`;
    button.setAttribute('aria-label', `${index + 1} / ${pages}`);
    button.setAttribute('aria-current', index === current ? 'page' : 'false');
    button.addEventListener('click', () => selectPage(index));
    return button;
  }));
}

function groupSection(group, resources, { management = false } = {}) {
  const section = document.createElement('section');
  section.className = 'favorite-group';
  section.dataset.groupId = group?.id || '';
  section.draggable = management && !!group;
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  const title = document.createElement('h3');
  title.textContent = group?.name || text().ungrouped;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = String(resources.length);
  heading.append(title, count);
  if (management && group) {
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
    for (const [label, action] of [
      [text().moveUp, () => move(-1)], [text().moveDown, () => move(1)],
      [text().edit, () => openGroupDialog(group)],
    ]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'group-action'; button.textContent = label;
      button.addEventListener('click', action); actions.appendChild(button);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'group-action'; remove.textContent = text().remove;
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm !== '1') {
        remove.dataset.confirm = '1'; remove.textContent = text().confirmDeleteGroup; return;
      }
      command('delete-group', { groupId: group.id });
    });
    actions.appendChild(remove);
    heading.appendChild(actions);
    section.addEventListener('dragstart', () => { draggedGroupId = group.id; section.classList.add('dragging'); });
    section.addEventListener('dragend', () => { draggedGroupId = null; section.classList.remove('dragging'); });
  }
  if (management) {
    section.addEventListener('dragover', (event) => {
      if (!draggedResourceId && !draggedGroupId) return;
      event.preventDefault();
      if (draggedResourceId) section.classList.add('drop-target');
    });
    section.addEventListener('dragleave', (event) => {
      if (!section.contains(event.relatedTarget)) section.classList.remove('drop-target');
    });
    section.addEventListener('drop', (event) => {
      event.preventDefault(); section.classList.remove('drop-target');
      if (draggedResourceId) {
        command('move-resource', {
          resourceId: draggedResourceId, groupId: group?.id || null, index: resources.length,
        });
        draggedResourceId = null; return;
      }
      if (!group || !draggedGroupId || draggedGroupId === group.id) return;
      const ids = state.groups.map(({ id }) => id);
      const from = ids.indexOf(draggedGroupId); const to = ids.indexOf(group.id);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      command('reorder-groups', { groupIds: ids });
    });
  }
  section.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'resource-grid';
  renderGrid(grid, resources, { management });
  if (!resources.length) {
    const empty = document.createElement('p');
    empty.className = 'favorite-group-empty'; empty.textContent = text().emptyFavorites;
    grid.appendChild(empty);
  }
  section.appendChild(grid);
  return section;
}

function groupedFavorites(resources, { management = false } = {}) {
  const favorites = resources.filter(({ favorite }) => favorite);
  const byId = new Map(favorites.map((resource) => [resource.id, resource]));
  const assigned = new Set();
  const sections = [];
  for (const group of state.groups) {
    const items = group.resourceIds.map((id) => byId.get(id)).filter(Boolean);
    for (const item of items) assigned.add(item.id);
    if (items.length || management) sections.push(groupSection(group, items, { management }));
  }
  const ungrouped = favorites.filter(({ id }) => !assigned.has(id));
  if (ungrouped.length || management || !sections.length) {
    sections.push(groupSection(null, ungrouped, { management }));
  }
  return { favorites, sections };
}

function renderGateways(resources) {
  const gateways = resources.filter(({ category }) => category === 'gateway');
  $('gatewayLinks').replaceChildren(...gateways.map((resource) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'soft-button gateway-button';
    button.textContent = resource.name;
    button.addEventListener('click', () => command('open-resource', { resourceId: resource.id }));
    return button;
  }));
}

function renderHome() {
  const resources = state.resources.filter(({ category }) => category !== 'gateway');
  const favorites = resources.filter(({ favorite }) => favorite);
  const recent = [...resources].filter(({ lastOpenedAt }) => Number.isSafeInteger(lastOpenedAt))
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const categories = model.catalogProjection(state.resources).categories;
  const groupViews = state.groups.map((group) => ({
      id: group.id, name: group.name,
      items: group.resourceIds.map((id) => byId.get(id)).filter(Boolean),
    })).filter(({ items }) => items.length);
  const systemViews = [
    { id: 'favorites', name: text().allFavorites, items: favorites },
    { id: 'recent', name: text().recent, items: recent },
    { id: 'all', name: text().allSites, items: resources },
  ].filter(({ id, items }) => ['favorites', 'all'].includes(id) || items.length);
  const categoryViews = categories.map(({ id }) => ({
    id: `category:${id}`, name: categoryLabel(id),
    items: model.catalogProjection(state.resources, id).items,
  }));
  const views = [...groupViews, ...systemViews, ...categoryViews];
  let selected = views.find(({ id }) => id === selectedServiceView);
  if (!selected) {
    selected = groupViews[0] || views.find(({ id }) => id === 'favorites' && favorites.length) ||
      views.find(({ id }) => id === 'all');
    selectedServiceView = selected.id; servicePage = 0;
  }
  const tab = (view) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `service-view-tab${view.id === selected.id ? ' active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(view.id === selected.id));
    button.textContent = `${view.name} ${view.items.length}`;
    button.addEventListener('click', () => {
      selectedServiceView = view.id; servicePage = 0; renderHome();
    });
    return button;
  };
  const label = (value) => {
    const span = document.createElement('span'); span.className = 'service-view-label';
    span.textContent = value; return span;
  };
  const tabs = [];
  if (groupViews.length) tabs.push(label(text().myGroups), ...groupViews.map(tab));
  tabs.push(label(text().systemViews), ...systemViews.map(tab));
  $('serviceViewTabs').replaceChildren(...tabs);
  $('serviceCategoryLabel').textContent = text().categories;
  const categorySelect = $('serviceCategorySelect');
  const emptyOption = document.createElement('option'); emptyOption.value = '';
  emptyOption.textContent = text().chooseCategory;
  categorySelect.replaceChildren(emptyOption, ...categoryViews.map((view) => {
    const option = document.createElement('option'); option.value = view.id;
    option.textContent = `${view.name} ${view.items.length}`; return option;
  }));
  categorySelect.value = selected.id.startsWith('category:') ? selected.id : '';
  $('serviceViewTitle').textContent = selected.name;
  const page = paged(selected.items, servicePage, $('serviceViewGrid')); servicePage = page.current;
  renderGrid($('serviceViewGrid'), page.items);
  renderPager($('servicePager'), page.pages, page.current, (index) => {
    servicePage = index; renderHome();
  });
}

function renderManage() {
  const resources = state.resources.filter(({ category }) => category !== 'gateway');
  const favorites = resources.filter(({ favorite }) => favorite);
  const byId = new Map(favorites.map((resource) => [resource.id, resource]));
  const assigned = new Set(state.groups.flatMap(({ resourceIds }) => resourceIds));
  if (!['all', 'favorites', 'ungrouped'].includes(selectedManageFolder) &&
      !state.groups.some(({ id }) => id === selectedManageFolder)) {
    selectedManageFolder = 'favorites';
  }
  let pool;
  let title;
  if (selectedManageFolder === 'all') { pool = resources; title = text().allSites; }
  else if (selectedManageFolder === 'ungrouped') {
    pool = favorites.filter(({ id }) => !assigned.has(id)); title = text().ungrouped;
  } else if (selectedManageFolder === 'favorites') {
    pool = favorites; title = text().allFavorites;
  } else {
    const group = state.groups.find(({ id }) => id === selectedManageFolder);
    pool = group.resourceIds.map((id) => byId.get(id)).filter(Boolean); title = group.name;
  }
  if (navigation.query) pool = model.searchResources(pool, navigation.query);
  const validIds = new Set(resources.map(({ id }) => id));
  for (const id of selectedResourceIds) if (!validIds.has(id)) selectedResourceIds.delete(id);
  $('resourcePoolTitle').textContent = title;
  const page = paged(pool, managePage, $('resourcePool')); managePage = page.current;
  currentManagePageIds = page.items.map(({ id }) => id);
  renderGrid($('resourcePool'), page.items, { management: true });
  renderBulkActions();
  $('resourcePoolCount').textContent = String(pool.length);
  renderPager($('managePager'), page.pages, page.current, (index) => {
    managePage = index; renderManage();
  });
  const folderEntry = ({ id, name, count, group = null, dropGroupId = undefined }) => {
    const row = document.createElement('div');
    row.className = `manage-folder${selectedManageFolder === id ? ' active' : ''}`;
    row.dataset.folderId = id;
    const select = document.createElement('button'); select.type = 'button'; select.className = 'manage-folder-select';
    const label = document.createElement('span'); label.textContent = name;
    const badge = document.createElement('span'); badge.className = 'group-count'; badge.textContent = String(count);
    select.append(label, badge);
    select.addEventListener('click', () => {
      selectedManageFolder = id; managePage = 0; renderManage();
    });
    row.appendChild(select);
    if (group) {
      const actions = document.createElement('div'); actions.className = 'manage-folder-actions';
      const move = (offset) => {
        const ids = state.groups.map(({ id: groupId }) => groupId);
        const from = ids.indexOf(group.id); const to = from + offset;
        if (from < 0 || to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]); command('reorder-groups', { groupIds: ids });
      };
      for (const [labelText, action] of [
        ['↑', () => move(-1)], ['↓', () => move(1)], [text().edit, () => openGroupDialog(group)],
      ]) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'manage-folder-action'; button.textContent = labelText;
        button.addEventListener('click', action); actions.appendChild(button);
      }
      const remove = document.createElement('button'); remove.type = 'button';
      remove.className = 'manage-folder-action'; remove.textContent = text().remove;
      remove.addEventListener('click', () => {
        if (remove.dataset.confirm !== '1') {
          remove.dataset.confirm = '1'; remove.textContent = text().confirmDeleteGroup; return;
        }
        command('delete-group', { groupId: group.id });
      });
      actions.appendChild(remove);
      row.appendChild(actions);
    }
    if (dropGroupId !== undefined) {
      row.addEventListener('dragover', (event) => {
        if (!draggedResourceId) return; event.preventDefault(); row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault(); row.classList.remove('drop-target');
        if (!draggedResourceId) return;
        const target = state.groups.find(({ id: groupId }) => groupId === dropGroupId);
        command('move-resource', {
          resourceId: draggedResourceId, groupId: dropGroupId, index: target?.resourceIds.length || 0,
        });
        draggedResourceId = null;
      });
    }
    return row;
  };
  const folders = [
    folderEntry({ id: 'favorites', name: text().allFavorites, count: favorites.length }),
    folderEntry({ id: 'ungrouped', name: text().ungrouped,
      count: favorites.filter(({ id }) => !assigned.has(id)).length, dropGroupId: null }),
    ...state.groups.map((group) => folderEntry({
      id: group.id, name: group.name,
      count: group.resourceIds.filter((id) => byId.has(id)).length, group, dropGroupId: group.id,
    })),
    folderEntry({ id: 'all', name: text().allSites, count: resources.length }),
  ];
  $('manageFolderNav').replaceChildren(...folders);
}

function renderBulkActions() {
  if (!state) return;
  $('selectPageLabel').textContent = text().selectPage;
  $('bulkSelectedCount').textContent = text().selectedCount.replace('{count}', selectedResourceIds.size);
  $('bulkAddToGroup').textContent = text().addToGroup;
  $('bulkClearSelection').textContent = text().clearSelection;
  const allPage = currentManagePageIds.length > 0 &&
    currentManagePageIds.every((id) => selectedResourceIds.has(id));
  const somePage = currentManagePageIds.some((id) => selectedResourceIds.has(id));
  $('selectPageResources').checked = allPage;
  $('selectPageResources').indeterminate = somePage && !allPage;
  const selectedGroup = $('bulkGroupSelect').value;
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = text().chooseGroup;
  $('bulkGroupSelect').replaceChildren(empty, ...state.groups.map((group) => {
    const option = document.createElement('option'); option.value = group.id; option.textContent = group.name;
    return option;
  }));
  if (state.groups.some(({ id }) => id === selectedGroup)) $('bulkGroupSelect').value = selectedGroup;
  const canApply = selectedResourceIds.size > 0 && !!$('bulkGroupSelect').value;
  $('bulkAddToGroup').disabled = !canApply;
  $('bulkClearSelection').disabled = selectedResourceIds.size === 0;
}

function renderSearch() {
  const results = model.searchResources(state.resources, navigation.query);
  const page = paged(results, searchPage, $('searchGrid')); searchPage = page.current;
  renderGrid($('searchGrid'), page.items);
  renderPager($('searchPager'), page.pages, page.current, (index) => {
    searchPage = index; renderSearch();
  });
  $('searchTitle').textContent = `${text().searchResults} · ${navigation.query}`;
  $('workspaceEmpty').hidden = results.length > 0;
}

function syncText() {
  const strings = text();
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
  document.title = `${strings.title} · ${state.schoolName}`;
  $('workspaceSchool').textContent = state.schoolName;
  $('workspaceReady').textContent = strings.auto;
  $('workspaceTrust').hidden = !state.unverified;
  $('workspaceTrust').textContent = strings.unverified;
  $('manageRules').textContent = strings.rules;
  $('workspaceSearch').placeholder = strings.search;
  $('clearWorkspaceSearch').textContent = strings.clear;
  $('manageTitle').textContent = strings.manageTitle;
  $('resourcePoolTitle').textContent = strings.resourcePool;
  $('manageGroupsTitle').textContent = strings.groups;
  $('createGroup').textContent = strings.createGroup;
  $('emptyTitle').textContent = strings.noMatch;
  $('emptyHint').textContent = strings.noMatchHint;
  $('clearWorkspaceFilter').textContent = strings.clearSearch;
  $('groupNameLabel').textContent = strings.groupName;
  $('cancelGroup').textContent = strings.cancel;
  $('saveGroup').textContent = strings.save;
  for (const button of document.querySelectorAll('[data-workspace-screen]')) {
    button.textContent = strings[button.dataset.workspaceScreen];
  }
}

function render() {
  if (!state) return;
  syncText();
  renderGateways(state.resources);
  const searchMode = navigation.query && navigation.screen !== 'manage';
  $('searchScreen').hidden = !searchMode;
  $('homeScreen').hidden = searchMode || navigation.screen !== 'home';
  $('manageScreen').hidden = searchMode || navigation.screen !== 'manage';
  $('workspaceEmpty').hidden = true;
  $('clearWorkspaceSearch').hidden = !navigation.query;
  for (const button of document.querySelectorAll('[data-workspace-screen]')) {
    const active = button.dataset.workspaceScreen === navigation.screen;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  }
  if (searchMode) renderSearch();
  else if (navigation.screen === 'home') renderHome();
  else renderManage();
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

$('manageRules').addEventListener('click', () => command('manage-rules'));
$('serviceCategorySelect').addEventListener('change', (event) => {
  if (!event.target.value) return;
  selectedServiceView = event.target.value; servicePage = 0; renderHome();
});
$('workspaceNavigation').addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-screen]');
  if (!button) return;
  navigation = model.normalizeNavigation({ screen: button.dataset.workspaceScreen });
  $('workspaceSearch').value = '';
  render();
});
$('openManage').addEventListener('click', () => {
  navigation = model.normalizeNavigation({ screen: 'manage' }); render();
});
$('workspaceSearch').addEventListener('input', (event) => {
  searchPage = 0; managePage = 0;
  navigation = model.normalizeNavigation({ ...navigation, query: event.target.value }); render();
});
function clearSearch() {
  $('workspaceSearch').value = '';
  searchPage = 0; managePage = 0;
  navigation = model.normalizeNavigation({ ...navigation, query: '' }); render();
}
$('clearWorkspaceSearch').addEventListener('click', clearSearch);
$('clearWorkspaceFilter').addEventListener('click', clearSearch);
$('createGroup').addEventListener('click', () => openGroupDialog());
$('selectPageResources').addEventListener('change', (event) => {
  for (const id of currentManagePageIds) {
    if (event.target.checked) selectedResourceIds.add(id);
    else selectedResourceIds.delete(id);
  }
  renderManage();
});
$('bulkGroupSelect').addEventListener('change', renderBulkActions);
$('bulkClearSelection').addEventListener('click', () => {
  selectedResourceIds.clear(); renderManage();
});
$('bulkAddToGroup').addEventListener('click', () => {
  const groupId = $('bulkGroupSelect').value;
  if (!groupId || !selectedResourceIds.size) return;
  if (command('add-resources-to-group', { resourceIds: [...selectedResourceIds], groupId })) {
    selectedResourceIds.clear(); renderBulkActions();
  }
});
$('groupDialog').addEventListener('close', () => { editingGroupId = null; editingResourceId = null; });
$('saveGroup').addEventListener('click', (event) => {
  event.preventDefault();
  const name = $('groupName').value.trim();
  const max = editingResourceId ? 40 : 30;
  if (!name || name.length > max) {
    $('groupError').textContent = editingResourceId ? text().invalidSiteName : text().invalidGroupName;
    return;
  }
  if (editingResourceId) command('rename-resource', { resourceId: editingResourceId, name });
  else command(editingGroupId ? 'rename-group' : 'create-group', editingGroupId
    ? { groupId: editingGroupId, name } : { name });
  $('groupDialog').close();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); $('workspaceSearch').focus(); $('workspaceSearch').select();
  }
});

let layoutRenderFrame = null;
let lastLayoutSignature = '';
function scheduleLayoutRender() {
  if (layoutRenderFrame !== null) cancelAnimationFrame(layoutRenderFrame);
  layoutRenderFrame = requestAnimationFrame(() => {
    layoutRenderFrame = null;
    const signature = [innerWidth, innerHeight,
      $('serviceViewGrid').clientWidth, $('serviceViewGrid').clientHeight,
      $('resourcePool').clientWidth, $('resourcePool').clientHeight,
      $('searchGrid').clientWidth, $('searchGrid').clientHeight].join(':');
    if (!state || signature === lastLayoutSignature) return;
    lastLayoutSignature = signature;
    render();
  });
}
new ResizeObserver(scheduleLayoutRender).observe(document.querySelector('.workspace-shell'));
window.addEventListener('resize', scheduleLayoutRender);

window.campusWorkspace?.onState((next) => { state = next; render(); });
window.campusWorkspace?.onFocus((target) => {
  if (target === 'search') { $('workspaceSearch').focus(); $('workspaceSearch').select(); }
  else if (target === 'manage') {
    navigation = model.normalizeNavigation({ screen: 'manage' });
    $('workspaceSearch').value = '';
    render();
  }
});
command('ready');
