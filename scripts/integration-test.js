'use strict';
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const net = require('node:net');
function freePort() { return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});}); }
(async()=>{
 const dbUrl=process.env.TEST_DATABASE_URL||process.env.POSTGRESQL_ADDON_URI;
 if(!dbUrl){console.log('PostgreSQL integration tests skipped: TEST_DATABASE_URL not configured.');return;}
 const legacySetup=new Pool({connectionString:dbUrl,ssl:false});
 try{
  await legacySetup.query(`CREATE TABLE IF NOT EXISTS store_categories (
   id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,slug TEXT NOT NULL UNIQUE,
   description TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await legacySetup.query(`CREATE TABLE IF NOT EXISTS store_products (
   id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,
   category_id BIGINT REFERENCES store_categories(id) ON DELETE SET NULL,
   short_description TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',
   image_url TEXT NOT NULL DEFAULT '',download_url TEXT NOT NULL DEFAULT '',
   version TEXT NOT NULL DEFAULT '',file_size TEXT NOT NULL DEFAULT '',
   developer TEXT NOT NULL DEFAULT '',
   rating NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
   is_featured BOOLEAN NOT NULL DEFAULT FALSE,is_published BOOLEAN NOT NULL DEFAULT FALSE,
   downloads BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await legacySetup.query("DELETE FROM store_products WHERE slug IN ('legacy-published-fixture','legacy-draft-fixture')");
  await legacySetup.query("INSERT INTO store_products(name,slug,short_description,rating,is_featured,is_published,downloads,created_at) VALUES ('Legacy published fixture','legacy-published-fixture','Existing product preserved',4.4,TRUE,TRUE,3,NOW()-INTERVAL '5 days'),('Legacy draft fixture','legacy-draft-fixture','Existing draft preserved',NULL,FALSE,FALSE,0,NOW()-INTERVAL '2 days')");
 }finally{await legacySetup.end();}
 const port=await freePort();
 const appEnv={...process.env,PORT:String(port),NODE_ENV:'test',POSTGRESQL_ADDON_URI:dbUrl,ADMIN_USERNAME:'store-integration-user',ADMIN_PASSWORD:'integration-test-password-only',ADMIN_LINK:'/integration-test-admin-route',PGSSLMODE:'disable'};
 let child=spawn(process.execPath,['server.js'],{env:appEnv,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',c=>logs+=c.toString());child.stderr.on('data',c=>logs+=c.toString());
 let secondChild=null; let secondLogs='';
 const base='http://127.0.0.1:'+port;let cookie='',csrf='';
 const api=async(url,options={})=>{const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(options.write?{'X-CSRF-Token':csrf}:{})};const response=await fetch(base+url,{...options,headers});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return{response,data:await response.json().catch(()=>({}))};};
 try{
  const deadline=Date.now()+15000;let ready=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Server exited early: '+logs);try{const r=await fetch(base+'/api/health');const d=await r.json();if(r.status===200&&d.database==='connected'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert.ok(ready,'PostgreSQL should connect and schema initialize: '+logs);
   const migratedProduct=await api('/api/products/legacy-published-fixture');assert.equal(migratedProduct.response.status,200,'existing published product should survive the additive migration');assert.equal(migratedProduct.data.status,'published','legacy published flag should backfill to published status');assert.equal(migratedProduct.data.type,'app','legacy products should default to app');assert.equal(migratedProduct.data.rating,4.4,'legacy rating should be preserved');assert.equal(migratedProduct.data.downloads,3,'legacy download count should be preserved');assert.equal(migratedProduct.data.screenshots.length,0,'new screenshot field should default to an empty array');assert.ok(migratedProduct.data.publishedAt,'legacy published date should be backfilled from creation date');
   const migratedDraft=await api('/api/products/legacy-draft-fixture');assert.equal(migratedDraft.response.status,404,'legacy unpublished product should remain private after migration');
  let r=await api('/api/admin/products');assert.equal(r.response.status,401,'admin API rejects unauthenticated requests');
  const malformedCookie=await fetch(base+'/api/admin/products',{headers:{Cookie:'store_admin_session=%ZZ'}});assert.equal(malformedCookie.status,401,'malformed session cookie should be treated as unauthenticated');
  r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:'store-integration-user',password:'integration-test-password-only'})});assert.equal(r.response.status,200,'admin login succeeds');csrf=r.data.csrfToken;assert.ok(cookie&&csrf); const sessionCookie=cookie;
  const secondPort=await freePort(); secondChild=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(secondPort),NODE_ENV:'test',POSTGRESQL_ADDON_URI:dbUrl,ADMIN_USERNAME:'store-integration-user',ADMIN_PASSWORD:'integration-test-password-only',ADMIN_LINK:'/integration-test-admin-route',PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
  secondChild.stdout.on('data',c=>secondLogs+=c.toString()); secondChild.stderr.on('data',c=>secondLogs+=c.toString());
  let secondReady=false; const secondDeadline=Date.now()+15000;
  while(Date.now()<secondDeadline){if(secondChild.exitCode!==null)throw Error('Second server exited: '+secondLogs);try{const health=await fetch('http://127.0.0.1:'+secondPort+'/api/health');const data=await health.json();if(health.status===200&&data.database==='connected'){secondReady=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert.ok(secondReady,'second server should connect to same database');
  const crossSession=await fetch('http://127.0.0.1:'+secondPort+'/api/admin/session',{headers:{Cookie:sessionCookie}});
  assert.equal(crossSession.status,200,'admin session should work across server instances');
  const expiredToken='expired-session-test-token';const expiredHash=crypto.createHash('sha256').update(expiredToken).digest('hex');const expiryPool=new Pool({connectionString:dbUrl,ssl:false});await expiryPool.query("INSERT INTO store_admin_sessions(token_hash,csrf_token,expires_at) VALUES($1,$2,NOW()-INTERVAL '1 minute') ON CONFLICT(token_hash) DO UPDATE SET expires_at=NOW()-INTERVAL '1 minute'",[expiredHash,'expired-csrf']);const expiredSession=await fetch(base+'/api/admin/session',{headers:{Cookie:'store_admin_session='+expiredToken}});assert.equal(expiredSession.status,401,'expired database session must be rejected');await expiryPool.query('DELETE FROM store_admin_sessions WHERE token_hash=$1',[expiredHash]);await expiryPool.end();
  r=await api('/api/admin/categories',{method:'POST',write:true,body:JSON.stringify({name:'Integration Category',slug:'integration-category',description:'CI test'})});assert.equal(r.response.status,201,'category create');const categoryId=r.data.item.id;
  r=await api('/api/admin/categories/'+categoryId,{method:'PUT',write:true,body:JSON.stringify({name:'Updated Integration Category',slug:'integration-category',description:'updated by CI'})});assert.equal(r.response.status,200,'category update');
   r=await api('/api/admin/products',{method:'POST',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',type:'game',status:'draft',categoryId,shortDescription:'CI test',description:'test',imageUrl:'',downloadUrl:'',screenshots:['https://example.test/shot-1.webp'],version:'1.0',fileSize:'',developer:'CI',platform:'Android',releaseNotes:'Initial release',rating:4.3,featured:false})});assert.equal(r.response.status,201,'product create');const productId=r.data.item.id;
   r=await api('/api/products?limit=10&type=game');assert.equal(r.response.status,200);assert.ok(!r.data.items.some(x=>x.slug==='integration-product'),'draft product hidden from public list');
   r=await api('/api/products/integration-product');assert.equal(r.response.status,404,'draft details must be private');
   r=await api('/api/admin/products?status=draft&type=game');assert.equal(r.response.status,200);assert.ok(r.data.items.some(x=>x.slug==='integration-product'),'admin can filter draft games');
   r=await api('/api/admin/products/'+productId,{method:'PUT',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',type:'game',status:'published',categoryId,shortDescription:'updated',description:'updated description',imageUrl:'',downloadUrl:'https://example.test/integration.apk',screenshots:['https://example.test/shot-1.webp','/screens/shot-2.webp'],version:'1.1',fileSize:'',developer:'CI',platform:'Android',releaseNotes:'Bug fixes',rating:4.7,featured:false})});assert.equal(r.response.status,200,'product update');assert.equal(r.data.item.rating,4.7,'admin update should return the saved rating');
   r=await api('/api/products?limit=10&type=game');assert.equal(r.response.status,200);let product=r.data.items.find(x=>x.slug==='integration-product');assert.ok(product,'published product public');assert.equal(product.type,'game','product type persists');assert.equal(product.hasDownload,true,'available URL should be represented by a flag');assert.equal(product.rating,4.7,'public API should return persisted product rating');assert.equal(product.screenshots.length,2,'product screenshots should be returned');assert.equal(product.platform,'Android');assert.equal(product.releaseNotes,'Bug fixes');assert.ok(!Object.hasOwn(product,'downloadUrl'),'public product list must not expose raw download URL');
   r=await api('/api/products?sort=downloads&type=game&limit=10');assert.equal(r.response.status,200);assert.ok(!r.data.items.some(x=>x.slug==='integration-product'),'popular results exclude products without recorded downloads');
   r=await api('/api/products?limit=10&type=app');assert.equal(r.response.status,200);assert.ok(!r.data.items.some(x=>x.slug==='integration-product'),'type filter excludes games from apps');
   r=await api('/api/categories/integration-category');assert.equal(r.response.status,200);assert.equal(r.data.item.productCount,1,'category count includes published products only');
   r=await api('/api/categories/missing-integration-category');assert.equal(r.response.status,404,'unknown category is not found');
   r=await api('/api/products?type=unknown');assert.equal(r.response.status,400,'invalid public product type is rejected');
   r=await api('/api/products/integration-product/download',{method:'POST'});assert.equal(r.response.status,200,'available download URL should be returned');assert.equal(r.data.url,'https://example.test/integration.apk');
   r=await api('/api/products?sort=downloads&type=game&limit=10');assert.equal(r.response.status,200);product=r.data.items.find(x=>x.slug==='integration-product');assert.equal(product.downloads,1,'download count is real and increments from a completed download request');
   r=await api('/api/admin/products/'+productId,{method:'PUT',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',type:'game',status:'published',categoryId,shortDescription:'updated',description:'updated description',imageUrl:'',downloadUrl:'',screenshots:[],version:'1.1',fileSize:'',developer:'CI',platform:'Android',releaseNotes:'Bug fixes',rating:null,featured:false})});assert.equal(r.response.status,200);assert.equal(r.data.item.rating,null,'rating can be cleared when no rating is available');r=await api('/api/products/integration-product');assert.equal(r.response.status,200);assert.equal(r.data.rating,null,'public API should preserve a missing rating as null');
   r=await api('/api/admin/products/'+productId,{method:'PUT',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',type:'game',status:'archived',categoryId,shortDescription:'updated',description:'updated description',imageUrl:'',downloadUrl:'',screenshots:[],version:'1.1',fileSize:'',developer:'CI',platform:'Android',releaseNotes:'Bug fixes',rating:null,featured:false})});assert.equal(r.response.status,200,'product can be archived');
   r=await api('/api/products/integration-product');assert.equal(r.response.status,404,'archived details must be private');r=await api('/api/categories/integration-category');assert.equal(r.data.item.productCount,0,'archived products are excluded from public category counts');
   r=await api('/api/admin/products/'+productId,{method:'PUT',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',type:'game',status:'published',categoryId,shortDescription:'republished',description:'updated description',imageUrl:'',downloadUrl:'',screenshots:[],version:'1.1',fileSize:'',developer:'CI',platform:'Android',releaseNotes:'Bug fixes',rating:null,featured:false})});assert.equal(r.response.status,200,'archived product can be republished without duplicating it');r=await api('/api/products/integration-product');assert.equal(r.response.status,200,'republished product is public again');

  r=await api('/api/admin/posts',{method:'POST',write:true,body:JSON.stringify({title:'Integration Draft',slug:'integration-draft',excerpt:'',content:'draft',coverImage:'',category:'CI',status:'draft'})});assert.equal(r.response.status,201);const draftId=r.data.item.id;
  r=await api('/api/posts');assert.equal(r.response.status,200);assert.ok(!r.data.items.some(x=>x.slug==='integration-draft'),'draft hidden publicly');
  r=await api('/api/admin/posts/'+draftId,{method:'PUT',write:true,body:JSON.stringify({title:'Integration Draft Published',slug:'integration-draft',excerpt:'now published',content:'updated body',coverImage:'',category:'CI',status:'published'})});assert.equal(r.response.status,200,'post update');r=await api('/api/posts/integration-draft');assert.equal(r.response.status,200,'updated post should publish');
  r=await api('/api/admin/posts',{method:'POST',write:true,body:JSON.stringify({title:'Integration Published',slug:'integration-published',excerpt:'published',content:'body',coverImage:'',category:'CI',status:'published'})});assert.equal(r.response.status,201);const publishedId=r.data.item.id;
  r=await api('/api/posts/integration-published');assert.equal(r.response.status,200,'published post public');
  const noCsrf=await fetch(base+'/api/admin/posts',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({title:'Rejected',slug:'csrf-rejected',status:'draft'})});assert.equal(noCsrf.status,403,'missing CSRF token rejected');
  const malformedCsrf=await fetch(base+'/api/admin/posts',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':'é'.repeat(csrf.length)},body:JSON.stringify({title:'Rejected',slug:'csrf-malformed',status:'draft'})});assert.equal(malformedCsrf.status,403,'malformed Unicode CSRF token should be rejected without server error');
  if (process.env.STORE_RESTORE_DATABASE_URL) {
    const backupPath = path.join(os.tmpdir(), 'store-integration-' + process.pid + '.dump');
    const backup = spawnSync(process.execPath, ['scripts/backup-db.js'], { env: { ...process.env, TEST_DATABASE_URL: dbUrl, STORE_BACKUP_PATH: backupPath }, stdio: 'inherit' });
    assert.equal(backup.status, 0, 'database backup command should succeed');
    assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600, 'backup file should be owner-only');
    const unsafeRestore = spawnSync(process.execPath, ['scripts/restore-db.js', backupPath], { env: { ...process.env, TEST_DATABASE_URL: dbUrl, STORE_RESTORE_DATABASE_URL: dbUrl, RESTORE_CONFIRM: 'RESTORE_TO_DATABASE:store_test' }, stdio: 'ignore' });
    assert.equal(unsafeRestore.status, 2, 'restore must refuse to target its own source database');
    const restore = spawnSync(process.execPath, ['scripts/restore-db.js', backupPath], { env: { ...process.env, TEST_DATABASE_URL: dbUrl, STORE_RESTORE_DATABASE_URL: process.env.STORE_RESTORE_DATABASE_URL, RESTORE_CONFIRM: 'RESTORE_TO_DATABASE:store_restore' }, stdio: 'inherit' });
    assert.equal(restore.status, 0, 'restore command should succeed against separate target');
    const restored = new Pool({ connectionString: process.env.STORE_RESTORE_DATABASE_URL, ssl: false });
    try {
      const products = await restored.query("SELECT slug FROM store_products WHERE slug='integration-product'");
      const posts = await restored.query("SELECT slug FROM store_posts WHERE slug='integration-published'");
      assert.equal(products.rowCount, 1, 'restored backup should contain the created product');
      assert.equal(posts.rowCount, 1, 'restored backup should contain the published post');
    } finally { await restored.end(); fs.rmSync(backupPath, { force: true }); }
  }
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timeout=setTimeout(resolve,8000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});
  child=spawn(process.execPath,['server.js'],{env:appEnv,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',c=>logs+=c.toString());child.stderr.on('data',c=>logs+=c.toString());
  let restartedReady=false;const restartDeadline=Date.now()+15000;
  while(Date.now()<restartDeadline){if(child.exitCode!==null)throw Error('Restarted server exited: '+logs);try{const health=await fetch(base+'/api/health');const data=await health.json();if(health.status===200&&data.database==='connected'){restartedReady=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert.ok(restartedReady,'server should reconnect after restart');
  r=await api('/api/products/integration-product');assert.equal(r.response.status,200,'product should persist across server restart');
  r=await api('/api/posts/integration-published');assert.equal(r.response.status,200,'published post should persist across server restart');
  r=await api('/api/admin/session');assert.equal(r.response.status,200,'database-backed admin session should persist across server restart');
  for(const [path,id] of [['posts',draftId],['posts',publishedId],['products',productId],['categories',categoryId]]){const d=await api('/api/admin/'+path+'/'+encodeURIComponent(id),{method:'DELETE',write:true});assert.equal(d.response.status,200,'cleanup '+path);}
   const migrationCleanup=new Pool({connectionString:dbUrl,ssl:false});await migrationCleanup.query("DELETE FROM store_products WHERE slug IN ('legacy-published-fixture','legacy-draft-fixture')");await migrationCleanup.end();
  await api('/api/admin/logout',{method:'POST',write:true,body:'{}'});
  const revokedSession=await fetch(base+'/api/admin/session',{headers:{Cookie:sessionCookie}});assert.equal(revokedSession.status,401,'logout must revoke the session in PostgreSQL');
  for(let i=0;i<8;i++){const bad=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'wrong-user',password:'wrong-password'})});assert.equal(bad.status,401,'failed login attempt '+(i+1));}
  const limited=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'store-integration-user',password:'integration-test-password-only'})});assert.equal(limited.status,429,'login attempts should be rate-limited persistently');
   console.log('PostgreSQL integration tests passed: additive legacy migration, persistent sessions, login throttling, CSRF, CRUD, draft privacy, download guard and backup/restore.');
 }finally{if(secondChild)secondChild.kill('SIGTERM');child.kill('SIGTERM');await Promise.all([child,secondChild].filter(Boolean).map(proc=>new Promise(resolve=>{if(proc.exitCode!==null)return resolve();const t=setTimeout(resolve,1500);proc.once('exit',()=>{clearTimeout(t);resolve();});})));}
})().catch(e=>{console.error(e);process.exitCode=1;});
