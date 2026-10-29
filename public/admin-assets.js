(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const slugify = (window.StoreAdminUtils && window.StoreAdminUtils.slugify) || (v => String(v || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 160));

const state = {
  csrf: '',
  posts: [],
  categories: [],
  view: 'posts',
  editing: null,
  filter: 'all',
  typeFilter: 'all',
  search: '',
  selectedCategories: [],
  screenshots: [],
  blocks: [],
  apkUrl: ''
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function message(id, text) {
  const n = $(id);
  if (!n) return;
  n.textContent = text;
  n.hidden = !text;
}

function showToast(text) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3000);
}

async function api(url, opts = {}) {
  const headers = {
    Accept: 'application/json',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {})
  };
  if (state.csrf && opts.method && opts.method !== 'GET') {
    headers['X-CSRF-Token'] = state.csrf;
  }
  const r = await fetch(url, { credentials: 'same-origin', ...opts, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'صار خطأ غير متوقع. حاول مرة ثانية.');
  return d;
}

/* File Upload Helper using FileReader and POST /api/admin/upload */
async function uploadFile(file) {
  if (!file) throw new Error('لم يتم تحديد ملف.');
  if (file.size > 50 * 1024 * 1024) throw new Error('حجم الملف كبير جداً (الحد الأقصى 50 ميجابايت).');

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await api('/api/admin/upload', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      dataBase64: base64,
      mimeType: file.type
    })
  });
  return res;
}

/* View State Management */
function loginView() {
  $('#login-screen').hidden = false;
  $('#admin-screen').hidden = true;
  state.csrf = '';
}

function adminView() {
  $('#login-screen').hidden = true;
  $('#admin-screen').hidden = false;
}

/* Navigation Drawer Controls */
function openSidebar() {
  const sb = $('#admin-sidebar');
  const overlay = $('#admin-nav-overlay');
  const toggle = $('#admin-menu-toggle');
  if (sb) sb.classList.add('open');
  if (overlay) overlay.hidden = false;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  const sb = $('#admin-sidebar');
  const overlay = $('#admin-nav-overlay');
  const toggle = $('#admin-menu-toggle');
  if (sb) sb.classList.remove('open');
  if (overlay) overlay.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

$('#admin-menu-toggle')?.addEventListener('click', () => {
  const sb = $('#admin-sidebar');
  if (sb?.classList.contains('open')) closeSidebar();
  else openSidebar();
});
$('#admin-sidebar-close')?.addEventListener('click', closeSidebar);
$('#admin-nav-overlay')?.addEventListener('click', closeSidebar);

function setView(view) {
  state.view = view;
  const postsView = $('#posts-view');
  const catView = $('#categories-view');
  const topbarH1 = $('#workspace-title');
  const eyebrow = $('#workspace-eyebrow');
  const newPostBtn = $('#new-post');

  if (view === 'posts') {
    if (postsView) postsView.hidden = false;
    if (catView) catView.hidden = true;
    if (topbarH1) topbarH1.textContent = 'إدارة التطبيقات والألعاب';
    if (eyebrow) eyebrow.textContent = 'لوحة التحكم / التطبيقات والألعاب';
    if (newPostBtn) newPostBtn.hidden = false;
  } else if (view === 'categories') {
    if (postsView) postsView.hidden = true;
    if (catView) catView.hidden = false;
    if (topbarH1) topbarH1.textContent = 'إدارة الأقسام والتصنيفات';
    if (eyebrow) eyebrow.textContent = 'لوحة التحكم / الأقسام';
    if (newPostBtn) newPostBtn.hidden = true;
    loadCategories();
  }

  $$('[data-admin-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminView === view);
  });
  closeSidebar();
}

$$('[data-admin-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.adminView));
});

/* Boot and Authentication */
async function boot() {
  try {
    const d = await api('/api/admin/session');
    state.csrf = d.csrfToken;
    adminView();
    await Promise.all([loadPosts(), loadCategories()]);
  } catch {
    loginView();
  }
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#login-submit');
  b.disabled = true;
  message('#login-notice', '');
  try {
    const d = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#username').value,
        password: $('#password').value
      })
    });
    state.csrf = d.csrfToken;
    $('#password').value = '';
    adminView();
    await Promise.all([loadPosts(), loadCategories()]);
  } catch (err) {
    message('#login-notice', err.message);
  } finally {
    b.disabled = false;
    b.innerHTML = 'تسجيل الدخول <span>←</span>';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch {}
  loginView();
});

