/*
 * museum/museum.js  --  the world: halls, the visitor, controls, exhibits on the
 * walls, the tier scheduler and the Focus view.  (BIBLE chapter 6.)
 *
 * The building is ASCII art (see MAP).  Letters are exhibit frames; EXHIBITS
 * says which work hangs at which letter.  To hang a new work: add a letter to
 * the map and one line to EXHIBITS.  Nothing else.  A letter standing alone on
 * the floor is a pillar; a music exhibit on a pillar shows one channel per face.
 */

import { W, H, parseMap, Raycaster } from './raycaster.js';
import { MusicSlot } from './music-slot.js';
import { TrackerView } from '../shared/web/tracker-view.js';

// ------------------------------------------------------------------ the building

const MAP = [
  '####################',
  '#........#....A....#',
  '#........#.........#',
  '#..S.....#.........#',
  '#....M.............#',
  '#........#.........#',
  '#........#.........#',
  '#........#.........#',
  '##########B#########',
];
const HALLS = [                                  // name by region (cells)
  { name: 'Lobby', x0: 0, x1: 9, intro: 'The pillar plays Space Debris: walk around it, one channel per side.' },
  { name: 'The 256-byte Hall', x0: 9, x1: 20, intro: 'Every program in this hall is smaller than this sentence.' },
];
const EXHIBITS = {
  A: { id: 'tube',   module: '../exhibits/tube/web/tube.js',     title: 'tube',   by: 'baze / 3SC', year: 2001, extra: 'Syndeecate 2001 · 256 bytes · MS-DOS' },
  B: { id: 'plasma', module: '../exhibits/plasma/web/plasma.js', title: 'plasma', by: 'Demoscene Museum sample', year: 2026, extra: 'not a historical work · the classic effect' },
  M: { id: 'space-debris', music: true, data: '../exhibits/space-debris/original/space_debris.mod',
       title: 'Space Debris', by: 'Captain (Markus Kaarlonen)', year: 1991, extra: 'ProTracker MOD · 4 channels · Amiga',
       link: 'https://markuskaarlonen.com/space-debris' },
};

// ------------------------------------------------------------------ tiers (BIBLE 3.5)

const TIERS = {
  near:   { quality: 1, fps: 30, maxDist: 6 },
  mid:    { quality: 4, fps: 10, maxDist: 12 },
  poster: { quality: 4, fps: 0 },                // frozen last frame
};
const MOVE_SPEED = 2.2, TURN_SPEED = 1.9, RADIUS = 0.25, APPROACH = 2.6;

/** One hung graphics work: the module plus its scheduling state. */
class Slot {
  constructor(letter, cell, info) {
    Object.assign(this, { letter, cell, info, module: null, quality: 0, fps: 0, lastRender: -1, initTime: 0, seen: false });
    this.key = cell.x + ',' + cell.y;
    this.lut = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    this.pixels = new Uint8Array(1); this.width = 1; this.height = 1;
  }

  async load() {
    this.module = (await import(this.info.module)).default;
    this.setQuality(TIERS.poster.quality);
    this.renderNow(0);                                          // so the far wall is not black
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.module.init({ quality: q });
    this.initTime = performance.now() / 1000;
    this.width = this.module.width; this.height = this.module.height; this.pixels = this.module.pixels;
    this.buildLut();
  }

  buildLut() {                                                  // palette -> 4 fog levels of ABGR
    const p = this.module.palette;
    for (let l = 0; l < 4; l++) {
      const f = 1 - l * 0.15;
      for (let i = 0; i < 256; i++)
        this.lut[l][i] = (255 << 24) | (((p[i * 3 + 2] * f) | 0) << 16) | (((p[i * 3 + 1] * f) | 0) << 8) | ((p[i * 3] * f) | 0);
    }
  }

  renderNow(now) {
    this.module.renderFrame(now - this.initTime);
    if (this.module.paletteChanged) this.buildLut();
    this.pixels = this.module.pixels;
    this.lastRender = now;
  }

