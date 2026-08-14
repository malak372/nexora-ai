import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma service.
 *
 * The application uses Supabase's session pooler. Keeping the per-process
 * Prisma pool deliberately small prevents idea generation, WebSockets and
 * authenticated HTTP requests from exhausting the upstream session limit.
 *
 * Set PRISMA_CONNECTION_LIMIT when a deployment has a larger verified pool.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const configuredUrl = process.env.DATABASE_URL?.trim();
    const datasourceUrl = configuredUrl
      ? PrismaService.buildBoundedDatabaseUrl(configuredUrl)
      : undefined;

    const configuredMaxWait = Number.parseInt(
      process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? '10000',
      10,
    );
    const configuredTimeout = Number.parseInt(
      process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? '20000',
      10,
    );

    const maxWait = Number.isFinite(configuredMaxWait)
      ? Math.max(2_000, configuredMaxWait)
      : 10_000;
    const timeout = Number.isFinite(configuredTimeout)
      ? Math.max(5_000, configuredTimeout)
      : 20_000;

    super({
      ...(datasourceUrl
        ? {
            datasources: {
              db: { url: datasourceUrl },
            },
          }
        : {}),
      transactionOptions: {
        maxWait,
        timeout,
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private static buildBoundedDatabaseUrl(databaseUrl: string): string {
    try {
      const url = new URL(databaseUrl);
      const requestedLimit = Number.parseInt(
        process.env.PRISMA_CONNECTION_LIMIT ?? '4',
        10,
      );
      const safeLimit = Number.isFinite(requestedLimit)
        ? Math.min(5, Math.max(1, requestedLimit))
        : 4;

      const currentLimit = Number.parseInt(
        url.searchParams.get('connection_limit') ?? '',
        10,
      );

      if (!Number.isFinite(currentLimit) || currentLimit > safeLimit) {
        url.searchParams.set('connection_limit', String(safeLimit));
      }

      if (!url.searchParams.has('pool_timeout')) {
        url.searchParams.set('pool_timeout', '60');
      }

      return url.toString();
    } catch {
      // Preserve the original URL if a provider-specific connection string
      // cannot be parsed by the WHATWG URL implementation.
      return databaseUrl;
    }
  }
}