export type Clock = {
  now(): Date;
  /** Calendar date ('YYYY-MM-DD') in the organisation's time zone (D-039). */
  today(): string;
};

export function dateInZone(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function createClock(timeZone: string, now: () => Date = () => new Date()): Clock {
  return { now, today: () => dateInZone(now(), timeZone) };
}
