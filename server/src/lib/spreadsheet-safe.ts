// Spreadsheets run cells starting with these as formulas (CSV/formula injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes a would-be formula with an apostrophe so spreadsheets show it as text. */
export const spreadsheetSafe = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);
