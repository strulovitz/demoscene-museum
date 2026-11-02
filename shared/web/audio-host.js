/*
 * shared/web/audio-host.js  --  the browser "host" (BIBLE chapter 5a.6).
 *
 * Usage (from a page or the museum, AFTER a user click/tap):
 *
 *   import { startAudio } from '../../../shared/web/audio-host.js';
 *   const audio = await startAudio(new URL('./tube-audio.js', import.meta.url).href);
 *   audio.setParam('TEMPO', 125);
 *   audio.time()      // seconds since start, from the AUDIO clock (use for renderFrame)
 *   audio.position    // whatever the synth's getPosition() last reported, or null
 *   audio.setVolume(0.5);
 *   await audio.stop();
 *
 * The exhibit's audio module (tube-audio.js) must `export default { create(sampleRate) }`
 * where create() returns an object with fill(left, right) and optionally
 * setParam(name, value) and getPosition().
 *
 * How it works: we write the source of a tiny AudioWorkletProcessor as a
 * string, make a Blob URL from it, and let the browser load it as a module.
 * That processor statically imports the exhibit's audio module (worklets
 * cannot use dynamic import), creates the synth with the worklet's global
 * `sampleRate`, and calls synth.fill() for every block the browser needs.
 */

export async function startAudio(audioModuleUrl, { volume = 0.5 } = {}) {
  const context = new AudioContext();         // uses the device's native sample rate
  await context.resume();                     // needs a user gesture to have happened

  const processorSource = `
    import synthModule from '${audioModuleUrl}';

    class ExhibitProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.synth = synthModule.create(sampleRate);      // sampleRate: worklet global
        this.framesSinceReport = 0;
        this.port.onmessage = (event) => {
          const { name, value } = event.data;
          if (this.synth.setParam) this.synth.setParam(name, value);
        };
      }

      process(inputs, outputs) {
        const out = outputs[0];
        const left = out[0];
        const right = out[1] || out[0];
        this.synth.fill(left, right);
        // report position about 30 times a second (for pattern displays etc.)
        this.framesSinceReport += left.length;
        if (this.synth.getPosition && this.framesSinceReport >= sampleRate / 30) {
          this.framesSinceReport = 0;
          this.port.postMessage(this.synth.getPosition());
        }
        return true;                                       // keep running
      }
    }

    registerProcessor('exhibit-processor', ExhibitProcessor);
  `;

  const blobUrl = URL.createObjectURL(new Blob([processorSource], { type: 'application/javascript' }));
  await context.audioWorklet.addModule(blobUrl);

  const node = new AudioWorkletNode(context, 'exhibit-processor', { outputChannelCount: [2] });
  const gain = context.createGain();
  gain.gain.value = volume;
  node.connect(gain).connect(context.destination);

  const startTime = context.currentTime;
  const handle = {
    context,
    node,
    position: null,
    setParam(name, value) { node.port.postMessage({ name, value }); },
    setVolume(v) { gain.gain.setTargetAtTime(v, context.currentTime, 0.02); },  // smooth, no click
    time() { return context.currentTime - startTime; },

    async stop() {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.02);

      await new Promise(r => setTimeout(r, 60));          // let the fade finish
      node.disconnect();
      await context.close();
    },
  };

  node.port.onmessage = (event) => { handle.position = event.data; };
  return handle;
}