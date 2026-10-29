(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $('#app');
  const state = { categories: [], popularAvailable: false, routeRequest: 0, posts: [], storeName: 'HyperSoft Store', storeLink: '' };
  const postsStyle = document.createElement('link');
  postsStyle.rel = 'stylesheet';
  postsStyle.href = '/posts.css?v=1.0.0';
  document.head.appendChild(postsStyle);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const safeImage = value => {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text, location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'ما كدرنا نحمّل هالمحتوى هسه.');
    return data;
  };
  const slugPath = (prefix, slug) => `${prefix}/${encodeURIComponent(String(slug || ''))}`;
  const counts = item => Number.isFinite(Number(item?.downloads)) ? Number(item.downloads) : 0;
  const isPublicProduct = item => (!item.status || item.status === 'published') && item.published !== false;
  const isPublicPost = item => (!item.status || item.status === 'published') && item.published !== false;

  function setPageMeta(title, description, route = location.pathname) {
    document.title = `${title} | ${state.storeName}`;
    let descriptionNode = document.querySelector('meta[name="description"]');
    if (!descriptionNode) {
      descriptionNode = document.createElement('meta');
      descriptionNode.name = 'description';
      document.head.appendChild(descriptionNode);
    }
    descriptionNode.content = String(description || '').slice(0, 300);
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const base = state.storeLink || location.origin;
    try {
      canonical.href = new URL(route, base).href;
    } catch {
      canonical.href = new URL(location.pathname, location.origin).href;
    }
  }

  let screenshotViewer;
  function openScreenshotViewer(url, alt) {
    if (!screenshotViewer) {
      screenshotViewer = document.createElement('dialog');
      screenshotViewer.className = 'screenshot-viewer';
      const closeButton = document.createElement('button');
      closeButton.className = 'viewer-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'إغلاق الصورة');
      closeButton.textContent = '×';
      const image = document.createElement('img');
      screenshotViewer.append(closeButton, image);
      document.body.appendChild(screenshotViewer);
      closeButton.addEventListener('click', () => screenshotViewer.close());
      screenshotViewer.addEventListener('click', event => {
        if (event.target === screenshotViewer) screenshotViewer.close();
      });
    }
    const image = screenshotViewer.querySelector('img');
    image.src = url;
    image.alt = alt;
    if (!screenshotViewer.open) screenshotViewer.showModal();
  }

  function closeMenu() {
    $('#sidebar').classList.remove('open');
    $('#sidebar').setAttribute('aria-hidden', 'true');
    $('#mobile-overlay').classList.remove('show');
    $('#mobile-overlay').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  }
  function openMenu() {
    $('#sidebar').classList.add('open');
    $('#sidebar').setAttribute('aria-hidden', 'false');
    $('#mobile-overlay').hidden = false;
    requestAnimationFrame(() => $('#mobile-overlay').classList.add('show'));
    $('#menu-toggle').setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    $('#sidebar-close').focus();
  }
  function setActiveNav(route) {
    document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === route));
  }
  function updateCategoryNav() {
    const nav = $('#category-list');
    if (!state.categories.length) {
      nav.innerHTML = '<p class="muted small">ماكو أقسام منشورة حالياً.</p>';
      return;
    }
    nav.innerHTML = state.categories.map(category => `<a class="nav-item" href="${slugPath('/category', category.slug)}" data-route><span class="nav-glyph" aria-hidden="true">◈</span><span>${esc(category.name)}</span><span class="category-count">${esc(category.product_count ?? category.productCount ?? '')}</span></a>`).join('');
  }
  function showError(message, retry) {
    app.innerHTML = `<section class="empty-state"><div class="empty-icon" aria-hidden="true">!</div><h2>ما كدرنا نحمّل الصفحة</h2><p>${esc(message || 'تأكد من اتصالك وحاول مرة ثانية.')}</p><button class="secondary-button" id="retry-view" type="button">إعادة المحاولة</button></section>`;
    $('#retry-view')?.addEventListener('click', retry);
  }
  function skeleton(title) {
    app.innerHTML = `<section class="section"><div class="section-heading"><div><span class="eyebrow">HyperSoft Store</span><h1>${esc(title)}</h1><p>دا نجيب أحدث البيانات من كتالوج المتجر.</p></div></div><div class="loading-grid"><div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div></div></section>`;
  }
  function ratingMarkup(rating) {
    if (rating == null || !Number.isFinite(Number(rating))) return '';
    const value = Math.max(0, Math.min(5, Number(rating)));
    return `<span class="product-rating" aria-label="التقييم ${value.toFixed(1)} من 5"><span class="rating-star" aria-hidden="true">★</span>${value.toFixed(1)}</span>`;
  }
  function productCard(item) {
    const imageUrl = safeImage(item.imageUrl);
    const image = imageUrl
      ? `<img class="product-image" src="${esc(imageUrl)}" alt="${esc(item.name)}" loading="lazy" onerror="this.remove()">`
      : `<span class="product-image-placeholder" aria-hidden="true">${esc(Array.from(String(item.name || 'H').trim())[0] || 'H')}</span>`;
    const meta = [item.version ? `الإصدار ${item.version}` : '', item.fileSize || ''].filter(Boolean);
    return `<article class="product-card">
      <a class="product-image-wrap" href="${slugPath('/product', item.slug)}" data-route aria-label="تفاصيل ${esc(item.name)}">${image}${item.featured ? '<span class="product-badge">اختيار مميّز</span>' : ''}</a>
      <div class="product-body"><span class="product-category">${esc(item.category || (item.type === 'game' ? 'لعبة' : 'تطبيق'))}</span>
        <h3 class="product-title"><a href="${slugPath('/product', item.slug)}" data-route>${esc(item.name)}</a></h3>
        ${ratingMarkup(item.rating)}
        <p class="product-description">${esc(item.shortDescription || item.description || '')}</p>
        <div class="product-meta">${meta.map(part => `<span>${esc(part)}</span>`).join('')}</div>
        <a class="product-link" href="${slugPath('/product', item.slug)}" data-route>التفاصيل <span aria-hidden="true">←</span></a>
      </div></article>`;
  }
  function cards(items) { return items.map(productCard).join(''); }
  function shellHero() {
    return `<section class="hero"><div class="hero-copy"><span class="eyebrow">HyperSoft Store</span><h1>تطبيقك الجاي، <span>تلكاه بسهولة.</span></h1><p>مكان عراقي لاكتشاف تطبيقات وألعاب موثوقة. تفاصيل واضحة، تصفّح سريع، وكل منتج من كتالوجه الحقيقي.</p><a class="hero-button" href="/apps" data-route>ابدأ التصفّح <span aria-hidden="true">←</span></a></div><div class="hero-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="art-tile">H<span>+</span></div><i class="art-dot dot-one"></i><i class="art-dot dot-two"></i></div></section>`;
  }
  function emptyProducts(title = 'ماكو منتجات بهالنتائج', message = 'جرّب بحث ثاني أو تصفّح قسم مختلف.') {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌕</div><h2>${esc(title)}</h2><p>${esc(message)}</p><a class="secondary-button" href="/" data-route>العودة للرئيسية</a></div>`;
  }
  function productSection(title, subtitle, items, id = '') {
    if (!items.length) return '';
    return `<section class="section" ${id ? `id="${id}"` : ''}><div class="section-heading"><div><span class="eyebrow">من الكتالوج الحقيقي</span><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><span class="result-count">${items.length} منتجات</span></div><div class="product-grid">${cards(items)}</div></section>`;
  }
  async function loadPosts() {
    const data = await api('/api/posts?limit=4&offset=0');
    state.posts = Array.isArray(data.items) ? data.items.filter(isPublicPost) : [];
    return state.posts;
  }
  function renderPosts(posts) {
    if (!posts.length) return '';
    return `<section class="section posts-section"><div class="section-heading"><div><span class="eyebrow">مقالات المتجر</span><h2>اقرأ وتعرّف أكثر</h2><p>مشاركات منشورة من إدارة المتجر.</p></div><span class="result-count">${posts.length} مشاركات</span></div><div class="posts-grid">${posts.map(post => {
      const cover = safeImage(post.coverImage);
      const image = cover ? `<img src="${esc(cover)}" alt="${esc(post.title)}" loading="lazy" onerror="this.remove()">` : '<span class="post-placeholder" aria-hidden="true">▤</span>';
      return `<article class="post-card"><a class="post-cover" href="${slugPath('/post', post.slug)}" data-route aria-label="اقرأ ${esc(post.title)}">${image}</a><div class="post-card-body"><span class="post-card-category">${esc(post.category || 'مشاركة')}</span><h3>${esc(post.title)}</h3><p>${esc(post.excerpt || '')}</p><a class="post-read" href="${slugPath('/post', post.slug)}" data-route>اقرأ المشاركة <span aria-hidden="true">←</span></a></div></article>`;
    }).join('')}</div></section>`;
  }
  function catalogFilters(active, query = '') {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
    return `<div class="catalog-toolbar"><div class="catalog-chips" aria-label="فلترة نوع المنتج"><a class="filter-chip ${active === 'search' || active === '' ? 'active' : ''}" href="${query ? `/search${suffix}` : '/'}" data-route>الكل</a><a class="filter-chip ${active === 'app' ? 'active' : ''}" href="/apps${suffix}" data-route>تطبيقات</a><a class="filter-chip ${active === 'game' ? 'active' : ''}" href="/games${suffix}" data-route>ألعاب</a></div></div>`;
  }
  async function renderHome(requestId) {
    setActiveNav('home');
    setPageMeta('الرئيسية', 'اكتشف تطبيقات وألعاب موثوقة من كتالوج HyperSoft Store.');
    const featuredApps = new URLSearchParams({ limit: '4', offset: '0', type: 'app', featured: 'true' });
    const featuredGames = new URLSearchParams({ limit: '4', offset: '0', type: 'game', featured: 'true' });
    const latestApps = new URLSearchParams({ limit: '8', offset: '0', type: 'app', sort: 'newest' });
    const latestGames = new URLSearchParams({ limit: '8', offset: '0', type: 'game', sort: 'newest' });
    const [featuredAppsData, featuredGamesData, latestAppsData, latestGamesData, posts] = await Promise.all([
      api('/api/products?' + featuredApps),
      api('/api/products?' + featuredGames),
      api('/api/products?' + latestApps),
      api('/api/products?' + latestGames),
      loadPosts().catch(() => [])
    ]);
    if (requestId !== state.routeRequest) return;
    const featuredAppsItems = Array.isArray(featuredAppsData.items) ? featuredAppsData.items.filter(isPublicProduct) : [];
    const featuredGamesItems = Array.isArray(featuredGamesData.items) ? featuredGamesData.items.filter(isPublicProduct) : [];
    const latestAppsItems = Array.isArray(latestAppsData.items) ? latestAppsData.items.filter(isPublicProduct) : [];
    const latestGamesItems = Array.isArray(latestGamesData.items) ? latestGamesData.items.filter(isPublicProduct) : [];
    const categories = state.categories.length ? `<section class="section"><div class="section-heading"><div><span class="eyebrow">اكتشف حسب اهتمامك</span><h2>الأقسام</h2><p>تصفّح المنتجات ضمن مجموعات واضحة.</p></div><a class="section-action" href="/categories" data-route>كل الأقسام <span aria-hidden="true">←</span></a></div><div class="category-grid">${state.categories.slice(0, 6).map(category => `<a class="category-card" href="${slugPath('/category', category.slug)}" data-route><span class="category-symbol" aria-hidden="true">◈</span><span><strong>${esc(category.name)}</strong><small>${esc(category.product_count ?? category.productCount ?? 0)} منتجات</small></span></a>`).join('')}</div></section>` : '';
    const hasProducts = featuredAppsItems.length || featuredGamesItems.length || latestAppsItems.length || latestGamesItems.length;
    app.innerHTML = `${shellHero()}${productSection('تطبيقات مميّزة', 'تطبيقات اختارتها إدارة المتجر.', featuredAppsItems)}${productSection('ألعاب مميّزة', 'ألعاب مميّزة من كتالوج المتجر.', featuredGamesItems)}${productSection('أحدث التطبيقات', 'آخر التطبيقات المنشورة في المتجر.', latestAppsItems, 'latest-apps')}${productSection('أحدث الألعاب', 'آخر الألعاب المنشورة في المتجر.', latestGamesItems, 'latest-games')}${!hasProducts ? `<section class="section">${emptyProducts('الكتالوج بعده فارغ', 'أول ما تنشر الإدارة منتجات، راح تلكاها هنا.')}</section>` : ''}${categories}${posts.length ? renderPosts(posts) : ''}<section class="feature-strip"><a class="feature-tile" href="/apps" data-route><div><span>اكتشف عالم التطبيقات</span><h3>تطبيقات مفيدة، بوضوح</h3><p>تفاصيلها ومعلوماتها بمكان واحد.</p></div><span class="feature-arrow" aria-hidden="true">←</span></a><a class="feature-tile" href="/games" data-route><div><span>وقت اللعب</span><h3>ألعاب تليق بوقتك</h3><p>اختار لعبتك الجاية من الكتالوج.</p></div><span class="feature-arrow" aria-hidden="true">←</span></a></section>`;
  }
  async function renderCatalog(type, query = '', requestId) {
    const routeName = type === 'app' ? 'apps' : type === 'game' ? 'games' : type === 'popular' ? 'popular' : '';
    setActiveNav(routeName);
    const params = new URLSearchParams({ limit: '24', offset: '0' });
    if (type === 'app' || type === 'game') params.set('type', type);
    if (type === 'popular') params.set('sort', 'downloads');
    if (query) params.set('q', query);
    const data = await api('/api/products?' + params);
    if (requestId !== state.routeRequest) return;
    const items = Array.isArray(data.items) ? data.items.filter(isPublicProduct).filter(item => type !== 'popular' || counts(item) > 0) : [];
    const title = type === 'app' ? 'التطبيقات' : type === 'game' ? 'الألعاب' : type === 'popular' ? 'الأكثر تحميلاً' : 'نتائج البحث';
    setPageMeta(query ? `بحث: ${query}` : title, query ? `نتائج البحث عن ${query} في كتالوج HyperSoft Store.` : `تصفّح ${title} المنشورة في HyperSoft Store.`);
    app.innerHTML = `<section class="section" id="catalog-page"><div class="section-heading"><div><span class="eyebrow">كتالوج HyperSoft</span><h1>${title}</h1><p>${query ? `النتائج المطابقة لـ «${esc(query)}»` : type === 'popular' ? 'ترتيب يعتمد على أعداد التنزيلات المسجّلة فعلياً.' : 'اكتشف المنتجات المنشورة من قاعدة بيانات المتجر.'}</p></div><span class="result-count" id="catalog-result-count">${Number(data.total) || 0} منتج</span></div>${type !== 'popular' ? catalogFilters(type, query) : ''}${items.length ? `<div class="product-grid" id="catalog-products">${cards(items)}</div>${Number(data.total) > items.length ? '<div class="load-more-wrap"><button class="load-more" id="catalog-more" type="button">عرض المزيد</button></div>' : ''}` : emptyProducts(type === 'popular' ? 'ماكو تنزيلات مسجّلة بعد' : query ? 'ما لكينا نتائج' : 'ماكو منتجات منشورة بهالقسم', query ? 'جرّب كلمة بحث ثانية.' : 'المنتجات المنشورة راح تظهر هنا من تتوفر.')}</section>`;
    let offset = items.length;
    const more = $('#catalog-more');
    more?.addEventListener('click', async () => {
      more.disabled = true;
      more.textContent = 'دا نحمل...';
      const nextParams = new URLSearchParams({ limit: '24', offset: String(offset) });
      if (type === 'app' || type === 'game') nextParams.set('type', type);
      if (type === 'popular') nextParams.set('sort', 'downloads');
      if (query) nextParams.set('q', query);
      try {
        const next = await api('/api/products?' + nextParams);
        if (requestId !== state.routeRequest) return;
        const nextItems = Array.isArray(next.items) ? next.items.filter(isPublicProduct).filter(item => type !== 'popular' || counts(item) > 0) : [];
        $('#catalog-products')?.insertAdjacentHTML('beforeend', cards(nextItems));
        offset += nextItems.length;
        const button = $('#catalog-more');
        if (!button) return;
        if (offset >= Number(next.total || data.total) || !nextItems.length) button.remove();
        else { button.disabled = false; button.textContent = 'عرض المزيد'; }
      } catch (error) {
        more.disabled = false;
        more.textContent = 'حاول مرة ثانية';
        let notice = $('#catalog-load-error');
        if (!notice) {
          notice = document.createElement('p');
          notice.id = 'catalog-load-error';
          notice.className = 'status-message error';
          more.parentElement.before(notice);
        }
        notice.textContent = error.message || 'تعذّر تحميل المزيد.';
      }
    });
  }
  async function renderCategories(requestId) {
    setActiveNav('categories');
    setPageMeta('الأقسام', 'تصفّح أقسام التطبيقات والألعاب المنشورة في HyperSoft Store.');
    app.innerHTML = '<section class="section"><div class="section-heading"><div><span class="eyebrow">اكتشاف أسهل</span><h1>الأقسام</h1><p>اختار القسم اللي يناسبك وشوف منتجاته المنشورة.</p></div></div><div class="loading-grid"><div class="loading-card"></div><div class="loading-card"></div></div></section>';
    const categories = state.categories.length ? state.categories : await api('/api/categories');
    if (requestId !== state.routeRequest) return;
    if (!Array.isArray(categories) || !categories.length) {
      app.innerHTML = `<section class="section"><div class="section-heading"><div><span class="eyebrow">اكتشاف أسهل</span><h1>الأقسام</h1></div></div>${emptyProducts('ماكو أقسام منشورة', 'راح تظهر الأقسام هنا بعد إضافتها من إدارة المتجر.')}</section>`;
      return;
    }
    app.innerHTML = `<section class="section"><div class="section-heading"><div><span class="eyebrow">اكتشاف أسهل</span><h1>الأقسام</h1><p>اختار القسم اللي يناسبك وشوف منتجاته المنشورة.</p></div><span class="result-count">${categories.length} أقسام</span></div><div class="category-grid">${categories.map(category => `<a class="category-card" href="${slugPath('/category', category.slug)}" data-route><span class="category-symbol" aria-hidden="true">◈</span><span><strong>${esc(category.name)}</strong><small>${esc(category.product_count ?? category.productCount ?? 0)} منتجات</small></span></a>`).join('')}</div></section>`;
  }
  async function renderCategory(slug, requestId) {
    setActiveNav('');
    const [categoryData, productsData] = await Promise.all([
      api('/api/categories/' + encodeURIComponent(slug)),
      api('/api/products?' + new URLSearchParams({ category: slug, limit: '48', offset: '0' }))
    ]);
    if (requestId !== state.routeRequest) return;
    const category = categoryData.item;
    if (!category) throw new Error('ما لكينا هالقسم.');
    const items = Array.isArray(productsData.items) ? productsData.items.filter(isPublicProduct) : [];
    setPageMeta(category.name, category.description || `منتجات منشورة ضمن قسم ${category.name} في HyperSoft Store.`, `/category/${encodeURIComponent(category.slug)}`);
    app.innerHTML = `<section class="section"><div class="breadcrumbs"><a href="/" data-route>الرئيسية</a><span aria-hidden="true">/</span><a href="/categories" data-route>الأقسام</a><span aria-hidden="true">/</span><span>${esc(category.name)}</span></div><div class="section-heading"><div><span class="eyebrow">قسم من الكتالوج</span><h1>${esc(category.name)}</h1><p>${esc(category.description || 'منتجات منشورة ضمن هذا القسم.')}</p></div><span class="result-count">${Number(productsData.total) || items.length} منتج</span></div>${items.length ? `<div class="product-grid">${cards(items)}</div>${Number(productsData.total) > items.length ? '<div class="load-more-wrap"><button class="load-more" id="category-more" type="button">عرض المزيد</button></div>' : ''}` : emptyProducts('القسم فارغ حالياً', 'ماكو منتجات منشورة بهذا القسم لحد الآن.')}</section>`;
    let offset = items.length;
    $('#category-more')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'دا نحمل...';
      try {
        const next = await api('/api/products?' + new URLSearchParams({ category: slug, limit: '48', offset: String(offset) }));
        if (requestId !== state.routeRequest) return;
        const nextItems = Array.isArray(next.items) ? next.items.filter(isPublicProduct) : [];
        $('.product-grid')?.insertAdjacentHTML('beforeend', cards(nextItems));
        offset += nextItems.length;
        if (offset >= Number(next.total || productsData.total) || !nextItems.length) button.remove();
        else { button.disabled = false; button.textContent = 'عرض المزيد'; }
      } catch (error) {
        button.disabled = false;
        button.textContent = 'حاول مرة ثانية';
        showError(error.message, renderRoute);
      }
    });
  }
  async function renderProduct(slug, requestId) {
    setActiveNav('');
    skeleton('تفاصيل المنتج');
    const item = await api('/api/products/' + encodeURIComponent(slug));
    if (requestId !== state.routeRequest) return;
    if (!isPublicProduct(item)) throw new Error('هذا المنتج غير متاح للزوار.');
    const relatedParams = new URLSearchParams({ limit: '4', offset: '0' });
    if (item.categorySlug) relatedParams.set('category', item.categorySlug);
    if (item.type) relatedParams.set('type', item.type);
    const relatedData = await api('/api/products?' + relatedParams).catch(() => ({ items: [] }));
    if (requestId !== state.routeRequest) return;
    const relatedItems = Array.isArray(relatedData.items) ? relatedData.items.filter(product => isPublicProduct(product) && product.slug !== item.slug) : [];
    setPageMeta(item.name, item.shortDescription || item.description || `${item.name} في HyperSoft Store.`, `/product/${encodeURIComponent(item.slug)}`);
    const imageUrl = safeImage(item.imageUrl);
    const image = imageUrl ? `<img class="detail-image" src="${esc(imageUrl)}" alt="${esc(item.name)}">` : `<div class="detail-image detail-image-placeholder" role="img" aria-label="${esc(item.name)}">${esc(Array.from(String(item.name || 'H').trim())[0] || 'H')}</div>`;
    const tags = [
      item.type === 'game' ? 'لعبة' : item.type === 'app' ? 'تطبيق' : '',
      item.version ? `الإصدار ${item.version}` : '',
      item.fileSize ? `الحجم ${item.fileSize}` : '',
      item.platform || ''
    ].filter(Boolean);
    const screenshots = Array.isArray(item.screenshots) ? item.screenshots.map(safeImage).filter(Boolean) : [];
    const releaseNotes = item.releaseNotes ? `<section class="detail-section"><h2>ملاحظات الإصدار</h2><div class="detail-text">${esc(item.releaseNotes)}</div></section>` : '';
    const updated = item.updatedAt || item.publishedAt;
    const updatedTag = updated && Number.isFinite(new Date(updated).getTime()) ? `<span class="detail-tag">آخر تحديث ${esc(new Date(updated).toLocaleDateString('ar-IQ'))}</span>` : '';
    const screenshotMarkup = screenshots.length ? `<section class="detail-section"><h2>لقطات من المنتج</h2><div class="screenshot-grid" aria-label="لقطات شاشة قابلة للتمرير">${screenshots.map((url, index) => `<button class="screenshot-button" type="button" data-screenshot="${esc(url)}" data-screenshot-alt="${esc(`${item.name} — لقطة ${index + 1}`)}" aria-label="تكبير لقطة ${index + 1} من ${esc(item.name)}"><img src="${esc(url)}" alt="${esc(item.name)} — لقطة ${index + 1}" loading="lazy" onerror="this.closest('button').remove()"></button>`).join('')}</div></section>` : '';
    app.innerHTML = `<article class="detail-page"><div class="breadcrumbs"><a href="/" data-route>الرئيسية</a><span aria-hidden="true">/</span><a href="${item.type === 'game' ? '/games' : '/apps'}" data-route>${item.type === 'game' ? 'الألعاب' : 'التطبيقات'}</a><span aria-hidden="true">/</span><span>${esc(item.name)}</span></div><div class="detail-panel"><div class="detail-top">${image}<div class="detail-copy"><span class="detail-category">${esc(item.category || (item.type === 'game' ? 'لعبة' : 'تطبيق'))}</span><h1>${esc(item.name)}</h1><p class="lead">${esc(item.shortDescription || item.description || 'ماكو وصف إضافي متوفر حالياً.')}</p><div class="detail-tags">${tags.map(tag => `<span class="detail-tag">${esc(tag)}</span>`).join('')}${ratingMarkup(item.rating)}${item.downloads > 0 ? `<span class="detail-tag">${esc(item.downloads)} تنزيل</span>` : ''}${updatedTag}</div><button class="download-button" type="button" id="download-product" ${item.hasDownload ? '' : 'disabled'}>${item.hasDownload ? 'تنزيل المنتج' : 'التنزيل غير متوفر حالياً'} <span aria-hidden="true">↓</span></button><p class="status-message" id="download-notice" hidden></p></div></div>${item.description ? `<section class="detail-section"><h2>عن المنتج</h2><div class="detail-text">${esc(item.description)}</div></section>` : ''}${item.developer ? `<section class="detail-section"><h2>المطوّر</h2><div class="detail-text">${esc(item.developer)}</div></section>` : ''}${releaseNotes}${screenshotMarkup}</div></article>${productSection('منتجات مشابهة', 'منتجات منشورة من النوع أو القسم نفسه.', relatedItems)}`;
    const downloadButton = $('#download-product');
    downloadButton.addEventListener('click', async () => {
      if (!item.hasDownload) return;
      const notice = $('#download-notice');
      downloadButton.disabled = true;
      downloadButton.textContent = 'دا نجهّز رابط التنزيل...';
      notice.hidden = true;
      try {
        const data = await api('/api/products/' + encodeURIComponent(slug) + '/download', { method: 'POST' });
        const url = new URL(data.url, location.origin);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('رابط التنزيل غير صالح.');
        location.assign(url.href);
      } catch (error) {
        notice.textContent = error.message || 'التنزيل مو متوفر حالياً.';
        notice.hidden = false;
        notice.classList.add('error');
        downloadButton.disabled = false;
        downloadButton.textContent = 'حاول مرة ثانية';
      }
    });
  }
  async function renderPost(slug, requestId) {
    setActiveNav('');
    skeleton('مشاركات المتجر');
    const post = await api('/api/posts/' + encodeURIComponent(slug));
    if (requestId !== state.routeRequest) return;
    if (!isPublicPost(post)) throw new Error('هالمشاركة مو منشورة.');
    setPageMeta(post.title, post.excerpt || `${post.title} — مشاركة منشورة من HyperSoft Store.`, `/post/${encodeURIComponent(post.slug)}`);
    const cover = safeImage(post.coverImage);
    app.innerHTML = `<article class="detail-page"><div class="breadcrumbs"><a href="/" data-route>الرئيسية</a><span aria-hidden="true">/</span><span>مشاركات المتجر</span></div><div class="detail-panel">${cover ? `<img class="post-detail-cover" src="${esc(cover)}" alt="${esc(post.title)}">` : ''}<header class="post-detail-head"><span class="detail-category">${esc(post.category || 'مشاركة')}</span><h1>${esc(post.title)}</h1>${post.excerpt ? `<p class="lead">${esc(post.excerpt)}</p>` : ''}</header><div class="post-detail-content">${esc(post.content || '')}</div></div></article>`;
  }
  async function renderRoute() {
    const requestId = ++state.routeRequest;
    closeMenu();
    const path = decodeURIComponent(location.pathname.replace(/\/+$/, '') || '/');
    const query = new URLSearchParams(location.search).get('q')?.trim() || '';
    $('#search-input').value = query;
    try {
      if (path === '/' && query) await renderCatalog('search', query, requestId);
      else if (path === '/') await renderHome(requestId);
      else if (path === '/search') await renderCatalog('search', query, requestId);
      else if (path === '/apps') await renderCatalog('app', query, requestId);
      else if (path === '/games') await renderCatalog('game', query, requestId);
      else if (path === '/popular') await renderCatalog('popular', query, requestId);
      else if (path === '/categories') await renderCategories(requestId);
      else if (path.startsWith('/category/')) await renderCategory(path.slice('/category/'.length), requestId);
      else if (path.startsWith('/product/')) await renderProduct(path.slice('/product/'.length), requestId);
      else if (path.startsWith('/post/')) await renderPost(path.slice('/post/'.length), requestId);
      else {
        app.innerHTML = `<section class="section">${emptyProducts('ما لكينا هالصفحة', 'تأكد من الرابط أو ارجع للصفحة الرئيسية.')}</section>`;
      }
    } catch (error) {
      if (requestId !== state.routeRequest) return;
      showError(error.message, renderRoute);
    }
    if (requestId === state.routeRequest) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function navigate(href) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    history.pushState({}, '', url.pathname + url.search);
    renderRoute();
  }
  document.addEventListener('click', event => {
    const screenshot = event.target.closest('button[data-screenshot]');
    if (screenshot) {
      openScreenshotViewer(screenshot.dataset.screenshot, screenshot.dataset.screenshotAlt || '');
      return;
    }
    const link = event.target.closest('a[data-route]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    event.preventDefault();
    navigate(link.href);
  });
  $('#search-form').addEventListener('submit', event => {
    event.preventDefault();
    const query = $('#search-input').value.trim();
    navigate(query ? '/search?q=' + encodeURIComponent(query) : '/');
  });
  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.contains('open') ? closeMenu() : openMenu());
  $('#sidebar-close').addEventListener('click', closeMenu);
  $('#mobile-overlay').addEventListener('click', closeMenu);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#sidebar').classList.contains('open')) {
      closeMenu();
      $('#menu-toggle').focus();
    }
  });
  window.addEventListener('popstate', renderRoute);
  async function loadStoreInfo() {
    try {
      const [config, categories] = await Promise.all([
        api('/api/config'),
        api('/api/categories').catch(() => [])
      ]);
      const name = config.name || 'HyperSoft Store';
      state.storeName = name;
      state.storeLink = config.link || location.origin;
      $('#store-name').textContent = name;
      const logo = safeImage(config.logo);
      if (logo) $('#store-logo').src = logo;
      state.categories = Array.isArray(categories) ? categories : [];
      updateCategoryNav();
    } catch {
      state.categories = [];
      updateCategoryNav();
    }
    try {
      const popular = await api('/api/products?sort=downloads&limit=12&offset=0');
      state.popularAvailable = Array.isArray(popular.items) && popular.items.some(item => counts(item) > 0);
      $('#popular-nav').hidden = !state.popularAvailable;
    } catch { $('#popular-nav').hidden = true; }
  }
  loadStoreInfo();
  renderRoute();
})();
