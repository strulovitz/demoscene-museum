"""shared/python/mod_player.py  --  a ProTracker MOD replayer (BIBLE chapter 5c).

    pip install numpy sounddevice
    python mod_player.py               plays a built-in test song (built in memory)
    python mod_player.py song.mod      plays a ProTracker module from modarchive.org etc.
                                       (needs audio_host.py in the same folder)

A MOD file is two things: SAMPLES (short 8-bit recordings) and PATTERNS
(a spreadsheet with 64 rows and one column per channel; each cell says
"play sample S at pitch P, with effect E").  A player is two halves:

    the SEQUENCER  -  50 times a second (a "tick") it walks down the rows and
                      tells each channel what to do (start a note, slide, ...)
    the MIXER      -  for every output sample it reads each channel's sample
                      at the right speed, scales it by the volume, adds them up.

Structure (same names in ModPlayer.java and mod-audio.js):

    parse_mod()      bytes -> Song (title, samples, order list, patterns)
    Sample, Cell, Song, Channel     plain data
    ModPlayer        sequencer (do_tick, process_row, process_tick_effects,
                     playback_period, advance_row) and mixer (fill, mix_channel)
    make_test_mod()  writes a small MOD file into memory, for testing
"""

import math
import struct
import sys

import numpy as np

AMIGA_CLOCK = 3546895.0            # PAL Amiga: a sample plays at AMIGA_CLOCK / period Hz
MIN_PERIOD, MAX_PERIOD = 113, 856  # B-3 .. C-1, the ProTracker note range
ROWS_PER_PATTERN = 64

# ================================================================ data classes
class Sample:
    """One instrument: an 8-bit recording plus loop points and default volume."""
    def __init__(self, name, length, finetune, volume, loop_start, loop_length):
        self.name = name
        self.length = length              # in bytes = in sample values
        self.finetune = finetune          # -8..7, eighths of a semitone
        self.volume = volume              # 0..64
        self.loop_start = loop_start
        self.loop_length = loop_length    # <= 2 means "no loop"
        self.loop_end = 0
        self.looping = False
        self.data = np.zeros(1, np.float32)

    def set_pcm(self, raw):
        """Store the sound as float32 -1..1, plus ONE extra value at the end so
        the interpolation may always read data[index + 1] (see BIBLE 5c.6)."""
        pcm = np.frombuffer(raw, dtype=np.int8).astype(np.float32) / 128.0
        self.length = len(pcm)
        self.looping = self.loop_length > 2 and self.loop_start < self.length
        if self.looping:
            self.loop_end = min(self.loop_start + self.loop_length, self.length)
            self.loop_length = self.loop_end - self.loop_start
            pcm = pcm[:self.loop_end]                           # data after the loop is never heard
            after_end = pcm[self.loop_start:self.loop_start + 1]  # after the loop end comes the loop start
        else:
            after_end = np.zeros(1, np.float32)
        self.data = np.concatenate([pcm, after_end])

class Cell:
    """One cell of a pattern: what one channel does on one row."""
    def __init__(self, sample, period, effect, param):
        self.sample = sample      # 0 = keep current instrument, 1..31 = use this one
        self.period = period      # 0 = no new note, else the pitch (BIBLE 5c.4)
        self.effect = effect      # 0..15
        self.param = param        # 0..255

class Song:
    def __init__(self):
        self.title = ''
        self.samples = []         # 31 Sample objects
        self.length = 0           # how many entries of `orders` are used
        self.orders = []          # 128 pattern numbers
        self.channels = 4
        self.patterns = []        # patterns[p][row][channel] -> Cell

def be16(data, pos):
    """Read a big-endian 16-bit number (most significant byte first)."""
    return (data[pos] << 8) | data[pos + 1]

