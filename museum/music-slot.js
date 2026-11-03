/*
 * museum/music-slot.js  --  a music exhibit as a PILLAR: one channel per face
 * (BIBLE chapter 5d, adapted to the raycaster museum).
 *
 * The pillar is a 1x1 wall cell with four faces.  Face f shows channel f of the
 * module: its name, the sample it is playing, an oscilloscope of its sound, a
 * VU meter and its own column of the pattern scrolling by.  The audio is the
 * shared MOD player running in an AudioWorklet (shared/web/examples/mod-audio.js)
 * through the shared host (shared/web/audio-host.js); the page parses the same
 * file once more to know the pattern text.
 *
 * Browsers only allow sound after the visitor has clicked/tapped/pressed a key,
 * so the faces first show "tap or press a key to enter with sound".
 */

import { startAudio } from '../shared/web/audio-host.js';
import { parseMod } from '../shared/web/examples/mod-audio.js';
import { cellText } from '../shared/web/tracker-view.js';

const FACE_W = 160, FACE_H = 120;        // picture size of one face (4:3 like the frames)
const FACES_PER_SECOND = 15;
const hex2 = v => v.toString(16).toUpperCase().padStart(2, '0');

export class MusicSlot {
  constructor(letter, cell, info) {
    this.letter = letter; this.cell = cell; this.info = info;
    this.key = cell.x + ',' + cell.y;
    this.isMusic = true;
    this.module = null;                  // (not a graphics module; the scheduler ignores us)
    this.seen = false;
    this.song = null; this.bytes = null; this.audio = null;
    this.ready = false; this.started = false; this.wantStart = false; this.focused = false; this.error = null;
    this.lastDraw = 0;
    // four faces, each a small canvas we draw with the 2D API, then copy as RGB for the raycaster
    this.faces = [];
    for (let f = 0; f < 4; f++) {
      const canvas = document.createElement('canvas');
      canvas.width = FACE_W; canvas.height = FACE_H;
      this.faces.push({ canvas, ctx: canvas.getContext('2d'), rgba: new Uint32Array(FACE_W * FACE_H), width: FACE_W, height: FACE_H });
    }
    this.drawIdle();
  }

  /** Fetch and parse the module file (no sound yet). */
  async load() {
    try {
      const response = await fetch(this.info.data);
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
      this.bytes = new Uint8Array(await response.arrayBuffer());
      this.song = parseMod(this.bytes);
      this.ready = true;
    } catch (e) {
      this.error = 'song file not found: ' + this.info.data;
      console.error(this.error, e);
    }
    this.drawIdle();
    if (this.wantStart) this.start();
  }

  /** Start the sound.  Call from a user gesture (click/tap/key); safe to call early. */
  async start() {
    this.wantStart = true;
    if (this.started || !this.ready) return;
    this.started = true;
    const playerUrl = new URL('../shared/web/examples/mod-audio.js', import.meta.url).href;
    this.audio = await startAudio(playerUrl, { scopes: this.song.channels, volume: 0 });
    this.audio.setParam('MOD_DATA', this.bytes.buffer);
  }

  /** Spatial sound: louder near the pillar, quiet in the next hall. */
  setDistance(d) {
    if (!this.audio) return;
    this.audio.setVolume(this.focused ? 0.6 : 0.7 * Math.min(1, 2.5 / (1 + d)));
  }

  tick(now) {
    if (now - this.lastDraw < 1 / FACES_PER_SECOND) return;
    this.lastDraw = now;
    if (this.audio && this.audio.position) this.drawFaces(this.audio.position, this.audio.scopes);
  }

  // ------------------------------------------------------------ drawing

