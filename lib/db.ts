// Shared PrismaClient singleton (HMR-safe on globalThis) used by both the
// match store and the accounts/credits layer — one connection pool per process.
import { PrismaClient } from '@prisma/client';

const g = globalThis as typeof globalThis & { __crixoPrisma?: PrismaClient };

export function db(): PrismaClient {
  return (g.__crixoPrisma ??= new PrismaClient());
}
