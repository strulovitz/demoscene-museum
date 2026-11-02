/*
 * shared/web/examples/sine-audio.js  --  the simplest audio module (BIBLE 5a.9).
 * A 440 Hz sine, using the phase-accumulator pattern every oscillator uses.
 * Runs inside the AudioWorklet: no document, no window, no console.log here.
 */

export default {
  create(sampleRate) {
    let phase = 0;
    let step = 2 * Math.PI * 440 / sampleRate;      // radians per sample
    return {
      fill(left, right) {
        for (let i = 0; i < left.length; i++) {
          const value = 0.4 * Math.sin(phase);
          left[i] = value;
          right[i] = value;
          phase += step;
          if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
        }
      },
      setParam(name, value) {
        if (name === 'FREQUENCY') step = 2 * Math.PI * value / sampleRate;
      },
    };
  },
};