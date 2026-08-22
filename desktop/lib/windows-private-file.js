'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRIVATE_FILE_ENV = 'HKUSTGZ_PRIVATE_FILE';
const POWERSHELL_ARGS = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
const COMMON_PREFIX = String.raw`
$ErrorActionPreference = 'Stop'
$privatePath = [Environment]::GetEnvironmentVariable('${PRIVATE_FILE_ENV}')
if ([string]::IsNullOrWhiteSpace($privatePath)) { throw 'private path unavailable' }
$item = Get-Item -LiteralPath $privatePath -Force
if ($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
  throw 'private path is not a regular file'
}
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
`;
const VERIFY_SUFFIX = String.raw`
$verified = Get-Acl -LiteralPath $privatePath
$ownerSid = $verified.GetOwner([Security.Principal.SecurityIdentifier])
$rules = @($verified.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
$validRule = $rules.Count -eq 1 -and
  $rules[0].IdentityReference -eq $currentSid -and
  $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
  (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq
    [Security.AccessControl.FileSystemRights]::FullControl)
if (-not $verified.AreAccessRulesProtected -or $ownerSid -ne $currentSid -or -not $validRule) {
  throw 'private ACL verification failed'
}
[Console]::Out.Write('owner_only')
`;
const PROTECT_SCRIPT = `${COMMON_PREFIX}
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetOwner($currentSid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule(
  $currentSid,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $privatePath -AclObject $acl
${VERIFY_SUFFIX}`;
const VERIFY_SCRIPT = `${COMMON_PREFIX}
${VERIFY_SUFFIX}`;

function validWindowsPath(filePath) {
  return typeof filePath === 'string' && filePath.length > 0 && filePath.length <= 32_767 &&
    !/[\0\r\n]/u.test(filePath) && (process.platform === 'win32'
      ? path.isAbsolute(filePath)
      : path.win32.isAbsolute(filePath));
}

function runAclScript(filePath, script, {
  execute = execFileSync,
  environment = process.env,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32' || !validWindowsPath(filePath) || typeof execute !== 'function') {
    return false;
  }
  try {
    const output = execute('powershell.exe', [...POWERSHELL_ARGS, script], {
      encoding: 'utf8',
      env: { ...environment, [PRIVATE_FILE_ENV]: filePath },
      maxBuffer: 4096,
      timeout: 5000,
      windowsHide: true,
    });
    return String(output).trim() === 'owner_only';
  } catch {
    return false;
  }
}

function protectWindowsFileOwnerOnly(filePath, options) {
  return runAclScript(filePath, PROTECT_SCRIPT, options);
}

function verifyWindowsFileOwnerOnly(filePath, options) {
  return runAclScript(filePath, VERIFY_SCRIPT, options);
}

module.exports = {
  PRIVATE_FILE_ENV,
  protectWindowsFileOwnerOnly,
  verifyWindowsFileOwnerOnly,
};
