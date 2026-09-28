/** Small seeded PRNG (mulberry32) so demo data is reproducible. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max], inclusive. */
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    float(min: number, max: number) {
      return next() * (max - min) + min;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    chance(p: number) {
      return next() < p;
    },
    /** Picks using relative weights, e.g. weighted(["a","b"], [3,1]). */
    weighted<T>(items: readonly T[], weights: readonly number[]): T {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
