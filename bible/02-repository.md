# Chapter 2 â€” Repository, tooling and conventions

## 2.1 RESET INSTRUCTION (one-time, do this first)

The repository https://github.com/strulovitz/demoscene-museum currently
contains an abandoned earlier attempt (a decompilation experiment using
"Reverse Engineer Anything").  It is NOT to be reused.

Procedure for the agent/human doing the reset:

1. `git rm -r .` on a fresh clone (keep `.git/`), commit as
   "Reset: remove abandoned decompilation attempt (see BIBLE chapter 2)".
2. Create the layout in 2.2.  Commit `BIBLE.md` and `bible/` first.
3. Add `exhibits/tube/` (the reference exhibit) next.
4. Only then start `museum/`.

## 2.2 Layout

demoscene-museum/
â”œâ”€â”€ BIBLE.md          entry point (chapter 0)
â”œâ”€â”€ bible/            chapters 01..11, A, B
â”œâ”€â”€ README.md         short public description + link to the museum
â”œâ”€â”€ LICENSE           MIT for our code (see 2.6)
â”œâ”€â”€ exhibits/         ONE folder per ported work
â”‚   â””â”€â”€ tube/
â”‚       â”œâ”€â”€ exhibit.json        metadata (see chapter 3)
â”‚       â”œâ”€â”€ lecture.md          the explanation (see chapter 8)
â”‚       â”œâ”€â”€ original/           original source + readme, UNMODIFIED, with credits
â”‚       â”œâ”€â”€ python/tube.py      single file when possible
â”‚       â”œâ”€â”€ java/Tube.java      single file when possible
â”‚       â””â”€â”€ web/tube.js         ES module implementing the exhibit contract
â”œâ”€â”€ museum/           the web app (chapter 6)
â”‚   â”œâ”€â”€ index.html
â”‚   â”œâ”€â”€ src/          JS modules: engine, halls, guide, ui
â”‚   â”œâ”€â”€ assets/       models, textures, fonts, guide sprites
â”‚   â””â”€â”€ halls/        one JSON per hall: which exhibits hang where
â”œâ”€â”€ shared/           code shared by exhibits (see 2.5 â€” keep tiny)
â”‚   â”œâ”€â”€ python/
â”‚   â”œâ”€â”€ java/
â”‚   â””â”€â”€ web/
â”œâ”€â”€ tools/            build & check scripts
â””â”€â”€ .github/workflows/  CI: lint, build, deploy (chapter 9)

Rules:
- An exhibit folder is SELF-CONTAINED for the student: `python/tube.py` must
  run alone after `pip install numpy pygame-ce`; `java/Tube.java` must run
  alone with `java Tube.java`.  If shared code is needed, it is COPIED into
  the exhibit, not imported from `shared/` (students download one folder).
  `shared/` holds the canonical copy; `tools/check_shared.py` verifies the
  copies are identical.
- The web version MAY import from `shared/web/` (it is served from our site).
- Nothing in `museum/` knows the name of any exhibit.  It only reads
  `exhibits/*/exhibit.json` and `halls/*.json`.

## 2.3 Naming

- Folder names: lower-case, hyphens: `tube`, `vex-intro`, `second-reality`.
- Python: `snake_case` functions and variables, `UPPER_CASE` constants,
  file `tube.py`.
- Java: `camelCase` methods, `UPPER_CASE` constants, class = file =
  `Tube.java`, one public class, no packages (so `java Tube.java` works).
- JavaScript: `camelCase`, `UPPER_CASE` constants, ES modules, file
  `tube.js`, default export = the exhibit object (chapter 3).
- The SAME concept has the SAME name in all three languages, modulo case:
  `make_palette` / `makePalette` / `makePalette`.
- Comments and documentation are in English.  (Hebrew/other UI translations
  of the museum are a future roadmap item, chapter 11.)

## 2.4 Tool versions (what students install; what CI tests)

