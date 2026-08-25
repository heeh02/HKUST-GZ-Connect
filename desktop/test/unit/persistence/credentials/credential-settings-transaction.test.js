'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  beginCredentialSettingsTransaction,
  commitCredentialSettingsTransaction,
  recoverCredentialSettingsTransaction,
  runCredentialSettingsMutation,
} = require('../../../../lib/persistence/credentials/credential-settings-transaction');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-credential-tx-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    journal: path.join(directory, 'credential-transaction.json'),
    paths: {
      settings: path.join(directory, 'settings.json'),
      settingsBackup: path.join(directory, 'settings.json.bak'),
      credential: path.join(directory, 'cred.bin'),
    },
  };
}

test('a crash between credential and settings commits restores the matching old pair', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, '{"username":"old-user"}', { mode: 0o600 });
  fs.writeFileSync(paths.settingsBackup, '{"username":"old-user"}', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-encrypted-password'), { mode: 0o600 });

  beginCredentialSettingsTransaction(journal, paths);
  fs.writeFileSync(paths.credential, Buffer.from('new-encrypted-password'), { mode: 0o600 });
  const recovered = recoverCredentialSettingsTransaction(journal, paths);

  assert.deepEqual(recovered, { ok: true, status: 'recovered' });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), '{"username":"old-user"}');
  assert.equal(fs.readFileSync(paths.settingsBackup, 'utf8'), '{"username":"old-user"}');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'old-encrypted-password');
  assert.equal(fs.existsSync(journal), false);
});

test('a crash after both commits but before journal deletion rolls back consistently', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  beginCredentialSettingsTransaction(journal, paths);
  fs.writeFileSync(paths.settings, 'new-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });

  assert.equal(recoverCredentialSettingsTransaction(journal, paths).ok, true);
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'old-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'old-credential');
});

test('committing removes the rollback journal and keeps the new pair', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  beginCredentialSettingsTransaction(journal, paths);
  fs.writeFileSync(paths.settings, 'new-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });

  assert.equal(commitCredentialSettingsTransaction(journal), true);
  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: true,
    status: 'none',
  });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'new-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-credential');
});

test('a retained durable commit marker never replays obsolete rollback data', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  beginCredentialSettingsTransaction(journal, paths);
  fs.writeFileSync(paths.settings, 'new-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
  const retainedMarkerFileSystem = {
    ...fs,
    unlinkSync(filePath) {
      if (filePath === journal) {
        const error = new Error('simulated retained directory entry');
        error.code = 'EPERM';
        throw error;
      }
      return fs.unlinkSync(filePath);
    },
  };

  assert.equal(commitCredentialSettingsTransaction(journal, retainedMarkerFileSystem), true);
  assert.equal(fs.existsSync(journal), true);
  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: true,
    status: 'committed',
  });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'new-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-credential');
});

test('a readable commit marker resolves a post-rename directory-fsync error as success', {
  skip: process.platform === 'win32',
}, (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  const injectedFileSystem = Object.create(fs);
  let fsyncCalls = 0;
  injectedFileSystem.fsyncSync = (descriptor) => {
    fsyncCalls++;
    // begin: journal file + directory; commit: marker file + directory.
    if (fsyncCalls === 4) throw new Error('simulated marker directory fsync failure');
    return fs.fsyncSync(descriptor);
  };

  const result = runCredentialSettingsMutation({
    journalPath: journal,
    paths,
    fileSystem: injectedFileSystem,
    mutate: () => {
      fs.writeFileSync(paths.settings, 'new-settings', { mode: 0o600 });
      fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
      return 'new-pair';
    },
  });

  assert.deepEqual(result, {
    ok: true,
    value: 'new-pair',
    recoveredCommit: true,
  });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'new-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-credential');
  assert.equal(fs.existsSync(journal), false);
});

