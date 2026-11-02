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
