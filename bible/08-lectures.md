# Chapter 8 — Lectures

Every exhibit has ONE `lecture.md`.  The museum's Focus panel renders it
(tabs "Watch", "How it works", "Try"); the GitHub page shows it; your
YouTube video follows its outline.  One source, three uses — so the
format is fixed.

## 8.1 Audience and voice

A 15-year-old who has never programmed, reading on a phone.  Short
sentences.  One idea per paragraph.  No word is used before it is
explained (first use in **bold** with the explanation in the same
sentence).  No assembly, no hardware jargon except in the "Then" card,
where it is a story, not a requirement.  Humour is fine; condescension is
not.  Speak to "you".  Write in English only.

## 8.2 File format

Markdown with a YAML front matter.  Section headings are FIXED (the
Focus panel finds them by name).  Code is quoted from the port files by
function name, never pasted: `{{code python make_palette}}` is replaced
by the museum build with the current function body from
`python/tube.py` (and `java`, `web` likewise), so lecture and code never
drift apart.

```markdown
---
id: tube
video: https://www.youtube.com/watch?v=XXXXXXXX     # optional
readingMinutes: 6
level: beginner            # beginner | intermediate | advanced
concepts: [palette, texture mapping, polar coordinates, feedback]
---
# <Title> — <one-line hook>
## What you see
## Then
## How it works
### Step 1: <verb phrase>
### Step 2: ...
## Try this
## What we changed
## Go further
## Credits
```

Section rules:
- `# Title — hook`: the hook is the one sentence from chapter 4.1 step 1.
- `## What you see` (≤ 60 words): describe the picture/sound as a viewer,
  not as a programmer.  This is the Watch tab's text.
- `## Then` (≤ 120 words): the story.  Who, when, which party, which
  machine, how small, what was remarkable.  One or two hardware facts
  told as story ("256 bytes is less than this paragraph").
- `## How it works`: one `### Step` per function of the port, in the
  order of the main loop.  Each step: 2–5 sentences of idea, then the
  code include, then at most one "note" line.  Steps become the cards of
  the "How it works" tab.  Between 3 and 8 steps.  Every step title is a
  verb phrase ("Build the palette", "Fade the old frame").
- `## Try this`: a bullet list; each bullet names ONE constant that is in
  `exhibit.params`, says what to change it to and what will happen.  The
  museum links bullets to the sliders by constant name.  5–8 bullets.
- `## What we changed`: honest list of deliberate differences from the
  original (chapter 1.4, 4.1 step 5).  Required even if short.
- `## Go further`: 2–4 pointers: a related exhibit, a concept page, the
  BIBLE chapter for the technique, an external article.
- `## Credits`: original authors, group, party, year, links; composer if
  any; "Educational remake, MIT licence; the original work belongs to
  its authors."  Generated from exhibit.json by the build if omitted,
  but may be written by hand to add thanks.

## 8.3 Diagrams

Optional, one per step at most: `![alt text](diagrams/step-3.svg)`.
SVG or PNG under `exhibits/<id>/diagrams/`.  Dark background (#111),
light lines, no text smaller than 14 px.  A diagram must still make
sense if the reader skips it.

## 8.4 Videos

The `video` key embeds a YouTube player in the Watch tab (lazy: the
iframe loads only on tap).  Your video follows the lecture's sections in
order, so viewers can jump between video and text.  Length target: 5–12
minutes per exhibit.  Chapters in the video description = lecture
section names.

## 8.5 Concept pages (shared lessons)

Ideas that recur (palettes, polar coordinates, fixed point, the
oscillator, ADSR, the tracker) are written ONCE in `concepts/<id>.md`
with the same voice and a shorter structure (What it is / Why it matters
/ Example / See it in: list of exhibits).  Lectures link to them; they do
not repeat them.  The museum shows them from the Lobby's "Concepts" wall
and from any lecture link.

## 8.6 Lecture checklist

- [ ] front matter complete; `id` matches the folder
- [ ] fixed headings present and in order
- [ ] every port function appears as a step (names match `exhibit.json` → `functions`)
- [ ] every "Try this" constant exists in `params` with the same name
- [ ] no unexplained term; no assembly
- [ ] "What we changed" is honest and complete
- [ ] read aloud in under `readingMinutes`
- [ ] credits present
