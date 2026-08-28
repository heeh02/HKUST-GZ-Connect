'use strict';

const I18N = Object.freeze({
  zh: Object.freeze({
    title: '校园工作台', manage: '整理收藏', clear: '返回工作台',
    backToServices: '返回校园服务',
    primaryWorkspace: '我的工作区', primaryRecent: '最近使用', primaryCatalog: '网站库',
    favorites: '我的收藏', recent: '最近使用', starter: '常用入口', catalogTitle: '网站库',
    manageTitle: '整理收藏', resourcePool: '收藏', groups: '书签文件夹', createGroup: '＋ 新建分组',
    allSites: '全部', allFavorites: '全部收藏',
    searchResults: '搜索结果：{query}', ungrouped: '未分组', emptyFavorites: '还没有收藏的网站',
    noMatch: '没有符合条件的校园服务', noMatchHint: '尝试其他关键词。', clearSearch: '清除搜索',
    createTitle: '新建分组', renameTitle: '重命名分组', renameSite: '重命名网页', groupName: '名称',
    cancel: '取消', save: '保存', edit: '重命名', remove: '删除', confirmDelete: '确认删除',
    confirmDeleteGroup: '删除分组（网站保留）',
    moveUp: '上移', moveDown: '下移', favorite: '收藏', unfavorite: '取消收藏',
    invalidGroupName: '请输入 1–30 个字符的分组名称', invalidSiteName: '请输入 1–40 个字符的网站名称',
    selectPage: '选择本页', selectedCount: '已选择 {count} 项', chooseGroup: '选择分组',
    addToGroup: '加入分组', clearSelection: '取消选择', memberships: '所在分组',
    openedAt: '打开于 {time}', pageRange: '{start}–{end} / {total}', previousPage: '上一页', nextPage: '下一页',
    campus: '校园隧道', direct: '直连',
    newcomer: '新生入学', courses: '课程与考试', research: '科研与计算', labs: '实验与仪器',
    studentFinance: '财务缴费', expenses: '报销与采购', career: '实习与就业', campusLife: '校园生活',
    documents: '证明、毕业与离校', tools: '通用工具', staff: '教职工工具', custom: '自定义',
  }),
  en: Object.freeze({
    title: 'Campus Workspace', manage: 'Organize Favorites', clear: 'Back to Workspace',
    backToServices: 'Back to Services',
    primaryWorkspace: 'My Workspace', primaryRecent: 'Recently Used', primaryCatalog: 'Site Library',
    favorites: 'Favorites', recent: 'Recently Used', starter: 'Common Services', catalogTitle: 'Site Library',
    manageTitle: 'Organize Favorites', resourcePool: 'Favorites', groups: 'Bookmark Folders', createGroup: '+ New Group',
    allSites: 'All', allFavorites: 'All Favorites',
    searchResults: 'Search: {query}', ungrouped: 'Ungrouped', emptyFavorites: 'No favorite sites yet',
    noMatch: 'No matching campus services', noMatchHint: 'Try another search term.', clearSearch: 'Clear Search',
    createTitle: 'New Group', renameTitle: 'Rename Group', renameSite: 'Rename Site', groupName: 'Name',
    cancel: 'Cancel', save: 'Save', edit: 'Rename', remove: 'Delete', confirmDelete: 'Confirm delete',
    confirmDeleteGroup: 'Delete Group (keep sites)',
    moveUp: 'Move up', moveDown: 'Move down', favorite: 'Favorite', unfavorite: 'Remove favorite',
    invalidGroupName: 'Enter a group name between 1 and 30 characters', invalidSiteName: 'Enter a site name between 1 and 40 characters',
    selectPage: 'Select Page', selectedCount: '{count} selected', chooseGroup: 'Choose Group',
    addToGroup: 'Add to Group', clearSelection: 'Clear Selection', memberships: 'Groups',
    openedAt: 'Opened {time}', pageRange: '{start}–{end} / {total}', previousPage: 'Previous page', nextPage: 'Next page',
    campus: 'Campus Tunnel', direct: 'Direct',
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
let draggedResourceId = null;
let selectedManageFolder = 'favorites';
let primaryView = 'workspace';
let workspaceView = 'favorites';
let catalogView = 'all';
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
  return resource.route === 'direct' ? text().direct : text().campus;
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

function resourceItem(resource, { management = false, showLastOpened = false } = {}) {
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
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', resource.id);
      item.classList.add('resource-dragging');
    });
    item.addEventListener('dragend', () => {
      draggedResourceId = null;
      item.classList.remove('resource-dragging');
      document.querySelectorAll('.manage-folder.drop-target').forEach((target) => target.classList.remove('drop-target'));
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
  if (showLastOpened && Number.isSafeInteger(resource.lastOpenedAt)) {
    const opened = document.createElement('span'); opened.className = 'resource-last-opened';
    const formatted = new Intl.DateTimeFormat(state.locale === 'en' ? 'en' : 'zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(resource.lastOpenedAt);
    opened.textContent = text().openedAt.replace('{time}', formatted);
    copy.appendChild(opened);
  }
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

function pageCapacity() {
  if (innerWidth >= 1100) return 12;
  if (innerWidth >= 760) return 8;
  return 6;
}

function paged(items, page) {
  const size = pageCapacity();
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  const start = current * size;
  return {
    current, pages, size, total: items.length,
    start, end: Math.min(items.length, start + size),
    items: items.slice(start, start + size),
  };
}

function renderPager(target, page, selectPage) {
  target.hidden = page.pages <= 1;
  if (page.pages <= 1) { target.replaceChildren(); return; }
  const info = document.createElement('span'); info.className = 'pager-range';
  info.textContent = text().pageRange
    .replace('{start}', String(page.start + 1))
    .replace('{end}', String(page.end))
    .replace('{total}', String(page.total));
  const button = (direction, label, disabled, nextPage) => {
    const control = document.createElement('button'); control.type = 'button';
    control.className = 'pager-button'; control.textContent = direction;
    control.title = label; control.setAttribute('aria-label', label); control.disabled = disabled;
    control.addEventListener('click', () => selectPage(nextPage));
    return control;
  };
  target.replaceChildren(
    info,
    button('‹', text().previousPage, page.current === 0, page.current - 1),
    button('›', text().nextPage, page.current === page.pages - 1, page.current + 1),
  );
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
    }));
  const categoryViews = categories.map(({ id }) => ({
    id, name: categoryLabel(id),
    items: model.catalogProjection(state.resources, id).items,
  }));
  const primaryLabels = {
    workspace: text().primaryWorkspace,
    recent: text().primaryRecent,
    catalog: text().primaryCatalog,
  };
  for (const control of document.querySelectorAll('[data-primary-view]')) {
    const active = control.dataset.primaryView === primaryView;
    control.textContent = primaryLabels[control.dataset.primaryView];
    control.classList.toggle('active', active);
    control.setAttribute('aria-current', active ? 'page' : 'false');
  }

  let selected;
  let secondaryViews = [];
  if (primaryView === 'workspace') {
    secondaryViews = [{ id: 'favorites', name: text().allFavorites, items: favorites }, ...groupViews];
    selected = secondaryViews.find(({ id }) => id === workspaceView) || secondaryViews[0];
    workspaceView = selected.id;
  } else if (primaryView === 'recent') {
    selected = { id: 'recent', name: text().recent, items: recent };
  } else {
    secondaryViews = [{ id: 'all', name: text().allSites, items: resources }, ...categoryViews];
    selected = secondaryViews.find(({ id }) => id === catalogView) || secondaryViews[0];
    catalogView = selected.id;
  }

  const tab = (view) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `secondary-tab${view.id === selected.id ? ' active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(view.id === selected.id));
    button.textContent = `${view.name} ${view.items.length}`;
    button.addEventListener('click', () => {
      if (primaryView === 'workspace') workspaceView = view.id;
      else if (primaryView === 'catalog') catalogView = view.id;
      servicePage = 0; renderHome();
    });
    return button;
  };
  $('secondaryNavigation').hidden = primaryView === 'recent';
  $('serviceViewTabs').replaceChildren(...secondaryViews.map(tab));
  $('secondarySelect').replaceChildren(...secondaryViews.map((view) => {
    const option = document.createElement('option'); option.value = view.id;
    option.textContent = `${view.name} ${view.items.length}`; return option;
  }));
  $('secondarySelect').value = selected.id;
  $('quickCreateGroup').hidden = primaryView !== 'workspace';
  $('quickCreateGroup').textContent = text().createGroup;
  $('serviceViewTitle').textContent = selected.name;
  $('serviceViewCount').textContent = String(selected.items.length);
  const page = paged(selected.items, servicePage); servicePage = page.current;
  renderGrid($('serviceViewGrid'), page.items, { showLastOpened: selected.id === 'recent' });
  renderPager($('servicePager'), page, (index) => {
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
  const page = paged(pool, managePage); managePage = page.current;
  currentManagePageIds = page.items.map(({ id }) => id);
  renderGrid($('resourcePool'), page.items, { management: true });
  renderBulkActions();
  $('resourcePoolCount').textContent = String(pool.length);
  renderPager($('managePager'), page, (index) => {
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
        if (!draggedResourceId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = dropGroupId === null ? 'move' : 'copy';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault(); row.classList.remove('drop-target');
        if (!draggedResourceId) return;
        const target = state.groups.find(({ id: groupId }) => groupId === dropGroupId);
        if (target) {
          command('add-resources-to-group', { resourceIds: [draggedResourceId], groupId: target.id });
        } else {
          command('move-resource', { resourceId: draggedResourceId, groupId: null, index: 0 });
        }
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
  const page = paged(results, searchPage); searchPage = page.current;
  renderGrid($('searchGrid'), page.items);
  renderPager($('searchPager'), page, (index) => {
    searchPage = index; renderSearch();
  });
  $('searchTitle').textContent = text().searchResults.replace('{query}', navigation.query);
  $('workspaceEmpty').hidden = results.length > 0;
}

function syncText() {
  const strings = text();
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
  document.title = `${strings.title} · ${state.schoolName}`;
  $('clearWorkspaceSearch').textContent = strings.clear;
  $('manageTitle').textContent = strings.manageTitle;
  $('backToServices').textContent = strings.backToServices;
  $('resourcePoolTitle').textContent = strings.resourcePool;
  $('manageGroupsTitle').textContent = strings.groups;
  $('createGroup').textContent = strings.createGroup;
  $('emptyTitle').textContent = strings.noMatch;
  $('emptyHint').textContent = strings.noMatchHint;
  $('clearWorkspaceFilter').textContent = strings.clearSearch;
  $('groupNameLabel').textContent = strings.groupName;
  $('cancelGroup').textContent = strings.cancel;
  $('saveGroup').textContent = strings.save;
}

function render() {
  if (!state) return;
  syncText();
  const searchMode = navigation.query && navigation.screen !== 'manage';
  $('searchScreen').hidden = !searchMode;
  $('homeScreen').hidden = searchMode || navigation.screen !== 'home';
  $('manageScreen').hidden = searchMode || navigation.screen !== 'manage';
  $('workspaceEmpty').hidden = true;
  $('clearWorkspaceSearch').hidden = !navigation.query;
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

$('primaryTabs').addEventListener('click', (event) => {
  const control = event.target.closest('[data-primary-view]');
  if (!control) return;
  primaryView = control.dataset.primaryView;
  servicePage = 0; renderHome();
});
$('secondarySelect').addEventListener('change', (event) => {
  if (primaryView === 'workspace') workspaceView = event.target.value;
  else if (primaryView === 'catalog') catalogView = event.target.value;
  servicePage = 0; renderHome();
});
$('openManage').addEventListener('click', () => {
  navigation = model.normalizeNavigation({ screen: 'manage' }); render();
});
$('quickCreateGroup').addEventListener('click', () => openGroupDialog());
$('backToServices').addEventListener('click', () => {
  navigation = model.normalizeNavigation({ screen: 'home' });
  render();
});
function clearSearch() {
  searchPage = 0; managePage = 0;
  navigation = model.normalizeNavigation({ screen: 'home' }); render();
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
    event.preventDefault(); command('focus-address'); return;
  }
  if ((event.target instanceof Element && event.target.closest('input, select, button, dialog')) ||
      navigation.screen !== 'home') return;
  if (event.key === 'ArrowLeft' && servicePage > 0) {
    event.preventDefault(); servicePage -= 1; renderHome();
  } else if (event.key === 'ArrowRight') {
    const next = document.querySelector('#servicePager .pager-button:last-child:not(:disabled)');
    if (next) { event.preventDefault(); next.click(); }
  }
});

let layoutRenderFrame = null;
let lastLayoutSignature = '';
function scheduleLayoutRender() {
  if (layoutRenderFrame !== null) cancelAnimationFrame(layoutRenderFrame);
  layoutRenderFrame = requestAnimationFrame(() => {
    layoutRenderFrame = null;
    const signature = String(pageCapacity());
    if (!state || signature === lastLayoutSignature) return;
    lastLayoutSignature = signature;
    render();
  });
}
new ResizeObserver(scheduleLayoutRender).observe(document.querySelector('.workspace-shell'));
window.addEventListener('resize', scheduleLayoutRender);

window.campusWorkspace?.onState((next) => { state = next; render(); });
window.campusWorkspace?.onFocus(({ target, query = '' }) => {
  if (target === 'search') {
    const normalized = query.trim().toLocaleLowerCase();
    const group = normalized && state.groups.find(({ name }) =>
      name.toLocaleLowerCase().includes(normalized));
    if (group) {
      primaryView = 'workspace'; workspaceView = group.id; servicePage = 0;
      navigation = model.normalizeNavigation({ screen: 'home' });
      render();
    } else if (query) {
      navigation = model.normalizeNavigation({ screen: 'home', query });
      searchPage = 0; render();
    } else {
      command('focus-address');
    }
  } else if (target === 'manage') {
    navigation = model.normalizeNavigation({ screen: 'manage' });
    render();
  }
});
command('ready');
