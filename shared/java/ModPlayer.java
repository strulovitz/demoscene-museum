/*
 * shared/java/ModPlayer.java  --  a ProTracker MOD replayer (BIBLE chapter 5c).
 *
 * Run:  java ModPlayer.java              plays a built-in test song (built in memory)
 *       java ModPlayer.java song.mod     plays a ProTracker module
 *
 * See mod_player.py for the full explanation.  Same structure and names:
 * parseMod, Sample, Cell, Song, Channel, ModPlayer (fill, doTick, processRow,
 * processTickEffects, playbackPeriod, advanceRow), makeTestMod.
 * The AudioHost at the bottom is the verbatim copy from SineTest.java.
 *
 * Note on tempo: the SONG sets its own tempo with the Fxx effect, and a correct
 * player obeys it every time it appears.  The listener's speed control is
 * therefore a FACTOR on top (tempoFactor, like a turntable's pitch slider).
 */
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.SourceDataLine;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

public class ModPlayer implements SineTestLike.Synth {
    static final double AMIGA_CLOCK = 3546895.0;       // PAL Amiga: sample rate = AMIGA_CLOCK / period
    static final int MIN_PERIOD = 113, MAX_PERIOD = 856;
    static final int ROWS_PER_PATTERN = 64;

    // ============================================================ data classes
    /** One instrument: an 8-bit recording plus loop points and default volume. */
    static class Sample {
        String name;
        int length, finetune, volume, loopStart, loopLength, loopEnd;
        boolean looping;
        float[] data = new float[1];

        /** Store as float -1..1 plus ONE extra value so interpolation may read data[i + 1]. */
        void setPcm(byte[] file, int offset) {
            int available = Math.max(0, Math.min(length, file.length - offset));
            length = available;
            looping = loopLength > 2 && loopStart < length;
            int keep = length;
            if (looping) {
                loopEnd = Math.min(loopStart + loopLength, length);
                loopLength = loopEnd - loopStart;
                keep = loopEnd;                        // data after the loop is never heard
            }
            data = new float[keep + 1];
            for (int i = 0; i < keep; i++) data[i] = file[offset + i] / 128f;   // byte is already signed
            data[keep] = looping ? data[loopStart] : 0f;
        }
    }

    /** One cell of a pattern: what one channel does on one row. */
    static class Cell {
        int sample, period, effect, param;
    }

    static class Song {
        String title = "";
        Sample[] samples = new Sample[31];
        int length;                         // used entries of orders
        int[] orders = new int[128];
        int channels = 4;
        Cell[][][] patterns;                // [pattern][row][channel]
    }

    static int be16(byte[] d, int p) {      // big-endian 16-bit number
        return ((d[p] & 0xFF) << 8) | (d[p + 1] & 0xFF);
    }

    static String text(byte[] d, int p, int n) {
        return new String(d, p, n, StandardCharsets.ISO_8859_1).replace('\0', ' ').trim();
    }

    /** Turn the bytes of a .mod file into a Song.  Offsets: BIBLE 5c.2. */
    static Song parseMod(byte[] data) {
        Song song = new Song();
        song.title = text(data, 0, 20);
        int pos = 20;
        for (int i = 0; i < 31; i++) {                       // 31 sample headers, 30 bytes each
            Sample s = new Sample();
            s.name = text(data, pos, 22);
            s.length = be16(data, pos + 22) * 2;
            s.finetune = data[pos + 24] & 15;
            if (s.finetune > 7) s.finetune -= 16;            // 8..15 mean -8..-1
            s.volume = Math.min(data[pos + 25] & 0xFF, 64);
            s.loopStart = be16(data, pos + 26) * 2;
            s.loopLength = be16(data, pos + 28) * 2;
            song.samples[i] = s;
            pos += 30;
        }
        song.length = data[950] & 0xFF;
        int maxPattern = 0;
        for (int i = 0; i < 128; i++) {
            song.orders[i] = data[952 + i] & 0xFF;
            maxPattern = Math.max(maxPattern, song.orders[i]);
        }
        String signature = new String(data, 1080, 4, StandardCharsets.ISO_8859_1);
        if (signature.endsWith("CHN")) song.channels = signature.charAt(0) - '0';
        else if (signature.endsWith("CH")) song.channels = Integer.parseInt(signature.substring(0, 2));
        pos = 1084;
        song.patterns = new Cell[maxPattern + 1][ROWS_PER_PATTERN][song.channels];
        for (int p = 0; p <= maxPattern; p++)
            for (int r = 0; r < ROWS_PER_PATTERN; r++)
                for (int c = 0; c < song.channels; c++) {
                    int b0 = data[pos] & 0xFF, b1 = data[pos + 1] & 0xFF;
                    int b2 = data[pos + 2] & 0xFF, b3 = data[pos + 3] & 0xFF;
                    pos += 4;
                    Cell cell = new Cell();
                    cell.sample = (b0 & 0xF0) | (b2 >> 4);
                    cell.period = ((b0 & 0x0F) << 8) | b1;
                    cell.effect = b2 & 0x0F;
                    cell.param = b3;
                    song.patterns[p][r][c] = cell;
                }
        for (Sample s : song.samples) {                      // sample data follows the patterns
            s.setPcm(data, pos);
            pos += s.length;
        }
        return song;
    }

