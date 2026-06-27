import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Prisma module.
 *
 * Provides the PrismaService for database access
 * and makes it available to other application modules.
 *
 * @author Eman
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}