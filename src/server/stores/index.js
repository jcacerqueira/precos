import * as cheerio from 'cheerio';

const ALL_STORES = [
  { key: 'continente', name: 'Continente', level: 'supported', searchUrl: q => `https://www.continente.pt/pesquisa/?q=${encodeURIComponent(q)}` },
  { key: 'auchan', name: 'Auchan', level: 'supported', searchUrl: q => `https://www.auchan.pt/pt/search?q=${encodeURIComponent(q)}` },
  { key: 'pingodoce', name: 'Pingo Doce', level: 'supported', searchUrl: q => `https://www.pingodoce.pt/?s=${encodeURIComponent(q)}` },
  { key: 'lidl', name: 'Lidl', level: 'supported', searchUrl: q => `https://www.lidl.pt/q/search?q=${encodeURIComponent(q)}` },

  // Estes sites são mais problemáticos: 403, catálogo incompleto, loja/localidade ou pesquisa não pública.
  // Ficam disponíveis, mas desligados por defeito para não poluir logs/resultados.
  { key: 'intermarche', name: 'Intermarché', level: 'limited', searchUrl: q => `https://www.intermarche.pt/pesquisa/?text=${encodeURIComponent(q)}`, note: 'Pode devolver 403 ou exigir contexto de loja.' },
  { key: 'minipreco', name: 'Minipreço', level: 'limited', searchUrl: q => `https://www.minipreco.pt/search?text=${encodeURIComponent(q)}`, note: 'Pode falhar por DNS/site/anti-bot.' },
  { key: 'mercadona', name: 'Mercadona', level: 'limited', searchUrl: q => `https://www.mercadona.pt/pt/pesquisa?q=${encodeURIComponent(q)}`, note: 'Portugal não tem catálogo online público completo; tende a não devolver preços pesquisáveis.' },
  { key: 'aldi', name: 'ALDI', level: 'limited', searchUrl: q => `https://www.aldi.pt/pesquisa.html?search=${encodeURIComponent(q)}`, note: 'Pesquisa/produtos variam; pode devolver 404.' }
];

const DEFAULT_ENABLED_STORES = ['continente', 'auchan', 'pingodoce', 'lidl'];

function parseListEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function enabledStoreKeys() {
  const explicit = parseListEnv('ENABLED_STORES');
  const disabled = new Set(parseListEnv('DISABLED_STORES'));
  const keys = explicit.length ? explicit : DEFAULT_ENABLED_STORES;
  return keys.filter(k => !disabled.has(k));
}

export function getStoreConfig() {
  const enabled = new Set(enabledStoreKeys());
  return ALL_STORES.map(s => ({ ...s, enabled: enabled.has(s.key) }));
}

export function getEnabledStores() {
  const enabled = new Set(enabledStoreKeys());
  return ALL_STORES.filter(s => enabled.has(s.key));
}

function normalizeText(value = '') {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter(t => t.length > 1 && !['de','do','da','e','com','pt','un','pack','emb'].includes(t));
}

export function scoreMatch(query, title, context = '') {
  const wanted = tokenize(`${query} ${context}`);
  const actual = normalizeText(title);
  if (!wanted.length || !actual) return 0;
  let score = 0;
  for (const token of wanted) {
    if (actual.includes(token)) score += token.length >= 4 ? 15 : 8;
  }
  const q = normalizeText(query);
  if (actual.includes(q)) score += 60;
  const sizeMatches = normalizeText(`${query} ${context}`).match(/\b\d+(?:[,.]\d+)?\s?(l|lt|ml|kg|g)\b/g) || [];
  for (const s of sizeMatches) {
    if (actual.includes(s.replace(',', '.')) || actual.includes(s.replace('.', ','))) score += 25;
  }
  return Math.min(score, 100);
}