| Tool | Version | Notes |
|---|---|---|
| Python | 3.13 (64-bit) | 3.12â€“3.15 also work.  Install from python.org, TICK "Add python.exe to PATH". |
| numpy | latest 2.x | `pip install numpy` |
| pygame-ce | latest 2.5.x | `pip install pygame-ce`.  Imported as `import pygame`.  Never install `pygame` and `pygame-ce` together. |
| sounddevice | latest | only in exhibits with audio; `pip install sounddevice` |
| Java | 21 or newer (25 LTS recommended) | Any JDK: Adoptium Temurin, Microsoft Build of OpenJDK, Oracle.  Run with `java File.java`. No Maven/Gradle, no libraries. |
| Browser | current Edge/Chrome/Firefox/Safari, desktop and mobile | WebGL2 + AudioWorklet required for the museum. |
| Three.js | pinned version in `museum/package.json` | the only JS dependency of the museum. |
| Node.js | current LTS | ONLY for building the museum (bundling); students never need it. |

Install instructions for students are written ONCE in `exhibits/README.md`
and linked from every lecture â€” never duplicated per exhibit.

## 2.5 Libraries: allowed and forbidden

Allowed, by language:
- Python: standard library, numpy, pygame-ce, sounddevice.  Nothing else
  without a BIBLE change.
- Java: the JDK only (java.awt, javax.swing, javax.sound.sampled,
  javax.sound.midi).  No external jars, ever.
- JavaScript (exhibits): nothing.  Vanilla ES2020+, Canvas 2D, WebAudio
  (AudioWorklet), optionally WebGL2 for exhibits that need it.
- JavaScript (museum): Three.js, and build tooling (Vite).  No UI framework
  (no React/Vue/etc.) â€” the museum UI is small and we want it readable.

Forbidden in exhibits: anything that does the artistic work for us â€”
module players (libopenmpt, pygame.mixer.music), FM synth libraries, shadertoys,
image-processing libraries.  The point is to implement these.

## 2.6 Licensing and credits

- OUR code (ports, museum, lectures): MIT License, copyright Strulovitz and
  contributors.
- ORIGINAL works: copyright remains with their authors.  Demoscene
  productions are traditionally freely distributed and many were released
  with source, but that is not a licence.  Policy:
  1. Prefer works whose source was published by the authors.
  2. Always keep the original source and readme unmodified in `original/`.
  3. Credit author(s), group, party, year, and a pouet.net link in
     `exhibit.json`, in the lecture, in the museum panel, and in the header
     comment of every ported file.
  4. State in every ported file: "This is an educational remake, not the
     original work."
  5. Where an author can be reached, ask.  Record the answer in
     `exhibit.json` (`permission`: "granted" / "requested" / "unknown").
  6. If an author asks for removal, remove within 48 hours, no debate.
- Music: if an exhibit contains a tracker song or samples, the same rules
  apply to the musician, separately credited.
- The Amiga Boing Ball: the checkered red-and-white bouncing ball from the
  1984 Amiga demo by Dale Luck and R.J. Mical.  Our guide is an original
  cartoon character inspired by it, NOT the Amiga logo; do not use Amiga
  trademarks or logos.

## 2.7 Git workflow

- `main` is always deployable.  Work on branches named
  `exhibit/<name>`, `museum/<topic>`, `bible/<topic>`.
- Commit messages: imperative, prefixed: `exhibit(tube): add Java port`,
  `museum: mobile joystick`, `bible: chapter 5 audio`.
- Every exhibit PR must tick the checklist in chapter 10 (all three
  languages run, lecture exists, credits present, exhibit.json valid).
- Generated files (bundles) are not committed; CI builds them (chapter 9).

## 2.8 Quality bar for a port (summary; details in chapter 3)

A port is "done" when a motivated 15-year-old with no help can:
1. install the tool using `exhibits/README.md`,
2. run the file and see/hear the effect,
3. read the file top to bottom and follow the story,
4. find the "Try this" constants and change them with a visible result,
5. open the lecture and understand each function in one card.