test('a damaged journal clears credentials instead of risking an account mismatch', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, '{"username":"possibly-new"}', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('possibly-wrong-password'), { mode: 0o600 });
  fs.writeFileSync(journal, '{broken', { mode: 0o600 });

  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: false,
    status: 'credential-cleared',
  });
  assert.equal(fs.existsSync(paths.credential), false);
  assert.equal(fs.readdirSync(path.dirname(journal)).some((name) => (
    name.startsWith(`${path.basename(journal)}.corrupt-`)
  )), true);
});

test('a malicious journal symlink is removed without chmodding its target', (t) => {
  const { journal, paths } = fixture(t);
  const unrelated = path.join(path.dirname(journal), 'unrelated.txt');
  fs.writeFileSync(unrelated, 'unrelated', { mode: 0o644 });
  fs.writeFileSync(paths.credential, Buffer.from('possibly-wrong-password'), { mode: 0o600 });
  fs.symlinkSync(unrelated, journal);
  const before = fs.statSync(unrelated).mode & 0o777;

  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: false,
    status: 'credential-cleared',
  });
  assert.equal(fs.existsSync(paths.credential), false);
  assert.equal(fs.existsSync(journal), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'unrelated');
  if (process.platform !== 'win32') assert.equal(fs.statSync(unrelated).mode & 0o777, before);
});

test('a damaged journal remains a block marker until credential removal succeeds', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.credential, Buffer.from('locked-credential'), { mode: 0o600 });
  fs.writeFileSync(journal, '{broken', { mode: 0o600 });
  const busyFileSystem = {
    ...fs,
    unlinkSync(filePath) {
      if (filePath === paths.credential) {
        const error = new Error('busy');
        error.code = 'EBUSY';
        throw error;
      }
      return fs.unlinkSync(filePath);
    },
  };

  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths, busyFileSystem), {
    ok: false,
    status: 'blocked',
  });
  assert.equal(fs.existsSync(journal), true);
  assert.equal(fs.existsSync(paths.credential), true);
  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: false,
    status: 'credential-cleared',
  });
  assert.equal(fs.existsSync(paths.credential), false);
});

test('a transient journal stat failure blocks recovery instead of pretending it is absent', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, '{"username":"old-account"}', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-password-blob'), { mode: 0o600 });
  fs.writeFileSync(journal, '{"still":"present"}', { mode: 0o600 });
  const inaccessibleFileSystem = {
    ...fs,
    lstatSync(filePath) {
      if (filePath === journal) {
        const error = new Error('temporarily inaccessible');
        error.code = 'EACCES';
        throw error;
      }
      return fs.lstatSync(filePath);
    },
  };

  assert.deepEqual(
    recoverCredentialSettingsTransaction(journal, paths, inaccessibleFileSystem),
    { ok: false, status: 'blocked' },
  );
  assert.equal(fs.existsSync(journal), true);
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-password-blob');
});

test('a transient journal read failure preserves the credential and recovery proof', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, '{"username":"old-account"}', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-password-blob'), { mode: 0o600 });
  beginCredentialSettingsTransaction(journal, paths);
  const transientFileSystem = Object.create(fs);
  transientFileSystem.readSync = (descriptor, ...args) => {
    const error = new Error('temporary journal read failure');
    error.code = 'EIO';
    throw error;
  };

  assert.deepEqual(
    recoverCredentialSettingsTransaction(journal, paths, transientFileSystem),
    { ok: false, status: 'blocked' },
  );
  assert.equal(fs.existsSync(journal), true);
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-password-blob');
});

test('a journal disappearing between stat and open clears the unprovable credential pair', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, '{"username":"old-account"}', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('new-password-blob'), { mode: 0o600 });
  beginCredentialSettingsTransaction(journal, paths);
  const disappearingFileSystem = Object.create(fs);
  let journalStats = 0;
  disappearingFileSystem.lstatSync = (filePath, ...args) => {
    if (filePath === journal && ++journalStats === 2) {
      fs.unlinkSync(journal);
      const error = new Error('journal disappeared');
      error.code = 'ENOENT';
      throw error;
    }
    return fs.lstatSync(filePath, ...args);
  };

  assert.deepEqual(
    recoverCredentialSettingsTransaction(journal, paths, disappearingFileSystem),
    { ok: false, status: 'credential-cleared' },
  );
  assert.equal(fs.existsSync(paths.credential), false);
  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: true,
    status: 'none',
  });
  assert.equal(fs.existsSync(paths.credential), false);
});