function parsePrice(text = '') {
  if (!text) return null;
  let cleaned = String(text)
    .replace(/\s+/g, ' ')
    .replace(/€/g, ' €')
    .trim();

  // Remove preços por unidade, ex: "0,99 €/Lt", "6,60 €/kg", "0,10 €/100ml".
  // Estes aparecem muito nos supermercados e não são o preço final do produto.
  cleaned = cleaned.replace(/\b\d{1,3}(?:[.,]\d{2})\s*€\s*\/\s*(?:kg|g|l|lt|litro|litros|ml|cl|un|unid|100\s?g|100\s?ml)\b/gi, ' ');
  cleaned = cleaned.replace(/\b\d{1,3}(?:[.,]\d{2})\s*€\s*(?:por|\/)?\s*(?:kg|g|l|lt|litro|litros|ml|cl|un|unid|100\s?g|100\s?ml)\b/gi, ' ');

  const matches = [...cleaned.matchAll(/\b(\d{1,3}(?:[.,]\d{2}))\s*€/g)].map(m => Number(m[1].replace(',', '.')));
  if (!matches.length) return null;
  const valid = matches.filter(v => v > 0 && v < 100);
  if (!valid.length) return null;
  return valid[0];
}

function extractStructuredPrice(node) {
  const selectors = [
    '[itemprop="price"]', '[content][itemprop="price"]', 'meta[property="product:price:amount"]',
    '[data-price]', '[data-test*="price"]', '[data-testid*="price"]',
    '.sales .value', '.price .value', '.product-price .value', '.current-price', '.final-price',
    '.sales-price', '.price-sales', '.price__value', '.priceValue', '.price'
  ];
  for (const selector of selectors) {
    const el = node.find(selector).first();
    if (!el.length) continue;
    const raw = String(el.attr('content') || el.attr('data-price') || el.attr('value') || el.text() || '');
    const price = parsePrice(raw.includes('€') ? raw : `${raw} €`);
    if (price) return price;
  }
  return null;
}

function extractOldPrice(node, text) {
  const selectors = [
    '.old-price', '.price-old', '.strike', '.was-price', '.regular-price', '.list-price',
    '[class*="old-price"]', '[class*="oldPrice"]', '[class*="strike"]', '[class*="was"]', 'del', 's'
  ];
  for (const selector of selectors) {
    const raw = node.find(selector).first().text();
    const p = parsePrice(raw);
    if (p) return p;
  }
  const m = String(text).match(/(?:antes|preço\s*anterior|de)\s*(\d{1,3}(?:[.,]\d{2}))\s*€/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

function extractPromoText(node, text) {
  // Promoções só devem vir de elementos pequenos e próximos do produto.
  // Antes usávamos o texto completo do card, que em alguns sites inclui menus como
  // "promoções"/"campanhas" e fazia quase tudo aparecer como promoção.
  const badgeText = node
    .find('.badge,.label,.promotion,.discount,.promo,[class*="discount"],[class*="promo"],[class*="campaign"],del,s')
    .text()
    .replace(/\s+/g, ' ')
    .trim();

  const explicit = String(text || '').match(/(?:poupe\s+\d{1,3}[,.]\d{2}\s*€|antes\s+\d{1,3}[,.]\d{2}\s*€|\d+\s?%\s*(?:desconto|off)|2\s?ª\s?unidade|leve\s+\d\s+pague\s+\d)/i)?.[0];
  const raw = [badgeText, explicit].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (!/(desconto|poupe|antes\s+\d|\d+\s?%|2\s?ª|leve\s+\d|oferta|promo)/i.test(raw)) return null;
  return raw.slice(0, 160);
}

function isPromotion({ price, oldPrice, promoText }) {
  if (oldPrice && price && oldPrice > price * 1.02) return true;
  if (promoText && /(desconto|poupe|antes\s+\d|\d+\s?%|2\s?ª|leve\s+\d|oferta)/i.test(promoText)) return true;
  return false;
}

function absoluteUrl(base, maybeUrl) {
  if (!maybeUrl) return null;
  try { return new URL(maybeUrl, base).toString(); } catch { return maybeUrl; }
}

function extractJsonLdProducts($, storeName, baseUrl, query, context) {
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = item['@graph'] || [item];
        for (const node of graph) {
          const list = node.itemListElement?.map(x => x.item || x) || (node['@type'] === 'Product' ? [node] : []);
          for (const p of list) {
            const title = p.name || p.title;
            const price = Number(String(p.offers?.price || p.offers?.lowPrice || '').replace(',', '.'));
            if (!title || !price) continue;
            const matchScore = scoreMatch(query, title, context);
            if (matchScore < 25) continue;
            results.push({
              store: storeName,
              title,
              price,
              oldPrice: null,
              promoText: null,
              url: absoluteUrl(baseUrl, p.url || p.offers?.url),
              imageUrl: Array.isArray(p.image) ? p.image[0] : p.image,
              matchScore,
              isPromo: false
            });
          }
        }
      }
    } catch {}
  });
  return results;
}

