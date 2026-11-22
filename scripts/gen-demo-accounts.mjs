// Генерирует случайные пароли тестовых аккаунтов. Пароли нигде не печатаются:
// их читают сид, тесты и скрипт сборки СДАЧА.md.
//
//   node scripts/gen-demo-accounts.mjs          → seed/demo-accounts.json (локальный запуск, лежит в репозитории)
//   node scripts/gen-demo-accounts.mjs --prod   → seed/demo-accounts.prod.json (стенд для жюри; в открытый
//                                                 репозиторий не попадает, уезжает на сервер с веткой деплоя)

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';

const prod = process.argv.includes('--prod');
const name = prod ? 'demo-accounts.prod.json' : 'demo-accounts.json';
const file = join(import.meta.dirname, '..', 'seed', name);
if (existsSync(file) && !process.argv.includes('--force')) {
  console.log(`seed/${name} уже есть (перегенерировать: --force)`);
  process.exit(0);
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // без похожих символов: 0/O, 1/I/L
const chunk = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const password = () => `Deka-${chunk(4)}-${chunk(4)}`;

const accounts = {
  student1: { role: 'student', password: password() },
  student2: { role: 'student', password: password() },
  dekanat: { role: 'staff', password: password() },
};
writeFileSync(file, `${JSON.stringify(accounts, null, 2)}\n`);
console.log(`Создано: seed/${name} (3 аккаунта)`);
