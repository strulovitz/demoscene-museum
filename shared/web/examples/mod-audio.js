/*
 * shared/web/examples/mod-audio.js  --  a ProTracker MOD replayer (BIBLE chapter 5c).
 * Audio module for audio-host.js.  Runs inside the AudioWorklet: no document,
 * no window, no fetch, no console.log.  The PAGE loads a .mod file and sends
 * it with setParam('MOD_DATA', arrayBuffer); until then the built-in test song plays.
 *
 * See mod_player.py for the full explanation.  Same structure and names:
 * parseMod, Sample, Cell, Song, Channel, ModPlayer (fill, doTick, processRow,
 * processTickEffects, playbackPeriod, advanceRow), makeTestMod.
 */
const AMIGA_CLOCK = 3546895;            // PAL Amiga: sample rate = AMIGA_CLOCK / period
const MIN_PERIOD = 113, MAX_PERIOD = 856;
const ROWS_PER_PATTERN = 64;
const SCOPE_LENGTH = 512;               // samples remembered per channel for the oscilloscopes

// ============================================================ data classes
/** One instrument: an 8-bit recording plus loop points and default volume. */
class Sample {
  constructor() {
    this.name = ''; this.length = 0; this.finetune = 0; this.volume = 0;
    this.loopStart = 0; this.loopLength = 0; this.loopEnd = 0; this.looping = false;
    this.data = new Float32Array(1);
  }
  /** Store as float -1..1 plus ONE extra value so interpolation may read data[i + 1]. */
  setPcm(file, offset) {
    this.length = Math.max(0, Math.min(this.length, file.length - offset));
    this.looping = this.loopLength > 2 && this.loopStart < this.length;
    let keep = this.length;
    if (this.looping) {
      this.loopEnd = Math.min(this.loopStart + this.loopLength, this.length);
      this.loopLength = this.loopEnd - this.loopStart;
      keep = this.loopEnd;                                   // data after the loop is never heard
    }
    this.data = new Float32Array(keep + 1);
    for (let i = 0; i < keep; i++) this.data[i] = ((file[offset + i] << 24) >> 24) / 128;  // unsigned byte -> signed
    this.data[keep] = this.looping ? this.data[this.loopStart] : 0;
  }
}

/** One cell of a pattern: what one channel does on one row. */
class Cell {
  constructor(sample, period, effect, param) {
    this.sample = sample; this.period = period; this.effect = effect; this.param = param;
  }
}

class Song {
  constructor() {
    this.title = ''; this.samples = []; this.length = 0; this.orders = []; this.channels = 4; this.patterns = [];
  }
}

const be16 = (d, p) => (d[p] << 8) | d[p + 1];                 // big-endian 16-bit number
const text = (d, p, n) => String.fromCharCode(...d.subarray(p, p + n)).replace(/\0/g, ' ').trim();

/** Turn the bytes (Uint8Array) of a .mod file into a Song.  Offsets: BIBLE 5c.2. */
function parseMod(data) {
  const song = new Song();
  song.title = text(data, 0, 20);
  let pos = 20;
  for (let i = 0; i < 31; i++) {                               // 31 sample headers, 30 bytes each
    const s = new Sample();
    s.name = text(data, pos, 22);
    s.length = be16(data, pos + 22) * 2;
    s.finetune = data[pos + 24] & 15;
    if (s.finetune > 7) s.finetune -= 16;                      // 8..15 mean -8..-1
    s.volume = Math.min(data[pos + 25], 64);
    s.loopStart = be16(data, pos + 26) * 2;
    s.loopLength = be16(data, pos + 28) * 2;
    song.samples.push(s);
    pos += 30;
  }
  song.length = data[950];
  song.orders = Array.from(data.subarray(952, 1080));
  const signature = text(data, 1080, 4);
  if (signature.endsWith('CHN')) song.channels = Number(signature[0]);
  else if (signature.endsWith('CH')) song.channels = Number(signature.slice(0, 2));
  const numberOfPatterns = Math.max(...song.orders) + 1;
  pos = 1084;
  for (let p = 0; p < numberOfPatterns; p++) {
    const rows = [];
    for (let r = 0; r < ROWS_PER_PATTERN; r++) {
      const row = [];
      for (let c = 0; c < song.channels; c++) {
        const b0 = data[pos], b1 = data[pos + 1], b2 = data[pos + 2], b3 = data[pos + 3];
        pos += 4;
        row.push(new Cell((b0 & 0xF0) | (b2 >> 4), ((b0 & 0x0F) << 8) | b1, b2 & 0x0F, b3));
      }
      rows.push(row);
    }
    song.patterns.push(rows);
  }
  for (const s of song.samples) {                              // sample data follows the patterns
    s.setPcm(data, pos);
    pos += s.length;
  }
  return song;
}

