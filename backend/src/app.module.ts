import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';

/**
 * Root application module.
 *
 * Bootstraps the application and registers all feature modules.
 *
 * Includes:
 * - Authentication module
 * - Database (Prisma) module
 * - Users management module
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
      ttl: 10,
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
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }