// Logros: se guardan en este dispositivo. El juego avisa eventos y este módulo
// decide qué se desbloquea. No toca el DOM ni el canvas (se testea con node --test).

export const BOSS_KINDS = ['mothership', 'magma', 'titan', 'vortex', 'phoenix'];

const BOSS_LABEL = {
  mothership: 'MOTHERSHIP', magma: 'MAGMA', titan: 'TITAN', vortex: 'VORTEX', phoenix: 'SOLAR PHOENIX',
};

// group ordena la pantalla de logros; target > 1 muestra barra de progreso
export const ACHIEVEMENTS = [
  { id: 'first_blood', group: 'combate', icon: '👾', name: 'PRIMER CONTACTO', desc: 'Destruí tu primer invasor' },
  { id: 'hunter', group: 'combate', icon: '🎯', name: 'CAZADOR', desc: 'Destruí 1.000 invasores en total', stat: 'kills', target: 1000 },
  { id: 'exterminator', group: 'combate', icon: '☄️', name: 'EXTERMINADOR', desc: 'Destruí 10.000 invasores en total', stat: 'kills', target: 10000 },
  { id: 'ufo', group: 'combate', icon: '🛸', name: 'AVISTAMIENTO', desc: 'Derribá un OVNI' },
  { id: 'combo10', group: 'combate', icon: '🔥', name: 'EN RACHA', desc: 'Hacé un combo de 10' },
  { id: 'combo25', group: 'combate', icon: '⚡', name: 'IMPARABLE', desc: 'Hacé un combo de 25' },
  { id: 'rocks', group: 'combate', icon: '🪨', name: 'PICAPIEDRA', desc: 'Rompé 100 rocas (asteroides y rocas del TITAN)', stat: 'rocks', target: 100 },
  { id: 'perfect', group: 'habilidad', icon: '🛡️', name: 'INTOCABLE', desc: 'Superá una oleada sin que te peguen' },
  { id: 'sniper', group: 'habilidad', icon: '🔭', name: 'FRANCOTIRADOR', desc: 'Terminá una partida con 80% de precisión (100 disparos o más)' },
  { id: 'loaded', group: 'habilidad', icon: '🧰', name: 'A FULL', desc: 'Juntá 8 mejoras en una misma partida' },
  { id: 'daily', group: 'habilidad', icon: '📅', name: 'MADRUGADOR', desc: 'Terminá un desafío diario' },
  { id: 'duelist', group: 'habilidad', icon: '⚔️', name: 'DUELISTA', desc: 'Ganá un versus 1 contra 1' },
  { id: 'wave10', group: 'progreso', icon: '🚀', name: 'SOBREVIVIENTE', desc: 'Llegá a la oleada 10' },
  { id: 'wave20', group: 'progreso', icon: '🌌', name: 'VETERANO', desc: 'Llegá a la oleada 20' },
  { id: 'wave30', group: 'progreso', icon: '🌠', name: 'LEYENDA', desc: 'Llegá a la oleada 30' },
  { id: 'score100k', group: 'progreso', icon: '💯', name: '100K', desc: 'Hacé 100.000 puntos en una partida' },
  { id: 'score500k', group: 'progreso', icon: '💎', name: 'MEDIO MILLÓN', desc: 'Hacé 500.000 puntos en una partida' },
  { id: 'score1m', group: 'progreso', icon: '👑', name: 'MILLONARIO', desc: 'Hacé 1.000.000 de puntos en una partida' },
  ...BOSS_KINDS.map((k) => ({
    id: 'boss_' + k, group: 'jefes', icon: '⭐', name: BOSS_LABEL[k], desc: `Derrotá a ${BOSS_LABEL[k]}`,
  })),
  { id: 'pantheon', group: 'jefes', icon: '🏆', name: 'PANTEÓN', desc: 'Derrotá a los 5 jefes', stat: 'bosses', target: 5 },
];

export const GROUPS = [
  { id: 'combate', label: 'COMBATE' },
  { id: 'habilidad', label: 'HABILIDAD' },
  { id: 'progreso', label: 'PROGRESO' },
  { id: 'jefes', label: 'JEFES' },
];

const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

const emptyData = () => ({ unlocked: {}, kills: 0, rocks: 0, bosses: [] });

/**
 * @param {{ load: () => any, save: (data: any) => void, onUnlock?: (a: any) => void, now?: () => string }} io
 */
export function createAchievements({ load, save, onUnlock = () => {}, now = () => new Date().toISOString() }) {
  const raw = load();
  const data = { ...emptyData(), ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!data.unlocked || typeof data.unlocked !== 'object') data.unlocked = {};
  if (!Array.isArray(data.bosses)) data.bosses = [];
  let dirty = false;
  let urgent = false; // hubo un desbloqueo: se guarda ya

  function unlock(id) {
    if (data.unlocked[id] || !BY_ID[id]) return;
    data.unlocked[id] = now();
    dirty = true;
    urgent = true;
    onUnlock(BY_ID[id]);
  }

  function flush() {
    if (dirty) { save(data); dirty = false; }
    urgent = false;
    pending = 0;
  }

  // Los contadores acumulados se guardan de a tandas (no en cada invasor)
  let pending = 0;
  function bump(stat, n = 1) {
    data[stat] = (data[stat] || 0) + n;
    for (const a of ACHIEVEMENTS) if (a.stat === stat && data[stat] >= a.target) unlock(a.id);
    dirty = true;
    pending++;
  }

  const handlers = {
    kill() { unlock('first_blood'); bump('kills'); },
    ufo() { unlock('ufo'); },
    rock() { bump('rocks'); },
    combo({ combo }) {
      if (combo >= 10) unlock('combo10');
      if (combo >= 25) unlock('combo25');
    },
    wave({ wave }) {
      if (wave >= 10) unlock('wave10');
      if (wave >= 20) unlock('wave20');
      if (wave >= 30) unlock('wave30');
    },
    waveClear({ perfect }) { if (perfect) unlock('perfect'); },
    score({ score }) {
      if (score >= 100000) unlock('score100k');
      if (score >= 500000) unlock('score500k');
      if (score >= 1000000) unlock('score1m');
    },
    upgrades({ total }) { if (total >= 8) unlock('loaded'); },
    boss({ kind }) {
      if (!BOSS_KINDS.includes(kind)) return;
      unlock('boss_' + kind);
      if (!data.bosses.includes(kind)) { data.bosses.push(kind); dirty = true; }
      if (data.bosses.length >= BOSS_KINDS.length) unlock('pantheon');
    },
    versusWin() { unlock('duelist'); },
    gameOver({ shots, hits, daily }) {
      if (shots >= 100 && hits / shots >= 0.8) unlock('sniper');
      if (daily) unlock('daily');
    },
  };

  return {
    event(type, payload = {}) {
      const fn = handlers[type];
      if (!fn) return;
      fn(payload);
      if (urgent || pending >= 25) flush();
    },
    flush,
    isUnlocked: (id) => Boolean(data.unlocked[id]),
    get count() { return Object.keys(data.unlocked).filter((id) => BY_ID[id]).length; },
    get total() { return ACHIEVEMENTS.length; },
    list() {
      return ACHIEVEMENTS.map((a) => {
        const value = a.stat === 'bosses' ? data.bosses.length : a.stat ? data[a.stat] || 0 : 0;
        return {
          ...a,
          unlocked: data.unlocked[a.id] || null,
          progress: a.target ? Math.min(value, a.target) : null,
        };
      });
    },
    reset() { Object.assign(data, emptyData()); dirty = true; flush(); },
  };
}
