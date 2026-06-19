import 'dotenv/config';
import { initDb } from '../db.js';
import { runDailyJob } from '../scheduler.js';

await initDb();
await runDailyJob();
process.exit(0);
