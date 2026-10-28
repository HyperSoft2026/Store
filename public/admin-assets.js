(() => {
'use strict';
const $ = s => document.querySelector(s);
const slugify = window.StoreAdminUtils.slugify;
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

const adminData = { products: [], categories: [], view: 'posts' };
function notice(id, text) { message(id, text); }
function setAdminView(view) {
  adminData.view = view;
  document.querySelectorAll('.workspace > .topbar, .workspace > .stats-row, .workspace > .content-panel').forEach(el => { el.hidden = view !== 'posts'; });
  $('#products-view').hidden = view !== 'products';
  $('#categories-view').hidden = view !== 'categories';
  document.querySelectorAll('[data-admin-view]').forEach(el => el.classList.toggle('active', el.dataset.adminView === view));
  if (view === 'products') { loadProducts(); loadCategories(); }
  if (view === 'categories') loadCategories();
}
document.querySelectorAll('[data-admin-view]').forEach(el => el.addEventListener('click', () => setAdminView(el.dataset.adminView)));
async function loadCategories() {
  try {
    const d = await api('/api/admin/categories');
    adminData.categories = d.items || [];
    $('#categories-nav-count').textContent = adminData.categories.length;
    const select = $('#product-category');
    const selected = select.value;
    select.innerHTML = '<option value="">بدون قسم</option>' + adminData.categories.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
    if (adminData.categories.some(c => String(c.id) === selected)) select.value = selected;
    $('#categories-table').innerHTML = adminData.categories.length ? adminData.categories.map(c => '<tr><td><strong>' + esc(c.name) + '</strong><br><small>' + esc(c.description || '') + '</small></td><td>' + esc(c.slug) + '</td><td>' + esc(c.product_count) + '</td><td><div class="row-actions"><button data-category-edit="' + esc(c.id) + '">تعديل</button><button class="delete-btn" data-category-delete="' + esc(c.id) + '">حذف</button></div></td></tr>').join('') : '<tr><td colspan="4" class="empty-cell">ماكو أقسام بعد. أضف أول قسم من النموذج.</td></tr>';
  } catch (err) { notice('#categories-notice', err.message); }
}
async function loadProducts() {
  $('#products-table').innerHTML = '<tr><td colspan="5" class="empty-cell">دا نحمل المنتجات...</td></tr>';
  try {
    const d = await api('/api/admin/products');
    adminData.products = d.items || [];
    $('#products-nav-count').textContent = adminData.products.length;
    renderProducts();
  } catch (err) {
    notice('#products-notice', err.message);
    $('#products-table').innerHTML = '<tr><td colspan="5" class="empty-cell">تعذّر تحميل المنتجات.</td></tr>';
  }
}
function renderProducts() {
  const q = ($('#product-search').value || '').toLowerCase();
  const items = adminData.products.filter(p => [p.name,p.slug,p.developer,p.categoryName].some(v => String(v || '').toLowerCase().includes(q)));
  $('#products-table').innerHTML = items.length ? items.map(p => '<tr><td><strong>' + esc(p.name) + '</strong><br><small>/' + esc(p.slug) + '</small></td><td>' + esc(p.categoryName || 'بدون قسم') + '</td><td><span class="status-pill ' + (p.published ? 'published' : 'draft') + '">' + (p.published ? 'منشور' : 'مسودة') + '</span></td><td>' + esc(p.downloads || 0) + '</td><td><div class="row-actions"><button data-product-edit="' + esc(p.id) + '">تعديل</button><button class="delete-btn" data-product-delete="' + esc(p.id) + '">حذف</button></div></td></tr>').join('') : '<tr><td colspan="5" class="empty-cell">ماكو منتجات مطابقة.</td></tr>';
}
function resetProductForm() {
  $('#product-form').reset(); $('#product-id').value = ''; $('#product-editor-title').textContent = 'إضافة منتج';
  $('#product-editor-notice').hidden = true; $('#product-save').disabled = false;
}
function editProduct(p) {
  $('#product-id').value = p.id; $('#product-name').value = p.name || ''; $('#product-slug').value = p.slug || '';
  $('#product-category').value = p.categoryId || ''; $('#product-developer').value = p.developer || '';
  $('#product-short').value = p.shortDescription || ''; $('#product-description').value = p.description || '';
  $('#product-image').value = p.imageUrl || ''; $('#product-download').value = p.downloadUrl || '';
  $('#product-version').value = p.version || ''; $('#product-size').value = p.fileSize || '';
  $('#product-rating').value = p.rating == null ? '' : p.rating;
  $('#product-featured').checked = !!p.featured; $('#product-published').checked = !!p.published;
  $('#product-editor-title').textContent = 'تعديل المنتج'; $('#product-editor-notice').hidden = true;
  setAdminView('products'); $('#product-name').focus();
}
$('#new-product').addEventListener('click', () => { resetProductForm(); $('#product-name').focus(); });
$('#product-cancel').addEventListener('click', resetProductForm);
$('#product-name').addEventListener('input', () => { if (!$('#product-id').value && !$('#product-slug').dataset.edited) $('#product-slug').value = slugify($('#product-name').value); });
$('#product-slug').addEventListener('input', () => { $('#product-slug').dataset.edited = '1'; });
$('#product-search').addEventListener('input', renderProducts);
$('#product-form').addEventListener('submit', async e => {
  e.preventDefault(); const id = $('#product-id').value;
  const p = { name: $('#product-name').value, slug: $('#product-slug').value, categoryId: $('#product-category').value || null,
    developer: $('#product-developer').value, shortDescription: $('#product-short').value, description: $('#product-description').value,
    imageUrl: $('#product-image').value, downloadUrl: $('#product-download').value, version: $('#product-version').value,
    fileSize: $('#product-size').value, rating: $('#product-rating').value === '' ? null : Number($('#product-rating').value),
    featured: $('#product-featured').checked, published: $('#product-published').checked };
  const b = $('#product-save'); b.disabled = true; b.textContent = 'دا نحفظ...';
  try { await api(id ? '/api/admin/products/' + encodeURIComponent(id) : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(p) }); resetProductForm(); await loadProducts(); notice('#products-notice', 'تم حفظ المنتج.'); }
  catch (err) { notice('#product-editor-notice', err.message); }
  finally { b.disabled = false; b.textContent = 'حفظ المنتج'; }
});
$('#products-table').addEventListener('click', async e => {
  const edit = e.target.closest('[data-product-edit]');
  if (edit) { const p = adminData.products.find(x => String(x.id) === edit.dataset.productEdit); if (p) editProduct(p); return; }
  const del = e.target.closest('[data-product-delete]');
  if (del) { const p = adminData.products.find(x => String(x.id) === del.dataset.productDelete); if (!p || !confirm('متأكد تريد حذف المنتج «' + p.name + '»؟')) return;
    try { await api('/api/admin/products/' + encodeURIComponent(p.id), { method: 'DELETE' }); await loadProducts(); } catch (err) { notice('#products-notice', err.message); } }
});
function resetCategoryForm() { $('#category-form').reset(); $('#category-id').value = ''; $('#category-editor-title').textContent = 'إضافة قسم'; $('#category-notice').hidden = true; }
$('#category-name').addEventListener('input', () => { if (!$('#category-id').value && !$('#category-slug').dataset.edited) $('#category-slug').value = slugify($('#category-name').value); });
$('#category-slug').addEventListener('input', () => { $('#category-slug').dataset.edited = '1'; });
$('#category-cancel').addEventListener('click', resetCategoryForm);
$('#category-form').addEventListener('submit', async e => {
  e.preventDefault(); const id = $('#category-id').value;
  const c = { name: $('#category-name').value, slug: $('#category-slug').value, description: $('#category-description').value };
  try { await api(id ? '/api/admin/categories/' + encodeURIComponent(id) : '/api/admin/categories', { method: id ? 'PUT' : 'POST', body: JSON.stringify(c) }); resetCategoryForm(); await loadCategories(); await loadProducts(); notice('#category-notice', 'تم حفظ القسم.'); }
  catch (err) { notice('#category-notice', err.message); }
});
$('#categories-table').addEventListener('click', async e => {
  const edit = e.target.closest('[data-category-edit]');
  if (edit) { const c = adminData.categories.find(x => String(x.id) === edit.dataset.categoryEdit); if (!c) return; $('#category-id').value = c.id; $('#category-name').value = c.name; $('#category-slug').value = c.slug; $('#category-description').value = c.description || ''; $('#category-editor-title').textContent = 'تعديل القسم'; return; }
  const del = e.target.closest('[data-category-delete]');
  if (del) { const c = adminData.categories.find(x => String(x.id) === del.dataset.categoryDelete); if (!c || !confirm('متأكد تريد حذف القسم «' + c.name + '»؟ ستبقى المنتجات بدون قسم.')) return;
    try { await api('/api/admin/categories/' + encodeURIComponent(c.id), { method: 'DELETE' }); await loadCategories(); await loadProducts(); } catch (err) { notice('#category-notice', err.message); } }
});

boot();
})();