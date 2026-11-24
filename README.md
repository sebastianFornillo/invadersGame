# Invaders Space

Shooter arcade inspirado en Space Invaders, en JavaScript puro: sin frameworks ni paso de build.

**Jugar:** en el deploy de Vercel del repo, o en https://sebastianfornillo.github.io/invadersGame/ si GitHub Pages está activado.

## Controles
| Acción | Teclado | Mando | Táctil |
|---|---|---|---|
| Mover | ← → / A D | Stick / D-pad | ◀ ▶ |
| Disparar (mantener) | Espacio / ↑ / W | A / RT | FIRE |
| Pausa | P / Esc | Start | II |
| Sonido | M | — | ♪ |

## Qué tiene
- Oleadas infinitas con dificultad progresiva, invasores en picada y blindados
- Jefe cada 5 oleadas, OVNI misterioso, power-ups y búnkers destructibles
- Combos hasta x5, vida extra cada 25.000 puntos, top 5 local
- Sonido sintetizado (WebAudio), partículas, efecto CRT
- **App instalable (PWA):** se agrega a la pantalla de inicio y funciona sin internet
- Vibración en Android, pantalla completa, vista previa al compartir el link

## Desarrollo
Requisitos: Node 20+ y Python 3 (para el servidor local).

```bash
npm install
npm start          # desarrollo: sirve la raíz en http://127.0.0.1:4173
npm run build      # arma dist/ con sólo lo que se publica
npm run preview    # build + sirve dist/ (igual que producción)
npm run lint       # ESLint
npm test           # tests en navegador real (Playwright) contra dist/: escritorio, celular y PWA
```

### Deploy
- **Vercel** (recomendado): `vercel.json` ya lo configura como sitio estático (`npm run build` → `dist/`). Cada PR genera una URL de prueba y `main` se publica solo. La vista previa para WhatsApp toma el dominio de producción automáticamente.
- **GitHub Pages**: también funciona sin build, sirviendo la raíz de `main`.

> El juego usa módulos ES y service worker, así que hay que abrirlo con un servidor (no con doble clic en `index.html`).

### Estructura
```
index.html            página y meta tags (PWA, vista previa)
vercel.json           deploy estático en Vercel
scripts/build.mjs     arma dist/ y valida los archivos offline
styles.css            estilos y controles táctiles
sw.js                 service worker (modo offline)
manifest.webmanifest  datos de la app instalable
src/game.js           núcleo del juego
src/sound.js          sonido sintetizado
src/storage.js        guardado seguro en localStorage
src/platform.js       PWA, vibración, pantalla completa
tests/                tests de Playwright
```

### Cómo se trabaja
Cada mejora va en una rama propia y entra a `main` por pull request. GitHub Actions corre lint y tests en cada PR; si algo falla, no se mergea.

Al agregar un archivo que el juego carga, sumalo a `CORE` en `sw.js` (hay un test que lo controla).

## Créditos
Fuente [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) de CodeMan38, licencia SIL OFL 1.1 (`assets/fonts/OFL.txt`).
