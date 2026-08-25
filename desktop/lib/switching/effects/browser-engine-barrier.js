'use strict';

function callOr(value, fallback) {
  if (typeof value !== 'function') return fallback;
  try { return value(); } catch { return fallback; }
}

// The in-process request gate is the authoritative shutdown boundary. PAC
// replacement and connection draining add defense in depth, but a failure in
// either must never turn "disconnect" into "leave the engine running".
async function stopEngineAfterBrowserSuspend({
  suspendBrowser,
  browserBoundaryClosed,
  closeBrowser,
  stopEngine,
  onSuspendError,
} = {}) {
  if (typeof stopEngine !== 'function') throw new TypeError('引擎停止操作无效');
  let browserSuspendError = null;
  try {
    if (typeof suspendBrowser === 'function') await suspendBrowser();
  } catch (error) {
    browserSuspendError = error;
    callOr(() => onSuspendError?.(error), undefined);
    // If the synchronous request gate cannot be confirmed, destroy the page
    // surface before releasing the proxy listener. Closing is best-effort;
    // engine ownership must still be released even if Chromium also misbehaves.
    if (callOr(browserBoundaryClosed, false) !== true) {
      callOr(closeBrowser, undefined);
    }
  }

  const result = await stopEngine();
  if (!browserSuspendError || !result || typeof result !== 'object') return result;
  return { ...result, browserSuspendError };
}

module.exports = { stopEngineAfterBrowserSuspend };
