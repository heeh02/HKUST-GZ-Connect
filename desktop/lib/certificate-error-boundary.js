'use strict';

function rejectCertificate(callback) {
  if (typeof callback !== 'function') return;
  try { callback(false); } catch {}
}

// Certificate exceptions are a user decision about the page they explicitly
// navigated to, never about arbitrary resources selected by that page. An
// untrusted subresource therefore fails closed without opening a native
// dialog. Unowned WebContents retain Chromium's default handling.
function routeCertificateError({
  owned,
  isMainFrame,
  event,
  callback,
  prompt,
} = {}) {
  if (owned !== true) return { handled: false, prompted: false };
  try { event?.preventDefault?.(); } catch {}

  if (isMainFrame !== true || typeof prompt !== 'function') {
    rejectCertificate(callback);
    return { handled: true, prompted: false };
  }

  Promise.resolve()
    .then(prompt)
    .catch(() => rejectCertificate(callback));
  return { handled: true, prompted: true };
}

module.exports = { rejectCertificate, routeCertificateError };
