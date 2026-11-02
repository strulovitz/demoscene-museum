# Chapter 5a — The modern audio model

Audio is not an afterthought in this museum.  Chapters 5a–5d are the
largest part of the BIBLE.  This chapter is the foundation: how a program
produces sound on a modern computer, and the ONE structure every exhibit
with sound must follow in all three languages.

## 5a.1 Then and now, in one paragraph each

THEN (DOS, 1990s).  The program allocated a block of memory (the "DMA
buffer") and told the sound card: "play these bytes, over and over".  The
card read the buffer by itself (DMA = direct memory access).  Each time it
reached the middle or the end of the buffer, it raised a hardware interrupt
(IRQ); the program's interrupt routine then quickly refilled the half of
the buffer the card had just finished.  Gravis Ultrasound cards did more:
they mixed up to 32 voices in hardware, so the program only uploaded
samples and wrote "voice registers" (start, loop, pitch, volume).

NOW (Windows/Linux/macOS/browser).  The operating system owns the sound
card.  Our program gives the OS a FUNCTION ("the callback") and says: "call
me whenever you need more sound".  The OS calls it, typically every 5–25
milliseconds, with an empty buffer of a few hundred or thousand frames; we
fill it and return.  Nothing else changed: the "refill half the buffer in
the IRQ" job is exactly the "fill the buffer in the callback" job.  Mixing
is always done in software by us.

Mapping of old ideas to new ones:
- DMA buffer           -> the buffer the callback receives
- IRQ "half finished"  -> the callback being called (or a blocking write returning)
- mixing routine       -> our fill() function
- SB DSP "set rate"    -> SAMPLE_RATE constant / stream settings
- GUS voice registers  -> our Voice objects inside a software mixer (chapter 5c)
- Adlib OPL2 registers -> our software FM synth (chapter 5b)
- PC speaker timer     -> a square-wave oscillator in fill() (chapter 5b)

## 5a.2 Vocabulary (used in every audio file; link to the glossary)

- sample: one number = the position of the loudspeaker cone at one instant.
  We use float32 in the range -1.0 .. +1.0 internally, always.
- sample rate: how many samples per second per channel.  We use 44100 Hz
  as default; the host may ask for 48000 — code must read the real rate.
- frame: one sample for EVERY channel at the same instant (stereo frame =
  left sample + right sample).  Buffer sizes are counted in frames.
- channel: left, right.  We always produce stereo (mono exhibits write the
  same value into both).
- block / buffer: the chunk of frames we fill in one call (256–2048).
- latency: the delay between computing a sample and hearing it, roughly
  (buffer frames / sample rate) times the number of buffers queued.
  Target: under 50 ms.  Students will not notice 100 ms.
- clipping: a value outside -1..+1 that gets cut off — sounds harsh.
  Always clamp at the very end; mixers scale voices so this is rare.
- phase: where an oscillator is in its cycle, 0 .. 2*pi.  The classic
  formula, written as code:
      phase = phase + 2 * pi * frequency / sampleRate     (per sample)
      if phase >= 2 * pi: phase = phase - 2 * pi
  Never compute sin(2*pi*f*t) from an absolute time t that grows for
  minutes; the floating-point error grows with it.  Accumulate phase.

## 5a.3 The binding structure: synth and host

Every exhibit with sound has TWO parts in each language:

1. The SYNTH (or mixer, or player): a plain object with ONE job:
   `fill(left, right)` — write `left.length` frames into the two arrays.
   It knows nothing about the operating system, threads, devices or the
   browser.  It is the artistic part; it is what the lecture explains; it
   is the part that differs per exhibit (FM synth, MOD player, ...).
2. The HOST: the plumbing that gets the OS to call `fill` on time.  It is
   IDENTICAL for every exhibit in a given language and is copied from
   `shared/<lang>/` (rule 2.2: student downloads are self-contained).
   Students never need to read it, but it is commented so they can.

Rules:
- `fill` must be cheap and must never block (no file reading, no printing,
  no memory allocation in Python/Java inner loops, no DOM access in JS).
- `fill` must always produce exactly the requested number of frames.
  Silence is zeros, not "return early".
- The synth reads the sample rate from `create(sampleRate)` / its
  constructor, never from a hard-coded 44100 in the middle of a formula.
- All state (phase, song position, envelopes) lives inside the synth
  object so the same code can be started twice (the museum re-inits).
- The synth may expose `setParam(name, value)` for the "Try" sliders and
  `getPosition()` (e.g. pattern/row) for displays (chapter 5d).  Both are
  optional and must be thread-safe in the simplest way: write a number,
  read a number; never pass objects between threads.

## 5a.4 Python host: sounddevice + numpy

Library: `sounddevice` (PortAudio).  `pip install sounddevice`.
Pygame's mixer is NOT used for synthesis (it plays files; we implement).

How it works: `sd.OutputStream(callback=...)` opens the device; PortAudio
calls our callback from its own thread with `outdata` (a numpy array of
shape (frames, 2), float32).  We ask the synth for `frames` frames and copy
into `outdata`.  In Python, per-sample loops are too slow for real time
(44100 iterations per second per channel is the limit of what CPython does
comfortably while also drawing graphics) — therefore Python synths are
written in numpy, operating on whole blocks: build an array of phases for
the block, apply the waveform to the whole array.  Chapter 5c shows how a
MOD mixer does this per voice with `np.interp`-style indexing.

Reference host: `shared/python/audio_host.py` (file below).  Exhibit usage:
```python
from audio_host import start_audio, SAMPLE_RATE   # copied next to the exhibit
synth = MySynth(SAMPLE_RATE)
stream = start_audio(synth)        # returns immediately; audio runs in background
... pygame loop ...
stream.stop(); stream.close()
```

## 5a.5 Java host: javax.sound.sampled.SourceDataLine

Java has no callback API; instead we WRITE to a line and the write BLOCKS
until there is room.  That blocking is our clock.  A dedicated thread
loops: `synth.fill(left, right)` -> convert to 16-bit little-endian bytes
-> `line.write(bytes)`.  Format: 44100 Hz, 16-bit, stereo, signed, little
endian.  Open the line with a buffer of about 4 blocks (for 1024-frame
blocks: 1024 * 4 bytes * 4 = 16384 bytes) for roughly 90 ms latency; it
can be reduced later.  Java's JIT makes per-sample loops fast, so Java
synths are written as plain nested loops — the easiest version to read.
Mark the thread as daemon so the program exits when the window closes.

Reference host: the `AudioHost` nested class in `SineTest.java` (file
below).  In an exhibit, copy the nested class into the exhibit's single
Java file unchanged.

## 5a.6 JavaScript host: WebAudio AudioWorklet

The browser's real-time path is the AudioWorklet: our code runs on the
audio thread in a `process(inputs, outputs)` method that is called with
128-frame blocks (the spec's render quantum; newer browsers may use other
sizes — never assume 128).  Two consequences:
- The synth code runs in a separate global scope (no `document`, no
  `window`, and no dynamic `import()`); it talks to the page by messages.
- Browsers refuse to start audio before a user gesture (click/tap).  The
  museum therefore starts the AudioContext from the Focus tap or the
  "Tap to enter with sound" door (chapter 6.8).

Audio module interface (`exhibits/<id>/web/<id>-audio.js`):
```js
export default {
  create(sampleRate) {
    // return the synth object
    return {
      fill(left, right) { /* write left.length frames */ },
      setParam(name, value) { /* optional */ },
      getPosition() { /* optional: { pattern, row } etc. */ }
    };
  }
};
```

The host (`shared/web/audio-host.js`, file below) builds a tiny worklet
processor at runtime that statically imports the exhibit's audio module,
calls `create(sampleRate)` (sampleRate is a global in the worklet scope)
and forwards `fill`.  Params go page -> worklet via `port.postMessage`;
position goes worklet -> page the same way, about 30 times a second.

Fallback: if `audioWorklet` is unavailable (very old browsers), the host
schedules `AudioBufferSourceNode`s on the main thread, 4096 frames each,
keeping three queued.  Same synth code, slightly more latency.

## 5a.7 Synchronising picture and sound

The audio clock is the master.  When an exhibit has audio, the player and
the museum pass `audioContext.currentTime - startTime` (JS), the stream's
time (Python: `stream.time`), or frames written / sample rate (Java) as
the `t` for `renderFrame(t)`.  Never the wall clock: audio devices drift
from it by a few milliseconds per minute, and effects that flash on the
beat would slowly slide.  Music-visualising exhibits read
`synth.getPosition()` instead of guessing the beat from time.

## 5a.8 Pitfalls that every port must avoid

- Clicks: any jump in the waveform clicks.  Starting or stopping a voice
  must ramp volume over at least 64 frames (1.5 ms).  Chapter 5c mixers
  apply a "declick" ramp when a sample starts or a note is cut.
- Clipping: sum of N voices at full volume is N times too loud.  Mixers
  scale by 1/N or use a master gain of about 0.5, then clamp.
- Underruns: `fill` took too long -> the OS plays silence/garbage
  ("crackle").  Fix the synth, do not enlarge the buffer first.  Python:
  move the work into numpy; Java: avoid allocation inside loops; JS: no
  `console.log` in `process`.
- Denormals / NaN: never divide by zero in envelopes; guard with
  max(x, 1e-9).
- Sample rate assumptions: a pitch table built for 44100 sounds wrong at
  48000.  Build tables from the real rate in `create`/constructor.
- Threads: the synth runs on another thread/scope.  Share only numbers;
  copy arrays, never hand over mutable objects.
- Loudness: default master volume 0.5; the museum's settings volume
  multiplies on top (GainNode in JS, a float in Python/Java hosts).

## 5a.9 Test: play a sine wave in each language

Before writing any synth, the host is verified with a 440 Hz sine:
`shared/python/sine_test.py`, `shared/java/SineTest.java`,
`shared/web/examples/sine-audio.js` + `sine.html`.  A new machine or a
new agent starts by running these three.  If the sine plays cleanly for
10 seconds with no clicks, the host is good and every later problem is in
the synth.

## 5a.10 Definition of done for an exhibit's audio

- [ ] `hasAudio: true` in exhibit.json; `web/<id>-audio.js` exists
- [ ] synth code has no OS/DOM/thread calls; `fill` always fills
- [ ] host code is a verbatim copy of `shared/<lang>/`
- [ ] plays 10 minutes with no clicks or underruns on a 2020 laptop
- [ ] identical synth structure and names in all three languages
- [ ] master volume 0.5; sliders for exhibit params via setParam
- [ ] graphics use the audio clock (5a.7)