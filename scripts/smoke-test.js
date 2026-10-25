'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

(async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', POSTGRESQL_ADDON_URI: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', ADMIN_LINK: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  const base = 'http://127.0.0.1:' + port;
  async function waitForServer() {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Server exited early: ' + logs);
      try { await fetch(base + '/api/config'); return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Server did not start: ' + logs);
  }
  try {
    await waitForServer();
    let response = await fetch(base + '/');
    assert.equal(response.status, 200, 'homepage should be served');
    assert.match(await response.text(), /Store|store-name/, 'homepage should contain storefront markup');

    response = await fetch(base + '/api/config');
    assert.equal(response.status, 200, 'public config should work without database');
    const config = await response.json();
    assert.equal(config.name, 'Store');

    response = await fetch(base + '/api/health');
    assert.equal(response.status, 503, 'health should report degraded when database is not configured');
    const health = await response.json();
    assert.equal(health.status, 'degraded');
    assert.equal(health.database, 'not_configured');

    response = await fetch(base + '/api/products');
    assert.equal(response.status, 503, 'product API must fail clearly when database is unavailable');

    response = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'invalid', password: 'invalid' })
    });
    assert.equal(response.status, 503, 'admin login must remain disabled without configured credentials');

    console.log('Smoke tests passed: homepage, public config, degraded health, database guard, admin configuration guard.');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
