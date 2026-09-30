/**
 * Mark an account's email verified. Development only — production sends a link.
 *
 * Usage: node --experimental-strip-types scripts/verify-email.ts <email>
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = process.argv[2];

if (!email) {
  console.error('Usage: node --experimental-strip-types scripts/verify-email.ts <email>');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run in production.');
  process.exit(1);
}

const user = await prisma.user.update({
  where: { email },
  data: { emailVerified: new Date() },
}).catch(() => null);

console.log(user ? `Verified ${email}` : `No account found for ${email}`);
await prisma.$disconnect();
process.exit(user ? 0 : 1);
