---
## Part 7 â€” `bible/07-guidance.md`

Short, since the mascot is gone, but it fixes the *voice* of the museum
so every agent writes UI text the same way.

```markdown
# Chapter 7 â€” Visitor guidance and UI text

There is no mascot or guide character (decision 2026-11).  The museum
speaks through short on-screen text.

## 7.1 Voice

- Plain, warm, brief.  One sentence where possible.  No exclamation marks
  in hints; enthusiasm belongs to the works.
- Second person ("Walk closer to start it").  Never "the user".
- Technical words appear only inside lectures, where they are explained.
- English only.  No translations.

## 7.2 Hints (HUD, bottom centre, fade after 4 s)

| Moment | Text |
|---|---|
| first visit | "Drag to look. WASD or arrows to walk." / touch: "Left thumb walks, right thumb looks." |
| entering a hall | hall `name` + `intro` (one line) |
| Approach | "Press E to view" / "Tap to view" |
| Focus with audio | "Sound on â€” tap the speaker to mute" |
| listening hall door | "Tap to enter with sound" |
| exhibit failed to load | "This work couldn't start on your device. Showing a recording." |

## 7.3 Panel copy

- Label plates: `title` â€” `group` â€” `year`.  Nothing else.
- Focus header: title, authors / group Â· year, party Â· category Â· platform.
- Every Focus panel ends with: "Educational remake. The original work
  belongs to its authors." + pouet link.

## 7.4 Lobby texts (fixed, editable only via BIBLE change)

Title wall: "Demoscene Museum".  Subtitle: "Real-time art, remade so you
can read it."  Paragraph: the 1.2 "why it exists" condensed to â‰¤ 60 words.
About plaque: founder credit, GitHub link, MIT notice.