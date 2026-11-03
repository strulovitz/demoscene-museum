Part 5c is the heart of the music side. Same flat format: save the first block as bible/05c-mod-replayer.md, the code files to the paths in their headers. All three players are complete programs that play a built-in test song (built in memory, in MOD format, so the parser is exercised even without a file) and can also play any 4-channel .mod you download from modarchive.org.

I verified the Python version numerically in my sandbox (parsed the in-memory MOD, rendered 20 seconds: no NaN, peak 0.71, all four channels audible, tone-portamento/vibrato/arpeggio/volume-slide code paths all executed), and ran the JavaScript version under Node with the same checks. Java is reviewed carefully but not compiled (no JDK in my sandbox), as before.
# Chapter 5c — Building a MOD replayer, step by step

This chapter teaches the thing that made demoscene music possible: the tracker module.  We implement a complete ProTracker MOD player in each language (`shared/python/mod_player.py`, `shared/java/ModPlayer.java`, `shared/web/examples/mod-audio.js`).  Later tracker formats (XM, S3M, IT) are extensions of the same ideas (5c.11).

## 5c.1 Why MOD, and why first

In 1987 Karsten Obarski wrote "Ultimate Soundtracker" for the Amiga; the Amiga's sound chip (Paula) had four channels that each played an 8-bit sample at a chosen speed and volume.  The MOD format is a direct picture of that hardware: up to 31 samples, four channels, patterns of 64 rows.  ProTracker (1990) became the standard editor; tens of thousands of songs exist (modarchive.org has 150,000+, mostly free to listen and study).  MOD is first because it is the simplest format that is still real music, it is fully documented, and the player fits in ~300 readable lines.

## 5c.2 What is in the file

