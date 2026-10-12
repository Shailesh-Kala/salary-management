import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng.ts';

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed, within [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 1000 }, () => a());

    expect(Array.from({ length: 1000 }, () => b())).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('gives a different sequence for a different seed', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
