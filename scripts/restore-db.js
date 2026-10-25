'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sourceUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_ADDON_URI || process.env.DATABASE_URL || '';
const targetUrl = process.env.STORE_RESTORE_DATABASE_URL || '';
const backupFile = process.argv[2] ? path.resolve(process.argv[2]) : '';
function identity(value) {
  try { const u = new URL(value); return (u.hostname + ':' + (u.port || '5432') + u.pathname).toLowerCase(); }
  catch { return String(value).trim().toLowerCase(); }
}
if (!backupFile || !fs.existsSync(backupFile) || !fs.statSync(backupFile).isFile()) { console.error('Usage: node scripts/restore-db.js <backup-file>'); process.exit(2); }
if (!targetUrl) { console.error('Set STORE_RESTORE_DATABASE_URL to a separate test/restore database.'); process.exit(2); }
if (sourceUrl && identity(targetUrl) === identity(sourceUrl)) { console.error('Restore target must not be the source database.'); process.exit(2); }
let targetName = '';
try {
  const parsed = new URL(targetUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  targetName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
} catch { console.error('STORE_RESTORE_DATABASE_URL must be a valid PostgreSQL URL.'); process.exit(2); }
if (!targetName || !/(test|restore|staging|sandbox|dev)/i.test(targetName)) { console.error('For safety, restore only to a database named for test, restore, staging, sandbox or dev.'); process.exit(2); }
if (process.env.RESTORE_CONFIRM !== 'RESTORE_TO_DATABASE:' + targetName) { console.error('Set RESTORE_CONFIRM=RESTORE_TO_DATABASE:' + targetName + ' only after verifying the target.'); process.exit(2); }
const archive = spawnSync('pg_restore', ['--list', backupFile], { encoding: 'utf8' });
if (archive.error || archive.status !== 0) { console.error('Backup archive validation failed.'); process.exit(2); }
const result = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname=' + targetUrl, backupFile], { stdio: 'inherit' });
if (result.error) { console.error('Could not run pg_restore. Install PostgreSQL client tools.'); process.exit(2); }
if (result.status !== 0) process.exit(result.status || 1);
console.log('Restore completed to the explicitly verified target database:', targetName);
