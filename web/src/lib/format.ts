// Display only: INR in lakhs/crores (₹20,00,000.00), every other currency in thousands
// ($1,234,567.89). Files (CSV/Excel) keep plain numbers (D-049).
const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string, currency: string) {
  let format = formatters.get(currency);
  if (!format) {
    const locale = currency === 'INR' ? 'en-IN' : 'en-US';
    format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatters.set(currency, format);
  }
  return format.format(Number(amount));
}

/** '88.750000' → '88.75': trailing zeros dropped, up to 6 decimals, en-IN grouping. */
export const formatRate = (rate: string) =>
  Number(rate).toLocaleString('en-IN', { maximumFractionDigits: 6 });
