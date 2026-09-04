(function (root, factory) {
  const shared = typeof module !== 'undefined' && module.exports
    ? require('./manager-view')
    : root.managerView;
  const api = factory(root, shared);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.resourceManager = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root, shared) {
  'use strict';

  const RESOURCE_ICONS = Object.freeze({
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    'cancel-delete': '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  });

  function suggestedResourceName(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`;
    try {
      const parsed = new URL(candidate);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.host : '';
    } catch {
      return '';
    }
  }

  function createResourceManager({
    api,
    document: doc,
    i18n,
    routeLabel,
    getResources,
    setResources,
    saveResource,
    setSaved,
    launcherId = 'manageResources',
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    for (const dependency of [
      routeLabel, getResources, setResources, saveResource, setSaved,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('resource manager dependencies are required');
      }
    }
    if (!api || !doc || !i18n || !shared) {
      throw new TypeError('resource manager environment is required');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('resourceDialog');
    const translate = (key, vars) => i18n.createT(
      i18n.resolveLocale(doc.documentElement.lang),
    )(key, vars);
    let pendingDeleteId = null;
    let pendingDeleteTimer = null;
    let started = false;

    const clearMessages = () => {
      $('resourceFormError').textContent = '';
      $('resourceFormSaved').textContent = '';
    };
    const disarmDelete = () => {
      pendingDeleteId = null;
      clearTimeoutFn(pendingDeleteTimer);
      pendingDeleteTimer = null;
    };

    function setFormMode(editingResource) {
      const editing = !!editingResource;
      $('saveResource').textContent = editing
        ? translate('dialog.saveChanges')
        : translate('dialog.add');
      $('cancelResource').textContent = editing
        ? translate('dialog.cancelEdit')
        : translate('dialog.clear');
      $('resourceEditHint').textContent = editing
        ? translate('dialog.editing', { name: editingResource.name || editingResource.url })
        : '';
    }

    function clearEditor() {
      disarmDelete();
      $('resourceId').value = '';
      $('resourceName').value = '';
      $('resourceUrl').value = '';
      $('resourceDescription').value = '';
      $('resourceRoute').value = 'auto';
      clearMessages();
      setFormMode(null);
      doc.querySelectorAll('.resource-editor-row').forEach((row) => row.classList.remove('active'));
    }

    function fillEditor(resource) {
      disarmDelete();
      $('resourceId').value = resource?.builtin ? '' : (resource?.id || '');
      $('resourceName').value = resource?.name || '';
      $('resourceUrl').value = resource?.url || '';
      $('resourceDescription').value = resource?.description || '';
      $('resourceRoute').value = resource?.routePreference === 'auto'
        ? 'auto' : resource?.route === 'direct' ? 'direct' : 'campus';
      clearMessages();
      setFormMode(resource && !resource.builtin ? resource : null);
      $('resourceFormError').textContent = resource?.builtin
        ? translate('dialog.builtinReadonly')
        : '';
      doc.querySelectorAll('.resource-editor-row').forEach((row) => {
        row.classList.toggle('active', row.dataset.resourceId === resource?.id);
      });
    }

    function actionButton(action, label, disabled = false) {
      const esc = shared.escapeHtml;
      return `<button class="row-icon${action === 'delete' ? ' danger' : ''}" type="button"`
        + ` data-resource-action="${action}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>`
        + `${RESOURCE_ICONS[action]}</button>`;
    }

    function renderList() {
      const esc = shared.escapeHtml;
      const resources = getResources();
      const customIds = resources.filter((item) => !item.builtin).map((item) => item.id);
      $('resourceEditorList').innerHTML = resources.map((resource) => {
        const custom = !resource.builtin;
        let actions;
        if (pendingDeleteId === resource.id) {
          actions = `<button class="row-icon confirm-delete" type="button" data-resource-action="delete">${esc(translate('dialog.confirmDelete'))}</button>`
            + actionButton('cancel-delete', translate('dialog.cancelDelete'));
        } else if (!custom) {
          actions = `<span class="resource-editor-route">${esc(translate('dialog.builtin'))}</span>`
            + actionButton('delete', translate('dialog.delete'));
        } else {
          const index = customIds.indexOf(resource.id);
          actions = actionButton('edit', translate('dialog.edit'))
            + actionButton('up', translate('dialog.moveUp'), index <= 0)
            + actionButton('down', translate('dialog.moveDown'), index === customIds.length - 1)
            + actionButton('delete', translate('dialog.delete'));
        }
        return `<div class="resource-editor-row" data-resource-id="${esc(resource.id)}">`
          + `<div class="resource-editor-summary"><span class="resource-editor-name">${esc(resource.name)}</span>`
          + `<span class="resource-editor-route">${esc(routeLabel(resource, translate))}</span></div>`
          + `<div class="resource-editor-actions">${actions}</div></div>`;
      }).join('');
    }

    async function open() {
      renderList();
      clearEditor();
      if (!dialog.open) dialog.showModal();
    }

    function start() {
      if (started) return false;
      started = true;
      $(launcherId).addEventListener('click', open);
      $('closeResourceDialog').addEventListener('click', () => dialog.close());
      $('cancelResource').addEventListener('click', clearEditor);
      $('restoreBuiltinResources').addEventListener('click', async () => {
        disarmDelete();
        clearMessages();
        const result = await api.restoreBuiltinResources();
        if (!result?.ok) {
          $('resourceFormError').textContent = result?.error || translate('dialog.restoreFailed');
          return;
        }
        setResources(result.resources || getResources());
        renderList();
        clearEditor();
        $('resourceFormSaved').textContent = translate('dialog.restoredBuiltins');
      });
      $('resourceUrl').addEventListener('blur', () => {
        if ($('resourceName').value.trim()) return;
        const suggestion = suggestedResourceName($('resourceUrl').value);
        if (suggestion) $('resourceName').value = suggestion;
      });
      $('resourceEditorList').addEventListener('click', async (event) => {
        const row = event.target.closest('[data-resource-id]');
        if (!row) return;
        const resources = getResources();
        const resource = resources.find((item) => item.id === row.dataset.resourceId);
        const action = event.target.closest('[data-resource-action]')?.dataset.resourceAction;
        if (!resource) return;
        if (action === 'cancel-delete') {
          disarmDelete();
          renderList();
          return;
        }
        if (action === 'delete') {
          if (pendingDeleteId !== resource.id) {
            pendingDeleteId = resource.id;
            clearTimeoutFn(pendingDeleteTimer);
            pendingDeleteTimer = setTimeoutFn(() => {
              disarmDelete();
              renderList();
            }, 4000);
            renderList();
            return;
          }
          disarmDelete();
          const result = await api.deleteResource(resource.id);
          if (!result?.ok) {
            $('resourceFormError').textContent = result?.error || translate('dialog.deleteFailed');
            return;
          }
          setResources(result.resources || resources.filter((item) => item.id !== resource.id));
          renderList();
          clearEditor();
          return;
        }
        if (resource.builtin) return;
        disarmDelete();
        if (action === 'edit') fillEditor(resource);
        if (action === 'up' || action === 'down') {
          const localIds = resources.filter((item) => !item.builtin).map((item) => item.id);
          const index = localIds.indexOf(resource.id);
          const target = action === 'up' ? index - 1 : index + 1;
          if (index < 0 || target < 0 || target >= localIds.length) return;
          [localIds[index], localIds[target]] = [localIds[target], localIds[index]];
          const result = await api.reorderResources(localIds);
          if (result?.ok) {
            setResources(result.resources || resources);
            renderList();
          }
        }
      });
      $('resourceForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearMessages();
        if (!$('resourceName').value.trim()) {
          $('resourceName').value = suggestedResourceName($('resourceUrl').value);
        }
        const editing = !!$('resourceId').value;
        try {
          const routePreference = $('resourceRoute').value;
          const previous = getResources().find(({ id }) => id === $('resourceId').value);
          const saved = await saveResource({
            id: $('resourceId').value || undefined,
            name: $('resourceName').value,
            url: $('resourceUrl').value,
            description: $('resourceDescription').value,
            route: routePreference === 'auto'
              ? (previous?.route === 'direct' ? 'direct' : 'campus') : routePreference,
            routePreference,
          });
          if (!saved.ok) {
            $('resourceFormError').textContent = saved.error;
            return;
          }
          renderList();
          clearEditor();
          const message = editing
            ? translate('resources.changesSaved')
            : translate('resources.saved');
          $('resourceFormSaved').textContent = message;
          setSaved(message);
        } catch (error) {
          $('resourceFormError').textContent = error?.message || translate('dialog.saveFailed');
        }
      });
      doc.addEventListener('app-locale-changed', () => {
        if (!dialog.open) return;
        renderList();
        const current = getResources().find((item) => item.id === $('resourceId').value);
        setFormMode(current || null);
      });
      return true;
    }

    return { open, renderList, start };
  }

  let singleton = null;
  function start(options = {}) {
    if (singleton) return singleton;
    singleton = createResourceManager({
      api: root.api,
      document: root.document,
      i18n: root.I18N,
      routeLabel: root.resourceView.routeLabel,
      ...options,
    });
    singleton.start();
    return singleton;
  }

  return { createResourceManager, start, suggestedResourceName };
});