    // ============================================================ playback state
    /** Everything one channel remembers while playing. */
    static class Channel {
        final float gainLeft, gainRight;
        Sample sample;
        int sampleNumber;
        boolean playing;
        boolean muted;                // listener's mute button (MUTE_n)
        double position;              // where we are inside the sample (fractional)
        double step;                  // sample positions per output sample (set each tick)
        double period, targetPeriod, playbackPeriod;
        int volume;                   // 0..64
        int effect, param;
        int portaSpeed, vibratoSpeed, vibratoDepth, vibratoPos;
        int delayedPeriod;

        Channel(double pan) {
            gainLeft = (float) Math.sqrt((1 - pan) / 2);     // constant-power panning
            gainRight = (float) Math.sqrt((1 + pan) / 2);
        }

        /** Read one interpolated sample value and advance (the mixer's inner step). */
        float nextSample() {
            int index = (int) position;
            float frac = (float) (position - index);
            float value = sample.data[index] + (sample.data[index + 1] - sample.data[index]) * frac;
            position += step;
            if (sample.looping) {
                while (position >= sample.loopEnd) position -= sample.loopLength;
            } else if (position >= sample.length) {
                playing = false;
            }
            return muted ? 0f : value * (volume / 64f);
        }
    }

    final int sampleRate;
    Song song;
    Channel[] channels;
    float channelGain;
    int speed, bpm, order, row, tick, samplesUntilTick;
    double tempoFactor = 1;           // the LISTENER's speed control, on top of the song's BPM
    int jumpOrder = -1, breakRow = -1;

    ModPlayer(int sampleRate, Song song) {
        this.sampleRate = sampleRate;
        loadSong(song);
    }

    void loadSong(Song song) {
        this.song = song;
        channels = new Channel[song.channels];
        for (int i = 0; i < song.channels; i++)                // Amiga "LRRL" at 70 % separation
            channels[i] = new Channel((i % 4 == 0 || i % 4 == 3) ? -0.7 : 0.7);
        channelGain = 2f / song.channels;
        speed = 6; bpm = 125; tempoFactor = 1;
        order = 0; row = 0; tick = 0; samplesUntilTick = 0;
        jumpOrder = -1; breakRow = -1;
    }

    int samplesPerTick() {                                     // 882 at 44100 Hz, 125 BPM, factor 1
        return (int) (sampleRate * 2.5 / (bpm * tempoFactor));
    }

    // ------------------------------------------------------------ the mixer
    @Override
    public void fill(float[] left, float[] right) {
        for (int i = 0; i < left.length; i++) {
            if (samplesUntilTick == 0) {
                doTick();
                samplesUntilTick = samplesPerTick();
            }
            float l = 0, r = 0;
            for (Channel ch : channels) {
                if (!ch.playing) continue;
                float v = ch.nextSample();
                l += v * ch.gainLeft;
                r += v * ch.gainRight;
            }
            left[i] = l * channelGain;
            right[i] = r * channelGain;
            samplesUntilTick--;
        }
    }

    // ------------------------------------------------------------ the sequencer
    void doTick() {
        if (tick == 0) processRow();
        else processTickEffects();
        for (Channel ch : channels) {
            ch.playbackPeriod = playbackPeriod(ch);
            ch.step = ch.playbackPeriod > 0 ? AMIGA_CLOCK / ch.playbackPeriod / sampleRate : 0;
        }
        tick++;
        if (tick >= speed) {
            tick = 0;
            advanceRow();
        }
    }

