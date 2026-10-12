import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createPool } from '../src/db/pool.ts';
import { createUser, disableUser } from '../src/modules/auth/user-admin.ts';

const [command, email, name] = process.argv.slice(2);
const valid = (command === 'create' && email && name) || (command === 'disable' && email);

if (!valid || !email) {
  console.error('Usage: npm run user:create -- <email> "<name>" | npm run user:disable -- <email>');
  process.exit(1);
}

const db = createPool(loadConfig(process.env).DATABASE_URL);
try {
  if (command === 'create') {
    const password = randomBytes(18).toString('base64url');
    await createUser(db, { email, name: name!, password });
    console.log(`Created ${email}. Password (shown once — store it safely): ${password}`);
  } else {
    const disabled = await disableUser(db, email);
    console.log(disabled ? `Disabled ${email}; their sessions have ended.` : `No user ${email}`);
    process.exitCode = disabled ? 0 : 1;
  }
} finally {
  await db.end();
}
