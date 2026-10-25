'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sourceUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_ADDON_URI || process.env.DATABASE_URL || '';
const targetUrl = process.env.STORE_RESTORE_DATABASE_URL || '';
const backupFile = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!backupFile || !fs.existsSync(backupFile) || !fs.statSync(backupFile).isFile()) { console.error('Usage: node scripts/restore-db.js <backup-file>'); process.exit(2); }
if (!targetUrl) { console.error('Set STORE_RESTORE_DATABASE_URL to the separate target database.'); process.exit(2); }
if (sourceUrl && targetUrl === sourceUrl) { console.error('Restore target must not be the source database.'); process.exit(2); }
if (process.env.RESTORE_CONFIRM !== 'RESTORE_TO_TEST_DATABASE') { console.error('Set RESTORE_CONFIRM=RESTORE_TO_TEST_DATABASE only after verifying the target database.'); process.exit(2); }
const result = spawnSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname=' + targetUrl, backupFile], { stdio: 'inherit' });
if (result.error) { console.error('Could not run pg_restore. Install PostgreSQL client tools.'); process.exit(2); }
if (result.status !== 0) process.exit(result.status || 1);
console.log('Restore completed to the explicitly configured target database.');
