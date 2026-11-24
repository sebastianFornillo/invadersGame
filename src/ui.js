// Pantallas HTML sobre el canvas: guardar puntaje, ranking y ligas.
// Todo el texto que viene del servidor se inserta con textContent (sin HTML).
import {
  api, online, league, playerName, inviteLink, cleanName,
  NAME_RE, LEAGUE_NAME_RE, LEAGUE_CODE_RE,
} from './online.js';
import { formatDay, gridText, shareText, dailyLink } from './daily.js';
import { settings } from './settings.js';
import { canVibrate } from './platform.js';

const fmt = (n) => Number(n).toLocaleString('es-AR');

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------------------------------------------------------------------
// Contenedor modal
// ---------------------------------------------------------------------
const root = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', hidden: true });
const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
document.body.append(root, toastEl);

let onCloseCb = null;
let lastFocus = null;

function open(content, { onClose, locked = false } = {}) {
  if (root.hidden) lastFocus = document.activeElement;
  root.replaceChildren(content);
  root.hidden = false;
  root.dataset.locked = locked ? '1' : '';
  onCloseCb = onClose || null;
  // En celular no se enfoca un campo de texto solo: abriría el teclado y taparía todo
  let target = content.querySelector('[data-autofocus]');
  if (target && target.tagName === 'INPUT' && coarsePointer()) target = null;
  (target || content).focus({ preventScroll: true });
}

const coarsePointer = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

function close() {
  if (root.hidden) return;
  root.hidden = true;
  root.dataset.locked = '';
  root.replaceChildren();
  const cb = onCloseCb;
  onCloseCb = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  if (cb) cb();
}

const isLocked = () => root.dataset.locked === '1';

root.addEventListener('pointerdown', (e) => {
  if (e.target === root && !isLocked()) close();
});
document.addEventListener('keydown', (e) => {
  if (root.hidden) return;
  if (e.key === 'Escape' && !isLocked()) {
    e.preventDefault();
    close();
  }
  // Las teclas no llegan al juego mientras hay una pantalla abierta
  e.stopPropagation();
});

let toastTimer = 0;
function toast(msg, ms = 2800) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

function panel(title, ...content) {
  return h(
    'section',
    { class: 'panel', tabindex: '-1', 'aria-label': title },
    h('header', {}, h('h2', { text: title }), h('button', { class: 'x', 'aria-label': 'Cerrar', onclick: close, text: '×' })),
    ...content,
  );
}

const friendly = (e) => (e && e.message) || 'Algo salió mal, probá de nuevo';

// ---------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------
const SCOPES = [
  { id: 'global', label: 'MUNDIAL' },
  { id: 'week', label: 'SEMANA' },
  { id: 'daily', label: 'HOY' },
  { id: 'league', label: 'LIGA', needsLeague: true },
];

export function addScope(scope, index = SCOPES.length) {
  if (!SCOPES.some((s) => s.id === scope.id)) SCOPES.splice(index, 0, scope);
}

function openRanking({ scope = 'global', onClose } = {}) {
  const lg = league.get();
  const scopes = SCOPES.filter((s) => !s.needsLeague || lg);
  const initial = scopes.some((s) => s.id === scope) ? scope : 'global';
  const list = h('ol', { class: 'board' });
  const status = h('p', { class: 'muted', role: 'status' });
  let token = 0;

  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    scopes.map((s) =>
      h('button', {
        role: 'tab',
        'data-scope': s.id,
        onclick: () => load(s.id),
        text: s.id === 'league' && lg ? lg.name.toUpperCase() : s.label,
      }),
    ),
  );

  async function load(id) {
    const my = ++token;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.scope === id));
    list.replaceChildren();
    status.textContent = 'Cargando…';
    try {
      const rows = await api.leaderboard(id, lg && lg.code);
      if (my !== token || root.hidden) return;
      status.textContent = rows.length ? '' : 'Todavía no hay puntajes. ¡Sé el primero!';
      let prev = 0;
      for (const r of rows) {
        if (r.pos > prev + 1) list.append(h('li', { class: 'gap', 'aria-hidden': 'true', text: '· · ·' }));
        list.append(
          h(
            'li',
            { class: r.is_me ? 'me' : null },
            h('span', { class: 'pos', text: `#${r.pos}` }),
            h('span', { class: 'name', text: r.player }),
            h('span', { class: 'wave', text: `W${r.wave}` }),
            h('span', { class: 'pts', text: fmt(r.score) }),
          ),
        );
        prev = r.pos;
      }
    } catch (e) {
      if (my === token) status.textContent = `No se pudo cargar el ranking. ${friendly(e)}`;
    }
  }

  open(
    panel(
      'RANKING',
      tabs,
      status,
      list,
      h(
        'footer',
        {},
        h('button', { class: 'btn ghost', onclick: () => openLeagues({ onClose }), text: lg ? 'MI LIGA' : 'LIGAS PRIVADAS' }),
      ),
    ),
    { onClose },
  );
  load(initial);
}

