(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const state = { query: '', category: '', offset: 0, limit: 24, total: 0, loading: false, requestId: 0 };
  const grid = $('#product-grid');
  const status = $('#status-message');
  const count = $('#result-count');
  const more = $('#load-more');
  const empty = $('#empty-state');
  const categoryList = $('#category-list');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function iconFor(name) {
    const first = Array.from(String(name || 'S').trim())[0];
    return escapeHtml(first || 'S');
  }

  function productCard(item) {
    const image = item.imageUrl
      ? `<img class="product-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.remove()">`
      : `<div class="product-image-placeholder" aria-hidden="true">${iconFor(item.name)}</div>`;
    const category = item.category ? `<div class="product-category">${escapeHtml(item.category)}</div>` : '<div class="product-category">منتج رقمي</div>';
    const version = item.version ? `<span>الإصدار ${escapeHtml(item.version)}</span>` : '<span>متوفر بالمتجر</span>';
    const size = item.fileSize ? `<span>${escapeHtml(item.fileSize)}</span>` : '';
    return `
      <article class="product-card">
        <a class="product-image-wrap" href="/product/${encodeURIComponent(item.slug)}" data-product="${escapeHtml(item.slug)}" aria-label="تفاصيل ${escapeHtml(item.name)}">
          ${image}
          ${item.featured ? '<span class="product-badge">مميّز</span>' : ''}
        </a>
        <div class="product-body">
          ${category}
          <h3 class="product-title">${escapeHtml(item.name)}</h3>
          <p class="product-description">${escapeHtml(item.shortDescription || item.description || 'تفاصيل المنتج راح تلكاها بصفحة المنتج.')}</p>
          <div class="product-meta">${version}${size}</div>
          <a class="product-link" href="/product/${encodeURIComponent(item.slug)}" data-product="${escapeHtml(item.slug)}">التفاصيل والتنزيل <span aria-hidden="true">←</span></a>
        </div>
      </article>`;
  }

  async function loadProducts({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const requestId = ++state.requestId;
    more.disabled = true;
    if (!append) {
      state.offset = 0;
      grid.innerHTML = '<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div>';
      empty.hidden = true;
    }
    const params = new URLSearchParams({ limit: String(state.limit), offset: String(state.offset) });
    if (state.query) params.set('q', state.query);
    if (state.category) params.set('category', state.category);
    try {
      const response = await fetch('/api/products?' + params.toString(), { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'ما كدرنا نحمل المنتجات هسه.');
      if (requestId !== state.requestId) return;
      state.total = data.total || 0;
      const items = Array.isArray(data.items) ? data.items : [];
      grid.innerHTML = append ? grid.innerHTML : '';
      if (items.length) grid.insertAdjacentHTML('beforeend', items.map(productCard).join(''));
      state.offset += items.length;
      count.textContent = `عرض ${state.total ? Math.min(state.offset, state.total) : 0} من أصل ${state.total} منتج`;
      more.hidden = state.offset >= state.total || items.length === 0;
      empty.hidden = state.total !== 0;
      if (!state.total) {
        grid.innerHTML = '';
        empty.hidden = false;
      }
      showStatus('');
    } catch (error) {
      if (requestId !== state.requestId) return;
      grid.innerHTML = '';
      count.textContent = 'تعذّر تحميل المنتجات';
      more.hidden = true;
      showStatus(error.message || 'تعذّر الاتصال بالمتجر. جرّب بعد شوية.');
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        more.disabled = false;
      }
    }
  }

  async function loadCategories() {
    try {
      const response = await fetch('/api/categories', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('categories_unavailable');
      const categories = await response.json();
      if (!Array.isArray(categories) || !categories.length) {
        categoryList.innerHTML = '<p class="muted small">الأقسام راح تظهر من تضيف منتجات للمتجر.</p>';
        return;
      }
      categoryList.innerHTML = categories.map((category) => `
        <button class="nav-item" data-category="${escapeHtml(category.slug)}" type="button">
          <span aria-hidden="true">◈</span><span class="category-label">${escapeHtml(category.name)}</span>
          <span class="category-count">${Number(category.product_count) || 0}</span>
        </button>`).join('');
    } catch {
      categoryList.innerHTML = '<p class="muted small">ما كدرنا نحمل الأقسام.</p>';
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) return;
      const config = await response.json();
      const name = config.name || 'Store';
      document.title = name + ' | متجرك الرقمي';
      $('#store-name').textContent = name;
      $('#footer-name').textContent = name;
      $('#footer-name-copy').textContent = name;
      const logo = $('#store-logo');
      if (config.logo) logo.src = config.logo;
    } catch { /* Keep static fallback brand. */ }
  }

  function selectCategory(category, label) {
    state.category = category || '';
    state.offset = 0;
    document.querySelectorAll('[data-category]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.category || '') === state.category);
    });
    $('#catalog-title').textContent = label || (state.query ? 'نتائج البحث' : state.category ? 'منتجات القسم' : 'أحدث المنتجات');
    $('#catalog-subtitle').textContent = state.query ? 'هاي النتائج اللي طلعت حسب بحثك.' : 'منتجات مختارة حتى تكتشف الجديد.';
    closeMenu();
    loadProducts();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeMenu() {
    $('#sidebar').classList.remove('open');
    $('#mobile-overlay').classList.remove('show');
    $('#mobile-overlay').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', (event) => {
    const categoryButton = event.target.closest('[data-category]');
    if (categoryButton) {
      event.preventDefault();
      const label = categoryButton.querySelector('.category-label')?.textContent || '';
      selectCategory(categoryButton.dataset.category || '', label);
      return;
    }
    const productLink = event.target.closest('[data-product]');
    if (productLink) {
      event.preventDefault();
      const slug = productLink.dataset.product;
      history.pushState({ product: slug }, '', '/product/' + encodeURIComponent(slug));
      showProductDetails(slug);
    }
  });

  async function showProductDetails(slug) {
    try {
      const response = await fetch('/api/products/' + encodeURIComponent(slug));
      const item = await response.json();
      if (!response.ok) throw new Error(item.message || 'ما لكينا هالمنتج.');
      let dialog = $('#product-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'product-dialog';
        dialog.className = 'product-dialog';
        document.body.appendChild(dialog);
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close();
        });
        dialog.addEventListener('close', () => {
          if (location.pathname.startsWith('/product/')) history.pushState({}, '', '/');
        });
      }
      const image = item.imageUrl
        ? `<img class="detail-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">`
        : `<div class="detail-image detail-image-placeholder">${iconFor(item.name)}</div>`;
      dialog.innerHTML = `
        <button class="dialog-close" type="button" aria-label="إغلاق">×</button>
        ${image}
        <div class="detail-category">${escapeHtml(item.category || 'منتج رقمي')}</div>
        <h2>${escapeHtml(item.name)}</h2>
        <p class="detail-description">${escapeHtml(item.description || item.shortDescription || 'ماكو وصف إضافي لهذا المنتج حالياً.')}</p>
        <div class="detail-facts">${item.developer ? `<span>المطوّر: ${escapeHtml(item.developer)}</span>` : ''}${item.version ? `<span>الإصدار: ${escapeHtml(item.version)}</span>` : ''}${item.fileSize ? `<span>الحجم: ${escapeHtml(item.fileSize)}</span>` : ''}</div>
        <button class="download-button" type="button" id="download-product">تنزيل المنتج <span>↓</span></button>
        <p class="download-notice" id="download-notice" hidden></p>`;
      dialog.querySelector('.dialog-close').addEventListener('click', () => {
        dialog.close();
        if (location.pathname.startsWith('/product/')) history.pushState({}, '', '/');
      });
      dialog.querySelector('#download-product').addEventListener('click', async () => {
        const button = dialog.querySelector('#download-product');
        const notice = dialog.querySelector('#download-notice');
        button.disabled = true;
        button.textContent = 'دا نجهّز رابط التنزيل...';
        try {
          const result = await fetch('/api/products/' + encodeURIComponent(slug) + '/download', { method: 'POST' });
          const data = await result.json();
          if (!result.ok) throw new Error(data.message || 'التنزيل مو متوفر حالياً.');
          const url = new URL(data.url, location.origin);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('رابط التنزيل غير صالح.');
          window.location.assign(url.href);
        } catch (error) {
          notice.textContent = error.message;
          notice.hidden = false;
          button.disabled = false;
          button.textContent = 'تنزيل المنتج ↓';
        }
      });
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      showStatus(error.message || 'ما كدرنا نفتح تفاصيل المنتج.');
    }
  }

  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = $('#search-input').value.trim();
    state.offset = 0;
    $('#catalog-title').textContent = state.query ? 'نتائج البحث' : 'أحدث المنتجات';
    $('#catalog-subtitle').textContent = state.query ? 'هاي النتائج اللي طلعت حسب بحثك.' : 'منتجات مختارة حتى تكتشف الجديد.';
    loadProducts();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#load-more').addEventListener('click', () => loadProducts({ append: true }));
  $('#clear-filters').addEventListener('click', () => {
    state.query = '';
    state.category = '';
    $('#search-input').value = '';
    selectCategory('', 'أحدث المنتجات');
  });
  $('#menu-toggle').addEventListener('click', () => {
    const open = !$('#sidebar').classList.contains('open');
    $('#sidebar').classList.toggle('open', open);
    $('#mobile-overlay').hidden = !open;
    $('#mobile-overlay').classList.toggle('show', open);
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#mobile-overlay').addEventListener('click', closeMenu);
  $('#year').textContent = String(new Date().getFullYear());
  window.addEventListener('popstate', () => {
    const match = location.pathname.match(/^\/product\/([^/]+)/);
    if (match) showProductDetails(decodeURIComponent(match[1]));
    else {
      const dialog = $('#product-dialog');
      if (dialog?.open) dialog.close();
    }
  });

  loadConfig();
  loadCategories();
  loadProducts();
})();