// ============================================================ playback state
/** Everything one channel remembers while playing. */
class Channel {
  constructor(pan) {
    this.gainLeft = Math.sqrt((1 - pan) / 2);                  // constant-power panning
    this.gainRight = Math.sqrt((1 + pan) / 2);
    this.sample = null; this.sampleNumber = 0; this.playing = false;
    this.position = 0; this.step = 0;
    this.period = 0; this.targetPeriod = 0; this.playbackPeriod = 0;
    this.volume = 0; this.effect = 0; this.param = 0;
    this.portaSpeed = 0; this.vibratoSpeed = 0; this.vibratoDepth = 0; this.vibratoPos = 0;
    this.delayedPeriod = 0;
    this.muted = false;
    this.scope = new Float32Array(SCOPE_LENGTH);               // last outputs (ring buffer), for displays
    this.scopePos = 0;
  }
  /** Read one interpolated sample value and advance (the mixer's inner step). */
  nextSample() {
    const s = this.sample;
    const index = Math.floor(this.position);
    const frac = this.position - index;
    const value = s.data[index] + (s.data[index + 1] - s.data[index]) * frac;
    this.position += this.step;
    if (s.looping) {
      while (this.position >= s.loopEnd) this.position -= s.loopLength;
    } else if (this.position >= s.length) {
      this.playing = false;
    }
    const out = this.muted ? 0 : value * (this.volume / 64);
    this.scope[this.scopePos] = out;
    this.scopePos = (this.scopePos + 1) % SCOPE_LENGTH;
    return out;
  }
}

class ModPlayer {
  constructor(sampleRate, song) {
    this.sampleRate = sampleRate;
    this.loadSong(song);
  }
  loadSong(song) {
    this.song = song;
    this.channels = [];
    for (let i = 0; i < song.channels; i++)                    // Amiga "LRRL" at 70 % separation
      this.channels.push(new Channel(i % 4 === 0 || i % 4 === 3 ? -0.7 : 0.7));
    this.channelGain = 2 / song.channels;
    this.speed = 6; this.bpm = 125;
    this.tempoFactor = 1;                   // the LISTENER's speed control, on top of the song's BPM
    this.order = 0; this.row = 0; this.tick = 0; this.samplesUntilTick = 0;
    this.jumpOrder = -1; this.breakRow = -1;
  }
  samplesPerTick() {                       // 882 at 44100 Hz, 125 BPM, factor 1
    return Math.floor(this.sampleRate * 2.5 / (this.bpm * this.tempoFactor));
  }

  // ------------------------------------------------------------ the mixer
  fill(left, right) {
    for (let i = 0; i < left.length; i++) {
      if (this.samplesUntilTick === 0) {
        this.doTick();
        this.samplesUntilTick = this.samplesPerTick();
      }
      let l = 0, r = 0;
      for (const ch of this.channels) {
        if (!ch.playing) continue;
        const v = ch.nextSample();
        l += v * ch.gainLeft;
        r += v * ch.gainRight;
      }
      left[i] = l * this.channelGain;
      right[i] = r * this.channelGain;
      this.samplesUntilTick--;
    }
  }

  // ------------------------------------------------------------ the sequencer
  doTick() {
    if (this.tick === 0) this.processRow();
    else this.processTickEffects();
    for (const ch of this.channels) {
      ch.playbackPeriod = this.playbackPeriod(ch);
      ch.step = ch.playbackPeriod > 0 ? AMIGA_CLOCK / ch.playbackPeriod / this.sampleRate : 0;
    }
    this.tick++;
    if (this.tick >= this.speed) {
      this.tick = 0;
      this.advanceRow();
    }
  }

