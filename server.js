const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_NAME = process.env.STORE_NAME || 'Store';
const STORE_LOGO = process.env.STORE_LOGO || '/Logo.png';
const STORE_LINK = (process.env.STORE_LINK || '').replace(/\/$/, '');
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
