import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';

/** Known error types become AppErrors; anything else is unexpected. */
function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_ERROR', 400, 'Invalid request', details);
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

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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