  advanceRow() {
    if (this.jumpOrder >= 0 || this.breakRow >= 0) {
      this.order = this.jumpOrder >= 0 ? this.jumpOrder : this.order + 1;
      this.row = Math.max(this.breakRow, 0);
      this.jumpOrder = -1; this.breakRow = -1;
    } else {
      this.row++;
      if (this.row >= ROWS_PER_PATTERN) { this.row = 0; this.order++; }
    }
    if (this.order >= this.song.length) this.order = 0;        // song finished: start again
  }

  processRow() {
    const cells = this.song.patterns[this.song.orders[this.order]][this.row];
    this.channels.forEach((ch, c) => this.processCell(ch, cells[c]));
  }

  finetuned(period, ch) {
    if (!ch.sample) return period;
    return period * Math.pow(2, -ch.sample.finetune / 96);     // 8 finetune steps per semitone
  }

  trigger(ch, period, offset = 0) {
    if (!ch.sample || ch.sample.length === 0) { ch.playing = false; return; }
    ch.period = ch.targetPeriod = this.finetuned(period, ch);
    ch.position = Math.min(offset, ch.sample.length - 1);
    ch.vibratoPos = 0;
    ch.playing = true;
  }

  processCell(ch, cell) {
    ch.effect = cell.effect; ch.param = cell.param;
    const x = cell.param >> 4, y = cell.param & 15;
    if (cell.sample > 0) {                                     // new instrument: default volume
      ch.sampleNumber = cell.sample;
      ch.sample = this.song.samples[cell.sample - 1];
      ch.volume = ch.sample.volume;
    }
    if (cell.period > 0) {                                     // a new note
      if (cell.effect === 3 || cell.effect === 5) ch.targetPeriod = this.finetuned(cell.period, ch);
      else if (cell.effect === 0xE && x === 0xD) ch.delayedPeriod = cell.period;
      else this.trigger(ch, cell.period, cell.effect === 9 ? cell.param * 256 : 0);
    }
    switch (cell.effect) {                                     // effects that act on tick 0
      case 0x3: if (cell.param) ch.portaSpeed = cell.param; break;
      case 0x4: if (x) ch.vibratoSpeed = x; if (y) ch.vibratoDepth = y; break;
      case 0xB: this.jumpOrder = cell.param; break;
      case 0xC: ch.volume = Math.min(cell.param, 64); break;
      case 0xD: this.breakRow = Math.min(x * 10 + y, ROWS_PER_PATTERN - 1); break;   // decimal!
      case 0xE:
        if (x === 0x1) ch.period = Math.max(ch.period - y, MIN_PERIOD);
        else if (x === 0x2) ch.period = Math.min(ch.period + y, MAX_PERIOD);
        else if (x === 0xA) ch.volume = Math.min(ch.volume + y, 64);
        else if (x === 0xB) ch.volume = Math.max(ch.volume - y, 0);
        else if (x === 0xC && y === 0) ch.volume = 0;
        break;
      case 0xF:                                                // the SONG sets its tempo; obeyed every time
        if (cell.param && cell.param < 32) this.speed = cell.param;
        else if (cell.param >= 32) this.bpm = cell.param;
        break;
    }
  }

  processTickEffects() {
    for (const ch of this.channels) {
      const x = ch.param >> 4, y = ch.param & 15;
      switch (ch.effect) {
        case 0x1: ch.period = Math.max(ch.period - ch.param, MIN_PERIOD); break;
        case 0x2: ch.period = Math.min(ch.period + ch.param, MAX_PERIOD); break;
        case 0x3: this.tonePortamento(ch); break;
        case 0x4: ch.vibratoPos = (ch.vibratoPos + ch.vibratoSpeed) % 64; break;
        case 0x5: this.tonePortamento(ch); this.volumeSlide(ch, x, y); break;
        case 0x6: ch.vibratoPos = (ch.vibratoPos + ch.vibratoSpeed) % 64; this.volumeSlide(ch, x, y); break;
        case 0xA: this.volumeSlide(ch, x, y); break;
        case 0xE:
          if (x === 0xC && this.tick === y) ch.volume = 0;
          else if (x === 0xD && this.tick === y && ch.delayedPeriod) {
            this.trigger(ch, ch.delayedPeriod);
            ch.delayedPeriod = 0;
          }
          break;
      }
    }
  }

