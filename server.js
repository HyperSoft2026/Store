const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_NAME = process.env.STORE_NAME || 'Store';
const STORE_LOGO = process.env.STORE_LOGO || '/Logo.png';
const STORE_LINK = (process.env.STORE_LINK || '').replace(/\/$/, '');

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PATH = (function (value) {
  value = String(value || '').trim();
  return /^\/[A-Za-z0-9_-]{12,100}$/.test(value) ? value : '';
})(process.env.ADMIN_LINK || '');
const ADMIN_COOKIE = 'store_admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const item of raw.split(';')) {
    const pair = item.trim().split('=');
    if (pair.shift() === name) { try { return decodeURIComponent(pair.join('=')); } catch { return ''; } }
  }
  return '';
}
async function getAdminSession(req) {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token || !pool || !databaseReady) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query('SELECT csrf_token, expires_at FROM store_admin_sessions WHERE token_hash=$1 AND expires_at>NOW()', [tokenHash]);
  if (!result.rowCount) return null;
  return { tokenHash, session: { csrfToken: result.rows[0].csrf_token, expiresAt: new Date(result.rows[0].expires_at).getTime() } };
}
async function requireAdmin(req, res, next) {
  try {
    const current = await getAdminSession(req);
    if (!current) return res.status(401).json({ error: 'unauthorized', message: 'سجّل دخولك أولاً.' });
    req.adminSession = current.session;
    req.adminTokenHash = current.tokenHash;
    next();
  } catch (error) { next(error); }
}
function requireAdminCsrf(req, res, next) {
  const sent = String(req.headers['x-csrf-token'] || '');
  const expected = String(req.adminSession && req.adminSession.csrfToken || '');
  const sentBytes = Buffer.from(sent, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (!sent || !expected || sentBytes.length !== expectedBytes.length ||
      !crypto.timingSafeEqual(sentBytes, expectedBytes)) {
    return res.status(403).json({ error: 'csrf_failed', message: 'انتهت صلاحية الطلب. حدّث الصفحة وجرّب.' });
  }
  next();
}
function adminText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function adminSlug(value) {
  return adminText(value, 180).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 160);
}

function safeScreenshots(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(s => String(s || '').trim()).filter(Boolean);
  } catch {}
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function parsePost(body) {
  const title = adminText(body.title || body.name, 180);
  const slug = adminSlug(body.slug || title);
  const cover = adminText(body.coverImage || body.cover, 1500);
  const iconUrl = adminText(body.iconUrl || body.imageUrl || body.icon, 1500);
  const type = body.type === 'game' ? 'game' : 'app';
  const rawPkg = adminText(body.packageName || body.package_name, 255).trim();
  let packageName = '';
  if (rawPkg) {
    packageName = rawPkg.toLowerCase();
    const pkgRegex = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
    if (!pkgRegex.test(packageName)) {
      return { error: 'اسم الحزمة (Package Name) غير صالح. يجب أن يبدأ بحرف ويحتوي على نقطة واحدة على الأقل، مثل: com.example.app' };
    }
  }
  const developer = adminText(body.developer, 180);
  const version = adminText(body.version, 80);
  const fileSize = adminText(body.fileSize, 80);
  const downloadUrl = adminText(body.downloadUrl, 2000);
  const apkFileUrl = adminText(body.apkFileUrl, 2000);
  const rating = body.rating === '' || body.rating == null ? null : Number(body.rating);
  const isFeatured = body.featured === true || body.isFeatured === true;
  const status = body.status === 'published' ? 'published' : 'draft';

  let categories = '[]';
  if (Array.isArray(body.categories)) {
    categories = JSON.stringify(body.categories.map(c => adminText(c, 100)).filter(Boolean));
  } else if (typeof body.categories === 'string' && body.categories.trim()) {
    try {
      const arr = JSON.parse(body.categories);
      categories = JSON.stringify(Array.isArray(arr) ? arr.map(c => adminText(c, 100)).filter(Boolean) : []);
    } catch {
      categories = JSON.stringify(body.categories.split(/[\n,]+/).map(c => adminText(c, 100)).filter(Boolean));
    }
  }

  let primaryCategory = adminText(body.category, 100);
  if (!primaryCategory) {
    try {
      const parsedCats = JSON.parse(categories);
      if (parsedCats.length > 0) primaryCategory = parsedCats[0];
    } catch {}
  }

  let screenshots = '[]';
  if (Array.isArray(body.screenshots)) {
    screenshots = JSON.stringify(body.screenshots.map(s => adminText(s, 1500)).filter(Boolean).slice(0, 20));
  } else if (typeof body.screenshots === 'string' && body.screenshots.trim()) {
    try {
      const arr = JSON.parse(body.screenshots);
      screenshots = JSON.stringify(Array.isArray(arr) ? arr.map(s => adminText(s, 1500)).filter(Boolean).slice(0, 20) : []);
    } catch {
      screenshots = JSON.stringify(body.screenshots.split(/[\n,]+/).map(s => adminText(s, 1500)).filter(Boolean).slice(0, 20));
    }
  }

  let contentBlocks = '[]';
  if (Array.isArray(body.contentBlocks)) {
    contentBlocks = JSON.stringify(body.contentBlocks);
  } else if (typeof body.contentBlocks === 'string' && body.contentBlocks.trim()) {
    contentBlocks = body.contentBlocks;
  }

  if (!title) return { error: 'عنوان المشاركة / اسم التطبيق مطلوب.' };
  if (!slug) return { error: 'رابط المشاركة غير صالح.' };
  if (cover && !/^https?:\/\//i.test(cover) && !cover.startsWith('/')) return { error: 'رابط صورة الغلاف غير صالح.' };
  if (iconUrl && !/^https?:\/\//i.test(iconUrl) && !iconUrl.startsWith('/')) return { error: 'رابط أيقونة التطبيق غير صالح.' };
  if (downloadUrl && !/^https?:\/\//i.test(downloadUrl) && !downloadUrl.startsWith('/')) return { error: 'رابط التنزيل المباشر غير صالح.' };
  if (apkFileUrl && !/^https?:\/\//i.test(apkFileUrl) && !apkFileUrl.startsWith('/')) return { error: 'رابط ملف APK غير صالح.' };
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5 || Math.round(rating * 10) !== rating * 10)) {
    return { error: 'التقييم يجب أن يكون بين 0 و5 وبحد أقصى منزلة عشرية واحدة.' };
  }

  return { post: {
    title, slug, packageName, excerpt: adminText(body.excerpt || body.shortDescription, 500),
    content: adminText(body.content || body.description, 50000),
    contentBlocks, cover, iconUrl, type, category: primaryCategory, categories,
    screenshots, downloadUrl, apkFileUrl, version, fileSize, developer,
    rating, isFeatured, status
  } };
}

function publicPost(row) {
  let categories = [];
  try {
    const c = JSON.parse(row.categories || '[]');
    if (Array.isArray(c) && c.length) categories = c;
  } catch {}
  if (!categories.length && row.category) categories = [row.category];

  let contentBlocks = [];
  try {
    contentBlocks = JSON.parse(row.content_blocks || '[]');
    if (!Array.isArray(contentBlocks)) contentBlocks = [];
  } catch {}

  const ratingVal = row.rating == null ? null : Number(row.rating);
  const mainCategory = row.type === 'game' ? 'Games' : 'Apps';
  const slugOrPkg = row.package_name || row.slug;

  return {
    id: row.id,
    title: row.title,
    name: row.title,
    slug: row.slug,
    packageName: row.package_name || '',
    mainCategory,
    detailUrl: `/category/${mainCategory}/${encodeURIComponent(slugOrPkg)}`,
    excerpt: row.excerpt,
    shortDescription: row.excerpt,
    content: row.content,
    description: row.content,
    contentBlocks,
    coverImage: row.cover_image,
    iconUrl: row.icon_url,
    imageUrl: row.icon_url || row.cover_image,
    type: row.type || 'app',
    category: row.category,
    categories,
    screenshots: safeScreenshots(row.screenshots),
    version: row.version || '',
    fileSize: row.file_size || '',
    developer: row.developer || '',
    rating: ratingVal,
    featured: Boolean(row.is_featured),
    downloads: Number(row.downloads || 0),
    hasDownload: Boolean(row.download_url || row.apk_file_url),
    status: row.status,
    publishedAt: row.published_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

const DATABASE_URL = process.env.POSTGRESQL_ADDON_URI;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: false, limit: '60mb' }));

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    })
  : null;