  drawIdle() {
    for (const face of this.faces) {
      const ctx = face.ctx;
      ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, FACE_W, FACE_H);
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#eee'; ctx.font = 'bold 14px monospace';
      ctx.fillText(this.info.title.toUpperCase(), 6, 20);
      ctx.fillStyle = '#ffd866'; ctx.font = '9px monospace';
      ctx.fillText(this.info.by, 6, 40);
      ctx.fillText(String(this.info.year), 6, 52);
      ctx.fillStyle = this.error ? '#e07a7a' : '#78dce8';
      const lines = this.error ? ['song file not found'] : this.ready ? ['tap or press a key', 'to enter with sound'] : ['loading...'];
      lines.forEach((line, i) => ctx.fillText(line, 6, 80 + i * 12));
      this.upload(face);
    }
  }

  drawFaces(position, scopes) {
    for (let f = 0; f < 4; f++) {
      const face = this.faces[f], ctx = face.ctx;
      const ch = f % this.song.channels;
      const state = position.channels[ch];
      ctx.fillStyle = '#0b0b10'; ctx.fillRect(0, 0, FACE_W, FACE_H);
      ctx.textBaseline = 'top';
      // header: channel number, speaker side, current sample name
      ctx.fillStyle = '#eee'; ctx.font = 'bold 14px monospace';
      ctx.fillText('CHANNEL ' + (ch + 1), 4, 3);
      ctx.fillStyle = '#777'; ctx.font = '9px monospace';
      ctx.fillText(ch % 4 === 0 || ch % 4 === 3 ? 'LEFT' : 'RIGHT', FACE_W - 34, 6);
      const sample = state.sample ? this.song.samples[state.sample - 1] : null;
      ctx.fillStyle = '#ffd866';
      ctx.fillText((sample ? sample.name : '').slice(0, 24), 4, 19);
      // oscilloscope of this channel's sound
      const top = 30, h = 38, mid = top + h / 2;
      ctx.strokeStyle = '#2b2b36'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(FACE_W - 14, mid); ctx.stroke();
      const scope = scopes && scopes[ch];
      if (scope) {
        ctx.strokeStyle = state.volume ? '#5ee07a' : '#2d6b3a';
        ctx.beginPath();
        const n = scope.length, w = FACE_W - 18;
        for (let i = 0; i < n; i += 4) {
          const x = 4 + i / (n - 1) * w;
          const y = mid - Math.max(-1, Math.min(1, scope[i] * 1.5)) * h * 0.48;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // VU meter (vertical, right edge)
      ctx.fillStyle = '#2a2a33'; ctx.fillRect(FACE_W - 10, top, 6, h);
      const vu = h * state.volume / 64;
      ctx.fillStyle = '#ffd866'; ctx.fillRect(FACE_W - 10, top + h - vu, 6, vu);
      // this channel's pattern column: two rows above and below the current one
      const rows = this.song.patterns[position.pattern];
      const rowH = 10, listTop = 70;
      ctx.font = '10px monospace';
      for (let k = -2; k <= 2; k++) {
        const r = position.row + k, y = listTop + (k + 2) * rowH;
        if (k === 0) { ctx.fillStyle = '#1b2a5a'; ctx.fillRect(0, y, FACE_W, rowH); }
        if (r < 0 || r >= rows.length) continue;
        const cell = rows[r][ch];
        const [note, smp, effect] = cellText(cell).split(' ');
        ctx.fillStyle = '#777'; ctx.fillText(hex2(r), 4, y + 1);
        ctx.fillStyle = cell.period ? '#eee' : '#555'; ctx.fillText(note, 28, y + 1);
        ctx.fillStyle = cell.sample ? '#ffd866' : '#555'; ctx.fillText(smp, 58, y + 1);
        ctx.fillStyle = effect !== '...' ? '#78dce8' : '#555'; ctx.fillText(effect, 82, y + 1);
      }
      this.upload(face);
    }
  }

  /** Copy the face canvas into the RGB array the raycaster samples. */
  upload(face) {
    const image = face.ctx.getImageData(0, 0, FACE_W, FACE_H);
    face.rgba.set(new Uint32Array(image.data.buffer));         // RGBA bytes = the raycaster's ABGR words
  }
}