// ---------------------------------------------------------------------
// Guardar puntaje al terminar la partida
// ---------------------------------------------------------------------
function openSubmit({
  score, wave, title = 'GUARDAR PUNTAJE', submit, scope = 'global', onPlayAgain, extraActions = [], onClose,
}) {
  const lg = league.get();
  const input = h('input', {
    id: 'playerName',
    name: 'nickname',
    maxlength: '12',
    autocomplete: 'nickname',
    enterkeyhint: 'send',
    spellcheck: 'false',
    placeholder: 'TU NOMBRE',
    'aria-label': 'Tu nombre para el ranking',
    value: playerName.get(),
    'data-autofocus': true,
  });
  const err = h('p', { class: 'error', role: 'alert' });
  const send = h('button', { class: 'btn', type: 'submit', text: 'GUARDAR' });

  const form = h(
    'form',
    {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        const name = cleanName(input.value);
        if (!NAME_RE.test(name)) {
          err.textContent = 'Usá de 2 a 12 letras, números o espacios.';
          input.focus();
          return;
        }
        send.disabled = true;
        send.textContent = 'GUARDANDO…';
        err.textContent = '';
        try {
          const res = await submit(name);
          playerName.set(name);
          showResult(res);
        } catch (ex) {
          err.textContent = friendly(ex);
          send.disabled = false;
          send.textContent = 'REINTENTAR';
        }
      },
    },
    input,
    send,
  );

  function showResult(res) {
    const lines = [
      h('p', { class: 'big', text: `#${res.world_rank}` }),
      h('p', { class: 'muted', text: `de ${fmt(res.players)} ${scope === 'daily' ? 'en el desafío de hoy' : 'jugadores en el mundo'}` }),
    ];
    if (res.league_rank && lg) lines.push(h('p', { class: 'accent', text: `#${res.league_rank} en la liga ${lg.name}` }));
    if (res.personal_best) lines.push(h('p', { class: 'gold', text: '¡RÉCORD PERSONAL!' }));
    open(
      panel(
        'PUNTAJE GUARDADO',
        ...lines,
        h(
          'footer',
          {},
          ...extraActions.map((a) => h('button', { class: 'btn ghost', onclick: a.onClick, text: a.label })),
          h('button', { class: 'btn ghost', onclick: () => openRanking({ scope, onClose }), text: 'VER RANKING' }),
          onPlayAgain &&
            h('button', {
              class: 'btn',
              'data-autofocus': true,
              onclick: () => {
                onCloseCb = null;
                close();
                onPlayAgain();
              },
              text: 'JUGAR DE NUEVO',
            }),
        ),
      ),
      { onClose },
    );
  }

  open(
    panel(
      title,
      h('p', { class: 'big', text: `${fmt(score)} PTS` }),
      h('p', { class: 'muted', text: `Oleada ${wave}${lg ? ` · Liga ${lg.name}` : ''}` }),
      form,
      err,
      h('footer', {}, h('button', { class: 'btn ghost', onclick: close, text: 'AHORA NO' })),
    ),
    { onClose },
  );
}

