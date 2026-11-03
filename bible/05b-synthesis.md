# Chapter 5b — Synthesis: PC speaker, Adlib/OPL2 FM, MIDI

Small intros (256 bytes to 4 KB) rarely contain recorded samples: there is
no room.  Their sound comes from one of three sources, all of which we
re-implement as software SYNTHS behind the `fill(left, right)` interface of
chapter 5a.  This chapter explains each source, how to recognise it in an
original's code, and how to port it.  The reference implementation is a
small FM synth with a step sequencer (`shared/*/fm_synth*`), which also
serves as the museum's "General MIDI-lite" instrument set (5b.5).

## 5b.1 The one idea behind all synthesis: the oscillator

Every tone is a shape that repeats `frequency` times per second.  In code
an oscillator is a `phase` that advances by `2*pi*frequency/sampleRate`
each sample and wraps at `2*pi`, plus a function of the phase:

    sine:     sin(phase)
    square:   phase < pi ? +1 : -1
    sawtooth: phase / pi - 1
    triangle: 2 * abs(phase / pi - 1) - 1
    noise:    random.next() * 2 - 1        (ignores phase)

A NOTE adds an ENVELOPE: the loudness over time.  We use ADSR:
attack (seconds to reach full volume), decay (seconds to fall towards the
sustain level), sustain (level held while the key is down), release
(seconds to fade after the key is lifted).  Written as code, with t =
seconds since the note started and tOff = seconds at which it was released:

    if t < A:  env = t / A
    else:      env = S + (1 - S) * exp(-(t - A) / D)
    if t > tOff:  env = env * exp(-(t - tOff) / R)

Pitch from a MIDI note number n (69 = A4 = 440 Hz; one semitone = a
factor of 2^(1/12)):

    frequency = 440 * 2 ** ((n - 69) / 12)

These five lines (oscillator, waveforms, ADSR, note-to-frequency) appear in
every synth in the museum, with these exact names: `phase`, `envelope`,
`noteToFrequency` / `note_to_frequency`.

## 5b.2 The PC speaker

Hardware: a tiny loudspeaker driven by one bit.  Timer chip 8253 channel 2
produces a square wave whose frequency is 1193182 / divisor; port 61h bits
0–1 turn it on and off.  That is all: ONE square wave, ON or OFF, no
volume.

How to recognise it in source: `out 42h`, `out 43h, 0B6h`, `in al,61h`,
`or al,3`, `and al,0FCh`, the constant 1193180 or 1193182, or the magic
`mov al,0B6h`.

What intros did with it:

- Melodies: change the divisor every N frames -> one square wave at a time.
- "Chords": switch between 2–3 notes very fast (arpeggio, 50–100 Hz) so
  the ear hears all of them.
- Drums: random divisors for a few milliseconds = noise.
- Volume illusion: turn the speaker on and off faster than audible (PWM) —
  rare in intros, ignore unless the original does it.

Port rule: a `SquareVoice` with `frequency` and `gate` (on/off); the
sequencer logic of the original (which note at which frame) is ported as
written.  Output level 0.25 (a square wave is loud).  Because our speaker
is a real one, apply a tiny low-pass (average each sample with the previous
one) so the result sounds like a PC speaker in a case, not a 1-bit alarm.

Students' "Try this": change the waveform function to sawtooth — the same
melody suddenly sounds like a different machine.

## 5b.3 Adlib / Sound Blaster FM (Yamaha OPL2, YM3812)

Hardware: 9 channels, each with 2 operators (sine oscillators with
envelopes).  In the default "FM" connection, operator 1 (the MODULATOR)
wobbles the phase of operator 2 (the CARRIER):

    output = sin(phaseCarrier + modIndex * sin(phaseModulator))

That single formula is the entire sound of 1990s PC games and most
early-1990s intros.  A low `modIndex` gives a soft, flute-like tone; a high
one gives a bright, metallic or buzzy tone; making `modIndex` decay over
time (its own envelope) makes notes start bright and turn mellow, exactly
like a plucked string or a slap bass.  Ratios between the operators'
frequencies choose the character: 1:1 = sawtooth-ish/bass, 1:2 = hollow
square-like, 1:3.5 or non-integer = bells.  The chip also offered an
alternative "additive" connection (outputs added instead), feedback on the
modulator, and (OPL2) four waveform shapes: sine, half-sine, absolute
sine, pulsed sine.

How to recognise it in source: ports 388h/389h (Adlib) or 220h/221h
(Sound Blaster) written in pairs (register index, then value), a delay
loop after each write (the chip was slow), and tables of bytes written to
registers 20h–35h, 40h–55h, 60h–75h, 80h–95h, A0h–A8h, B0h–B8h, C0h–C8h,
E0h–F5h.

Register meaning, in the words we need (operator registers come in two
slots per channel; the offsets are irregular, see appendix B):

- 20h+: tremolo on/off, vibrato on/off, "sustaining" (envelope holds at
  sustain while key down vs. keeps decaying), key-scale-rate, and the
  frequency MULTIPLIER (0..15 -> x0.5, x1, x2, ... x15).  -> our `ratio`.
- 40h+: total level (0 = loudest, 63 = silent, in 0.75 dB steps) and
  key-scale-level.  For the modulator this is the `modIndex` (louder
  modulator = brighter sound); for the carrier it is the note volume.
- 60h+: attack rate (high nibble) and decay rate (low nibble), 0..15.
  Higher = faster.  Rough conversion for our seconds-based ADSR:
  attack seconds ~ 0.0001 * 2^(15 - rate) ... capped at ~2 s; decay similar.
  Exactness does not matter — tune by ear to match the original.
