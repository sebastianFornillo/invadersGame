// Dibujo de jefes, crías y rocas. Funciones puras: reciben el contexto del
// canvas y el estado a dibujar; no cambian nada del juego.
// Todos los diseños son originales.
const TAU = Math.PI * 2;

// ------------------------------------------------------------------
// Rocas (asteroides, escudo de TITÁN y rocas que lanza)
// ------------------------------------------------------------------
export function drawRock(ctx, x, y, r, verts, rot, flashOn = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  verts.forEach((k, i) => {
    const ang = (i / verts.length) * TAU;
    const px = Math.cos(ang) * r * k, py = Math.sin(ang) * r * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r * 1.1);
  g.addColorStop(0, flashOn ? '#ffffff' : '#a8896b');
  g.addColorStop(1, flashOn ? '#ffffff' : '#3b2a1f');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,180,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------
// MAGMA y magmitas: medusa de lava con campana, ojos y tentáculos
// ------------------------------------------------------------------
export function drawJelly(ctx, cx, cy, r, t, { alpha = 1, flashOn = false, tentacles = 7 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (let i = 0; i < tentacles; i++) {
    const fx = cx - r * 0.7 + (tentacles > 1 ? (i / (tentacles - 1)) * r * 1.4 : r * 0.7);
    const len = r * (0.9 + 0.25 * Math.sin(t * 2 + i));
    ctx.strokeStyle = flashOn ? '#ffffff' : i % 2 ? '#ff5a1f' : '#ff8c1a';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(fx, cy + r * 0.05);
    for (let k = 1; k <= 6; k++) {
      const f = k / 6;
      ctx.lineTo(fx + Math.sin(t * 3 + i * 0.9 + k * 0.7) * r * 0.14 * f, cy + f * len);
    }
    ctx.stroke();
  }
  const pulse = 1 + Math.sin(t * 2.4) * 0.04;
  const g = ctx.createRadialGradient(cx, cy - r * 0.4, r * 0.1, cx, cy - r * 0.1, r * 1.05);
  g.addColorStop(0, flashOn ? '#ffffff' : '#fff2a8');
  g.addColorStop(0.35, flashOn ? '#ffffff' : '#ffb020');
  g.addColorStop(0.75, '#ff5a1f');
  g.addColorStop(1, '#9e1b0c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * pulse, r * 0.78 * pulse, 0, Math.PI, TAU);
  const scallops = 7;
  for (let i = 0; i <= scallops; i++) {
    ctx.lineTo(cx + r * pulse - (i / scallops) * 2 * r * pulse, cy + (i % 2 ? r * 0.12 : 0));
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a0500';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * r * 0.28, cy - r * 0.3, r * 0.11, r * 0.16, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#fff3c4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * r * 0.26, cy - r * 0.35, r * 0.04, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------
// TITÁN: núcleo de roca con ojo de cristal y rocas que orbitan
// ------------------------------------------------------------------
export const TITAN_ORBIT = 100;
export const rockPos = (b, rock) => ({
  x: b.x + Math.cos(rock.ang) * TITAN_ORBIT,
  y: b.y + Math.sin(rock.ang) * TITAN_ORBIT * 0.55,
});
const TITAN_BODY = [1, 0.86, 1.04, 0.9, 1.08, 0.88, 1, 0.92, 1.06, 0.9, 1.02, 0.87];

export function drawTitan(ctx, b, t, enraged) {
  const back = [], front = [];
  for (const rock of b.rocks) (Math.sin(rock.ang) < 0 ? back : front).push(rock);
  const drawOrbit = (list) => {
    for (const rock of list) {
      const p = rockPos(b, rock);
      drawRock(ctx, p.x, p.y, rock.r, rock.verts, rock.rot, rock.flash > 0);
    }
  };
  drawOrbit(back);

  ctx.save();
  ctx.translate(b.x, b.y);
  // Cuerpo de roca
  ctx.beginPath();
  TITAN_BODY.forEach((k, i) => {
    const ang = (i / TITAN_BODY.length) * TAU + 0.2;
    const px = Math.cos(ang) * 48 * k, py = Math.sin(ang) * 44 * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  const g = ctx.createRadialGradient(-14, -16, 4, 0, 0, 56);
  g.addColorStop(0, b.flash > 0 ? '#ffffff' : '#8c7461');
  g.addColorStop(1, b.flash > 0 ? '#ffffff' : '#2a1d15');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,220,180,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Grietas que brillan (naranja cuando se enoja)
  const crack = enraged ? '255,140,40' : '93,193,185';
  ctx.strokeStyle = `rgba(${crack},${0.45 + 0.25 * Math.sin(t * 4)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-30, -18); ctx.lineTo(-16, -6); ctx.lineTo(-22, 10);
  ctx.moveTo(26, -22); ctx.lineTo(14, -8); ctx.lineTo(24, 14);
  ctx.moveTo(-6, 26); ctx.lineTo(0, 18); ctx.lineTo(8, 30);
  ctx.stroke();
  // Ojo de cristal
  const pulse = 1 + Math.sin(t * 3) * 0.08;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
  glow.addColorStop(0, `rgba(${crack},0.8)`);
  glow.addColorStop(1, `rgba(${crack},0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = enraged ? '#ffcf7a' : '#bffff4';
  ctx.beginPath();
  ctx.moveTo(0, -16 * pulse); ctx.lineTo(12 * pulse, 0); ctx.lineTo(0, 16 * pulse); ctx.lineTo(-12 * pulse, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1b0f0a';
  ctx.fillRect(-2, -9 * pulse, 4, 18 * pulse);
  ctx.restore();

  drawOrbit(front);
}

// ------------------------------------------------------------------
// VÓRTICE: singularidad con brazos en espiral
// ------------------------------------------------------------------
export const VORTEX_PULL_RADIUS = 190;

export function drawVortex(ctx, b, t) {
  const { x, y } = b;
  const absorbing = b.absorbing > 0;
  ctx.save();
  if (absorbing) {
    // Zona de succión: anillo que se cierra
    ctx.strokeStyle = 'rgba(155,123,255,0.35)';
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -t * 60;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, VORTEX_PULL_RADIUS * (0.9 + 0.1 * Math.sin(t * 6)), 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalCompositeOperation = 'lighter';
  const arms = ['rgba(155,123,255,0.6)', 'rgba(255,79,216,0.45)', 'rgba(93,193,185,0.4)'];
  arms.forEach((color, arm) => {
    ctx.strokeStyle = b.flash > 0 ? '#ffffff' : color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      const ang = t * 2 + arm * (TAU / 3) + f * 4.2;
      const rad = 38 + f * 72;
      const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad * 0.75;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  });
  ctx.restore();
  // Núcleo oscuro con borde brillante (blanco cuando está cargado)
  const rim = absorbing ? `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 10)})` : 'rgba(155,123,255,0.9)';
  const g = ctx.createRadialGradient(x, y, 8, x, y, 48);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.72, '#06010f');
  g.addColorStop(0.9, rim);
  g.addColorStop(1, 'rgba(155,123,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, 48, 0, TAU); ctx.fill();
}

// ------------------------------------------------------------------
// FÉNIX SOLAR: pájaro de fuego que pica hacia la nave y revive una vez
// ------------------------------------------------------------------
export function drawPhoenix(ctx, b, t) {
  if (b.mode === 'telegraph' && b.target && Math.floor(t * 12) % 2 === 0) {
    // Mira donde va a caer en picada
    ctx.save();
    ctx.strokeStyle = 'rgba(255,176,32,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.target.x, b.target.y, 26, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.target.x - 36, b.target.y); ctx.lineTo(b.target.x + 36, b.target.y);
    ctx.moveTo(b.target.x, b.target.y - 36); ctx.lineTo(b.target.x, b.target.y + 36);
    ctx.stroke();
    ctx.restore();
  }

  if (b.mode === 'egg') {
    // Renace: brasa que late
    const pulse = 1 + Math.sin(t * 8) * 0.12;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, 70 * pulse);
    halo.addColorStop(0, 'rgba(255,230,140,0.9)');
    halo.addColorStop(0.5, 'rgba(255,120,20,0.45)');
    halo.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(b.x, b.y, 70 * pulse, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffb020';
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 22 * pulse, 28 * pulse, 0, 0, TAU); ctx.fill();
    return;
  }

  ctx.save();
  ctx.translate(b.x, b.y);
  const flap = Math.sin(t * 7) * 0.35;
  const flame = (x0, y0, x1, y1, r) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, b.flash > 0 ? '#ffffff' : '#fff2a8');
    g.addColorStop(0.45, '#ffb020');
    g.addColorStop(1, r);
    return g;
  };
  // Cola: tres llamas hacia arriba
  for (const i of [-1, 0, 1]) {
    ctx.fillStyle = flame(0, -10, 0, -90, 'rgba(255,59,31,0)');
    ctx.beginPath();
    ctx.moveTo(i * 8 - 7, -14);
    ctx.quadraticCurveTo(i * 26 + Math.sin(t * 5 + i) * 10, -60, i * 20 + Math.sin(t * 6 + i) * 8, -92);
    ctx.quadraticCurveTo(i * 14, -50, i * 8 + 7, -14);
    ctx.closePath();
    ctx.fill();
  }
  // Alas: tres plumas por lado, aleteando
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(-flap);
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = flame(10, 0, 96, -30, layer === 0 ? '#c2240f' : '#ff3b1f');
      ctx.beginPath();
      ctx.moveTo(10, -8 + layer * 6);
      ctx.quadraticCurveTo(60 - layer * 8, -52 + layer * 18, 98 - layer * 16, -34 + layer * 22);
      ctx.quadraticCurveTo(58 - layer * 8, -6 + layer * 14, 14, 10 + layer * 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // Cuerpo y cabeza (mira hacia abajo, hacia la nave)
  ctx.fillStyle = flame(0, -30, 0, 40, '#c2240f');
  ctx.beginPath(); ctx.ellipse(0, 0, 18, 30, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 30, 14, 0, TAU); ctx.fill();
  // Pico
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath(); ctx.moveTo(-5, 40); ctx.lineTo(5, 40); ctx.lineTo(0, 52); ctx.closePath(); ctx.fill();
  // Ojos
  ctx.fillStyle = '#2a0500';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(side * 6, 30, 3, 4, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#fff3c4';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(side * 6, 29, 1.2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
