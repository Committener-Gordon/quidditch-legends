/**
 * Seeded pseudo-randomness.
 *
 * Math.random() is banned from this package: a match must be replayable from its
 * stored seed forever, including after the engine is redeployed. xmur3 turns the
 * seed string into 32 bits of state, mulberry32 turns that into a stream.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index into `items`, drawn proportionally to `weights`. */
  weightedIndex(weights: readonly number[]): number;
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  normal(mean: number, sd: number): number;
  /** A derived stream, so adding a consumer here cannot shift another's draws. */
  fork(label: string): Rng;
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed);
  let a = seedFn();

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return Math.floor(next() * weights.length);
      let roll = next() * total;
      for (let i = 0; i < weights.length; i++) {
        roll -= Math.max(0, weights[i]!);
        if (roll <= 0) return i;
      }
      return weights.length - 1;
    },
    weightedPick: (items, weights) => items[rng.weightedIndex(weights)]!,
    normal: (mean, sd) => {
      // Box-Muller. u1 is nudged off zero so log() stays finite.
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    fork: (label) => createRng(`${seed}::${label}`),
  };

  return rng;
}

/** Stable seed for a fixture. Never derive one from the wall clock. */
export function fixtureSeed(matchId: string, seasonSalt: string): string {
  return `${seasonSalt}:${matchId}`;
}
