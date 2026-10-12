import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('verifies the password it hashed', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('stores the algorithm and parameters, and salts each hash', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');

    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('same password');
  });

  it.each([
    ['empty', ''],
    ['not a hash', 'plain-text-password'],
    ['wrong algorithm', 'bcrypt$32768$8$1$c2FsdA==$a2V5'],
    ['missing parts', 'scrypt$32768$8$1$c2FsdA=='],
    ['non-numeric parameters', 'scrypt$abc$8$1$c2FsdA==$a2V5'],
    ['truncated key', 'scrypt$32768$8$1$c2FsdA==$a2V5'],
  ])('rejects a malformed stored hash (%s) and warns without logging it', async (_case, stored) => {
    const log = { warn: vi.fn() };

    expect(await verifyPassword('anything', stored, log)).toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith('stored password hash is malformed');
  });

  it('rejects parameters scrypt refuses and warns', async () => {
    const log = { warn: vi.fn() };
    const valid = await hashPassword('pw');
    const badN = valid.replace('scrypt$32768$', 'scrypt$1000$'); // N must be a power of two

    expect(await verifyPassword('pw', badN, log)).toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('does not warn for a well-formed hash with a wrong password', async () => {
    const log = { warn: vi.fn() };
    const hash = await hashPassword('right');

    expect(await verifyPassword('wrong', hash, log)).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
