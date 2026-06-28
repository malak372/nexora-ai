import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma service.
 *
 * Extends PrismaClient and manages the database
 * connection lifecycle by automatically connecting
 * when the application starts and disconnecting
 * when it shuts down.
 *
 * @author Eman
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  /**
   * Establishes the database connection when the module is initialized.
   */
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Closes the database connection when the module is destroyed.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}