    void advanceRow() {
        if (jumpOrder >= 0 || breakRow >= 0) {
            order = jumpOrder >= 0 ? jumpOrder : order + 1;
            row = Math.max(breakRow, 0);
            jumpOrder = -1; breakRow = -1;
        } else {
            row++;
            if (row >= ROWS_PER_PATTERN) { row = 0; order++; }
        }
        if (order >= song.length) order = 0;                   // song finished: start again
    }

    void processRow() {
        Cell[] cells = song.patterns[song.orders[order]][row];
        for (int c = 0; c < channels.length; c++) processCell(channels[c], cells[c]);
    }

    double finetuned(int period, Channel ch) {
        if (ch.sample == null) return period;
        return period * Math.pow(2, -ch.sample.finetune / 96.0);   // 8 finetune steps per semitone
    }

    void trigger(Channel ch, int period, int offset) {
        if (ch.sample == null || ch.sample.length == 0) { ch.playing = false; return; }
        ch.period = ch.targetPeriod = finetuned(period, ch);
        ch.position = Math.min(offset, ch.sample.length - 1);
        ch.vibratoPos = 0;
        ch.playing = true;
    }

    void processCell(Channel ch, Cell cell) {
        ch.effect = cell.effect; ch.param = cell.param;
        int x = cell.param >> 4, y = cell.param & 15;
        if (cell.sample > 0) {                                  // new instrument: default volume
            ch.sampleNumber = cell.sample;
            ch.sample = song.samples[cell.sample - 1];
            ch.volume = ch.sample.volume;
        }
        if (cell.period > 0) {                                  // a new note
            if (cell.effect == 3 || cell.effect == 5) ch.targetPeriod = finetuned(cell.period, ch);
            else if (cell.effect == 0xE && x == 0xD) ch.delayedPeriod = cell.period;
            else trigger(ch, cell.period, cell.effect == 9 ? cell.param * 256 : 0);
        }
        switch (cell.effect) {                                  // effects that act on tick 0
            case 0x3: if (cell.param != 0) ch.portaSpeed = cell.param; break;
            case 0x4: if (x != 0) ch.vibratoSpeed = x; if (y != 0) ch.vibratoDepth = y; break;
            case 0xB: jumpOrder = cell.param; break;
            case 0xC: ch.volume = Math.min(cell.param, 64); break;
            case 0xD: breakRow = Math.min(x * 10 + y, ROWS_PER_PATTERN - 1); break;   // decimal!
            case 0xE:
                if (x == 0x1) ch.period = Math.max(ch.period - y, MIN_PERIOD);
                else if (x == 0x2) ch.period = Math.min(ch.period + y, MAX_PERIOD);
                else if (x == 0xA) ch.volume = Math.min(ch.volume + y, 64);
                else if (x == 0xB) ch.volume = Math.max(ch.volume - y, 0);
                else if (x == 0xC && y == 0) ch.volume = 0;
                break;
            case 0xF:                                           // the SONG sets its tempo; obeyed every time
                if (cell.param != 0 && cell.param < 32) speed = cell.param;
                else if (cell.param >= 32) bpm = cell.param;
                break;
            default: break;
        }
    }

    void processTickEffects() {
        for (Channel ch : channels) {
            int x = ch.param >> 4, y = ch.param & 15;
            switch (ch.effect) {
                case 0x1: ch.period = Math.max(ch.period - ch.param, MIN_PERIOD); break;
                case 0x2: ch.period = Math.min(ch.period + ch.param, MAX_PERIOD); break;
                case 0x3: tonePortamento(ch); break;
                case 0x4: ch.vibratoPos = (ch.vibratoPos + ch.vibratoSpeed) % 64; break;
                case 0x5: tonePortamento(ch); volumeSlide(ch, x, y); break;
                case 0x6: ch.vibratoPos = (ch.vibratoPos + ch.vibratoSpeed) % 64; volumeSlide(ch, x, y); break;
                case 0xA: volumeSlide(ch, x, y); break;
                case 0xE:
                    if (x == 0xC && tick == y) ch.volume = 0;
                    else if (x == 0xD && tick == y && ch.delayedPeriod != 0) {
                        trigger(ch, ch.delayedPeriod, 0);
                        ch.delayedPeriod = 0;
                    }
                    break;
                default: break;
            }
        }
    }

