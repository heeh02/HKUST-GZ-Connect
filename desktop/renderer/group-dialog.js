(function initializeCategoryGroupDialog(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.categoryGroupDialog = api;
})(typeof self !== 'undefined' ? self : globalThis, function categoryGroupDialogFactory() {
  'use strict';

  // Main-window counterpart of the Campus Browser workspace group dialog:
  // create or rename one favorite category through the trusted IPC channels.
  function create({
    api,
    document: doc,
    translate,
    onChanged = () => {},
    toast = () => {},
  } = {}) {
    for (const dependency of [translate]) {
      if (typeof dependency !== 'function') throw new TypeError('category group dialog dependencies are incomplete');
    }
    if (!api || typeof api.createFavoriteGroup !== 'function' ||
        typeof api.renameFavoriteGroup !== 'function' || !doc) {
      throw new TypeError('category group dialog environment is incomplete');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('groupDialog');
    let started = false;
    let busy = false;
    let editingGroupId = null;
    let revision = 0;

    function open(group = null) {
      editingGroupId = group?.id || null;
      revision += 1;
      $('groupDialogTitle').textContent = translate(group ? 'group.renameTitle' : 'group.createTitle');
      $('groupName').value = group?.name || '';
      $('groupError').textContent = '';
      $('saveGroup').disabled = false;
      if (!dialog.open) dialog.showModal();
      $('groupName').focus();
      if (group) $('groupName').select();
    }

    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      const name = $('groupName').value.trim();
      if (!name || name.length > 30) {
        $('groupError').textContent = translate('group.invalid');
        return;
      }
      const dialogRevision = revision;
      const groupId = editingGroupId;
      busy = true;
      $('saveGroup').disabled = true;
      try {
        const result = groupId
          ? await api.renameFavoriteGroup(groupId, name)
          : await api.createFavoriteGroup(name);
        if (dialogRevision !== revision || !dialog.open) return;
        if (!result?.ok) {
          $('groupError').textContent = result?.error || translate('group.failed');
          return;
        }
        dialog.close();
        onChanged(result.groups || []);
        toast(translate('resources.changesSaved'));
      } catch (error) {
        if (dialogRevision === revision && dialog.open) {
          $('groupError').textContent = error?.message || translate('group.failed');
        }
      } finally {
        busy = false;
        if (dialog.open) $('saveGroup').disabled = false;
      }
    }

    function start() {
      if (started) return false;
      started = true;
      $('closeGroupDialog').addEventListener('click', () => { if (!busy) dialog.close(); });
      $('cancelGroup').addEventListener('click', () => { if (!busy) dialog.close(); });
      $('groupForm').addEventListener('submit', submit);
      dialog.addEventListener('close', () => { revision += 1; editingGroupId = null; });
      return true;
    }

    return { open, start };
  }

  let singleton = null;
  function start(options) {
    if (singleton) return singleton;
    singleton = create(options);
    singleton.start();
    return singleton;
  }

  return { create, start };
});
