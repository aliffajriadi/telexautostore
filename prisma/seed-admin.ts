import 'dotenv/config';
import argon2 from 'argon2';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';

async function seedAdmin(): Promise<void> {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin with email "${email}" already exists. Skipping.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await argon2.hash(password);
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      email,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  // Ensure registrationEnabled setting exists
  await prisma.setting.upsert({
    where: { key: 'registrationEnabled' },
    update: {},
    create: { key: 'registrationEnabled', value: 'true' },
  });

  console.log(`✅ Admin created: ${admin.username} (${admin.email})`);
  await prisma.$disconnect();
}

seedAdmin().catch((err) => {
  logger.error({ err }, 'Seed admin failed');
  process.exit(1);
});
