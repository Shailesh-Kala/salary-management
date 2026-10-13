import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { errorHandler } from './error-handler.ts';

function appThrowing(error: unknown) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: () => 'req-1' }));
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps an AppError to its status, code, message and details', async () => {
    const details = [{ path: 'version', message: 'Stale' }];
    const app = appThrowing(new AppError('VERSION_CONFLICT', 409, 'Record changed', details));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'VERSION_CONFLICT', message: 'Record changed', details, requestId: 'req-1' },
    });
  });

  it('omits details when the AppError has none', async () => {
    const app = appThrowing(new AppError('NOT_FOUND', 404, 'Employee not found'));

    const res = await request(app).get('/boom');

    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Employee not found', requestId: 'req-1' },
    });
  });

  it('maps a zod validation error to 400 with one detail per field', async () => {
    const schema = z.object({ email: z.email(), password: z.string() });
    const app = appThrowing(schema.safeParse({ email: 'nope' }).error);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid request' });
    expect(res.body.error.details).toEqual([
      { path: 'email', message: expect.any(String) },
      { path: 'password', message: expect.any(String) },
    ]);
  });

  it.each([
    ['employees_employee_code_key', 'employeeCode'],
    ['employees_email_key', 'email'],
  ])('maps a unique violation on %s to 409 DUPLICATE on %s', async (constraint, field) => {
    const pgError = Object.assign(new Error('duplicate key'), { code: '23505', constraint });
    const app = appThrowing(pgError);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'DUPLICATE',
      message: `Another record already has this ${field}`,
      details: [{ path: field, message: 'Already in use' }],
    });
  });

  it('hides unknown errors behind a generic 500 with no message or stack', async () => {
    const app = appThrowing(new Error('connection to db-password-123 failed'));

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong', requestId: 'req-1' },
    });
    expect(res.text).not.toContain('db-password-123');
    expect(res.text).not.toContain('at ');
  });
});

describe('errorHandler after the response has started', () => {
  it('closes the connection instead of appending a JSON error to a half-sent body', async () => {
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: () => 'req-1' }));
    app.get('/stream', (_req, res, next) => {
      res.status(200).write('partial,data\n');
      next(new Error('database went away mid-export'));
    });
    app.use(errorHandler);

    await expect(request(app).get('/stream')).rejects.toThrow(/aborted|socket hang up/);
  });
});
