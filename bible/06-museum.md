# Chapter 6 â€” The Museum (web application)

The museum is a first-person walk through a building whose walls carry the
exhibits.  This chapter fixes technology, structure, interaction, layout
and performance so that any agent can build or extend it the same way.

## 6.1 Design principles

1. **The works are the stars.**  Architecture is calm, dark, minimal:
   concrete-grey walls, dark floor, soft ceiling light.  No decoration
   competes with a running exhibit.  Think "modern art gallery at night".
2. **Walk, approach, focus.**  Three states, nothing else to learn.
3. **It must run on a phone.**  Mid-range Android, Safari on iPhone, 60 fps
   target, 30 fps acceptable.  Desktop is the same code with a mouse.
4. **Instant start.**  First paint < 2 s on 4G.  Nothing heavy is loaded
   until the visitor walks toward it.
5. **No account, no tracking, no cookies** except a single localStorage key
   for settings.  It is a public, free museum.
6. **Everything is data.**  Halls, wall positions and exhibits are JSON.
   Adding an exhibit never requires touching engine code.

## 6.2 Technology

| Concern | Choice | Reason |
|---|---|---|
| 3D | Three.js (pinned in `museum/package.json`) | mature, mobile-friendly, `CanvasTexture`/`VideoTexture` do exactly what we need |
| Language | vanilla JavaScript ES modules, no TypeScript, no UI framework | readable by students; the museum itself is also teaching material |
| Build | Vite (dev server + bundling) | zero-config; produces a static folder |
| Styling | one `museum.css`; CSS variables for the palette | small UI |
| Fonts | one monospace (code), one sans (UI), self-hosted | no external requests |
| Audio | WebAudio (AudioWorklet) via `shared/web/audio-host.js` (chapter 5a) | |
| Routing | hash routes: `#/`, `#/hall/256b`, `#/exhibit/tube` | works on a static server, deep-linkable |
| Analytics | none | |

The deployed museum is a **static folder** (`museum/dist/`) served under
`/demoscene-museum/` (chapter 9).  Vite `base` is set to that path.

## 6.3 Source layout

museum/
â”œâ”€â”€ index.html
â”œâ”€â”€ package.json
â”œâ”€â”€ vite.config.js            base: '/demoscene-museum/'
â”œâ”€â”€ public/                   copied as-is: exhibits/, shared/, halls/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ main.js               boot: load catalogue, build world, start loop
â”‚   â”œâ”€â”€ catalogue.js          loads exhibits//exhibit.json + halls/.json
â”‚   â”œâ”€â”€ world/
â”‚   â”‚   â”œâ”€â”€ building.js       builds walls/floors/ceilings from hall JSON
â”‚   â”‚   â”œâ”€â”€ frame.js          one picture frame: quad + label plate + spotlight
â”‚   â”‚   â”œâ”€â”€ lighting.js
â”‚   â”‚   â””â”€â”€ materials.js
â”‚   â”œâ”€â”€ exhibits/
â”‚   â”‚   â”œâ”€â”€ scheduler.js      tier assignment (3.5): Focus / Near / Mid / Poster
â”‚   â”‚   â”œâ”€â”€ live-exhibit.js   runs one module -> CanvasTexture
â”‚   â”‚   â””â”€â”€ worker-host.js    (optional) runs a module in a Web Worker
â”‚   â”œâ”€â”€ controls/
â”‚   â”‚   â”œâ”€â”€ desktop.js        WASD / arrows + mouse-drag look; pointer lock optional
â”‚   â”‚   â”œâ”€â”€ touch.js          left thumb = move, right thumb = look; tap = interact
â”‚   â”‚   â””â”€â”€ collision.js      axis-aligned walls only (no physics library)
â”‚   â”œâ”€â”€ ui/
â”‚   â”‚   â”œâ”€â”€ hud.js            hints, minimap, hall name
â”‚   â”‚   â”œâ”€â”€ focus-panel.js    full-screen exhibit view: player + tabs
â”‚   â”‚   â”œâ”€â”€ code-view.js      syntax-highlighted code with explanation cards
â”‚   â”‚   â””â”€â”€ settings.js       quality, audio volume, invert look, reduce motion
â”‚   â””â”€â”€ util/
â””â”€â”€ museum.css