let databaseReady = false;
let databaseError = null;

async function initializeDatabase() {
  if (!pool) {
    databaseError = 'POSTGRESQL_ADDON_URI is not configured';
    console.error('[database] POSTGRESQL_ADDON_URI is not configured');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_categories (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_products (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        category_id BIGINT REFERENCES store_categories(id) ON DELETE SET NULL,
        short_description TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        download_url TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        file_size TEXT NOT NULL DEFAULT '',
        developer TEXT NOT NULL DEFAULT '',
        rating NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
        is_featured BOOLEAN NOT NULL DEFAULT FALSE,
        is_published BOOLEAN NOT NULL DEFAULT FALSE,
        downloads BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS store_posts (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        excerpt TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        cover_image TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_admin_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('ALTER TABLE store_products ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5))');
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'app' CHECK (type IN ('app','game'))");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS screenshots TEXT NOT NULL DEFAULT '[]'");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'Android'");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS release_notes TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_categories ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS icon_url TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'app'");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT '[]'");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS screenshots TEXT NOT NULL DEFAULT '[]'");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS content_blocks TEXT NOT NULL DEFAULT '[]'");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS apk_file_url TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS download_url TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS file_size TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS developer TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5))");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS downloads BIGINT NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE store_categories ADD COLUMN IF NOT EXISTS parent_slug TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_categories ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE store_posts ADD COLUMN IF NOT EXISTS package_name TEXT NOT NULL DEFAULT ''");
    await client.query('CREATE INDEX IF NOT EXISTS store_admin_sessions_expiry_idx ON store_admin_sessions (expires_at)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_admin_attempts (
        ip TEXT PRIMARY KEY,
        window_started TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INTEGER NOT NULL DEFAULT 0,
        blocked_until TIMESTAMPTZ
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_public_idx ON store_posts (status, published_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_type_idx ON store_posts (status, type, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_featured_idx ON store_posts (status, is_featured, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_downloads_idx ON store_posts (status, downloads DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_pkg_idx ON store_posts (package_name)');
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_type_pkg_idx ON store_posts (type, package_name)');
    await client.query('CREATE INDEX IF NOT EXISTS store_categories_parent_idx ON store_categories (parent_slug)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_published_idx ON store_products (is_published, is_featured, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_category_idx ON store_products (category_id)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_type_idx ON store_products (is_published, type, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_downloads_idx ON store_products (is_published, downloads DESC)');
    // Seed main categories Apps and Games if they do not exist
    await client.query(`
      INSERT INTO store_categories (name, slug, description, parent_slug, is_visible)
      VALUES ('تطبيقات', 'Apps', 'قسم تطبيقات Android', '', TRUE)
      ON CONFLICT (slug) DO UPDATE SET is_visible = TRUE
    `);
    await client.query(`
      INSERT INTO store_categories (name, slug, description, parent_slug, is_visible)
      VALUES ('ألعاب', 'Games', 'قسم ألعاب Android', '', TRUE)
      ON CONFLICT (slug) DO UPDATE SET is_visible = TRUE
    `);
    await client.query('COMMIT');
    databaseReady = true;
    databaseError = null;
    console.log('[database] PostgreSQL connected; schema ready');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    databaseError = error.message;
    console.error('[database] Schema initialization failed:', error.message);
  } finally {
    client.release();
  }
}

function requireDatabase(req, res, next) {
  if (!pool || !databaseReady) {
    return res.status(503).json({
      error: 'database_unavailable',
      message: 'قاعدة البيانات مو متاحة حالياً. تأكد من إعداد POSTGRESQL_ADDON_URI وسجل الخادم.'
    });
  }
  next();
}

function safeScreenshots(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(s => String(s || '').trim()).filter(Boolean);
  } catch {}
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function safeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type === 'game' ? 'game' : 'app',
    category: row.category_name || '',
    categorySlug: row.category_slug || '',
    shortDescription: row.short_description,
    description: row.description,
    imageUrl: row.image_url,
    screenshots: safeScreenshots(row.screenshots),
    platform: row.platform || 'Android',
    releaseNotes: row.release_notes || '',
    version: row.version,
    fileSize: row.file_size,
    developer: row.developer,
    rating: row.rating == null ? null : Number(row.rating),
    featured: row.is_featured,
    downloads: Number(row.downloads || 0),
    hasDownload: Boolean(row.download_url),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.slug, p.short_description, p.description,
         p.image_url, p.version, p.file_size, p.developer, p.rating, p.is_featured,
         p.downloads, p.download_url, p.type, p.screenshots, p.platform, p.release_notes,
         p.created_at, p.updated_at, c.name AS category_name, c.slug AS category_slug
  FROM store_products p
  LEFT JOIN store_categories c ON c.id = p.category_id
`;

app.get('/api/health', async (req, res) => {
  let db = 'not_configured';
  if (pool && databaseReady) {
    try {
      await pool.query('SELECT 1');
      db = 'connected';
    } catch (error) {
      db = 'error';
    }
  } else if (pool) {
    db = 'initializing_or_error';
  }
  res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    store: STORE_NAME,
    database: db,
    ...(process.env.NODE_ENV !== 'production' && databaseError ? { detail: databaseError } : {})
  });
});

app.get('/api/config', (req, res) => {
  res.json({ name: STORE_NAME, logo: STORE_LOGO, link: STORE_LINK });
});

app.get('/api/categories', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.slug, c.description, c.icon, c.parent_slug AS "parentSlug", c.is_visible AS "isVisible",
             (
               (SELECT COUNT(*)::int FROM store_posts sp WHERE sp.status = 'published' AND (sp.category = c.name OR sp.categories ILIKE '%' || c.name || '%'))
               +
               (SELECT COUNT(*)::int FROM store_products p WHERE p.is_published = TRUE AND p.category_id = c.id)
             ) AS product_count
      FROM store_categories c
      WHERE c.is_visible = TRUE
      ORDER BY c.parent_slug ASC, c.name ASC
    `);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/categories/:slug', requireDatabase, async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    const result = await pool.query(`
      SELECT c.id, c.name, c.slug, c.description, c.icon, c.parent_slug AS "parentSlug", c.is_visible AS "isVisible",
             (
               (SELECT COUNT(*)::int FROM store_posts sp WHERE sp.status = 'published' AND (sp.category = c.name OR sp.categories ILIKE '%' || c.name || '%'))
               +
               (SELECT COUNT(*)::int FROM store_products p WHERE p.is_published = TRUE AND p.category_id = c.id)
             ) AS product_count
      FROM store_categories c
      WHERE c.slug = $1
      LIMIT 1
    `, [slug]);
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'القسم غير موجود.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/products', requireDatabase, async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim().slice(0, 100);
    const type = String(req.query.type || '').trim().toLowerCase();
    const featured = String(req.query.featured || '').trim().toLowerCase();
    const sort = String(req.query.sort || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 60);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const values = [];
    const whereP = ['p.is_published = TRUE'];
    const wherePosts = ["sp.status = 'published'"];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const idx = values.length;
      whereP.push(`(p.name ILIKE $${idx} OR p.short_description ILIKE $${idx} OR p.developer ILIKE $${idx} OR p.description ILIKE $${idx})`);
      wherePosts.push(`(sp.title ILIKE $${idx} OR sp.excerpt ILIKE $${idx} OR sp.developer ILIKE $${idx} OR sp.content ILIKE $${idx})`);
    }
    if (category) {
      values.push(category);
      const idx = values.length;
      whereP.push(`c.slug = $${idx}`);
      wherePosts.push(`(sp.category = $${idx} OR sp.categories ILIKE '%' || $${idx} || '%')`);
    }
    if (type === 'app' || type === 'game') {
      values.push(type);
      const idx = values.length;
      whereP.push(`p.type = $${idx}`);
      wherePosts.push(`sp.type = $${idx}`);
    }
    if (featured === 'true' || featured === '1') {
      whereP.push('p.is_featured = TRUE');
      wherePosts.push('sp.is_featured = TRUE');
    }

    let orderBy = 'is_featured DESC, created_at DESC';
    if (sort === 'downloads') {
      orderBy = 'downloads DESC, created_at DESC';
    } else if (sort === 'rating') {
      orderBy = 'rating DESC NULLS LAST, created_at DESC';
    } else if (sort === 'newest') {
      orderBy = 'created_at DESC';
    }

    const unifiedQuery = `
      SELECT p.id, p.name, p.slug, p.short_description, p.description,
             p.image_url, p.version, p.file_size, p.developer, p.rating, p.is_featured,
             p.downloads, p.download_url, p.type, p.screenshots, p.platform, p.release_notes,
             p.created_at, p.updated_at, c.name AS category_name, c.slug AS category_slug,
             '[]' AS categories, '[]' AS content_blocks
      FROM store_products p
      LEFT JOIN store_categories c ON c.id = p.category_id
      WHERE ${whereP.join(' AND ')}
      UNION ALL
      SELECT sp.id, sp.title AS name, sp.slug, sp.excerpt AS short_description, sp.content AS description,
             COALESCE(NULLIF(sp.icon_url, ''), sp.cover_image) AS image_url,
             sp.version, sp.file_size, sp.developer, sp.rating, sp.is_featured,
             sp.downloads, COALESCE(NULLIF(sp.download_url, ''), sp.apk_file_url) AS download_url,
             sp.type, sp.screenshots, 'Android' AS platform, '' AS release_notes,
             sp.created_at, sp.updated_at, sp.category AS category_name, sp.category AS category_slug,
             sp.categories, sp.content_blocks
      FROM store_posts sp
      WHERE ${wherePosts.join(' AND ')}
    `;

    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM (${unifiedQuery}) u`, values);
    const pageValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT * FROM (${unifiedQuery}) u ORDER BY ${orderBy} LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues
    );
    res.json({ items: result.rows.map(safeProduct), total: countResult.rows[0].total, limit, offset });
  } catch (error) { next(error); }
});

