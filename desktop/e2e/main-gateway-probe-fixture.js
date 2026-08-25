'use strict';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--origin') process.exit(2);
let origin;
try {
  const parsed = new URL(args[1]);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) process.exit(3);
  origin = parsed.origin;
} catch { process.exit(3); }

process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  normalized_origin: origin,
  https_identity_valid: true,
  compatibility: 'recognized_candidate',
  candidate_family: 'easyconnect-password-modern-l3-v1',
  reported_version: 'M7.6.8R2',
  http_status: 200,
})}\n`);
