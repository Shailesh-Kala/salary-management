import { type Request, Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import multer from 'multer';
import type { ImportsService } from './imports.service.ts';
import { importFormSchema, importHistoryQuery, MAX_FILE_BYTES } from './upload.ts';

// In memory: files are at most 5 MB and are stored in the database, never on disk.
const singleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
}).single('file');

function importId(req: Request) {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError('NOT_FOUND', 404, 'Import not found');
  return id.data;
}

export function importRoutes(imports: ImportsService) {
  const routes = Router();

  routes.get('/imports/template', (_req, res) => {
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="employee-import-template.csv"')
      .send(imports.template());
  });

  routes.get('/imports', async (req, res) => {
    const { page, pageSize } = importHistoryQuery.parse(req.query);
    res.json(await imports.list(page, pageSize));
  });

  routes.get('/imports/:id', async (req, res) => {
    res.json(await imports.get(importId(req)));
  });

  routes.get('/imports/:id/rejected.csv', async (req, res) => {
    const { filename, content } = await imports.rejectedCsv(importId(req));
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  });

  routes.post('/imports/:id/cancel', async (req, res) => {
    res.json(await imports.cancel(importId(req)));
  });

  routes.post('/imports/:id/confirm', async (req, res) => {
    res.status(202).json(await imports.confirm(importId(req), req.user!));
  });

  routes.post('/imports', singleFile, async (req, res) => {
    const form = importFormSchema.parse(req.body);
    res.status(202).json(await imports.upload(req.file, form, req.user!));
  });

  return routes;
}
