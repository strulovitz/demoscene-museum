/*
 * random.js - a tiny random number generator with a SEED.
 *
 * Math.random() gives different numbers every time you run the program.
 * Demos want the SAME "random" texture every run, so we use a generator we
 * control: give it a seed (any number) and it produces the same sequence
 * forever.  This one is "mulberry32", a well-known 32-bit generator.
 * Usage:  const r = new SeededRandom(2001);  r.next()  -> 0.0 .. 1.0
 */

export class SeededRandom {
  constructor(seed) {
    this.state = seed >>> 0;            // keep it as a 32-bit unsigned number
  }

  next() {
    let t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}