/*
 * shared/java/FmSynth.java  --  a small FM synthesizer with a step sequencer
 * (BIBLE chapter 5b).  Complete program: plays a 4-bar loop (bass, lead, kick).
 *
 * Run:  java FmSynth.java
 *
 * The whole sound of 1990s PC games came from ONE formula, used here:
 *
 *     output = sin(carrierPhase + modIndex * sin(modulatorPhase))
 *
 * See fm_synth.py for the full explanation; this file has the same
 * structure and names:  noteToFrequency, Instrument, Voice, Sequencer, FmSynth.
 * The AudioHost class at the bottom is a verbatim copy from SineTest.java.
 */
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.SourceDataLine;
import java.util.ArrayList;
import java.util.List;

public class FmSynth implements SineTestLike.Synth {

    static final int STEPS_PER_BEAT = 4;        // 16th notes
    static final int STEPS_PER_PATTERN = 16;    // one bar of 4/4

    /** MIDI note number -> Hz.  69 = A4 = 440 Hz; a semitone is a factor 2^(1/12). */
    static double noteToFrequency(int note) {
        return 440.0 * Math.pow(2.0, (note - 69) / 12.0);
    }

    // ================================================================ Instrument
    /** The recipe for a sound.  Just numbers. */
    static class Instrument {
        double ratio = 1.0;        // modulator frequency / carrier frequency
        double modIndex = 2.0;     // how much the modulator wobbles the carrier (brightness)
        double modDecay = 0.3;     // seconds for the brightness to fade
        double attack = 0.005, decay = 0.3, sustain = 0.5, release = 0.15;   // ADSR
        double pitchDrop = 0.0;    // > 0: start higher and slide down (drums)
        double volume = 0.3;
        double pan = 0.0;          // -1 left, 0 centre, +1 right

        Instrument ratio(double v) { ratio = v; return this; }
        Instrument modIndex(double v) { modIndex = v; return this; }
        Instrument modDecay(double v) { modDecay = v; return this; }
        Instrument adsr(double a, double d, double s, double r) { attack = a; decay = d; sustain = s; release = r; return this; }
        Instrument pitchDrop(double v) { pitchDrop = v; return this; }
        Instrument volume(double v) { volume = v; return this; }
        Instrument pan(double v) { pan = v; return this; }
    }

    // ================================================================ Voice
    /** One note being played by one instrument. */
    static class Voice {
        final Instrument inst;
        final double frequency;
        final double gate;             // seconds until the "key is lifted"
        final int sampleRate;
        long samplesDone = 0;
        double phaseCarrier = 0, phaseMod = 0;
        boolean finished = false;

        Voice(Instrument inst, int note, double gate, int sampleRate) {
            this.inst = inst;
            this.frequency = noteToFrequency(note);
            this.gate = gate;
            this.sampleRate = sampleRate;
        }

        /** Produce ONE sample.  (Python does a whole block at once with numpy;
         *  Java is fast enough to do it one sample at a time, which reads easier.) */
        float nextSample() {
            double t = samplesDone / (double) sampleRate;        // seconds since note start
            // frequency (constant, unless the instrument has a pitch drop)
            double freq = frequency * (1.0 + inst.pitchDrop * Math.exp(-t / 0.05));
            // the FM formula; brightness (modIndex) fades with its own decay
            double modIndex = inst.modIndex * Math.exp(-t / inst.modDecay);
            double wave = Math.sin(phaseCarrier + modIndex * Math.sin(phaseMod));
            // ADSR envelope
            double env;
            if (t < inst.attack) env = t / inst.attack;
            else env = inst.sustain + (1 - inst.sustain) * Math.exp(-(t - inst.attack) / inst.decay);
            double released = Math.max(t - gate, 0.0);           // 0 while the key is held
            env *= Math.exp(-released / inst.release);
            // advance the oscillators
            phaseCarrier += 2 * Math.PI * freq / sampleRate;
            phaseMod += 2 * Math.PI * freq * inst.ratio / sampleRate;
            if (phaseCarrier >= 2 * Math.PI) phaseCarrier -= 2 * Math.PI;
            if (phaseMod >= 2 * Math.PI) phaseMod -= 2 * Math.PI;
            samplesDone++;
            if (t > gate + 7 * inst.release) finished = true;   // exp(-7) ~ 0.001: inaudible
            return (float) (wave * env * inst.volume);
        }
    }

    // ================================================================ Sequencer
    /** Tempo + one 16-step pattern per channel (MIDI notes, 0 = rest). */
    static class Sequencer {
        double bpm;
        final List<Instrument> instruments = new ArrayList<>();
        final List<int[]> patterns = new ArrayList<>();
        int step = 0;

        Sequencer(double bpm) { this.bpm = bpm; }

        Sequencer channel(Instrument inst, int... pattern) {
            instruments.add(inst); patterns.add(pattern); return this;
        }

        double secondsPerStep() { return 60.0 / bpm / STEPS_PER_BEAT; }

        void tick(FmSynth synth) {
            for (int ch = 0; ch < instruments.size(); ch++) {
                int[] pattern = patterns.get(ch);
                int note = pattern[step % pattern.length];
                if (note > 0) synth.noteOn(ch, instruments.get(ch), note, secondsPerStep() * 0.75);
            }
            step = (step + 1) % STEPS_PER_PATTERN;
        }
    }

