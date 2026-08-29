(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.proxyAuthMigration = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function createProxyAuthMigration({
    api,
    document: doc,
    translate,
    getSettings,
    setSettings,
    isTowerBusy,
    flash,
  } = {}) {
    for (const dependency of [translate, getSettings, setSettings, isTowerBusy, flash]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('proxy authentication migration dependencies are required');
      }
    }
    if (!api?.save || !doc) throw new TypeError('proxy authentication migration environment is required');
    const $ = (id) => doc.getElementById(id);
    let busy = false;

    function render() {
      const settings = getSettings();
      $('proxyAuthMigration').hidden = settings.proxyAuthMigrationPending !== true;
      $('proxyAuthMigrationEnable').disabled = busy || isTowerBusy();
      $('proxyAuthMigrationKeep').disabled = busy || isTowerBusy();
    }

    function setOperationBusy(value) {
      busy = value === true;
      $('strictProxyAuth').disabled = busy;
      $('towerSave').disabled = busy;
      $('towerReconnect').disabled = busy;
      render();
    }

    async function applyStrict(requested) {
      const checkbox = $('strictProxyAuth');
      const settings = getSettings();
      const previous = settings.strictProxyAuth === true;
      if (busy || isTowerBusy()) {
        checkbox.checked = previous;
        return { ok: false, busy: true };
      }
      if (requested === previous && settings.proxyAuthMigrationPending !== true) {
        return { ok: true, unchanged: true };
      }

      setOperationBusy(true);
      flash(translate('tower.proxyAuthSwitching'));
      try {
        // The migration decision owns a narrow transaction. Ordinary checkbox
        // changes stay in the explicit Control Tower apply path.
        const result = await api.save({ strictProxyAuth: requested });
        if (!result?.ok) {
          checkbox.checked = previous;
          flash(result?.error || translate('tower.saveFailed'), true);
          return result || { ok: false };
        }
        const next = result.settings || { ...settings, strictProxyAuth: requested };
        setSettings(next);
        checkbox.checked = next.strictProxyAuth === true;
        const stateLabel = translate(checkbox.checked
          ? 'tower.proxyAuthOn'
          : 'tower.proxyAuthOff');
        flash(result.warning || translate(
          result.reconnected ? 'tower.proxyAuthReconnected' : 'tower.proxyAuthApplied',
          { state: stateLabel },
        ), !!result.warning);
        return result;
      } catch (error) {
        checkbox.checked = previous;
        flash(error?.message || translate('tower.saveFailed'), true);
        return { ok: false };
      } finally {
        setOperationBusy(false);
      }
    }

    async function keepCompatibility() {
      const settings = getSettings();
      if (busy || isTowerBusy() || settings.proxyAuthMigrationPending !== true) {
        return { ok: false, unchanged: true };
      }
      setOperationBusy(true);
      try {
        const result = await api.save({ proxyAuthMigrationAcknowledged: true });
        if (!result?.ok) {
          flash(result?.error || translate('tower.saveFailed'), true);
          return result || { ok: false };
        }
        setSettings(result.settings || { ...settings, proxyAuthMigrationPending: false });
        flash(translate('tower.proxyAuthOff'));
        return result;
      } catch (error) {
        flash(error?.message || translate('tower.saveFailed'), true);
        return { ok: false };
      } finally {
        setOperationBusy(false);
      }
    }

    function start() {
      $('proxyAuthMigrationEnable').addEventListener('click', () => { void applyStrict(true); });
      $('proxyAuthMigrationKeep').addEventListener('click', () => { void keepCompatibility(); });
      render();
      return true;
    }

    return { applyStrict, isBusy: () => busy, keepCompatibility, render, start };
  }

  return { createProxyAuthMigration };
});
