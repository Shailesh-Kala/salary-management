import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

// scrypt with N=2^15, r=8 needs 32 MiB; Node's default maxmem is exactly that, so raise it.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MALFORMED = 'stored password hash is malformed';

type WarnLog = { warn(msg: string): void };

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Returns `scrypt$N$r$p$salt$key` (base64), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Never throws: a malformed stored hash is reported through `log` (without the hash) and fails verification. */
export async function verifyPassword(
  password: string,
  stored: string,
  log?: WarnLog,
): Promise<boolean> {
  const [algorithm, n, r, p, salt, key, ...rest] = stored.split('$');
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const expected = Buffer.from(key ?? '', 'base64');
  if (
    algorithm !== 'scrypt' ||
    rest.length > 0 ||
    !salt ||
    !Object.values(params).every(Number.isInteger) ||
    expected.length !== KEY_LENGTH
  ) {
    log?.warn(MALFORMED);
    return false;
  }

  try {
    const actual = await deriveKey(password, Buffer.from(salt, 'base64'), params);
    return timingSafeEqual(actual, expected);
  } catch {
    log?.warn(MALFORMED); // parameters scrypt refuses (e.g. N not a power of two, over maxmem)
    return false;
  }
}
