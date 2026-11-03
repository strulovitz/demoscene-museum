/*
 * shared/web/examples/fm-audio.js  --  a small FM synthesizer with a step
 * sequencer (BIBLE chapter 5b).  Audio module for audio-host.js.
 *
 * ONE formula makes the sound:   sin(carrierPhase + modIndex * sin(modulatorPhase))
 * See fm_synth.py for the full explanation.  Same structure and names:
 * noteToFrequency, Instrument, Voice, Sequencer, FmSynth.
 *
 * Runs inside the AudioWorklet: no document, no window, no console.log.
 */

const STEPS_PER_BEAT = 4;        // 16th notes
const STEPS_PER_PATTERN = 16;    // one bar of 4/4

/** MIDI note number -> Hz.  69 = A4 = 440 Hz; a semitone is a factor 2^(1/12). */
function noteToFrequency(note) {  return 440 * Math.pow(2, (note - 69) / 12);}

/** The recipe for a sound.  Just numbers; `Object.assign` fills in overrides. */
class Instrument {
  constructor(overrides = {}) {
    this.ratio = 1.0;        // modulator frequency / carrier frequency
    this.modIndex = 2.0;     // how much the modulator wobbles the carrier (brightness)
    this.modDecay = 0.3;     // seconds for the brightness to fade
    this.attack = 0.005; this.decay = 0.3; this.sustain = 0.5; this.release = 0.15;   // ADSR
    this.pitchDrop = 0.0;    // > 0: start higher and slide down (drums)
    this.volume = 0.3;
    this.pan = 0.0;          // -1 left, 0 centre, +1 right
    Object.assign(this, overrides);
  }
}

/** One note being played by one instrument. */
class Voice {
  constructor(inst, note, gate, sampleRate) {
    this.inst = inst;
    this.frequency = noteToFrequency(note);
    this.gate = gate;                  // seconds until the "key is lifted"
    this.sampleRate = sampleRate;
    this.samplesDone = 0;
    this.phaseCarrier = 0;
    this.phaseMod = 0;
    this.finished = false;
  }

  /** Produce ONE sample. */
  nextSample() {
    const inst = this.inst;
    const t = this.samplesDone / this.sampleRate;             // seconds since note start
    const freq = this.frequency * (1 + inst.pitchDrop * Math.exp(-t / 0.05));
    const modIndex = inst.modIndex * Math.exp(-t / inst.modDecay);
    const wave = Math.sin(this.phaseCarrier + modIndex * Math.sin(this.phaseMod));
    let env = t < inst.attack
      ? t / inst.attack
      : inst.sustain + (1 - inst.sustain) * Math.exp(-(t - inst.attack) / inst.decay);
    const released = Math.max(t - this.gate, 0);              // 0 while the key is held
    env *= Math.exp(-released / inst.release);
    this.phaseCarrier += 2 * Math.PI * freq / this.sampleRate;
    this.phaseMod += 2 * Math.PI * freq * inst.ratio / this.sampleRate;
    if (this.phaseCarrier >= 2 * Math.PI) this.phaseCarrier -= 2 * Math.PI;
    if (this.phaseMod >= 2 * Math.PI) this.phaseMod -= 2 * Math.PI;
    this.samplesDone++;
    if (t > this.gate + 7 * inst.release) this.finished = true;   // inaudible by now
    return wave * env * inst.volume;
  }
}

/** Tempo + one 16-step pattern per channel (MIDI notes, 0 = rest). */
class Sequencer {
  constructor(bpm, channels) {
    this.bpm = bpm;
    this.channels = channels;          // [{ instrument, pattern }, ...]
    this.step = 0;
  }

  secondsPerStep() { return 60 / this.bpm / STEPS_PER_BEAT; }

  tick(synth) {
    this.channels.forEach(({ instrument, pattern }, ch) => {
      const note = pattern[this.step % pattern.length];
      if (note > 0) synth.noteOn(ch, instrument, note, this.secondsPerStep() * 0.75);
    });
    this.step = (this.step + 1) % STEPS_PER_PATTERN;
  }
}

/** The whole instrument: what audio-host.js needs (fill, setParam, getPosition). */
class FmSynth {
  constructor(sampleRate, sequencer) {
    this.sampleRate = sampleRate;
    this.sequencer = sequencer;
    this.voices = new Array(sequencer.channels.length).fill(null);
    this.samplesToNextStep = 0;
  }

  noteOn(channel, inst, note, gate) {
    this.voices[channel] = new Voice(inst, note, gate, this.sampleRate);   // replaces the old note
  }

  fill(left, right) {
    for (let i = 0; i < left.length; i++) {
      if (this.samplesToNextStep === 0) {                     // sample-accurate sequencer
        this.sequencer.tick(this);
        this.samplesToNextStep = Math.floor(this.sequencer.secondsPerStep() * this.sampleRate);
      }
      let l = 0, r = 0;
      for (let ch = 0; ch < this.voices.length; ch++) {
        const v = this.voices[ch];
        if (!v) continue;
        const s = v.nextSample();
        const pan = v.inst.pan;                                // constant-power panning
        l += s * Math.sqrt((1 - pan) / 2);
        r += s * Math.sqrt((1 + pan) / 2);
        if (v.finished) this.voices[ch] = null;
      }
      left[i] = l;
      right[i] = r;
      this.samplesToNextStep--;
    }
  }

  setParam(name, value) {
    if (name === 'BPM') this.sequencer.bpm = value;
    if (name === 'LEAD_MOD_INDEX') this.sequencer.channels[1].instrument.modIndex = value;
  }

  getPosition() { return { step: this.sequencer.step }; }
}

function makeDemoSong() {
  const bass = new Instrument({ ratio: 1, modIndex: 3, modDecay: 0.15, decay: 0.2, sustain: 0.3, release: 0.1 });
  const lead = new Instrument({ ratio: 2, modIndex: 1.5, modDecay: 0.4, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2, volume: 0.25, pan: 0.3 });
  const kick = new Instrument({ ratio: 1, modIndex: 0.5, modDecay: 0.05, decay: 0.12, sustain: 0, release: 0.05, pitchDrop: 3, volume: 0.5 });
  return new Sequencer(125, [
    //                        1   .   .   .   2   .   .   .   3   .   .   .   4   .   .   .
    { instrument: bass, pattern: [33,  0, 33,  0, 36,  0, 33,  0, 31,  0, 31,  0, 33,  0, 36,  0] },
    { instrument: lead, pattern: [57,  0, 60, 64,  0, 64,  0, 62, 60,  0, 57,  0, 55,  0, 57,  0] },
    { instrument: kick, pattern: [36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0, 36] },
  ]);
}

export default {
  create(sampleRate) {
    return new FmSynth(sampleRate, makeDemoSong());
  },
};