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
    const mainCat = isGame ? 'Games' : 'Apps';
    const canonicalIdentifier = item.packageName || item.slug;
    const canonicalUrl = item.detailUrl || `/category/${mainCat}/${encodeURIComponent(canonicalIdentifier)}`;
    const category = item.category
      ? `<span class="product-category">${escapeHtml(item.category)}</span>`
      : `<span class="product-category">${typeLabel}</span>`;
    const version = item.version
      ? `<span>الإصدار ${escapeHtml(item.version)}</span>`
      : '<span>متوفر بالمتجر</span>';
    const size = item.fileSize ? `<span>${escapeHtml(item.fileSize)}</span>` : '';

    return `
      <article class="product-card" data-slug="${escapeHtml(item.slug)}">
        <a class="product-image-wrap" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}" data-main-cat="${mainCat}" aria-label="فتح صفحة ${escapeHtml(item.name)}">
          ${image}
          ${item.featured ? '<span class="product-badge">مميّز</span>' : ''}
          <span class="product-type-badge">${typeLabel}</span>
        </a>
        <div class="product-body">
          <h3 class="product-title"><a href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">${escapeHtml(item.name)}</a></h3>
          <div class="product-rating" aria-label="${ratingLabel}">
            <span class="rating-value">${ratingText}</span>
            <span class="rating-stars" role="img" aria-label="${ratingLabel}">${stars}</span>
          </div>
          <a class="product-link" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">تحميل <span aria-hidden="true">←</span></a>
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

  let heroSliderTimer = null;
  let heroCurrentSlide = 0;
  let heroSlidesCount = 0;

  function setHeroSlide(index) {
    const slides = $$('.hero-slide');
    const dots = $$('.hero-dot');
    if (!slides.length) return;
    heroCurrentSlide = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === heroCurrentSlide);
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === heroCurrentSlide);
    });
  }

  function startHeroTimer() {
    if (heroSliderTimer) clearInterval(heroSliderTimer);
    if (heroSlidesCount > 1) {
      heroSliderTimer = setInterval(() => {
        setHeroSlide(heroCurrentSlide + 1);
      }, 5500);
    }
  }

  function initHeroSlider(featuredItems) {
    const slider = $('#hero-slider');
    const dotsContainer = $('#hero-dots');
    if (!slider || !dotsContainer) return;

    if (!Array.isArray(featuredItems) || !featuredItems.length) {
      dotsContainer.hidden = true;
      heroSlidesCount = 0;
      return;
    }

    heroSlidesCount = featuredItems.length;
    const slidesHtml = featuredItems.map((item, index) => {
      const isGame = item.type === 'game';
      const mainCat = isGame ? 'Games' : 'Apps';
      const canonicalIdentifier = item.packageName || item.slug;
      const canonicalUrl = item.detailUrl || `/category/${mainCat}/${encodeURIComponent(canonicalIdentifier)}`;
      const typeLabel = isGame ? '🎮 لعبة مميزة' : '📱 تطبيق مميز';
      const icon = item.imageUrl
        ? `<img class="hero-item-icon" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" onerror="this.src='/Logo.png'">`
        : `<div class="hero-item-icon-ph">${iconFor(item.name)}</div>`;
      const bgStyle = item.coverImage
        ? `background-image: linear-gradient(135deg, rgba(16, 107, 59, 0.92) 0%, rgba(23, 26, 24, 0.88) 100%), url('${escapeHtml(item.coverImage)}'); background-size: cover; background-position: center;`
        : `background: linear-gradient(135deg, #106b3b 0%, #171a18 100%);`;

      return `
        <div class="hero-slide ${index === 0 ? 'active' : ''}" style="${bgStyle}" data-slide-index="${index}">
          <div class="hero-slide-body">
            <div class="hero-slide-content">
              <span class="hero-slide-badge">${typeLabel}</span>
              <h2 class="hero-slide-title">${escapeHtml(item.name)}</h2>
              <p class="hero-slide-desc">${escapeHtml(item.shortDescription || item.description || 'تطبيق مميز متوفر للتحميل المباشر والآمن.')}</p>
              <div class="hero-slide-actions">
                <a class="hero-button" href="/product/${encodeURIComponent(item.slug)}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">
                  <span>تحميل</span>
                  <span aria-hidden="true">←</span>
                </a>
                <button class="hero-pill-btn hero-pill-light" type="button" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">
                  استعراض التفاصيل
                </button>
              </div>
            </div>
            <div class="hero-slide-art">
              ${icon}
            </div>
          </div>
        </div>
      `;
    }).join('');

    slider.innerHTML = slidesHtml;

    if (featuredItems.length > 1) {
      dotsContainer.innerHTML = featuredItems.map((_, i) => `
        <button class="hero-dot ${i === 0 ? 'active' : ''}" type="button" data-slide="${i}" aria-label="الشريحة ${i + 1}"></button>
      `).join('');
      dotsContainer.hidden = false;
      startHeroTimer();
    } else {
      dotsContainer.hidden = true;
    }
  }

  function renderSnapCard(item, rankIndex = null) {
    const slug = encodeURIComponent(item.slug);
    const isGame = item.type === 'game';
    const mainCat = isGame ? 'Games' : 'Apps';
    const canonicalIdentifier = item.packageName || item.slug;
    const canonicalUrl = item.detailUrl || `/category/${mainCat}/${encodeURIComponent(canonicalIdentifier)}`;
    const image = item.imageUrl
      ? `<img class="snap-card-img" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='/Logo.png'">`
      : `<div class="snap-card-ph" aria-hidden="true">${iconFor(item.name)}</div>`;

    const rating = item.rating == null || !Number.isFinite(Number(item.rating))
      ? null
      : Math.max(0, Math.min(5, Number(item.rating)));
    const ratingText = rating == null ? '' : `${rating.toFixed(1)} ★`;

    const rankBadge = rankIndex != null && rankIndex < 3
      ? `<span class="snap-rank-badge rank-${rankIndex + 1}">${rankIndex + 1}</span>`
      : '';

    return `
      <article class="snap-card" data-slug="${escapeHtml(item.slug)}">
        <a class="snap-card-inner" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}" aria-label="عرض ${escapeHtml(item.name)}">
          <div class="snap-icon-wrap">
            ${image}
            ${rankBadge}
          </div>
          <span class="snap-card-title">${escapeHtml(item.name)}</span>
          ${ratingText ? `<span class="snap-card-rating">${escapeHtml(ratingText)}</span>` : `<span class="snap-card-cat">${escapeHtml(item.category || (isGame ? 'ألعاب' : 'تطبيقات'))}</span>`}
        </a>
      </article>
    `;
  }

  function renderEditorCard(item) {
    const slug = encodeURIComponent(item.slug);
    const isGame = item.type === 'game';
    const mainCat = isGame ? 'Games' : 'Apps';
    const canonicalIdentifier = item.packageName || item.slug;
    const canonicalUrl = item.detailUrl || `/category/${mainCat}/${encodeURIComponent(canonicalIdentifier)}`;
    const icon = item.imageUrl
      ? `<img class="editor-thumb-img" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" onerror="this.src='/Logo.png'">`
      : `<div class="editor-thumb-ph">${iconFor(item.name)}</div>`;
    
    const bannerImg = item.coverImage
      ? `<img class="editor-banner-art" src="${escapeHtml(item.coverImage)}" alt="" loading="lazy" onerror="this.remove()">`
      : `<div class="editor-banner-ph"><span class="editor-ph-tag">${isGame ? '🎮 لعبة' : '📱 تطبيق'}</span></div>`;

    const rating = item.rating == null || !Number.isFinite(Number(item.rating))
      ? null
      : Math.max(0, Math.min(5, Number(item.rating)));
    const ratingText = rating == null ? '' : `${rating.toFixed(1)} ★`;

    return `
      <article class="editor-card" data-slug="${escapeHtml(item.slug)}">
        <a class="editor-banner-wrap" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">
          ${bannerImg}
        </a>
        <div class="editor-card-footer">
          <a class="editor-footer-info" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">
            ${icon}
            <div class="editor-text-wrap">
              <span class="editor-title">${escapeHtml(item.name)}</span>
              <div class="editor-sub-meta">
                ${ratingText ? `<span class="editor-rating">${ratingText}</span>` : ''}
                <span class="editor-cat">${escapeHtml(item.category || (isGame ? 'ألعاب' : 'تطبيقات'))}</span>
              </div>
            </div>
          </a>
          <a class="editor-dl-btn" href="/product/${slug}" data-product="${escapeHtml(item.slug)}" data-canonical="${escapeHtml(canonicalUrl)}">
            تحميل
          </a>
        </div>
      </article>
    `;
  }

  async function loadShowcaseSections() {
    // 1. Featured items for Hero Slider, Discovery, and Featured Grid
    try {
      const r = await fetch('/api/products?featured=true&limit=10', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const fSec = $('#featured-section');
        const fGrid = $('#featured-grid');
        const dSec = $('#discovery-section');
        const dGrid = $('#discovery-grid');

        if (d.items && d.items.length) {
          initHeroSlider(d.items.slice(0, 5));

          if (dGrid && dSec) {
            dGrid.innerHTML = d.items.map(item => renderSnapCard(item)).join('');
            dSec.hidden = false;
          }

          if (fGrid && fSec) {
            fGrid.innerHTML = d.items.map(productCard).join('');
            fSec.hidden = false;
          }
        } else {
          if (dSec) dSec.hidden = true;
          if (fSec) fSec.hidden = true;
        }
      }
    } catch {}

    // 2. Popular Games in 24h
    try {
      const r = await fetch('/api/products?type=game&sort=downloads&limit=12', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const popGamesSec = $('#popular-games-section');
        const popGamesGrid = $('#popular-games-grid');
        const gSec = $('#games-section');
        const gGrid = $('#games-grid');

        if (d.items && d.items.length) {
          if (popGamesGrid && popGamesSec) {
            popGamesGrid.innerHTML = d.items.map((item, idx) => renderSnapCard(item, idx)).join('');
            popGamesSec.hidden = false;
          }
          if (gGrid && gSec) {
            gGrid.innerHTML = d.items.slice(0, 4).map(productCard).join('');
            gSec.hidden = false;
          }
        } else {
          if (popGamesSec) popGamesSec.hidden = true;
          if (gSec) gSec.hidden = true;
        }
      }
    } catch {}

    // 3. Popular Apps in 24h
    try {
      const r = await fetch('/api/products?type=app&sort=downloads&limit=12', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const popAppsSec = $('#popular-apps-section');
        const popAppsGrid = $('#popular-apps-grid');
        const aSec = $('#apps-section');
        const aGrid = $('#apps-grid');

        if (d.items && d.items.length) {
          if (popAppsGrid && popAppsSec) {
            popAppsGrid.innerHTML = d.items.map((item, idx) => renderSnapCard(item, idx)).join('');
            popAppsSec.hidden = false;
          }
          if (aGrid && aSec) {
            aGrid.innerHTML = d.items.slice(0, 4).map(productCard).join('');
            aSec.hidden = false;
          }
        } else {
          if (popAppsSec) popAppsSec.hidden = true;
          if (aSec) aSec.hidden = true;
        }
      }
    } catch {}

    // 4. Editor's Choice Section (top rating or featured items with covers)
    try {
      const r = await fetch('/api/products?sort=rating&limit=6', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const edSec = $('#editors-choice-section');
        const edGrid = $('#editors-choice-grid');
        const ratedItems = (d.items || []).filter(i => i.rating != null);
        if (ratedItems.length && edSec && edGrid) {
          edGrid.innerHTML = ratedItems.map(renderEditorCard).join('');
          edSec.hidden = false;
        } else if (d.items && d.items.length && edSec && edGrid) {
          edGrid.innerHTML = d.items.slice(0, 4).map(renderEditorCard).join('');
          edSec.hidden = false;
        } else if (edSec) {
          edSec.hidden = true;
        }
      }
    } catch {}

    // 5. Most Downloaded Section (standard rows)
    try {
      const r = await fetch('/api/products?sort=downloads&limit=4', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const d = await r.json();
        const dSec = $('#downloads-section');
        const dGrid = $('#downloads-grid');
        const popularItems = (d.items || []).filter(item => (item.downloads || 0) > 0);
        if (popularItems.length && dGrid && dSec) {
          dGrid.innerHTML = popularItems.map(productCard).join('');
          dSec.hidden = false;
        } else if (dSec) {
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
    previewGrid.innerHTML = cats.map(cat => {
      const isMain = cat.slug === 'Apps' || cat.slug === 'Games';
      const badgeText = cat.slug === 'Apps' ? 'قسم رئيسي: تطبيقات' : cat.slug === 'Games' ? 'قسم رئيسي: ألعاب' : (cat.parentSlug === 'Apps' ? 'تطبيقات' : cat.parentSlug === 'Games' ? 'ألعاب' : '');
      const badgeStyle = isMain ? 'background:#eaf5ee;color:#16834a;' : (cat.parentSlug === 'Games' ? 'background:#f5f3ff;color:#7c3aed;' : 'background:#f0fdf4;color:#15803d;');
      return `
      <article class="category-card" data-category-slug="${escapeHtml(cat.slug)}" data-parent-slug="${escapeHtml(cat.parentSlug || '')}">
        <div class="cat-card-top">
          <div class="cat-card-icon">${escapeHtml(cat.icon || (cat.slug === 'Games' || cat.parentSlug === 'Games' ? '🎮' : '📱'))}</div>
          <span class="cat-card-badge">${Number(cat.product_count) || 0} منتج</span>
        </div>
        <h3>${escapeHtml(cat.name)}</h3>
        ${badgeText ? `<span class="category-parent-tag" style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;${badgeStyle}margin-bottom:8px">${escapeHtml(badgeText)}</span>` : ''}
        <p>${escapeHtml(cat.description || 'تصفح التطبيقات والألعاب التابعة لهذا القسم.')}</p>
      </article>`;
    }).join('');
    $('#categories-preview-section').hidden = false;
  }

  function renderAllCategoriesView() {
    const allGrid = $('#all-categories-grid');
    if (!allGrid) return;
    if (!state.categories.length) {
      allGrid.innerHTML = '<p class="muted">لا توجد أقسام مسجلة حالياً.</p>';
      return;
    }
    const mainCats = state.categories.filter(c => c.slug === 'Apps' || c.slug === 'Games');
    const appsSub = state.categories.filter(c => c.parentSlug === 'Apps' && c.slug !== 'Apps');
    const gamesSub = state.categories.filter(c => c.parentSlug === 'Games' && c.slug !== 'Games');
    const others = state.categories.filter(c => !['Apps', 'Games'].includes(c.slug) && !['Apps', 'Games'].includes(c.parentSlug));

    function cardHtml(cat) {
      const isMain = cat.slug === 'Apps' || cat.slug === 'Games';
      const badgeText = cat.slug === 'Apps' ? 'قسم رئيسي: تطبيقات' : cat.slug === 'Games' ? 'قسم رئيسي: ألعاب' : (cat.parentSlug === 'Apps' ? 'تطبيقات' : cat.parentSlug === 'Games' ? 'ألعاب' : '');
      const badgeStyle = isMain ? 'background:#eaf5ee;color:#16834a;' : (cat.parentSlug === 'Games' ? 'background:#f5f3ff;color:#7c3aed;' : 'background:#f0fdf4;color:#15803d;');
      return `
        <article class="category-card" data-category-slug="${escapeHtml(cat.slug)}" data-parent-slug="${escapeHtml(cat.parentSlug || '')}">
          <div class="cat-card-top">
            <div class="cat-card-icon">${escapeHtml(cat.icon || (cat.slug === 'Games' || cat.parentSlug === 'Games' ? '🎮' : '📱'))}</div>
            <span class="cat-card-badge">${Number(cat.product_count) || 0} منتج</span>
          </div>
          <h3>${escapeHtml(cat.name)}</h3>
          ${badgeText ? `<span class="category-parent-tag" style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;${badgeStyle}margin-bottom:8px">${escapeHtml(badgeText)}</span>` : ''}
          <p>${escapeHtml(cat.description || 'تصفح التطبيقات والألعاب التابعة لهذا القسم.')}</p>
        </article>`;
    }

    let html = '';
    if (mainCats.length) {
      html += `<div style="grid-column:1/-1;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700;color:var(--text);margin:0 0 4px">الأقسام الرئيسية</h3><p style="font-size:13px;color:var(--muted);margin:0">الأقسام الأساسية التي يتفرع منها المتجر</p></div>`;
      html += mainCats.map(cardHtml).join('');
    }
    if (appsSub.length) {
      html += `<div style="grid-column:1/-1;margin-top:24px;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700;color:var(--text);margin:0 0 4px">📱 تصنيفات التطبيقات</h3><p style="font-size:13px;color:var(--muted);margin:0">أقسام متخصصة تابعة لقسم التطبيقات</p></div>`;
      html += appsSub.map(cardHtml).join('');
    }
    if (gamesSub.length) {
      html += `<div style="grid-column:1/-1;margin-top:24px;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700;color:var(--text);margin:0 0 4px">🎮 تصنيفات الألعاب</h3><p style="font-size:13px;color:var(--muted);margin:0">أقسام متخصصة تابعة لقسم الألعاب</p></div>`;
      html += gamesSub.map(cardHtml).join('');
    }
    if (others.length) {
      html += `<div style="grid-column:1/-1;margin-top:24px;margin-bottom:8px"><h3 style="font-size:18px;font-weight:700;color:var(--text);margin:0 0 4px">أقسام أخرى</h3></div>`;
      html += others.map(cardHtml).join('');
    }
    allGrid.innerHTML = html;
  }

  async function showCategoryDedicatedView(slug, parentSlug = null, initialItems = null) {
    switchToView('category');
    let cat = state.categories.find(c => c.slug === slug);
    if (!cat && (slug === 'Apps' || slug === 'Games')) {
      cat = { name: slug === 'Apps' ? 'تطبيقات Android' : 'ألعاب Android', slug, description: slug === 'Apps' ? 'تصفح كافة التطبيقات وأدوات الإنتاجية.' : 'تصفح أحدث وأقوى الألعاب الرقمية.', icon: slug === 'Apps' ? '📱' : '🎮', product_count: 0 };
    }
    const catName = cat ? cat.name : slug;
    const effectiveParent = parentSlug || cat?.parentSlug || '';
    const parentBadge = effectiveParent ? ` (ضمن ${effectiveParent === 'Apps' ? 'التطبيقات' : 'الألعاب'})` : '';
    $('#cat-view-title').textContent = catName + parentBadge;
    $('#cat-view-desc').textContent = cat?.description || 'تصفح أحدث التطبيقات والألعاب ضمن هذا القسم.';
    $('#cat-view-icon').textContent = cat?.icon || (effectiveParent === 'Games' || slug === 'Games' ? '🎮' : '📱');
    $('#cat-view-count').textContent = cat?.product_count ? `${cat.product_count} منتج منشور` : '';

    const catGrid = $('#category-products-grid');
    const statusMsg = $('#category-status-message');
    statusMsg.hidden = true;

    if (Array.isArray(initialItems)) {
      if (!initialItems.length) {
        catGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">◈</div><h3>ماكو منتجات بهذا القسم حالياً</h3><p>تابعنا، راح نضيف تطبيقات وألعاب جديدة قريباً.</p></div>';
      } else {
        catGrid.innerHTML = initialItems.map(productCard).join('');
      }
      return;
    }

    catGrid.innerHTML = '<div class="loading-card"></div><div class="loading-card"></div>';

    try {
      const type = $('.cat-tab-btn.active')?.dataset.catType || (effectiveParent === 'Games' || slug === 'Games' ? 'game' : (effectiveParent === 'Apps' || slug === 'Apps' ? 'app' : ''));
      const sort = $('#cat-sort-select')?.value || 'newest';
      const params = new URLSearchParams({ limit: '40' });
      if (slug !== 'Apps' && slug !== 'Games') {
        params.set('category', slug);
      }
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

  async function resolveCatalogRoute(mainCat, secondPart) {
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(mainCat)}/${encodeURIComponent(secondPart)}`);
      if (!res.ok) {
        showProductDetails(secondPart);
        return;
      }
      const data = await res.json();
      if (data.type === 'post' && data.post) {
        showProductDetails(data.post.slug, data.post);
      } else if (data.type === 'subcategory' && data.category) {
        showCategoryDedicatedView(data.category.slug, data.category.parentSlug, data.items);
      } else {
        switchToView('main');
      }
    } catch {
      showProductDetails(secondPart);
    }
  }

  function showMainCategoryView(mainCat) {
    const isGame = String(mainCat).toLowerCase() === 'games';
    selectStoreTab(isGame ? 'games' : 'apps', false);
  }

  function selectStoreTab(tab, updateUrl = true) {
    $$('.store-nav-link').forEach(btn => btn.classList.toggle('active', (btn.dataset.storeTab || '') === tab));
    if (tab === 'categories') {
      if (updateUrl) history.pushState({ view: 'categories' }, '', '/categories');
      switchToView('categories');
      return;
    }
    if (tab === 'apps') {
      if (updateUrl) history.pushState({ mainCat: 'Apps' }, '', '/category/Apps');
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
      if (updateUrl) history.pushState({ mainCat: 'Games' }, '', '/category/Games');
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
      if (updateUrl && location.pathname !== '/') history.pushState({}, '', '/');
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
      if (updateUrl && location.pathname !== '/') history.pushState({}, '', '/');
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
      if (updateUrl && location.pathname !== '/') history.pushState({}, '', '/');
      switchToView('main');
      $('#posts-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Default Home
    if (updateUrl && location.pathname !== '/') history.pushState({}, '', '/');
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
      const parent = catCard.dataset.parentSlug;
      let targetUrl = '/category/' + encodeURIComponent(slug);
      if (slug === 'Apps' || slug.toLowerCase() === 'apps') {
        targetUrl = '/category/Apps';
      } else if (slug === 'Games' || slug.toLowerCase() === 'games') {
        targetUrl = '/category/Games';
      } else if (parent === 'Apps' || parent === 'Games') {
        targetUrl = `/category/${parent}/${encodeURIComponent(slug)}`;
      }
      history.pushState({ category: slug, parentSlug: parent }, '', targetUrl);
      showCategoryDedicatedView(slug, parent);
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

    // 7. Hero dots navigation
    const heroDot = event.target.closest('.hero-dot');
    if (heroDot) {
      event.preventDefault();
      const dotIndex = Number(heroDot.dataset.slide) || 0;
      setHeroSlide(dotIndex);
      startHeroTimer();
      return;
    }

    // 7b. View all categories button
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
      const scrollParent = shotBtn.closest('.detail-screenshots-scroll');
      const allShots = scrollParent
        ? Array.from(scrollParent.querySelectorAll('.screenshot-thumb-btn')).map(b => b.dataset.fullImg)
        : [shotBtn.dataset.fullImg];
      const idx = Number(shotBtn.dataset.shotIdx) || 0;
      openScreenshotLightbox(allShots, idx);
      return;
    }

    // 11b. Category badge click in details -> filter by category
    const catBadge = event.target.closest('[data-filter-cat]');
    if (catBadge) {
      event.preventDefault();
      const catName = catBadge.dataset.filterCat;
      const dlg = $('#product-dialog');
      if (dlg) dlg.close();
      const matched = state.categories.find(c => c.name === catName || c.slug === catName);
      if (matched) {
        const parent = matched.parentSlug || (matched.slug === 'Apps' ? '' : matched.slug === 'Games' ? '' : '');
        let targetUrl = '/category/' + encodeURIComponent(matched.slug);
        if (matched.slug === 'Apps') targetUrl = '/category/Apps';
        else if (matched.slug === 'Games') targetUrl = '/category/Games';
        else if (parent === 'Apps' || parent === 'Games') targetUrl = `/category/${parent}/${encodeURIComponent(matched.slug)}`;
        history.pushState({ category: matched.slug, parentSlug: parent }, '', targetUrl);
        showCategoryDedicatedView(matched.slug, parent);
      } else {
        selectCategory(catName, catName);
      }
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

  const lightboxState = {
    images: [],
    index: 0,
    savedScrollY: 0
  };

  function updateLightboxImage() {
    const img = $('#lightbox-img');
    const counter = $('#lightbox-counter');
    if (!img || !lightboxState.images.length) return;
    const currentUrl = lightboxState.images[lightboxState.index];
    img.src = currentUrl;
    if (counter) counter.textContent = `${lightboxState.index + 1} / ${lightboxState.images.length}`;
  }

  function openScreenshotLightbox(images, startIndex = 0) {
    const box = $('#screenshot-lightbox');
    if (!box || !images.length) return;
    lightboxState.images = images;
    lightboxState.index = Math.max(0, Math.min(startIndex, images.length - 1));
    lightboxState.savedScrollY = window.scrollY;
    updateLightboxImage();
    box.hidden = false;
  }

  function closeScreenshotLightbox() {
    const box = $('#screenshot-lightbox');
    if (box) {
      box.hidden = true;
      window.scrollTo({ top: lightboxState.savedScrollY, behavior: 'instant' });
    }
  }

  function lightboxNext() {
    if (!lightboxState.images.length) return;
    lightboxState.index = (lightboxState.index + 1) % lightboxState.images.length;
    updateLightboxImage();
  }

  function lightboxPrev() {
    if (!lightboxState.images.length) return;
    lightboxState.index = (lightboxState.index - 1 + lightboxState.images.length) % lightboxState.images.length;
    updateLightboxImage();
  }

  $('#lightbox-close')?.addEventListener('click', closeScreenshotLightbox);
  $('#lightbox-backdrop')?.addEventListener('click', closeScreenshotLightbox);
  $('#lightbox-next')?.addEventListener('click', lightboxNext);
  $('#lightbox-prev')?.addEventListener('click', lightboxPrev);

  document.addEventListener('keydown', (e) => {
    const box = $('#screenshot-lightbox');
    if (!box || box.hidden) return;
    if (e.key === 'Escape') closeScreenshotLightbox();
    else if (e.key === 'ArrowRight') lightboxPrev();
    else if (e.key === 'ArrowLeft') lightboxNext();
  });

  function renderBlocksSafe(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return '';
    return blocks.map(b => {
      const align = ['right', 'center', 'left'].includes(b.align) ? b.align : 'right';
      const color = (b.color && /^#[0-9a-f]{3,8}$/i.test(b.color)) ? `color:${b.color};` : '';
      const style = `text-align:${align};${color}`;
      if (b.type === 'h2') {
        return `<h2 class="detail-block-h2" style="${style}">${escapeHtml(b.text || '')}</h2>`;
      }
      if (b.type === 'h3') {
        return `<h3 class="detail-block-h3" style="${style}">${escapeHtml(b.text || '')}</h3>`;
      }
      if (b.type === 'p') {
        return `<p class="detail-block-p" style="${style}">${escapeHtml(b.text || '').replace(/\n/g, '<br>')}</p>`;
      }
      if (b.type === 'image' && b.url) {
        return `
          <figure class="detail-block-figure" style="text-align:${align};margin:16px 0">
            <img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.caption || '')}" loading="lazy" style="max-width:100%;border-radius:12px">
            ${b.caption ? `<figcaption style="font-size:11px;color:#66716a;margin-top:6px;${color}">${escapeHtml(b.caption)}</figcaption>` : ''}
          </figure>
        `;
      }
      if (b.type === 'video' && b.url) {
        const u = b.url;
        if (u.includes('youtube.com') || u.includes('youtu.be')) {
          const id = u.includes('youtu.be') ? u.split('/').pop().split('?')[0] : (new URL(u, 'https://youtube.com').searchParams.get('v') || '');
          return `<div class="detail-block-video" style="text-align:${align};margin:16px 0"><iframe width="100%" height="320" src="https://www.youtube.com/embed/${escapeHtml(id)}" frameborder="0" allowfullscreen style="border-radius:12px"></iframe></div>`;
        }
        return `<div class="detail-block-video" style="text-align:${align};margin:16px 0"><video controls src="${escapeHtml(u)}" style="max-width:100%;border-radius:12px"></video></div>`;
      }
      return '';
    }).join('');
  }

  /* Dedicated Product Details View */
  async function showProductDetails(slug, preloadedPost = null) {
    try {
      let item = preloadedPost;
      if (!item) {
        const response = await fetch('/api/products/' + encodeURIComponent(slug));
        item = await response.json();
        if (!response.ok) throw new Error(item.message || 'ما لكينا هالمنتج.');
      }

      document.title = `${item.name} | Store`;

      const isGame = item.type === 'game';
      const mainCat = isGame ? 'Games' : 'Apps';
      const identifier = item.packageName || item.slug;
      const canonicalUrl = item.detailUrl || `/category/${mainCat}/${encodeURIComponent(identifier)}`;
      if (window.history.replaceState) {
        history.replaceState({ product: slug, canonical: canonicalUrl }, '', canonicalUrl);
      }

      let dialog = $('#product-dialog');
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'product-dialog';
        dialog.className = 'product-dialog';
        document.body.appendChild(dialog);
      }

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
            <h3>لقطات الشاشة والمعاينة (${item.screenshots.length})</h3>
            <div class="detail-screenshots-scroll">
              ${item.screenshots.map((s, idx) => `
                <button type="button" class="screenshot-thumb-btn" data-full-img="${escapeHtml(s)}" data-shot-idx="${idx}" title="اضغط للتكبير في وضع المعاينة (Lightbox)">
                  <img src="${escapeHtml(s)}" alt="لقطة شاشة ${idx + 1}" loading="lazy" onerror="this.parentElement.remove()">
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

      // Categories badges
      const categoriesList = Array.isArray(item.categories) && item.categories.length
        ? item.categories
        : (item.category ? [item.category] : []);
      const categoriesBadges = categoriesList.map(c => `
        <button type="button" class="detail-category-badge" data-filter-cat="${escapeHtml(c)}" title="تصفية حسب قسم ${escapeHtml(c)}">${escapeHtml(c)}</button>
      `).join('');

      // Blocks description
      const blocksRendered = renderBlocksSafe(item.contentBlocks);
      const descriptionContent = blocksRendered || `
        <p class="detail-description">${escapeHtml(item.description || item.shortDescription || 'لا يتوفر وصف إضافي لهذا المنتج حالياً.')}</p>
      `;

      dialog.innerHTML = `
        <button class="dialog-close" type="button" aria-label="إغلاق">×</button>
        <button class="dialog-share" id="share-product-btn" type="button" title="مشاركة الرابط" aria-label="مشاركة رابط المنتج">➦</button>
        <div class="detail-modal-body">
          <div class="detail-header-card">
            ${icon}
            <div class="detail-header-info">
              <div class="detail-badges-row">
                ${categoriesBadges}
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
            <div class="detail-rich-content">
              ${descriptionContent}
            </div>
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
              <div class="spec-item"><span>الأقسام</span><span>${escapeHtml(categoriesList.join('، ') || 'عام')}</span></div>
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
        if (location.pathname.startsWith('/product/') || location.pathname.match(/^\/category\/(Apps|Games)\/[^/]+/i)) {
          history.pushState({}, '', '/');
        }
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

  // Unified Route Resolver
  function resolveRoute(path) {
    const productMatch = path.match(/^\/product\/([^/]+)/);
    const catalogSubMatch = path.match(/^\/category\/(Apps|Games)\/([^/]+)/i);
    const mainCatMatch = path.match(/^\/category\/(Apps|Games)\/?$/i);
    const categoryMatch = path.match(/^\/category\/([^/]+)/);

    if (productMatch) {
      showProductDetails(decodeURIComponent(productMatch[1]));
    } else if (catalogSubMatch) {
      const mainCat = catalogSubMatch[1].toLowerCase() === 'games' ? 'Games' : 'Apps';
      const secondPart = decodeURIComponent(catalogSubMatch[2]);
      resolveCatalogRoute(mainCat, secondPart);
    } else if (mainCatMatch) {
      const mainCat = mainCatMatch[1].toLowerCase() === 'games' ? 'Games' : 'Apps';
      showMainCategoryView(mainCat);
    } else if (categoryMatch) {
      showCategoryDedicatedView(decodeURIComponent(categoryMatch[1]));
    } else if (path === '/categories') {
      switchToView('categories');
    } else {
      const dialog = $('#product-dialog');
      if (dialog?.open) dialog.close();
      switchToView('main');
    }
  }

  // Popstate Routing
  window.addEventListener('popstate', () => {
    resolveRoute(location.pathname);
  });

  // Initial Boot
  loadConfig();
  loadPosts();
  loadCategories();
  loadShowcaseSections();
  loadProducts();

  resolveRoute(location.pathname);
})();