    // ================================================================ FmSynth
    final int sampleRate;
    final Sequencer sequencer;
    final Voice[] voices;              // one voice per channel (monophonic channels)
    int samplesToNextStep = 0;

    FmSynth(int sampleRate, Sequencer sequencer) {
        this.sampleRate = sampleRate;
        this.sequencer = sequencer;
        this.voices = new Voice[sequencer.instruments.size()];
    }

    void noteOn(int channel, Instrument inst, int note, double gate) {
        voices[channel] = new Voice(inst, note, gate, sampleRate);   // replaces the old note
    }

    @Override
    public void fill(float[] left, float[] right) {
        for (int i = 0; i < left.length; i++) {
            if (samplesToNextStep == 0) {                 // sample-accurate sequencer
                sequencer.tick(this);
                samplesToNextStep = (int) (sequencer.secondsPerStep() * sampleRate);
            }
            float l = 0, r = 0;
            for (int ch = 0; ch < voices.length; ch++) {
                Voice v = voices[ch];
                if (v == null) continue;
                float s = v.nextSample();
                double pan = v.inst.pan;                  // constant-power panning
                l += s * Math.sqrt((1 - pan) / 2);
                r += s * Math.sqrt((1 + pan) / 2);
                if (v.finished) voices[ch] = null;
            }
            left[i] = l;
            right[i] = r;
            samplesToNextStep--;
        }
    }

    void setParam(String name, double value) {
        if (name.equals("BPM")) sequencer.bpm = value;
    }

    // ================================================================ demo song
    static Sequencer makeDemoSong() {
        Instrument bass = new Instrument().ratio(1).modIndex(3).modDecay(0.15).adsr(0.005, 0.2, 0.3, 0.1);
        Instrument lead = new Instrument().ratio(2).modIndex(1.5).modDecay(0.4).adsr(0.01, 0.3, 0.6, 0.2).volume(0.25).pan(0.3);
        Instrument kick = new Instrument().ratio(1).modIndex(0.5).modDecay(0.05).adsr(0.005, 0.12, 0.0, 0.05).pitchDrop(3).volume(0.5);
        return new Sequencer(125)
            //            1   .   .   .   2   .   .   .   3   .   .   .   4   .   .   .
            .channel(bass, 33,  0, 33,  0, 36,  0, 33,  0, 31,  0, 31,  0, 33,  0, 36,  0)
            .channel(lead, 57,  0, 60, 64,  0, 64,  0, 62, 60,  0, 57,  0, 55,  0, 57,  0)
            .channel(kick, 36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0, 36);
    }

    public static void main(String[] args) throws Exception {
        System.out.println("playing an FM loop for 8 seconds...  (BIBLE 5b.5)");
        FmSynth synth = new FmSynth(SineTestLike.AudioHost.SAMPLE_RATE, makeDemoSong());
        SineTestLike.AudioHost host = new SineTestLike.AudioHost(synth);
        host.start();
        Thread.sleep(8000);
        host.stop();
        Thread.sleep(200);
        System.out.println("done");
    }
}

/* ---------------------------------------------------------------------------
 * The host, copied verbatim from SineTest.java (BIBLE 5a.5), wrapped in a
 * holder class so this file stays a single runnable file.
 * ------------------------------------------------------------------------- */
class SineTestLike {
    interface Synth { void fill(float[] left, float[] right); }

    static class AudioHost implements Runnable {
        static final int SAMPLE_RATE = 44100;
        static final int BLOCK_FRAMES = 1024;
        static final float MASTER_VOLUME = 0.5f;

        final Synth synth;
        volatile boolean running = true;
        volatile long framesPlayed = 0;

        AudioHost(Synth synth) { this.synth = synth; }

        void start() { Thread t = new Thread(this, "audio"); t.setDaemon(true); t.setPriority(Thread.MAX_PRIORITY); t.start(); }
        void stop() { running = false; }
        double time() { return framesPlayed / (double) SAMPLE_RATE; }

        @Override public void run() {
            try {
                AudioFormat format = new AudioFormat(SAMPLE_RATE, 16, 2, true, false);
                SourceDataLine line = AudioSystem.getSourceDataLine(format);
                line.open(format, BLOCK_FRAMES * 4 * 4);
                line.start();
                float[] left = new float[BLOCK_FRAMES], right = new float[BLOCK_FRAMES];
                byte[] bytes = new byte[BLOCK_FRAMES * 4];
                while (running) {
                    synth.fill(left, right);
                    for (int i = 0; i < BLOCK_FRAMES; i++) {
                        int l = toInt16(left[i] * MASTER_VOLUME), r = toInt16(right[i] * MASTER_VOLUME);
                        bytes[i * 4] = (byte) l; bytes[i * 4 + 1] = (byte) (l >> 8);
                        bytes[i * 4 + 2] = (byte) r; bytes[i * 4 + 3] = (byte) (r >> 8);
                    }
                    line.write(bytes, 0, bytes.length);
                    framesPlayed += BLOCK_FRAMES;
                }
                line.drain(); line.close();
            } catch (Exception e) { e.printStackTrace(); }
        }

        static int toInt16(float v) { if (v > 1f) v = 1f; if (v < -1f) v = -1f; return (int) (v * 32767); }
    }
}