def parse_mod(data):
    """Turn the bytes of a .mod file into a Song.  Offsets: BIBLE 5c.2."""
    song = Song()
    song.title = data[0:20].decode('latin-1').rstrip('\0 ')
    pos = 20
    for _ in range(31):                                   # 31 sample headers, 30 bytes each
        name = data[pos:pos + 22].decode('latin-1').rstrip('\0 ')
        length = be16(data, pos + 22) * 2
        finetune = data[pos + 24] & 15
        if finetune > 7:
            finetune -= 16                                # 8..15 mean -8..-1
        volume = min(data[pos + 25], 64)
        loop_start = be16(data, pos + 26) * 2
        loop_length = be16(data, pos + 28) * 2
        song.samples.append(Sample(name, length, finetune, volume, loop_start, loop_length))
        pos += 30
    song.length = data[950]
    song.orders = list(data[952:1080])
    signature = data[1080:1084].decode('latin-1')
    if signature.endswith('CHN'):
        song.channels = int(signature[0])
    elif signature.endswith('CH'):
        song.channels = int(signature[:2])
    number_of_patterns = max(song.orders) + 1
    pos = 1084
    for _ in range(number_of_patterns):
        rows = []
        for _ in range(ROWS_PER_PATTERN):
            row = []
            for _ in range(song.channels):
                b0, b1, b2, b3 = data[pos:pos + 4]
                pos += 4
                row.append(Cell((b0 & 0xF0) | (b2 >> 4),          # sample number
                                ((b0 & 0x0F) << 8) | b1,          # period
                                b2 & 0x0F,                        # effect
                                b3))                              # parameter
            rows.append(row)
        song.patterns.append(rows)
    for smp in song.samples:                              # sample data follows the patterns
        smp.set_pcm(data[pos:pos + smp.length])
        pos += smp.length
    return song

# ================================================================ playback state
class Channel:
    """Everything one channel remembers while playing."""
    def __init__(self, pan):
        self.gain_left = math.sqrt((1 - pan) / 2)     # constant-power panning
        self.gain_right = math.sqrt((1 + pan) / 2)
        self.sample = None            # the Sample being played
        self.sample_number = 0
        self.playing = False
        self.position = 0.0           # where we are inside the sample (fractional)
        self.period = 0.0             # current pitch (may slide)
        self.target_period = 0.0      # for tone portamento
        self.playback_period = 0.0    # period + vibrato + arpeggio, used by the mixer
        self.volume = 0               # 0..64
        self.effect = 0
        self.param = 0
        self.porta_speed = 0          # remembered 3xx speed
        self.vibrato_speed = 0
        self.vibrato_depth = 0
        self.vibrato_pos = 0          # 0..63, position around the sine
        self.delayed_period = 0       # for EDx note delay

