(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const slugify = window.StoreAdminUtils.slugify;
  const state = { csrf: '', posts: [], filter: 'all', search: '' };
  const data = { products: [], categories: [], view: 'posts', toastTimer: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function message(selector, text) {
    const node = $(selector);
    node.textContent = text || '';
    node.hidden = !text;
  }
  async function api(url, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'صار خطأ. جرّب مرة ثانية.');
    return result;
  }
  function toast(text) {
    const node = $('#toast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(data.toastTimer);
    data.toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
  }
  function loginView() {
    $('#login-screen').hidden = false;
    $('#admin-screen').hidden = true;
    state.csrf = '';
    $('#username').focus();
  }
  function adminView() {
    $('#login-screen').hidden = true;
    $('#admin-screen').hidden = false;
  }
  async function boot() {
    try {
      const result = await api('/api/admin/session');
      state.csrf = result.csrfToken || '';
      if (!state.csrf) throw new Error('تعذّر إنشاء جلسة الإدارة.');
      adminView();
      await loadPosts();
    } catch { loginView(); }
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#login-submit');
    button.disabled = true;
    message('#login-notice', '');
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('#username').value, password: $('#password').value })
      });
      state.csrf = result.csrfToken || '';
      $('#password').value = '';
      adminView();
      await loadPosts();
    } catch (error) {
      message('#login-notice', error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = 'تسجيل الدخول <span aria-hidden="true">←</span>';
    }
  });

  async function loadPosts() {
    $('#posts-table').innerHTML = '<tr><td colspan="5" class="empty-cell">دا نحمل المشاركات...</td></tr>';
    message('#list-notice', '');
    try {
      const result = await api('/api/admin/posts');
      state.posts = Array.isArray(result.items) ? result.items : [];
      renderPosts();
    } catch (error) {
      message('#list-notice', error.message);
      $('#posts-table').innerHTML = '<tr><td colspan="5" class="empty-cell">تعذّر تحميل المشاركات. حدّث الصفحة للمحاولة مرة ثانية.</td></tr>';
    }
  }
  function statusLabel(status) {
    return status === 'published' ? 'منشورة' : status === 'archived' ? 'مؤرشفة' : 'مسودة';
  }
  function renderPosts() {
    const query = state.search.toLowerCase();
    const items = state.posts.filter(post => (state.filter === 'all' || post.status === state.filter) && (!query || [post.title, post.slug, post.category].some(value => String(value || '').toLowerCase().includes(query))));
    $('#stat-all').textContent = String(state.posts.length);
    $('#stat-published').textContent = String(state.posts.filter(post => post.status === 'published').length);
    $('#stat-drafts').textContent = String(state.posts.filter(post => post.status === 'draft').length);
    $('#nav-count').textContent = String(state.posts.length);
    $('#list-count').textContent = `${items.length} مشاركة`;
    if (!items.length) {
      $('#posts-table').innerHTML = `<tr><td colspan="5" class="empty-cell">${state.posts.length ? 'ماكو مشاركات مطابقة للفلاتر.' : 'ماكو مشاركات بعد. ابدأ بإنشاء أول مشاركة.'}</td></tr>`;
      return;
    }
    $('#posts-table').innerHTML = items.map(post => {
      const cover = String(post.coverImage || '');
      const thumb = cover ? `<img src="${esc(cover)}" alt="" loading="lazy" onerror="this.remove()">` : esc(Array.from(String(post.title || 'م'))[0] || 'م');
      const date = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString('ar-IQ') : '—';
      return `<tr><td><div class="post-name"><div class="post-thumb">${thumb}</div><div><strong>${esc(post.title)}</strong><small>/${esc(post.slug)}</small></div></div></td><td>${esc(post.category || 'بدون تصنيف')}</td><td><span class="status-pill ${esc(post.status || 'draft')}">${statusLabel(post.status)}</span></td><td>${esc(date)}</td><td><div class="row-actions"><button type="button" data-edit="${esc(post.id)}">تعديل</button><button class="delete-btn" type="button" data-delete="${esc(post.id)}">حذف</button></div></td></tr>`;
    }).join('');
  }
  function openPostEditor(post = null) {
    $('#editor-title').textContent = post ? 'تعديل المشاركة' : 'مشاركة جديدة';
    $('#post-id').value = post?.id || '';
    $('#post-title').value = post?.title || '';
    $('#post-slug').value = post?.slug || '';
    $('#post-slug').dataset.edited = post ? '1' : '';
    $('#post-category').value = post?.category || '';
    $('#post-excerpt').value = post?.excerpt || '';
    $('#post-cover').value = post?.coverImage || '';
    $('#post-content').value = post?.content || '';
    $('#post-status').value = post?.status === 'published' ? 'published' : 'draft';
    message('#editor-notice', '');
    $('#save-post').disabled = false;
    $('#editor-modal').hidden = false;
    document.body.classList.add('modal-open');
    $('#post-title').focus();
  }
  function closePostEditor() {
    $('#editor-modal').hidden = true;
    document.body.classList.remove('modal-open');
  }
  $('#new-post').addEventListener('click', () => openPostEditor());
  $('#close-editor').addEventListener('click', closePostEditor);
  $('#cancel-editor').addEventListener('click', closePostEditor);
  $('#editor-modal').addEventListener('click', event => { if (event.target === $('#editor-modal')) closePostEditor(); });
  $('#post-title').addEventListener('input', () => {
    if (!$('#post-id').value && !$('#post-slug').dataset.edited) $('#post-slug').value = slugify($('#post-title').value);
  });
  $('#post-slug').addEventListener('input', () => { $('#post-slug').dataset.edited = '1'; });
  $('#post-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#save-post');
    const id = $('#post-id').value;
    button.disabled = true;
    button.textContent = 'دا نحفظ...';
    const post = {
      title: $('#post-title').value.trim(),
      slug: $('#post-slug').value.trim(),
      category: $('#post-category').value.trim(),
      excerpt: $('#post-excerpt').value.trim(),
      coverImage: $('#post-cover').value.trim(),
      content: $('#post-content').value,
      status: $('#post-status').value
    };
    try {
      await api(id ? `/api/admin/posts/${encodeURIComponent(id)}` : '/api/admin/posts', { method: id ? 'PUT' : 'POST', body: JSON.stringify(post) });
      closePostEditor();
      await loadPosts();
      toast('تم حفظ المشاركة.');
    } catch (error) {
      message('#editor-notice', error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'حفظ المشاركة';
    }
  });
  $('#posts-table').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) {
      const post = state.posts.find(item => String(item.id) === editButton.dataset.edit);
      if (post) openPostEditor(post);
      return;
    }
    const deleteButton = event.target.closest('[data-delete]');
    if (!deleteButton) return;
    const post = state.posts.find(item => String(item.id) === deleteButton.dataset.delete);
    if (!post || !confirm(`متأكد تريد حذف المشاركة «${post.title}»؟`)) return;
    try {
      await api(`/api/admin/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      await loadPosts();
      toast('تم حذف المشاركة.');
    } catch (error) { message('#list-notice', error.message); }
  });
  $('#post-search').addEventListener('input', () => { state.search = $('#post-search').value; renderPosts(); });
  $('#status-filter').addEventListener('change', () => { state.filter = $('#status-filter').value; renderPosts(); });

  function setAdminView(view) {
    data.view = view;
    $('#posts-view').hidden = view !== 'posts';
    $('#products-view').hidden = view !== 'products';
    $('#categories-view').hidden = view !== 'categories';
    document.querySelectorAll('[data-admin-view]').forEach(button => button.classList.toggle('active', button.dataset.adminView === view));
    if (view === 'products') { loadCategories(); loadProducts(); }
    if (view === 'categories') loadCategories();
  }
  document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => setAdminView(button.dataset.adminView)));

  async function loadCategories() {
    message('#categories-notice', '');
    try {
      const result = await api('/api/admin/categories');
      data.categories = Array.isArray(result.items) ? result.items : [];
      $('#categories-nav-count').textContent = String(data.categories.length);
      const select = $('#product-category');
      const activeProduct = data.products.find(product => String(product.id) === $('#product-id').value);
      const selected = activeProduct ? String(activeProduct.categoryId || '') : select.value;
      select.innerHTML = '<option value="">بدون قسم</option>' + data.categories.map(category => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('');
      if (data.categories.some(category => String(category.id) === selected)) select.value = selected;
      $('#categories-table').innerHTML = data.categories.length ? data.categories.map(category => `<tr><td><strong>${esc(category.name)}</strong><br><small>${esc(category.description || '')}</small></td><td>${esc(category.slug)}</td><td>${esc(category.product_count ?? category.productCount ?? 0)}</td><td><div class="row-actions"><button type="button" data-category-edit="${esc(category.id)}">تعديل</button><button class="delete-btn" type="button" data-category-delete="${esc(category.id)}">حذف</button></div></td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">ماكو أقسام بعد. أضف أول قسم من النموذج.</td></tr>';
    } catch (error) {
      message('#categories-notice', error.message);
      $('#categories-table').innerHTML = '<tr><td colspan="4" class="empty-cell">تعذّر تحميل الأقسام.</td></tr>';
    }
  }
  async function loadProducts() {
    $('#products-table').innerHTML = '<tr><td colspan="6" class="empty-cell">دا نحمل المنتجات...</td></tr>';
    message('#products-notice', '');
    try {
      const result = await api('/api/admin/products');
      data.products = Array.isArray(result.items) ? result.items : [];
      $('#products-nav-count').textContent = String(data.products.length);
      renderProducts();
    } catch (error) {
      message('#products-notice', error.message);
      $('#products-table').innerHTML = '<tr><td colspan="6" class="empty-cell">تعذّر تحميل المنتجات.</td></tr>';
    }
  }
  function productStatus(product) {
    return product.status || (product.published ? 'published' : 'draft');
  }
  function renderProducts() {
    const query = ($('#product-search').value || '').toLowerCase();
    const typeFilter = $('#product-type-filter').value;
    const statusFilter = $('#product-status-filter').value;
    const items = data.products.filter(product =>
      (typeFilter === 'all' || product.type === typeFilter) &&
      (statusFilter === 'all' || productStatus(product) === statusFilter) &&
      [product.name, product.slug, product.developer, product.categoryName, product.category].some(value => String(value || '').toLowerCase().includes(query))
    );
    $('#products-table').innerHTML = items.length ? items.map(product => {
      const status = productStatus(product);
      return `<tr><td><strong>${esc(product.name)}</strong><br><small>/${esc(product.slug)}</small></td><td>${product.type === 'game' ? 'لعبة' : 'تطبيق'}</td><td>${esc(product.categoryName || product.category || 'بدون قسم')}</td><td><span class="status-pill ${esc(status)}">${status === 'published' ? 'منشور' : status === 'archived' ? 'مؤرشف' : 'مسودة'}</span></td><td>${esc(product.downloads ?? 0)}</td><td><div class="row-actions"><button type="button" data-product-edit="${esc(product.id)}">تعديل</button><button class="delete-btn" type="button" data-product-delete="${esc(product.id)}">حذف</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-cell">ماكو منتجات مطابقة. أضف منتجاً من الزر أعلاه.</td></tr>';
  }
  function resetProductForm() {
    $('#product-form').reset();
    $('#product-id').value = '';
    $('#product-slug').dataset.edited = '';
    $('#product-editor-title').textContent = 'إضافة منتج';
    $('#product-status').value = 'draft';
    message('#product-editor-notice', '');
    $('#product-save').disabled = false;
  }
  function editProduct(product) {
    $('#product-id').value = product.id;
    $('#product-name').value = product.name || '';
    $('#product-slug').value = product.slug || '';
    $('#product-slug').dataset.edited = '1';
    $('#product-type').value = product.type === 'game' ? 'game' : 'app';
    $('#product-category').value = product.categoryId || '';
    $('#product-developer').value = product.developer || '';
    $('#product-platform').value = product.platform || '';
    $('#product-short').value = product.shortDescription || '';
    $('#product-description').value = product.description || '';
    $('#product-image').value = product.imageUrl || '';
    $('#product-download').value = product.downloadUrl || '';
    $('#product-screenshots').value = Array.isArray(product.screenshots) ? product.screenshots.join('\n') : '';
    $('#product-version').value = product.version || '';
    $('#product-size').value = product.fileSize || '';
    $('#product-rating').value = product.rating == null ? '' : product.rating;
    $('#product-release-notes').value = product.releaseNotes || '';
    $('#product-featured').checked = !!product.featured;
    $('#product-status').value = productStatus(product);
    $('#product-editor-title').textContent = 'تعديل المنتج';
    message('#product-editor-notice', '');
    setAdminView('products');
    $('#product-name').focus();
    $('#product-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#new-product').addEventListener('click', () => { resetProductForm(); $('#product-name').focus(); $('#product-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#product-cancel').addEventListener('click', resetProductForm);
  $('#product-name').addEventListener('input', () => { if (!$('#product-id').value && !$('#product-slug').dataset.edited) $('#product-slug').value = slugify($('#product-name').value); });
  $('#product-slug').addEventListener('input', () => { $('#product-slug').dataset.edited = '1'; });
  $('#product-search').addEventListener('input', renderProducts);
  $('#product-type-filter').addEventListener('change', renderProducts);
  $('#product-status-filter').addEventListener('change', renderProducts);
  function productPayloadFromForm() {
    return {
      name: $('#product-name').value.trim(),
      slug: $('#product-slug').value.trim(),
      type: $('#product-type').value,
      categoryId: $('#product-category').value || null,
      developer: $('#product-developer').value.trim(),
      platform: $('#product-platform').value.trim(),
      shortDescription: $('#product-short').value.trim(),
      description: $('#product-description').value,
      imageUrl: $('#product-image').value.trim(),
      downloadUrl: $('#product-download').value.trim(),
      screenshots: $('#product-screenshots').value.split(/\n+/).map(value => value.trim()).filter(Boolean),
      version: $('#product-version').value.trim(),
      fileSize: $('#product-size').value.trim(),
      releaseNotes: $('#product-release-notes').value,
      rating: $('#product-rating').value === '' ? null : Number($('#product-rating').value),
      featured: $('#product-featured').checked,
      status: $('#product-status').value
    };
  }
  function safePreviewImage(value) {
    try {
      const url = new URL(String(value || '').trim(), location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  function showProductPreview() {
    const product = productPayloadFromForm();
    const imageUrl = safePreviewImage(product.imageUrl);
    const screenshots = product.screenshots.map(safePreviewImage).filter(Boolean);
    const typeLabel = product.type === 'game' ? 'لعبة' : 'تطبيق';
    const statusLabelText = product.status === 'published' ? 'منشور' : product.status === 'archived' ? 'مؤرشف' : 'مسودة';
    const previewContent = $('#product-preview-content');
    previewContent.innerHTML = `<article class="preview-product"><div class="preview-product-top">${imageUrl ? `<img class="preview-product-image" src="${esc(imageUrl)}" alt="${esc(product.name || typeLabel)}">` : `<div class="preview-product-image preview-product-placeholder" aria-hidden="true">${esc(Array.from(product.name || typeLabel)[0] || 'H')}</div>`}<div><span class="preview-product-type">${typeLabel} · ${statusLabelText}</span><h3>${esc(product.name || 'اسم المنتج')}</h3><p>${esc(product.shortDescription || product.description || 'أضف وصفاً ليظهر هنا.')}</p><div class="preview-product-tags">${[product.platform, product.version && `الإصدار ${product.version}`, product.fileSize && `الحجم ${product.fileSize}`].filter(Boolean).map(value => `<span>${esc(value)}</span>`).join('')}</div>${product.rating == null || !Number.isFinite(product.rating) ? '' : `<span class="preview-product-rating">★ ${esc(product.rating.toFixed(1))} / 5</span>`}</div></div>${product.description ? `<section class="preview-product-description"><h4>عن المنتج</h4><p>${esc(product.description)}</p></section>` : ''}${product.releaseNotes ? `<section class="preview-product-description"><h4>ملاحظات الإصدار</h4><p>${esc(product.releaseNotes)}</p></section>` : ''}${screenshots.length ? `<section class="preview-product-screenshots"><h4>لقطات الشاشة</h4><div>${screenshots.map((url, index) => `<img src="${esc(url)}" alt="${esc(product.name || typeLabel)} — لقطة ${index + 1}" loading="lazy">`).join('')}</div></section>` : ''}<p class="preview-product-download">${product.downloadUrl ? 'رابط التنزيل مُعدّ' : 'التنزيل غير متوفر حالياً'}</p></article>`;
    $('#product-preview-dialog').showModal();
  }
  $('#product-preview').addEventListener('click', showProductPreview);
  $('#product-preview-close').addEventListener('click', () => $('#product-preview-dialog').close());
  $('#product-preview-dialog').addEventListener('click', event => {
    if (event.target === $('#product-preview-dialog')) $('#product-preview-dialog').close();
  });
  $('#product-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('#product-id').value;
    const product = productPayloadFromForm();
    const button = $('#product-save');
    button.disabled = true;
    button.textContent = 'دا نحفظ...';
    message('#product-editor-notice', '');
    try {
      await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(product) });
      resetProductForm();
      await loadProducts();
      toast('تم حفظ المنتج.');
    } catch (error) {
      message('#product-editor-notice', error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'حفظ المنتج';
    }
  });
  $('#products-table').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-product-edit]');
    if (editButton) {
      const product = data.products.find(item => String(item.id) === editButton.dataset.productEdit);
      if (product) editProduct(product);
      return;
    }
    const deleteButton = event.target.closest('[data-product-delete]');
    if (!deleteButton) return;
    const product = data.products.find(item => String(item.id) === deleteButton.dataset.productDelete);
    if (!product || !confirm(`متأكد تريد حذف المنتج «${product.name}»؟`)) return;
    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      await loadProducts();
      toast('تم حذف المنتج.');
    } catch (error) { message('#products-notice', error.message); }
  });

  function resetCategoryForm() {
    $('#category-form').reset();
    $('#category-id').value = '';
    $('#category-slug').dataset.edited = '';
    $('#category-editor-title').textContent = 'إضافة قسم';
    message('#category-notice', '');
  }
  $('#category-name').addEventListener('input', () => { if (!$('#category-id').value && !$('#category-slug').dataset.edited) $('#category-slug').value = slugify($('#category-name').value); });
  $('#category-slug').addEventListener('input', () => { $('#category-slug').dataset.edited = '1'; });
  $('#category-cancel').addEventListener('click', resetCategoryForm);
  $('#category-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('#category-id').value;
    const category = { name: $('#category-name').value.trim(), slug: $('#category-slug').value.trim(), description: $('#category-description').value.trim() };
    const button = $('#category-form').querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api(id ? `/api/admin/categories/${encodeURIComponent(id)}` : '/api/admin/categories', { method: id ? 'PUT' : 'POST', body: JSON.stringify(category) });
      resetCategoryForm();
      await loadCategories();
      await loadProducts();
      toast('تم حفظ القسم.');
    } catch (error) { message('#category-notice', error.message); }
    finally { button.disabled = false; }
  });
  $('#categories-table').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-category-edit]');
    if (editButton) {
      const category = data.categories.find(item => String(item.id) === editButton.dataset.categoryEdit);
      if (!category) return;
      $('#category-id').value = category.id;
      $('#category-name').value = category.name || '';
      $('#category-slug').value = category.slug || '';
      $('#category-slug').dataset.edited = '1';
      $('#category-description').value = category.description || '';
      $('#category-editor-title').textContent = 'تعديل القسم';
      message('#category-notice', '');
      $('#category-name').focus();
      return;
    }
    const deleteButton = event.target.closest('[data-category-delete]');
    if (!deleteButton) return;
    const category = data.categories.find(item => String(item.id) === deleteButton.dataset.categoryDelete);
    if (!category || !confirm(`متأكد تريد حذف القسم «${category.name}»؟ ستبقى المنتجات بدون قسم.`)) return;
    try {
      await api(`/api/admin/categories/${encodeURIComponent(category.id)}`, { method: 'DELETE' });
      await loadCategories();
      await loadProducts();
      toast('تم حذف القسم.');
    } catch (error) { message('#categories-notice', error.message); }
  });

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
    catch { /* The session still returns to the sign-in screen. */ }
    loginView();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#editor-modal').hidden) closePostEditor();
  });
  boot();
})();
