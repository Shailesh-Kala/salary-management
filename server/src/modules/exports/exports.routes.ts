import { stringify } from 'csv-stringify';
import ExcelJS from 'exceljs';
import { type Response, Router } from 'express';
import { finished } from 'node:stream/promises';
import { z } from 'zod';
import { listEmployeesQuery } from '../employees/employee.schemas.ts';
import { AMOUNT_COLUMNS, csvRow, DATE_COLUMNS, exportHeader, xlsxRow } from './columns.ts';
import type { ExportsService } from './exports.service.ts';
import { describeFilters, renderEmployeeListPdf } from './list-pdf.ts';

const exportQuery = listEmployeesQuery
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(['csv', 'xlsx', 'pdf']) });

const emailedExportBody = listEmployeesQuery.omit({ page: true, pageSize: true });

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

type Export = Awaited<ReturnType<ExportsService['employees']>>;

async function streamCsv(res: Response, { currency, batches }: Export) {
  res.write('﻿'); // BOM, so Excel opens the UTF-8 file with the right characters
  const csv = stringify();
  csv.pipe(res);
  csv.write(exportHeader(currency));
  for await (const batch of batches) for (const employee of batch) csv.write(csvRow(employee));
  csv.end();
  await finished(res);
}

async function streamXlsx(res: Response, { currency, batches }: Export) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  const sheet = workbook.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1 }] });
  for (const column of DATE_COLUMNS) sheet.getColumn(column).numFmt = 'yyyy-mm-dd';
  // Plain numbers, no digit grouping, so they calculate and re-import cleanly (D-049).
  for (const column of AMOUNT_COLUMNS) sheet.getColumn(column).numFmt = '0.00';
  sheet.addRow(exportHeader(currency)).commit();
  for await (const batch of batches) {
    for (const employee of batch) sheet.addRow(xlsxRow(employee)).commit();
  }
  sheet.commit();
  await workbook.commit();
}

export function exportRoutes(exports: ExportsService) {
  const routes = Router();

  routes.get('/exports/employees', async (req, res) => {
    const { format, ...filters } = exportQuery.parse(req.query);
    const result = await exports.employees(filters, format, req.user!);
    const headers = {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    };

    if (format === 'pdf') {
      // Capped at 1,000 rows, so it is built in memory first and any failure is still a JSON error.
      const rows = [];
      for await (const batch of result.batches) rows.push(...batch);
      const pdf = await renderEmployeeListPdf(rows, {
        currency: result.currency,
        ratesAsOf: result.ratesAsOf,
        filters: describeFilters(filters),
        generatedAt: result.generatedAt,
      });
      res.set(headers).send(pdf);
      return;
    }
    res.status(200).set(headers);
    await (format === 'csv' ? streamCsv(res, result) : streamXlsx(res, result));
  });

  routes.post('/exports/employees/email', async (req, res) => {
    const filters = emailedExportBody.parse(req.body);
    res.status(202).json(await exports.requestEmailed(filters, req.user!));
  });

  return routes;
}
