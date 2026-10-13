// The built-in PDF fonts have no ₹ glyph, so amounts carry the currency code instead (D-047).
export const pdfAmount = (value: string, currency: string) =>
  `${currency} ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Runs `draw` on the document, ends it and resolves with the whole file. */
export function renderPdf(doc: PDFKit.PDFDocument, draw: (doc: PDFKit.PDFDocument) => void) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}
