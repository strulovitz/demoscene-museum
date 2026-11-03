/*
 * shared/web/tracker-view.js  --  draws a tracker pattern + oscilloscopes
 * (BIBLE chapter 5d.3).  Used on the walls of listening halls and in the
 * Focus panel of music exhibits.
 *
 *   import { TrackerView } from '../../shared/web/tracker-view.js';
 *   const view = new TrackerView(canvas, { song });   // song = parseMod(bytes)
 *   view.update(audio.position, audio.scopes);        // call up to 30 times a second
 *
 * The view does not play anything; it only draws what the player reports.
 */

// Period -> note name (BIBLE 5c.4).  Index 0 = C-1.
const PERIODS = [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
                 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
                 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113];
const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

export function noteName(period) {
  if (!period) return '---';
  let best = 0;
  for (let i = 1; i < PERIODS.length; i++)
    if (Math.abs(PERIODS[i] - period) < Math.abs(PERIODS[best] - period)) best = i;
  return NAMES[best % 12] + (1 + Math.floor(best / 12));
}

const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');

/** One cell as text, e.g. "C-2 01 C20".  Empty parts as "---", "..", "...". */
export function cellText(cell) {
  const note = noteName(cell.period);
  const sample = cell.sample ? hex(cell.sample, 2) : '..';
  const effect = (cell.effect || cell.param) ? hex(cell.effect, 1) + hex(cell.param, 2) : '...';
  return `${note} ${sample} ${effect}`;
}

export class TrackerView {
  constructor(canvas, { song, rowsVisible = 15 }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.song = song;
    this.rowsVisible = rowsVisible;          // odd number: current row in the centre
    this.patternCache = new Map();           // pattern number -> offscreen canvas with its text
    this.lastRow = -1;
    this.flash = new Array(song.channels).fill(0);   // per-channel "new note" brightness
  }

  // ---- layout, derived from the canvas size so it works at 640x400 and 320x200
  layout() {
    const w = this.canvas.width, h = this.canvas.height;
    const headerH = Math.round(h * 0.07);
    const scopeH = Math.round(h * 0.22);
    const vuH = Math.round(h * 0.02);
    const patternH = h - headerH - scopeH - vuH;
    const rowH = patternH / this.rowsVisible;
    const rowNumW = 30 * (w / 640);          // room for the row numbers
    const colW = (w - rowNumW) / this.song.channels;
    return { w, h, headerH, scopeH, vuH, patternH, rowH, colW, rowNumW };
  }

  /** Render a whole pattern's text once into an offscreen canvas (cached). */
  patternImage(patternNumber, L) {
    if (this.patternCache.has(patternNumber)) return this.patternCache.get(patternNumber);
    const rows = this.song.patterns[patternNumber];
    const off = document.createElement('canvas');
    off.width = L.w;
    off.height = Math.ceil(L.rowH * rows.length);
    const c = off.getContext('2d');
    const fontPx = Math.max(6, Math.floor(Math.min(L.rowH * 0.8, L.colW / 7)));
    c.font = `${fontPx}px monospace`;
    c.textBaseline = 'middle';
    rows.forEach((row, r) => {
      const y = (r + 0.5) * L.rowH;
      c.fillStyle = '#777';
      c.fillText(hex(r, 2), 2, y);
      row.forEach((cell, ch) => {
        const x = L.rowNumW + ch * L.colW + 4;
        const [note, sample, effect] = cellText(cell).split(' ');
        c.fillStyle = cell.period ? '#eee' : '#555';
        c.fillText(note, x, y);
        c.fillStyle = cell.sample ? '#ffd866' : '#555';
        c.fillText(sample, x + fontPx * 2.4, y);
        c.fillStyle = effect !== '...' ? '#78dce8' : '#555';
        c.fillText(effect, x + fontPx * 4.2, y);
      });
    });
    this.patternCache.set(patternNumber, off);
    return off;
  }

  /**
   * position: what getPosition() returned ({ order, pattern, row, speed, bpm, title, channels })
   * scopes:   optional array of Float32Array, one per channel, recent output samples
   */
  update(position, scopes) {
    if (!position) return;
    const L = this.layout();
    const ctx = this.ctx;
    ctx.fillStyle = '#0b0b10';
    ctx.fillRect(0, 0, L.w, L.h);

    // ---- header
    ctx.fillStyle = '#ccc';
    ctx.font = `${Math.floor(L.headerH * 0.55)}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${position.title || this.song.title}`, 6, L.headerH / 2);
    const right = `pos ${hex(position.order, 2)}  pat ${hex(position.pattern, 2)}  row ${hex(position.row, 2)}   spd ${position.speed}  bpm ${position.bpm}`;
    ctx.fillText(right, L.w - ctx.measureText(right).width - 6, L.headerH / 2);

    // ---- pattern, scrolled so the current row sits in the centre
    const img = this.patternImage(position.pattern, L);
    const centreY = L.headerH + L.patternH / 2;
    const srcY = (position.row + 0.5) * L.rowH - L.patternH / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, L.headerH, L.w, L.patternH); ctx.clip();
    ctx.fillStyle = '#1b2a5a';                                       // current-row bar
    ctx.fillRect(0, centreY - L.rowH / 2, L.w, L.rowH);
    ctx.drawImage(img, 0, L.headerH - srcY);
    ctx.restore();

    // ---- new-note flashes (a channel whose row cell has a period)
    if (position.row !== this.lastRow) {
      const cells = this.song.patterns[position.pattern][position.row];
      cells.forEach((cell, ch) => { if (cell.period) this.flash[ch] = 1; });
      this.lastRow = position.row;
    }

    // ---- scopes and VU bars
    const scopeTop = L.headerH + L.patternH;
    position.channels.forEach((chState, ch) => {
      const x0 = L.rowNumW + ch * L.colW;
      const brightness = Math.round(120 + 135 * this.flash[ch]);
      ctx.strokeStyle = `rgb(60, ${brightness}, 80)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const scope = scopes && scopes[ch];
      const mid = scopeTop + L.scopeH / 2;
      if (scope && scope.length) {
        for (let i = 0; i < scope.length; i++) {
          const x = x0 + 2 + (i / (scope.length - 1)) * (L.colW - 4);
          const y = mid - scope[i] * L.scopeH * 0.45;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {                                                       // no tap: a flat line
        ctx.moveTo(x0 + 2, mid); ctx.lineTo(x0 + L.colW - 2, mid);
      }
      ctx.stroke();

      this.flash[ch] *= 0.85;
      ctx.fillStyle = '#2a2a33';                                     // VU background
      ctx.fillRect(x0 + 2, L.h - L.vuH, L.colW - 4, L.vuH);
      ctx.fillStyle = '#ffd866';
      ctx.fillRect(x0 + 2, L.h - L.vuH, (L.colW - 4) * (chState.volume / 64), L.vuH);
    });
  }
}
