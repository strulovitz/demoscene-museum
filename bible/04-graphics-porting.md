# Chapter 4 — Graphics porting reference

How old graphics code becomes a readable modern remake.  Read this when
you port an exhibit; chapter 3 defines what the result must look like,
this chapter explains how to get there.  The reference example is
`exhibits/tube/` (chapter 8 shows its lecture); its ports are
`exhibits/tube/python/tube.py`, `exhibits/tube/java/Tube.java` and
`exhibits/tube/web/tube.js`.

## 4.1 The porting method (always the same five steps)

1. WATCH IT.  Run the original (DOSBox, WinUAE, VICE, or a pouet.net
   video).  Write down in plain words what you SEE: "a spinning tunnel,
   lit on one side, with trails".  This sentence becomes the lecture's
   first line and the test for the port.
2. FIND THE SKELETON.  Every intro, however obfuscated, has: setup
   (video mode, palette, tables), a main loop (per frame: compute, draw,
   wait, check keyboard), and exit.  Mark these in the original source.
3. NAME THE IDEAS, NOT THE INSTRUCTIONS.  For each block of the main loop
   write one sentence: "for every pixel, find the tunnel point it looks at".
   Those sentences become the functions of the port (3–8 functions).
4. REBUILD FROM THE IDEAS.  Write the port from the sentences, not from
   the instructions.  Consult the original only for numbers (table sizes,
   speeds, colours) and to check the look.  Where the original used a
   hardware accident (leftover register, screen-memory wrap), reproduce
   the VISIBLE effect explicitly with a named helper and a comment.
5. COMPARE AND TUNE.  Side by side with the original: colour, speed,
   direction, proportions.  Match the look, not the bits.  Record every
   deliberate difference in the lecture under "What we changed".

The original source stays unmodified in `original/`; the port never
quotes assembly.  The lecture may show one or two lines of the original
as "the same idea in 1995" when it genuinely helps.

## 4.2 The VGA, in the words we need

Mode 13h: 320 x 200 pixels, one byte per pixel, the byte is an index into
a palette of 256 colours.  Video memory at segment A000h is simply the
array `screen[y * 320 + x]`.  Shown on a 4:3 monitor, so pixels were
taller than wide (aspect 1.2); the museum stretches to 4:3
(`displayAspect`).  In the port: a `Uint8Array(320*200)` /
`numpy uint8 (200, 320)` / `int[200][320]` plus a palette.

Palette: 256 entries of red, green, blue, each 0..63 (6 bits).  Set by
writing the index to port 3C8h and three bytes to 3C9h.  In the port:
0..255 values (multiply by 4, or by 255/63), built by a `makePalette`
function that returns the whole table at once.  When the original
computes the palette with a formula, port the formula; when it stores a
table, copy the numbers.

Palette tricks you will meet:
- Palette cycling: the picture never changes, only the palette rotates
  (water, lava, "plasma" in many intros).  Port: rotate the palette array
  each frame; set `paletteChanged = true` (chapter 3.3).
- Fades: all entries scaled towards black or white.  Port: multiply.
- Split palettes: 0..127 one gradient, 128..255 another, with the pixel
  value treated as signed (tube does this).  Port: keep it — explain the
  "odometer wraparound" in the lecture; it is a real lesson.

Vertical retrace (port 3DAh bit 3): waiting for it synchronised the loop
to the monitor (70 Hz in mode 13h) and avoided tearing.  Port:
`requestAnimationFrame` / `clock.tick(fps)` / `Timer`; the original's
"frames per second" is 70 if it waited for retrace, otherwise "as fast as
a 486 could do it" — estimate from a recording and set `FRAMES_PER_SECOND`.

Double buffering: drawing into an off-screen array and copying it to
A000h in one go.  Port: this is the natural structure anyway (render into
`pixels`, the player shows it).

Mode X / tweaked modes (320 x 240, 320 x 400, planar memory, hardware
scrolling via the CRTC start address): the planes and the start-address
tricks are implementation details; port the RESULT: the resolution, and
scrolling as an offset into a larger buffer.

Text mode effects (80 x 25 characters, 16 colours, attributes, custom
fonts): port as a character grid drawn with a bitmap font from
`shared/web/fonts/cp437.png` (the IBM PC font) or by rendering into a
pixel buffer at 640 x 400 (8 x 16 characters).  Custom fonts in the
original are data — copy them.

## 4.3 Amiga and C64, briefly

Amiga (OCS/ECS/AGA): planar bitmaps (1–8 bitplanes), the Copper (a
co-processor that changes registers per scanline — every "rainbow" or
"copper bars" effect), the Blitter (fast rectangle copies, line draws
and fills), hardware sprites, 32/4096 colours (OCS) or 256/16M (AGA),
usually 320 x 256 PAL at 50 Hz, aspect close to square.  Port: Copper
effects become "a colour per scanline" arrays; Blitter effects become
plain loops; HAM mode pictures are converted to RGB once.  `platform:
"Amiga"`, `displayAspect: "4:3"`, 50 fps.

C64 (VIC-II, SID): 320 x 200 with 16 fixed colours and colour-cell
limits (one background + 1 or 3 colours per 8 x 8 cell), raster
interrupts for per-line effects, 8 hardware sprites.  Port the look
including the 16-colour palette (use the "Pepto" palette values) and,
where the effect depends on them, the colour-cell limits.  SID music is
chapter 5b territory (three oscillators with ADSR and filter — our FM
synth structure with different waveforms).  50 fps.

## 4.4 Effect families and how each is ported

Each family has a one-sentence idea; the port is that sentence as code.
Function names below are the standard names to use (chapter 2.3).

- Plasma: `color = sin(x*a) + sin(y*b) + sin((x+y)*c + t) + sin(sqrt(x^2+y^2)*d - t)`,
  scaled to 0..255, through a smooth cyclic palette.  The original used
  pre-computed sine tables of 8-bit values; the port uses `Math.sin`.
  Functions: `makePalette`, `renderPlasma`.  numpy: build x and y grids
  once with `meshgrid`, evaluate the sum per frame.
- Fire: each pixel = average of the 3–4 pixels below it, minus a little,
  with random hot pixels on the bottom row; palette black → red → yellow
  → white.  Functions: `seedBottomRow`, `propagateFire`, `makeFirePalette`.
  numpy: shifted-array sums (`np.roll`).
- Tunnel (tube): per pixel, angle and 1/radius give texture coordinates.
  Reference: tube.  Variations: moving the centre, two tunnels, a
  texture that is a picture.
- Rotozoom: per pixel, `u = x*cos(a)*s - y*sin(a)*s + ox`, `v = ...`;
  look up a texture with `& 255` wrap.  Functions: `renderRotozoom`.
  numpy: matrix multiply of the grid.
- Twister / bars: per scanline, a rotated square or a cylinder: compute
  four edge x positions per line and fill between them.  Per-line loops.
- Starfield: N points with (x, y, z); each frame `z -= speed`; project
  `sx = x / z * EYE + 160`; brightness from z.  `updateStars`,
  `projectStar`.
- Vector objects (wireframe/filled cubes, "glenz"): points → rotate (3
  matrices or quaternion-free sin/cos) → project → draw lines
  (Bresenham in the original; the port may use canvas lines in JS,
  `pygame.draw.line`, `Graphics.drawLine`, but when the lecture is about
  line drawing, port Bresenham as `drawLine`) → fill polygons by
  scanline (`fillPolygon`).  Painter's sort by average z.  Shading:
  flat (normal · light).
- Lissajous curves (VeX-InTrO): points at `x = A*sin(a*t + d)`,
  `y = B*sin(b*t)`; a trail of N recent points, each dimmer; often with
  a third sine for z and projection.  Functions: `lissajousPoint`,
  `drawTrail`.  The beauty is in the ratios a:b — make them sliders.