app.get('/api/products/:slug', requireDatabase, async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    const postResult = await pool.query(
      "SELECT * FROM store_posts WHERE (slug = $1 OR package_name = $1) AND status = 'published' LIMIT 1",
      [slug]
    );
    if (postResult.rowCount) return res.json(publicPost(postResult.rows[0]));

    const result = await pool.query(
      `${PRODUCT_SELECT} WHERE p.slug = $1 AND p.is_published = TRUE LIMIT 1`,
      [slug]
    );
    if (result.rowCount) return res.json(safeProduct(result.rows[0]));

    res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمنتج.' });
  } catch (error) { next(error); }
});

app.get('/api/products/:slug/related', requireDatabase, async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    const current = await pool.query('SELECT id, category_id, type FROM store_products WHERE slug = $1 AND is_published = TRUE LIMIT 1', [slug]);
    let row = current.rows[0];
    if (!row) {
      const postCur = await pool.query("SELECT id, category, type FROM store_posts WHERE (slug = $1 OR package_name = $1) AND status = 'published' LIMIT 1", [slug]);
      if (!postCur.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمنتج.' });
      row = { id: postCur.rows[0].id, category_id: null, type: postCur.rows[0].type };
    }
    const related = await pool.query(`
      ${PRODUCT_SELECT}
      WHERE p.is_published = TRUE AND p.id <> $1 AND (p.category_id = $2 OR p.type = $3)
      ORDER BY (p.category_id = $2) DESC, p.is_featured DESC, p.rating DESC NULLS LAST, p.downloads DESC
      LIMIT 6
    `, [row.id, row.category_id, row.type]);
    res.json({ items: related.rows.map(safeProduct) });
  } catch (error) { next(error); }
});

