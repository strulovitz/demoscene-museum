"""
shared/python/fm_synth.py  --  a small FM synthesizer with a step sequencer
(BIBLE chapter 5b).  Complete program: plays a 4-bar loop (bass, lead, kick).

    pip install numpy sounddevice
    python fm_synth.py          (needs audio_host.py in the same folder)

The whole sound of 1990s PC games came from ONE formula, used here:

    output = sin(carrier_phase + mod_index * sin(modulator_phase))

A "modulator" sine wobbles the phase of a "carrier" sine.  Small wobble =
soft flute-like tone; big wobble = bright, buzzy tone.  Letting the wobble
die away over time makes the note start bright and end mellow, like a
plucked string.  Everything else here is bookkeeping: envelopes (loudness
over time), a sequencer (which note when) and a mixer (add the voices).

Structure (same names in FmSynth.java and fm-audio.js):

    note_to_frequency()  MIDI note number -> Hz
    Instrument           the numbers that describe a sound
    Voice                one note being played
    Sequencer            tempo + patterns; starts voices on each step
    FmSynth              owns voices + sequencer; fill() mixes a block
"""
import numpy as np

STEPS_PER_BEAT = 4            # 16th notes
STEPS_PER_PATTERN = 16        # one bar of 4/4


def note_to_frequency(note):
    """MIDI note number -> frequency in Hz.  69 = A4 = 440 Hz; every
    semitone up multiplies by 2 ** (1/12)."""
    return 440.0 * 2.0 ** ((note - 69) / 12.0)


class Instrument:
    """The recipe for a sound.  Just numbers (a 'data class')."""

    def __init__(self, ratio=1.0, mod_index=2.0, mod_decay=0.3,
                 attack=0.005, decay=0.3, sustain=0.5, release=0.15,
                 pitch_drop=0.0, volume=0.3, pan=0.0):
        self.ratio = ratio            # modulator frequency / carrier frequency
        self.mod_index = mod_index    # how much the modulator wobbles the carrier (brightness)
        self.mod_decay = mod_decay    # seconds for the brightness to fade
        self.attack = attack          # ADSR, all in seconds except sustain (a level 0..1)
        self.decay = decay
        self.sustain = sustain
        self.release = release
        self.pitch_drop = pitch_drop  # > 0: start higher and slide down (drums)
        self.volume = volume
        self.pan = pan                # -1 = left, 0 = centre, +1 = right


# "GM-lite": a few General MIDI program numbers as FM recipes (BIBLE 5b.5)
GM_LITE = {
    0:  Instrument(ratio=1.0, mod_index=1.0, mod_decay=0.5, decay=0.6, sustain=0.0, release=0.3),   # piano-ish
    33: Instrument(ratio=1.0, mod_index=3.0, mod_decay=0.15, decay=0.2, sustain=0.3, release=0.1),  # fingered bass
    80: Instrument(ratio=2.0, mod_index=1.5, mod_decay=0.4, attack=0.01, decay=0.3, sustain=0.6, release=0.2),  # square lead
    'kick': Instrument(ratio=1.0, mod_index=0.5, mod_decay=0.05, decay=0.12, sustain=0.0, release=0.05,
                       pitch_drop=3.0, volume=0.5),
}


class Voice:
    """One note being played by one instrument."""

    def __init__(self, instrument, note, gate_seconds, sample_rate):
        self.inst = instrument
        self.frequency = note_to_frequency(note)
        self.gate = gate_seconds          # when the "key is lifted" -> release starts
        self.sample_rate = sample_rate
        self.samples_done = 0             # how many samples we have produced so far
        self.phase_carrier = 0.0
        self.phase_mod = 0.0
        self.finished = False

    def render(self, frames):
        """Return `frames` samples of this voice as a float32 numpy array.
        Written in numpy style: every line computes ALL frames at once."""
        inst, sr = self.inst, self.sample_rate
        # time (seconds) of every sample in this block, counted from note start
        t = (self.samples_done + np.arange(frames)) / sr
        # --- frequency per sample (constant, unless the instrument has a pitch drop)
        freq = self.frequency * (1.0 + inst.pitch_drop * np.exp(-t / 0.05))
        # --- phases: accumulate 2*pi*f/sr per sample (np.cumsum adds up step by step)
        phase_c = self.phase_carrier + np.cumsum(2 * np.pi * freq / sr)
        phase_m = self.phase_mod + np.cumsum(2 * np.pi * freq * inst.ratio / sr)
        self.phase_carrier = phase_c[-1] % (2 * np.pi)
        self.phase_mod = phase_m[-1] % (2 * np.pi)
        # --- the FM formula; brightness (mod_index) fades with its own decay
        mod_index = inst.mod_index * np.exp(-t / inst.mod_decay)
        wave = np.sin(phase_c + mod_index * np.sin(phase_m))
        # --- ADSR envelope
        env = np.where(t < inst.attack,
                       t / inst.attack,
                       inst.sustain + (1 - inst.sustain) * np.exp(-(t - inst.attack) / inst.decay))
        released = np.maximum(t - self.gate, 0.0)          # 0 while the key is held
        env = env * np.exp(-released / inst.release)
        self.samples_done += frames
        if self.samples_done / sr > self.gate + 7 * inst.release:   # exp(-7) ~ 0.001: inaudible
            self.finished = True
        return (wave * env * inst.volume).astype(np.float32)


