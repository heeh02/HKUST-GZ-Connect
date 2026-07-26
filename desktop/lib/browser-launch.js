'use strict';

const path = require('path');

function proxyArguments(pacUrl, profileDir, homeUrl) {
  return [
    `--proxy-pac-url=${pacUrl}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    homeUrl,
  ];
}

function windowsBrowserCandidates(env) {
  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA,
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  for (const root of roots.slice(0, 2)) {
    candidates.push(path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  return candidates;
}

function browserLaunchSpec({
  platform,
  env,
  existsSync,
  pacUrl,
  profileDir,
  homeUrl,
}) {
  const browserArgs = proxyArguments(pacUrl, profileDir, homeUrl);
  if (platform === 'darwin') {
    return {
      command: 'open',
      args: ['-na', 'Google Chrome', '--args', ...browserArgs],
      options: {},
    };
  }
  if (platform === 'win32') {
    const command = windowsBrowserCandidates(env).find(existsSync) || 'chrome.exe';
    return {
      command,
      args: browserArgs,
      // Launch the executable directly: no cmd.exe, shell quoting, or command injection.
      options: { windowsHide: true },
    };
  }
  return {
    command: 'google-chrome',
    args: browserArgs,
    options: {},
  };
}

module.exports = { browserLaunchSpec, proxyArguments, windowsBrowserCandidates };
