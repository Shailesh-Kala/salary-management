import PDFDocument from 'pdfkit';
import type { Slip } from './slip.ts';

const LEFT = 50;
const RIGHT_COLUMN = 345;
const RIGHT_WIDTH = 200;

// The built-in PDF fonts have no ₹ glyph, so amounts carry the currency code instead.
const amount = (value: string, currency: string) =>
  `${currency} ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.parse(`${month}-01T00:00:00Z`),
  );

/** Renders a slip as an A4 PDF; nothing is stored (D-006, D-012). */
export function renderSlipPdf(slip: Slip, generatedAt: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: LEFT,
      info: {
        Title: `Salary slip ${slip.employee.employeeCode} ${slip.month}`,
        Author: 'Salary Management',
        CreationDate: generatedAt,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, LEFT, y);
      doc.text(value, RIGHT_COLUMN, y, { width: RIGHT_WIDTH, align: 'right' });
      doc.moveDown(0.4);
    };

    doc.font('Helvetica-Bold').fontSize(18).text('Salary slip');
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#555555')
      .text(`${monthLabel(slip.month)} (${slip.periodStart} to ${slip.periodEnd})`)
      .fillColor('#000000')
      .moveDown(1.5);

    const { employee } = slip;
    row('Employee', `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`);
    row('Job title', slip.jobTitle);
    row('Department', slip.department);
    row('Country', slip.countryName);
    if (slip.lastWorkingDay) row('Last working day', slip.lastWorkingDay);
    doc.moveDown();

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(`Earnings (${slip.currencyCode})`, LEFT)
      .moveDown(0.5);
    doc.fontSize(11);
    for (const line of slip.earnings) row(line.label, amount(line.amount, slip.currencyCode));
    doc
      .moveTo(LEFT, doc.y)
      .lineTo(RIGHT_COLUMN + RIGHT_WIDTH, doc.y)
      .stroke()
      .moveDown(0.5);
    row('Gross pay', amount(slip.grossPay, slip.currencyCode), true);

    doc
      .moveDown(2)
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#555555')
      .text(slip.notice, LEFT)
      .text(`Generated ${generatedAt.toISOString()}`, LEFT);
    doc.end();
  });
}
