import { PrismaClient } from '@prisma/client';

// Use global singleton to prevent connection pool exhaustion
// when ts-node-dev respawns the process in development mode.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export const connect = async () => prisma.$connect();
export const disconnect = async () => prisma.$disconnect();