test('a hard-linked journal is removed without chmodding the shared target', (t) => {
  if (process.platform === 'win32') return;
  const { journal, paths } = fixture(t);
  const unrelated = path.join(path.dirname(journal), 'unrelated.txt');
  fs.writeFileSync(unrelated, '{"not":"a journal"}', { mode: 0o644 });
  fs.linkSync(unrelated, journal);
  fs.writeFileSync(paths.credential, Buffer.from('possibly-wrong-password'), { mode: 0o600 });
  const mode = fs.statSync(unrelated).mode & 0o777;

  assert.deepEqual(recoverCredentialSettingsTransaction(journal, paths), {
    ok: false,
    status: 'credential-cleared',
  });
  assert.equal(fs.existsSync(paths.credential), false);
  assert.equal(fs.existsSync(journal), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), '{"not":"a journal"}');
  assert.equal(fs.statSync(unrelated).mode & 0o777, mode);
});

test('the mutation helper rolls back both files when the second write fails', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });

  const result = runCredentialSettingsMutation({
    journalPath: journal,
    paths,
    mutate: () => {
      fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
      throw new Error('settings commit failed');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'mutation');
  assert.deepEqual(result.recovery, { ok: true, status: 'recovered' });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'old-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'old-credential');
});

test('losing the journal after begin clears an unprovable credential pair', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });

  const result = runCredentialSettingsMutation({
    journalPath: journal,
    paths,
    mutate: () => {
      fs.unlinkSync(journal);
      fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
      throw new Error('settings write failed after journal disappeared');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.phase, 'mutation');
  assert.deepEqual(result.recovery, { ok: false, status: 'credential-cleared' });
  assert.equal(fs.existsSync(paths.credential), false);
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'old-settings');
});

test('a journal lost only after both durable writes keeps the matching new pair', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  const noMarkerFileSystem = Object.create(fs);
  noMarkerFileSystem.openSync = (filePath, ...args) => {
    if (String(filePath).endsWith('.restore')) {
      const error = new Error('commit marker cannot be created');
      error.code = 'EIO';
      throw error;
    }
    return fs.openSync(filePath, ...args);
  };

  const result = runCredentialSettingsMutation({
    journalPath: journal,
    paths,
    fileSystem: noMarkerFileSystem,
    mutate: () => {
      fs.writeFileSync(paths.settings, 'new-settings', { mode: 0o600 });
      fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
      fs.unlinkSync(journal);
      return 'new-pair';
    },
  });

  assert.deepEqual(result, {
    ok: true,
    value: 'new-pair',
    recoveredCommit: true,
  });
  assert.equal(fs.readFileSync(paths.settings, 'utf8'), 'new-settings');
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-credential');
});

test('losing the journal blocks connection when credential removal is unavailable', (t) => {
  const { journal, paths } = fixture(t);
  fs.writeFileSync(paths.settings, 'old-settings', { mode: 0o600 });
  fs.writeFileSync(paths.credential, Buffer.from('old-credential'), { mode: 0o600 });
  const busyFileSystem = Object.create(fs);
  busyFileSystem.unlinkSync = (filePath) => {
    if (filePath === paths.credential) {
      const error = new Error('credential is busy');
      error.code = 'EBUSY';
      throw error;
    }
    return fs.unlinkSync(filePath);
  };

  const result = runCredentialSettingsMutation({
    journalPath: journal,
    paths,
    fileSystem: busyFileSystem,
    mutate: () => {
      fs.unlinkSync(journal);
      fs.writeFileSync(paths.credential, Buffer.from('new-credential'), { mode: 0o600 });
      throw new Error('settings write failed after journal disappeared');
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.recovery, { ok: false, status: 'blocked' });
  assert.equal(fs.readFileSync(paths.credential, 'utf8'), 'new-credential');
});