- 80h+: sustain LEVEL (high nibble, 0 = loud .. 15 = silent, 3 dB steps)
  and release rate (low nibble).
- A0h+/B0h+: frequency number (10 bits) + block (octave) + KEY-ON bit.
  Frequency in Hz = fnum * 49716 / 2^(20 - block).  Key-on going 0->1 is
  "note on"; 1->0 is "note off" (release phase).
- C0h+: feedback (modulator modulates itself, 0..7) and connection
  (0 = FM, 1 = additive).
- E0h+: waveform select (OPL2 only).
- BDh: rhythm mode — 5 hardwired percussion sounds (bass drum, snare,
  tom, cymbal, hi-hat) using channels 7–9.  Intros often use it for
  drums.  We port it as three FM percussion instruments (5b.6).

Port rule: do NOT emulate the chip.  Read the register table in the
original, write down per instrument: ratio of modulator to carrier,
modulator level (-> modIndex 0..8), carrier ADSR, modulator decay,
feedback (if 0, ignore; else add feedback term, 5b.6), connection, and
waveform.  Put these numbers into `Instrument` objects.  Then port the
original's SEQUENCER (what note on which channel at which frame) as-is.
Tune by ear comparing with the original running in DOSBox.

## 5b.4 MIDI (MPU-401, General MIDI, Roland MT-32/Sound Canvas)

Hardware: the PC sent note messages through port 330h to an external
synth module; the module made the sound.  So the original did NOT
synthesize anything — it only sequenced.  How to recognise: `out 330h`,
`out 331h`, bytes like 90h/80h (note on/off), C0h (program change), and
instrument numbers 0–127.

Port rule — the one exception to "we implement, we do not load":

- Java: `javax.sound.midi` includes a software General MIDI synth
  (Gervill) with instrument sounds.  Because the original also used an
  external instrument box, using the JDK's synth as the "box" is honest.
  The SEQUENCER (timing, notes, program changes) is still ported by us as
  code, never by loading a .mid file.  (`MidiSystem.getSynthesizer()`,
  `getChannels()[c].noteOn(note, velocity)`.)
- Python and JavaScript have no built-in GM synth.  They use our FM
  synth with the GM-lite instrument table (5b.5).  It will not sound like
  a Sound Canvas; it will sound like a 1991 Adlib playing the MIDI — and
  the lecture says so.  (A student project: improve the instruments.)
- If the original's music exists as a recording made by the authors on
  the real module, the lecture may embed it for comparison; the exhibit
  itself still plays our version.

## 5b.5 The reference FM synth (`shared/*/fm_synth*`)

Files: `shared/python/fm_synth.py`, `shared/java/FmSynth.java`,
`shared/web/examples/fm-audio.js` (+ `fm.html`).  Each is a complete
program: it plays a 4-bar loop with bass, lead and kick drum.  Structure,
identical in all three:

- `note_to_frequency(n)` / `noteToFrequency(n)`
- `Instrument`: ratio, modIndex, modDecay, attack, decay, sustain,
  release, pitchDrop, volume, pan.  Plain data.
- `Voice`: one playing note: instrument, frequency, phases, samples since
  note on, gate length.  Method `render(...)` produces its sound using the
  FM formula and the ADSR; a voice is `finished` when its release is done.
- `Sequencer`: tempo, a list of channels each with a 16-step pattern of
  MIDI note numbers (0 = rest), and `tick()` which starts voices.
- `FmSynth`: owns the voices and the sequencer; `fill(left, right)`
  advances the sequencer at exact sample positions (not block boundaries)
  and mixes the voices with constant-power panning.

GM-lite: a dictionary mapping a few General MIDI program numbers to
`Instrument`s lives in the same file (`GM_LITE`).  Extend as exhibits
need.

Implementation note per language: Python renders each voice as numpy
arrays for a whole segment (phase via cumulative sum, envelope via
vectorised exp); Java and JavaScript render per sample.  Same formulas.

## 5b.6 Extensions an exhibit may need (add to the shared synth, keep names)

- feedback: `modOut = sin(phaseMod + feedback * lastModOut)`; store
  `lastModOut` in the voice.
- additive connection: `output = sin(phaseCarrier) + modLevel * sin(phaseMod)`.
- waveforms: `half_sine = max(sin(p), 0)`, `abs_sine = abs(sin(p))`,
  `pulse_sine = (p mod pi) < pi/2 ? abs(sin(p)) : 0` (period halves).
- vibrato: `frequency * (1 + depth * sin(2*pi*rate*t))`, depth ~0.005.
- percussion: kick = sine with `pitchDrop`; snare = sine with pitchDrop
  plus noise with a 0.15 s exponential decay; hi-hat = noise, 0.05 s decay.
- arpeggio (PC speaker chords): the Sequencer switches a voice's frequency
  every k samples among the chord notes.

## 5b.7 Porting checklist for a synthesized soundtrack

- [ ] Identify the source: speaker (ports 42h/61h), OPL2 (388h/220h),
      MIDI (330h), or sample mixer (chapter 5c).
- [ ] Extract the instrument table into `Instrument` objects, with a
      comment per instrument naming the original register values.
- [ ] Port the sequencer logic literally (same note numbers, same timing
      in frames or ticks -> converted to samples via sampleRate).
- [ ] Sync the picture to the audio clock (5a.7).
- [ ] Tune by ear against DOSBox; note deliberate differences in the
      lecture.
- [ ] Sliders: tempo, modIndex of the lead, and one waveform choice are
      the standard "Try this" parameters for synth exhibits.