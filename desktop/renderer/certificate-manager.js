(function (root, factory) {
  const shared = typeof module !== 'undefined' && module.exports
    ? require('./manager-view')
    : root.managerView;
  const api = factory(root, shared);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.certificateManager = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root, shared) {
  'use strict';

  function certificatePinsForView(input) {
    return (Array.isArray(input) ? input : []).filter((pin) => (
      pin && typeof pin.origin === 'string' && pin.origin.length <= 2048
      && typeof pin.fingerprint === 'string' && /^[a-f0-9]{64}$/iu.test(pin.fingerprint)
    )).slice(0, 32).map((pin) => ({
      origin: pin.origin,
      fingerprint: pin.fingerprint.toLowerCase(),
      updatedAt: pin.updatedAt,
    }));
  }

  function createCertificateManager({
    api,
    document: doc,
    i18n,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    if (!api || !doc || !i18n || !shared) {
      throw new TypeError('certificate manager dependencies are required');
    }
    const $ = (id) => doc.getElementById(id);
    const dialog = $('certificatePinsDialog');
    const translate = (key, vars) => i18n.createT(
      i18n.resolveLocale(doc.documentElement.lang),
    )(key, vars);
    let pins = [];
    let busy = false;
    let pendingOrigin = '';
    let pendingTimer = null;
    let started = false;

    const disarmDelete = () => {
      pendingOrigin = '';
      clearTimeoutFn(pendingTimer);
      pendingTimer = null;
    };

    function renderList() {
      const esc = shared.escapeHtml;
      $('certificatePinList').innerHTML = pins.map((pin, index) => {
        const pending = pendingOrigin === pin.origin;
        const disabled = busy ? ' disabled' : '';
        const actions = pending
          ? `<button class="mini confirm-action" type="button" data-certificate-action="delete" data-certificate-index="${index}"${disabled}>${esc(translate('certificates.confirmRevoke'))}</button>`
            + `<button class="mini" type="button" data-certificate-action="cancel-delete" data-certificate-index="${index}"${disabled}>${esc(translate('certificates.cancelRevoke'))}</button>`
          : `<button class="mini danger-action" type="button" data-certificate-action="delete" data-certificate-index="${index}"${disabled}>${esc(translate('certificates.revoke'))}</button>`;
        return `<div class="manager-item certificate-pin-item" role="listitem">`
          + `<div class="manager-item-main"><div class="manager-item-title">${esc(pin.origin)}</div>`
          + `<code class="certificate-fingerprint">${esc(pin.fingerprint)}</code>`
          + `<span class="manager-time">${esc(translate('certificates.updated', { time: shared.formatManagerTime(pin.updatedAt, translate, doc) }))}</span></div>`
          + `<div class="manager-item-actions">${actions}</div></div>`;
      }).join('');
      $('certificatePinStatus').textContent = pins.length ? '' : translate('certificates.empty');
    }

    function setBusy(nextBusy) {
      busy = nextBusy;
      $('certificatePinList').setAttribute('aria-busy', String(nextBusy));
      renderList();
    }

    async function load() {
      $('certificatePinList').innerHTML = '';
      $('certificatePinStatus').textContent = translate('certificates.loading');
      $('certificatePinError').textContent = '';
      $('certificatePinSaved').textContent = '';
      try {
        const result = await api.listCertificatePins();
        if (result?.ok === false) {
          throw new Error(shared.operationError(result, translate('certificates.loadFailed')));
        }
        const next = shared.collectionFromResult(result, 'pins');
        if (!next) throw new Error(translate('certificates.loadFailed'));
        pins = certificatePinsForView(next);
        renderList();
        return true;
      } catch (error) {
        pins = [];
        $('certificatePinList').innerHTML = '';
        $('certificatePinStatus').textContent = '';
        $('certificatePinError').textContent = error?.message || translate('certificates.loadFailed');
        return false;
      }
    }

    async function open() {
      if (dialog.open && busy) return;
      disarmDelete();
      if (!dialog.open) dialog.showModal();
      setBusy(true);
      try {
        await load();
        $('closeCertificatePinsDialog').focus();
      } finally {
        setBusy(false);
      }
    }

    function start() {
      if (started) return false;
      started = true;
      $('manageCertificatePins').addEventListener('click', open);
      $('closeCertificatePinsDialog').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', disarmDelete);
      $('certificatePinList').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-certificate-action]');
        const index = Number(button?.dataset.certificateIndex);
        const pin = Number.isInteger(index) ? pins[index] : null;
        if (!button || !pin || busy) return;
        if (button.dataset.certificateAction === 'cancel-delete') {
          disarmDelete();
          renderList();
          return;
        }
        if (button.dataset.certificateAction !== 'delete') return;
        if (pendingOrigin !== pin.origin) {
          pendingOrigin = pin.origin;
          clearTimeoutFn(pendingTimer);
          pendingTimer = setTimeoutFn(() => {
            disarmDelete();
            renderList();
          }, 4000);
          renderList();
          return;
        }
        disarmDelete();
        setBusy(true);
        $('certificatePinError').textContent = '';
        $('certificatePinSaved').textContent = '';
        try {
          const result = await api.deleteCertificatePin({
            origin: pin.origin,
            fingerprint: pin.fingerprint,
          });
          if (result?.ok === false) {
            throw new Error(shared.operationError(result, translate('certificates.deleteFailed')));
          }
          const next = shared.collectionFromResult(result, 'pins');
          if (next) {
            pins = certificatePinsForView(next);
            renderList();
          } else {
            await load();
          }
          $('certificatePinSaved').textContent = translate('certificates.revoked');
        } catch (error) {
          $('certificatePinError').textContent = error?.message
            || translate('certificates.deleteFailed');
        } finally {
          setBusy(false);
        }
      });
      doc.addEventListener('app-locale-changed', () => {
        if (dialog.open) renderList();
      });
      return true;
    }

    return { open, renderList, start };
  }

  let singleton = null;
  function start(options = {}) {
    if (singleton) return singleton;
    singleton = createCertificateManager({
      api: root.api,
      document: root.document,
      i18n: root.I18N,
      ...options,
    });
    singleton.start();
    return singleton;
  }

  return { certificatePinsForView, createCertificateManager, start };
});