  tonePortamento(ch) {
    if (ch.period < ch.targetPeriod) ch.period = Math.min(ch.period + ch.portaSpeed, ch.targetPeriod);
    else if (ch.period > ch.targetPeriod) ch.period = Math.max(ch.period - ch.portaSpeed, ch.targetPeriod);
  }

  volumeSlide(ch, up, down) {
    ch.volume = Math.max(0, Math.min(64, ch.volume + up - down));
  }

  /** The note's period plus vibrato wobble plus the arpeggio's semitone jump. */
  playbackPeriod(ch) {
    let period = ch.period;
    if (ch.effect === 4 || ch.effect === 6)
      period += 2 * ch.vibratoDepth * Math.sin(2 * Math.PI * ch.vibratoPos / 64);
    if (ch.effect === 0 && ch.param) {
      const semitones = [0, ch.param >> 4, ch.param & 15][this.tick % 3];
      period /= Math.pow(2, semitones / 12);
    }
    return period;
  }

  // ------------------------------------------------------------ host interface
  setParam(name, value) {
    if (name === 'TEMPO_FACTOR') this.tempoFactor = value;                 // 0.5 .. 2.0
    else if (name === 'MOD_DATA') this.loadSong(parseMod(new Uint8Array(value)));
    else if (name.startsWith('MUTE_')) {                                   // MUTE_1 .. MUTE_n
      const ch = this.channels[Number(name.slice(5)) - 1];
      if (ch) ch.muted = Boolean(value);
    }
  }

  getPosition() {
    return {
      order: this.order, pattern: this.song.orders[this.order], row: this.row,
      speed: this.speed, bpm: this.bpm, title: this.song.title,
      channels: this.channels.map(ch => ({
        volume: ch.playing && !ch.muted ? ch.volume : 0, period: ch.playbackPeriod, sample: ch.sampleNumber,
      })),
    };
  }

  /** Copy each channel's recent output into the given arrays, oldest first (BIBLE 5d.4). */
  tapScopes(targets) {
    this.channels.forEach((ch, i) => {
      const t = targets[i];
      if (!t) return;
      for (let k = 0; k < t.length; k++) t[k] = ch.scope[(ch.scopePos + k) % SCOPE_LENGTH];
    });
  }
}

