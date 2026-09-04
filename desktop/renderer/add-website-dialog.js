(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.addWebsiteDialog = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function hostnameFor(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    const candidate = /^(?:https?:)?\/\//iu.test(source) ? source : `https://${source}`;
    try {
      const parsed = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.hostname : '';
    } catch { return ''; }
  }

  function create({
    api,
    document: doc,
    translate,
    getResources,
    setResources,
    getGroups,
    setGroups,
    toast = () => {},
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    for (const dependency of [translate, getResources, setResources, getGroups, setGroups]) {
      if (typeof dependency !== 'function') throw new TypeError('add website dependencies are incomplete');
    }
    if (!api || typeof api.previewRoutingTarget !== 'function' ||
        typeof api.createFavoriteResource !== 'function' ||
        typeof api.openResource !== 'function' || !doc) {
      throw new TypeError('add website environment is incomplete');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('addWebsiteDialog');
    let started = false;
    let busy = false;
    let previewRevision = 0;
    let previewTimer = null;
    let nameEdited = false;

    function groupOptions(selected = '') {
      const options = [{ id: '', name: translate('addWebsite.noGroup') }, ...getGroups()];
      $('addWebsiteGroup').replaceChildren(...options.map(({ id, name }) => {
        const option = doc.createElement('option');
        option.value = id;
        option.textContent = name;
        option.selected = id === selected;
        return option;
      }));
    }

    function setBusy(next) {
      busy = next === true;
      for (const id of [
        'addWebsiteUrl', 'addWebsiteName', 'addWebsiteGroup', 'addWebsiteRoute',
        'submitAddWebsite', 'cancelAddWebsite', 'closeAddWebsite',
      ]) $(id).disabled = busy;
      $('submitAddWebsite').textContent = translate(
        busy ? 'addWebsite.submitting' : 'addWebsite.submit',
      );
    }

    function clearPreview() {
      previewRevision += 1;
      clearTimeoutFn(previewTimer);
      previewTimer = null;
      $('addWebsitePreview').hidden = true;
      $('addWebsitePreview').textContent = '';
      $('addWebsiteConflict').hidden = true;
      $('addWebsiteConflict').textContent = '';
    }

    function routeSourceLabel(source) {
      const key = `routing.source.${source || 'default'}`;
      const translated = translate(key);
      return translated === key ? translate('routing.source.default') : translated;
    }

    function conflictFor(host) {
      if (!host) return [];
      return getResources().filter((resource) => !resource.builtin && hostnameFor(resource.url) === host);
    }

    async function preview() {
      const value = $('addWebsiteUrl').value.trim();
      if (!value) { clearPreview(); return null; }
      const revision = ++previewRevision;
      const result = await api.previewRoutingTarget(value).catch(() => null);
      if (revision !== previewRevision) return null;
      if (!result?.ok || !result.target) {
        $('addWebsitePreview').textContent = result?.error || translate('addWebsite.invalidUrl');
        $('addWebsitePreview').classList.add('error');
        $('addWebsitePreview').hidden = false;
        return null;
      }
      $('addWebsitePreview').classList.remove('error');
      const route = translate(result.resolution?.route === 'direct'
        ? 'resources.routeDirect' : 'resources.routeCampus');
      $('addWebsitePreview').textContent = translate('addWebsite.preview', {
        host: result.target.host,
        route,
        source: routeSourceLabel(result.resolution?.source),
      });
      $('addWebsitePreview').hidden = false;
      if (!nameEdited && !$('addWebsiteName').value.trim()) {
        $('addWebsiteName').value = result.target.host.slice(0, 40);
      }
      const sameHost = conflictFor(result.target.host);
      const fixed = $('addWebsiteRoute').value !== 'auto';
      $('addWebsiteRouteHint').textContent = translate(fixed
        ? 'addWebsite.routeFixedHint' : 'addWebsite.routeHint');
      if (fixed) {
        $('addWebsiteConflict').textContent = translate(sameHost.length
          ? 'addWebsite.sameHostWarning' : 'addWebsite.fixedHostWarning', {
          count: sameHost.length, host: result.target.host,
        });
        $('addWebsiteConflict').hidden = false;
      } else {
        $('addWebsiteConflict').hidden = true;
        $('addWebsiteConflict').textContent = '';
      }
      return result;
    }

    function reset() {
      clearPreview();
      nameEdited = false;
      $('addWebsiteForm').reset();
      $('addWebsiteRoute').value = 'auto';
      $('addWebsiteRouteHint').textContent = translate('addWebsite.routeHint');
      $('addWebsiteError').textContent = '';
      groupOptions('');
      setBusy(false);
    }

    function open() {
      reset();
      if (!dialog.open) dialog.showModal();
      $('addWebsiteUrl').focus();
    }

    async function submit(event) {
      event.preventDefault();
      if (busy) return;
      $('addWebsiteError').textContent = '';
      const checked = await preview();
      if (!checked?.ok) {
        $('addWebsiteError').textContent = checked?.error || translate('addWebsite.invalidUrl');
        $('addWebsiteUrl').focus();
        return;
      }
      if (!$('addWebsiteName').value.trim()) {
        $('addWebsiteName').value = checked.target.host.slice(0, 40);
      }
      setBusy(true);
      try {
        const result = await api.createFavoriteResource({
          name: $('addWebsiteName').value,
          url: $('addWebsiteUrl').value,
          description: '',
          groupId: $('addWebsiteGroup').value || null,
          routePreference: $('addWebsiteRoute').value,
        });
        if (!result?.ok || !result.resource) {
          $('addWebsiteError').textContent = result?.error || translate('addWebsite.failed');
          return;
        }
        setResources(result.resources || getResources());
        setGroups(result.groups || getGroups());
        dialog.close();
        toast(translate(result.affectedResourceIds?.length
          ? 'addWebsite.savedSameHost' : 'addWebsite.saved'));
        const opened = await api.openResource(result.resource.id);
        if (Array.isArray(opened?.resources)) setResources(opened.resources);
        if (!opened?.ok) toast(opened?.error || translate('quick.browserOpenFailed'), 'error');
      } catch (error) {
        $('addWebsiteError').textContent = error?.message || translate('addWebsite.failed');
      } finally {
        setBusy(false);
      }
    }

    function start() {
      if (started) return false;
      started = true;
      $('addWebsite').addEventListener('click', open);
      $('closeAddWebsite').addEventListener('click', () => !busy && dialog.close());
      $('cancelAddWebsite').addEventListener('click', () => !busy && dialog.close());
      $('addWebsiteName').addEventListener('input', () => { nameEdited = true; });
      $('addWebsiteRoute').addEventListener('change', () => { void preview(); });
      $('addWebsiteUrl').addEventListener('input', () => {
        clearTimeoutFn(previewTimer);
        previewTimer = setTimeoutFn(() => { previewTimer = null; void preview(); }, 180);
      });
      $('addWebsiteUrl').addEventListener('blur', () => { void preview(); });
      $('addWebsiteForm').addEventListener('submit', submit);
      dialog.addEventListener('close', reset);
      doc.addEventListener('app-locale-changed', () => {
        if (dialog.open) groupOptions($('addWebsiteGroup').value);
      });
      return true;
    }

    return { open, preview, reset, start };
  }

  let singleton = null;
  function start(options) {
    if (singleton) return singleton;
    singleton = create(options);
    singleton.start();
    return singleton;
  }

  return { create, hostnameFor, start };
});
