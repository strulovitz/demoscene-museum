"""
==============================================================================
  TUBE  -  a Python remake of the 256-byte DOS intro "tube" by baze/3SC (2001)
==============================================================================

What you see: you are flying through an endless, rotating tunnel.  One side of
the tunnel is lit, the other is dark.  Three "layers" of the wall texture at
different zoom levels are mixed in a checkerboard pattern, and every frame
leaves a fading trail behind it (motion blur).

The original was written in 256 bytes of assembly language.  This remake is
about 150 lines of Python and does the same thing in a readable way.

You need:   pip install numpy pygame
Run:        python tube.py
Quit:       ESC or close the window

------------------------------------------------------------------------------
HOW IT WORKS, in five steps (each step is one function below)
------------------------------------------------------------------------------
  1. make_palette()    The screen is 320x200 pixels and every pixel is one
                       number from 0..255.  A "palette" says which colour each
                       number means.  (This is how old VGA graphics worked.)
  2. make_texture()    We create a 256x256 picture to paint the tunnel walls.
  3. render_tube()     For EVERY pixel we compute which point of the tunnel
                       wall is visible there, and fetch its brightness from the
                       texture.  This is the heart of the effect.
  4. main()            Copy our pixel numbers to the window.
  5. fade_old_frame()  Divide every pixel by 4, so the next frame is drawn on
                       top of a faint ghost of this one  ->  motion blur.

We use numpy so that step 3 is done for all 51,200 pixels at once instead of
with two slow Python loops.  Every numpy line in render_tube() is written as if
it were about ONE pixel - numpy simply does it for all of them.
"""

import math
import numpy as np

# ----------------------------------------------------------------- constants
WIDTH, HEIGHT = 320, 200    # classic VGA "mode 13h" resolution
TUBE_HEIGHT = 160           # the tunnel is drawn in the middle 160 rows only
TOP = (HEIGHT - TUBE_HEIGHT) // 2    # = 20 empty rows above and below

EYE_DISTANCE = 160          # how far the "screen" is from your eye (zoom)
TEXTURE_SCALE = 41          # 41 ~ 128/pi : one full turn around the tunnel
                            #               = exactly one texture width (256)
ROTATION_SPEED = 0.0238     # radians per frame
SCROLL_SPEED = 8            # texture pixels per frame (flying forward)
FRAMES_PER_SECOND = 30      # the 2001 original ran at roughly this speed


# ============================================================== 1. palette
def make_palette():
    """
    Returns a list of 256 (red, green, blue) tuples, components 0..255.

    The trick of this intro: a pixel value is treated as a SIGNED number,
    i.e. 0..127 are positive and 128..255 are really -128..-1.
        positive  ->  fire colours (dark red -> orange -> yellow)
        negative  ->  cold teal (bright near -127, black near -1)
    So "a bit of light" is red, "a lot of light" is yellow, and when a pixel
    overflows past 127 it flips to teal.  That overflow is the glow effect.
    """
    palette = []
    for index in range(256):
        value = index if index < 128 else index - 256   # 0..127 or -128..-1
        if value >= 0:
            red = 2 * value                 # grows in a straight line
            green = value * value // 64     # grows like a curve (slow, then fast)
            blue = 0
        else:
            strength = -value               # 1..128
            red = 0
            green = min(255, 2 * strength)
            blue = strength
        palette.append((red, green, blue))
    return palette


# ============================================================== 2. texture
def make_texture():
    """
    Returns a 256x256 numpy array of brightness values (about 20..100).

    The texture is wrapped around the inside of the tunnel: column = angle
    around the tunnel, row = distance along it.  It is made of two parts:

      1. LIGHT  - one side of the tunnel is lit, the opposite side is dark.
                  A cosine wave across the columns does exactly that, and it
                  joins up seamlessly where the texture wraps around.
      2. GRAIN  - a little smoothed random noise so the walls look like
                  rough concrete instead of smooth plastic.
    """
    column = np.arange(256)                                      # 0..255
    light = 60 + 30 * np.cos((column - 104) * 2 * np.pi / 256)   # brightest at column 104

    rng = np.random.default_rng(seed=2001)       # fixed seed = same grain every run
    grain = rng.random((256, 256)) - 0.5         # TV static, values -0.5 .. 0.5
    # np.roll shifts the picture one pixel with wrap-around; averaging a pixel
    # with its four neighbours blurs the static a little
    grain = (grain + np.roll(grain, 1, axis=0) + np.roll(grain, -1, axis=0)
                   + np.roll(grain, 1, axis=1) + np.roll(grain, -1, axis=1)) / 5
    grain = 8 * grain                            # now about -2 .. +2

    # light is a 1-D row of 256 values; numpy repeats it for all 256 rows
    return np.round(light + grain).astype(np.int32)


