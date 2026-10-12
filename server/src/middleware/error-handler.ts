import type { ErrorRequestHandler } from 'express';
import { AppError } from '../lib/errors.ts';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id);

  if (err instanceof AppError) {
    const { code, message, details } = err;
    res.status(err.status).json({
      error: { code, message, ...(details !== undefined && { details }), requestId },
    });
    return;
  }

  req.log.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
};