- Bump mapping / phong dots / metaballs: per pixel distance or normal
  functions through a palette.  Port like plasma with a different
  formula; numpy again.
- Scrollers: a bitmap font (data), characters drawn with a moving offset,
  often on a sine path (`y = base + amp*sin(x*k + t)`).  `drawText`,
  `scrollPosition`.
- Feedback/motion blur (tube's fade, "bump into history"): keep the
  previous frame, darken it (`>> 1`, `>> 2`, or subtract), draw on top.
  `fadeOldFrame`.
- Raycasting (Wolfenstein-style, for the museum itself too): per screen
  column cast a ray through a grid, DDA stepping, wall height =
  `EYE / distance`.  `castRay`, `drawColumn`.

For any family: if the pixel formula is the whole effect, Python uses
numpy on grids; Java and JavaScript use two nested loops.  If the effect
is per-line or per-object, all three use plain loops.

## 4.5 Numbers and tables in old code

- Fixed point: `x` stored as integer with 8 or 16 fractional bits
  (`x >> 8` to use it).  Port: plain floats.  Say so in a comment the
  first time ("the original stored 1.5 as 384 = 1.5 * 256").
- Sine tables: 256 entries of `sin(i * 2π/256) * 127`.  Port:
  `Math.sin`.  If the LOOK depends on 8-bit rounding (rare), keep a table.
- Lookup palettes/gradients: copy the data; generate with a formula only
  when the original did.
- Randomness: the original often used leftover registers or the timer.
  Port: `SeededRandom` (shared/web/random.js), `np.random.default_rng(seed)`,
  `new Random(seed)`.  Fixed seeds; deterministic output (3.3.4).
- 8-bit and 16-bit wraparound: port only where it is visible (textures
  that tile at 256 use `& 255`; signed-byte palettes use
  `wrapToSignedByte`).  Everything else uses normal integers/floats.
- Self-modifying code and data-as-code: ignore; port the effect.
- Keyboard: port 60h scancode 1 = ESC.  Port: the player/museum handles
  input; the module never reads input.

## 4.6 Quality and resolution (chapter 3.3 rule 2)

Per-pixel effects implement `quality` by stepping over the native grid:
`x = (col + 0.5) * step - centerX`.  Line/polygon effects scale
coordinates by `1/step` and line widths stay 1 px.  Text-mode effects
render at native resolution and let the museum downscale (text is
unreadable at quality 4 anyway; set `cost` accordingly).  Feedback
effects keep their history buffer at the reduced size (re-init on tier
change is acceptable — a 0.1 s trail restart is invisible on a far wall).

## 4.7 Timing (chapter 3.3 rule 3)

Exhibits whose look depends on per-frame state (fades, fire, feedback)
run a fixed simulation step (`FRAMES_PER_SECOND`, from the original's
speed) driven by `renderFrame(t)`; exhibits that are pure functions of
time (plasma, rotozoom, Lissajous) compute directly from `t` and are
naturally smooth at any frame rate.  Python/Java downloads use
`clock.tick(FRAMES_PER_SECOND)` / `Timer(1000 / FRAMES_PER_SECOND)`.

## 4.8 Checklist for a graphics port

- [ ] one-sentence description written before coding (4.1 step 1)
- [ ] 3–8 functions with standard names (4.4), identical in all three languages
- [ ] palette built by `makePalette`; cycling sets `paletteChanged`
- [ ] no assembly concepts in the code (no "register", "segment", "port")
- [ ] hardware accidents reproduced on purpose with a named helper + comment
- [ ] `quality` 1/2/4 supported; time-based or fixed-step as appropriate
- [ ] seeded randomness; deterministic
- [ ] side-by-side comparison done; "What we changed" written in the lecture
- [ ] `displayAspect`, `FRAMES_PER_SECOND`, `platform` set from the original