## 6.4 The building

Halls are rooms connected by doorways on a single floor.  Each hall is a
rectangle; exhibits hang on the walls at eye height.  The visitor is
1.7 m tall; walls are 4 m high; a frame is 2.4 m Ã— 1.8 m (4:3) or
2.4 m Ã— 1.35 m (16:9), centred at 1.6 m.  Frames are â‰¥ 4 m apart.

Hall JSON (`museum/public/halls/<id>.json`):
```json
{
  "id": "256b",
  "name": "The 256-byte Hall",
  "type": "gallery",                  // "gallery" | "listening" | "lobby"
  "size": [20, 12],                   // metres, x and z
  "position": [0, 0],                 // of the hall's corner in world space
  "doors": [ { "wall": "south", "at": 10, "to": "lobby" } ],
  "intro": "Every program in this hall is smaller than this paragraph.",
  "frames": [
    { "exhibit": "tube", "wall": "north", "at": 4 },
    { "exhibit": "...",  "wall": "north", "at": 10 }
  ]
}
wall âˆˆ north/south/east/west; at = metres along that wall.
building.js turns this into geometry; frame.js places frames.  The
catalogue validates that every exhibit id exists and fits its wall.

Mandatory halls at launch:
- Lobby: title wall ("Demoscene Museum"), a one-paragraph "what is the
  demoscene", a controls hint, doorways to the halls.  Also hosts the
  "About / credits / GitHub" plaque.
- The 256-byte Hall (first exhibit: tube).
- Halls are added via roadmap (chapter 11); the lobby's doorways are
  generated from the hall list, so new halls appear automatically.

6.5 Movement and interaction

Three states:

| State | Visitor | Camera | Exhibits |
|---|---|---|---|
| Walk | moves freely | first person, 1.7 m | tiers per 3.5 |
| Approach | within 2.5 m of a frame and facing it (Â±30Â°) | unchanged; frame gets a soft highlight; HUD hint "Tap / press E to view" | the approached frame is Near |
| Focus | pressed E / tapped / clicked | camera glides to face the frame squarely (0.6 s), then the 2D focus panel fades in over the 3D view | Focus tier, audio on |

Desktop: WASD/arrows walk, mouse-drag (or pointer lock after click)
looks, E/Enter/click = focus, Esc = leave focus, M = minimap,
Tab = settings.  Touch: left half of the screen is a virtual stick,
right half drags to look, tap on a frame = focus, double-tap floor = walk
there (auto-walk).  Gamepad: optional, standard mapping.
Collision: walls only, axis-aligned, visitor is a 0.4 m circle.  Doorways
are gaps.  No stairs, no jumping.
Accessibility: prefers-reduced-motion disables head-bob and the
glide; all exhibits are reachable via the hash route and a plain
"List of exhibits" page (#/list) without walking at all.

6.6 Frames and live textures

A frame is: a quad with the exhibit texture, a thin dark border, a small
label plate below (title â€” group â€” year), and one spotlight.
live-exhibit.js:

load module (dynamic import of exhibit.module)
init({quality})  -> OffscreenCanvas/canvas of exhibit.width x height
each scheduled tick: renderFrame(t); indices -> RGBA -> canvas; texture.needsUpdate = true
- Texture uses NearestFilter (crisp pixels), sRGB colour space,
  displayAspect from exhibit.json stretches 320Ã—200 to 4:3.
- When the scheduler demotes to Poster, the material swaps to the
  poster.png texture (or preview.webm as VideoTexture, muted,
  looping); the module is dispose()d.
- Textures for far exhibits are loaded lazily when the visitor enters
  the hall; posters are 320Ã—200 PNG, ~30 KB each.

Scheduler rules are exactly chapter 3.5.  Scheduler ticks run inside the
main requestAnimationFrame; live exhibits are rendered at their tier's
frame cap using accumulated time, not separate timers.

Optional Worker mode: worker-host.js runs a module in a Web Worker and
posts the pixel buffer back (transferable).  Enabled for cost >= 3
exhibits in Near tier so the walk never stutters.

6.7 The Focus panel

Layout (mobile: stacked; desktop: player left â…”, tabs right â…“):

â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                â”‚ tube                                  â”‚
â”‚      exhibit player            â”‚ baze / 3SC Â· 2001                     â”‚
â”‚      (shared/web/exhibit-      â”‚ Syndeecate 2001 Â· 256 bytes Â· MS-DOS  â”‚
â”‚      player.js, quality 1)     â”‚                                       â”‚
â”‚                                â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                   â”‚
â”‚                                â”‚ [Watch][How][Code][Try][Get]          â”‚
â”‚                                â”‚  tab content                          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 âœ• Back to the hall                      â—€ previous | next â–¶

Tabs:
- Watch: the player alone; summary; link to pouet.  If
  lecture.md has a video: front-matter key, an embedded YouTube
  player (lazy iframe, loads only on tap).
- How it works: the lecture's step cards (chapter 8), one card per
  function, with a small diagram image if present.
- Code: tabs Python / Java / JavaScript; syntax highlighted; each
  function is foldable; a card's "show in code" scrolls to the function.
- Try: the sliders from exhibit.params, live on the player; a
  "reset" button; text from the lecture's "Try this" section.
- Get: download buttons (zip of each language folder, built by CI),
  install instructions link (exhibits/README.md), GitHub link.

Keyboard: Esc back, â†/â†’ previous/next exhibit in the hall.

6.8 Listening halls (type: "listening")

For music exhibits (chapter 5d).  Same building code, different wall
content: instead of picture frames the walls carry tracker displays
(the pattern scrolling in real time) and oscilloscope strips (one per
channel).  Audio plays while walking inside the hall â€” this is the one
exception to "audio only in Focus" â€” spatialised with WebAudio
PannerNode so each piece gets louder as you approach it, and at most
TWO songs play at once (closest two; others fade out over 1 s).  Browsers
require a user gesture to start audio: the hall door shows "Tap to enter
with sound".

6.9 Performance budget

- Main thread per frame: â‰¤ 16 ms total; museum rendering â‰¤ 6 ms; live
  exhibits â‰¤ 6 ms combined (scheduler enforces by demotion); UI â‰¤ 1 ms.
- Draw calls: â‰¤ 150 per hall (walls merged into one geometry per hall).
- Textures: posters 320Ã—200; frame label plates are one shared atlas.
- Initial download: â‰¤ 600 KB gzipped excluding exhibit posters.
- Shadows: none (baked ambient + one spotlight per frame, no shadow maps).
- Device pixel ratio capped at 2 (1.5 on phones in Walk state).
- stats.js-style overlay toggled with F3 for development.

6.10 Settings (localStorage dsm.settings)

quality (auto/low/high), master volume, invert look Y, reduce motion,
show fps.  "Low" forces every exhibit one tier lower and DPR 1.

6.11 Definition of done â€” museum milestone 1

- Lobby + 256-byte hall built from JSON, tube hanging live
- Desktop and touch controls; collision; doorways
- Tiers working: walk away â†’ quality 4 â†’ poster; walk up â†’ native
- Focus panel with all five tabs for tube
- Hash routes; #/exhibit/tube opens Focus directly
- 60 fps on a 2022 mid-range phone in the 256-byte hall
- Lighthouse: performance â‰¥ 90 on mobile for index.html
- Builds to museum/dist/ with base: '/demoscene-museum/'
