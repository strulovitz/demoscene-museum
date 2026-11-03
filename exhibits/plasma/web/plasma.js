/*
 * exhibits/plasma/web/plasma.js  --  the classic "plasma" effect, as a museum
 * sample exhibit (not a historical work; BIBLE 4.4 "Plasma").  MIT licence.
 *
 * Four sine waves are added for every pixel and the sum picks a colour from a
 * smooth, cyclic palette.  Because everything is a function of (x, y, time),
 * there is no state: any frame can be drawn at any moment, at any quality.
 */

const WIDTH = 320, HEIGHT = 200;
let SPEED = 1.0, SCALE = 1.0;

/** A rainbow that joins up with itself, so cycling never jumps. */
function makePalette() {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const a = i / 256 * 2 * Math.PI;
    palette[i * 3]     = 128 + 127 * Math.sin(a);
    palette[i * 3 + 1] = 128 + 127 * Math.sin(a + 2 * Math.PI / 3);
    palette[i * 3 + 2] = 128 + 127 * Math.sin(a + 4 * Math.PI / 3);
  }
  return palette;
}

function renderPlasma(pixels, width, height, step, t) {
  let i = 0;
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) * step * SCALE;
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) * step * SCALE;
      const v = Math.sin(x / 16 + t) + Math.sin(y / 8 - t * 0.7)
              + Math.sin((x + y) / 16 + t * 0.5) + Math.sin(Math.hypot(x - 160, y - 100) / 8 - t);
      pixels[i++] = ((v + 4) / 8 * 255) | 0;                   // v is -4..4 -> 0..255
    }
  }
}

export default {
  id: 'plasma', nativeWidth: WIDTH, nativeHeight: HEIGHT, pixelFormat: 'indexed8', audio: null,
  params: [
    { name: 'SPEED', label: 'Speed', min: 0, max: 4, step: 0.1, value: 1 },
    { name: 'SCALE', label: 'Zoom (smaller = bigger blobs)', min: 0.25, max: 3, step: 0.05, value: 1 },
  ],
  setParam(name, value) { if (name === 'SPEED') SPEED = value; if (name === 'SCALE') SCALE = value; const p = this.params.find(p => p.name === name); if (p) p.value = value; },
  width: 0, height: 0, pixels: null, palette: makePalette(), paletteChanged: false, step: 1,
  init({ quality = 1 } = {}) {
    this.step = quality; this.width = WIDTH / quality; this.height = HEIGHT / quality;
    this.pixels = new Uint8Array(this.width * this.height); this.paletteChanged = true;
  },
  renderFrame(t) { renderPlasma(this.pixels, this.width, this.height, this.step, t * SPEED); this.paletteChanged = false; },
  dispose() { this.pixels = null; },
};