// ---------------------------------------------------------------------
// Ligas privadas
// ---------------------------------------------------------------------
async function shareInvite(lg) {
  const link = inviteLink(lg.code);
  const text = `¡Te desafío en Invaders Space! Sumate a mi liga "${lg.name}" 👾`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Invaders Space', text, url: link });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    toast('Invitación copiada: pegala en WhatsApp');
  } catch {
    toast(link, 8000);
  }
}

function openLeagues({ onClose } = {}) {
  const lg = league.get();
  if (lg) {
    open(
      panel(
        'TU LIGA',
        h('p', { class: 'big', text: lg.name }),
        h('p', { class: 'muted', text: 'Código para unirse' }),
        h('p', { class: 'code', text: lg.code }),
        h('p', { class: 'muted', text: 'Tus partidas suman en esta liga y en el ranking mundial.' }),
        h(
          'footer',
          {},
          h('button', { class: 'btn', 'data-autofocus': true, onclick: () => shareInvite(lg), text: 'INVITAR AMIGOS' }),
          h('button', { class: 'btn ghost', onclick: () => openRanking({ scope: 'league', onClose }), text: 'RANKING DE LA LIGA' }),
          h(
            'button',
            {
              class: 'btn ghost danger',
              onclick: () => {
                league.clear();
                toast(`Saliste de la liga ${lg.name}`);
                openLeagues({ onClose });
              },
              text: 'SALIR',
            },
          ),
        ),
      ),
      { onClose },
    );
    return;
  }

  const nameIn = h('input', { maxlength: '24', placeholder: 'NOMBRE DE LA LIGA', 'aria-label': 'Nombre de la liga nueva' });
  const codeIn = h('input', {
    maxlength: '6',
    placeholder: 'CÓDIGO',
    autocapitalize: 'characters',
    spellcheck: 'false',
    'aria-label': 'Código de una liga existente',
  });
  const err = h('p', { class: 'error', role: 'alert' });

  const createForm = h(
    'form',
    {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        const name = cleanName(nameIn.value);
        if (!LEAGUE_NAME_RE.test(name)) {
          err.textContent = 'El nombre de la liga va de 3 a 24 caracteres.';
          nameIn.focus();
          return;
        }
        err.textContent = '';
        try {
          const created = await api.createLeague(name);
          league.set(created);
          toast(`Liga creada: ${created.name}`);
          openLeagues({ onClose });
        } catch (ex) {
          err.textContent = friendly(ex);
        }
      },
    },
    nameIn,
    h('button', { class: 'btn', type: 'submit', text: 'CREAR' }),
  );

  const joinForm = h(
    'form',
    {
      class: 'row',
      onsubmit: async (e) => {
        e.preventDefault();
        const code = codeIn.value.trim().toUpperCase();
        if (!LEAGUE_CODE_RE.test(code)) {
          err.textContent = 'El código tiene 6 letras o números.';
          codeIn.focus();
          return;
        }
        err.textContent = '';
        try {
          const found = await api.getLeague(code);
          if (!found) {
            err.textContent = 'No existe una liga con ese código.';
            return;
          }
          league.set(found);
          toast(`Te uniste a la liga ${found.name}`);
          openLeagues({ onClose });
        } catch (ex) {
          err.textContent = friendly(ex);
        }
      },
    },
    codeIn,
    h('button', { class: 'btn', type: 'submit', text: 'UNIRME' }),
  );

  open(
    panel(
      'LIGAS PRIVADAS',
      h('p', { class: 'muted', text: 'Competí sólo con tus amigos: creá una liga y pasales el link.' }),
      createForm,
      h('p', { class: 'muted small', text: '¿Te pasaron un código?' }),
      joinForm,
      err,
    ),
    { onClose },
  );
}

// ---------------------------------------------------------------------
// Desafío diario
// ---------------------------------------------------------------------
async function shareDaily(result) {
  const text = shareText({ ...result, url: dailyLink() });
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Resultado copiado: pegalo en WhatsApp');
  } catch {
    toast(text.replace(/\n/g, ' · '), 9000);
  }
}

