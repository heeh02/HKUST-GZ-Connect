'use strict';

const { allowedKeys, boundedArray, boundedString } = require('./ipc-guard');
const { applySettingsPatch } = require('../persistence/settings/settings-update');

function settingsPatchFromIpc(value) {
  const source = allowedKeys(value, [
    'username', 'password', 'port', 'autoReconnect', 'maxAttempts', 'startAtLogin',
    'autoConnect', 'strictProxyAuth', 'proxyAuthMigrationAcknowledged',
    'closeAction', 'language', 'routeDomains',
  ]);
  const result = { ...source };
  if (source.username != null) {
    result.username = boundedString(source.username, { maxLength: 256 });
  }
  if (source.password != null) {
    result.password = boundedString(source.password, { maxLength: 4096 });
  }
  if (source.proxyAuthMigrationAcknowledged != null &&
      source.proxyAuthMigrationAcknowledged !== true) {
    throw new TypeError('proxyAuthMigrationAcknowledged must be true');
  }
  if (Array.isArray(source.routeDomains)) {
    result.routeDomains = boundedArray(
      source.routeDomains,
      (item) => boundedString(item, { minLength: 1, maxLength: 253, trim: true }),
      { maxLength: 64 },
    );
  } else if (source.routeDomains != null) {
    result.routeDomains = boundedString(source.routeDomains, { maxLength: 4096 });
  }
  return result;
}

function clearPasswordReference(value) {
  if (!value || typeof value !== 'object' || typeof value.password !== 'string') return;
  try { value.password = ''; } catch {}
}

