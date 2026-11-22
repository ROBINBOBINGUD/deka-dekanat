// Генерирует случайные пароли тестовых аккаунтов жюри в seed/demo-accounts.json.
// Пароли нигде не печатаются: их читают сид, тесты и скрипт сборки СДАЧА.md.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';

const file = join(import.meta.dirname, '..', 'seed', 'demo-accounts.json');
if (existsSync(file) && !process.argv.includes('--force')) {
  console.log('seed/demo-accounts.json уже есть (перегенерировать: --force)');
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
console.log('Создано: seed/demo-accounts.json (3 аккаунта)');
