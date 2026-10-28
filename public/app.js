(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  const postsStyle = document.createElement('link');
  postsStyle.rel = 'stylesheet';
  postsStyle.href = '/posts.css?v=0.0.5';
  document.head.appendChild(postsStyle);

  const state = {
    query: '',
    category: '',
    type: '',
    sort: 'newest',
    offset: 0,
    limit: 24,
    total: 0,
    loading: false,
    requestId: 0,
    categories: []
  };

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
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
  }

  function iconFor(name) {
    const first = Array.from(String(name || 'S').trim())[0];
    return escapeHtml(first || 'S');
  }

  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M+';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K+';
    return String(num);
  }

  function productCard(item) {
    const slug = encodeURIComponent(item.slug);
    const image = item.imageUrl
      ? `<img class="product-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.remove()">`
      : `<div class="product-image-placeholder" aria-hidden="true">${iconFor(item.name)}</div>`;
    const rating = item.rating == null || !Number.isFinite(Number(item.rating))
      ? null
      : Math.max(0, Math.min(5, Number(item.rating)));
    const ratingText = rating == null ? '—' : rating.toFixed(1);
    const ratingLabel = rating == null ? 'لا يوجد تقييم متاح' : `التقييم ${ratingText} من 5`;
    const stars = Array.from({ length: 5 }, (_, index) => {
      const fill = rating == null ? 0 : Math.max(0, Math.min(1, rating - index)) * 100;
      return `<span class="rating-star" aria-hidden="true" style="--star-fill:${fill}%">★</span>`;
    }).join('');
    const isGame = item.type === 'game';
    const typeLabel = isGame ? '🎮 لعبة' : '📱 تطبيق';
    const category = item.category
      ? `<span class="product-category">${escapeHtml(item.category)}</span>`
      : `<span class="product-category">${typeLabel}</span>`;
    const version = item.version
      ? `<span>الإصدار ${escapeHtml(item.version)}</span>`
      : '<span>متوفر بالمتجر</span>';
    const size = item.fileSize ? `<span>${escapeHtml(item.fileSize)}</span>` : '';

    return `
      <article class="product-card" data-slug="${escapeHtml(item.slug)}">
        <a class="product-image-wrap" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" aria-label="فتح صفحة ${escapeHtml(item.name)}">
          ${image}
          ${item.featured ? '<span class="product-badge">مميّز</span>' : ''}
          <span class="product-type-badge">${typeLabel}</span>
        </a>
        <div class="product-body">
          <h3 class="product-title"><a href="/product/${slug}" data-product="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</a></h3>
          <div class="product-rating" aria-label="${ratingLabel}">
            <span class="rating-value">${ratingText}</span>
            <span class="rating-stars" role="img" aria-label="${ratingLabel}">${stars}</span>
          </div>
          <a class="product-link" href="/product/${slug}" data-product="${escapeHtml(item.slug)}">تحميل <span aria-hidden="true">←</span></a>
          <p class="product-description">${escapeHtml(item.shortDescription || item.description || 'تفاصيل المنتج راح تلكاها بصفحة المنتج.')}</p>
          <div class="product-meta">${category}${version}${size}</div>
        </div>
      </article>`;
  }

  async function loadProducts({ append = false } = {}) {
    state.loading = true;
    const requestId = ++state.requestId;
    if (more) more.disabled = true;
    if (!append) {
      state.offset = 0;
      grid.innerHTML = '<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div>';
      empty.hidden = true;
    }
    const params = new URLSearchParams({
      limit: String(state.limit),
      offset: String(state.offset)
    });
    if (state.query) params.set('q', state.query);
    if (state.category) params.set('category', state.category);
    if (state.type) params.set('type', state.type);
    if (state.sort && state.sort !== 'newest') params.set('sort', state.sort);

    try {
      const response = await fetch('/api/products?' + params.toString(), {
        headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'ما كدرنا نحمل المنتجات هسه.');
      if (requestId !== state.requestId) return;

      state.total = data.total || 0;
      const items = Array.isArray(data.items) ? data.items : [];
      grid.innerHTML = append ? grid.innerHTML : '';
      if (items.length) {
        grid.insertAdjacentHTML('beforeend', items.map(productCard).join(''));
      }
      state.offset += items.length;
      count.textContent = `عرض ${state.total ? Math.min(state.offset, state.total) : 0} من أصل ${state.total} منتج`;
      if (more) more.hidden = state.offset >= state.total || items.length === 0;
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
      if (more) more.hidden = true;
      showStatus(error.message || 'تعذّر الاتصال بالمتجر. جرّب بعد شوية.');
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        if (more) more.disabled = false;
      }
    }
  }

  async function loadShowcaseSections() {
    // 1. Featured items
    try {
      const r = await fetch('/api/products?featured=true&limit=6', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const fSec = $('#featured-section');
        const fGrid = $('#featured-grid');
        if (d.items && d.items.length) {
          fGrid.innerHTML = d.items.map(productCard).join('');
          fSec.hidden = false;
        } else {
          fSec.hidden = true;
        }
      }
    } catch {}

    // 2. Latest Apps
    try {
      const r = await fetch('/api/products?type=app&limit=4', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const aSec = $('#apps-section');
        const aGrid = $('#apps-grid');
        if (d.items && d.items.length) {
          aGrid.innerHTML = d.items.map(productCard).join('');
          aSec.hidden = false;
        } else {
          aSec.hidden = true;
        }
      }
    } catch {}

    // 3. Latest Games
    try {
      const r = await fetch('/api/products?type=game&limit=4', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const gSec = $('#games-section');
        const gGrid = $('#games-grid');
        if (d.items && d.items.length) {
          gGrid.innerHTML = d.items.map(productCard).join('');
          gSec.hidden = false;
        } else {
          gSec.hidden = true;
        }
      }
    } catch {}

    // 4. Most Downloaded
    try {
      const r = await fetch('/api/products?sort=downloads&limit=4', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const dSec = $('#downloads-section');
        const dGrid = $('#downloads-grid');
        const popularItems = (d.items || []).filter(item => (item.downloads || 0) > 0);
        if (popularItems.length) {
          dGrid.innerHTML = popularItems.map(productCard).join('');
          dSec.hidden = false;
        } else {
          dSec.hidden = true;
        }
      }
    } catch {}
  }

  async function loadCategories() {
    try {
      const response = await fetch('/api/categories', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('categories_unavailable');
      const categories = await response.json();
      state.categories = Array.isArray(categories) ? categories : [];
      if (!state.categories.length) {
        categoryList.innerHTML = '<p class="muted small">الأقسام راح تظهر من تضيف منتجات للمتجر.</p>';
        $('#categories-preview-section').hidden = true;
        return;
      }
      categoryList.innerHTML = state.categories.map((category) => `
        <button class="nav-item" data-category="${escapeHtml(category.slug)}" type="button">
          <span aria-hidden="true">${escapeHtml(category.icon || '◈')}</span>
          <span class="category-label">${escapeHtml(category.name)}</span>
          <span class="category-count">${Number(category.product_count) || 0}</span>
        </button>`).join('');

      renderCategoriesPreview();
      renderAllCategoriesView();
    } catch {
      categoryList.innerHTML = '<p class="muted small">ما كدرنا نحمل الأقسام.</p>';
    }
  }

  function renderCategoriesPreview() {
    const previewGrid = $('#categories-preview-grid');
    if (!previewGrid || !state.categories.length) return;
    const cats = state.categories.slice(0, 8);
    previewGrid.innerHTML = cats.map(cat => `
      <article class="category-card" data-category-slug="${escapeHtml(cat.slug)}">
        <div class="cat-card-top">
          <div class="cat-card-icon">${escapeHtml(cat.icon || '◈')}</div>
          <span class="cat-card-badge">${Number(cat.product_count) || 0} منتج</span>
        </div>
        <h3>${escapeHtml(cat.name)}</h3>
        <p>${escapeHtml(cat.description || 'تصفح التطبيقات والألعاب التابعة لهذا القسم.')}</p>
      </article>
    `).join('');
    $('#categories-preview-section').hidden = false;
  }

  function renderAllCategoriesView() {
    const allGrid = $('#all-categories-grid');
    if (!allGrid) return;
    if (!state.categories.length) {
      allGrid.innerHTML = '<p class="muted">لا توجد أقسام مسجلة حالياً.</p>';
      return;
    }
    allGrid.innerHTML = state.categories.map(cat => `
      <article class="category-card" data-category-slug="${escapeHtml(cat.slug)}">
        <div class="cat-card-top">
          <div class="cat-card-icon">${escapeHtml(cat.icon || '◈')}</div>
          <span class="cat-card-badge">${Number(cat.product_count) || 0} منتج</span>
        </div>
        <h3>${escapeHtml(cat.name)}</h3>
        <p>${escapeHtml(cat.description || 'تصفح التطبيقات والألعاب التابعة لهذا القسم.')}</p>
      </article>
    `).join('');
  }

  async function showCategoryDedicatedView(slug) {
    switchToView('category');
    const cat = state.categories.find(c => c.slug === slug);
    $('#cat-view-title').textContent = cat ? cat.name : slug;
    $('#cat-view-desc').textContent = cat?.description || 'تصفح أحدث التطبيقات والألعاب ضمن هذا القسم.';
    $('#cat-view-icon').textContent = cat?.icon || '◈';
    $('#cat-view-count').textContent = cat ? `${cat.product_count || 0} منتج منشور` : '';

    const catGrid = $('#category-products-grid');
    catGrid.innerHTML = '<div class="loading-card"></div><div class="loading-card"></div>';
    const statusMsg = $('#category-status-message');
    statusMsg.hidden = true;

    try {
      const type = $('.cat-tab-btn.active')?.dataset.catType || '';
      const sort = $('#cat-sort-select')?.value || 'newest';
      const params = new URLSearchParams({ category: slug, limit: '40' });
      if (type) params.set('type', type);
      if (sort !== 'newest') params.set('sort', sort);
      const res = await fetch('/api/products?' + params.toString(), { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'تعذر تحميل منتجات هذا القسم.');
      const items = data.items || [];
      if (!items.length) {
        catGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◈</div><h3>ماكو منتجات بهذا القسم حالياً</h3><p>تابعنا، راح نضيف تطبيقات وألعاب جديدة قريباً.</p></div>';
      } else {
        catGrid.innerHTML = items.map(productCard).join('');
      }
    } catch (err) {
      catGrid.innerHTML = '';
      statusMsg.textContent = err.message;
      statusMsg.hidden = false;
    }
  }

  function switchToView(viewName) {
    const mainView = $('#store-main-view');
    const catView = $('#category-dedicated-view');
    const allCatsView = $('#all-categories-view');
    mainView.hidden = viewName !== 'main';
    catView.hidden = viewName !== 'category';
    allCatsView.hidden = viewName !== 'categories';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadPosts() {
    const pGrid = $('#posts-grid');
    const pCount = $('#posts-count');
    const pNotice = $('#posts-status');
    try {
      const response = await fetch('/api/posts?limit=6', { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'ما كدرنا نحمل المشاركات.');
      const posts = Array.isArray(data.items) ? data.items : [];
      pCount.textContent = posts.length + ' مشاركة منشورة';
      if (!posts.length) {
        pGrid.innerHTML = '<div class="posts-empty"><span>▤</span><strong>ماكو مشاركات منشورة حالياً</strong><p>المشاركات راح تظهر هنا من تنشر أول مشاركة من لوحة الإدارة.</p></div>';
        return;
      }
      pGrid.innerHTML = posts.map(post => {
        const image = post.coverImage
          ? '<img src="' + escapeHtml(post.coverImage) + '" alt="" loading="lazy" onerror="this.remove()">'
          : '<span class="post-placeholder" aria-hidden="true">▤</span>';
        return '<article class="post-card"><button type="button" class="post-cover" data-post="' + escapeHtml(post.slug) + '">' + image + '</button><div class="post-card-body"><span class="post-card-category">' + escapeHtml(post.category || 'مشاركة') + '</span><h3>' + escapeHtml(post.title) + '</h3><p>' + escapeHtml(post.excerpt || 'افتح المشاركة لقراءة التفاصيل.') + '</p><button class="post-read" type="button" data-post="' + escapeHtml(post.slug) + '">اقرأ المشاركة <span>←</span></button></div></article>';
      }).join('');
      pNotice.hidden = true;
    } catch (error) {
      pGrid.innerHTML = '<div class="posts-empty"><strong>تعذّر تحميل المشاركات</strong><p>جرّب بعد شوية.</p></div>';
      pNotice.textContent = error.message;
      pNotice.hidden = false;
    }
  }

  async function showPostDetails(slug) {
    try {
      const response = await fetch('/api/posts/' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } });
      const post = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(post.message || 'ما لكينا هالمشاركة.');
      let dialog = $('#post-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'post-dialog';
        dialog.className = 'product-dialog post-dialog';
        document.body.appendChild(dialog);
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      }
      const image = post.coverImage ? '<img class="detail-image" src="' + escapeHtml(post.coverImage) + '" alt="">' : '';
      dialog.innerHTML = '<button class="dialog-close" type="button" aria-label="إغلاق">×</button>' + image +
        '<div class="detail-category">' + escapeHtml(post.category || 'مشاركة') + '</div><h2>' + escapeHtml(post.title) + '</h2>' +
        (post.excerpt ? '<p class="post-detail-excerpt">' + escapeHtml(post.excerpt) + '</p>' : '') +
        '<div class="post-detail-content"></div>';
      dialog.querySelector('.post-detail-content').textContent = post.content || 'ماكو محتوى إضافي لهالمشاركة.';
      dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      const notice = $('#posts-status');
      notice.textContent = error.message || 'ما كدرنا نفتح المشاركة.';
      notice.hidden = false;
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
    $$('[data-category]').forEach((button) => {
      button.classList.toggle('active', (button.dataset.category || '') === state.category);
    });
    switchToView('main');
    $('#catalog-title').textContent = label || (state.query ? 'نتائج البحث' : state.category ? 'منتجات القسم' : 'أحدث المنتجات');
    $('#catalog-subtitle').textContent = state.query ? 'هاي النتائج اللي طلعت حسب بحثك.' : 'منتجات مختارة حتى تكتشف الجديد.';
    closeMenu();
    loadProducts();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectStoreTab(tab) {
    $$('.store-nav-link').forEach(btn => btn.classList.toggle('active', (btn.dataset.storeTab || '') === tab));
    if (tab === 'categories') {
      switchToView('categories');
      return;
    }
    if (tab === 'apps') {
      state.type = 'app';
      state.sort = 'newest';
      state.category = '';
      switchToView('main');
      $('#catalog-title').textContent = 'جميع التطبيقات';
      $('#catalog-subtitle').textContent = 'تطبيقات مميزة وأدوات إنتاجية.';
      updateChipActive('app');
      loadProducts();
      $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (tab === 'games') {
      state.type = 'game';
      state.sort = 'newest';
      state.category = '';
      switchToView('main');
      $('#catalog-title').textContent = 'جميع الألعاب';
      $('#catalog-subtitle').textContent = 'أحدث وأقوى الألعاب الرقمية.';
      updateChipActive('game');
      loadProducts();
      $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (tab === 'featured') {
      state.type = '';
      state.sort = 'newest';
      state.category = '';
      switchToView('main');
      $('#catalog-title').textContent = 'المنتجات المميّزة';
      $('#catalog-subtitle').textContent = 'اختيارات محرري المتجر.';
      loadProducts();
      $('#featured-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (tab === 'top') {
      state.type = '';
      state.sort = 'downloads';
      state.category = '';
      switchToView('main');
      $('#catalog-title').textContent = 'الأكثر تحميلاً';
      $('#catalog-subtitle').textContent = 'المنتجات الأكثر شعبية حسب التنزيلات الحقيقية.';
      loadProducts();
      $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (tab === 'posts') {
      switchToView('main');
      $('#posts-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Default Home
    state.type = '';
    state.sort = 'newest';
    state.category = '';
    state.query = '';
    if ($('#search-input')) $('#search-input').value = '';
    switchToView('main');
    $('#catalog-title').textContent = 'أحدث المنتجات';
    $('#catalog-subtitle').textContent = 'منتجات مختارة حتى تكتشف الجديد.';
    updateChipActive('');
    loadProducts();
  }

  function updateChipActive(typeVal) {
    $$('.chip-item').forEach(c => {
      if (c.dataset.filterType !== undefined) {
        c.classList.toggle('active', c.dataset.filterType === typeVal);
      }
    });
  }

  function closeMenu() {
    $('#sidebar').classList.remove('open');
    $('#mobile-overlay').classList.remove('show');
    $('#mobile-overlay').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }

  /* Main Click Event Delegator */
  document.addEventListener('click', (event) => {
    // 1. Post click
    const postButton = event.target.closest('[data-post]');
    if (postButton) {
      event.preventDefault();
      showPostDetails(postButton.dataset.post);
      return;
    }

    // 2. Category button from sidebar
    const categoryButton = event.target.closest('[data-category]');
    if (categoryButton) {
      event.preventDefault();
      const label = categoryButton.querySelector('.category-label')?.textContent || '';
      selectCategory(categoryButton.dataset.category || '', label);
      return;
    }

    // 3. Category card from grid
    const catCard = event.target.closest('[data-category-slug]');
    if (catCard) {
      event.preventDefault();
      const slug = catCard.dataset.categorySlug;
      history.pushState({ category: slug }, '', '/category/' + encodeURIComponent(slug));
      showCategoryDedicatedView(slug);
      return;
    }

    // 4. Desktop store navigation tab
    const navTab = event.target.closest('[data-store-tab]');
    if (navTab) {
      event.preventDefault();
      selectStoreTab(navTab.dataset.storeTab || '');
      return;
    }

    // 5. Sidebar data-nav link
    const sidebarNav = event.target.closest('[data-nav]');
    if (sidebarNav) {
      event.preventDefault();
      closeMenu();
      selectStoreTab(sidebarNav.dataset.nav === 'home' ? '' : sidebarNav.dataset.nav);
      return;
    }

    // 6. Section "view all" buttons
    const viewMore = event.target.closest('[data-view-more]');
    if (viewMore) {
      event.preventDefault();
      selectStoreTab(viewMore.dataset.viewMore);
      return;
    }

    // 7. View all categories button
    if (event.target.closest('#view-all-categories-btn')) {
      event.preventDefault();
      history.pushState({ view: 'categories' }, '', '/categories');
      switchToView('categories');
      return;
    }

    // 8. Back buttons
    if (event.target.closest('#category-back-btn') || event.target.closest('#all-cats-back-btn')) {
      event.preventDefault();
      history.pushState({}, '', '/');
      selectStoreTab('');
      return;
    }

    // 9. Quick filter chips
    const chip = event.target.closest('.chip-item');
    if (chip) {
      event.preventDefault();
      $$('.chip-item').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      if (chip.dataset.filterType !== undefined) {
        state.type = chip.dataset.filterType;
        state.sort = 'newest';
      } else if (chip.dataset.filterSort !== undefined) {
        state.sort = chip.dataset.filterSort;
      }
      loadProducts();
      return;
    }

    // 10. Category filter tabs in category dedicated view
    const catTab = event.target.closest('.cat-tab-btn');
    if (catTab) {
      event.preventDefault();
      $$('.cat-tab-btn').forEach(b => b.classList.remove('active'));
      catTab.classList.add('active');
      const curSlug = state.categories.find(c => c.name === $('#cat-view-title').textContent)?.slug || '';
      if (curSlug) showCategoryDedicatedView(curSlug);
      return;
    }

    // 11. Screenshot Thumbnail click -> Lightbox
    const shotBtn = event.target.closest('.screenshot-thumb-btn');
    if (shotBtn) {
      event.preventDefault();
      const imgUrl = shotBtn.dataset.fullImg;
      if (imgUrl) openScreenshotLightbox(imgUrl);
      return;
    }

    // 12. Product Card click (Navigation to detail URL)
    const productLink = event.target.closest('[data-product]');
    if (productLink) {
      event.preventDefault();
      const slug = productLink.dataset.product;
      history.pushState({ product: slug }, '', '/product/' + encodeURIComponent(slug));
      showProductDetails(slug);
    }
  });

  function openScreenshotLightbox(url) {
    const box = $('#screenshot-lightbox');
    const img = $('#lightbox-img');
    if (!box || !img) return;
    img.src = url;
    box.hidden = false;
  }
  function closeScreenshotLightbox() {
    const box = $('#screenshot-lightbox');
    if (box) box.hidden = true;
  }
  $('#lightbox-close')?.addEventListener('click', closeScreenshotLightbox);
  $('#lightbox-backdrop')?.addEventListener('click', closeScreenshotLightbox);

  /* Dedicated Product Details View */
  async function showProductDetails(slug) {
    try {
      const response = await fetch('/api/products/' + encodeURIComponent(slug));
      const item = await response.json();
      if (!response.ok) throw new Error(item.message || 'ما لكينا هالمنتج.');

      document.title = `${item.name} | Store`;

      let dialog = $('#product-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'product-dialog';
        dialog.className = 'product-dialog';
        document.body.appendChild(dialog);
      }

      const isGame = item.type === 'game';
      const typeLabel = isGame ? '🎮 لعبة' : '📱 تطبيق';
      const icon = item.imageUrl
        ? `<img class="detail-app-icon" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" onerror="this.src='/Logo.png'">`
        : `<div class="detail-icon-placeholder">${iconFor(item.name)}</div>`;

      const rating = item.rating == null || !Number.isFinite(Number(item.rating))
        ? null
        : Math.max(0, Math.min(5, Number(item.rating)));
      const ratingText = rating == null ? '—' : rating.toFixed(1);
      const ratingLabel = rating == null ? 'لا يوجد تقييم متاح' : `التقييم ${ratingText} من 5`;
      const stars = Array.from({ length: 5 }, (_, index) => {
        const fill = rating == null ? 0 : Math.max(0, Math.min(1, rating - index)) * 100;
        return `<span class="rating-star" aria-hidden="true" style="--star-fill:${fill}%">★</span>`;
      }).join('');

      // Build screenshots gallery markup
      let galleryHtml = '';
      if (Array.isArray(item.screenshots) && item.screenshots.length) {
        galleryHtml = `
          <div class="detail-gallery-box">
            <h3>لقطات الشاشة والمعاينة</h3>
            <div class="detail-screenshots-scroll">
              ${item.screenshots.map(s => `
                <button type="button" class="screenshot-thumb-btn" data-full-img="${escapeHtml(s)}" title="اضغط للتكبير">
                  <img src="${escapeHtml(s)}" alt="لقطة شاشة" loading="lazy" onerror="this.parentElement.remove()">
                </button>
              `).join('')}
            </div>
          </div>`;
      }

      // Build release notes markup
      let releaseNotesHtml = '';
      if (item.releaseNotes) {
        releaseNotesHtml = `
          <div class="release-notes-box">
            <strong>ما الجديد في هذا الإصدار (${escapeHtml(item.version || 'الأخير')})</strong>
            <p>${escapeHtml(item.releaseNotes)}</p>
          </div>`;
      }

      const formattedDate = item.updatedAt
        ? new Date(item.updatedAt).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'حديثاً';

      dialog.innerHTML = `
        <button class="dialog-close" type="button" aria-label="إغلاق">×</button>
        <button class="dialog-share" id="share-product-btn" type="button" title="مشاركة الرابط" aria-label="مشاركة رابط المنتج">➦</button>
        <div class="detail-modal-body">
          <div class="detail-header-card">
            ${icon}
            <div class="detail-header-info">
              <div class="detail-badges-row">
                <span class="detail-category-badge">${escapeHtml(item.category || 'منتج رقمي')}</span>
                <span class="detail-type-tag">${typeLabel}</span>
                ${item.featured ? '<span class="detail-type-tag" style="background:#eaf5ee;color:#16834a;border-color:#bce1c7">مميّز</span>' : ''}
              </div>
              <h2>${escapeHtml(item.name)}</h2>
              <div class="detail-developer">المطوّر: <b>${escapeHtml(item.developer || 'ناشر معتمد')}</b></div>
            </div>
          </div>

          <div class="detail-stats-bar">
            <div class="detail-stat-item">
              <strong>${ratingText} <span style="color:#e5a51b;font-size:13px">★</span></strong>
              <small>${ratingLabel}</small>
            </div>
            <div class="detail-stat-item">
              <strong>${formatNumber(item.downloads)}</strong>
              <small>تنزيل حقيقي</small>
            </div>
            <div class="detail-stat-item">
              <strong>${escapeHtml(item.fileSize || 'غير محدد')}</strong>
              <small>حجم الملف</small>
            </div>
            <div class="detail-stat-item">
              <strong>${escapeHtml(item.version || 'v1.0')}</strong>
              <small>الإصدار</small>
            </div>
          </div>

          <div class="download-action-box">
            <button class="download-button" type="button" id="download-product">
              <span>تنزيل ${item.fileSize ? `(${escapeHtml(item.fileSize)})` : ''}</span>
              <span aria-hidden="true">↓</span>
            </button>
            <div class="download-unavailable-msg" id="download-unavailable-msg" hidden>التنزيل غير متاح حالياً لهذا المنتج.</div>
            <p class="download-notice" id="download-notice" hidden></p>
          </div>

          ${galleryHtml}

          <div class="detail-section-card">
            <h3>عن هذا ${isGame ? 'اللعبة' : 'التطبيق'}</h3>
            <p class="detail-description">${escapeHtml(item.description || item.shortDescription || 'لا يتوفر وصف إضافي لهذا المنتج حالياً.')}</p>
            ${releaseNotesHtml}
          </div>

          <div class="detail-section-card">
            <h3>المواصفات الفنية والتوافق</h3>
            <div class="detail-specs-grid">
              <div class="spec-item"><span>المطوّر أو الناشر</span><span>${escapeHtml(item.developer || 'غير مسجل')}</span></div>
              <div class="spec-item"><span>الإصدار</span><span>${escapeHtml(item.version || '1.0')}</span></div>
              <div class="spec-item"><span>حجم التنزيل</span><span>${escapeHtml(item.fileSize || 'غير محدد')}</span></div>
              <div class="spec-item"><span>نظام التشغيل</span><span>${escapeHtml(item.platform || 'Android')}</span></div>
              <div class="spec-item"><span>تاريخ آخر تحديث</span><span>${escapeHtml(formattedDate)}</span></div>
              <div class="spec-item"><span>القسم</span><span>${escapeHtml(item.category || 'عام')}</span></div>
            </div>
          </div>

          <div class="detail-related-section" id="detail-related-box" hidden>
            <h3>قد يعجبك أيضاً</h3>
            <div class="product-grid" id="detail-related-grid"></div>
          </div>
        </div>`;

      // Set download availability according to contract
      const downloadButton = dialog.querySelector('#download-product');
      const unavailMsg = dialog.querySelector('#download-unavailable-msg');
      downloadButton.hidden = !item.hasDownload;
      if (unavailMsg) unavailMsg.hidden = !!item.hasDownload;

      // Close handlers
      const closeDialog = () => {
        dialog.close();
        if (location.pathname.startsWith('/product/')) history.pushState({}, '', '/');
        document.title = 'Store | متجرك الرقمي';
      };
      dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog();
      });

      // Share handler
      const shareBtn = dialog.querySelector('#share-product-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
          const shareUrl = window.location.href;
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(shareUrl);
            shareBtn.textContent = '✓';
            setTimeout(() => { shareBtn.textContent = '➦'; }, 2000);
          }
        });
      }

      // Download button handler
      downloadButton.addEventListener('click', async () => {
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
          button.textContent = `تنزيل ${item.fileSize ? `(${escapeHtml(item.fileSize)})` : ''} ↓`;
        }
      });

      if (!dialog.open) dialog.showModal();

      // Load related products
      loadRelatedProducts(slug);

    } catch (error) {
      showStatus(error.message || 'ما كدرنا نفتح تفاصيل المنتج.');
    }
  }

  async function loadRelatedProducts(slug) {
    try {
      const res = await fetch('/api/products/' + encodeURIComponent(slug) + '/related');
      if (!res.ok) return;
      const data = await res.json();
      const related = data.items || [];
      const box = $('#detail-related-box');
      const relGrid = $('#detail-related-grid');
      if (box && relGrid && related.length) {
        relGrid.innerHTML = related.slice(0, 2).map(productCard).join('');
        box.hidden = false;
      }
    } catch {}
  }

  // Category sorting dropdown handler
  $('#cat-sort-select')?.addEventListener('change', () => {
    const curSlug = state.categories.find(c => c.name === $('#cat-view-title').textContent)?.slug || '';
    if (curSlug) showCategoryDedicatedView(curSlug);
  });

  // Search Form Submit
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = $('#search-input').value.trim();
    state.offset = 0;
    switchToView('main');
    $('#catalog-title').textContent = state.query ? 'نتائج البحث' : 'أحدث المنتجات';
    $('#catalog-subtitle').textContent = state.query ? 'هاي النتائج اللي طلعت حسب بحثك.' : 'منتجات مختارة حتى تكتشف الجديد.';
    loadProducts();
    $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#load-more').addEventListener('click', () => loadProducts({ append: true }));
  $('#clear-filters').addEventListener('click', () => {
    state.query = '';
    state.category = '';
    state.type = '';
    state.sort = 'newest';
    if ($('#search-input')) $('#search-input').value = '';
    updateChipActive('');
    selectCategory('', 'أحدث المنتجات');
  });

  // Mobile Drawer Menu
  $('#menu-toggle').addEventListener('click', () => {
    const open = !$('#sidebar').classList.contains('open');
    if (open) {
      $('#sidebar').classList.add('open');
      $('#mobile-overlay').hidden = false;
      $('#mobile-overlay').classList.add('show');
      document.body.classList.add('menu-open');
      $('#menu-toggle').setAttribute('aria-expanded', 'true');
    } else {
      closeMenu();
    }
  });
  $('#sidebar-close')?.addEventListener('click', closeMenu);
  $('#mobile-overlay').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      closeScreenshotLightbox();
    }
  });

  $('#year').textContent = String(new Date().getFullYear());

  // Popstate Routing
  window.addEventListener('popstate', (e) => {
    const path = location.pathname;
    const productMatch = path.match(/^\/product\/([^/]+)/);
    const categoryMatch = path.match(/^\/category\/([^/]+)/);
    if (productMatch) {
      showProductDetails(decodeURIComponent(productMatch[1]));
    } else if (categoryMatch) {
      showCategoryDedicatedView(decodeURIComponent(categoryMatch[1]));
    } else if (path === '/categories') {
      switchToView('categories');
    } else {
      const dialog = $('#product-dialog');
      if (dialog?.open) dialog.close();
      switchToView('main');
    }
  });

  // Initial Boot
  loadConfig();
  loadPosts();
  loadCategories();
  loadShowcaseSections();
  loadProducts();

  const initialPath = location.pathname;
  const initialProductRoute = initialPath.match(/^\/product\/([^/]+)/);
  const initialCategoryRoute = initialPath.match(/^\/category\/([^/]+)/);
  if (initialProductRoute) {
    showProductDetails(decodeURIComponent(initialProductRoute[1]));
  } else if (initialCategoryRoute) {
    showCategoryDedicatedView(decodeURIComponent(initialCategoryRoute[1]));
  } else if (initialPath === '/categories') {
    switchToView('categories');
  }
})();
