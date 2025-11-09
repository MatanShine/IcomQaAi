import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export const connect = async () => prisma.$connect();
export const disconnect = async () => prisma.$disconnect();
