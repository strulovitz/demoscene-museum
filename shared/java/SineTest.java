/*
 * shared/java/SineTest.java  --  the Java "host" + a sine test (BIBLE 5a.5).
 *
 * Run:  java SineTest.java      (plays a 440 Hz tone for 3 seconds)
 *
 * In an exhibit, copy the `Synth` interface and the `AudioHost` class into
 * the exhibit's single Java file unchanged; write your own Synth.
 */

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.SourceDataLine;

public class SineTest {

    /** Anything that can fill a block of stereo sound. */
    interface Synth {
        /** Write left.length frames into left[] and right[], values -1..+1. */
        void fill(float[] left, float[] right);
    }

    // ===================================================== the host

    /**
     * Gets the operating system to play whatever a Synth produces.
     * Java has no audio callback; instead we WRITE blocks to a line and the
     * write blocks until the line has room.  That blocking is our clock.
     */
    static class AudioHost implements Runnable {
        static final int SAMPLE_RATE = 44100;     // samples per second
        static final int BLOCK_FRAMES = 1024;     // 1024 / 44100 = 23 ms per block
        static final float MASTER_VOLUME = 0.5f;
        final Synth synth;
        volatile boolean running = true;
        volatile long framesPlayed = 0;           // for syncing graphics (5a.7)

        AudioHost(Synth synth) {
            this.synth = synth;
        }

        /** Start playing on a background thread and return at once. */
        void start() {
            Thread thread = new Thread(this, "audio");
            thread.setDaemon(true);               // dies with the program
            thread.setPriority(Thread.MAX_PRIORITY);
            thread.start();
        }

        void stop() {
            running = false;
        }

        /** Seconds of audio played so far = the clock the graphics should use. */
        double time() {
            return framesPlayed / (double) SAMPLE_RATE;
        }

        @Override
        public void run() {
            try {
                // 16-bit, stereo, signed, little-endian: the universal PCM format
                AudioFormat format = new AudioFormat(SAMPLE_RATE, 16, 2, true, false);
                SourceDataLine line = AudioSystem.getSourceDataLine(format);
                line.open(format, BLOCK_FRAMES * 4 * 4);   // room for 4 blocks (~90 ms)
                line.start();
                float[] left = new float[BLOCK_FRAMES];
                float[] right = new float[BLOCK_FRAMES];
                byte[] bytes = new byte[BLOCK_FRAMES * 4];  // 2 channels x 2 bytes
                while (running) {
                    synth.fill(left, right);
                    for (int i = 0; i < BLOCK_FRAMES; i++) {
                        int l = toInt16(left[i] * MASTER_VOLUME);
                        int r = toInt16(right[i] * MASTER_VOLUME);
                        bytes[i * 4]     = (byte) l;          // low byte first
                        bytes[i * 4 + 1] = (byte) (l >> 8);   // then high byte
                        bytes[i * 4 + 2] = (byte) r;
                        bytes[i * 4 + 3] = (byte) (r >> 8);
                    }
                    line.write(bytes, 0, bytes.length);       // blocks until there is room
                    framesPlayed += BLOCK_FRAMES;
                }
                line.drain();
                line.close();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        /** -1.0..+1.0 float -> -32767..32767 integer, clamped (no wrap-around!). */
        static int toInt16(float value) {
            if (value > 1f) value = 1f;
            if (value < -1f) value = -1f;
            return (int) (value * 32767);
        }
    }

    // ===================================================== the test synth

    /**
     * The simplest synth: a sine wave, using the phase-accumulator pattern
     * every oscillator in the museum uses.
     */
    static class Sine implements Synth {
        double phase = 0;
        final double step;                            // radians per sample

        Sine(double frequency, int sampleRate) {
            step = 2 * Math.PI * frequency / sampleRate;
        }

        public void fill(float[] left, float[] right) {
            for (int i = 0; i < left.length; i++) {
                float value = (float) (0.4 * Math.sin(phase));
                left[i] = value;
                right[i] = value;                     // same both sides = mono
                phase += step;
                if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
            }
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("playing a 440 Hz sine for 3 seconds...");
        AudioHost host = new AudioHost(new Sine(440, AudioHost.SAMPLE_RATE));
        host.start();
        Thread.sleep(3000);
        host.stop();
        Thread.sleep(200);
        System.out.println("done");
    }
}