// Собирает статические ассеты клиента из npm-пакетов с открытой лицензией:
//   шрифты Golos Text и Unbounded (OFL-1.1, пакеты @fontsource-variable/*) → public/fonts/
//   иконки Lucide (ISC, пакет lucide-static) → один спрайт public/icons.svg
// Использование: node scripts/build-assets.mjs <папка с node_modules, где стоят эти пакеты>
// Пакеты нужны только для этой сборки, в зависимости сервера они не входят.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src || !existsSync(join(src, 'node_modules'))) {
  console.error('Укажите папку, где выполнено: npm i lucide-static @fontsource-variable/golos-text @fontsource-variable/unbounded');
  process.exit(1);
}
const nm = join(src, 'node_modules');
const pub = join(import.meta.dirname, '..', 'public');
mkdirSync(join(pub, 'fonts'), { recursive: true });

for (const [pkg, family] of [['golos-text', 'golos-text'], ['unbounded', 'unbounded']]) {
  for (const subset of ['cyrillic', 'latin']) {
    const file = `${family}-${subset}-wght-normal.woff2`;
    copyFileSync(join(nm, '@fontsource-variable', pkg, 'files', file), join(pub, 'fonts', file));
  }
  copyFileSync(join(nm, '@fontsource-variable', pkg, 'LICENSE'), join(pub, 'fonts', `LICENSE-${family}.txt`));
}

const ICONS = [
  'sun', 'calendar-days', 'graduation-cap', 'file-text', 'bell', 'user', 'log-out', 'chevron-right', 'chevron-left',
  'chevron-down', 'check', 'x', 'clock', 'map-pin', 'triangle-alert', 'file-check', 'wallet', 'rotate-ccw',
  'calendar-plus', 'heart-handshake', 'copy', 'message-circle', 'send', 'plus', 'megaphone', 'shield-check',
  'arrow-left', 'inbox', 'users', 'info', 'eye', 'eye-off', 'calendar-x', 'arrow-right-left', 'door-open',
  'external-link', 'circle-check', 'lock', 'flame', 'book-open', 'list-checks', 'replace', 'calendar-clock', 'search',
];
const symbols = [];
const missing = [];
for (const name of ICONS) {
  const file = join(nm, 'lucide-static', 'icons', `${name}.svg`);
  if (!existsSync(file)) { missing.push(name); continue; }
  const svg = readFileSync(file, 'utf8');
  const inner = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s+/g, ' ').trim();
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}
writeFileSync(join(pub, 'icons.svg'),
  `<!-- Иконки Lucide (https://lucide.dev), лицензия ISC -->\n<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n</svg>\n`);
console.log(`Шрифты скопированы, иконок в спрайте: ${symbols.length}` + (missing.length ? `; НЕ НАЙДЕНЫ: ${missing.join(', ')}` : ''));
