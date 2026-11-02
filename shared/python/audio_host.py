"""
shared/python/audio_host.py  --  the Python "host" (BIBLE chapter 5a.4).

Copy this file next to any exhibit that has sound.  Students do not need
to read it, but it is short.

    pip install sounddevice numpy

Usage:
    from audio_host import start_audio, SAMPLE_RATE
    synth = MySynth(SAMPLE_RATE)       # must have .fill(frames) -> (left, right)
    stream = start_audio(synth)        # sound starts, this returns at once
    ...
    stream.stop(); stream.close()

The synth's fill(frames) must return two numpy float32 arrays of length
`frames` (left and right), values between -1.0 and +1.0.
"""

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 44100      # samples per second
BLOCK_FRAMES = 1024      # frames per callback: 1024 / 44100 = 23 ms
MASTER_VOLUME = 0.5


def start_audio(synth, volume=MASTER_VOLUME):
    """Open the sound device and make it call synth.fill() whenever it
    needs more sound.  Returns the stream; call .stop() and .close() to end."""
    def callback(outdata, frames, time_info, status):
        # This runs on PortAudio's thread, about 43 times per second.
        if status:                       # e.g. "output underflow" = we were too slow
            print('audio:', status)
        left, right = synth.fill(frames)
        outdata[:, 0] = np.clip(left * volume, -1.0, 1.0)
        outdata[:, 1] = np.clip(right * volume, -1.0, 1.0)

    stream = sd.OutputStream(samplerate=SAMPLE_RATE, channels=2, dtype='float32',
                             blocksize=BLOCK_FRAMES, callback=callback)
    stream.start()
    return stream


# ---------------------------------------------------------------- self test
class Sine:
    """The simplest synth: a 440 Hz sine wave.  Shows the phase-accumulator
    pattern that every oscillator in this museum uses."""

    def __init__(self, sample_rate, frequency=440.0):
        self.phase = 0.0
        self.step = 2 * np.pi * frequency / sample_rate    # radians per sample

    def fill(self, frames):
        # phases of all `frames` samples at once (numpy style, no Python loop)
        phases = self.phase + self.step * np.arange(frames)
        self.phase = (self.phase + self.step * frames) % (2 * np.pi)
        wave = (0.4 * np.sin(phases)).astype(np.float32)
        return wave, wave          # same signal left and right = mono


if __name__ == '__main__':
    import time
    print('playing a 440 Hz sine for 3 seconds...')
    stream = start_audio(Sine(SAMPLE_RATE))
    time.sleep(3)
    stream.stop(); stream.close()
    print('done')