    void tonePortamento(Channel ch) {
        if (ch.period < ch.targetPeriod) ch.period = Math.min(ch.period + ch.portaSpeed, ch.targetPeriod);
        else if (ch.period > ch.targetPeriod) ch.period = Math.max(ch.period - ch.portaSpeed, ch.targetPeriod);
    }

    void volumeSlide(Channel ch, int up, int down) {
        ch.volume = Math.max(0, Math.min(64, ch.volume + up - down));
    }

    /** The note's period plus vibrato wobble plus the arpeggio's semitone jump. */
    double playbackPeriod(Channel ch) {
        double period = ch.period;
        if (ch.effect == 4 || ch.effect == 6)
            period += 2 * ch.vibratoDepth * Math.sin(2 * Math.PI * ch.vibratoPos / 64);
        if (ch.effect == 0 && ch.param != 0) {
            int semitones = tick % 3 == 0 ? 0 : tick % 3 == 1 ? ch.param >> 4 : ch.param & 15;
            period /= Math.pow(2, semitones / 12.0);
        }
        return period;
    }

    // ------------------------------------------------------------ for displays / sliders
    void setParam(String name, double value) {
        if (name.equals("TEMPO_FACTOR")) {                      // 0.5 .. 2.0
            tempoFactor = value;
        } else if (name.startsWith("MUTE_")) {                  // MUTE_1 .. MUTE_n
            int index = Integer.parseInt(name.substring(5)) - 1;
            if (index >= 0 && index < channels.length) channels[index].muted = value != 0;
        }
    }

