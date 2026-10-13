import { describe, expect, it } from 'vitest';
import { isInfrastructureError } from './infrastructure-error.ts';

const pgError = (code: string) => Object.assign(new Error('pg'), { code });

describe('isInfrastructureError', () => {
  it.each([
    ['lost connection (08006)', pgError('08006')],
    ['cannot connect (08001)', pgError('08001')],
    ['out of resources (53300)', pgError('53300')],
    ['admin shutdown (57P01)', pgError('57P01')],
    ['serialization failure (40001)', pgError('40001')],
    ['deadlock (40P01)', pgError('40P01')],
    ['socket reset', pgError('ECONNRESET')],
    ['connection refused', pgError('ECONNREFUSED')],
    ['timeout', pgError('ETIMEDOUT')],
    ['broken pipe', pgError('EPIPE')],
    ['pg connection terminated', new Error('Connection terminated unexpectedly')],
  ])('treats %s as infrastructure (retry the job)', (_case, error) => {
    expect(isInfrastructureError(error)).toBe(true);
  });

  it.each([
    ['unique violation (23505)', pgError('23505')],
    ['check violation (23514)', pgError('23514')],
    ['a bug', new TypeError("Cannot read properties of undefined (reading 'x')")],
    ['a thrown string', 'oops'],
    ['nothing', undefined],
  ])('treats %s as a row problem (reject the row)', (_case, error) => {
    expect(isInfrastructureError(error)).toBe(false);
  });
});
