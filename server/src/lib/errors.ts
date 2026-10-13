export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE'
  | 'IMPORT_IN_PROGRESS'
  | 'INVALID_STATE'
  | 'GONE'
  | 'PAYLOAD_TOO_LARGE'
  | 'EXPORT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** A 400 VALIDATION_ERROR about one field ('' for the request as a whole). */
export const invalidField = (path: string, message: string) =>
  new AppError('VALIDATION_ERROR', 400, 'Invalid request', [{ path, message }]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