class ModPlayer:
    """What audio_host.start_audio() needs: fill(frames) -> (left, right)."""
    def __init__(self, sample_rate, song):
        self.sample_rate = sample_rate
        self.load_song(song)

    def load_song(self, song):
        self.song = song
        # Amiga stereo: channels 1 and 4 on the left, 2 and 3 on the right ("LRRL").
        # Full separation is tiring on headphones, so we use 70 %.
        self.channels = [Channel(-0.7 if i % 4 in (0, 3) else 0.7) for i in range(song.channels)]
        self.channel_gain = 2.0 / song.channels
        self.speed = 6                # ticks per row
        self.bpm = 125                # tempo
        self.order = 0                # position in the order list
        self.row = 0
        self.tick = 0
        self.samples_until_tick = 0
        self.jump_order = None        # set by Bxx
        self.break_row = None         # set by Dxx

    def samples_per_tick(self):
        return int(self.sample_rate * 2.5 / self.bpm)        # 882 at 44100 Hz, 125 BPM

    # ------------------------------------------------------------ the mixer
    def fill(self, frames):
        left = np.zeros(frames, np.float32)
        right = np.zeros(frames, np.float32)
        done = 0
        while done < frames:
            if self.samples_until_tick == 0:
                self.do_tick()
                self.samples_until_tick = self.samples_per_tick()
            n = min(frames - done, self.samples_until_tick)     # up to the next tick
            for ch in self.channels:
                self.mix_channel(ch, n, left[done:done + n], right[done:done + n])
            done += n
            self.samples_until_tick -= n
        return left, right

    def mix_channel(self, ch, n, left, right):
        """Add n samples of this channel into left/right (numpy: all n at once)."""
        if not ch.playing or ch.playback_period <= 0:
            return
        smp = ch.sample
        step = AMIGA_CLOCK / ch.playback_period / self.sample_rate   # sample positions per output sample
        positions = ch.position + step * np.arange(n)
        ch.position += step * n
        if smp.looping:
            # positions past the loop end wrap back into the loop
            wrapped = smp.loop_start + (positions - smp.loop_start) % smp.loop_length
            positions = np.where(positions >= smp.loop_end, wrapped, positions)
            if ch.position >= smp.loop_end:
                ch.position = smp.loop_start + (ch.position - smp.loop_start) % smp.loop_length
            audible = 1.0
        else:
            audible = (positions < smp.length).astype(np.float32)   # silence after the end
            positions = np.minimum(positions, smp.length - 1)
            if ch.position >= smp.length:
                ch.playing = False
        index = positions.astype(np.int64)
        frac = (positions - index).astype(np.float32)
        # linear interpolation between the two nearest sample values
        sound = smp.data[index] * (1 - frac) + smp.data[index + 1] * frac
        sound *= audible * (ch.volume / 64.0) * self.channel_gain
        left += sound * ch.gain_left
        right += sound * ch.gain_right

    # ------------------------------------------------------------ the sequencer
    def do_tick(self):
        if self.tick == 0:
            self.process_row()
        else:
            self.process_tick_effects()
        for ch in self.channels:
            ch.playback_period = self.playback_period(ch)
        self.tick += 1
        if self.tick >= self.speed:
            self.tick = 0
            self.advance_row()

    def advance_row(self):
        if self.jump_order is not None or self.break_row is not None:
            self.order = self.jump_order if self.jump_order is not None else self.order + 1
            self.row = self.break_row or 0
            self.jump_order = self.break_row = None
        else:
            self.row += 1
            if self.row >= ROWS_PER_PATTERN:
                self.row = 0
                self.order += 1
        if self.order >= self.song.length:
            self.order = 0                                    # song finished: start again

    def process_row(self):
        pattern = self.song.patterns[self.song.orders[self.order]]
        for ch, cell in zip(self.channels, pattern[self.row]):
            self.process_cell(ch, cell)

    def finetuned(self, period, ch):
        if ch.sample is None:
            return float(period)
        return period * 2.0 ** (-ch.sample.finetune / 96.0)     # 8 finetune steps per semitone

    def trigger(self, ch, period, offset=0):
        """Start playing the channel's current sample at a pitch."""
        if ch.sample is None or ch.sample.length == 0:
            ch.playing = False
            return
        ch.period = ch.target_period = self.finetuned(period, ch)
        ch.position = float(min(offset, ch.sample.length - 1))
        ch.vibrato_pos = 0
        ch.playing = True

    def process_cell(self, ch, cell):
        ch.effect, ch.param = cell.effect, cell.param
        x, y = cell.param >> 4, cell.param & 15
        if cell.sample > 0:                                   # new instrument: take its default volume
            ch.sample_number = cell.sample
            ch.sample = self.song.samples[cell.sample - 1]
            ch.volume = ch.sample.volume
        if cell.period > 0:                                   # a new note
            if cell.effect in (3, 5):                         # tone portamento: slide to it, don't restart
                ch.target_period = self.finetuned(cell.period, ch)
            elif cell.effect == 0xE and x == 0xD:             # note delay: start later (tick y)
                ch.delayed_period = cell.period
            else:
                offset = cell.param * 256 if cell.effect == 9 else 0
                self.trigger(ch, cell.period, offset)
        # effects that act on tick 0
        if cell.effect == 3 and cell.param:
            ch.porta_speed = cell.param
        elif cell.effect == 4:
            if x: ch.vibrato_speed = x
            if y: ch.vibrato_depth = y
        elif cell.effect == 0xB:
            self.jump_order = cell.param
        elif cell.effect == 0xC:
            ch.volume = min(cell.param, 64)
        elif cell.effect == 0xD:
            self.break_row = min(x * 10 + y, ROWS_PER_PATTERN - 1)   # written in decimal
        elif cell.effect == 0xE:
            if x == 0x1: ch.period = max(ch.period - y, MIN_PERIOD)
            elif x == 0x2: ch.period = min(ch.period + y, MAX_PERIOD)
            elif x == 0xA: ch.volume = min(ch.volume + y, 64)
            elif x == 0xB: ch.volume = max(ch.volume - y, 0)
            elif x == 0xC and y == 0: ch.volume = 0
        elif cell.effect == 0xF and cell.param:
            if cell.param < 32:
                self.speed = cell.param
            else:
                self.bpm = cell.param

    def process_tick_effects(self):
        for ch in self.channels:
            e, p = ch.effect, ch.param
            x, y = p >> 4, p & 15
            if e == 0x1:
                ch.period = max(ch.period - p, MIN_PERIOD)
            elif e == 0x2:
                ch.period = min(ch.period + p, MAX_PERIOD)
            elif e == 0x3:
                self.tone_portamento(ch)
            elif e == 0x4:
                ch.vibrato_pos = (ch.vibrato_pos + ch.vibrato_speed) % 64
            elif e == 0x5:
                self.tone_portamento(ch)
                self.volume_slide(ch, x, y)
            elif e == 0x6:
                ch.vibrato_pos = (ch.vibrato_pos + ch.vibrato_speed) % 64
                self.volume_slide(ch, x, y)
            elif e == 0xA:
                self.volume_slide(ch, x, y)
            elif e == 0xE:
                if x == 0xC and self.tick == y:
                    ch.volume = 0
                elif x == 0xD and self.tick == y and ch.delayed_period:
                    self.trigger(ch, ch.delayed_period)
                    ch.delayed_period = 0

    def tone_portamento(self, ch):
        """Move the period towards the target by porta_speed, without overshooting."""
        if ch.period < ch.target_period:
            ch.period = min(ch.period + ch.porta_speed, ch.target_period)
        elif ch.period > ch.target_period:
            ch.period = max(ch.period - ch.porta_speed, ch.target_period)

    def volume_slide(self, ch, up, down):
        ch.volume = max(0, min(64, ch.volume + up - down))

    def playback_period(self, ch):
        """The period the mixer should use this tick: the note, plus vibrato
        wobble, plus the arpeggio's semitone jump."""
        period = ch.period
        if ch.effect in (4, 6):
            period += 2 * ch.vibrato_depth * math.sin(2 * math.pi * ch.vibrato_pos / 64)
        if ch.effect == 0 and ch.param:
            semitones = (0, ch.param >> 4, ch.param & 15)[self.tick % 3]
            period /= 2.0 ** (semitones / 12.0)
        return period

    # ------------------------------------------------------------ for displays / sliders
    def set_param(self, name, value):
        if name == 'BPM':
            self.bpm = int(value)

    def get_position(self):
        return {'order': self.order, 'pattern': self.song.orders[self.order],
                'row': self.row, 'speed': self.speed, 'bpm': self.bpm,
                'channels': [{'volume': ch.volume if ch.playing else 0,
                              'period': ch.playback_period, 'sample': ch.sample_number}
                             for ch in self.channels]}

