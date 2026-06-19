import crypto from 'crypto';
import { getActiveProducts, saveResults, addScrapeLog } from './db.js';
import { searchAllStores } from './stores/index.js';

function makeLogger({ runId, product }) {
  return async ({ level = 'info', event = 'log', store = null, message = '', data = null }) => {
    const prefix = store ? `[scrape:${runId}] ${product.name} / ${store}` : `[scrape:${runId}] ${product.name}`;
    const line = `${prefix} ${event}: ${message}`;
    if (level === 'warn') console.warn(line);
    else if (level === 'error') console.error(line);
    else console.log(line);
    await addScrapeLog({
      runId,
      productId: product.id,
      productName: product.name,
      store,
      level,
      event,
      message,
      data
    });
  };
}

export async function checkProduct(product, runId = crypto.randomUUID()) {
  const minScore = Number(process.env.MIN_MATCH_SCORE || 35);
  const logger = makeLogger({ runId, product });
  await logger({ level: 'info', event: 'product_filter', message: `Filtro final MIN_MATCH_SCORE=${minScore}`, data: { minScore, context: product.context || '' } });

  const results = await searchAllStores(product.name, product.context || '', logger, product.store_links || []);
  const rejected = results
    .filter(r => !r.price || r.matchScore < minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 20)
    .map(r => ({ store: r.store, title: r.title, price: r.price, score: r.matchScore, url: r.url }));

  if (rejected.length) {
    await logger({ level: 'info', event: 'rejected_candidates', message: `${rejected.length} candidatos rejeitados pelo filtro final`, data: { rejected } });
  }

  const filtered = results
    .filter(r => r.price && r.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore || a.price - b.price);

  const byStore = new Map();
  for (const result of filtered) {
    const key = result.store;
    const current = byStore.get(key);
    if (!current || result.matchScore > current.matchScore || (result.matchScore === current.matchScore && result.price < current.price)) {
      byStore.set(key, result);
    }
  }
  const bestPerStore = [...byStore.values()].sort((a, b) => a.price - b.price || b.matchScore - a.matchScore);

  await logger({
    level: bestPerStore.length ? 'info' : 'warn',
    event: 'accepted_results',
    message: bestPerStore.length ? `${bestPerStore.length} lojas com resultado aceite` : 'Nenhum resultado aceite para este produto',
    data: { results: bestPerStore.map(r => ({ store: r.store, title: r.title, price: r.price, oldPrice: r.oldPrice, score: r.matchScore, isPromo: r.isPromo, url: r.url })) }
  });

  await saveResults(product.id, bestPerStore);
  return { product, results: bestPerStore };
}

export async function checkAllProducts() {
  const runId = crypto.randomUUID();
  const products = await getActiveProducts();
  const output = [];
  console.log(`[scrape:${runId}] início: ${products.length} produtos`);
  await addScrapeLog({ runId, level: 'info', event: 'run_start', message: `Início da verificação: ${products.length} produtos`, data: { productCount: products.length } });

  for (const product of products) {
    try {
      const result = await checkProduct(product, runId);
      output.push(result);
    } catch (error) {
      console.error(`[check] ${product.name}:`, error);
      await addScrapeLog({ runId, productId: product.id, productName: product.name, level: 'error', event: 'product_error', message: error.message || String(error), data: { stack: error.stack } });
      output.push({ product, results: [], error: error.message });
    }
  }

  await addScrapeLog({ runId, level: 'info', event: 'run_done', message: 'Verificação concluída', data: { productCount: products.length } });
  console.log(`[scrape:${runId}] fim`);
  return output;
}
