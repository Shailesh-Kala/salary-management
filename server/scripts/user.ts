import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db/pool.ts';
import {
  createUser,
  disableUser,
  enableUser,
  resetPassword,
} from '../src/modules/auth/user-admin.ts';

const USAGE = `Usage:
  npm run user:create -w server -- <email> "<name>"
  npm run user:reset-password -w server -- <email>
  npm run user:disable -w server -- <email>
  npm run user:enable -w server -- <email>`;

const [command, email, name] = process.argv.slice(2);
const known = ['create', 'reset-password', 'disable', 'enable'];
if (!command || !known.includes(command) || !email || (command === 'create' && !name)) {
  console.error(USAGE);
  process.exit(1);
}

const newPassword = () => randomBytes(18).toString('base64url');
const db = createPool(loadConfig(process.env).DATABASE_URL);

try {
  if (command === 'create') {
    const password = newPassword();
    await createUser(db, { email, name: name!, password });
    console.log(`Created ${email}. Password (shown once — store it safely): ${password}`);
  } else if (command === 'reset-password') {
    const password = newPassword();
    const found = await resetPassword(db, email, password);
    console.log(
      found
        ? `New password for ${email} (shown once — store it safely): ${password}\nTheir existing sessions have ended.`
        : `No user ${email}`,
    );
    process.exitCode = found ? 0 : 1;
  } else {
    const found = await (command === 'disable' ? disableUser : enableUser)(db, email);
    const done = command === 'disable' ? 'Disabled; their sessions have ended.' : 'Enabled.';
    console.log(found ? `${email}: ${done}` : `No user ${email}`);
    process.exitCode = found ? 0 : 1;
  }
} finally {
  await db.end();
}