Everything is big-endian (most significant byte first — the Amiga's CPU was a Motorola 68000).  Offsets in bytes:

- 0 .. 19      song title, 20 ASCII characters, padded with zeros
- 20 .. 949    31 sample headers, 30 bytes each:
  - 22 bytes  sample name
  - 2 bytes   length in WORDS (multiply by 2 for bytes)
  - 1 byte    finetune, low 4 bits, signed: 0..7 = 0..+7, 8..15 = -8..-1
  - 1 byte    volume 0..64
  - 2 bytes   loop start in words
  - 2 bytes   loop length in words; 0 or 1 (= 0 or 2 bytes) means "no loop"
- 950          song length: how many entries of the order list are used (1..128)
- 951          restart position (historical; ignore)
- 952 .. 1079  order list: 128 bytes, each a pattern number.  The song is
               "play pattern orders[0], then orders[1], ..." — patterns repeat.
- 1080 .. 1083 signature: "M.K." or "M!K!" = 4 channels; "6CHN", "8CHN" = 6, 8
               channels; "xxCH" = xx channels.  (Very old 15-sample files
               have no signature; we do not support them.)
- 1084 ..      pattern data.  Number of patterns = highest number in the
               order list + 1.  Each pattern = 64 rows x channels cells x 4 bytes.
- after that   sample data: all samples one after another, signed 8-bit,
               in header order.

## 5c.3 One cell = 4 bytes

A cell is what the tracker shows as e.g. `C-2 01 C20` (note, sample, effect).  Decoding the four bytes b0 b1 b2 b3:

    sample = (b0 & 0xF0) | (b2 >> 4)       high nibble from b0, low from b2
    period = ((b0 & 0x0F) << 8) | b1       12 bits
    effect = b2 & 0x0F
    param  = b3

- `period` is the PITCH (5c.4); 0 means "no new note on this row".
- `sample` 1..31 means "use this instrument (and reset volume to its default)"; 0 means "keep the current one".
- A row can have a note without a sample (re-trigger the current instrument), a sample without a note (just change instrument/volume), an effect alone, or nothing.

## 5c.4 Pitch: Amiga periods

The Amiga did not store frequencies; it stored the number of clock ticks between two output samples, the "period".  Playback rate in Hz:

    rate = 3546895 / period          (PAL Amiga; AMIGA_CLOCK in the code)

The note table (period for each note; lower period = higher pitch):

    C-1 856  C#1 808  D-1 762  D#1 720  E-1 678  F-1 640  F#1 604  G-1 570  G#1 538  A-1 508  A#1 480  B-1 453
    C-2 428  C#2 404  D-2 381  D#2 360  E-2 339  F-2 320  F#2 302  G-2 285  G#2 269  A-2 254  A#2 240  B-2 226
    C-3 214  C#3 202  D-3 190  D#3 180  E-3 170  F-3 160  F#3 151  G-3 143  G#3 135  A-3 127  A#3 120  B-3 113

C-2 (period 428) plays the sample at 8287 Hz: that is the rate at which most Amiga samples were recorded, so C-2 is "the sample as recorded".  One octave up halves the period.  A semitone multiplies the period by 2^(-1/12); finetune moves in eighths of a semitone, so we multiply the period by 2^(-finetune/96).  Pitch slides (effects 1, 2, 3) change the period by a fixed amount per tick — which means they are NOT musically linear; that quirk is part of the sound.

Resampling: to play a sample recorded at `rate` through our output at `sampleRate`, we advance through its data by `step = rate / sampleRate` positions per output sample (for C-2 at 44100: 0.188 — we read about one sample value for every five we output).  Fractional positions are interpolated linearly between the two nearest values (the Amiga did not interpolate; it sounded rawer.  Students' "Try this": remove the interpolation and hear the difference).

## 5c.5 Time: ticks, rows, speed, tempo

The clock has three levels:

- TICK: the heartbeat.  Default 50 per second (the Amiga's PAL screen refresh).  All effects (slides, vibrato) step once per tick.
  - tempo ("BPM", default 125):  tick length in seconds = 2.5 / BPM
  - samples per tick = sampleRate * 2.5 / BPM  (= 882 at 44100, 125 BPM)
- ROW: `speed` ticks (default 6).  New notes are read at tick 0 of a row.  Default: 50/6 = 8.33 rows per second = 0.12 s per row.
- PATTERN: 64 rows (7.68 s at default speed); then the next order entry.

Effect Fxx sets speed (xx < 32) or BPM (xx >= 32).  "Speed 3" doubles the row rate; that is how fast drum rolls were done.

## 5c.6 The mixer

For every output sample, for every channel that is playing:

    value = sample.data[position] (interpolated)
    position += step
    if looping and position >= loopEnd: position -= loopLength
    else if position >= length: channel stops
    output += value * (volume / 64) * channelGain

Panning: the Amiga wired channels 1 and 4 to the left speaker and 2 and 3 to the right ("LRRL").  Hard panning is tiring on headphones; we use 70 % separation (pan -0.7 / +0.7) with the same constant-power formula as the FM synth (`gainLeft = sqrt((1 - pan) / 2)`).  Modules with more than four channels repeat the LRRL pattern.

Levels: samples are -128..127, scaled to -1..1; channel volume 0..64 is scaled to 0..1; `channelGain = 2 / numberOfChannels` keeps a 4-channel and an 8-channel module about equally loud; the host's master volume (0.5) comes on top.

Loop handling detail: we store each sample as float32 with ONE extra value appended (the loop-start value for looping samples, 0 for others) so that interpolation can always read `data[index + 1]` without bounds checks.  Looping samples are truncated to `loopEnd`; the data after the loop end is never heard anyway.

## 5c.7 The player loop

    fill(frames):
        while frames remain:
            if samplesUntilTick == 0:  doTick();  samplesUntilTick = samplesPerTick
            n = min(remaining, samplesUntilTick)
            mix n samples from every channel
            samplesUntilTick -= n

    doTick():
        if tick == 0:  processRow()        read the cells of the current row
        else:          processTickEffects()  slides, vibrato, volume slides...
        for each channel: playbackPeriod = period + vibrato + arpeggio
        tick += 1
        if tick == speed:  tick = 0;  advanceRow()   (handles Bxx jumps / Dxx breaks)

Rows start exactly on tick boundaries inside the block, not at block boundaries: that is why `fill` splits the block at the next tick.  Python mixes each channel's `n` samples as one numpy expression; Java and JavaScript mix one sample at a time.

## 5c.8 Effects (what the reference player implements)

Effects are hexadecimal: `Exy` means effect E with x = high nibble, y = low nibble of the parameter.  "Tick 0" = when the row starts; "ticks 1+" = every later tick of the row.

- 0xy  Arpeggio: ticks cycle note, note+x, note+y semitones -> a fast
       "chord" on one channel.  (Ticks 0+.)
- 1xx  Slide up: period -= xx per tick (ticks 1+), floor 113.
- 2xx  Slide down: period += xx per tick (ticks 1+), ceiling 856.
- 3xx  Tone portamento: slide towards the new note by xx per tick instead
       of jumping to it.  xx = 0 reuses the last speed.  The note in the
       cell becomes the TARGET; the sample does not restart.
- 4xy  Vibrato: x = speed, y = depth; the period wobbles by
       2 * depth * sin(2*pi*pos/64), pos += speed per tick.  0 reuses.
- 5xy  Tone portamento (remembered speed) + volume slide xy.
- 6xy  Vibrato (remembered) + volume slide xy.
- 9xx  Sample offset: start the sample at xx * 256 bytes.
- Axy  Volume slide: +x per tick, or -y per tick (ticks 1+), 0..64.
- Bxx  Position jump: after this row continue at order xx, row 0.
- Cxx  Set volume: 0..64 (0x40).
- Dxx  Pattern break: after this row continue at the next order, row xx
       (xx is written in DECIMAL in trackers: D16 = row 16).
- E1x  Fine slide up (tick 0 only).    E2x  Fine slide down.
- EAx  Fine volume up (tick 0).         EBx  Fine volume down.
- ECx  Note cut: volume to 0 at tick x.
- EDx  Note delay: start the note at tick x instead of tick 0.
- Fxx  Set speed (xx < 32, ticks per row) or tempo (xx >= 32, BPM).

Not in the reference player (add when an exhibit needs them, keep names):
7xy tremolo (volume wobble, like vibrato), 8xx panning (not ProTracker), E0x filter (Amiga hardware low-pass on/off), E3x glissando control, E4x/E7x waveform select, E5x set finetune, E6x pattern loop, E9x retrigger note every x ticks, EEx pattern delay, EFx invert loop.

## 5c.9 Build order (for a student or an agent writing one from scratch)

Each stage is testable on its own; do not start the next before the previous one sounds right.

1. Parse the header and print: title, sample names/lengths/loops, song length, number of patterns, channel count.  Compare with a tracker or with modarchive's info page.
2. Parse the patterns; print pattern 0 as text (`C-2 01 000 | ...`).
3. Load the samples; play sample 1 at C-2 through the host as a loop.  You should hear the instrument.
4. The clock: speed/tempo, rows, orders.  Trigger notes with no effects.  The song is recognisable now.
5. Volume effects: Cxx, Axy, EAx, EBx, ECx.
6. Pitch effects: 1xx, 2xx, 3xx, 4xy, 5xy, 6xy, 0xy.
7. Flow: Bxx, Dxx, Fxx, EDx, 9xx.  Then the optional list.

## 5c.10 The reference implementation and the test song

All three files share: `parseMod` (bytes -> Song), data classes `Sample`, `Cell`, `Song`, `Channel`, the `ModPlayer` with `fill`, `doTick`, `processRow`, `processTickEffects`, `playbackPeriod`, `advanceRow`, and `makeTestMod()`.

`makeTestMod()` WRITES a small MOD file into memory: four synthesized instruments (a 64-byte sawtooth loop for bass, a 32-byte triangle loop for lead, a noise burst for snare, a falling sine for kick) and one pattern using C, A, 3, 4, 0 and F effects.  It is the mirror image of `parseMod` and doubles as a lesson in the format.  With no file given, the players play this song; with a file, they play the file.

Web: the AudioWorklet cannot read files.  The PAGE loads the `.mod` as an ArrayBuffer and sends it with `audio.setParam('MOD_DATA', buffer)`; the synth replaces its song.  For exhibits, `exhibit.json` gets `"audio": { "module": "web/<id>-audio.js", "data": "original/<song>.mod" }` and the museum performs the fetch + setParam.  `getPosition()` returns `{ order, pattern, row, speed, bpm, channels: [{ volume, period, sample }] }` for the pattern displays and oscilloscopes of chapter 5d.

Where to get modules for testing: modarchive.org (filter "ProTracker", 4 channels).  Respect each song's licence; for exhibits, only the song that belongs to the original work, credited to its composer.

## 5c.11 Beyond MOD

- S3M (Scream Tracker 3, 1994, PC): up to 32 channels, per-channel panning, instrument C-4 rate instead of periods, volume column.
- XM (FastTracker II, 1994, PC): 32 channels, instruments with volume and panning ENVELOPES, 16-bit samples, linear frequency table (semitones are linear — slides sound even), packed pattern data.
- IT (Impulse Tracker, 1995): new-note actions, resonant filters, sample compression, 64 channels with virtual voices.

All keep the same skeleton: samples + patterns + a tick clock + a mixer.  Porting a 64k intro with XM music means: parse XM, add envelopes and the linear table to `Channel`, and the rest of this chapter applies.

## 5c.12 Checklist for a module-playing exhibit

- [ ] song file in `original/` with composer credit in exhibit.json and lecture
- [ ] player code is the shared one, copied; exhibit-specific additions
      listed in the lecture
- [ ] the effects actually used by the song are all implemented (run
      `tools/mod-effects.py <file>` to list them)
- [ ] no clicks at note starts beyond what the original has; no underruns
- [ ] `getPosition()` works (listening-hall displays depend on it)
- [ ] graphics synchronised to the audio clock (5a.7), beat events taken
      from the row counter, not from elapsed time
What to expect when you run them: a four-bar loop — a sawtooth bass that slides down at the end of each bar, a triangle lead with vibrato, then a minor-chord arpeggio, then a fade; a kick on every beat and a snare/hi-hat pattern. All three should sound the same (the drum noise is generated by the same simple formula in all three, so even the snare is identical). Then download any 4-channel ProTracker .mod from modarchive.org and try python mod_player.py song.mod, java ModPlayer.java song.mod, or the file picker in the browser page. If a particular song sounds wrong, tell me which one — it's most likely an effect from the "not implemented" list in 5c.8, and that's a good exhibit-driven reason to add it.

Next part: 5d — the listening halls: how a music exhibit looks on a wall (the scrolling pattern view, per-channel oscilloscopes driven by getPosition() and a small sample-tap in the host), the exhibit.json for a music-only exhibit, spatial audio between neighbouring songs, and the music category hall JSON. After that, chapter 4 (graphics porting reference) and chapter 8 (the lecture format, with tube/lecture.md as the worked example).