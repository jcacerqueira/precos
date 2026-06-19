import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.DATABASE_URL?.includes('proxy.rlwy.net')
    ? { rejectUnauthorized: false }
    : undefined
});

export async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.error('[db] DATABASE_URL is not set. Add Postgres and set DATABASE_URL on Railway.');
    throw new Error('DATABASE_URL missing');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS watched_products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      context TEXT DEFAULT '',
      target_price NUMERIC,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_store_links (
      id BIGSERIAL PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES watched_products(id) ON DELETE CASCADE,
      store_key TEXT NOT NULL,
      store_name TEXT NOT NULL,
      url TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, store_key)
    );

    CREATE INDEX IF NOT EXISTS idx_product_store_links_product ON product_store_links(product_id);

    CREATE TABLE IF NOT EXISTS store_results (
      id BIGSERIAL PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES watched_products(id) ON DELETE CASCADE,
      store TEXT NOT NULL,
      title TEXT NOT NULL,
      price NUMERIC NOT NULL,
      old_price NUMERIC,
      promo_text TEXT,
      url TEXT,
      image_url TEXT,
      match_score INTEGER NOT NULL DEFAULT 0,
      is_promo BOOLEAN NOT NULL DEFAULT FALSE,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_store_results_product_time ON store_results(product_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_store_results_promo_time ON store_results(is_promo, checked_at DESC);

    CREATE TABLE IF NOT EXISTS notification_log (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      product_id TEXT,
      store TEXT,
      price NUMERIC,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      sent BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS scrape_logs (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT,
      product_id TEXT,
      product_name TEXT,
      store TEXT,
      level TEXT NOT NULL DEFAULT 'info',
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_scrape_logs_time ON scrape_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scrape_logs_run ON scrape_logs(run_id, created_at ASC);
  `);
}

export async function listProducts() {
  const { rows } = await pool.query(`
    SELECT p.*,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'storeKey', l.store_key,
          'storeName', l.store_name,
          'url', l.url,
          'active', l.active
        ) ORDER BY l.store_name), '[]'::json)
        FROM product_store_links l
        WHERE l.product_id = p.id
      ) AS store_links,
      (
        SELECT json_build_object(
          'store', r.store,
          'title', r.title,
          'price', r.price,
          'oldPrice', r.old_price,
          'promoText', r.promo_text,
          'url', r.url,
          'matchScore', r.match_score,
          'isPromo', r.is_promo,
          'checkedAt', r.checked_at
        )
        FROM store_results r
        WHERE r.product_id = p.id
          AND r.checked_at > NOW() - INTERVAL '48 hours'
        ORDER BY r.price ASC, r.match_score DESC
        LIMIT 1
      ) AS best_result
    FROM watched_products p
    ORDER BY p.created_at DESC
  `);
  return rows;
}

export async function getActiveProducts() {
  const { rows } = await pool.query(`
    SELECT p.*,
      COALESCE((
        SELECT json_agg(json_build_object(
          'storeKey', l.store_key,
          'storeName', l.store_name,
          'url', l.url,
          'active', l.active
        ) ORDER BY l.store_name)
        FROM product_store_links l
        WHERE l.product_id = p.id AND l.active = TRUE
      ), '[]'::json) AS store_links
    FROM watched_products p
    WHERE p.active = TRUE
    ORDER BY p.created_at ASC
  `);
  return rows;
}

export async function createProduct({ id, name, context, targetPrice, storeLinks = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO watched_products (id, name, context, target_price)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, name, context || '', targetPrice || null]
  );
  if (Array.isArray(storeLinks) && storeLinks.length) {
    await setProductStoreLinks(id, storeLinks);
  }
  return rows[0];
}

export async function setProductStoreLinks(productId, links = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const link of links) {
      const storeKey = String(link.storeKey || '').trim().toLowerCase();
      const storeName = String(link.storeName || storeKey || '').trim();
      const url = String(link.url || '').trim();
      if (!storeKey) continue;
      if (!url) {
        await client.query('DELETE FROM product_store_links WHERE product_id = $1 AND store_key = $2', [productId, storeKey]);
        continue;
      }
      await client.query(
        `INSERT INTO product_store_links (product_id, store_key, store_name, url, active, updated_at)
         VALUES ($1,$2,$3,$4,TRUE,NOW())
         ON CONFLICT (product_id, store_key)
         DO UPDATE SET store_name = EXCLUDED.store_name, url = EXCLUDED.url, active = TRUE, updated_at = NOW()`,
        [productId, storeKey, storeName, url]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getProductStoreLinks(productId) {
  const { rows } = await pool.query(
    `SELECT store_key AS "storeKey", store_name AS "storeName", url, active
     FROM product_store_links
     WHERE product_id = $1
     ORDER BY store_name ASC`,
    [productId]
  );
  return rows;
}

export async function updateProduct(id, data) {
  const { rows } = await pool.query(
    `UPDATE watched_products
     SET name = COALESCE($2, name),
         context = COALESCE($3, context),
         target_price = $4,
         active = COALESCE($5, active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, data.name, data.context, data.targetPrice ?? null, data.active]
  );
  return rows[0];
}

