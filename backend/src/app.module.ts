import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';

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
 * - Global rate limiting layer
 *
 * Cache is configured globally with TTL for performance optimization.
 * Rate limiting is configured globally to protect sensitive endpoints
 * from excessive requests.
 */
@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 100000, 
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    AuthModule,
    PrismaModule,
    UsersModule,
    MailModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }