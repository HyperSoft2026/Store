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
const adminSessions = new Map();
const adminAttempts = new Map();
const ADMIN_COOKIE = 'store_admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const item of raw.split(';')) {
    const pair = item.trim().split('=');
    if (pair.shift() === name) return decodeURIComponent(pair.join('='));
  }
  return '';
}
function getAdminSession(req) {
  const token = readCookie(req, ADMIN_COOKIE);
  const session = adminSessions.get(token);
  if (!token || !session) return null;
  if (session.expiresAt < Date.now()) { adminSessions.delete(token); return null; }
  return { token: token, session: session };
}
function requireAdmin(req, res, next) {
  const current = getAdminSession(req);
  if (!current) return res.status(401).json({ error: 'unauthorized', message: 'سجّل دخولك أولاً.' });
  req.adminSession = current.session;
  next();
}
function requireAdminCsrf(req, res, next) {
  const sent = String(req.headers['x-csrf-token'] || '');
  const expected = String(req.adminSession && req.adminSession.csrfToken || '');
  if (!sent || !expected || sent.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return res.status(403).json({ error: 'csrf_failed', message: 'انتهت صلاحية الطلب. حدّث الصفحة وجرّب.' });
  }
  next();
}
function adminText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function adminSlug(value) {
  return adminText(value, 180).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 160);
}
function parsePost(body) {
  const title = adminText(body.title, 180);
  const slug = adminSlug(body.slug || title);
  const cover = adminText(body.coverImage, 1500);
  if (!title) return { error: 'عنوان المشاركة مطلوب.' };
  if (!slug) return { error: 'رابط المشاركة غير صالح.' };
  if (cover && !/^https?:\/\//i.test(cover) && !cover.startsWith('/')) return { error: 'رابط صورة الغلاف غير صالح.' };
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
      ssl: process.env.PGSSLMODE === 'disable' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined),
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
        is_featured BOOLEAN NOT NULL DEFAULT FALSE,
        is_published BOOLEAN NOT NULL DEFAULT FALSE,
        downloads BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(\`
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
    \`);
    await client.query('CREATE INDEX IF NOT EXISTS store_posts_public_idx ON store_posts (status, published_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_published_idx ON store_products (is_published, is_featured, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS store_products_category_idx ON store_products (category_id)');
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
    featured: row.is_featured,
    downloads: Number(row.downloads || 0),
    createdAt: row.created_at
  };
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.slug, p.short_description, p.description,
         p.image_url, p.version, p.file_size, p.developer, p.is_featured,
         p.downloads, p.created_at, c.name AS category_name, c.slug AS category_slug
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
      LEFT JOIN store_products p ON p.category_id = c.id AND p.is_published = TRUE
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/products', requireDatabase, async (req, res, next) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim().slice(0, 100);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 60);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const values = [];
    const where = ['p.is_published = TRUE'];

    if (search) {
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(p.name ILIKE $ ${values.length} OR p.short_description ILIKE $${values.length} OR p.developer ILIKE $${values.length})`.replace('$ ', '$'));
    }
    if (category) {
      values.push(category);
      where.push(`c.slug = $${values.length}`);
    }
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM store_products p LEFT JOIN store_categories c ON c.id=p.category_id WHERE ${where.join(' AND ')}`,
      values
    );
    values.push(limit, offset);
    const result = await pool.query(
      `${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.is_featured DESC, p.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ items: result.rows.map(safeProduct), total: countResult.rows[0].total, limit, offset });
  } catch (error) { next(error); }
});

app.get('/api/products/:slug', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(
      `${PRODUCT_SELECT} WHERE p.slug = $1 AND p.is_published = TRUE LIMIT 1`,
      [String(req.params.slug).slice(0, 160)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'ما لكينا هالمنتج.' });
    res.json(safeProduct(result.rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/products/:slug/download', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE store_products SET downloads = downloads + 1 WHERE slug = $1 AND is_published = TRUE RETURNING download_url',
      [String(req.params.slug).slice(0, 160)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found', message: 'رابط التنزيل مو متوفر.' });
    if (!result.rows[0].download_url) return res.status(404).json({ error: 'download_unavailable', message: 'التنزيل لهذا المنتج مو متوفر حالياً.' });
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
app.post('/api/admin/login', async (req, res) => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_PATH) return res.status(503).json({ message: 'إعدادات الإدارة ناقصة. راجع ADMIN_USERNAME وADMIN_PASSWORD وADMIN_LINK.' });
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100);
  let attempt = adminAttempts.get(ip);
  if (attempt && Date.now() - attempt.started < 15 * 60 * 1000 && attempt.count >= 8) return res.status(429).json({ message: 'محاولات هواية. انتظر 15 دقيقة وجرّب.' });
  if (!attempt || Date.now() - attempt.started >= 15 * 60 * 1000) attempt = { started: Date.now(), count: 0 };
  try {
    const salt = 'store-admin-v1:' + ADMIN_USERNAME;
    const supplied = await scrypt(adminText(req.body && req.body.username, 200) + '\0' + String(req.body && req.body.password || ''), salt, 64);
    const expected = await scrypt(ADMIN_USERNAME + '\0' + ADMIN_PASSWORD, salt, 64);
    if (!crypto.timingSafeEqual(supplied, expected)) {
      attempt.count += 1; adminAttempts.set(ip, attempt);
      return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
    adminAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    adminSessions.set(token, { csrfToken: csrfToken, expiresAt: Date.now() + ADMIN_SESSION_TTL });
    res.cookie(ADMIN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: ADMIN_SESSION_TTL });
    res.json({ ok: true, csrfToken: csrfToken, expiresIn: ADMIN_SESSION_TTL });
  } catch (error) {
    console.error('[admin] login verification failed:', error.message);
    res.status(500).json({ message: 'تعذّر تسجيل الدخول هسه.' });
  }
});
app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ authenticated: true, csrfToken: req.adminSession.csrfToken, expiresAt: req.adminSession.expiresAt }));
app.post('/api/admin/logout', requireAdmin, requireAdminCsrf, (req, res) => {
  const current = getAdminSession(req);
  if (current) adminSessions.delete(current.token);
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/admin/posts', requireDatabase, requireAdmin, async (req, res, next) => {
  try {
    const q = adminText(String(req.query.q || ''), 100);
    const values = [];
    let where = '';
    if (q) { values.push('%' + q.replace(/[\\%_]/g, '\\app.use(express.static(path.join(__dirname, 'public'), {') + '%'); where = 'WHERE title ILIKE $1 OR slug ILIKE $1 OR category ILIKE $1'; }
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