app.post('/api/products/:slug/download', requireDatabase, async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    const postRes = await pool.query(
      "UPDATE store_posts SET downloads = downloads + 1 WHERE (slug = $1 OR package_name = $1) AND status = 'published' AND (download_url <> '' OR apk_file_url <> '') RETURNING download_url, apk_file_url",
      [slug]
    );
    if (postRes.rowCount) {
      const dl = postRes.rows[0].download_url || postRes.rows[0].apk_file_url;
      return res.json({ url: dl });
    }
    const result = await pool.query(
      "UPDATE store_products SET downloads = downloads + 1 WHERE slug = $1 AND is_published = TRUE AND download_url <> '' RETURNING download_url",
      [slug]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'download_unavailable', message: 'التنزيل لهذا المنتج مو متوفر حالياً.' });
    res.json({ url: result.rows[0].download_url });
  } catch (error) { next(error); }
});

/* Public API: visitors only receive published posts. */
app.get('/api/posts', requireDatabase, async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim().slice(0, 100);
    const type = String(req.query.type || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 50);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const values = [];
    const where = ["status = 'published'"];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(title ILIKE $${values.length} OR excerpt ILIKE $${values.length} OR developer ILIKE $${values.length} OR content ILIKE $${values.length})`);
    }
    if (category) {
      values.push(`%${category}%`);
      where.push(`(category ILIKE $${values.length} OR categories ILIKE $${values.length})`);
    }
    if (type === 'app' || type === 'game') {
      values.push(type);
      where.push(`type = $${values.length}`);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM store_posts WHERE ${where.join(' AND ')}`,
      values
    );
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM store_posts WHERE ${where.join(' AND ')} ORDER BY is_featured DESC, published_at DESC NULLS LAST, created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ items: result.rows.map(publicPost), total: countResult.rows[0].total });
  } catch (error) { next(error); }
});

app.get('/api/posts/:slug', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM store_posts WHERE slug=$1 AND status='published' LIMIT 1", [String(req.params.slug).slice(0, 160)]);
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمشاركة.' });
    res.json(publicPost(result.rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/posts/:slug/download', requireDatabase, async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    const result = await pool.query(
      "UPDATE store_posts SET downloads = downloads + 1 WHERE (slug = $1 OR package_name = $1) AND status = 'published' AND (download_url <> '' OR apk_file_url <> '') RETURNING download_url, apk_file_url",
      [slug]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'download_unavailable', message: 'التنزيل لهذا التطبيق مو متوفر حالياً.' });
    const row = result.rows[0];
    res.json({ url: row.download_url || row.apk_file_url });
  } catch (error) { next(error); }
});

/* Unified Catalog & Hierarchical Category Routes */
app.get('/api/catalog/:mainCat', requireDatabase, async (req, res, next) => {
  try {
    const rawMain = String(req.params.mainCat || '').trim();
    const isGame = rawMain.toLowerCase() === 'games' || rawMain === 'ألعاب';
    const isApp = rawMain.toLowerCase() === 'apps' || rawMain === 'تطبيقات';
    if (!isGame && !isApp) {
      return res.status(404).json({ error: 'not_found', message: 'القسم الرئيسي غير موجود.' });
    }
    const mainSlug = isGame ? 'Games' : 'Apps';
    const mainType = isGame ? 'game' : 'app';

    // Get main category details
    const mainCatRes = await pool.query('SELECT id, name, slug, description, icon FROM store_categories WHERE slug = $1 LIMIT 1', [mainSlug]);
    const mainCategory = mainCatRes.rows[0] || { name: isGame ? 'الألعاب' : 'التطبيقات', slug: mainSlug, description: '' };

    // Get visible subcategories belonging to this main category
    const subcatsRes = await pool.query(`
      SELECT c.id, c.name, c.slug, c.description, c.icon, c.parent_slug AS "parentSlug",
             (
               (SELECT COUNT(*)::int FROM store_posts sp WHERE sp.status = 'published' AND sp.type = $1 AND (sp.category = c.name OR sp.categories ILIKE '%' || c.name || '%'))
               +
               (SELECT COUNT(*)::int FROM store_products p WHERE p.is_published = TRUE AND p.category_id = c.id)
             ) AS post_count
      FROM store_categories c
      WHERE c.parent_slug ILIKE $2 AND c.is_visible = TRUE
      ORDER BY c.name ASC
    `, [mainType, mainSlug]);

    // Query parameters for posts
    const search = String(req.query.q || '').trim().slice(0, 100);
    const subcat = String(req.query.subcat || req.query.category || '').trim().slice(0, 100);
    const sort = String(req.query.sort || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 60);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const values = [mainType];
    const where = ["status = 'published'", "type = $1"];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const idx = values.length;
      where.push(`(title ILIKE $${idx} OR excerpt ILIKE $${idx} OR developer ILIKE $${idx} OR package_name ILIKE $${idx})`);
    }
    if (subcat) {
      values.push(subcat);
      const idx = values.length;
      where.push(`(category = $${idx} OR categories ILIKE '%' || $${idx} || '%')`);
    }

    let orderBy = 'is_featured DESC, published_at DESC NULLS LAST, created_at DESC';
    if (sort === 'downloads') orderBy = 'downloads DESC, created_at DESC';
    else if (sort === 'rating') orderBy = 'rating DESC NULLS LAST, created_at DESC';
    else if (sort === 'newest') orderBy = 'created_at DESC';

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM store_posts WHERE ${where.join(' AND ')}`, values);
    const total = countRes.rows[0].total;

    values.push(limit, offset);
    const postsRes = await pool.query(`
      SELECT * FROM store_posts
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);

    res.json({
      mainCategory,
      subcategories: subcatsRes.rows,
      items: postsRes.rows.map(publicPost),
      total,
      limit,
      offset
    });
  } catch (error) { next(error); }
});

app.get('/api/catalog/:mainCat/:secondPart', requireDatabase, async (req, res, next) => {
  try {
    const rawMain = String(req.params.mainCat || '').trim();
    const isGame = rawMain.toLowerCase() === 'games' || rawMain === 'ألعاب';
    const isApp = rawMain.toLowerCase() === 'apps' || rawMain === 'تطبيقات';
    if (!isGame && !isApp) {
      return res.status(404).json({ error: 'not_found', message: 'القسم الرئيسي غير موجود.' });
    }
    const mainSlug = isGame ? 'Games' : 'Apps';
    const mainType = isGame ? 'game' : 'app';
    const secondPart = String(req.params.secondPart || '').trim();

    // 1. Check if secondPart is a subcategory of mainSlug
    const subcatRes = await pool.query(`
      SELECT id, name, slug, description, icon, parent_slug AS "parentSlug", is_visible AS "isVisible"
      FROM store_categories
      WHERE (slug ILIKE $1 OR name ILIKE $1) AND parent_slug ILIKE $2 AND is_visible = TRUE
      LIMIT 1
    `, [secondPart, mainSlug]);

    if (subcatRes.rowCount) {
      const subcategory = subcatRes.rows[0];
      const search = String(req.query.q || '').trim().slice(0, 100);
      const sort = String(req.query.sort || '').trim().toLowerCase();
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 60);
      const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

      const values = [mainType, subcategory.name];
      const where = ["status = 'published'", "type = $1", "(category = $2 OR categories ILIKE '%' || $2 || '%')"];

      if (search) {
        values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
        const idx = values.length;
        where.push(`(title ILIKE $${idx} OR excerpt ILIKE $${idx} OR developer ILIKE $${idx} OR package_name ILIKE $${idx})`);
      }

      let orderBy = 'is_featured DESC, published_at DESC NULLS LAST, created_at DESC';
      if (sort === 'downloads') orderBy = 'downloads DESC, created_at DESC';
      else if (sort === 'rating') orderBy = 'rating DESC NULLS LAST, created_at DESC';
      else if (sort === 'newest') orderBy = 'created_at DESC';

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM store_posts WHERE ${where.join(' AND ')}`, values);
      values.push(limit, offset);
      const itemsRes = await pool.query(`SELECT * FROM store_posts WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);

      return res.json({
        type: 'subcategory',
        mainCategory: mainSlug,
        subcategory,
        items: itemsRes.rows.map(publicPost),
        total: countRes.rows[0].total
      });
    }

    // 2. Check if secondPart is an App or Game detail item
    const postRes = await pool.query(`
      SELECT * FROM store_posts
      WHERE (package_name = $1 OR slug = $1) AND type = $2 AND status = 'published'
      LIMIT 1
    `, [secondPart, mainType]);

    if (postRes.rowCount) {
      return res.json({
        type: 'post',
        mainCategory: mainSlug,
        item: publicPost(postRes.rows[0])
      });
    }

    // 3. Fallback: check legacy store_products table
    const prodRes = await pool.query(`
      ${PRODUCT_SELECT}
      WHERE p.slug = $1 AND p.type = $2 AND p.is_published = TRUE
      LIMIT 1
    `, [secondPart, mainType]);

    if (prodRes.rowCount) {
      return res.json({
        type: 'post',
        mainCategory: mainSlug,
        item: safeProduct(prodRes.rows[0])
      });
    }

    // 4. Not found
    return res.status(404).json({ error: 'not_found', message: 'لم يتم العثور على التطبيق أو القسم المطلوب.' });
  } catch (error) { next(error); }
});

/* Admin login uses scrypt password derivation, rate limiting and an HttpOnly session cookie. */
app.post('/api/admin/login', async (req, res, next) => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_PATH) return res.status(503).json({ message: 'إعدادات الإدارة ناقصة. راجع ADMIN_USERNAME وADMIN_PASSWORD وADMIN_LINK.' });
  if (!pool || !databaseReady) return res.status(503).json({ message: 'قاعدة البيانات غير متاحة لتسجيل الدخول.' });
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100);
  try {
    await pool.query('DELETE FROM store_admin_sessions WHERE expires_at <= NOW()');
    await pool.query("DELETE FROM store_admin_attempts WHERE window_started < NOW() - INTERVAL '1 day'");
    const currentAttempt = await pool.query('SELECT attempts, window_started, blocked_until FROM store_admin_attempts WHERE ip=$1', [ip]);
    if (currentAttempt.rowCount) {
      const attempt = currentAttempt.rows[0];
      if (attempt.blocked_until && new Date(attempt.blocked_until).getTime() > Date.now()) return res.status(429).json({ message: 'محاولات هواية. انتظر 15 دقيقة وجرّب.' });
      if (Date.now() - new Date(attempt.window_started).getTime() < 15 * 60 * 1000 && attempt.attempts >= 8) return res.status(429).json({ message: 'محاولات هواية. انتظر 15 دقيقة وجرّب.' });
    }
    const salt = 'store-admin-v1:' + ADMIN_USERNAME;
    const supplied = await scrypt(adminText(req.body && req.body.username, 200) + '\0' + String(req.body && req.body.password || '').slice(0, 1024), salt, 64);
    const expected = await scrypt(ADMIN_USERNAME + '\0' + ADMIN_PASSWORD, salt, 64);
    if (!crypto.timingSafeEqual(supplied, expected)) {
      const updated = await pool.query("INSERT INTO store_admin_attempts(ip,window_started,attempts,blocked_until) VALUES($1,NOW(),1,NULL) ON CONFLICT(ip) DO UPDATE SET attempts=CASE WHEN store_admin_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1 ELSE store_admin_attempts.attempts+1 END, window_started=CASE WHEN store_admin_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE store_admin_attempts.window_started END, blocked_until=CASE WHEN (CASE WHEN store_admin_attempts.window_started < NOW() - INTERVAL '15 minutes' THEN 1 ELSE store_admin_attempts.attempts+1 END) >= 8 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END RETURNING attempts", [ip]);
      return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    await pool.query('DELETE FROM store_admin_attempts WHERE ip=$1', [ip]);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL);
    await pool.query('INSERT INTO store_admin_sessions(token_hash,csrf_token,expires_at) VALUES($1,$2,$3)', [tokenHash, csrfToken, expiresAt]);
    res.cookie(ADMIN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: ADMIN_SESSION_TTL });
    res.json({ ok: true, csrfToken, expiresIn: ADMIN_SESSION_TTL });
  } catch (error) { next(error); }
});
app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ authenticated: true, csrfToken: req.adminSession.csrfToken, expiresAt: req.adminSession.expiresAt }));
app.post('/api/admin/logout', requireAdmin, requireAdminCsrf, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM store_admin_sessions WHERE token_hash=$1', [req.adminTokenHash]);
    res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

function parseProduct(body) {
  const name = adminText(body.name, 180);
  const slug = adminSlug(body.slug || name);
  const imageUrl = adminText(body.imageUrl, 1500);
  const downloadUrl = adminText(body.downloadUrl, 2000);
  const rating = body.rating === '' || body.rating == null ? null : Number(body.rating);
  const categoryId = body.categoryId === '' || body.categoryId == null ? null : Number(body.categoryId);
  const type = body.type === 'game' ? 'game' : 'app';
  let screenshots = '[]';
  if (Array.isArray(body.screenshots)) {
    screenshots = JSON.stringify(body.screenshots.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12));
  } else if (typeof body.screenshots === 'string') {
    const list = body.screenshots.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 12);
    screenshots = JSON.stringify(list);
  }
  const platform = adminText(body.platform, 50) || 'Android';
  const releaseNotes = adminText(body.releaseNotes, 5000);

  if (!name) return { error: 'اسم المنتج مطلوب.' };
  if (!slug) return { error: 'رابط المنتج غير صالح.' };
  if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('/')) return { error: 'رابط صورة المنتج غير صالح.' };
  if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) return { error: 'رابط التنزيل يجب أن يبدأ بـ http:// أو https://.' };
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5 || Math.round(rating * 10) !== rating * 10)) return { error: 'التقييم يجب أن يكون بين 0 و5 وبحد أقصى منزلة عشرية واحدة.' };
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return { error: 'القسم المحدد غير صالح.' };
  return { product: { name, slug, categoryId, shortDescription: adminText(body.shortDescription, 500), description: adminText(body.description, 20000), imageUrl, downloadUrl, version: adminText(body.version, 80), fileSize: adminText(body.fileSize, 80), developer: adminText(body.developer, 180), rating, featured: body.featured === true, published: body.published === true, type, screenshots, platform, releaseNotes } };
}
function parseCategory(body) {
  const name = adminText(body.name, 100);
  const rawSlug = adminText(body.slug || name, 180);
  let slug = rawSlug;
  if (rawSlug !== 'Apps' && rawSlug !== 'Games') {
    slug = adminSlug(rawSlug);
  }
  let parentSlug = adminText(body.parentSlug || body.parent_slug, 50);
  if (parentSlug.toLowerCase() === 'apps') parentSlug = 'Apps';
  else if (parentSlug.toLowerCase() === 'games') parentSlug = 'Games';
  else parentSlug = '';

  const isVisible = body.isVisible !== undefined ? Boolean(body.isVisible) : (body.is_visible !== undefined ? Boolean(body.is_visible) : true);

  if (!name || !slug) return { error: 'اسم القسم ورابطه مطلوبان.' };
  return { category: { name, slug, parentSlug, isVisible, description: adminText(body.description, 500) } };
}
app.get('/api/admin/categories', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.slug, c.description, c.icon, c.parent_slug AS "parentSlug", c.is_visible AS "isVisible", c.created_at,
             (
               (SELECT COUNT(*)::int FROM store_posts sp WHERE (sp.category = c.name OR sp.categories ILIKE '%' || c.name || '%'))
               +
               (SELECT COUNT(*)::int FROM store_products p WHERE p.category_id = c.id)
             ) AS product_count
      FROM store_categories c
      ORDER BY c.parent_slug ASC, c.name ASC
    `);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/categories', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseCategory(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const c = parsed.category;
    const result = await pool.query(
      'INSERT INTO store_categories(name, slug, description, parent_slug, is_visible) VALUES($1, $2, $3, $4, $5) RETURNING id, name, slug, description, icon, parent_slug AS "parentSlug", is_visible AS "isVisible", created_at',
      [c.name, c.slug, c.description, c.parentSlug, c.isVisible]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'اسم القسم أو رابطه مستخدم مسبقاً.' }); next(error); }
});
app.put('/api/admin/categories/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseCategory(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const c = parsed.category;
    const result = await pool.query(
      'UPDATE store_categories SET name=$1, slug=$2, description=$3, parent_slug=$4, is_visible=$5 WHERE id=$6 RETURNING id, name, slug, description, icon, parent_slug AS "parentSlug", is_visible AS "isVisible", created_at',
      [c.name, c.slug, c.description, c.parentSlug, c.isVisible, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'القسم غير موجود.' });
    res.json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'اسم القسم أو رابطه مستخدم مسبقاً.' }); next(error); }
});
app.delete('/api/admin/categories/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  try {
    const catRes = await pool.query('SELECT id, name, slug, parent_slug FROM store_categories WHERE id=$1', [req.params.id]);
    if (!catRes.rowCount) return res.status(404).json({ message: 'القسم غير موجود.' });
    const c = catRes.rows[0];
    if ((c.slug === 'Apps' || c.slug === 'Games') && !c.parent_slug) {
      return res.status(400).json({ message: 'لا يمكن حذف الأقسام الرئيسية الأساسية (Apps / Games).' });
    }
    const linked = await pool.query("SELECT COUNT(*)::int AS count FROM store_posts WHERE category = $1 OR categories ILIKE '%' || $1 || '%'", [c.name]);
    const count = linked.rows[0].count;
    const force = req.query.force === 'true' || req.body?.force === true;
    if (count > 0 && !force) {
      return res.status(409).json({
        error: 'posts_linked',
        count,
        message: `هذا القسم مرتبط بـ ${count} تطبيق أو لعبة. عند التأكيد سيتم فك الارتباط دون حذف التطبيقات.`
      });
    }
    if (count > 0 && force) {
      await pool.query("UPDATE store_posts SET category='' WHERE category=$1", [c.name]);
    }
    await pool.query('DELETE FROM store_categories WHERE id=$1', [req.params.id]);
    res.json({ ok: true, unlinkedCount: count });
  } catch (error) { next(error); }
});
app.get('/api/admin/products', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const q = adminText(String(req.query.q || ''), 100);
    const type = adminText(String(req.query.type || ''), 20);
    const values = [];
    const where = [];
    if (q) {
      values.push('%' + q + '%');
      where.push(`(p.name ILIKE $${values.length} OR p.slug ILIKE $${values.length} OR p.developer ILIKE $${values.length})`);
    }
    if (type === 'app' || type === 'game') {
      values.push(type);
      where.push(`p.type = $${values.length}`);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await pool.query('SELECT p.id,p.name,p.slug,p.category_id AS "categoryId",c.name AS "categoryName",p.short_description AS "shortDescription",p.description,p.image_url AS "imageUrl",p.download_url AS "downloadUrl",p.version,p.file_size AS "fileSize",p.developer,p.rating,p.is_featured AS featured,p.is_published AS published,p.downloads,p.type,p.screenshots,p.platform,p.release_notes AS "releaseNotes",p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM store_products p LEFT JOIN store_categories c ON c.id=p.category_id ' + whereClause + ' ORDER BY p.updated_at DESC NULLS LAST,p.created_at DESC LIMIT 500', values);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/products', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseProduct(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.product;
  try {
    if (p.categoryId !== null) { const c = await pool.query('SELECT id FROM store_categories WHERE id=$1', [p.categoryId]); if (!c.rowCount) return res.status(400).json({ message: 'القسم المحدد غير موجود.' }); }
    const result = await pool.query('INSERT INTO store_products(name,slug,category_id,short_description,description,image_url,download_url,version,file_size,developer,rating,is_featured,is_published,type,screenshots,platform,release_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id,name,slug,rating', [p.name,p.slug,p.categoryId,p.shortDescription,p.description,p.imageUrl,p.downloadUrl,p.version,p.fileSize,p.developer,p.rating,p.featured,p.published,p.type,p.screenshots,p.platform,p.releaseNotes]);
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'رابط المنتج مستخدم مسبقاً.' }); next(error); }
});
app.put('/api/admin/products/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseProduct(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.product;
  try {
    if (p.categoryId !== null) { const c = await pool.query('SELECT id FROM store_categories WHERE id=$1', [p.categoryId]); if (!c.rowCount) return res.status(400).json({ message: 'القسم المحدد غير موجود.' }); }
    const result = await pool.query('UPDATE store_products SET name=$1,slug=$2,category_id=$3,short_description=$4,description=$5,image_url=$6,download_url=$7,version=$8,file_size=$9,developer=$10,rating=$11,is_featured=$12,is_published=$13,type=$14,screenshots=$15,platform=$16,release_notes=$17,updated_at=NOW() WHERE id=$18 RETURNING id,name,slug,rating', [p.name,p.slug,p.categoryId,p.shortDescription,p.description,p.imageUrl,p.downloadUrl,p.version,p.fileSize,p.developer,p.rating,p.featured,p.published,p.type,p.screenshots,p.platform,p.releaseNotes,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'المنتج غير موجود.' });
    res.json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'رابط المنتج مستخدم مسبقاً.' }); next(error); }
});
app.delete('/api/admin/products/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM store_products WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'المنتج غير موجود.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/admin/upload', requireDatabase, requireAdmin, requireAdminCsrf, (req, res) => {
  try {
    const { fileName, dataBase64, mimeType } = req.body || {};
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ message: 'بيانات الملف غير صالحة.' });
    }
    const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(413).json({ message: 'حجم الملف يتجاوز 50 ميجابايت.' });
    }
    const rawExt = path.extname(String(fileName || '')).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.apk', '.mp4', '.webm'];
    let ext = allowed.includes(rawExt) ? rawExt : '';
    if (!ext) {
      if (mimeType === 'image/png') ext = '.png';
      else if (mimeType === 'image/jpeg') ext = '.jpg';
      else if (mimeType === 'image/webp') ext = '.webp';
      else if (mimeType === 'application/vnd.android.package-archive') ext = '.apk';
      else if (mimeType === 'video/mp4') ext = '.mp4';
      else return res.status(400).json({ message: 'نوع الملف غير مدعوم. الصيغ المدعومة: صور، APK، فيديو MP4.' });
    }
    const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const targetFile = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(targetFile, buffer);
    res.json({
      ok: true,
      url: `/uploads/${safeName}`,
      fileName: safeName,
      size: buffer.length
    });
  } catch (err) {
    res.status(500).json({ message: 'تعذّر حفظ الملف: ' + err.message });
  }
});

app.get('/api/admin/posts', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const q = adminText(String(req.query.q || ''), 100);
    const values = [];
    let where = '';
    if (q) {
      values.push('%' + q + '%');
      where = 'WHERE title ILIKE $1 OR slug ILIKE $1 OR category ILIKE $1 OR developer ILIKE $1';
    }
    const result = await pool.query('SELECT * FROM store_posts ' + where + ' ORDER BY updated_at DESC, created_at DESC LIMIT 500', values);
    res.json({ items: result.rows.map(publicPost) });
  } catch (error) { next(error); }
});

app.post('/api/admin/posts', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parsePost(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.post;
  try {
    if (p.packageName) {
      const existingPkg = await pool.query('SELECT id, title FROM store_posts WHERE package_name = $1 LIMIT 1', [p.packageName]);
      if (existingPkg.rowCount) {
        return res.status(409).json({ message: `اسم الحزمة «${p.packageName}» مستخدم بالفعل في تطبيق آخر: «${existingPkg.rows[0].title}».` });
      }
    }
    let selectedCats = [];
    try { selectedCats = JSON.parse(p.categories || '[]'); } catch {}
    if (selectedCats.length > 0) {
      const catCheck = await pool.query('SELECT name, parent_slug FROM store_categories WHERE name = ANY($1::text[])', [selectedCats]);
      const forbiddenParent = p.type === 'app' ? 'Games' : 'Apps';
      const invalid = catCheck.rows.filter(r => r.parent_slug && r.parent_slug.toLowerCase() === forbiddenParent.toLowerCase());
      if (invalid.length > 0) {
        return res.status(400).json({ message: `لا يمكن تعيين تصنيف «${invalid[0].name}» لأن هذا التصنيف تابع لقسم ${forbiddenParent === 'Games' ? 'الألعاب' : 'التطبيقات'}.` });
      }
    }

    const result = await pool.query(
      `INSERT INTO store_posts
       (title, slug, package_name, excerpt, content, content_blocks, cover_image, icon_url, type, category, categories, screenshots, download_url, apk_file_url, version, file_size, developer, rating, is_featured, status, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CASE WHEN $20='published' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [p.title, p.slug, p.packageName, p.excerpt, p.content, p.contentBlocks, p.cover, p.iconUrl, p.type, p.category, p.categories, p.screenshots, p.downloadUrl, p.apkFileUrl, p.version, p.fileSize, p.developer, p.rating, p.isFeatured, p.status]
    );
    res.status(201).json({ item: publicPost(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'هذا الرابط مستخدم من قبل. اختار رابط ثاني.' });
    next(error);
  }
});