# ============================================================== 3. the tube
# Pixel coordinates, computed once.  x runs -160..159 (0 = screen centre),
# y runs -80..79.  Each is a 160x320 table; meshgrid makes them for us.
X_SCREEN, Y_SCREEN = np.meshgrid(np.arange(-160, 160), np.arange(-80, 80))


def render_tube(angle, scroll, texture):
    """
    Returns a 160x320 array: the brightness the tunnel contributes to every
    pixel this frame (roughly -30 .. +100).

    Think of one pixel.  It sits on a glass screen EYE_DISTANCE in front of
    your eye, at (x, y).  Draw a line from your eye through that pixel: where
    does it hit the tunnel wall?  The tunnel has radius 1 around the Z axis, so:
        angle around the tunnel   = atan2(x, y)           -> texture column u
        distance along the tunnel = z / sqrt(x^2 + y^2)   -> texture row v
    (Points near the screen centre look far away: small x,y -> big v.)
    Before that we rotate the whole scene so the tunnel turns and bends.
    """
    c, s = math.cos(angle), math.sin(angle)
    x, y, z = X_SCREEN, Y_SCREEN, EYE_DISTANCE

    # rotation 1: spin around the Z axis (the direction you are looking)
    x1 = x * c + y * s
    y1 = y * c - x * s
    # rotation 2: turn around the Y axis (look left/right) - this bends the tube
    x2 = x1 * c + z * s
    z2 = z * c - x1 * s

    radius = np.sqrt(x2 * x2 + y1 * y1)
    radius = np.maximum(radius, 0.001)              # avoid dividing by zero

    u = np.round(TEXTURE_SCALE * np.arctan2(x2, y1)).astype(np.int64)
    v = np.round(TEXTURE_SCALE * z2 / radius)
    v = np.clip(v, -32768, 32767).astype(np.int64)  # the centre pixel is "infinitely" far

    # Three layers, chosen by a checkerboard test on the texture coordinates.
    #  & 64  looks at one bit of the number: it flips every 64 texture pixels,
    #  so (u + v) & 64 gives diagonal squares.  Each layer is a different zoom
    #  of the same texture and a different darkness (-5, -16, -48).
    layer1 = ((u + v + scroll) & 64) == 0
    layer2 = ((4 * u - 4 * v - scroll) & 128) == 0

    colour1 = texture[(v + scroll) & 255, u & 255] - 5                # zoom 1x
    colour2 = texture[(4 * v + scroll) & 255, (4 * u) & 255] - 16     # zoom 4x
    colour3 = texture[(8 * v + scroll) & 255, (8 * u) & 255] - 48     # zoom 8x

    return np.where(layer1, colour1, np.where(layer2, colour2, colour3))


# ============================================================== 5. the fade
def wrap_to_signed_byte(values):
    """Keep numbers in -128..127, wrapping around like a car odometer
    (127 + 1 becomes -128).  Old computers did this for free; we do it on
    purpose because the wrap-around is what makes the hot spots flash teal."""
    return (values + 128) % 256 - 128


def fade_old_frame(pixels):
    """Divide by 4 (keeping the sign).  Repeated every frame this makes
    every drawn image fade out over ~3-4 frames = the motion blur trail."""
    return pixels >> 2        # >> 2 means 'shift right by 2 bits' = divide by 4


# ============================================================== 4. show it
def main():
    import pygame                               # imported here so that the
    pygame.init()                               # maths above works without it
    window = pygame.display.set_mode((WIDTH * 3, HEIGHT * 3))
    pygame.display.set_caption('tube - baze/3SC 2001 - Python remake  (ESC quits)')
    clock = pygame.time.Clock()

    palette = make_palette()
    texture = make_texture()
    pixels = np.zeros((TUBE_HEIGHT, WIDTH), dtype=np.int32)   # the tunnel area
    screen = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)        # the whole screen
    angle, scroll = 0.0, 0

    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT or (
               event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                running = False

        # --- draw this frame ON TOP of the faded previous one
        angle += ROTATION_SPEED
        scroll += SCROLL_SPEED
        pixels = wrap_to_signed_byte(pixels + render_tube(angle, scroll, texture))

        # --- copy to the window (the palette turns numbers into colours)
        screen[TOP:TOP + TUBE_HEIGHT] = pixels & 255        # -1 -> 255 etc.
        surface = pygame.image.frombuffer(screen.tobytes(), (WIDTH, HEIGHT), 'P')
        surface.set_palette(palette)
        # convert() applies the palette: 1 byte per pixel -> real RGB colours,
        # in the same format as the window.  Then stretch it to window size.
        rgb_surface = surface.convert()
        big_surface = pygame.transform.scale(rgb_surface, window.get_size())
        window.blit(big_surface, (0, 0))      # blit = copy one image onto another
        pygame.display.flip()

        # --- prepare for the next frame
        pixels = fade_old_frame(pixels)
        clock.tick(FRAMES_PER_SECOND)

    pygame.quit()


if __name__ == '__main__':
    main()