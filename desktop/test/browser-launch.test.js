'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  browserLaunchSpec,
  proxyArguments,
  windowsBrowserCandidates,
} = require('../lib/browser-launch');

test('proxy arguments contain exactly one PAC URL and an isolated profile', () => {
  const args = proxyArguments(
    'file:///tmp/routing.pac',
    '/tmp/campus-chrome',
    'https://www.hkust-gz.edu.cn',
  );
  assert.deepEqual(args, [
    '--proxy-pac-url=file:///tmp/routing.pac',
    '--user-data-dir=/tmp/campus-chrome',
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.hkust-gz.edu.cn',
  ]);
});

test('Windows launches an installed browser directly without a command shell', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
  };
  const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const candidates = windowsBrowserCandidates(env);
  assert.ok(candidates.includes(edge));

  const spec = browserLaunchSpec({
    platform: 'win32',
    env,
    existsSync: (candidate) => candidate === edge,
    pacUrl: 'file:///C:/routing.pac',
    profileDir: 'C:\\profile',
    homeUrl: 'https://www.hkust-gz.edu.cn',
  });
  assert.equal(spec.command, edge);
  assert.equal(spec.options.shell, undefined);
  assert.ok(spec.args.includes('--proxy-pac-url=file:///C:/routing.pac'));
});

test('macOS uses a new Chrome instance so PAC arguments are applied', () => {
  const spec = browserLaunchSpec({
    platform: 'darwin',
    env: {},
    existsSync: () => false,
    pacUrl: 'file:///tmp/routing.pac',
    profileDir: '/tmp/profile',
    homeUrl: 'https://www.hkust-gz.edu.cn',
  });
  assert.deepEqual(spec.args.slice(0, 3), ['-na', 'Google Chrome', '--args']);
  assert.equal(spec.command, 'open');
});
