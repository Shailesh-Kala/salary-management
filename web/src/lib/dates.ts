/** Whole days from one 'YYYY-MM-DD' date to another, computed in UTC so no time zone shifts it. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
