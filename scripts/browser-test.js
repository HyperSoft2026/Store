'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { Pool } = require('pg');
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});}
(async()=>{
 const dbUrl=process.env.BROWSER_DATABASE_URL;
 if(!dbUrl){console.log('Browser tests skipped: BROWSER_DATABASE_URL not configured.');return;}
 const { chromium }=require('playwright');
 const port=await freePort(), adminLink='/browser-test-admin-route';
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',POSTGRESQL_ADDON_URI:dbUrl,ADMIN_USERNAME:'store-browser-user',ADMIN_PASSWORD:'browser-test-password-only',ADMIN_LINK:adminLink,PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',c=>logs+=c.toString());child.stderr.on('data',c=>logs+=c.toString());
 const base='http://127.0.0.1:'+port;let browser;
 const pool=new Pool({connectionString:dbUrl,ssl:false});
 try{
  let ready=false;const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Browser-test server exited: '+logs);try{const r=await fetch(base+'/api/health');const d=await r.json();if(r.status===200&&d.database==='connected'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert.ok(ready,'browser-test server should become healthy: '+logs);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(base+adminLink,{waitUntil:'networkidle'});
  await page.locator('#username').fill('store-browser-user');
  await page.locator('#password').fill('browser-test-password-only');
  await page.locator('#login-submit').click();
  await page.locator('#admin-screen').waitFor({state:'visible',timeout:10000});
  await page.locator('#new-post').click();
  await page.locator('#post-title').fill('Browser QA Post');
  await page.locator('#post-slug').fill('browser-qa-post');
  await page.locator('#post-category').fill('Automated QA');
  await page.locator('#post-excerpt').fill('Published from a real browser test.');
  await page.locator('#post-content').fill('Browser integration content.');
  await page.locator('#post-status').selectOption('published');
  await page.locator('#save-post').click();
  await page.locator('#editor-modal').waitFor({state:'hidden',timeout:10000});
  await page.goto(base+'/',{waitUntil:'networkidle'});
  await page.getByText('Browser QA Post',{exact:true}).waitFor({state:'visible',timeout:10000});
  const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  assert.ok(overflow.width<=overflow.viewport+1,'storefront should not overflow horizontally on mobile: '+JSON.stringify(overflow));
  assert.deepEqual(pageErrors,[],'browser pages should not raise uncaught JavaScript errors');
  console.log('Browser tests passed: admin login, publish post, public rendering, mobile viewport and no uncaught page errors.');
 }finally{
  if(browser)await browser.close().catch(()=>{});
  await pool.query("DELETE FROM store_posts WHERE slug='browser-qa-post'").catch(()=>{});
  await pool.end().catch(()=>{});
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const t=setTimeout(resolve,1500);child.once('exit',()=>{clearTimeout(t);resolve();});});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