class Sequencer:
    """Tempo + one 16-step pattern per channel.  Each step is a MIDI note
    number, or 0 for a rest.  tick() is called once per step and starts
    voices; the SYNTH decides exactly when (sample-accurate)."""

    def __init__(self, bpm, channels):
        self.bpm = bpm
        self.channels = channels          # list of (instrument, pattern)
        self.step = 0                     # 0..15, which step comes next

    def seconds_per_step(self):
        return 60.0 / self.bpm / STEPS_PER_BEAT

    def tick(self, synth):
        for channel_index, (instrument, pattern) in enumerate(self.channels):
            note = pattern[self.step % len(pattern)]
            if note > 0:
                gate = self.seconds_per_step() * 0.75          # key held for 3/4 of the step
                synth.note_on(channel_index, instrument, note, gate)
        self.step = (self.step + 1) % STEPS_PER_PATTERN

    def position(self):
        return {'step': self.step}


class FmSynth:
    """The whole instrument: what audio_host.start_audio() needs
    (a .fill(frames) method returning (left, right) arrays)."""

    def __init__(self, sample_rate, sequencer):
        self.sample_rate = sample_rate
        self.sequencer = sequencer
        self.voices = {}                  # channel index -> current Voice (monophonic channels)
        self.samples_to_next_step = 0     # the sequencer fires when this reaches 0

    def note_on(self, channel, instrument, note, gate):
        # a new note on a channel replaces the old one (like the original chips)
        self.voices[channel] = Voice(instrument, note, gate, self.sample_rate)

    def fill(self, frames):
        left = np.zeros(frames, dtype=np.float32)
        right = np.zeros(frames, dtype=np.float32)
        done = 0
        while done < frames:
            if self.samples_to_next_step == 0:
                self.sequencer.tick(self)
                self.samples_to_next_step = int(self.sequencer.seconds_per_step() * self.sample_rate)
            # render up to the next step boundary (or the end of the block)
            n = min(frames - done, self.samples_to_next_step)
            for channel, voice in list(self.voices.items()):
                sound = voice.render(n)
                # constant-power panning: sqrt keeps the loudness equal left to right
                pan = voice.inst.pan
                left[done:done + n] += sound * np.sqrt((1 - pan) / 2)
                right[done:done + n] += sound * np.sqrt((1 + pan) / 2)
                if voice.finished:
                    del self.voices[channel]
            done += n
            self.samples_to_next_step -= n
        return left, right

    def set_param(self, name, value):
        if name == 'BPM':
            self.sequencer.bpm = value

    def get_position(self):
        return self.sequencer.position()


# ------------------------------------------------------------- the demo song

def make_demo_song():
    bass = GM_LITE[33]
    lead = Instrument(ratio=2.0, mod_index=1.5, mod_decay=0.4, attack=0.01,
                      decay=0.3, sustain=0.6, release=0.2, volume=0.25, pan=0.3)
    kick = GM_LITE['kick']
    #            1   .   .   .   2   .   .   .   3   .   .   .   4   .   .   .
    return Sequencer(125, [
        (bass, [33,  0, 33,  0, 36,  0, 33,  0, 31,  0, 31,  0, 33,  0, 36,  0]),
        (lead, [57,  0, 60, 64,  0, 64,  0, 62, 60,  0, 57,  0, 55,  0, 57,  0]),
        (kick, [36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0,  0, 36,  0,  0, 36]),
    ])


if __name__ == '__main__':
    import time
    from audio_host import start_audio, SAMPLE_RATE

    synth = FmSynth(SAMPLE_RATE, make_demo_song())
    print('playing an FM loop for 8 seconds...  (BIBLE 5b.5)')
    stream = start_audio(synth)
    time.sleep(8)
    stream.stop(); stream.close()
    print('done')