import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Prisma module.
 *
 * Registers and exports PrismaService,
 * providing a shared database access layer
 * for all application modules.
 *
 * @author Eman
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule { }