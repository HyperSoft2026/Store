const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_NAME = process.env.STORE_NAME || 'Store';
const STORE_LOGO = process.env.STORE_LOGO || '/Logo.png';
const STORE_LINK = (process.env.STORE_LINK || '').replace(/\/$/, '');

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
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function isAssetReference(value) {
  return isHttpUrl(value) || (/^\/(?!\/)/.test(value) && !value.includes('\\'));
}
function parsePost(body) {
  const title = adminText(body.title, 180);
  const slug = adminSlug(body.slug || title);
  const cover = adminText(body.coverImage, 1500);
  if (!title) return { error: 'عنوان المشاركة مطلوب.' };
  if (!slug) return { error: 'رابط المشاركة غير صالح.' };
  if (cover && !isAssetReference(cover)) return { error: 'رابط صورة الغلاف غير صالح.' };
  return { post: {
    title: title, slug: slug, excerpt: adminText(body.excerpt, 500),
    content: adminText(body.content, 50000), cover: cover,
    category: adminText(body.category, 100),
    status: body.status === 'published' ? 'published' : 'draft'
  } };
}
function publicPost(row) {
  return { id: row.id, title: row.title, slug: row.slug, excerpt: row.excerpt,
    content: row.content, coverImage: row.cover_image, category: row.category,
    status: row.status, publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
const DATABASE_URL = process.env.POSTGRESQL_ADDON_URI;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

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
        product_type TEXT NOT NULL DEFAULT 'app',
        status TEXT NOT NULL DEFAULT 'draft',
        screenshots TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        platform TEXT NOT NULL DEFAULT '',
        release_notes TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ,
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
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'app'");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS screenshots TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE store_products ADD COLUMN IF NOT EXISTS release_notes TEXT NOT NULL DEFAULT ''");
    await client.query('ALTER TABLE store_products ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ');
    await client.query(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='store_products_product_type_check' AND conrelid='store_products'::regclass) THEN
          ALTER TABLE store_products ADD CONSTRAINT store_products_product_type_check CHECK (product_type IN ('app','game'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='store_products_status_check' AND conrelid='store_products'::regclass) THEN
          ALTER TABLE store_products ADD CONSTRAINT store_products_status_check CHECK (status IN ('draft','published','archived'));
        END IF;
      END
      $migration$
    `);
    await client.query("UPDATE store_products SET status='published' WHERE is_published=TRUE AND status='draft'");
    await client.query("UPDATE store_products SET published_at=COALESCE(published_at,created_at) WHERE status='published' AND published_at IS NULL");
    await client.query("UPDATE store_products SET is_published=(status='published') WHERE is_published IS DISTINCT FROM (status='published')");
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
    await client.query('CREATE INDEX IF NOT EXISTS store_products_published_idx ON store_products (is_published, is_featured, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_category_idx ON store_products (category_id)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_catalog_idx ON store_products (status, product_type, is_featured, created_at DESC)');
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

function safeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category_name || '',
    categorySlug: row.category_slug || '',
    shortDescription: row.short_description,
    description: row.description,
    imageUrl: row.image_url,
    version: row.version,
    fileSize: row.file_size,
    developer: row.developer,
    rating: row.rating == null ? null : Number(row.rating),
    type: row.product_type || 'app',
    screenshots: Array.isArray(row.screenshots) ? row.screenshots : [],
    platform: row.platform || '',
    releaseNotes: row.release_notes || '',
    featured: row.is_featured,
    downloads: Number(row.downloads || 0),
    hasDownload: Boolean(row.download_url),
    status: row.status || 'published',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.slug, p.product_type, p.status, p.short_description, p.description,
         p.image_url, p.screenshots, p.version, p.file_size, p.developer, p.platform, p.release_notes,
         p.rating, p.is_featured, p.downloads, p.download_url, p.created_at, p.updated_at, p.published_at,
         c.name AS category_name, c.slug AS category_slug
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
      SELECT c.id, c.name, c.slug, c.description, COUNT(p.id)::int AS product_count
      FROM store_categories c
      LEFT JOIN store_products p ON p.category_id = c.id AND p.is_published = TRUE AND p.status = 'published'
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/categories/:slug', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.slug, c.description, COUNT(p.id)::int AS product_count
      FROM store_categories c
      LEFT JOIN store_products p ON p.category_id=c.id AND p.is_published=TRUE AND p.status='published'
      WHERE c.slug=$1
      GROUP BY c.id
      LIMIT 1
    `, [String(req.params.slug).slice(0, 180)]);
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالقسم.' });
    const row = result.rows[0];
    res.json({ item: { id: row.id, name: row.name, slug: row.slug, description: row.description, productCount: Number(row.product_count) } });
  } catch (error) { next(error); }
});

app.get('/api/products', requireDatabase, async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim().slice(0, 100);
    const type = String(req.query.type || '').trim();
    const sort = String(req.query.sort || '').trim();
    const featured = String(req.query.featured || '').trim();
    if (type && !['app', 'game'].includes(type)) return res.status(400).json({ error: 'invalid_type', message: 'نوع المنتج غير صالح.' });
    if (sort && !['newest', 'downloads', 'rating'].includes(sort)) return res.status(400).json({ error: 'invalid_sort', message: 'طريقة الترتيب غير صالحة.' });
    if (featured && !['true', 'false'].includes(featured)) return res.status(400).json({ error: 'invalid_featured', message: 'قيمة التصفية غير صالحة.' });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 60);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const values = [];
    const where = ["p.is_published = TRUE", "p.status = 'published'"];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(p.name ILIKE $${values.length} OR p.short_description ILIKE $${values.length} OR p.description ILIKE $${values.length} OR p.developer ILIKE $${values.length})`);
    }
    if (category) {
      values.push(category);
      where.push(`c.slug = $${values.length}`);
    }
    if (type) {
      values.push(type);
      where.push(`p.product_type = $${values.length}`);
    }
    if (featured === 'true') where.push('p.is_featured = TRUE');
    if (featured === 'false') where.push('p.is_featured = FALSE');
    if (sort === 'downloads') where.push('p.downloads > 0');
    const orderBy = sort === 'downloads'
      ? 'p.downloads DESC, p.created_at DESC'
      : sort === 'rating'
        ? 'p.rating DESC NULLS LAST, p.created_at DESC'
        : sort === 'newest'
          ? 'p.created_at DESC'
          : 'p.is_featured DESC, p.created_at DESC';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM store_products p LEFT JOIN store_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`,
      values
    );
    values.push(limit, offset);
    const result = await pool.query(
      `${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ items: result.rows.map(safeProduct), total: countResult.rows[0].total, limit, offset });
  } catch (error) { next(error); }
});

app.get('/api/products/:slug', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(
      `${PRODUCT_SELECT} WHERE p.slug = $1 AND p.is_published = TRUE AND p.status = 'published' LIMIT 1`,
      [String(req.params.slug).slice(0, 160)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمنتج.' });
    res.json(safeProduct(result.rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/products/:slug/download', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(
      "UPDATE store_products SET downloads = downloads + 1 WHERE slug = $1 AND is_published = TRUE AND status = 'published' AND download_url <> '' RETURNING download_url",
      [String(req.params.slug).slice(0, 160)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'download_unavailable', message: 'التنزيل لهذا المنتج مو متوفر حالياً.' });
    res.json({ url: result.rows[0].download_url });
  } catch (error) { next(error); }
});


/* Public API: visitors only receive published posts. */
app.get('/api/posts', requireDatabase, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 50);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const result = await pool.query("SELECT id,title,slug,excerpt,cover_image,category,published_at,created_at FROM store_posts WHERE status='published' ORDER BY published_at DESC NULLS LAST,created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const count = await pool.query("SELECT COUNT(*)::int AS total FROM store_posts WHERE status='published'");
    res.json({ items: result.rows.map(function (row) { return { id: row.id, title: row.title, slug: row.slug, excerpt: row.excerpt, coverImage: row.cover_image, category: row.category, publishedAt: row.published_at || row.created_at }; }), total: count.rows[0].total });
  } catch (error) { next(error); }
});
app.get('/api/posts/:slug', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM store_posts WHERE slug=$1 AND status='published' LIMIT 1", [String(req.params.slug).slice(0, 160)]);
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمشاركة.' });
    res.json(publicPost(result.rows[0]));
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
  const type = body.type == null || body.type === '' ? 'app' : String(body.type);
  const status = body.status == null || body.status === ''
    ? (body.published === true ? 'published' : 'draft')
    : String(body.status);
  const screenshots = body.screenshots == null ? [] : body.screenshots;
  if (!name) return { error: 'اسم المنتج مطلوب.' };
  if (!slug) return { error: 'رابط المنتج غير صالح.' };
  if (imageUrl && !isAssetReference(imageUrl)) return { error: 'رابط صورة المنتج غير صالح.' };
  if (downloadUrl && !isHttpUrl(downloadUrl)) return { error: 'رابط التنزيل يجب أن يكون رابط http أو https صالحاً ومن دون بيانات دخول مضمنة.' };
  if (!['app', 'game'].includes(type)) return { error: 'نوع المنتج يجب أن يكون تطبيقاً أو لعبة.' };
  if (!['draft', 'published', 'archived'].includes(status)) return { error: 'حالة المنتج غير صالحة.' };
  if (!Array.isArray(screenshots) || screenshots.length > 12) return { error: 'أضف 12 لقطة شاشة كحد أقصى.' };
  const cleanScreenshots = screenshots.map((url) => adminText(url, 1500));
  if (cleanScreenshots.some((url) => !url || !isAssetReference(url))) {
    return { error: 'روابط لقطات الشاشة يجب أن تكون روابط ويب أو مسارات محلية صالحة.' };
  }
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5 || Math.round(rating * 10) !== rating * 10)) return { error: 'التقييم يجب أن يكون بين 0 و5 وبحد أقصى منزلة عشرية واحدة.' };
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return { error: 'القسم المحدد غير صالح.' };
  return { product: {
    name, slug, type, status, categoryId,
    shortDescription: adminText(body.shortDescription, 500),
    description: adminText(body.description, 20000),
    imageUrl, downloadUrl, screenshots: cleanScreenshots,
    version: adminText(body.version, 80),
    fileSize: adminText(body.fileSize, 80),
    developer: adminText(body.developer, 180),
    platform: adminText(body.platform, 120),
    releaseNotes: adminText(body.releaseNotes, 10000),
    rating, featured: body.featured === true,
    published: status === 'published'
  } };
}
function parseCategory(body) {
  const name = adminText(body.name, 100);
  const slug = adminSlug(body.slug || name);
  if (!name || !slug) return { error: 'اسم القسم ورابطه مطلوبان.' };
  return { category: { name, slug, description: adminText(body.description, 500) } };
}
app.get('/api/admin/categories', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT c.id,c.name,c.slug,c.description,c.created_at,COUNT(p.id)::int AS product_count FROM store_categories c LEFT JOIN store_products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name');
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/categories', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseCategory(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const c = parsed.category;
    const result = await pool.query('INSERT INTO store_categories(name,slug,description) VALUES($1,$2,$3) RETURNING *', [c.name,c.slug,c.description]);
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'اسم القسم أو رابطه مستخدم مسبقاً.' }); next(error); }
});
app.put('/api/admin/categories/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseCategory(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const c = parsed.category;
    const result = await pool.query('UPDATE store_categories SET name=$1,slug=$2,description=$3 WHERE id=$4 RETURNING *', [c.name,c.slug,c.description,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'القسم غير موجود.' });
    res.json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'اسم القسم أو رابطه مستخدم مسبقاً.' }); next(error); }
});
app.delete('/api/admin/categories/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM store_categories WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'القسم غير موجود.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get('/api/admin/products', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const q = adminText(String(req.query.q || ''), 100);
    const type = adminText(String(req.query.type || ''), 20);
    const status = adminText(String(req.query.status || ''), 20);
    if (type && !['app', 'game'].includes(type)) return res.status(400).json({ message: 'نوع المنتج غير صالح.' });
    if (status && !['draft', 'published', 'archived'].includes(status)) return res.status(400).json({ message: 'حالة المنتج غير صالحة.' });
    const values = [];
    const filters = [];
    if (q) {
      values.push('%' + q + '%');
      filters.push(`(p.name ILIKE $${values.length} OR p.slug ILIKE $${values.length} OR p.developer ILIKE $${values.length})`);
    }
    if (type) {
      values.push(type);
      filters.push(`p.product_type=$${values.length}`);
    }
    if (status) {
      values.push(status);
      filters.push(`p.status=$${values.length}`);
    }
    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
    const result = await pool.query('SELECT p.id,p.name,p.slug,p.product_type AS type,p.status,p.category_id AS "categoryId",c.name AS "categoryName",p.short_description AS "shortDescription",p.description,p.image_url AS "imageUrl",p.download_url AS "downloadUrl",p.screenshots,p.platform,p.release_notes AS "releaseNotes",p.published_at AS "publishedAt",p.version,p.file_size AS "fileSize",p.developer,p.rating,p.is_featured AS featured,p.is_published AS published,p.downloads,p.created_at AS "createdAt",p.updated_at AS "updatedAt" FROM store_products p LEFT JOIN store_categories c ON c.id=p.category_id ' + where + ' ORDER BY p.updated_at DESC NULLS LAST,p.created_at DESC LIMIT 500', values);
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});
app.post('/api/admin/products', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseProduct(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.product;
  try {
    if (p.categoryId !== null) { const c = await pool.query('SELECT id FROM store_categories WHERE id=$1', [p.categoryId]); if (!c.rowCount) return res.status(400).json({ message: 'القسم المحدد غير موجود.' }); }
    const result = await pool.query("INSERT INTO store_products(name,slug,product_type,status,category_id,short_description,description,image_url,download_url,screenshots,version,file_size,developer,platform,release_notes,rating,is_featured,is_published,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CASE WHEN $4='published' THEN NOW() ELSE NULL END) RETURNING id,name,slug,product_type AS type,status,rating::float8 AS rating", [p.name,p.slug,p.type,p.status,p.categoryId,p.shortDescription,p.description,p.imageUrl,p.downloadUrl,p.screenshots,p.version,p.fileSize,p.developer,p.platform,p.releaseNotes,p.rating,p.featured,p.published]);
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ message: 'رابط المنتج مستخدم مسبقاً.' }); next(error); }
});
app.put('/api/admin/products/:id', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parseProduct(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.product;
  try {
    if (p.categoryId !== null) { const c = await pool.query('SELECT id FROM store_categories WHERE id=$1', [p.categoryId]); if (!c.rowCount) return res.status(400).json({ message: 'القسم المحدد غير موجود.' }); }
    const result = await pool.query("UPDATE store_products SET name=$1,slug=$2,product_type=$3,status=$4,category_id=$5,short_description=$6,description=$7,image_url=$8,download_url=$9,screenshots=$10,version=$11,file_size=$12,developer=$13,platform=$14,release_notes=$15,rating=$16,is_featured=$17,is_published=$18,published_at=CASE WHEN $4='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=$19 RETURNING id,name,slug,product_type AS type,status,rating::float8 AS rating", [p.name,p.slug,p.type,p.status,p.categoryId,p.shortDescription,p.description,p.imageUrl,p.downloadUrl,p.screenshots,p.version,p.fileSize,p.developer,p.platform,p.releaseNotes,p.rating,p.featured,p.published,req.params.id]);
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

app.get('/api/admin/posts', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const q = adminText(String(req.query.q || ''), 100);
    const values = [];
    let where = '';
    if (q) { values.push('%' + q + '%'); where = 'WHERE title ILIKE $1 OR slug ILIKE $1 OR category ILIKE $1'; }
    const result = await pool.query('SELECT * FROM store_posts ' + where + ' ORDER BY updated_at DESC LIMIT 200', values);
    res.json({ items: result.rows.map(publicPost) });
  } catch (error) { next(error); }
});
app.post('/api/admin/posts', requireDatabase, requireAdmin, requireAdminCsrf, async (req, res, next) => {
  const parsed = parsePost(req.body || {});
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  const p = parsed.post;
  try {
    const result = await pool.query("INSERT INTO store_posts (title,slug,excerpt,content,cover_image,category,status,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='published' THEN NOW() ELSE NULL END) RETURNING *", [p.title,p.slug,p.excerpt,p.content,p.cover,p.category,p.status]);
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
    const result = await pool.query("UPDATE store_posts SET title=$1,slug=$2,excerpt=$3,content=$4,cover_image=$5,category=$6,status=$7,published_at=CASE WHEN $7='published' THEN COALESCE(published_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=$8 RETURNING *", [p.title,p.slug,p.excerpt,p.content,p.cover,p.category,p.status,req.params.id]);
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
