import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';

import { MailModule } from './mail/mail.module';

/**
 * Root application module.
 *
 * Bootstraps the application and registers all feature modules.
 *
 * Includes:
 * - Authentication module
 * - Database (Prisma) module
 * - Users management module
 * - Mail module
 * - Admin panel module
 * - Global caching layer
 *
 * Cache is configured globally with TTL for performance optimization.
 */
@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 100000, 
    }),
    AuthModule,
    PrismaModule,
    UsersModule,
    MailModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}