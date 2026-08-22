'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const shellSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'desktop-shell.js'),
  'utf8',
);

function section(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing source section: ${startText}`);
  return source.slice(start, end);
}

test('engine close settles fail-closed when retry settings are temporarily unreadable', () => {
  const body = section('function handleEngineClose(', '\nasync function connectOnce(');
  assert.match(body, /try \{\s*cfg = loadSettings\(\);\s*\} catch \(error\)/);
  assert.match(body, /connectionState\.engineClosed\(\{[\s\S]*terminalFailure: true/);
  assert.match(body, /state\.connecting = false;/);
  assert.match(body, /reportSettingsReadFailure\(error/);
});

test('final connection snapshot clears both FSM and UI state on read failure', () => {
  const body = section('async function connectOnce(', '\nfunction ensureEngineStopped(');
  const marker = body.indexOf('// FINAL_CONNECTION_SNAPSHOT:');
  const spawn = body.indexOf('const started = engineSupervisor.start(');
  const guardedStart = body.slice(marker, spawn);
  assert.match(guardedStart, /try \{\s*s = loadSettings\(\);\s*pw = loadPassword\(\);/);
  assert.match(guardedStart, /connectionState\.failIntent\(intent\);/);
  assert.match(guardedStart, /state\.connecting = false;/);
  assert.match(guardedStart, /settingsUnavailable: true/);
});

test('window close and automatic updates turn settings failures into bounded async outcomes', () => {
  const closeStart = shellSource.indexOf('async handleWindowClose(');
  const closeEnd = shellSource.indexOf('\n  createWindow()', closeStart);
  const close = shellSource.slice(closeStart, closeEnd);
  assert.match(close, /let action = 'ask';/);
  assert.match(close, /try \{ action = this\.getCloseAction\(\) \|\| 'ask'; \} catch \{\}/);
  assert.match(source, /getCloseAction: \(\) => loadSettingsOrReport\(\)\.closeAction/);
  assert.match(source, /async function runAutomaticUpdateCheck\(\)/);
  assert.match(shellSource, /this\.handleWindowClose\(event\)\.catch\(this\.onWindowError\)/);
});

test('a startup PAC failure does not hide an earlier recovery error', () => {
  const startup = section('app.whenReady().then(() => {', "app.on('window-all-closed'");
  assert.match(startup, /const pacError =/);
  assert.match(startup, /state\.lastError = \[state\.lastError, pacError\]\.filter\(Boolean\)\.join\('\\n'\)/);
});
