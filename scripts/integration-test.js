'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
function freePort() { return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});}); }
(async()=>{
 const dbUrl=process.env.TEST_DATABASE_URL||process.env.POSTGRESQL_ADDON_URI;
 if(!dbUrl){console.log('PostgreSQL integration tests skipped: TEST_DATABASE_URL not configured.');return;}
 const port=await freePort();
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'test',POSTGRESQL_ADDON_URI:dbUrl,ADMIN_USERNAME:'store-integration-user',ADMIN_PASSWORD:'integration-test-password-only',ADMIN_LINK:'/integration-test-admin-route',PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',c=>logs+=c.toString());child.stderr.on('data',c=>logs+=c.toString());
 const base='http://127.0.0.1:'+port;let cookie='',csrf='';
 const api=async(url,options={})=>{const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(options.write?{'X-CSRF-Token':csrf}:{})};const response=await fetch(base+url,{...options,headers});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return{response,data:await response.json().catch(()=>({}))};};
 try{
  const deadline=Date.now()+15000;let ready=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Server exited early: '+logs);try{const r=await fetch(base+'/api/health');const d=await r.json();if(r.status===200&&d.database==='connected'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  assert.ok(ready,'PostgreSQL should connect and schema initialize: '+logs);
  let r=await api('/api/admin/products');assert.equal(r.response.status,401,'admin API rejects unauthenticated requests');
  r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:'store-integration-user',password:'integration-test-password-only'})});assert.equal(r.response.status,200,'admin login succeeds');csrf=r.data.csrfToken;assert.ok(cookie&&csrf);
  r=await api('/api/admin/categories',{method:'POST',write:true,body:JSON.stringify({name:'Integration Category',slug:'integration-category',description:'CI test'})});assert.equal(r.response.status,201,'category create');const categoryId=r.data.item.id;
  r=await api('/api/admin/products',{method:'POST',write:true,body:JSON.stringify({name:'Integration Product',slug:'integration-product',categoryId,shortDescription:'CI test',description:'test',imageUrl:'',downloadUrl:'',version:'1.0',fileSize:'',developer:'CI',featured:false,published:true})});assert.equal(r.response.status,201,'product create');const productId=r.data.item.id;
  r=await api('/api/products?limit=10');assert.equal(r.response.status,200);const product=r.data.items.find(x=>x.slug==='integration-product');assert.ok(product,'published product public');assert.equal(product.hasDownload,false,'missing URL must not advertise download');
  r=await api('/api/products/integration-product/download',{method:'POST'});assert.equal(r.response.status,404,'missing download URL rejected');
  r=await api('/api/admin/posts',{method:'POST',write:true,body:JSON.stringify({title:'Integration Draft',slug:'integration-draft',excerpt:'',content:'draft',coverImage:'',category:'CI',status:'draft'})});assert.equal(r.response.status,201);const draftId=r.data.item.id;
  r=await api('/api/posts');assert.equal(r.response.status,200);assert.ok(!r.data.items.some(x=>x.slug==='integration-draft'),'draft hidden publicly');
  r=await api('/api/admin/posts',{method:'POST',write:true,body:JSON.stringify({title:'Integration Published',slug:'integration-published',excerpt:'published',content:'body',coverImage:'',category:'CI',status:'published'})});assert.equal(r.response.status,201);const publishedId=r.data.item.id;
  r=await api('/api/posts/integration-published');assert.equal(r.response.status,200,'published post public');
  const noCsrf=await fetch(base+'/api/admin/posts',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({title:'Rejected',slug:'csrf-rejected',status:'draft'})});assert.equal(noCsrf.status,403,'missing CSRF token rejected');
  for(const [path,id] of [['posts',draftId],['posts',publishedId],['products',productId],['categories',categoryId]]){const d=await api('/api/admin/'+path+'/'+encodeURIComponent(id),{method:'DELETE',write:true});assert.equal(d.response.status,200,'cleanup '+path);}
  await api('/api/admin/logout',{method:'POST',write:true,body:'{}'});
  console.log('PostgreSQL integration tests passed: schema, auth, CSRF, category/product/post CRUD, draft privacy and download guard.');
 }finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const t=setTimeout(resolve,1500);child.once('exit',()=>{clearTimeout(t);resolve();});});}
})().catch(e=>{console.error(e);process.exitCode=1;});
