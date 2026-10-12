import { describe, expect, it } from 'vitest';
import { createClock, dateInZone } from './clock.ts';

describe('dateInZone', () => {
  it('gives the calendar date in the organisation time zone, not UTC (T17)', () => {
    expect(dateInZone(new Date('2026-03-31T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-04-01');
  });

  it('switches at local midnight (IST is UTC+05:30)', () => {
    expect(dateInZone(new Date('2026-03-31T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-03-31');
    expect(dateInZone(new Date('2026-03-31T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-04-01');
  });

  it('ignores the process time zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(dateInZone(new Date('2026-01-01T02:00:00Z'), 'UTC')).toBe('2026-01-01');
  });
});

describe('createClock', () => {
  it('derives today() from now() in the configured zone', () => {
    const clock = createClock('Asia/Kolkata', () => new Date('2026-03-31T19:00:00Z'));

    expect(clock.now().toISOString()).toBe('2026-03-31T19:00:00.000Z');
    expect(clock.today()).toBe('2026-04-01');
  });
});
