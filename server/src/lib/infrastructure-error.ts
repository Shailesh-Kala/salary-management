// SQLSTATE classes/codes and socket errors that mean "the database or network failed", not
// "this row is bad": connection (08), insufficient resources (53), operator intervention
// (57P), serialization failure and deadlock (40001, 40P01).
const SQLSTATE = /^(08|53|57P|40001$|40P01$)/;
const SOCKET = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);

/**
 * True when retrying the whole job may succeed; anything else is a problem with one row
 * (D-037), so that row is rejected and the job carries on.
 */
export function isInfrastructureError(err: unknown) {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && (SQLSTATE.test(code) || SOCKET.has(code))) return true;
  return /connection terminated/i.test(err.message);
}