/* Categories Management */
async function loadCategories() {
  try {
    const d = await api('/api/admin/categories');
    state.categories = d.items || [];
    $('#categories-nav-count').textContent = state.categories.length;
    renderCategoriesTable();
  } catch (err) {
    message('#categories-notice', err.message);
  }
}

function renderCategoriesTable() {
  const tbody = $('#categories-table');
  if (!tbody) return;
  if (!state.categories.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">ماكو أقسام بعد. أضف أول قسم من النموذج أعلاه.</td></tr>';
    return;
  }
  tbody.innerHTML = state.categories.map(c => `
    <tr>
      <td><strong>${esc(c.name)}</strong><br><small>${esc(c.description || '')}</small></td>
      <td><code>${esc(c.slug)}</code></td>
      <td>${esc(c.product_count || 0)}</td>
      <td>
        <div class="row-actions">
          <button data-cat-edit="${esc(c.id)}">تعديل</button>
          <button class="delete-btn" data-cat-delete="${esc(c.id)}">حذف</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function resetCategoryForm() {
  $('#category-form').reset();
  $('#category-id').value = '';
  $('#category-editor-title').textContent = 'إضافة قسم جديد';
  message('#category-notice', '');
}
$('#category-cancel')?.addEventListener('click', resetCategoryForm);
$('#category-name')?.addEventListener('input', () => {
  if (!$('#category-id').value && !$('#category-slug').dataset.edited) {
    $('#category-slug').value = slugify($('#category-name').value);
  }
});
$('#category-slug')?.addEventListener('input', () => { $('#category-slug').dataset.edited = '1'; });

$('#category-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#category-id').value;
  const payload = {
    name: $('#category-name').value,
    slug: $('#category-slug').value,
    description: $('#category-description').value
  };
  try {
    await api(id ? `/api/admin/categories/${encodeURIComponent(id)}` : '/api/admin/categories', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    resetCategoryForm();
    await loadCategories();
    showToast('تم حفظ القسم بنجاح.');
  } catch (err) {
    message('#category-notice', err.message);
  }
});

$('#categories-table')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('[data-cat-edit]');
  if (editBtn) {
    const c = state.categories.find(x => String(x.id) === editBtn.dataset.catEdit);
    if (!c) return;
    $('#category-id').value = c.id;
    $('#category-name').value = c.name;
    $('#category-slug').value = c.slug;
    $('#category-description').value = c.description || '';
    $('#category-editor-title').textContent = 'تعديل القسم';
    $('#category-name').focus();
    return;
  }
  const delBtn = e.target.closest('[data-cat-delete]');
  if (delBtn) {
    const c = state.categories.find(x => String(x.id) === delBtn.dataset.catDelete);
    if (!c || !confirm(`متأكد تريد حذف القسم «${c.name}»؟`)) return;
    try {
      await api(`/api/admin/categories/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      await loadCategories();
      showToast('تم حذف القسم.');
    } catch (err) {
      message('#categories-notice', err.message);
    }
  }
});

/* Unified Posts / Apps Catalog */
async function loadPosts() {
  const tbody = $('#posts-table');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">دا نحمل التطبيقات والمشاركات...</td></tr>';
  try {
    const d = await api('/api/admin/posts');
    state.posts = d.items || [];
    renderPosts();
  } catch (err) {
    message('#list-notice', err.message);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">تعذّر تحميل التطبيقات.</td></tr>';
  }
}

