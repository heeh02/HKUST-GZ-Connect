'use strict';

const fs = require('fs');

function ensureOwnerOnly(file) {
  try {
    fs.chmodSync(file, 0o600);
    return true;
  } catch {
    return false;
  }
}

module.exports = { ensureOwnerOnly };
