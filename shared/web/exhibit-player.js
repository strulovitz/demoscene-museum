/*
 * exhibit-player.js - shows an exhibit module (BIBLE chapter 3.3) on a page.
 *
 *   import { startPlayer } from '../../../shared/web/exhibit-player.js';
 *   import exhibit from './tube.js';
 *   startPlayer(exhibit, document.getElementById('stage'));
 *
 * It creates a <canvas> the size of the exhibit's picture, asks the exhibit
 * for a new frame on every screen refresh, converts the palette indices to
 * RGBA, and builds a slider for every entry in exhibit.params plus a
 * "quality" selector (1/2/4) so you can see the museum's reduced tiers.
 */

export function startPlayer(exhibit, container, { quality = 1, aspect = 4 / 3 } = {}) {
  // ---- canvas: internal size = exhibit picture, CSS size = as big as fits
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.aspectRatio = String(aspect);   // 320x200 was shown on 4:3 monitors
  canvas.style.imageRendering = 'pixelated';   // big crisp pixels, no blur
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let imageData, rgba32;

  function setQuality(q) {
    exhibit.init({ quality: q });
    canvas.width = exhibit.width;
    canvas.height = exhibit.height;
    imageData = ctx.createImageData(exhibit.width, exhibit.height);
    rgba32 = new Uint32Array(imageData.data.buffer);   // 1 pixel = 1 32-bit number
    startTime = performance.now();
  }

  // ---- palette indices -> RGBA.  Little-endian: 0xAABBGGRR
  let paletteLUT = new Uint32Array(256);
  function rebuildPaletteLUT() {
    const p = exhibit.palette;
    for (let i = 0; i < 256; i++) {
      paletteLUT[i] = (255 << 24) | (p[i * 3 + 2] << 16) | (p[i * 3 + 1] << 8) | p[i * 3];
    }
  }

  // ---- controls
  const panel = document.createElement('div');
  panel.className = 'exhibit-controls';
  container.appendChild(panel);

  const qualitySelect = document.createElement('select');
  for (const q of [1, 2, 4]) {
    const o = document.createElement('option');
    o.value = q; o.textContent = `quality 1/${q}  (${exhibit.nativeWidth / q}x${exhibit.nativeHeight / q})`;
    if (q === quality) o.selected = true;
    qualitySelect.appendChild(o);
  }
  qualitySelect.onchange = () => setQuality(Number(qualitySelect.value));
  panel.appendChild(qualitySelect);

  for (const p of exhibit.params) {
    const label = document.createElement('label');
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = p.min; slider.max = p.max; slider.step = p.step; slider.value = p.value;
    const readout = document.createElement('span');
    readout.textContent = ` ${p.label}: ${p.value}`;
    slider.oninput = () => {
      exhibit.setParam(p.name, Number(slider.value));
      readout.textContent = ` ${p.label}: ${slider.value}`;
    };
    label.appendChild(slider); label.appendChild(readout);
    panel.appendChild(label);
  }

  const fpsLabel = document.createElement('span');
  fpsLabel.className = 'exhibit-fps';
  panel.appendChild(fpsLabel);

  // ---- main loop
  let startTime = performance.now();
  let frames = 0, lastFpsTime = performance.now();
  setQuality(quality);
  rebuildPaletteLUT();

  function loop(now) {
    exhibit.renderFrame((now - startTime) / 1000);
    if (exhibit.paletteChanged) rebuildPaletteLUT();
    if (exhibit.pixelFormat === 'indexed8') {
      const src = exhibit.pixels;
      for (let i = 0; i < src.length; i++) rgba32[i] = paletteLUT[src[i]];
    } else {
      imageData.data.set(exhibit.pixels);
    }
    ctx.putImageData(imageData, 0, 0);
    frames++;
    if (now - lastFpsTime >= 1000) {
      fpsLabel.textContent = ` ${frames} fps`;
      frames = 0; lastFpsTime = now;
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}