app.put('/api/admin/posts/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parsePost(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.post;
  try {
    if (p.packageName) {
      const existingPkg = await pool.query('SELECT id, title FROM store_posts WHERE package_name = $1 AND id <> $2 LIMIT 1', [p.packageName, req.params.id]);
      if (existingPkg.rowCount) {
        return res.status(409).json({ message: `اسم الحزمة «${p.packageName}» مستخدم بالفعل في تطبيق آخر: «${existingPkg.rows[0].title}».` });
      }
    }
    let selectedCats = [];
    try { selectedCats = JSON.parse(p.categories || '[]'); } catch {}
    if (selectedCats.length > 0) {
      const catCheck = await pool.query('SELECT name, parent_slug FROM store_categories WHERE name = ANY($1::text[])', [selectedCats]);
      const forbiddenParent = p.type === 'app' ? 'Games' : 'Apps';
      const invalid = catCheck.rows.filter(r => r.parent_slug && r.parent_slug.toLowerCase() === forbiddenParent.toLowerCase());
      if (invalid.length > 0) {
        return res.status(400).json({ message: `لا يمكن تعيين تصنيف «${invalid[0].name}» لأن هذا التصنيف تابع لقسم ${forbiddenParent === 'Games' ? 'الألعاب' : 'التطبيقات'}.` });
      }
    }

    const result = await pool.query(
      `UPDATE store_posts SET
       title=$1, slug=$2, package_name=$3, excerpt=$4, content=$5, content_blocks=$6, cover_image=$7, icon_url=$8,
       type=$9, category=$10, categories=$11, screenshots=$12, download_url=$13, apk_file_url=$14,
       version=$15, file_size=$16, developer=$17, rating=$18, is_featured=$19, status=$20,
       published_at=CASE WHEN $20='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,
       updated_at=NOW()
       WHERE id=$21 RETURNING *`,
      [p.title, p.slug, p.packageName, p.excerpt, p.content, p.contentBlocks, p.cover, p.iconUrl, p.type, p.category, p.categories, p.screenshots, p.downloadUrl, p.apkFileUrl, p.version, p.fileSize, p.developer, p.rating, p.isFeatured, p.status, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'المشاركة مو موجودة.' });
    res.json({ item: publicPost(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'هذا الرابط مستخدم من قبل. اختار رابط ثاني.' });
    next(error);
  }
});

