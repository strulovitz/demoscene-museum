# The Demoscene Museum — BIBLE

This document is the single source of truth for the Demoscene Museum project.

Humans and AI coding agents (OpenCode, Claude Code, etc.) must read the
relevant chapters BEFORE changing anything in this repository.  If the code
and the BIBLE disagree, the BIBLE wins — fix the code, or propose a BIBLE
change in a pull request titled "BIBLE: ...".

Owner: Strulovitz (https://www.strulovitz.org, https://github.com/strulovitz)
Public URL of the museum: https://www.strulovitz.org/demoscene-museum
Repository: https://github.com/strulovitz/demoscene-museum

## Chapters

| # | File | Read it when you... |
|---|------|---------------------|
| 1 | bible/01-vision.md | ...do anything.  Always read this first. |
| 2 | bible/02-repository.md | ...add, move or rename files; choose a library or tool version. |
| 3 | bible/03-exhibit-contract.md | ...port an intro/demo or touch any `exhibits/` folder. |
| 4 | bible/04-graphics-porting.md | ...translate old graphics code (VGA, Amiga, C64). |
| 5 | bible/05-audio-porting.md | ...translate old sound code or write a player/mixer. |
| 6 | bible/06-museum.md | ...work on the 3D museum web app in `museum/`. |
| 7 | bible/07-guide-character.md | ...work on the Boing Ball guide or any dialogue text. |
| 8 | bible/08-lectures.md | ...write or edit a lecture / explanation for an exhibit. |
| 9 | bible/09-deployment.md | ...build, deploy, or change the web server configuration. |
| 10 | bible/10-agent-workflow.md | ...are an AI agent starting a task (prompt recipes + checklists). |
| 11 | bible/11-roadmap.md | ...want to know what to build next. |
| A | bible/A-glossary.md | ...meet an unknown demoscene or hardware term. |
| B | bible/B-x86-cheatsheet.md | ...read 16-bit x86 assembly source of an intro. |

## The ten commandments (summary of chapter 1)

1. We teach TODAY's languages (Python, Java, JavaScript) — never assembly.
2. Every port is a REMAKE for readability, not an emulation of the machine.
3. Every port exists in three languages with the SAME structure and names.
4. Every line a beginner might not understand gets a comment.
5. No "load file, call play()".  Music and graphics are implemented, not loaded.
6. Pure JDK for Java; numpy + pygame-ce (+ sounddevice) for Python;
   vanilla JS + Three.js for the web.  No frameworks beyond that.
7. Credit the original authors on every exhibit, everywhere.
8. The museum must work in a browser on a PC AND on a phone.
9. Downloadable code targets Windows 11 (but must also run on Linux/macOS).
10. Slow is fine for graphics; music must play in real time at good quality.

## For AI agents: how to start a task

1. Read `bible/01-vision.md` and `bible/10-agent-workflow.md`.
2. Read the chapter(s) for the area you will touch (table above).
3. Follow the checklist in chapter 10 for your task type.
4. Never delete or rewrite BIBLE chapters unless the task explicitly says so.
