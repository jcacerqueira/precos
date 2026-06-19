import { getActiveProducts, saveResults } from './db.js';
import { searchAllStores } from './stores/index.js';

export async function checkProduct(product) {
  const results = await searchAllStores(product.name, product.context || '');
  const filtered = results
    .filter(r => r.price && r.matchScore >= Number(process.env.MIN_MATCH_SCORE || 35))
    .sort((a, b) => b.matchScore - a.matchScore || a.price - b.price);

  // Guarda no máximo os melhores resultados por loja para não poluir a tabela
  // com candidatos fracos/repetidos que parecem promoções por causa de texto genérico do site.
  const byStore = new Map();
  for (const result of filtered) {
    const key = result.store;
    const current = byStore.get(key);
    if (!current || result.matchScore > current.matchScore || (result.matchScore === current.matchScore && result.price < current.price)) {
      byStore.set(key, result);
    }
  }
  const bestPerStore = [...byStore.values()].sort((a, b) => a.price - b.price || b.matchScore - a.matchScore);
  await saveResults(product.id, bestPerStore);
  return { product, results: bestPerStore };
}

export async function checkAllProducts() {
  const products = await getActiveProducts();
  const output = [];
  for (const product of products) {
    try {
      const result = await checkProduct(product);
      output.push(result);
    } catch (error) {
      console.error(`[check] ${product.name}:`, error);
      output.push({ product, results: [], error: error.message });
    }
  }
  return output;
}