function registerSettingsCredentialIpc(dependencies = {}) {
  const {
    register,
    loadSettings,
    saveSettings,
    savePassword,
    removePassword,
    runCredentialMutation,
    credentialJournalPath,
    credentialPaths,
    applyCredentialRecovery,
    isCredentialBlocked,
    retryCredentialRecovery,
    runPolicyTransaction,
    runSerialTransaction,
    assertPersistence,
    translate,
    onLanguageChanged,
    setStartAtLogin,
    hasActiveEngine,
    reconnect,
    disconnect,
  } = dependencies;
  for (const dependency of [
    register, loadSettings, saveSettings, savePassword, removePassword,
    runCredentialMutation, applyCredentialRecovery, isCredentialBlocked,
    retryCredentialRecovery, runPolicyTransaction, runSerialTransaction,
    assertPersistence, translate, onLanguageChanged, setStartAtLogin,
    hasActiveEngine, reconnect, disconnect,
  ]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('settings credential IPC dependencies are incomplete');
    }
  }
  if (typeof credentialJournalPath !== 'string' || !credentialPaths) {
    throw new TypeError('settings credential transaction paths are required');
  }

  register('save', async (_event, rawPatch) => {
    let previous = null;
    let patch;
    let next;
    let portChanged;
    let proxyAuthChanged;
    try {
      try {
        previous = loadSettings();
        patch = settingsPatchFromIpc(rawPatch);
        ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(previous, patch));
      } catch (error) {
        return {
          ok: false,
          error: error.userMessage || error.message,
          settings: previous,
        };
      }
      const replacingPassword = typeof patch.password === 'string' && patch.password.length > 0;
      const policyTransactionRequired = patch.routeDomains != null || patch.port != null ||
        patch.strictProxyAuth != null;
      if (replacingPassword && policyTransactionRequired) {
        return {
          ok: false,
          error: translate('error.credentialPolicyCombined'),
          settings: previous,
        };
      }

      const commitCandidateSettings = () => {
        const usernameChanged = patch.username != null && next.username !== previous.username;
        if (usernameChanged && !replacingPassword) {
          const message = translate('error.usernameNeedsPassword');
          throw Object.assign(new Error(message), { userMessage: message });
        }
        if (!replacingPassword) {
          next = saveSettings(next);
          return next;
        }

        const transaction = runCredentialMutation({
          journalPath: credentialJournalPath,
          paths: credentialPaths,
          mutate: () => {
            if (!savePassword(patch.password, next.username)) {
              throw Object.assign(new Error('protected credential storage unavailable'), {
                credentialStoreUnavailable: true,
              });
            }
            next = saveSettings(next);
            return next;
          },
        });
        if (!transaction.ok) {
          const passwordWasCleared = transaction.recovery?.status === 'credential-cleared';
          applyCredentialRecovery(transaction.recovery, {
            clearedNoticeKey: 'error.settingsSaveFailedPasswordCleared',
          });
          const message = isCredentialBlocked()
            ? translate('error.credentialRecoveryBlocked')
            : (passwordWasCleared
              ? translate('error.settingsSaveFailedPasswordCleared')
              : transaction.error?.credentialStoreUnavailable
                ? translate('error.passwordStoreUnavailable')
                : translate('error.settingsSaveFailed'));
          throw Object.assign(new Error(message), {
            userMessage: message,
            rollbackIncomplete: isCredentialBlocked(),
          });
        }
        applyCredentialRecovery(
          { ok: true, status: 'committed' },
          { clearNotice: true },
        );
        return transaction.value;
      };

      try {
        if (policyTransactionRequired) {
          await runPolicyTransaction(() => {
            previous = loadSettings();
            ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(
              previous,
              patch,
            ));
            return {
              commit: commitCandidateSettings,
              rollback: () => saveSettings(previous),
              resumeBrowser: !(portChanged || proxyAuthChanged),
            };
          });
        } else {
          await runSerialTransaction(() => {
            assertPersistence();
            previous = loadSettings();
            ({ settings: next, portChanged, proxyAuthChanged } = applySettingsPatch(
              previous,
              patch,
            ));
            return {
              commit: commitCandidateSettings,
              rollback: replacingPassword ? undefined : () => saveSettings(previous),
            };
          });
        }
      } catch (saveError) {
        return {
          ok: false,
          error: saveError.userMessage || (policyTransactionRequired
            ? saveError.message
            : translate('error.settingsSaveFailed')),
          rollbackIncomplete: saveError.rollbackIncomplete === true,
          settings: previous,
        };
      }

      if (next.language !== previous.language) onLanguageChanged(next.language);
      if (typeof patch.startAtLogin === 'boolean') setStartAtLogin(patch.startAtLogin);
      let reconnected = false;
      if (hasActiveEngine() && (portChanged || proxyAuthChanged)) {
        const reconnectResult = await reconnect();
        reconnected = reconnectResult?.ok === true;
      }
      return {
        ok: true,
        warning: null,
        settings: next,
        portChanged,
        proxyAuthChanged,
        reconnected,
      };
    } finally {
      clearPasswordReference(patch);
      clearPasswordReference(rawPatch);
    }
  });

  register('logout', () => runSerialTransaction(() => ({
    commit: async () => {
      const stopped = await disconnect();
      if (!stopped.ok) return { ok: false, error: translate('error.engineStuck') };
      if (isCredentialBlocked()) {
        const recovery = retryCredentialRecovery();
        if (recovery.status === 'blocked') {
          return { ok: false, error: translate('error.credentialRecoveryBlocked') };
        }
      }

      let previous;
      try {
        previous = loadSettings();
      } catch (error) {
        return { ok: false, error: error.message };
      }
      const transaction = runCredentialMutation({
        journalPath: credentialJournalPath,
        paths: credentialPaths,
        mutate: () => {
          if (!removePassword()) {
            throw new Error('could not durably remove encrypted credential');
          }
          return saveSettings({ ...previous, username: '' });
        },
      });
      if (!transaction.ok) {
        const passwordWasCleared = transaction.recovery?.status === 'credential-cleared';
        applyCredentialRecovery(transaction.recovery, {
          clearedNoticeKey: 'error.logoutFailedPasswordCleared',
        });
        const message = isCredentialBlocked()
          ? translate('error.credentialRecoveryBlocked')
          : (passwordWasCleared
            ? translate('error.logoutFailedPasswordCleared')
            : translate('error.logoutFailed'));
        return {
          ok: false,
          error: message,
          rollbackIncomplete: isCredentialBlocked(),
        };
      }
      applyCredentialRecovery(
        { ok: true, status: 'committed' },
        { clearNotice: true },
      );
      return { ok: true, settings: transaction.value };
    },
  })));
}

module.exports = {
  registerSettingsCredentialIpc,
  settingsPatchFromIpc,
};