  tick(now) {                                                   // honour the tier's frame cap
    if (this.fps > 0 && now - this.lastRender >= 1 / this.fps) this.renderNow(now);
  }
}

/** Assign tiers: nearest seen exhibit = near, second = mid, rest = poster. */
export function schedule(slots, player) {
  const ranked = slots.filter(s => s.module && s.seen)
    .map(s => ({ s, d: Math.hypot(s.cell.x + 0.5 - player.x, s.cell.y + 0.5 - player.y) }))
    .sort((a, b) => a.d - b.d);
  const tierOf = new Map();
  if (ranked[0] && ranked[0].d < TIERS.near.maxDist) tierOf.set(ranked[0].s, TIERS.near);
  if (ranked[1] && ranked[1].d < TIERS.mid.maxDist) tierOf.set(ranked[1].s, TIERS.mid);
  for (const s of slots) {
    const t = tierOf.get(s) || TIERS.poster;
    if (s.module) s.setQuality(t.quality);
    s.fps = t.fps;
    s.seen = false;                                             // the next render() sets it again
  }
}

/** Move with sliding collision: try x and y separately. */
export function move(player, map, dx, dy) {
  const free = (x, y) => !map.isSolid(Math.floor(x - RADIUS), Math.floor(y - RADIUS)) && !map.isSolid(Math.floor(x + RADIUS), Math.floor(y - RADIUS))
                      && !map.isSolid(Math.floor(x - RADIUS), Math.floor(y + RADIUS)) && !map.isSolid(Math.floor(x + RADIUS), Math.floor(y + RADIUS));
  if (free(player.x + dx, player.y)) player.x += dx;
  if (free(player.x, player.y + dy)) player.y += dy;
}

// ------------------------------------------------------------------ boot (browser only)

if (typeof document !== 'undefined') boot();