// ============================================================ a test song
/** WRITE a small MOD file into memory: the mirror image of parseMod(). */
function makeTestMod() {
  const toInt8 = v => Math.max(-128, Math.min(127, Math.trunc(v))) & 0xFF;
  // --- instruments
  const saw = new Uint8Array(64);                              // one sawtooth cycle (bass)
  for (let i = 0; i < 64; i++) saw[i] = toInt8(i * 4 - 128);
  const tri = new Uint8Array(32);                              // triangle (lead)
  for (let i = 0; i < 32; i++) tri[i] = toInt8(i < 16 ? -128 + i * 16 : 127 - (i - 16) * 16);
  const snare = new Uint8Array(2000);                          // noise that dies away
  let seed = 1;
  for (let i = 0; i < 2000; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7FFFFFFF; // simple random generator
    snare[i] = toInt8((seed / 0x7FFFFFFF * 2 - 1) * 110 * Math.exp(-i / 500));
  }
  const kick = new Uint8Array(3000);                           // sine whose pitch falls 400 -> 50 Hz
  let phase = 0;
  for (let i = 0; i < 3000; i++) {
    phase += 2 * Math.PI * (50 + 350 * Math.exp(-i / 300)) / 16574;
    kick[i] = toInt8(Math.sin(phase) * 120 * Math.exp(-i / 1000));
  }
  // --- header
  const bytes = [];
  const writeText = (s, width) => { for (let i = 0; i < width; i++) bytes.push(i < s.length ? s.charCodeAt(i) : 0); };
  const writeBe16 = v => { bytes.push((v >> 8) & 0xFF, v & 0xFF); };
  const sampleHeader = (name, lengthBytes, volume, loopLengthBytes) => {
    writeText(name, 22); writeBe16(lengthBytes / 2); bytes.push(0, volume); writeBe16(0); writeBe16(loopLengthBytes / 2);
  };
  writeText('DSM TEST SONG', 20);
  sampleHeader('bass saw', saw.length, 48, 64);
  sampleHeader('lead triangle', tri.length, 36, 32);
  sampleHeader('snare', snare.length, 48, 2);                  // loop length 2 bytes = no loop
  sampleHeader('kick', kick.length, 64, 2);
  for (let i = 0; i < 27; i++) sampleHeader('', 0, 0, 2);
  bytes.push(1, 127);                                          // song length 1, restart
  for (let i = 0; i < 128; i++) bytes.push(0);                 // orders: all pattern 0
  writeText('M.K.', 4);
  // --- one pattern: a 16-row riff repeated 4 times.  Periods: BIBLE 5c.4.
  const C2 = 428, DS2 = 360, F2 = 320, C3 = 214, DS3 = 180, F3 = 160, G3 = 143;
  const riff = [                     // row, channel, period, sample, effect, param
    [0, 0, C2, 1, 0x0, 0x00], [2, 0, C2, 1, 0xC, 0x20], [4, 0, C2, 1, 0x0, 0x00],      // bass
    [6, 0, DS2, 1, 0x0, 0x00], [8, 0, F2, 1, 0x0, 0x00], [10, 0, F2, 1, 0xC, 0x20],
    [12, 0, DS2, 1, 0x0, 0x00], [14, 0, C2, 0, 0x3, 0x08],                             //   slide to C-2
    [0, 1, C3, 2, 0x4, 0x63], [1, 1, 0, 0, 0x4, 0], [2, 1, 0, 0, 0x4, 0], [3, 1, 0, 0, 0x4, 0],   // lead, vibrato
    [4, 1, DS3, 2, 0x0, 0x00], [6, 1, G3, 2, 0x0, 0x00],
    [8, 1, F3, 2, 0x0, 0x37], [9, 1, 0, 0, 0x0, 0x37], [10, 1, 0, 0, 0x0, 0x37], [11, 1, 0, 0, 0x0, 0x37],  // arpeggio
    [12, 1, C3, 2, 0xA, 0x02], [13, 1, 0, 0, 0xA, 0x02], [14, 1, 0, 0, 0xA, 0x02], [15, 1, 0, 0, 0xA, 0x02],  // fade
    [0, 2, C3, 4, 0xF, 0x06], [4, 2, C3, 4, 0, 0], [8, 2, C3, 4, 0, 0], [12, 2, C3, 4, 0, 0],   // kick, speed 6
    [0, 3, 0, 0, 0xF, 0x7D],                                                              // tempo 125
    [2, 3, C3, 3, 0xC, 0x18], [4, 3, C3, 3, 0, 0], [6, 3, C3, 3, 0xC, 0x18],              // snare / hi-hat
    [10, 3, C3, 3, 0xC, 0x18], [12, 3, C3, 3, 0, 0], [14, 3, C3, 3, 0xC, 0x18],
  ];
  const pattern = new Uint8Array(ROWS_PER_PATTERN * 4 * 4);
  for (let bar = 0; bar < 4; bar++)
    for (const [row, ch, period, sample, effect, param] of riff) {
      const o = ((bar * 16 + row) * 4 + ch) * 4;
      pattern[o] = (sample & 0xF0) | (period >> 8);
      pattern[o + 1] = period & 0xFF;
      pattern[o + 2] = ((sample & 0x0F) << 4) | effect;
      pattern[o + 3] = param;
    }
  const file = new Uint8Array(bytes.length + pattern.length + saw.length + tri.length + snare.length + kick.length);
  let p = 0;
  for (const part of [Uint8Array.from(bytes), pattern, saw, tri, snare, kick]) { file.set(part, p); p += part.length; }
  return file;
}

export { parseMod, makeTestMod, ModPlayer };
export default {
  create(sampleRate) {
    return new ModPlayer(sampleRate, parseMod(makeTestMod()));
  },
};
