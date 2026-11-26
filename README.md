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
| Opciones | O | — | ⚙ |
| Ranking online | R | — | 🏆 |

## Qué tiene
- Oleadas infinitas con dificultad progresiva, invasores en picada y blindados
- Jefe cada 5 oleadas, OVNI misterioso, power-ups y búnkers destructibles
- Combos hasta x5, vida extra cada 25.000 puntos, top 5 local
- Sonido sintetizado (WebAudio), partículas, efecto CRT
- **Desafío diario:** las mismas oleadas para todos cada día (azar con semilla), un intento oficial, resultado para compartir con emojis y ranking de HOY
- **Mejoras entre oleadas:** después de las oleadas pares y de cada jefe se elige 1 de 3 (cadencia, cañón doble, perforante, motores, imán, escudo automático, power-ups largos, vida extra)
- **Enemigos nuevos:** divisores que se parten en dos (oleada 6+) e invasores láser con aviso previo (oleada 8+); los búnkers frenan el rayo mientras aguantan
- **Sectores espaciales:** cada 5 oleadas saltás al hiperespacio a un escenario nuevo con su propio peligro: Órbita terrestre → Nebulosa (magmitas) → Cinturón de asteroides (frenan disparos) → Agujero negro (la gravedad curva los disparos) → Corona solar (erupciones con aviso)
- **Jefes por sector:** MOTHERSHIP (oleada 5), **MAGMA** (10, medusa de lava que llueve lava, suelta crías y se teletransporta), **TITAN** (15, núcleo de roca con un escudo de rocas que orbitan, se regeneran y te las tira), **VORTEX** (20, se traga tus disparos, te atrae y te los devuelve) y **SOLAR PHOENIX** (25, pica hacia tu nave y revive una vez). Desde la oleada 30 vuelven más rápidos (MOTHERSHIP MK II, MAGMA +1…)
- **Logros:** 23 logros guardados en el dispositivo (combate, habilidad, progreso y jefes), con aviso al desbloquearlos y pantalla propia (tecla L o 🏅)
- **Ranking renovado:** podio con medallas, tarjeta con tu puesto y cuántos puntos te faltan para pasar al de arriba, sector alcanzado por color y hace cuánto se jugó
- **Opciones:** volumen, temblor, destellos, efecto TV, vibración, botones táctiles grandes y modo zurdo (respeta "reducir movimiento" del sistema)
- **Mando:** también navega todas las pantallas (cruz o stick, A elige, B vuelve)
- **App instalable (PWA):** se agrega a la pantalla de inicio y funciona sin internet
- Vibración en Android, pantalla completa, vista previa al compartir el link

## Ranking online y ligas (Supabase)
El juego funciona sin esto; con Supabase configurado aparecen el botón 🏆 (o la tecla **R**), el ranking mundial y semanal, y las **ligas privadas** para competir con amigos por link.

1. Creá un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor → New query**, pegá todo `supabase/schema.sql` y tocá **Run**.
3. En **Project Settings → API Keys** copiá la *Project URL* y la clave **Publishable** (`sb_publishable_...`).
4. Pegalas en `src/config.js` y mergeá. **Nunca** uses la clave secreta (`sb_secret_...` / `service_role`): el juego la detecta y apaga el ranking.

Cómo funciona:
- Al empezar, el juego registra la partida (`start_run`); al perder ofrece guardar el puntaje con un nombre (`submit_score`).
- Las tablas están cerradas (RLS sin políticas): la clave pública sólo puede usar las funciones, que validan nombre, duración y puntaje posible para frenar trampas obvias.
- Liga privada: se crea desde el ranking y se comparte con un link `?liga=CODIGO` (por WhatsApp, por ejemplo).
- Desafío diario: `?modo=diario` abre el juego con el desafío elegido. El día cambia a las 00:00 UTC (21:00 en Argentina) y el servidor acepta un puntaje diario por dispositivo.
- Privacidad: se guarda el nombre que elige el jugador, el puntaje, la oleada, un ID anónimo del dispositivo y un hash de la IP para limitar abusos. No hay cuentas ni emails.

## Desarrollo
Requisitos: Node 20+ y Python 3 (para el servidor local).

```bash
npm install
npm start          # desarrollo: sirve la raíz en http://127.0.0.1:4173
npm run build      # arma dist/ con sólo lo que se publica
npm run preview    # build + sirve dist/ (igual que producción)
npm run lint       # ESLint
npm test           # tests en navegador real (Playwright) contra dist/: escritorio, celular y PWA
npm run test:db    # tests del esquema SQL (necesita DATABASE_URL de un Postgres vacío)
```

Con `DATABASE_URL` definido, `npm test` también corre la integración de punta a punta contra la base (como en la CI).

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
src/config.js         URL y clave pública de Supabase (opcional)
src/online.js         cliente del ranking (fetch a las funciones RPC)
src/ui.js             pantallas de ranking, ligas y guardar puntaje
src/rng.js            azar con semilla (una corriente por sistema)
src/daily.js          desafío diario: día UTC, intento, texto para compartir
src/upgrades.js       mejoras entre oleadas (datos y ofertas)
src/settings.js       opciones del jugador
supabase/schema.sql   tablas, seguridad y funciones del ranking
tests/                tests de Playwright
```

### Cómo se trabaja
Cada mejora va en una rama propia y entra a `main` por pull request. GitHub Actions corre lint y tests en cada PR; si algo falla, no se mergea.

Al agregar un archivo que el juego carga, sumalo a `CORE` en `sw.js` (hay un test que lo controla).

## Créditos
Fuente [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) de CodeMan38, licencia SIL OFL 1.1 (`assets/fonts/OFL.txt`).