# ================================================================ a test song
def make_test_mod():
    """WRITE a small MOD file into memory: the mirror image of parse_mod().
    Four synthesized instruments and one pattern that uses several effects."""
    def be16(value):
        return struct.pack('>H', value)

    def sample_header(name, pcm, volume, loop_length):
        return (name.encode().ljust(22, b'\0') + be16(len(pcm) // 2) + bytes([0, volume])
                + be16(0) + be16(loop_length // 2))

    def to_int8_bytes(values):
        return bytes(int(max(-128, min(127, v))) & 0xFF for v in values)

    # --- instruments
    saw = to_int8_bytes(i * 4 - 128 for i in range(64))                     # one sawtooth cycle (bass)
    tri = to_int8_bytes(-128 + i * 16 if i < 16 else 127 - (i - 16) * 16 for i in range(32))  # triangle (lead)
    seed, snare = 1, []
    for i in range(2000):                                                   # noise that dies away
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF                     # simple random generator
        snare.append((seed / 0x7FFFFFFF * 2 - 1) * 110 * math.exp(-i / 500))
    kick, phase = [], 0.0
    for i in range(3000):                                                   # sine whose pitch falls 400 -> 50 Hz
        phase += 2 * math.pi * (50 + 350 * math.exp(-i / 300)) / 16574
        kick.append(math.sin(phase) * 120 * math.exp(-i / 1000))
    snare, kick = to_int8_bytes(snare), to_int8_bytes(kick)

    # --- header
    header = b'DSM TEST SONG'.ljust(20, b'\0')
    header += sample_header('bass saw', saw, 48, 64)
    header += sample_header('lead triangle', tri, 36, 32)
    header += sample_header('snare', snare, 48, 2)          # loop length 2 bytes = no loop
    header += sample_header('kick', kick, 64, 2)
    header += sample_header('', b'', 0, 2) * 27             # the other 27 samples are empty
    header += bytes([1, 127]) + bytes(128)                  # song length 1, restart, orders = all 0
    header += b'M.K.'

    # --- one pattern: a 16-row riff repeated 4 times.  Periods: BIBLE 5c.4.
    C2, DS2, F2, C3, DS3, F3, G3 = 428, 360, 320, 214, 180, 160, 143
    #        row, channel, period, sample, effect, param
    riff = [
        (0, 0, C2, 1, 0x0, 0x00),           # bass
        (2, 0, C2, 1, 0xC, 0x20),           #   quieter repeat (set volume 32)
        (4, 0, C2, 1, 0x0, 0x00),
        (6, 0, DS2, 1, 0x0, 0x00),
        (8, 0, F2, 1, 0x0, 0x00),
        (10, 0, F2, 1, 0xC, 0x20),
        (12, 0, DS2, 1, 0x0, 0x00),
        (14, 0, C2, 0, 0x3, 0x08),          #   slide down to C-2 (tone portamento)
        (0, 1, C3, 2, 0x4, 0x63),           # lead with vibrato (speed 6, depth 3)
        (1, 1, 0, 0, 0x4, 0x00), (2, 1, 0, 0, 0x4, 0x00), (3, 1, 0, 0, 0x4, 0x00),
        (4, 1, DS3, 2, 0x0, 0x00),
        (6, 1, G3, 2, 0x0, 0x00),
        (8, 1, F3, 2, 0x0, 0x37),           #   arpeggio 0-3-7 = minor chord
        (9, 1, 0, 0, 0x0, 0x37), (10, 1, 0, 0, 0x0, 0x37), (11, 1, 0, 0, 0x0, 0x37),
        (12, 1, C3, 2, 0xA, 0x02),          #   fade out (volume slide down 2 per tick)
        (13, 1, 0, 0, 0xA, 0x02), (14, 1, 0, 0, 0xA, 0x02), (15, 1, 0, 0, 0xA, 0x02),
        (0, 2, C3, 4, 0xF, 0x06),           # kick; also set speed 6
        (4, 2, C3, 4, 0x0, 0x00),
        (8, 2, C3, 4, 0x0, 0x00),
        (12, 2, C3, 4, 0x0, 0x00),
        (0, 3, 0, 0, 0xF, 0x7D),            # set tempo 125 BPM
        (2, 3, C3, 3, 0xC, 0x18),           # quiet snare as a hi-hat
        (4, 3, C3, 3, 0x0, 0x00),           # snare
        (6, 3, C3, 3, 0xC, 0x18),
        (10, 3, C3, 3, 0xC, 0x18),
        (12, 3, C3, 3, 0x0, 0x00),
        (14, 3, C3, 3, 0xC, 0x18),
    ]
    pattern = bytearray(ROWS_PER_PATTERN * 4 * 4)
    for bar in range(4):
        for row, ch, period, sample, effect, param in riff:
            offset = ((bar * 16 + row) * 4 + ch) * 4
            pattern[offset:offset + 4] = bytes([(sample & 0xF0) | (period >> 8), period & 0xFF,
                                                ((sample & 0x0F) << 4) | effect, param])
    return bytes(header) + bytes(pattern) + saw + tri + snare + kick

# ================================================================ main
if __name__ == '__main__':
    import time
    from audio_host import start_audio, SAMPLE_RATE
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'rb') as f:
            song = parse_mod(f.read())
    else:
        song = parse_mod(make_test_mod())
    print(f'"{song.title}"  {song.channels} channels, {len(song.patterns)} patterns, '
          f'{song.length} positions.  Ctrl+C stops.')
    for i, smp in enumerate(song.samples):
        if smp.length:
            print(f'  sample {i + 1:2d}: {smp.name:22s} {smp.length:6d} bytes'
                  + (f'  loop {smp.loop_start}+{smp.loop_length}' if smp.looping else ''))
    player = ModPlayer(SAMPLE_RATE, song)
    stream = start_audio(player)
    try:
        while True:
            time.sleep(0.1)
            print(f'\r  order {player.order:3d}   row {player.row:2d}   ', end='')
    except KeyboardInterrupt:
        pass
    stream.stop(); stream.close()
    print('\ndone')
