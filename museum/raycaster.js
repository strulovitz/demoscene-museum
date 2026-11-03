/*
 * museum/raycaster.js  --  the museum's 3D engine (BIBLE chapter 6; technique: 4.4 "raycasting").
 *
 * This is the same idea that drew Wolfenstein 3D in 1992: the world is a grid of
 * square cells.  For every COLUMN of the screen we shoot one ray from the eye
 * into the grid, walk it cell by cell until it hits a wall, and draw a vertical
 * strip whose height is  screenHeight / distance.  That is the whole trick.
 * Exhibits are wall cells that carry a "frame": inside the frame we sample the
 * exhibit's own pixel buffer instead of the concrete texture, so the works hang
 * on the walls and run live.
 *
 * An exhibit may show ONE picture on all four faces (a graphics work), or FOUR
 * different pictures, one per face (a music pillar: one channel per side).
 * Pictures are either palette-indexed (pixels + lut) or ready RGB (rgba).
 *
 * No DOM here: render() fills a Uint32Array of pixels.  museum.js shows it.
 */

export const W = 320, H = 240;          // internal resolution (4:3, square pixels)
const TEX = 64;                         // wall texture size
const SHADES = 32;                      // brightness levels for the wall texture
const FRAME_U0 = 0.10, FRAME_U1 = 0.90; // the frame spans this part of the wall's width...
const FRAME_H = (FRAME_U1 - FRAME_U0) * 3 / 4;        // ...and is 4:3 like a DOS screen
const FRAME_V0 = 0.5 - FRAME_H / 2, FRAME_V1 = 0.5 + FRAME_H / 2;
const BORDER = 0.03;                    // dark border around the frame
const rgb = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;   // little-endian ABGR

/**
 * Turn ASCII-art rows into a map.  '#' wall, '.' floor, 'S' start,
 * letters A..Z = wall cells with a picture frame (exhibits).
 */
export function parseMap(rows) {
  const height = rows.length, width = rows[0].length;
  const solid = new Uint8Array(width * height);
  const letters = new Map();
  let start = { x: 1.5, y: 1.5 };
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const c = row[x];
      if (c === '#') solid[y * width + x] = 1;
      else if (c >= 'A' && c <= 'Z') { solid[y * width + x] = 1; letters.set(c, { x, y }); }
      else if (c === 'S') start = { x: x + 0.5, y: y + 0.5 };
    }
  });
  return { width, height, solid, letters, start, isSolid: (x, y) => x < 0 || y < 0 || x >= width || y >= height || solid[y * width + x] === 1 };
}

/** Procedural concrete: seeded noise, blurred, with faint horizontal joints. */
export function makeWallTexture(seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  let n = new Float32Array(TEX * TEX);
  for (let i = 0; i < n.length; i++) n[i] = rnd();
  for (let pass = 0; pass < 2; pass++) {
    const m = new Float32Array(TEX * TEX);
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const at = (xx, yy) => n[((yy + TEX) % TEX) * TEX + ((xx + TEX) % TEX)];
      m[y * TEX + x] = (at(x, y) + at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1)) / 5;
    }
    n = m;
  }
  const tex = new Uint32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    let v = 95 + (n[y * TEX + x] - 0.5) * 50;
    if (y % 32 === 0) v -= 25;                                  // joint between concrete slabs
    v = Math.max(0, Math.min(255, v));
    tex[y * TEX + x] = rgb(v | 0, v | 0, (v * 1.05) | 0);
  }
  return tex;
}

export class Raycaster {
  constructor(map) {
    this.map = map;
    this.image = new Uint32Array(W * H);
    this.plane = 0.66;                                          // half-width of the camera plane (FOV about 66 degrees)
    this.centerHit = null;                                      // what the middle column looked at (for "Press E")
    // wall texture at SHADES brightness levels, so shading costs one lookup per pixel
    const base = makeWallTexture();
    this.wallShaded = [];
    for (let l = 0; l < SHADES; l++) {
      const f = (l + 1) / SHADES, t = new Uint32Array(TEX * TEX);
      for (let i = 0; i < t.length; i++) {
        const c = base[i];
        t[i] = rgb(((c & 255) * f) | 0, (((c >> 8) & 255) * f) | 0, (((c >> 16) & 255) * f) | 0);
      }
      this.wallShaded.push(t);
    }
    // ceiling and floor: one colour per row, darker towards the horizon (cheap fog)
    this.ceilRow = new Uint32Array(H); this.floorRow = new Uint32Array(H);
    for (let y = 0; y < H / 2; y++) {
      const d = 1 - y / (H / 2);                                // 1 at the top edge, 0 at the horizon
      this.ceilRow[y] = rgb((14 * d) | 0, (14 * d) | 0, (18 * d) | 0);
      this.floorRow[H - 1 - y] = rgb((40 * d) | 0, (38 * d) | 0, (36 * d) | 0);
    }
    this.borderColor = rgb(18, 18, 20);
  }

