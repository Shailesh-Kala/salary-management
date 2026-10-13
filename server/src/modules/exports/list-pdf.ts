import PDFDocument from 'pdfkit';
import { pdfAmount, renderPdf } from '../../lib/pdf.ts';
import type { EmployeeListItem } from '../employees/employees.repository.ts';

const MARGIN = 36;
const ROW_HEIGHT = 13;
const STATUS_LABELS = { active: 'Active', on_notice: 'On notice', exited: 'Exited' };

type Column = {
  title: string;
  width: number;
  align?: 'right';
  value: (e: EmployeeListItem, currency: string) => string;
};

// Widths add up to the landscape A4 width (842) minus the margins.
const columns = (currency: string): Column[] => [
  { title: 'Code', width: 70, value: (e) => e.employeeCode },
  { title: 'Name', width: 130, value: (e) => `${e.firstName} ${e.lastName}` },
  { title: 'Job title', width: 140, value: (e) => e.jobTitle },
  { title: 'Department', width: 110, value: (e) => e.department },
  { title: 'Country', width: 45, value: (e) => e.countryCode },
  { title: 'Status', width: 60, value: (e) => STATUS_LABELS[e.status] },
  {
    title: 'Annual (local)',
    width: 115,
    align: 'right',
    value: (e) => pdfAmount(e.annualSalary, e.currencyCode),
  },
  {
    title: `Annual (${currency})`,
    width: 100,
    align: 'right',
    value: (e) => pdfAmount(e.convertedAnnualSalary, currency),
  },
];

export type ListPdfMeta = {
  currency: string;
  ratesAsOf: string;
  filters: string;
  generatedAt: Date;
};

/** The filtered employee list as a landscape A4 table with page numbers (≤ 1,000 rows). */
export function renderEmployeeListPdf(rows: EmployeeListItem[], meta: ListPdfMeta) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: 'Employees export',
      Author: 'Salary Management',
      CreationDate: meta.generatedAt,
    },
  });
  const cols = columns(meta.currency);

  const drawRow = (cells: string[], bold = false) => {
    const y = doc.y;
    let x = MARGIN;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    cells.forEach((text, i) => {
      const col = cols[i]!;
      doc.text(text, x, y, {
        width: col.width - 4,
        align: col.align,
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    });
    doc.x = MARGIN;
    doc.y = y + ROW_HEIGHT;
  };
  const drawHeader = () => {
    drawRow(
      cols.map((c) => c.title),
      true,
    );
    doc
      .moveTo(MARGIN, doc.y - 3)
      .lineTo(doc.page.width - MARGIN, doc.y - 3)
      .stroke();
  };

  return renderPdf(doc, () => {
    doc.font('Helvetica-Bold').fontSize(16).text('Employees');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text(`${rows.length.toLocaleString('en-IN')} employees · ${meta.filters}`)
      .text(
        `Converted with rates as of ${meta.ratesAsOf} · generated ${meta.generatedAt.toISOString()}`,
      )
      .fillColor('#000000')
      .moveDown();
    drawHeader();

    const lastY = doc.page.height - MARGIN - 2 * ROW_HEIGHT;
    for (const e of rows) {
      if (doc.y > lastY) {
        doc.addPage();
        drawHeader();
      }
      drawRow(cols.map((c) => c.value(e, meta.currency)));
    }

    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing in the margin must not start a new page
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`Page ${i + 1} of ${count}`, MARGIN, doc.page.height - MARGIN / 2 - 4, {
          width: doc.page.width - 2 * MARGIN,
          align: 'right',
        });
    }
  });
}

const SORT_LABELS: Record<string, string> = {
  name: 'name',
  employeeCode: 'employee code',
  jobTitle: 'job title',
  department: 'department',
  country: 'country',
  hireDate: 'hire date',
  annualSalary: 'annual salary',
};

/** One readable line describing the filters, e.g. "Country IN · Status on_notice · sorted by name". */
export function describeFilters(f: {
  q?: string;
  country?: string;
  department?: string;
  jobTitle?: string;
  status?: string;
  sort: string;
  order: string;
}) {
  const parts = [
    f.country && `Country ${f.country}`,
    f.department && `Department ${f.department}`,
    f.jobTitle && `Job title ${f.jobTitle}`,
    f.status && `Status ${f.status}`,
    f.q && `Search "${f.q}"`,
  ].filter(Boolean);
  const sort = `sorted by ${SORT_LABELS[f.sort] ?? f.sort}${f.order === 'desc' ? ' (descending)' : ''}`;
  return [...(parts.length ? parts : ['All employees']), sort].join(' · ');
}
