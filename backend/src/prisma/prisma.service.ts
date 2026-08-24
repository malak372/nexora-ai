import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma service.
 *
 * The application uses Supabase's session pooler. Keeping the per-process
 * Prisma pool deliberately small prevents idea generation, WebSockets and
 * authenticated HTTP requests from exhausting the upstream session limit.
 *
 * PRISMA_CONNECTION_LIMIT may override the bounded default when a deployment
 * has a smaller or larger verified upstream session-pool allowance.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

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
    const configuredAttempts = Number.parseInt(
      process.env.PRISMA_CONNECT_ATTEMPTS ?? '5',
      10,
    );
    const attempts = Number.isFinite(configuredAttempts)
      ? Math.min(8, Math.max(1, configuredAttempts))
      : 5;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = PrismaService.isTransientConnectionError(message);

        if (!transient || attempt >= attempts) {
          throw error;
        }

        const delayMs = Math.min(4_000, 650 * attempt);
        this.logger.warn(
          `Database connection attempt ${attempt}/${attempts} failed transiently; retrying in ${delayMs}ms. ${PrismaService.summarizeConnectionError(message)}`,
        );
        await PrismaService.delay(delayMs);
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }


  private static isTransientConnectionError(message: string): boolean {
    return /(?:EMAXCONNSESSION|max clients reached|too many clients|P1001|can't reach database server|server has closed the connection|connection (?:closed|terminated|refused|reset)|timed? out|pool timeout)/iu.test(
      message,
    );
  }

  private static summarizeConnectionError(message: string): string {
    return message.replace(/\s+/gu, ' ').trim().slice(0, 240);
  }

  private static async delay(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private static buildBoundedDatabaseUrl(databaseUrl: string): string {
    try {
      const url = new URL(databaseUrl);
      const requestedLimit = Number.parseInt(
        process.env.PRISMA_CONNECTION_LIMIT ?? '5',
        10,
      );
      const safeLimit = Number.isFinite(requestedLimit)
        ? Math.min(8, Math.max(2, requestedLimit))
        : 5;

      const currentLimit = Number.parseInt(
        url.searchParams.get('connection_limit') ?? '',
        10,
      );

      /*
       * A three-connection pool was shown to starve authenticated HTTP work
       * while generation persistence and background writes overlap. Keep one
       * explicit bounded value per process so a connection_limit embedded in
       * DATABASE_URL cannot silently force the application below the configured
       * capacity. Deployments with a smaller upstream allowance can set
       * PRISMA_CONNECTION_LIMIT explicitly.
       */
      if (!Number.isFinite(currentLimit) || currentLimit !== safeLimit) {
        url.searchParams.set('connection_limit', String(safeLimit));
      }

      const currentPoolTimeout = Number.parseInt(
        url.searchParams.get('pool_timeout') ?? '',
        10,
      );
      if (!Number.isFinite(currentPoolTimeout) || currentPoolTimeout > 30) {
        url.searchParams.set('pool_timeout', '30');
      }

      const currentConnectTimeout = Number.parseInt(
        url.searchParams.get('connect_timeout') ?? '',
        10,
      );
      if (!Number.isFinite(currentConnectTimeout) || currentConnectTimeout > 10) {
        url.searchParams.set('connect_timeout', '10');
      }

      return url.toString();
    } catch {
      // Preserve the original URL if a provider-specific connection string
      // cannot be parsed by the WHATWG URL implementation.
      return databaseUrl;
    }
  }
}