    // ============================================================ a test song
    /** WRITE a small MOD file into memory: the mirror image of parseMod(). */
    static byte[] makeTestMod() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // --- instruments
        byte[] saw = new byte[64];                                   // one sawtooth cycle (bass)
        for (int i = 0; i < 64; i++) saw[i] = (byte) (i * 4 - 128);
        byte[] tri = new byte[32];                                   // triangle (lead)
        for (int i = 0; i < 32; i++) tri[i] = (byte) (i < 16 ? -128 + i * 16 : 127 - (i - 16) * 16);
        byte[] snare = new byte[2000];                               // noise that dies away
        int seed = 1;
        for (int i = 0; i < 2000; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;         // simple random generator
            snare[i] = (byte) ((seed / (double) 0x7FFFFFFF * 2 - 1) * 110 * Math.exp(-i / 500.0));
        }
        byte[] kick = new byte[3000];                                // sine whose pitch falls 400 -> 50 Hz
        double phase = 0;
        for (int i = 0; i < 3000; i++) {
            phase += 2 * Math.PI * (50 + 350 * Math.exp(-i / 300.0)) / 16574;
            kick[i] = (byte) (Math.sin(phase) * 120 * Math.exp(-i / 1000.0));
        }
        // --- header
        writeText(out, "DSM TEST SONG", 20);
        sampleHeader(out, "bass saw", saw.length, 48, 64);
        sampleHeader(out, "lead triangle", tri.length, 36, 32);
        sampleHeader(out, "snare", snare.length, 48, 2);            // loop length 2 bytes = no loop
        sampleHeader(out, "kick", kick.length, 64, 2);
        for (int i = 0; i < 27; i++) sampleHeader(out, "", 0, 0, 2);
        out.write(1); out.write(127);                                 // song length 1, restart
        out.write(new byte[128], 0, 128);                             // orders: all pattern 0
        writeText(out, "M.K.", 4);
        // --- one pattern: a 16-row riff repeated 4 times.  Periods: BIBLE 5c.4.
        final int C2 = 428, DS2 = 360, F2 = 320, C3 = 214, DS3 = 180, F3 = 160, G3 = 143;
        int[][] riff = {                     // row, channel, period, sample, effect, param
            {0, 0, C2, 1, 0x0, 0x00}, {2, 0, C2, 1, 0xC, 0x20}, {4, 0, C2, 1, 0x0, 0x00},     // bass
            {6, 0, DS2, 1, 0x0, 0x00}, {8, 0, F2, 1, 0x0, 0x00}, {10, 0, F2, 1, 0xC, 0x20},
            {12, 0, DS2, 1, 0x0, 0x00}, {14, 0, C2, 0, 0x3, 0x08},                            //   slide to C-2
            {0, 1, C3, 2, 0x4, 0x63}, {1, 1, 0, 0, 0x4, 0}, {2, 1, 0, 0, 0x4, 0}, {3, 1, 0, 0, 0x4, 0},   // lead, vibrato
            {4, 1, DS3, 2, 0x0, 0x00}, {6, 1, G3, 2, 0x0, 0x00},
            {8, 1, F3, 2, 0x0, 0x37}, {9, 1, 0, 0, 0x0, 0x37}, {10, 1, 0, 0, 0x0, 0x37}, {11, 1, 0, 0, 0x0, 0x37},  // arpeggio
            {12, 1, C3, 2, 0xA, 0x02}, {13, 1, 0, 0, 0xA, 0x02}, {14, 1, 0, 0, 0xA, 0x02}, {15, 1, 0, 0, 0xA, 0x02},  // fade
            {0, 2, C3, 4, 0xF, 0x06}, {4, 2, C3, 4, 0, 0}, {8, 2, C3, 4, 0, 0}, {12, 2, C3, 4, 0, 0},   // kick, speed 6
            {0, 3, 0, 0, 0xF, 0x7D},                                                             // tempo 125
            {2, 3, C3, 3, 0xC, 0x18}, {4, 3, C3, 3, 0, 0}, {6, 3, C3, 3, 0xC, 0x18},             // snare / hi-hat
            {10, 3, C3, 3, 0xC, 0x18}, {12, 3, C3, 3, 0, 0}, {14, 3, C3, 3, 0xC, 0x18},
        };
        byte[] pattern = new byte[ROWS_PER_PATTERN * 4 * 4];
        for (int bar = 0; bar < 4; bar++)
            for (int[] n : riff) {
                int row = n[0], ch = n[1], period = n[2], sample = n[3], effect = n[4], param = n[5];
                int o = ((bar * 16 + row) * 4 + ch) * 4;
                pattern[o] = (byte) ((sample & 0xF0) | (period >> 8));
                pattern[o + 1] = (byte) (period & 0xFF);
                pattern[o + 2] = (byte) (((sample & 0x0F) << 4) | effect);
                pattern[o + 3] = (byte) param;
            }
        out.write(pattern, 0, pattern.length);
        out.write(saw, 0, saw.length);
        out.write(tri, 0, tri.length);
        out.write(snare, 0, snare.length);
        out.write(kick, 0, kick.length);
        return out.toByteArray();
    }

    static void writeText(ByteArrayOutputStream out, String s, int width) {
        byte[] b = s.getBytes(StandardCharsets.ISO_8859_1);
        for (int i = 0; i < width; i++) out.write(i < b.length ? b[i] : 0);
    }

    static void writeBe16(ByteArrayOutputStream out, int v) {
        out.write((v >> 8) & 0xFF); out.write(v & 0xFF);
    }

    static void sampleHeader(ByteArrayOutputStream out, String name, int lengthBytes, int volume, int loopLengthBytes) {
        writeText(out, name, 22);
        writeBe16(out, lengthBytes / 2);
        out.write(0);                       // finetune
        out.write(volume);
        writeBe16(out, 0);                  // loop start
        writeBe16(out, loopLengthBytes / 2);
    }

    // ============================================================ main
    public static void main(String[] args) throws Exception {
        byte[] data = args.length > 0 ? Files.readAllBytes(Paths.get(args[0])) : makeTestMod();
        Song song = parseMod(data);
        System.out.printf("\"%s\"  %d channels, %d patterns, %d positions.  Ctrl+C stops.%n",
                song.title, song.channels, song.patterns.length, song.length);
        for (int i = 0; i < 31; i++) {
            Sample s = song.samples[i];
            if (s.length > 0)
                System.out.printf("  sample %2d: %-22s %6d bytes%s%n", i + 1, s.name, s.length,
                        s.looping ? "  loop " + s.loopStart + "+" + s.loopLength : "");
        }
        ModPlayer player = new ModPlayer(SineTestLike.AudioHost.SAMPLE_RATE, song);
        // Try this: player.setParam("TEMPO_FACTOR", 1.5);  or  player.setParam("MUTE_2", 1);
        SineTestLike.AudioHost host = new SineTestLike.AudioHost(player);
        host.start();
        while (true) {
            Thread.sleep(100);
            System.out.printf("\r  order %3d   row %2d   ", player.order, player.row);
        }
    }
}

/* The host, copied verbatim from SineTest.java (BIBLE 5a.5). */
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
