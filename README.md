# Invaders Space

Shooter arcade inspirado en Space Invaders, en JavaScript puro: sin frameworks ni paso de build.

**Jugar:** https://sebastianfornillo.github.io/invadersGame/ (con GitHub Pages activado sobre `main`).

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
npm start          # http://127.0.0.1:4173
npm run lint       # ESLint
npm test           # tests en navegador real (Playwright): escritorio, celular y PWA
```

> El juego usa módulos ES y service worker, así que hay que abrirlo con un servidor (no con doble clic en `index.html`).

### Estructura
```
index.html            página y meta tags (PWA, vista previa)
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