export async function deleteProduct(id) {
  await pool.query('DELETE FROM watched_products WHERE id = $1', [id]);
}

export async function resetResults() {
  await pool.query('DELETE FROM store_results');
  await pool.query("DELETE FROM notification_log WHERE type IN ('promotion', 'summary')");
}

export async function resetScrapeLogs() {
  await pool.query('DELETE FROM scrape_logs');
}

export async function addScrapeLog({ runId, productId, productName, store, level = 'info', event, message, data }) {
  try {
    await pool.query(
      `INSERT INTO scrape_logs (run_id, product_id, product_name, store, level, event, message, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [runId || null, productId || null, productName || null, store || null, level, event || 'log', message || '', data ? JSON.stringify(data) : null]
    );
  } catch (error) {
    console.warn('[scrape-log] falhou a gravar log:', error.message);
  }
}

export async function recentScrapeLogs(limit = 200) {
  const { rows } = await pool.query(
    `SELECT * FROM scrape_logs ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 200, 1000))]
  );
  return rows;
}

export async function saveResults(productId, results) {
  for (const result of results) {
    await pool.query(
      `INSERT INTO store_results
        (product_id, store, title, price, old_price, promo_text, url, image_url, match_score, is_promo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        productId,
        result.store,
        result.title,
        result.price,
        result.oldPrice ?? null,
        result.promoText ?? null,
        result.url ?? null,
        result.imageUrl ?? null,
        result.matchScore ?? 0,
        result.isPromo ?? false
      ]
    );
  }
}

export async function latestBestByProduct() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (product_id, store)
        *
      FROM store_results
      WHERE checked_at > NOW() - INTERVAL '36 hours'
      ORDER BY product_id, store, checked_at DESC
    ), ranked AS (
      SELECT p.name, p.context, p.target_price, l.*,
             ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY l.price ASC, l.match_score DESC) AS rn
      FROM watched_products p
      LEFT JOIN latest l ON l.product_id = p.id
      WHERE p.active = TRUE
    )
    SELECT * FROM ranked WHERE rn = 1 OR id IS NULL ORDER BY name ASC
  `);
  return rows;
}

export async function latestPromotions() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (product_id, store)
        r.*, p.name, p.context, p.target_price
      FROM store_results r
      JOIN watched_products p ON p.id = r.product_id
      WHERE p.active = TRUE
        AND r.checked_at > NOW() - INTERVAL '36 hours'
      ORDER BY product_id, store, checked_at DESC
    )
    SELECT * FROM latest
    WHERE is_promo = TRUE
       OR (old_price IS NOT NULL AND old_price > price)
       OR (target_price IS NOT NULL AND price <= target_price)
    ORDER BY price ASC, match_score DESC
  `);
  return rows;
}

export async function alreadySentPromoToday(productId, store, price) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_log
     WHERE type = 'promotion'
       AND product_id = $1
       AND store = $2
       AND price = $3
       AND sent = TRUE
       AND sent_at > NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [productId, store, price]
  );
  return rows.length > 0;
}

export async function logNotification({ type, productId, store, price, subject, body, sent, reason }) {
  await pool.query(
    `INSERT INTO notification_log (type, product_id, store, price, subject, body, sent, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [type, productId || null, store || null, price || null, subject, body, sent, reason || null]
  );
}

export async function recentResults(limit = 100) {
  const { rows } = await pool.query(`
    SELECT r.*, p.name AS product_name
    FROM store_results r
    JOIN watched_products p ON p.id = r.product_id
    ORDER BY r.checked_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

export async function productResults(productId) {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (store)
        id, product_id, store, title, price, old_price, promo_text, url, image_url,
        match_score, is_promo, checked_at
      FROM store_results
      WHERE product_id = $1
        AND checked_at > NOW() - INTERVAL '72 hours'
      ORDER BY store, checked_at DESC, match_score DESC
    )
    SELECT *
    FROM latest
    ORDER BY price ASC, match_score DESC
  `, [productId]);
  return rows;
}
