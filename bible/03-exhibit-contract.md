# Chapter 3 â€” The Exhibit Contract

An "exhibit" is one ported work.  This chapter defines EXACTLY what an
exhibit folder must contain and how the JavaScript port talks to the museum.

`exhibits/tube/` is the reference implementation: when in doubt, copy it.

## 3.1 Folder contents (all mandatory unless marked optional)

exhibits//
â”œâ”€â”€ exhibit.json        metadata; the museum reads ONLY this to hang the work
â”œâ”€â”€ lecture.md          explanation for visitors (format: chapter 8)
â”œâ”€â”€ poster.png          native-resolution still, used for far-away walls
â”œâ”€â”€ preview.webm        (optional) 10-second loop; auto-generated, see 3.6
â”œâ”€â”€ original/           the original work: source, readme, binary â€” unmodified
â”œâ”€â”€ python/.py          Python port (single file preferred)
â”œâ”€â”€ java/.java          Java port (single file; class name = file name)
â””â”€â”€ web/
    â”œâ”€â”€ .js             ES module implementing the interface in 3.3
    â”œâ”€â”€ -audio.js       (only if the exhibit has sound; see chapter 5)
    â””â”€â”€ index.html      standalone test page: loads shared/web/exhibit-player.js

## 3.2 `exhibit.json`
```json
{
  "id": "tube",
  "title": "tube",
  "authors": ["baze"],
  "group": "3SC",
  "year": 2001,
  "party": "Syndeecate 2001",
  "category": "256b",
  "platform": "MS-DOS",
  "links": { "pouet": "https://www.pouet.net/prod.php?which=2636" },
  "permission": "unknown",
  "summary": "An endless rotating, bending tunnel with a glowing texture and motion-blur trails â€” in 256 bytes.",
  "hasAudio": false,
  "nativeWidth": 320,
  "nativeHeight": 200,
  "displayAspect": "4:3",
  "cost": 1,
  "module": "web/tube.js",
  "ports": { "python": "python/tube.py", "java": "java/Tube.java", "web": "web/tube.js" },
  "tags": ["tunnel", "texture-mapping", "feedback", "palette"]
}
Field rules:
    id = folder name. Lower-case, hyphens.
    category: one of 256b, 512b, 1k, 4k, 64k, demo, music,
    graphics, tool. The museum groups halls by this.
    platform: MS-DOS, Windows, Amiga, C64, Atari ST, Web, ...
    permission: granted | requested | unknown | public-source
    (public-source = author published the source themselves).
    displayAspect: how the ORIGINAL was seen. 4:3 for all DOS modes
    (320x200 pixels were not square). The museum stretches to this.
    cost: 1 (light, e.g. per-pixel 2D) .. 5 (heavy, software 3D). Used by
    the tier scheduler (3.5). Exhibits with cost >= 4 must ship
    preview.webm.
    hasAudio: if true, web/<id>-audio.js must exist (chapter 5).

3.3 The JavaScript module interface

web/<id>.js is an ES module whose DEFAULT export is an object:

export default {
  // ---- identity (mirrors exhibit.json; lets the module run alone) ----
  id: 'tube',
  nativeWidth: 320,
  nativeHeight: 200,
  pixelFormat: 'indexed8',        // 'indexed8' (palette) or 'rgba32'
  // ---- tweakable constants, shown as sliders by the museum/player ----
  params: [
    { name: 'EYE_DISTANCE', label: 'Eye distance (zoom)', min: 40, max: 600, step: 1, value: 160 },
  ],
  setParam(name, value) {},
  // ---- life cycle ----
  init({ quality }) {},          // quality: 1 = native, 2 = half, 4 = quarter
  renderFrame(timeSeconds) {},   // update state and fill `pixels`
  dispose() {},
  // ---- output, valid after renderFrame() ----
  width: 0, height: 0,           // = native / quality (set by init)
  pixels: null,                  // Uint8Array(w*h)     if indexed8
                                 // Uint8ClampedArray(w*h*4) if rgba32
  palette: null,                 // Uint8Array(768) RGB, indexed8 only
  paletteChanged: false,         // set true when the palette was modified
                                 // this frame (palette-cycling effects)
  audio: null                    // or { module: './tube-audio.js' } (chapter 5)
};
Binding rules:
    No DOM. The module must not touch document, window, canvas
    or WebAudio. It fills typed arrays. This lets the museum run it on the
    main thread, in a Web Worker, or under Node.js for automated tests.
    Resolution is negotiable. init({ quality }) must produce
    width = nativeWidth / quality, height = nativeHeight / quality
    (quality âˆˆ {1, 2, 4}) and renderFrame must fill exactly that many
    pixels. Per-pixel effects achieve this by sampling every quality-th
    pixel of the native image. Effects drawn with lines/polygons scale
    their coordinates. This is what keeps the museum smooth (3.5).
    Time, not frame count. renderFrame(t) receives seconds since
    init. Exhibits whose look depends on per-frame feedback (fades,
    trails) run an internal fixed-step simulation (see tube.js) so they
    look the same at 10 fps and at 60 fps.
    Deterministic. Same t, same params â†’ same picture. Random numbers
    come from a seeded generator (shared/web/random.js), never Math.random.
    Cheap renderFrame when nothing changed is NOT required; the museum
    controls the call rate.
    Params are the lecture's "Try this" list. Every constant that the
    lecture tells students to change appears in params, with the SAME
    name as in the Python and Java files.
    Credits header. The file starts with the standard header comment:
    title, original authors/group/year, "educational remake", MIT, link to
    the BIBLE.

3.4 The standalone player (shared/web/exhibit-player.js)

Every web/index.html is identical except for the module path.  The
player: creates a canvas, calls init, runs requestAnimationFrame,
converts pixels to RGBA, shows the fps, renders sliders for params,
and offers a quality selector (1/2/4) so developers can see the reduced
tiers.  This is also the component the museum uses in Focus mode.

Local testing: browsers block ES-module imports from file://.  Run
python -m http.server 8000 in the repository root and open
http://localhost:8000/exhibits/tube/web/.  (Firefox can open the file
directly.)

3.5 Tier scheduling (what the museum does with exhibits)

The museum keeps every exhibit as a Three.js CanvasTexture on a wall
quad.  Each frame it ranks exhibits by distance and visibility and assigns:

| Tier | Condition | quality | max fps | audio |
|---|---|---|---|---|
| Focus | visitor opened the exhibit | 1 | uncapped | yes |
| Near | closest visible exhibit within 6 m | 1 | 30 | no |
| Mid | second closest visible within 12 m | 4 | 10 | no |
| Poster | everything else | â€” (poster.png, or preview.webm if present) | â€” | no |

- At most TWO exhibits are live at once (Near + Mid), plus Focus.
  Changing tier calls init({quality}) again (exhibits must support
  re-init; keep it cheap â€” cache textures/palettes at module level).
- Adaptive guard: if the museum's own frame time exceeds 25 ms averaged
  over 2 s, demote: Nearâ†’Mid quality, Midâ†’Poster.  Promote back after 5 s
  under 16 ms.  Devices reporting navigator.hardwareConcurrency <= 4
  start one tier lower.
- Exhibits with cost >= 4 are never Near/Mid; they show preview.webm
  and run live only in Focus.
- Audio only ever plays for the Focus exhibit (chapter 5 covers the
  listening halls, which are the exception: there, audio IS the exhibit).

3.6 Poster and preview generation

tools/render-poster.mjs <id> runs the module under Node.js at quality 1
for 3 simulated seconds and writes poster.png.  tools/record-preview.mjs <id>
uses a headless browser (Playwright) to record 10 s at native
resolution to preview.webm (VP9, â‰¤ 1 MB).  Both are run by CI; artefacts
are committed so the museum works from a static server (chapter 9).

3.7 Definition of done â€” checklist for an exhibit PR

- exhibit.json validates against tools/exhibit.schema.json
- original/ contains the unmodified source/readme with credits
- Python runs with python <id>.py after pip install numpy pygame-ce
- Java runs with java <Id>.java on JDK 21+
- Web module passes node tools/test-exhibit.mjs <id> (renders at
  quality 1, 2, 4 without errors; output deterministic; no DOM access)
- web/index.html opens via http.server and shows the effect
- same function names in all three languages (checked by
  tools/check-names.mjs against a list in exhibit.json â†’ functions)
- lecture.md exists with the chapter-8 structure and a "Try this" list
- every "Try this" constant is in params
- poster.png present
- credits header in all three source files

---
## Reference implementation: `exhibits/tube/web/`

Tested under Node 20 in my sandbox at quality 1, 2 and 4 (frame times:
2.2 ms / 0.6 ms / 0.2 ms; output is the same picture at each quality, just
coarser â€” ASCII renders confirmed matching the Python version).  Note the
"no DOM" rule made that test possible.

<details open>
<summary><strong><code>tube.js</code></strong> â€” the exhibit module</summary>

/*
 * ==============================================================================
 *   TUBE  -  a JavaScript remake of the 256-byte DOS intro "tube" by baze/3SC
 *            (Syndeecate 2001).  Educational remake, not the original work.
 *            Original: https://www.pouet.net/prod.php?which=2636
 *            This file: MIT licence, Demoscene Museum (see BIBLE chapter 3).
 * ==============================================================================
 *
 * Same program as tube.py and Tube.java, same five steps, same names:
 *   1. makePalette()    256 colours; pixel values are SIGNED: + = fire, - = teal
 *   2. makeTexture()    256x256 wall texture = light from one side + grain
 *   3. renderTube()     for every pixel: which point of the tunnel do I see?
 *   4. copyToScreen()   signed pixel numbers -> 0..255 palette indices
 *   5. fadeOldFrame()   divide everything by 4 -> motion blur trail
 *
 * This file does NOT draw on the screen itself.  It fills an array of pixel
 * numbers (`pixels`) and a `palette`; a "player" (shared/web/exhibit-player.js
 * or the museum) shows them.  That is why there is no `document` or `canvas`
 * anywhere in here - and why it can be tested outside a browser.
 *
 * Extra compared to the Python/Java versions (museum requirements):
 *   - quality: the museum may ask for a smaller picture (every 2nd or 4th pixel)
 *     when this exhibit is far away on a wall.
 *   - time: renderFrame(t) gets the clock in seconds; we advance our own
 *     30-steps-per-second simulation so the trails look the same at any fps.
 */

import { SeededRandom } from '../../../shared/web/random.js';

// ------------------------------------------------------------------ constants
const WIDTH = 320, HEIGHT = 200;        // classic VGA "mode 13h"
const TUBE_HEIGHT = 160;                // tunnel drawn in the middle 160 rows
const TOP = (HEIGHT - TUBE_HEIGHT) / 2; // 20 empty rows above and below
const TEXTURE_SCALE = 41;               // ~128/pi: one turn = one texture width
const FRAMES_PER_SECOND = 30;           // the 2001 original ran at about this speed

// Tweakable constants.  These are also the sliders in the museum ("Try this").
let EYE_DISTANCE = 160;                 // "screen" distance from your eye (zoom)
let ROTATION_SPEED = 0.0238;            // radians per simulation step
let SCROLL_SPEED = 8;                   // texture pixels per step (flying forward)
let FADE_SHIFT = 2;                     // >> 2 = divide by 4 each step

// ============================================================== 1. palette
/**
 * A pixel value is treated as a SIGNED number: 0..127 positive, 128..255
 * really mean -128..-1.  Positive = fire (red -> orange -> yellow),
 * negative = cold teal.  When a pixel overflows past 127 it flips to teal:
 * that overflow is the glow effect.
 * Returns Uint8Array(768): r,g,b for colour 0, r,g,b for colour 1, ...
 */
function makePalette() {
  const palette = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index++) {
    const value = index < 128 ? index : index - 256;    // 0..127 or -128..-1
    let r, g, b;
    if (value >= 0) {
      r = 2 * value;                            // grows in a straight line
      g = Math.floor(value * value / 64);       // grows like a curve
      b = 0;
    } else {
      const strength = -value;                  // 1..128
      r = 0;
      g = Math.min(255, 2 * strength);
      b = strength;
    }
    palette[index * 3] = r;
    palette[index * 3 + 1] = g;
    palette[index * 3 + 2] = b;
  }
  return palette;
}

// ============================================================== 2. texture
/**
 * 256x256 brightness values (about 20..100), stored row after row in one
 * flat array: texture[row * 256 + col].  Column = angle around the tunnel,
 * row = distance along it.  Two ingredients:
 *   LIGHT: a cosine across the columns -> one side lit, the other dark,
 *          and it joins up seamlessly where the texture wraps around.
 *   GRAIN: a little blurred random noise so the wall looks like concrete.
 */
function makeTexture() {
  const random = new SeededRandom(2001);           // same grain every run
  const grain = new Float32Array(256 * 256);
  for (let i = 0; i < grain.length; i++) grain[i] = random.next() - 0.5;
  const texture = new Int32Array(256 * 256);
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      const light = 60 + 30 * Math.cos((col - 104) * 2 * Math.PI / 256);
      // blur: average with the four neighbours.  "& 255" wraps 256 -> 0 and
      // -1 -> 255, so the edges join up.
      const blurred = (grain[row * 256 + col]
        + grain[((row + 1) & 255) * 256 + col] + grain[((row - 1) & 255) * 256 + col]
        + grain[row * 256 + ((col + 1) & 255)] + grain[row * 256 + ((col - 1) & 255)]) / 5;
      texture[row * 256 + col] = Math.round(light + 8 * blurred);
    }
  }
  return texture;
}

// Built once, shared by every init() (the museum may re-init us when we
// change wall-distance tier, and we don't want to rebuild 64 K numbers).
const PALETTE = makePalette();
const TEXTURE = makeTexture();

// ============================================================== 3. the tube
/**
 * For every pixel: it sits on a glass screen EYE_DISTANCE in front of your
 * eye at (x, y).  Where does the line from your eye through that pixel hit
 * the tunnel wall?  The tunnel has radius 1 around the Z axis, so
 *     angle around the tunnel   = atan2(x, y)          -> texture column u
 *     distance along the tunnel = z / sqrt(x^2 + y^2)  -> texture row v
 * First we rotate the scene so the tunnel turns and bends.  The result is
 * ADDED to the (faded) previous frame stored in `state.tube`.
 *
 * `step` is the quality: 1 = every pixel, 2 = every 2nd, 4 = every 4th.
 */
function renderTube(state) {
  const { tube, tubeWidth, tubeHeight, step, angle, scroll } = state;
  const c = Math.cos(angle), s = Math.sin(angle);
  const z = EYE_DISTANCE;
  let i = 0;
  for (let row = 0; row < tubeHeight; row++) {
    const y = (row + 0.5) * step - 80;            // 0 = screen centre
    for (let col = 0; col < tubeWidth; col++) {
      const x = (col + 0.5) * step - 160;
      // rotation 1: spin around the Z axis (the direction you look)
      const x1 = x * c + y * s;
      const y1 = y * c - x * s;
      // rotation 2: turn around the Y axis - this bends the tube
      const x2 = x1 * c + z * s;
      const z2 = z * c - x1 * s;
      const radius = Math.max(Math.sqrt(x2 * x2 + y1 * y1), 0.001);
      const u = Math.round(TEXTURE_SCALE * Math.atan2(x2, y1));
      const depth = TEXTURE_SCALE * z2 / radius;             // huge near the centre
      const v = Math.round(Math.max(-32768, Math.min(32767, depth)));
      // Three layers chosen by a checkerboard test.  "& 64" looks at one
      // bit of the number, which flips every 64 texture pixels, so
      // (u + v) & 64 gives diagonal squares.  Each layer is a different
      // zoom of the texture and a different darkness.
      let colour;
      if (((u + v + scroll) & 64) === 0) {
        colour = TEXTURE[((v + scroll) & 255) * 256 + (u & 255)] - 5;              // zoom 1x
      } else if (((4 * u - 4 * v - scroll) & 128) === 0) {
        colour = TEXTURE[((4 * v + scroll) & 255) * 256 + ((4 * u) & 255)] - 16;   // zoom 4x
      } else {
        colour = TEXTURE[((8 * v + scroll) & 255) * 256 + ((8 * u) & 255)] - 48;   // zoom 8x
      }
      tube[i] = wrapToSignedByte(tube[i] + colour);
      i++;
    }
  }
}

/**
 * Keep a number in -128..127, wrapping like a car odometer (127 + 1 = -128).
 *  The wrap-around is what makes the hottest spots flash teal.
 *  "<< 24 >> 24" pushes the low 8 bits to the top of a 32-bit number and
 *  back, which makes JavaScript treat them as a signed byte.
 */
function wrapToSignedByte(value) {
  return (value << 24) >> 24;
}

// ============================================================== 5. the fade
/**
 * Divide every pixel by 2^FADE_SHIFT (">>" keeps the sign).  Done every
 *  step, each drawn image fades out over a few steps = motion blur trail.
 */
function fadeOldFrame(state) {
  const tube = state.tube;
  for (let i = 0; i < tube.length; i++) tube[i] >>= FADE_SHIFT;
}

// ================================================== 4. show it
/**
 * Signed tunnel values -> 0..255 palette indices in the output picture.
 *  "& 255" turns -1 into 255 etc.  Rows above/below the tunnel stay 0.
 */
function copyToScreen(state) {
  const { tube, tubeWidth, tubeHeight, step } = state;
  const top = TOP / step;
  for (let row = 0; row < tubeHeight; row++) {
    const out = (top + row) * state.width;
    const src = row * tubeWidth;
    for (let col = 0; col < tubeWidth; col++) {
      state.pixels[out + col] = tube[src + col] & 255;
    }
  }
}

// ================================================== the exhibit object
const exhibit = {
  id: 'tube',
  nativeWidth: WIDTH,
  nativeHeight: HEIGHT,
  pixelFormat: 'indexed8',
  audio: null,
  params: [
    { name: 'EYE_DISTANCE',   label: 'Eye distance (zoom)',    min: 40,  max: 600, step: 1,      value: 160 },
    { name: 'ROTATION_SPEED', label: 'Rotation speed',         min: -0.1, max: 0.1, step: 0.001, value: 0.0238 },
    { name: 'SCROLL_SPEED',   label: 'Flying speed',           min: -32, max: 32,  step: 1,      value: 8 },
    { name: 'FADE_SHIFT',     label: 'Trail length (0 = long)', min: 0,  max: 4,   step: 1,      value: 2 },
  ],
  setParam(name, value) {
    if (name === 'EYE_DISTANCE') EYE_DISTANCE = value;
    else if (name === 'ROTATION_SPEED') ROTATION_SPEED = value;
    else if (name === 'SCROLL_SPEED') SCROLL_SPEED = value;
    else if (name === 'FADE_SHIFT') FADE_SHIFT = value;
    const p = this.params.find(p => p.name === name);
    if (p) p.value = value;
  },

  // output (filled by init / renderFrame)
  width: 0, height: 0, pixels: null, palette: PALETTE, paletteChanged: false,
  state: null,

  init({ quality = 1 } = {}) {
    const step = quality;
    this.width = WIDTH / step;
    this.height = HEIGHT / step;
    this.pixels = new Uint8Array(this.width * this.height);
    this.state = {
      step,
      width: this.width,
      tubeWidth: WIDTH / step,
      tubeHeight: TUBE_HEIGHT / step,
      tube: new Int32Array((WIDTH / step) * (TUBE_HEIGHT / step)), // signed -128..127
      pixels: this.pixels,
      angle: 0,
      scroll: 0,
      stepsDone: 0,
    };
    this.paletteChanged = true;       // tell the player to upload the palette once
  },

  /**
   * Called by the player/museum with the clock in seconds.  The intro's look
   * depends on how many fade steps happened, so we run a FIXED number of
   * steps per second (30), however often this function is called.
   */
  renderFrame(timeSeconds) {
    const st = this.state;
    const wanted = Math.floor(timeSeconds * FRAMES_PER_SECOND);
    if (wanted - st.stepsDone > 3) st.stepsDone = wanted - 3;   // we fell behind: skip ahead
    while (st.stepsDone < wanted) {
      st.angle += ROTATION_SPEED;
      st.scroll += SCROLL_SPEED;
      renderTube(st);            // draw on top of the faded old frame
      copyToScreen(st);
      fadeOldFrame(st);          // prepare for the next step
      st.stepsDone++;
    }
    this.paletteChanged = false;
  },

  dispose() {
    this.state = null;
    this.pixels = null;
  },
};

export default exhibit;
shared/web/random.js  -  seeded random numbers (rule 3.3.4)

/*
 * random.js - a tiny random number generator with a SEED.
 *
 * Math.random() gives different numbers every time you run the program.
 * Demos want the SAME "random" texture every run, so we use a generator we
 * control: give it a seed (any number) and it produces the same sequence
 * forever.  This one is "mulberry32", a well-known 32-bit generator.
 * Usage:  const r = new SeededRandom(2001);  r.next()  -> 0.0 .. 1.0
 */

export class SeededRandom {
  constructor(seed) {
    this.state = seed >>> 0;            // keep it as a 32-bit unsigned number
  }

  next() {
    let t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
shared/web/exhibit-player.js  -  standalone player (also used by the museum in Focus mode)

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
exhibits/tube/web/index.html

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tube - baze/3SC 2001 - JavaScript remake</title>
  <style>
    body { margin: 0; background: #111; color: #ddd; font-family: sans-serif; }
    #stage { max-width: 960px; margin: 0 auto; padding: 1rem; }
    .exhibit-controls { display: flex; flex-direction: column; gap: .5rem; margin-top: 1rem; }
    .exhibit-controls label { display: flex; align-items: center; gap: .5rem; }
    .exhibit-controls input[type=range] { flex: 1; }
    .exhibit-fps { opacity: .6; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <script type="module">
    import { startPlayer } from '../../../shared/web/exhibit-player.js';
    import exhibit from './tube.js';
    startPlayer(exhibit, document.getElementById('stage'));
  </script>
</body>
</html>
