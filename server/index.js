// Точка входа: открывает БД, при первом запуске заполняет её вымышленными данными, поднимает сервер.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { cleanup, warmUp } from './auth.js';
import { seedDatabase, loadSeedFiles } from '../seed/seed.js';

// На Amvera приложение обязано слушать порт из amvera.yml (run.containerPort = 3000).
const PORT = Number(process.env.DEKA_PORT || (process.env.AMVERA ? 3000 : process.env.PORT || 3000));
// На Amvera постоянный диск смонтирован в /data; локально — папка ./data рядом с проектом.
const DATA_DIR = process.env.DATA_DIR || (process.env.AMVERA ? '/data' : join(import.meta.dirname, '..', 'data'));

mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(join(DATA_DIR, 'deka.db'));

if (db.get('SELECT COUNT(*) AS n FROM users').n === 0 || process.env.RESEED === '1') {
  const { data, accounts } = loadSeedFiles();
  await seedDatabase(db, data, accounts);
  console.log('БД заполнена вымышленными данными из seed/data.json');
}

await warmUp();
cleanup(db);
setInterval(() => cleanup(db), 3600 * 1000).unref();

const app = createApp(db);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`«Дека» слушает порт ${PORT}, данные в ${DATA_DIR}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
