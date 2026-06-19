import cron from 'node-cron';
import { checkAllProducts } from './scraper.js';
import { sendDailySummaryEmail, sendPromotionAlerts } from './notify.js';

export async function runDailyJob() {
  console.log('[scheduler] running daily price check');
  await checkAllProducts();
  const promos = await sendPromotionAlerts();
  const summary = await sendDailySummaryEmail();
  console.log('[scheduler] done', { promos, summary });
  return { promos, summary };
}

export function startScheduler() {
  const expression = process.env.CHECK_CRON || '0 9 * * *';
  if (!cron.validate(expression)) {
    console.warn(`[scheduler] invalid CHECK_CRON: ${expression}. Scheduler disabled.`);
    return;
  }
  cron.schedule(expression, runDailyJob, { timezone: 'Europe/Lisbon' });
  console.log(`[scheduler] scheduled: ${expression} Europe/Lisbon`);
}
