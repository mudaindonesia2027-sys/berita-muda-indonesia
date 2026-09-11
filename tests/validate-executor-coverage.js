#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend', 'server.owner-os.js'), 'utf8');
const required = [
  'analyze_seo',
  'approve_breaking',
  'broadcast_newsletter',
  'create_ad_campaign',
  'edit_homepage_layout',
  'edit_seo',
  'extend_breaking',
  'recover_system',
  'reject_breaking',
  'set_canonical',
  'set_indexing',
  'test_source',
  'toggle_ad_campaign'
];

const missing = required.filter(key => !new RegExp(`intentKey===['"]${key}['"]`).test(server));
if (missing.length) {
  console.error('OWNER EXECUTOR COVERAGE FAIL');
  console.error(JSON.stringify({ missing }, null, 2));
  process.exit(1);
}
console.log('OWNER EXECUTOR COVERAGE PASS');
console.log(JSON.stringify({ covered: required.length, actions: required }, null, 2));
