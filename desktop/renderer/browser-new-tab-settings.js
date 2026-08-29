'use strict';

(function installBrowserNewTabSettings(global) {
  const DEFAULT_URL = 'https://www.bing.com/';

  function start({ api, document, translate, getSettings, setSettings }) {
    const input = document.getElementById('browserNewTabUrl');
    const button = document.getElementById('saveBrowserNewTabUrl');
    const status = document.getElementById('browserNewTabStatus');
    const render = (settings) => { input.value = settings?.browserNewTabUrl || DEFAULT_URL; };
    const save = async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        const result = await api.save({ browserNewTabUrl: input.value });
        if (!result?.ok) {
          status.textContent = result?.error || translate('settings.newTabSaveFailed');
          return;
        }
        setSettings(result.settings || getSettings());
        render(getSettings());
        status.textContent = translate('settings.newTabSaved');
      } catch {
        status.textContent = translate('settings.newTabSaveFailed');
      } finally {
        button.disabled = false;
      }
    };
    button.addEventListener('click', save);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
    });
    render(getSettings());
    return Object.freeze({ render });
  }

  global.browserNewTabSettings = Object.freeze({ start });
})(window);