function renderPosts() {
  const q = state.search.toLowerCase();
  const items = state.posts.filter(p => {
    if (state.filter !== 'all' && p.status !== state.filter) return false;
    if (state.typeFilter !== 'all' && (p.type || 'app') !== state.typeFilter) return false;
    if (!q) return true;
    return [p.title, p.slug, p.category, p.developer].some(v => String(v || '').toLowerCase().includes(q));
  });

  $('#stat-all').textContent = state.posts.length;
  $('#stat-published').textContent = state.posts.filter(p => p.status === 'published').length;
  $('#stat-drafts').textContent = state.posts.filter(p => p.status === 'draft').length;
  $('#nav-count').textContent = state.posts.length;
  $('#list-count').textContent = `${items.length} تطبيق / مشاركة`;

  const tbody = $('#posts-table');
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">ماكو تطبيقات أو ألعاب مطابقة. انقر فوق «＋ إضافة تطبيق / لعبة جديدة» لإضافة عنصر جديد.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(p => {
    const isGame = p.type === 'game';
    const typeLabel = isGame ? '🎮 لعبة' : '📱 تطبيق';
    const typeClass = isGame ? 'game' : 'app';
    const thumbImg = p.iconUrl || p.coverImage;
    const cats = Array.isArray(p.categories) && p.categories.length ? p.categories.join('، ') : (p.category || 'بدون قسم');
    const ratingDisplay = p.rating != null ? `⭐ ${Number(p.rating).toFixed(1)}` : '—';
    const statusText = p.status === 'published' ? 'منشور' : 'مسودة';

    return `
      <tr>
        <td>
          <div class="post-name">
            <div class="post-thumb">
              ${thumbImg ? `<img src="${esc(thumbImg)}" alt="" onerror="this.remove()">` : esc((p.title || 'S')[0])}
            </div>
            <div>
              <strong>${esc(p.title)}</strong>
              ${p.featured ? '<span class="status-pill published" style="font-size:9px;padding:2px 6px">مميّز</span>' : ''}
              <small>/${esc(p.slug)}</small>
            </div>
          </div>
        </td>
        <td><span class="type-badge ${typeClass}">${typeLabel}</span></td>
        <td><small>${esc(cats)}</small></td>
        <td><strong>${ratingDisplay}</strong></td>
        <td>${esc(p.downloads || 0)}</td>
        <td><span class="status-pill ${esc(p.status)}">${statusText}</span></td>
        <td>${new Date(p.updatedAt || p.createdAt).toLocaleDateString('ar-IQ')}</td>
        <td>
          <div class="row-actions">
            <button data-post-edit="${esc(p.id)}">تعديل</button>
            <button class="delete-btn" data-post-delete="${esc(p.id)}">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

$('#post-search')?.addEventListener('input', e => {
  state.search = e.target.value;
  renderPosts();
});
$('#post-type-filter')?.addEventListener('change', e => {
  state.typeFilter = e.target.value;
  renderPosts();
});
$('#status-filter')?.addEventListener('change', e => {
  state.filter = e.target.value;
  renderPosts();
});

/* App / Game Publishing Form & Editor */
function updateIconPreview(url) {
  const box = $('#post-icon-preview');
  if (!box) return;
  if (url) {
    box.innerHTML = `<img src="${esc(url)}" alt="معاينة الأيقونة">`;
  } else {
    box.innerHTML = '<span class="preview-placeholder">معاينة الأيقونة (1:1)</span>';
  }
}

function updateCoverPreview(url) {
  const box = $('#post-cover-preview');
  if (!box) return;
  if (url) {
    box.innerHTML = `<img src="${esc(url)}" alt="معاينة الغلاف">`;
  } else {
    box.innerHTML = '<span class="preview-placeholder">معاينة صورة الغلاف (2:1)</span>';
  }
}

function renderCategoryChips() {
  const container = $('#post-categories-chips');
  if (!container) return;
  if (!state.selectedCategories.length) {
    container.innerHTML = '<span class="preview-placeholder">لم يتم اختيار أقسام بعد. ابحث أدناه لاختيار قسم.</span>';
  } else {
    container.innerHTML = state.selectedCategories.map((cat, idx) => `
      <span class="chip">
        ${esc(cat)}
        <button type="button" class="chip-remove" data-cat-idx="${idx}" title="إزالة القسم">✕</button>
      </span>
    `).join('');
  }
  $('#post-categories-json').value = JSON.stringify(state.selectedCategories);
  $('#post-category').value = state.selectedCategories[0] || '';
}

function renderScreenshotsList() {
  const list = $('#post-screenshots-list');
  if (!list) return;
  if (!state.screenshots.length) {
    list.innerHTML = '<p class="empty-list-note">لم يتم إضافة لقطات شاشة بعد.</p>';
    return;
  }
  list.innerHTML = state.screenshots.map((url, idx) => `
    <div class="screenshot-card" data-shot-idx="${idx}">
      <div class="screenshot-thumb">
        <img src="${esc(url)}" alt="لقطة ${idx + 1}" onerror="this.remove()">
      </div>
      <div class="screenshot-controls">
        <button type="button" class="screenshot-btn" data-shot-move="up" data-shot-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="تحريك لأعلى">⬆</button>
        <button type="button" class="screenshot-btn" data-shot-move="down" data-shot-idx="${idx}" ${idx === state.screenshots.length - 1 ? 'disabled' : ''} title="تحريك لأسفل">⬇</button>
        <button type="button" class="screenshot-btn delete-btn" data-shot-move="del" data-shot-idx="${idx}" title="حذف">✕</button>
      </div>
    </div>
  `).join('');
}

/* Block-Based Editor Logic */
function renderBlocks() {
  const container = $('#editor-blocks-container');
  if (!container) return;
  if (!state.blocks.length) {
    container.innerHTML = '<p class="empty-list-note" style="padding:10px;text-align:center">لا توجد كتل وصف حتى الآن. أضف عنواناً أو فقرة أو صورة من شريط الأدوات أعلاه.</p>';
  } else {
    container.innerHTML = state.blocks.map((block, idx) => {
      let blockBody = '';
      if (block.type === 'h2') {
        blockBody = `<input type="text" class="block-input" data-block-id="${block.id}" data-block-field="text" value="${esc(block.text)}" placeholder="اكتب العنوان الرئيسي هنا...">`;
      } else if (block.type === 'h3') {
        blockBody = `<input type="text" class="block-input" data-block-id="${block.id}" data-block-field="text" value="${esc(block.text)}" placeholder="اكتب العنوان الفرعي هنا...">`;
      } else if (block.type === 'p') {
        blockBody = `<textarea rows="3" class="block-input" data-block-id="${block.id}" data-block-field="text" placeholder="اكتب نص الفقرة...">${esc(block.text)}</textarea>`;
      } else if (block.type === 'image') {
        blockBody = `
          <div class="upload-row" style="margin-bottom:6px">
            <input type="url" class="block-input" data-block-id="${block.id}" data-block-field="url" value="${esc(block.url)}" placeholder="رابط الصورة أو ارفع من جهازك...">
            <label class="file-btn small-btn">
              📁 رفع
              <input type="file" accept="image/*" class="sr-only block-img-file" data-block-id="${block.id}">
            </label>
          </div>
          <input type="text" class="block-input" data-block-id="${block.id}" data-block-field="caption" value="${esc(block.caption || '')}" placeholder="كابشن أو تعليق اختياري أسفل الصورة...">
          ${block.url ? `<div style="margin-top:6px;max-width:200px"><img src="${esc(block.url)}" style="width:100%;border-radius:6px"></div>` : ''}
        `;
      } else if (block.type === 'video') {
        blockBody = `
          <input type="url" class="block-input" data-block-id="${block.id}" data-block-field="url" value="${esc(block.url)}" placeholder="رابط فيديو MP4 مباشر أو رابط يوتيوب (YouTube)...">
          <input type="text" class="block-input" style="margin-top:6px" data-block-id="${block.id}" data-block-field="caption" value="${esc(block.caption || '')}" placeholder="عنوان أو تعليق على الفيديو...">
        `;
      }

      const align = block.align || 'right';
      const color = block.color || '#171a18';
      const labelMap = { h2: 'عنوان رئيسي H2', h3: 'عنوان فرعي H3', p: 'فقرة نصية P', image: 'صورة توضيحية', video: 'فيديو' };

      return `
        <div class="block-item" data-block-idx="${idx}">
          <div class="block-head">
            <span class="block-type-tag">${labelMap[block.type] || block.type}</span>
            <div class="block-actions">
              <span class="block-color-picker" title="لون النص">
                <input type="color" class="block-color-input" data-block-id="${block.id}" value="${color}" style="width:24px;height:24px;border:0;padding:0;cursor:pointer;background:none">
              </span>
              <button type="button" class="align-btn ${align === 'right' ? 'active' : ''}" data-block-id="${block.id}" data-align="right" title="محاذاة يمين">يمين</button>
              <button type="button" class="align-btn ${align === 'center' ? 'active' : ''}" data-block-id="${block.id}" data-align="center" title="محاذاة وسط">وسط</button>
              <button type="button" class="align-btn ${align === 'left' ? 'active' : ''}" data-block-id="${block.id}" data-align="left" title="محاذاة يسار">يسار</button>
              <button type="button" data-block-move="up" data-block-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="تحريك لأعلى">⬆</button>
              <button type="button" data-block-move="down" data-block-idx="${idx}" ${idx === state.blocks.length - 1 ? 'disabled' : ''} title="تحريك لأسفل">⬇</button>
              <button type="button" class="del-btn" data-block-del="${block.id}" title="حذف الكتلة">✕</button>
            </div>
          </div>
          <div class="block-body" style="text-align:${align};color:${color}">
            ${blockBody}
          </div>
        </div>
      `;
    }).join('');
  }
  renderLivePreview();
}

function renderLivePreview() {
  const pane = $('#blocks-preview-pane');
  if (!pane || pane.hidden) return;
  if (!state.blocks.length) {
    pane.innerHTML = '<p class="muted">أضف كتل في المحرر لمشاهدة المعاينة المباشرة هنا.</p>';
    return;
  }
  pane.innerHTML = state.blocks.map(b => {
    const align = b.align || 'right';
    const color = b.color ? `color:${b.color};` : '';
    const style = `text-align:${align};${color}`;
    if (b.type === 'h2') return `<h2 style="${style}">${esc(b.text || '')}</h2>`;
    if (b.type === 'h3') return `<h3 style="${style}">${esc(b.text || '')}</h3>`;
    if (b.type === 'p') return `<p style="${style}">${esc(b.text || '').replace(/\n/g, '<br>')}</p>`;
    if (b.type === 'image') {
      return `
        <figure style="text-align:${align};margin:12px 0">
          <img src="${esc(b.url || '')}" alt="${esc(b.caption || '')}">
          ${b.caption ? `<figcaption style="font-size:11px;color:#66716a;margin-top:4px">${esc(b.caption)}</figcaption>` : ''}
        </figure>
      `;
    }
    if (b.type === 'video') {
      const url = b.url || '';
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const id = url.includes('youtu.be') ? url.split('/').pop() : new URL(url).searchParams.get('v');
        return `<div style="text-align:${align};margin:12px 0"><iframe width="100%" height="315" src="https://www.youtube.com/embed/${esc(id)}" frameborder="0" allowfullscreen style="border-radius:10px"></iframe></div>`;
      }
      return `<div style="text-align:${align};margin:12px 0"><video controls src="${esc(url)}" style="max-width:100%;border-radius:10px"></video></div>`;
    }
    return '';
  }).join('');
}

$('#toggle-blocks-preview')?.addEventListener('click', () => {
  const pane = $('#blocks-preview-pane');
  if (!pane) return;
  pane.hidden = !pane.hidden;
  if (!pane.hidden) renderLivePreview();
});

function addBlock(type) {
  const newBlock = {
    id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    type,
    text: '',
    color: '#171a18',
    align: 'right',
    url: '',
    caption: ''
  };
  state.blocks.push(newBlock);
  renderBlocks();
}

$('#add-block-h2')?.addEventListener('click', () => addBlock('h2'));
$('#add-block-h3')?.addEventListener('click', () => addBlock('h3'));
$('#add-block-p')?.addEventListener('click', () => addBlock('p'));
$('#add-block-image')?.addEventListener('click', () => addBlock('image'));
$('#add-block-video')?.addEventListener('click', () => addBlock('video'));

$('#editor-blocks-container')?.addEventListener('input', e => {
  const input = e.target.closest('.block-input');
  if (input) {
    const block = state.blocks.find(b => b.id === input.dataset.blockId);
    if (block) {
      block[input.dataset.blockField] = input.value;
      renderLivePreview();
    }
  }
  const colorInput = e.target.closest('.block-color-input');
  if (colorInput) {
    const block = state.blocks.find(b => b.id === colorInput.dataset.blockId);
    if (block) {
      block.color = colorInput.value;
      const body = colorInput.closest('.block-item').querySelector('.block-body');
      if (body) body.style.color = colorInput.value;
      renderLivePreview();
    }
  }
});

$('#editor-blocks-container')?.addEventListener('change', async e => {
  const fileInput = e.target.closest('.block-img-file');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    try {
      const res = await uploadFile(fileInput.files[0]);
      const block = state.blocks.find(b => b.id === fileInput.dataset.blockId);
      if (block) {
        block.url = res.url;
        renderBlocks();
        showToast('تم رفع صورة الكتلة بنجاح.');
      }
    } catch (err) {
      alert(err.message);
    }
  }
});

$('#editor-blocks-container')?.addEventListener('click', e => {
  const delBtn = e.target.closest('[data-block-del]');
  if (delBtn) {
    state.blocks = state.blocks.filter(b => b.id !== delBtn.dataset.blockDel);
    renderBlocks();
    return;
  }
  const moveBtn = e.target.closest('[data-block-move]');
  if (moveBtn) {
    const idx = Number(moveBtn.dataset.blockIdx);
    const dir = moveBtn.dataset.blockMove;
    if (dir === 'up' && idx > 0) {
      const temp = state.blocks[idx];
      state.blocks[idx] = state.blocks[idx - 1];
      state.blocks[idx - 1] = temp;
      renderBlocks();
    } else if (dir === 'down' && idx < state.blocks.length - 1) {
      const temp = state.blocks[idx];
      state.blocks[idx] = state.blocks[idx + 1];
      state.blocks[idx + 1] = temp;
      renderBlocks();
    }
    return;
  }
  const alignBtn = e.target.closest('.align-btn');
  if (alignBtn) {
    const block = state.blocks.find(b => b.id === alignBtn.dataset.blockId);
    if (block) {
      block.align = alignBtn.dataset.align;
      renderBlocks();
    }
  }
});

/* Modal Open & Reset */
function openPostEditor(p = null) {
  state.editing = p ? String(p.id) : null;
  $('#editor-title').textContent = p ? 'تعديل التطبيق أو اللعبة' : 'إضافة تطبيق أو لعبة جديدة';
  $('#post-id').value = p?.id || '';
  $('#post-title').value = p?.title || '';
  $('#post-slug').value = p?.slug || '';
  $('#post-type').value = p?.type || 'app';
  $('#post-developer').value = p?.developer || '';
  $('#post-version').value = p?.version || '';
  $('#post-size').value = p?.fileSize || '';
  $('#post-rating').value = p?.rating == null ? '' : p.rating;
  $('#post-icon-url').value = p?.iconUrl || '';
  $('#post-cover').value = p?.coverImage || '';
  $('#post-excerpt').value = p?.excerpt || '';
  $('#post-content').value = p?.content || '';
  $('#post-download-url').value = p?.downloadUrl || '';
  $('#post-apk-url').value = p?.apkFileUrl || '';
  $('#post-apk-status').textContent = p?.apkFileUrl ? 'ملف APK محفوظ مسبقاً' : '';
  $('#post-featured').checked = Boolean(p?.featured);
  $('#post-status').value = p?.status || 'published';

  // Categories
  if (Array.isArray(p?.categories)) {
    state.selectedCategories = [...p.categories];
  } else if (p?.category) {
    state.selectedCategories = [p.category];
  } else {
    state.selectedCategories = [];
  }
  renderCategoryChips();

  // Screenshots
  state.screenshots = Array.isArray(p?.screenshots) ? [...p.screenshots] : [];
  renderScreenshotsList();

  // Blocks
  if (Array.isArray(p?.contentBlocks) && p.contentBlocks.length) {
    state.blocks = p.contentBlocks.map(b => ({ ...b, id: b.id || 'b_' + Math.random().toString(36).slice(2, 7) }));
  } else if (p?.content) {
    state.blocks = [{
      id: 'b_init_' + Date.now(),
      type: 'p',
      text: p.content,
      color: '#171a18',
      align: 'right'
    }];
  } else {
    state.blocks = [];
  }
  renderBlocks();

  updateIconPreview(p?.iconUrl || '');
  updateCoverPreview(p?.coverImage || '');

  message('#editor-notice', '');
  $('#save-post').disabled = false;
  $('#editor-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#post-title').focus();
}

function closePostEditor() {
  $('#editor-modal').hidden = true;
  document.body.style.overflow = '';
  state.editing = null;
}

$('#new-post')?.addEventListener('click', () => openPostEditor());
$('#close-editor')?.addEventListener('click', closePostEditor);
$('#cancel-editor')?.addEventListener('click', closePostEditor);
$('#editor-modal')?.addEventListener('click', e => {
  if (e.target === $('#editor-modal')) closePostEditor();
});

/* Live slug generation */
$('#post-title')?.addEventListener('input', () => {
  if (!state.editing && !$('#post-slug').dataset.edited) {
    $('#post-slug').value = slugify($('#post-title').value);
  }
});
$('#post-slug')?.addEventListener('input', () => { $('#post-slug').dataset.edited = '1'; });

/* Icon & Cover file inputs */
$('#post-icon-url')?.addEventListener('input', e => updateIconPreview(e.target.value.trim()));
$('#post-icon-file')?.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const res = await uploadFile(file);
    $('#post-icon-url').value = res.url;
    updateIconPreview(res.url);
    showToast('تم رفع أيقونة التطبيق بنجاح.');
  } catch (err) {
    alert(err.message);
  }
});

$('#post-cover')?.addEventListener('input', e => updateCoverPreview(e.target.value.trim()));
$('#post-cover-file')?.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const res = await uploadFile(file);
    $('#post-cover').value = res.url;
    updateCoverPreview(res.url);
    showToast('تم رفع صورة الغلاف بنجاح.');
  } catch (err) {
    alert(err.message);
  }
});

/* Autocomplete Category Search */
$('#category-search-input')?.addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const dropdown = $('#category-autocomplete-list');
  if (!dropdown) return;
  if (!query) {
    dropdown.hidden = true;
    return;
  }
  const matches = state.categories.filter(c =>
    c.name.toLowerCase().includes(query) && !state.selectedCategories.includes(c.name)
  );
  if (!matches.length) {
    dropdown.innerHTML = '<div class="autocomplete-item muted">لا يوجد قسم مطابق</div>';
  } else {
    dropdown.innerHTML = matches.map(c => `
      <div class="autocomplete-item" data-cat-select="${esc(c.name)}">${esc(c.name)}</div>
    `).join('');
  }
  dropdown.hidden = false;
});

$('#category-autocomplete-list')?.addEventListener('click', e => {
  const item = e.target.closest('[data-cat-select]');
  if (item) {
    const name = item.dataset.catSelect;
    if (!state.selectedCategories.includes(name)) {
      state.selectedCategories.push(name);
      renderCategoryChips();
    }
    $('#category-search-input').value = '';
    $('#category-autocomplete-list').hidden = true;
  }
});

$('#post-categories-chips')?.addEventListener('click', e => {
  const btn = e.target.closest('.chip-remove');
  if (btn) {
    const idx = Number(btn.dataset.catIdx);
    state.selectedCategories.splice(idx, 1);
    renderCategoryChips();
  }
});

// Inline quick category creation
$('#inline-add-cat-btn')?.addEventListener('click', () => {
  const box = $('#inline-cat-box');
  if (box) {
    box.hidden = !box.hidden;
    if (!box.hidden) $('#inline-cat-name').focus();
  }
});
$('#inline-cat-cancel')?.addEventListener('click', () => {
  $('#inline-cat-box').hidden = true;
  $('#inline-cat-name').value = '';
});
$('#inline-cat-save')?.addEventListener('click', async () => {
  const name = $('#inline-cat-name').value.trim();
  if (!name) return;
  const slug = slugify(name);
  try {
    const res = await api('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name, slug, description: '' })
    });
    if (res.item) state.categories.push(res.item);
    if (!state.selectedCategories.includes(name)) {
      state.selectedCategories.push(name);
      renderCategoryChips();
    }
    $('#inline-cat-box').hidden = true;
    $('#inline-cat-name').value = '';
    showToast(`تم إنشاء القسم «${name}» وإضافته.`);
  } catch (err) {
    alert(err.message);
  }
});

/* Screenshots Gallery Handling */
$('#add-screenshot-url-btn')?.addEventListener('click', () => {
  const input = $('#post-screenshot-url');
  const url = input.value.trim();
  if (!url) return;
  state.screenshots.push(url);
  input.value = '';
  renderScreenshotsList();
});

$('#post-screenshots-files')?.addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  for (const file of files) {
    try {
      const res = await uploadFile(file);
      state.screenshots.push(res.url);
    } catch (err) {
      alert(`خطأ في رفع ${file.name}: ${err.message}`);
    }
  }
  renderScreenshotsList();
  showToast(`تم رفع ${files.length} لقطة شاشة.`);
});

$('#post-screenshots-list')?.addEventListener('click', e => {
  const btn = e.target.closest('.screenshot-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.shotIdx);
  const action = btn.dataset.shotMove;
  if (action === 'del') {
    state.screenshots.splice(idx, 1);
    renderScreenshotsList();
  } else if (action === 'up' && idx > 0) {
    const temp = state.screenshots[idx];
    state.screenshots[idx] = state.screenshots[idx - 1];
    state.screenshots[idx - 1] = temp;
    renderScreenshotsList();
  } else if (action === 'down' && idx < state.screenshots.length - 1) {
    const temp = state.screenshots[idx];
    state.screenshots[idx] = state.screenshots[idx + 1];
    state.screenshots[idx + 1] = temp;
    renderScreenshotsList();
  }
});

/* Direct APK file upload */
$('#post-apk-file')?.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusBox = $('#post-apk-status');
  statusBox.textContent = 'جاري رفع ملف APK... يرجى الانتظار';
  try {
    const res = await uploadFile(file);
    $('#post-apk-url').value = res.url;
    const mbSize = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    if (!$('#post-size').value) $('#post-size').value = mbSize;
    statusBox.textContent = `✓ تم رفع ملف APK بنجاح: ${res.fileName} (${mbSize})`;
    showToast('تم رفع ملف APK بنجاح.');
  } catch (err) {
    statusBox.textContent = `فشل الرفع: ${err.message}`;
  }
});

/* Submit Post Form */
$('#post-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#save-post');
  b.disabled = true;
  b.textContent = 'دا نحفظ وننشر...';
  message('#editor-notice', '');

  // Extract raw text from blocks as fallback for search
  const rawContent = state.blocks.map(b => b.text || b.caption || b.url || '').filter(Boolean).join('\n\n');

  const payload = {
    title: $('#post-title').value,
    slug: $('#post-slug').value,
    type: $('#post-type').value,
    developer: $('#post-developer').value,
    version: $('#post-version').value,
    fileSize: $('#post-size').value,
    rating: $('#post-rating').value === '' ? null : Number($('#post-rating').value),
    iconUrl: $('#post-icon-url').value,
    coverImage: $('#post-cover').value,
    category: state.selectedCategories[0] || '',
    categories: state.selectedCategories,
    screenshots: state.screenshots,
    contentBlocks: state.blocks,
    content: rawContent || $('#post-excerpt').value,
    excerpt: $('#post-excerpt').value,
    downloadUrl: $('#post-download-url').value,
    apkFileUrl: $('#post-apk-url').value,
    isFeatured: $('#post-featured').checked,
    status: $('#post-status').value
  };

  try {
    await api(state.editing ? `/api/admin/posts/${encodeURIComponent(state.editing)}` : '/api/admin/posts', {
      method: state.editing ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    closePostEditor();
    await loadPosts();
    showToast('تم حفظ ونشر التغييرات بنجاح!');
  } catch (err) {
    message('#editor-notice', err.message);
  } finally {
    b.disabled = false;
    b.textContent = 'حفظ ونشر التغييرات';
  }
});

/* Table actions: Edit & Delete */
$('#posts-table')?.addEventListener('click', async e => {
  const editBtn = e.target.closest('[data-post-edit]');
  if (editBtn) {
    const p = state.posts.find(x => String(x.id) === editBtn.dataset.postEdit);
    if (p) openPostEditor(p);
    return;
  }
  const delBtn = e.target.closest('[data-post-delete]');
  if (delBtn) {
    const p = state.posts.find(x => String(x.id) === delBtn.dataset.postDelete);
    if (!p || !confirm(`متأكد تريد حذف التطبيق / المشاركة «${p.title}»؟`)) return;
    try {
      await api(`/api/admin/posts/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      await loadPosts();
      showToast('تم حذف العنصر بنجاح.');
    } catch (err) {
      message('#list-notice', err.message);
    }
  }
});

/* Escape key to close modals and sidebar */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#editor-modal').hidden) {
      closePostEditor();
      return;
    }
    const sb = $('#admin-sidebar');
    if (sb?.classList.contains('open')) {
      closeSidebar();
    }
  }
});

boot();
})();