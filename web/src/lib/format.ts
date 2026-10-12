// en-IN groups thousands as lakhs/crores (₹20,00,000.00), as HR in India reads them.
const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string, currency: string) {
  let format = formatters.get(currency);
  if (!format) {
    format = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
    formatters.set(currency, format);
  }
  return format.format(Number(amount));
}
