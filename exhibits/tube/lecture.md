---
id: tube
video:
readingMinutes: 7
level: beginner
concepts: [palette, texture mapping, polar coordinates, feedback]
---
# tube — an endless tunnel in 256 bytes

## What you see

You are flying through a tunnel that never ends.  It spins slowly and
bends as you go.  One side is lit in fire colours, the other falls into
darkness, and the walls carry a checkerboard of textures at three
different zooms.  Everything leaves a soft trail behind it, like a long
photo exposure.  Where the light gets too bright, it flips to a cold
teal — that is not a bug; you will see why.

## Then

**tube** was written by **baze** of the Slovak group **3SC** for the
**Syndeecate 2001** party.  It is a **256-byte intro**: the whole
program — graphics, animation, keyboard check — is 256 bytes long.  This
paragraph is longer than that.  It ran under MS-DOS in **mode 13h**, a
screen of 320 by 200 dots where each dot is one number from 0 to 255 and
a **palette** says which colour each number means.  To fit, baze used
every trick: the same four bytes serve as a decimal number, a whole
number, and a machine instruction.  Our remake is about 150 readable
lines and does the same thing.  Speed was no problem then and is none
now: the original drew a frame in about 1/30 of a second on a 2001 PC.

## How it works

### Step 1: Build the palette

A pixel is a number from 0 to 255, and we decide what each number looks
like.  The trick of this intro: we treat the number as **signed** — 0 to
127 are positive, and 128 to 255 are really −128 to −1 (the way old
computers store small negative numbers).  Positive numbers get fire
colours: a little light is dark red, more is orange, a lot is yellow.
Negative numbers get a cold teal.  When a pixel is pushed past 127 it
wraps around to −128, like a car odometer — and flips from yellow to
teal.  That flash is the glow you see in the brightest spots.

{{code python make_palette}}

### Step 2: Paint the wall texture

The tunnel's wall is a 256 by 256 picture that we wrap around the inside
of the tube: columns go around, rows go along.  It has two ingredients.
A **cosine wave** across the columns makes one side bright and the
opposite side dark — a light shining in from one side — and because a
cosine comes back to where it started, the texture joins up seamlessly
where it wraps.  Then a little blurred random **grain** so the walls
look like concrete instead of plastic.  The random numbers come from a
generator with a fixed seed, so the texture is the same every time you
run it.

{{code python make_texture}}

### Step 3: Find the tunnel point for every pixel

This is the heart of the effect.  Imagine a glass screen in front of
your eye, `EYE_DISTANCE` away.  Each pixel is a point on that glass.
Draw a line from your eye through the pixel: where does it hit the
tunnel wall?  The tunnel is a cylinder around the direction you look, so
two numbers tell you the spot: the **angle** around the tube (which
column of the texture), and how **far** along it (which row).  The angle
comes from `atan2(x, y)`; the distance is `z / radius` — points near the
centre of the screen are far away, points near the edge are close.  The
LaTeX for the two formulas, if you want to write them down:
`u = 41 \cdot \operatorname{atan2}(x, y)` and `v = 41 \cdot z / \sqrt{x^2 + y^2}`.
The 41 is about 128 divided by pi, so one full turn around the tunnel is
exactly the 256 columns of the texture.  Before all this, we rotate the
point twice by the same angle — once around the view direction (spin),
once around the vertical (bend) — which is why the tunnel turns and
curves.

Finally, a **checkerboard** decides which of three zoom levels of the
texture this pixel shows.  `& 64` looks at one bit of the number, which
flips every 64 texture pixels; testing `u + v` gives diagonal squares.
Each layer is also a little darker than the last.

{{code python render_tube}}

### Step 4: Draw on top of the old frame

We do not clear the screen.  The new tunnel is ADDED to what is already
there, and the sum is wrapped back into −128..127 with
`wrap_to_signed_byte`.  This is where the odometer overflow of Step 1
happens: the lit wall plus a bright ghost from the last frame can pass
127 and flash teal.

{{code python wrap_to_signed_byte}}

### Step 5: Fade the old frame

After the frame is shown, every pixel is divided by 4 (`>> 2` shifts the
bits right by two — the fastest way to divide by four).  Done every
frame, each picture fades out over three or four frames.  That is the
motion-blur trail.

{{code python fade_old_frame}}

### Step 6: Show it

The 160 rows of tunnel are placed in the middle of the 200-row screen,
the palette turns numbers into colours, and the 320 by 200 picture is
stretched to the window.  In the Java and Python versions this is the
main loop; in the web version the museum does it for us.

{{code python main}}

## Try this

- `EYE_DISTANCE`: set it to 80 for a wide-angle fisheye, or 400 for a
  narrow telephoto tunnel.
- `ROTATION_SPEED`: 0 stops the spin; negative spins the other way.
- `SCROLL_SPEED`: negative, and you fly backwards.
- `FADE_SHIFT`: 1 for long dreamy trails, 3 for almost none.  (The
  original uses 2.)
- In `make_palette`, swap red and blue — an ice tunnel.
- In `render_tube`, delete the second rotation (set `x2 = x1` and
  `z2 = z`) — the tunnel stops bending and only spins.
- In `make_texture`, change `30` (the light strength) to 0 — the lighting
  disappears and only the grain is left.

## What we changed

- The original's texture is "leftover numbers, blurred".  We looked at
  it and saw it is mostly a light from one side; we rebuilt it as a
  cosine wave plus grain, which looks the same and can be explained in
  one sentence.
- The original decides the three layers with the same checkerboard idea
  but slightly different tests; ours are simplified.  The pattern of
  squares is similar, not identical.
- The original computes with the 1990s maths co-processor and 8/16-bit
  integer wraparound everywhere; we use ordinary numbers and wrap only
  where it is visible (the signed palette and the 256-pixel texture).
- Colours are converted from the VGA's 0..63 range to 0..255.

## Go further

- Concept: *polar coordinates* — why `atan2` and `radius` describe a
  circle better than `x` and `y`.
- Concept: *how computers store negative numbers* — the odometer.
- BIBLE chapter 4.4: the tunnel family and its cousins (rotozoom, plasma).
- Next exhibit in this hall: a 256-byte plasma — same palette ideas,
  simpler maths.

## Credits

Original: **tube** by **baze / 3SC**, Syndeecate 2001, 256-byte intro for
MS-DOS.  pouet.net: https://www.pouet.net/prod.php?which=2636  —
3SC: www.3SC.sk.  Thank you, baze, for publishing the source.
Remake: Demoscene Museum, MIT licence.  Educational remake; the original
work belongs to its authors.