function boot() {
  const map = parseMap(MAP);
  const caster = new Raycaster(map);
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(W, H);
  const frame32 = new Uint32Array(imageData.data.buffer);
  const el = id => document.getElementById(id);
  const player = { x: map.start.x, y: map.start.y, dirX: 1, dirY: 0 };
  const placed = [...map.letters].filter(([L]) => EXHIBITS[L]);
  const slots = placed.filter(([L]) => !EXHIBITS[L].music).map(([L, cell]) => new Slot(L, cell, EXHIBITS[L]));
  const music = placed.filter(([L]) => EXHIBITS[L].music).map(([L, cell]) => new MusicSlot(L, cell, EXHIBITS[L]));
  const byCell = new Map([...slots, ...music].map(s => [s.key, s]));
  slots.forEach(s => s.load().catch(e => console.error('exhibit ' + s.info.id + ' failed to load', e)));
  music.forEach(m => m.load());

  // ---- sound may only start after a user gesture: the first click, tap or key does it
  let soundStarted = false;
  function startSound() { if (soundStarted) return; soundStarted = true; music.forEach(m => m.start()); }

  // ---- input
  const keys = new Set();
  const isTouch = matchMedia('(pointer: coarse)').matches;
  let look = 0, walk = 0, strafe = 0, focus = null;
  addEventListener('keydown', e => { startSound(); keys.add(e.key.toLowerCase()); if (e.key === 'Escape') exitFocus(); if ((e.key === 'e' || e.key === 'Enter') && !focus) tryFocus(); });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  let drag = null;
  canvas.addEventListener('pointerdown', e => { startSound(); drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), left: e.clientX < innerWidth / 2 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (isTouch && drag.left) { walk = -(e.clientY - drag.sy) / 80; strafe = (e.clientX - drag.sx) / 80; }   // left thumb: joystick
    else { look += (e.clientX - drag.x) * 0.004; }                                                           // right thumb / mouse: look
    drag.x = e.clientX; drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8 && performance.now() - drag.t < 300) tryFocus();   // a tap
    drag = null; walk = strafe = 0;
  });

  // ---- hints
  const hint = el('hint');
  let hintTimer = 0;
  function showHint(text, seconds = 4) { hint.textContent = text; hint.style.opacity = 1; hintTimer = seconds; }
  showHint((isTouch ? 'Left thumb walks, right thumb looks. Tap a picture to view it. ' : 'Drag to look. WASD or arrows to walk. E to view a picture. ') + 'Tap or press any key to enter with sound.', 8);
  let lastHall = null;

  // ---- focus view (BIBLE 6.7, reduced)
  const focusCanvas = el('focusCanvas'), fctx = focusCanvas.getContext('2d');
  let focusImage, focus32, focusLut = new Uint32Array(256), trackerView = null;
  function tryFocus() {
    const hit = caster.centerHit;
    if (!hit || !hit.exhibit || hit.dist > APPROACH) return;
    if (!hit.exhibit.module && !hit.exhibit.isMusic) return;
    enterFocus(hit.exhibit);
  }
  function enterFocus(slot) {
    focus = slot;
    const params = el('focusParams'); params.innerHTML = '';
    el('focusTitle').textContent = slot.info.title;
    el('focusMeta').textContent = `${slot.info.by} · ${slot.info.year} · ${slot.info.extra}`;
    if (slot.isMusic) {                                         // the tracker view, full size
      focusCanvas.width = 640; focusCanvas.height = 400; focusCanvas.style.aspectRatio = '16 / 10';
      trackerView = slot.song ? new TrackerView(focusCanvas, { song: slot.song }) : null;
      slot.focused = true; if (slot.audio) slot.audio.setVolume(0.6);
      el('focusLinks').innerHTML = `<a href="${slot.info.link}" target="_blank">The composer's page</a>` +
        `<a href="../shared/web/examples/mod.html" target="_blank">Standalone player</a>` +
        `<a href="../bible/05c-mod-replayer.md" target="_blank">How a MOD player works</a>`;
      const speed = document.createElement('label'), input = document.createElement('input'), out = document.createElement('span');
      Object.assign(input, { type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 });
      out.textContent = 'Speed: 1.00';
      input.oninput = () => { if (slot.audio) slot.audio.setParam('TEMPO_FACTOR', Number(input.value)); out.textContent = 'Speed: ' + Number(input.value).toFixed(2); };
      speed.append(input, out); params.appendChild(speed);
      const mutes = document.createElement('div');
      for (let i = 1; i <= (slot.song ? slot.song.channels : 4); i++) {
        const label = document.createElement('label'), box = document.createElement('input');
        box.type = 'checkbox'; label.style.display = 'inline-flex'; label.style.marginRight = '12px';
        box.onchange = () => slot.audio && slot.audio.setParam('MUTE_' + i, box.checked ? 1 : 0);
        label.append(box, document.createTextNode(' mute ' + i)); mutes.appendChild(label);
      }
      params.appendChild(mutes);
    } else {                                                    // a graphics work at full quality
      slot.module.init({ quality: 1 }); slot.initTime = performance.now() / 1000; slot.quality = 1;
      focusCanvas.width = slot.module.width; focusCanvas.height = slot.module.height; focusCanvas.style.aspectRatio = '4 / 3';
      focusImage = fctx.createImageData(focusCanvas.width, focusCanvas.height); focus32 = new Uint32Array(focusImage.data.buffer);
      el('focusLinks').innerHTML = `<a href="../exhibits/${slot.info.id}/web/" target="_blank">Standalone player</a>` +
        `<a href="../exhibits/${slot.info.id}/lecture.md" target="_blank">Lecture</a>` +
        `<a href="../exhibits/${slot.info.id}/" target="_blank">Code: Python · Java · JavaScript</a>`;
      for (const p of slot.module.params || []) {               // the "Try this" sliders
        const label = document.createElement('label'), input = document.createElement('input'), out = document.createElement('span');
        Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step, value: p.value });
        out.textContent = `${p.label}: ${p.value}`;
        input.oninput = () => { slot.module.setParam(p.name, Number(input.value)); out.textContent = `${p.label}: ${input.value}`; };
        label.append(input, out); params.appendChild(label);
      }
    }
    el('focus').classList.add('open');
  }

  function exitFocus() {
    if (!focus) return;
    if (focus.isMusic) focus.focused = false;
    else focus.quality = 0;                                     // force the scheduler to re-init at its tier
    focus = null;
    el('focus').classList.remove('open');
  }
  el('back').onclick = exitFocus;

  // ---- minimap
  const mm = el('minimap'), mctx = mm.getContext('2d');
  mm.width = map.width * 4; mm.height = map.height * 4;
  function drawMinimap() {
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const slot = byCell.get(x + ',' + y);
      mctx.fillStyle = slot ? (slot.isMusic ? '#5ee07a' : '#ffd866') : map.isSolid(x, y) ? '#555' : '#111';
      mctx.fillRect(x * 4, y * 4, 4, 4);
    }
    mctx.fillStyle = '#78dce8'; mctx.fillRect(player.x * 4 - 1.5, player.y * 4 - 1.5, 3, 3);
  }

  // ---- main loop
  let last = performance.now();
  function loop(nowMs) {
    const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
    const now = nowMs / 1000;
    if (focus) {                                                // the Focus view: nothing else runs
      if (focus.isMusic) {
        if (trackerView && focus.audio) trackerView.update(focus.audio.position, focus.audio.scopes);
      } else {
        focus.module.renderFrame(now - focus.initTime);
        const p = focus.module.palette;
        for (let i = 0; i < 256; i++) focusLut[i] = (255 << 24) | (p[i * 3 + 2] << 16) | (p[i * 3 + 1] << 8) | p[i * 3];
        const px = focus.module.pixels;
        for (let i = 0; i < px.length; i++) focus32[i] = focusLut[px[i]];
        fctx.putImageData(focusImage, 0, 0);
      }
      requestAnimationFrame(loop); return;
    }
    // walk
    let fwd = walk, side = strafe, turn = look; look = 0;
    if (keys.has('w') || keys.has('arrowup')) fwd += 1;
    if (keys.has('s') || keys.has('arrowdown')) fwd -= 1;
    if (keys.has('a')) side -= 1;
    if (keys.has('d')) side += 1;
    if (keys.has('arrowleft')) turn -= TURN_SPEED * dt;
    if (keys.has('arrowright')) turn += TURN_SPEED * dt;
    if (turn) { const c = Math.cos(turn), s = Math.sin(turn), dx = player.dirX; player.dirX = dx * c - player.dirY * s; player.dirY = dx * s + player.dirY * c; }
    fwd = Math.max(-1, Math.min(1, fwd)); side = Math.max(-1, Math.min(1, side));
    move(player, map, (player.dirX * fwd - player.dirY * side) * MOVE_SPEED * dt, (player.dirY * fwd + player.dirX * side) * MOVE_SPEED * dt);
    // exhibits: tiers, then render the ones that are due; music: faces and spatial volume
    schedule(slots, player);
    for (const s of slots) if (s.module) s.tick(now);
    for (const m of music) { m.tick(now); m.setDistance(Math.hypot(m.cell.x + 0.5 - player.x, m.cell.y + 0.5 - player.y)); }
    // draw the world
    caster.render(player, byCell);
    frame32.set(caster.image);
    ctx.putImageData(imageData, 0, 0);
    drawMinimap();
    // HUD
    const hall = HALLS.find(h => player.x >= h.x0 && player.x < h.x1);
    if (hall && hall !== lastHall) { el('hall').textContent = hall.name; showHint(hall.intro); lastHall = hall; }
    const hit = caster.centerHit, ex = hit && hit.exhibit;
    const looking = ex && (ex.module || ex.isMusic) && hit.dist < APPROACH ? ex : null;
    el('label').textContent = looking ? `${looking.info.title} — ${looking.info.by} · ${looking.info.year}` : '';
    if (looking && hintTimer <= 0) showHint(isTouch ? 'Tap to view' : 'Press E to view', 0.5);
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) hint.style.opacity = 0; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
