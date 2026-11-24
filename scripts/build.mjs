// Arma dist/ con sólo lo que se publica (sin node_modules, tests ni config).
// Lo usan Vercel (vercel.json) y los tests, así se prueba exactamente lo que sale.
//
// Si corre en Vercel, ajusta los links absolutos de la vista previa (og:url,
// og:image) al dominio de producción del proyecto.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const FILES = ['index.html', 'start.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'og.png'];
const DIRS = ['src', 'assets', 'icons'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const f of FILES) cpSync(join(root, f), join(dist, f));
for (const d of DIRS) cpSync(join(root, d), join(dist, d), { recursive: true });

// De img/ sólo se copian las imágenes que el código usa de verdad.
const code = [...readdirSync(join(root, 'src')).map((f) => join('src', f)), 'sw.js', 'index.html']
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');
const usedImages = [...new Set([...code.matchAll(/img\/[\w.-]+\.(?:png|jpe?g|gif|webp|svg)/g)].map((m) => m[0]))];
mkdirSync(join(dist, 'img'), { recursive: true });
for (const img of usedImages) cpSync(join(root, img), join(dist, img));

// Dominio de producción en Vercel → links absolutos de la vista previa
const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (prodHost) {
  const indexPath = join(dist, 'index.html');
  const html = readFileSync(indexPath, 'utf8').replaceAll(
    'https://sebastianfornillo.github.io/invadersGame/',
    `https://${prodHost}/`,
  );
  writeFileSync(indexPath, html);
}

// Control: todo lo que el service worker guarda para modo offline tiene que existir.
const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
const core = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
const missing = core.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.error(`Faltan en dist/ archivos listados en CORE de sw.js: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(
  `dist/ listo: ${FILES.length} archivos, ${DIRS.join(', ')}, ${usedImages.length} imágenes` +
    (prodHost ? ` · vista previa → https://${prodHost}/` : ''),
);
