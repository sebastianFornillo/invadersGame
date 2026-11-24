// Mejoras permanentes que se eligen entre oleadas (1 de 3), sólo para esa partida.
export const UPGRADES = [
  { id: 'rate', icon: '⚡', name: 'CADENCIA', desc: 'Disparás 15% más rápido', max: 3 },
  { id: 'twin', icon: '🔱', name: 'CAÑÓN DOBLE', desc: 'Dos disparos paralelos', max: 1 },
  { id: 'pierce', icon: '🗡️', name: 'PERFORANTE', desc: 'Cada disparo atraviesa un enemigo más', max: 2 },
  { id: 'speed', icon: '🚀', name: 'MOTORES', desc: 'La nave se mueve 12% más rápido', max: 2 },
  { id: 'magnet', icon: '🧲', name: 'IMÁN', desc: 'Los power-ups vienen hacia vos', max: 1 },
  { id: 'regen', icon: '🛡️', name: 'ESCUDO AUTOMÁTICO', desc: 'Empezás cada oleada con escudo', max: 1 },
  { id: 'duration', icon: '⏳', name: 'POWER-UPS LARGOS', desc: 'Los power-ups duran 50% más', max: 2 },
  { id: 'life', icon: '❤️', name: 'VIDA EXTRA', desc: 'Sumás una vida ahora', max: Infinity },
];

export const emptyLevels = () => Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));

// Hay mejora después de las oleadas pares y de cada jefe
export const upgradeDue = (wave, bossWave) => bossWave || wave % 2 === 0;

// Elige hasta 3 mejoras distintas que todavía se puedan subir. rng() devuelve [0, 1).
export function offerUpgrades(levels, rng, { canAddLife }) {
  const pool = UPGRADES.filter((u) => levels[u.id] < u.max && (u.id !== 'life' || canAddLife));
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return chosen;
}
