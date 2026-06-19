import { getActiveProducts, saveResults } from './db.js';
import { searchAllStores } from './stores/index.js';

export async function checkProduct(product) {
  const results = await searchAllStores(product.name, product.context || '');
  const filtered = results
    .filter(r => r.price && r.matchScore >= 25)
    .sort((a, b) => b.matchScore - a.matchScore || a.price - b.price);
  await saveResults(product.id, filtered);
  return { product, results: filtered };
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
