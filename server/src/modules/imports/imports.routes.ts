import { Router } from 'express';
import multer from 'multer';
import type { ImportsService } from './imports.service.ts';
import { importFormSchema, MAX_FILE_BYTES } from './upload.ts';

// In memory: files are at most 5 MB and are stored in the database, never on disk.
const singleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
}).single('file');

export function importRoutes(imports: ImportsService) {
  const routes = Router();

  routes.get('/imports/template', (_req, res) => {
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="employee-import-template.csv"')
      .send(imports.template());
  });

  routes.post('/imports', singleFile, async (req, res) => {
    const form = importFormSchema.parse(req.body);
    res.status(202).json(await imports.upload(req.file, form, req.user!));
  });

  return routes;
}
