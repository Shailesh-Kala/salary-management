/** Calendar arithmetic on 'YYYY-MM-DD' strings, in UTC so the local zone can't shift the day. */
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
