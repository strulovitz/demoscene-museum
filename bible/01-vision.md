# Chapter 1 — Vision

## 1.1 What this is

The Demoscene Museum is a website you WALK THROUGH.  It is a 3D building,
rendered in the visitor's browser, with halls and rooms.  On the walls hang
works of art — demos and intros from the demoscene, running live, in real
time, re-implemented in modern programming languages.  When the visitor
walks up to a work, it fills the screen; they can watch it, learn how it was
made, read the code with explanations, change a number and see what happens,
and download the code to run and modify at home.

A guide — an anthropomorphic Amiga Boing Ball — rolls along with the visitor
and explains things in plain language.

## 1.2 Why it exists

The demoscene is a computer-art subculture born in the 1980s: small groups
("groups") of programmers, graphicians and musicians competing to produce the
most impressive real-time audiovisual program within absurd limits — 256
bytes, 4 kilobytes, 64 kilobytes, or the hardware of a 1985 home computer.
It was declared intangible cultural heritage in Finland (2020), Germany
(2021), the Netherlands, Poland and Switzerland.  It is also, quietly, one of
the great engineering schools of the last forty years: many of today's game,
graphics and embedded engineers started because one demo on one evening made
them say "HOW did they do that?".

The founder of this museum had exactly that evening with "VeX-InTrO" by
Cubic Team — specifically its Lissajous curves — and later became a
professional programmer (IDF electronic-warfare unit, then Elbit Systems).
The museum exists to give today's young people the same evening, but with
today's languages, so that the curiosity leads somewhere immediately: a
Python or Java or JavaScript file they can change and run tonight.

## 1.3 Who it is for

Primary audience: ages ~12–20, who may never have programmed, or who know a
little Python/Java/JavaScript from school.  They own a Windows 11 PC at home
(we also support Linux and macOS) and a smartphone.  They have never seen a
DOS prompt and do not know what a "palette" is.  Everything is written for
them.

Secondary audiences: teachers looking for material; old sceners looking for
nostalgia; AI coding agents that will extend the museum (they need precise
rules — hence this BIBLE).

## 1.4 What we are NOT doing

- We are NOT teaching assembly language or the 1990s hardware for its own
  sake.  The old hardware appears only as "the story", in a sentence or two.
- We are NOT building an emulator.  DOSBox exists.  Our ports are REMAKES:
  the same visual/audio idea, written the way a good modern beginner's
  program would be written.
- We are NOT faithful bit-for-bit.  If the original uses a left-over
  register value as a random seed, we use a random number generator with a
  fixed seed and a comment.  If the original's texture is "random bytes
  blurred", and a cosine wave plus noise looks the same, we use the cosine
  wave, because it is explainable in one sentence.
- We are NOT hiding the art behind libraries.  `music.load("x.mod");
  music.play()` teaches nothing.  We implement the mixer / synth ourselves on
  top of the lowest-level audio API each platform offers (see chapter 5).

## 1.5 The three languages

Every exhibit is ported THREE times, with identical structure and identical
function/variable names:

| Language | Role | Why |
|---|---|---|
| JavaScript | Runs INSIDE the museum, in the browser.  Zero install. | It is the only language that can live on a museum wall. |
| Python | Download-and-tinker version #1 | The most common first language today. |
| Java | Download-and-tinker version #2 | Zero dependencies; `java Tube.java` runs a file with no compile step. |

Because all three share structure and names, one lecture explains all three,
and a student can read the Python and the Java side by side — which is itself
a lesson about how languages differ.

## 1.6 Teaching principles (binding)

1. **One idea per function.**  A port is a list of 4–8 functions, each doing
   one recognisable thing (make the palette, make the texture, draw one
   frame, fade the old frame...).  The main loop reads like a recipe.
2. **Explain before you show.**  Each file begins with a plain-language
   description of what the viewer sees and a numbered list of the steps.
3. **Comment the WHY, name the WHAT.**  `EYE_DISTANCE = 160  # zoom` beats
   `d = 160`.  A comment explains why a line exists, the name says what it is.
4. **Every magic number is a named constant** at the top of the file, and
   the "Try this" section of the lecture tells the student which ones to
   change and what will happen.
5. **No cleverness.**  If a shorter or faster version is harder to read, the
   longer one wins.  Speed is irrelevant for graphics (10 s per frame is
   acceptable in Python if the alternative is unreadable); speed matters
   only for audio, and only to the degree needed for real-time playback.
6. **Honest about hardware tricks.**  Where the ORIGINAL effect genuinely
   depends on a hardware behaviour (signed-byte wraparound, palette
   cycling), we reproduce it ON PURPOSE with a named helper
   (`wrap_to_signed_byte`) and a comment — this becomes a teaching moment
   about how computers store numbers, not an obscure side effect.
7. **Respect.**  Every exhibit names the original authors, group, year and
   party, links to the original (pouet.net / the group's site), and makes
   clear that the remake is an educational tribute, not the original work.

## 1.7 The experience we want (one visitor, one visit)

A 15-year-old opens strulovitz.org/demoscene-museum on her phone.  A lobby.
A red-and-white checkered ball with eyes rolls up: "Hi!  I'm the guide.
Swipe to look around, tap the floor to walk.  Let's start in the 256-byte
hall — every program in here is smaller than this sentence."  She walks to
the first frame on the wall; a tunnel is spinning in it.  She taps it.  It
fills the screen.  A panel slides up: what she is seeing in two sentences,
a short video, and three buttons: "How it works", "Show me the code", and
"Download (Python / Java / JavaScript)".  "How it works" is five cards, one
per function.  Under the code there is a slider labelled EYE_DISTANCE; she
drags it and the tunnel becomes a fisheye.  She downloads the Python
version.  That evening she changes `>> 2` to `>> 1` and the trails become
long.  That is the whole mission.