app.delete('/api/admin/posts/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM store_posts WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'المشاركة مو موجودة.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
if (ADMIN_PATH) {
  app.get(ADMIN_PATH, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
  });
} else {
  console.error('[admin] ADMIN_LINK is missing or invalid; admin route disabled');
}

/* Legacy product route redirect: 301 to new canonical /category/:mainCat/:packageNameOrSlug */
app.get('/product/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug).slice(0, 160);
    if (pool && databaseReady) {
      const postRes = await pool.query("SELECT slug, package_name, type FROM store_posts WHERE (slug = $1 OR package_name = $1) LIMIT 1", [slug]);
      if (postRes.rowCount) {
        const row = postRes.rows[0];
        const mainCat = row.type === 'game' ? 'Games' : 'Apps';
        const target = `/category/${mainCat}/${encodeURIComponent(row.package_name || row.slug)}`;
        return res.redirect(301, target);
      }
      const prodRes = await pool.query("SELECT slug, type FROM store_products WHERE slug = $1 LIMIT 1", [slug]);
      if (prodRes.rowCount) {
        const row = prodRes.rows[0];
        const mainCat = row.type === 'game' ? 'Games' : 'Apps';
        const target = `/category/${mainCat}/${encodeURIComponent(row.slug)}`;
        return res.redirect(301, target);
      }
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) { next(error); }
});

/* SPA routes for Category views */
app.get(['/category/:mainCat', '/category/:mainCat/:secondPart', '/categories'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('[request]', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({
    error: 'internal_error',
    message: 'صار خطأ غير متوقع. جرّب مرة ثانية.'
  });
});

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[${STORE_NAME}] server listening on 0.0.0.0:${PORT}`);
  await initializeDatabase();
});

async function shutdown(signal) {
  console.log(`[server] ${signal}; shutting down`);
  server.close(async () => {
    if (pool) await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
