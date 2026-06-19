import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  initDb,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  resetResults,
  recentResults
} from './db.js';
import { checkAllProducts } from './scraper.js';
import { getStoreConfig } from './stores/index.js';
import { sendDailySummaryEmail, sendPromotionAlerts, smtpDiagnostics } from './notify.js';
import { startScheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured) return res.status(500).json({ error: 'ADMIN_API_KEY não configurada' });
  const provided = req.header('x-admin-api-key') || req.query.adminKey;
  if (provided !== configured) return res.status(401).json({ error: 'Admin API key inválida' });
  next();
}

app.get('/api/health', (_, res) => res.json({ ok: true, app: 'pricewatch-pt-comparator' }));

app.get('/api/stores', (_, res) => res.json(getStoreConfig()));

app.get('/api/products', async (_, res, next) => {
  try { res.json(await listProducts()); } catch (error) { next(error); }
});

app.post('/api/products', requireAdmin, async (req, res, next) => {
  try {
    const { name, context, targetPrice } = req.body;
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Nome do produto obrigatório' });
    const product = await createProduct({
      id: crypto.randomUUID(),
      name: String(name).trim(),
      context: String(context || '').trim(),
      targetPrice: targetPrice ? Number(targetPrice) : null
    });
    res.status(201).json(product);
  } catch (error) { next(error); }
});

app.put('/api/products/:id', requireAdmin, async (req, res, next) => {
  try { res.json(await updateProduct(req.params.id, req.body)); } catch (error) { next(error); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res, next) => {
  try { await deleteProduct(req.params.id); res.json({ ok: true }); } catch (error) { next(error); }
});

app.get('/api/results/recent', async (req, res, next) => {
  try { res.json(await recentResults(Number(req.query.limit || 100))); } catch (error) { next(error); }
});

app.post('/api/admin/check-now', requireAdmin, async (_, res, next) => {
  try { res.json({ ok: true, checked: await checkAllProducts() }); } catch (error) { next(error); }
});

app.post('/api/admin/reset-results', requireAdmin, async (_, res, next) => {
  try {
    await resetResults();
    res.json({ ok: true, result: { reset: true, message: 'Resultados e notificações apagados. Os produtos monitorizados foram mantidos.' } });
  } catch (error) { next(error); }
});

app.post('/api/admin/smtp-diagnostics', requireAdmin, async (_, res, next) => {
  try { res.json({ ok: true, result: await smtpDiagnostics() }); } catch (error) { next(error); }
});

app.post('/api/admin/send-summary-test', requireAdmin, async (_, res, next) => {
  try { res.json({ ok: true, result: await sendDailySummaryEmail({ test: true }) }); } catch (error) { next(error); }
});

app.post('/api/admin/send-promotion-test', requireAdmin, async (_, res, next) => {
  try { res.json({ ok: true, result: await sendPromotionAlerts({ test: true }) }); } catch (error) { next(error); }
});

app.post('/api/admin/run-daily', requireAdmin, async (_, res, next) => {
  try {
    const checked = await checkAllProducts();
    const promos = await sendPromotionAlerts();
    const summary = await sendDailySummaryEmail();
    res.json({ ok: true, checked, promos, summary });
  } catch (error) { next(error); }
});

const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erro interno' });
});

await initDb();
startScheduler();
app.listen(port, () => console.log(`[server] listening on ${port}`));