  /** Fog: how bright a wall is at this distance (0..1). */
  shade(dist, side) {
    let s = 1.3 / (1 + dist * 0.45);
    if (side === 1) s *= 0.75;                                  // walls facing east/west a bit darker: fake lighting
    return Math.max(0.08, Math.min(1, s));
  }

  /**
   * player: { x, y, dirX, dirY }
   * exhibits: Map "x,y" -> picture source.  A source is either
   *   { pixels, width, height, lut: [Uint32Array x4] }     palette-indexed, or
   *   { rgba, width, height }                               ready colours, or
   *   { faces: [source, source, source, source] }           one source per face (west, north, east, south)
   * Fills this.image.  Sets exhibit.seen = true for exhibits hit by any ray.
   */
  render(player, exhibits) {
    const { map, image } = this;
    const planeX = -player.dirY * this.plane, planeY = player.dirX * this.plane;
    this.centerHit = null;
    for (let col = 0; col < W; col++) {
      // ---- 1. the ray for this column
      const cameraX = 2 * col / W - 1;                          // -1 (left edge) .. +1 (right edge)
      const rayX = player.dirX + planeX * cameraX;
      const rayY = player.dirY + planeY * cameraX;
      // ---- 2. walk the grid (DDA): always step into the next cell boundary, x or y, whichever is nearer
      let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
      const deltaX = Math.abs(1 / rayX), deltaY = Math.abs(1 / rayY);
      const stepX = rayX < 0 ? -1 : 1, stepY = rayY < 0 ? -1 : 1;
      let sideX = rayX < 0 ? (player.x - mapX) * deltaX : (mapX + 1 - player.x) * deltaX;
      let sideY = rayY < 0 ? (player.y - mapY) * deltaY : (mapY + 1 - player.y) * deltaY;
      let side = 0, guard = 0;
      while (guard++ < 256) {
        if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
        else { sideY += deltaY; mapY += stepY; side = 1; }
        if (map.isSolid(mapX, mapY)) break;
      }
      // ---- 3. distance (perpendicular, so walls stay straight) and strip height
      const dist = side === 0 ? sideX - deltaX : sideY - deltaY;
      const lineH = H / Math.max(dist, 0.0001);
      const top = H / 2 - lineH / 2;
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H, Math.floor(top + lineH));
      // ---- 4. where on the wall did we hit (0..1 across the cell)
      const hitAlong = side === 0 ? player.y + dist * rayY : player.x + dist * rayX;
      let wallX = hitAlong - Math.floor(hitAlong);
      // for the concrete texture: oriented so the texture does not mirror between faces
      let texU = wallX;
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texU = 1 - texU;
      // for pictures: oriented so it increases towards the VIEWER'S RIGHT (text must read left to right)
      let faceU = wallX;
      if ((side === 0 && player.dirX < 0) || (side === 1 && player.dirY > 0)) faceU = 1 - faceU;
      const sh = this.shade(dist, side);
      const tex = this.wallShaded[Math.min(SHADES - 1, (sh * SHADES) | 0)];
      const texX = (texU * TEX) | 0;
      const exhibit = exhibits.get(mapX + ',' + mapY);
      let face = null;
      if (exhibit) {
        exhibit.seen = true;
        const faceIndex = side === 0 ? (rayX > 0 ? 0 : 2) : (rayY > 0 ? 1 : 3);   // 0 west, 1 north, 2 east, 3 south
        face = exhibit.faces ? exhibit.faces[faceIndex] : exhibit;
      }
      if (col === W >> 1) this.centerHit = { x: mapX, y: mapY, dist, exhibit: exhibit || null };
      // ---- 5. draw the column: ceiling, wall strip (frame or concrete), floor
      for (let y = 0; y < y0; y++) image[y * W + col] = this.ceilRow[y];
      const inFrameU = face && faceU > FRAME_U0 && faceU < FRAME_U1;
      const inBorderU = face && faceU > FRAME_U0 - BORDER && faceU < FRAME_U1 + BORDER;
      const exLut = face && face.lut ? face.lut[Math.min(3, ((1 - sh) * 4) | 0)] : null;   // screens glow: only 4 fog levels
      const exCol = face ? Math.min(face.width - 1, (((faceU - FRAME_U0) / (FRAME_U1 - FRAME_U0)) * face.width) | 0) : 0;
      for (let y = y0; y < y1; y++) {
        const v = (y - top) / lineH;                            // 0 at the wall's top, 1 at its foot
        let c;
        if (inFrameU && v > FRAME_V0 && v < FRAME_V1) {
          const exRow = Math.min(face.height - 1, (((v - FRAME_V0) / FRAME_H) * face.height) | 0);
          const idx = exRow * face.width + exCol;
          c = face.rgba ? face.rgba[idx] : exLut[face.pixels[idx]];
        } else if (inBorderU && v > FRAME_V0 - BORDER && v < FRAME_V1 + BORDER) {
          c = this.borderColor;
        } else {
          c = tex[((v * TEX) | 0) * TEX + texX];
        }
        image[y * W + col] = c;
      }
      for (let y = y1; y < H; y++) image[y * W + col] = this.floorRow[y];
    }
  }
}
