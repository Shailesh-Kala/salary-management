/** Calendar arithmetic on 'YYYY-MM-DD' strings, in UTC so the local zone can't shift the day. */
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Last calendar day of a 'YYYY-MM' month (day 0 of the next month), e.g. '2024-02' → '2024-02-29'. */
export function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
}
