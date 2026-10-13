import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';

// Unique constraints whose violation means "this value is already taken".
const UNIQUE_FIELDS: Record<string, string> = {
  employees_employee_code_key: 'employeeCode',
  employees_email_key: 'email',
};

/** Known error types become AppErrors; anything else is unexpected. */
function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_ERROR', 400, 'Invalid request', details);
  }
  const pg = err as { code?: string; constraint?: string } | null;
  const field = pg?.code === '23505' ? UNIQUE_FIELDS[pg.constraint ?? ''] : undefined;
  if (field) {
    return new AppError('DUPLICATE', 409, `Another record already has this ${field}`, [
      { path: field, message: 'Already in use' },
    ]);
  }
  const type = (err as { type?: string } | null)?.type; // set by express.json()
  if (type === 'entity.parse.failed') {
    return new AppError('VALIDATION_ERROR', 400, 'Malformed JSON body');
  }
  if (type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body too large');
  }
  return null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Mid-stream (e.g. an export) the status is already sent; let Express close the connection.
  if (res.headersSent) {
    req.log.error({ err }, 'error after response started');
    next(err);
    return;
  }
  const requestId = String(req.id);
  const appError = toAppError(err);

  if (appError) {
    const { code, message, details } = appError;
    res.status(appError.status).json({
      error: { code, message, ...(details !== undefined && { details }), requestId },
    });
    return;
  }

  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
};
