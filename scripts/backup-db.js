'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const databaseUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_ADDON_URI || process.env.DATABASE_URL;
if (!databaseUrl) { console.error('Set TEST_DATABASE_URL or POSTGRESQL_ADDON_URI before backing up.'); process.exit(2); }
const output = path.resolve(process.env.STORE_BACKUP_PATH || path.join('backups', 'store-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump'));
fs.mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--dbname=' + databaseUrl, '--file=' + output], { stdio: 'inherit' });
if (result.error) { console.error('Could not run pg_dump. Install PostgreSQL client tools.'); process.exit(2); }
if (result.status !== 0) process.exit(result.status || 1);
const stat = fs.statSync(output);
if (!stat.size) { fs.rmSync(output, { force: true }); console.error('Backup file is empty.'); process.exit(1); }
console.log('Backup created:', output, '(' + stat.size + ' bytes)');