// Hora local en la que cambia el desafío (00:00 UTC)
function nextChangeTime() {
  const n = new Date();
  const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1));
  return next.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function openDaily({ day, record, onPlay, onPractice, onClose }) {
  const rankingBtn =
    online.enabled && h('button', { class: 'btn ghost', onclick: () => openRanking({ scope: 'daily', onClose }), text: 'RANKING DE HOY' });
  const practiceBtn = h('button', { class: 'btn ghost', onclick: () => { onCloseCb = null; close(); onPractice(); }, text: 'PRÁCTICA' });

  if (!record) {
    open(
      panel(
        'DESAFÍO DIARIO',
        h('p', { class: 'big', text: formatDay(day) }),
        h('p', { class: 'muted', text: 'Las mismas oleadas para todos. Tenés un solo intento oficial por día.' }),
        h('p', { class: 'muted small', text: `El desafío cambia todos los días a las ${nextChangeTime()}.` }),
        h(
          'footer',
          {},
          h('button', { class: 'btn', 'data-autofocus': true, onclick: () => { onCloseCb = null; close(); onPlay(); }, text: 'JUGAR' }),
          rankingBtn,
        ),
      ),
      { onClose },
    );
    return;
  }

  if (record.status !== 'done') {
    open(
      panel(
        'DESAFÍO DIARIO',
        h('p', { class: 'big', text: formatDay(day) }),
        h('p', { class: 'muted', text: 'Ya usaste el intento de hoy: la partida quedó sin terminar.' }),
        h('p', { class: 'muted small', text: `Volvé a las ${nextChangeTime()} para el próximo desafío.` }),
        h('footer', {}, practiceBtn, rankingBtn),
      ),
      { onClose },
    );
    return;
  }

  const result = { day, score: record.score, wave: record.wave, grid: record.grid || [] };
  open(
    panel(
      `DESAFÍO ${formatDay(day)}`,
      h('p', { class: 'big', text: `${fmt(record.score)} PTS` }),
      h('p', { class: 'muted', text: `Oleada ${record.wave}${record.rank ? ` · #${record.rank} de ${fmt(record.players)}` : ''}` }),
      h('p', { class: 'grid', text: gridText(result.grid) }),
      h('p', { class: 'muted small', text: `Próximo desafío a las ${nextChangeTime()}.` }),
      h(
        'footer',
        {},
        h('button', { class: 'btn', 'data-autofocus': true, onclick: () => shareDaily(result), text: 'COMPARTIR' }),
        rankingBtn,
        practiceBtn,
      ),
    ),
    { onClose },
  );
}

// ---------------------------------------------------------------------
// Elegir una mejora entre oleadas (no se puede cerrar sin elegir)
// ---------------------------------------------------------------------
const PICK_DELAY_MS = 650; // evita elegir sin querer si se venía apretando Espacio

function openUpgrade({ wave, options, levels, onPick }) {
  let picked = false;
  const cards = options.map((u, i) =>
    h(
      'button',
      {
        class: 'card',
        disabled: true,
        onclick: () => {
          if (picked) return;
          picked = true;
          onCloseCb = null;
          close();
          onPick(u.id);
        },
      },
      h('span', { class: 'key', 'aria-hidden': 'true', text: String(i + 1) }),
      h('span', { class: 'icon', 'aria-hidden': 'true', text: u.icon }),
      h('b', { text: u.name }),
      h('small', { text: u.desc }),
      Number.isFinite(u.max) && u.max > 1 && h('span', { class: 'lvl', text: `NIVEL ${levels[u.id] + 1} DE ${u.max}` }),
    ),
  );
  const section = h(
    'section',
    { class: 'panel wide', tabindex: '-1', 'aria-label': 'Elegí una mejora' },
    h('header', { class: 'center' }, h('h2', { text: `OLEADA ${wave} SUPERADA` })),
    h('p', { class: 'muted', text: 'Elegí una mejora para el resto de la partida' }),
    h('div', { class: 'cards' }, cards),
  );
  section.addEventListener('keydown', (e) => {
    if (cards[0].disabled || e.repeat) return;
    const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    const np = ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
    const i = Math.max(n, np);
    if (i >= 0 && cards[i]) {
      e.preventDefault();
      cards[i].click();
      return;
    }
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step) {
      e.preventDefault();
      const at = cards.indexOf(document.activeElement);
      cards[(Math.max(at, 0) + step + cards.length) % cards.length].focus();
    }
  });
  open(section, { locked: true });
  setTimeout(() => {
    if (picked || !section.isConnected) return;
    cards.forEach((c) => (c.disabled = false));
    if (!coarsePointer()) cards[0].focus({ preventScroll: true });
  }, PICK_DELAY_MS);
}

// Navegación con mando en cualquier pantalla abierta
function gamepad({ prev, next, accept, back }) {
  if (root.hidden) return;
  const items = [...root.querySelectorAll('button:not([disabled]), input')].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  if (prev || next) items[(Math.max(at, 0) + (next ? 1 : -1) + items.length) % items.length].focus();
  else if (accept && at >= 0 && items[at].tagName === 'BUTTON') items[at].click();
  else if (accept && at < 0) items[0].focus();
  if (back && !isLocked()) close();
}

// ---------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------
function openOptions({ onClose } = {}) {
  const s = settings.all();
  const vol = h('input', {
    type: 'range', id: 'optVolume', min: '0', max: '100', step: '10', value: String(s.volume), 'aria-label': 'Volumen',
  });
  const volOut = h('output', { for: 'optVolume', text: `${s.volume}%` });
  vol.addEventListener('input', () => {
    settings.set('volume', Number(vol.value));
    volOut.textContent = `${vol.value}%`;
  });

  const toggle = (key, label, hint) => {
    const id = `opt-${key}`;
    const cb = h('input', { type: 'checkbox', id, role: 'switch' });
    cb.checked = Boolean(s[key]);
    cb.addEventListener('change', () => settings.set(key, cb.checked));
    return h('label', { class: 'opt', for: id }, h('span', {}, h('b', { text: label }), hint && h('small', { text: hint })), cb);
  };

  const pnl = panel(
      'OPCIONES',
      h(
        'div',
        { class: 'opts' },
        h('label', { class: 'opt', for: 'optVolume' }, h('span', {}, h('b', { text: 'VOLUMEN' })), h('span', { class: 'range' }, vol, volOut)),
        toggle('shake', 'TEMBLOR DE PANTALLA'),
        toggle('flashes', 'DESTELLOS', 'Apagalos si te molestan las luces que parpadean'),
        toggle('crt', 'EFECTO TV RETRO'),
        canVibrate() && toggle('vibration', 'VIBRACIÓN'),
        toggle('bigTouch', 'BOTONES TÁCTILES GRANDES'),
        toggle('leftHanded', 'MODO ZURDO', 'FIRE a la izquierda, flechas a la derecha'),
      ),
      h(
        'footer',
        {},
        h('button', { class: 'btn ghost', onclick: () => { settings.reset(); openOptions({ onClose }); }, text: 'RESTABLECER' }),
        h('button', { class: 'btn', onclick: close, text: 'LISTO' }),
      ),
  );
  pnl.classList.add('options');
  open(pnl, { onClose });
}

// ---------------------------------------------------------------------
// Link de invitación: ?liga=CODIGO
// ---------------------------------------------------------------------
async function handleInvite() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('liga') || '').trim().toUpperCase();
  if (!code) return;
  params.delete('liga');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (!online.enabled || !LEAGUE_CODE_RE.test(code)) return;
  try {
    const found = await api.getLeague(code);
    if (!found) {
      toast('Ese link de liga no es válido');
      return;
    }
    const before = league.get();
    league.set(found);
    if (!before || before.code !== found.code) toast(`Te uniste a la liga ${found.name} 🏆`, 4000);
  } catch {
    toast('No se pudo unir a la liga: sin conexión');
  }
}

export const ui = {
  isOpen: () => !root.hidden,
  close,
  toast,
  openRanking,
  openSubmit,
  openLeagues,
  openDaily,
  shareDaily,
  openOptions,
  openUpgrade,
  gamepad,
  handleInvite,
};
