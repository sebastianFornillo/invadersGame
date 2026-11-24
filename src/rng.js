// Azar con semilla: misma semilla → misma secuencia de números.
// Se usa una "corriente" independiente por sistema (disparos, picados, OVNI,
// premios, búnkers) para que el orden en que juega cada uno no mezcle las
// secuencias: por ejemplo, el 7.º premio que cae es el mismo para todos.

// Hash de texto a 32 bits (xmur3)
function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// Generador mulberry32: rápido y suficiente para un juego
export function createRng(seed) {
  let a = hash32(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStreams(seed, names) {
  const streams = {};
  for (const name of names) streams[name] = createRng(`${seed}:${name}`);
  return streams;
}

export const randomSeed = () =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
