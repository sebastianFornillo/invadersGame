# Invaders Space v2

Shooter arcade inspirado en Space Invaders, en JavaScript puro (sin dependencias ni build). Abrí `index.html` o publicalo en GitHub Pages.

## Controles
| Acción | Teclado | Mando | Táctil |
|---|---|---|---|
| Mover | ← → / A D | Stick / D-pad | ◀ ▶ |
| Disparar (mantener) | Espacio / ↑ / W | A / RT | FIRE |
| Pausa | P / Esc | Start | II |
| Sonido | M | — | ♪ |

## Qué tiene
- Loop con delta time: misma velocidad en monitores de 60, 120 o 144 Hz
- Oleadas infinitas con dificultad progresiva: más filas, más velocidad, disparos apuntados, invasores blindados
- Invasores que se tiran en picada desde la oleada 3 (valen el doble)
- Jefe (Mothership) cada 5 oleadas con 3 patrones de ataque y modo furia
- OVNI misterioso con puntaje sorpresa
- Power-ups: Triple disparo, Disparo rápido, Escudo, Vida extra
- Búnkers destructibles pixel a pixel
- Combos con multiplicador hasta x5, vida extra cada 25.000 puntos, bonus por oleada perfecta
- Partículas, screen shake, slow-motion al morir, efecto CRT
- Sonido sintetizado con WebAudio (sin archivos de audio)
- Top 5 de récords guardado en el navegador, estadísticas de partida
- Responsivo, controles táctiles y soporte de mando
