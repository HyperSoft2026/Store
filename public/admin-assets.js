(() => {
'use strict';
const $ = s => document.querySelector(s);
const state = { csrf: '', posts: [], editing: null, filter: 'all', search: '' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(id, text) { const n=$(id); n.textContent=text; n.hidden=!text; }
async function api(url, opts={}) {
 const headers={Accept:'application/json',...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})};
 if(state.csrf && opts.method && opts.method!=='GET') headers['X-CSRF-Token']=state.csrf;
 const r=await fetch(url,{credentials:'same-origin',...opts,headers});
 const d=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(d.message||'صار خطأ. جرّب مرة ثانية.');
 return d;
}
function loginView(){ $('#login-screen').hidden=false; $('#admin-screen').hidden=true; state.csrf=''; }
function adminView(){ $('#login-screen').hidden=true; $('#admin-screen').hidden=false; }
async function boot(){
 try { const d=await api('/api/admin/session'); state.csrf=d.csrfToken; adminView(); await load(); }
 catch { loginView(); }
}
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault(); const b=$('#login-submit'); b.disabled=true; message('#login-notice','');
 try { const d=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})}); state.csrf=d.csrfToken; $('#password').value=''; adminView(); await load(); }
 catch(err){ message('#login-notice',err.message); }
 finally { b.disabled=false; b.innerHTML='تسجيل الدخول <span>←</span>'; }
});
async function load(){
 $('#posts-table').innerHTML='<tr><td colspan="5" class="empty-cell">دا نحمل المشاركات...</td></tr>';
 try { const d=await api('/api/admin/posts'); state.posts=d.items||[]; render(); }
 catch(err){ message('#list-notice',err.message); $('#posts-table').innerHTML='<tr><td colspan="5" class="empty-cell">تعذّر تحميل المشاركات.</td></tr>'; }
}
function render(){
 const q=state.search.toLowerCase();
 const items=state.posts.filter(p=>(state.filter==='all'||p.status===state.filter)&&(!q||[p.title,p.slug,p.category].some(v=>String(v||'').toLowerCase().includes(q))));
 $('#stat-all').textContent=state.posts.length; $('#stat-published').textContent=state.posts.filter(p=>p.status==='published').length;
 $('#stat-drafts').textContent=state.posts.filter(p=>p.status==='draft').length; $('#nav-count').textContent=state.posts.length;
 $('#list-count').textContent=items.length+' مشاركة';
 if(!items.length){$('#posts-table').innerHTML='<tr><td colspan="5" class="empty-cell">ماكو مشاركات بهالنتائج. أنشئ أول مشاركة من الزر أعلاه.</td></tr>';return;}
 $('#posts-table').innerHTML=items.map(p=>'<tr><td><div class="post-name"><div class="post-thumb">'+(p.coverImage?'<img src="'+esc(p.coverImage)+'" alt="">':esc((p.title||'م')[0]))+'</div><div><strong>'+esc(p.title)+'</strong><small>/'+esc(p.slug)+'</small></div></div></td><td>'+esc(p.category||'بدون تصنيف')+'</td><td><span class="status-pill '+esc(p.status)+'">'+(p.status==='published'?'منشورة':'مسودة')+'</span></td><td>'+new Date(p.updatedAt).toLocaleDateString('ar-IQ')+'</td><td><div class="row-actions"><button data-edit="'+esc(p.id)+'">تعديل</button><button class="delete-btn" data-delete="'+esc(p.id)+'">حذف</button></div></td></tr>').join('');
}
function editor(p=null){
 state.editing=p?String(p.id):null; $('#editor-title').textContent=p?'تعديل المشاركة':'مشاركة جديدة';
 $('#post-id').value=p?.id||''; $('#post-title').value=p?.title||''; $('#post-slug').value=p?.slug||'';
 $('#post-category').value=p?.category||''; $('#post-excerpt').value=p?.excerpt||''; $('#post-cover').value=p?.coverImage||'';
 $('#post-content').value=p?.content||''; $('#post-status').value=p?.status||'draft'; message('#editor-notice','');
 $('#save-post').disabled=false; $('#editor-modal').hidden=false; document.body.style.overflow='hidden'; $('#post-title').focus();
}
function closeEditor(){ $('#editor-modal').hidden=true; document.body.style.overflow=''; state.editing=null; }
$('#new-post').addEventListener('click',()=>editor());
$('#close-editor').addEventListener('click',closeEditor); $('#cancel-editor').addEventListener('click',closeEditor);
$('#editor-modal').addEventListener('click',e=>{if(e.target===$('#editor-modal'))closeEditor();});
$('#post-title').addEventListener('input',()=>{if(!state.editing&&!$('#post-slug').dataset.edited)$('#post-slug').value=$('#post-title').value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');});
$('#post-slug').addEventListener('input',()=>$('#post-slug').dataset.edited='1');
$('#post-form').addEventListener('submit',async e=>{
 e.preventDefault(); const b=$('#save-post'); b.disabled=true; b.textContent='دا نحفظ...';
 const p={title:$('#post-title').value,slug:$('#post-slug').value,category:$('#post-category').value,excerpt:$('#post-excerpt').value,coverImage:$('#post-cover').value,content:$('#post-content').value,status:$('#post-status').value};
 try { await api(state.editing?'/api/admin/posts/'+encodeURIComponent(state.editing):'/api/admin/posts',{method:state.editing?'PUT':'POST',body:JSON.stringify(p)}); closeEditor(); await load(); message('#toast','تم حفظ المشاركة.'); $('#toast').hidden=false; setTimeout(()=>$('#toast').hidden=true,2500); }
 catch(err){message('#editor-notice',err.message);}
 finally{b.disabled=false;b.textContent='حفظ المشاركة';}
});
$('#posts-table').addEventListener('click',async e=>{
 const edit=e.target.closest('[data-edit]'); if(edit){const p=state.posts.find(x=>String(x.id)===edit.dataset.edit);if(p)editor(p);return;}
 const del=e.target.closest('[data-delete]'); if(del){const p=state.posts.find(x=>String(x.id)===del.dataset.delete);if(!p||!confirm('متأكد تريد حذف المشاركة «'+p.title+'»؟'))return;
 try{await api('/api/admin/posts/'+encodeURIComponent(p.id),{method:'DELETE'});await load();}catch(err){message('#list-notice',err.message);}}
});
$('#post-search').addEventListener('input',()=>{state.search=$('#post-search').value;render();});
$('#status-filter').addEventListener('change',()=>{state.filter=$('#status-filter').value;render();});
$('#logout-btn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});}catch{}loginView();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#editor-modal').hidden)closeEditor();});
boot();
})();