function extractHtmlCandidates($, storeName, baseUrl, query, context) {
  const candidates = [];
  const selectors = [
    '[data-product-id]', '[data-pid]', '[data-testid*="product"]', '.product', '.product-tile', '.product-card', '.product-item', '.search-product', 'article', 'li'
  ];
  const seen = new Set();

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const node = $(el);
      const text = node.text().replace(/\s+/g, ' ').trim();
      if (text.length < 8 || text.length > 1400) return;
      const price = extractStructuredPrice(node) || parsePrice(text);
      if (!price) return;

      const link = node.find('a[href]').first().attr('href') || node.closest('a[href]').attr('href');
      const url = absoluteUrl(baseUrl, link);
      const title =
        node.find('[itemprop="name"]').first().text().trim() ||
        node.find('h1,h2,h3,h4,.name,.product-name,.title,[class*="name"],[class*="title"]').first().text().trim() ||
        text.split('€')[0].slice(0, 140).trim();
      if (!title) return;
      const key = `${storeName}:${title}:${price}`;
      if (seen.has(key)) return;
      seen.add(key);

      const oldPrice = extractOldPrice(node, text);
      const promoText = extractPromoText(node, text);
      const imageUrl = absoluteUrl(baseUrl, node.find('img[src]').first().attr('src'));
      const matchScore = scoreMatch(query, title, context);
      if (matchScore < 25) return;

      candidates.push({
        store: storeName,
        title,
        price,
        oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
        promoText,
        url,
        imageUrl,
        matchScore,
        isPromo: isPromotion({ price, oldPrice, promoText, text })
      });
    });
  }
  return candidates;
}

function browserHeaders(url) {
  const origin = new URL(url).origin;
  return {
    'user-agent': process.env.SCRAPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 PriceWatchPT/2.3',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'upgrade-insecure-requests': '1',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'referer': origin + '/'
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, attempts = Number(process.env.SCRAPER_ATTEMPTS || 2)) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.REQUEST_TIMEOUT_MS || 15000));
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: browserHeaders(url)
      });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        throw err;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error?.status && [403, 404].includes(error.status)) throw error;
      if (i < attempts - 1) await sleep(600 + i * 700);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export async function searchStore(store, query, context = '') {
  const url = store.searchUrl(`${query} ${context}`.trim());
  const html = await fetchWithTimeout(url);
  const $ = cheerio.load(html);
  const results = [
    ...extractJsonLdProducts($, store.name, url, query, context),
    ...extractHtmlCandidates($, store.name, url, query, context)
  ];

  const deduped = [];
  const seen = new Set();
  for (const r of results.sort((a,b) => b.matchScore - a.matchScore || a.price - b.price)) {
    const key = `${r.title}|${r.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped.slice(0, 5);
}

function classifyScraperError(error) {
  const msg = error?.message || String(error);
  if (/HTTP 403/.test(msg)) return 'bloqueado pelo site (HTTP 403)';
  if (/HTTP 404/.test(msg)) return 'pesquisa não encontrada no site (HTTP 404)';
  if (/aborted|AbortError|timeout/i.test(msg)) return 'timeout';
  if (/fetch failed/i.test(msg)) return 'fetch failed / rede';
  return msg;
}

export async function searchAllStores(query, context = '') {
  const stores = getEnabledStores();
  console.log('[scraper] lojas ativas:', stores.map(s => s.name).join(', '));

  const settled = await Promise.allSettled(stores.map(async store => {
    try {
      return await searchStore(store, query, context);
    } catch (error) {
      const reason = classifyScraperError(error);
      console.warn(`[scraper] ${store.name}: ${reason}`);
      return [];
    }
  }));
  return settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
}

export const STORES = ALL_STORES;
