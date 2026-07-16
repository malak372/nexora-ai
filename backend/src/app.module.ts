import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AlertsModule } from './alerts/alerts.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { CollectorsModule } from './collectors/collectors.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { ContactMessagesModule } from './contact-messages/contact-messages.module';
import { DataCollectionModule } from './data collection/data-collection.module';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { FeedbackModule } from './feedback/feedback.module';
import { IdeasModule } from './ideas/ideas.module';
import { MailModule } from './mail/mail.module';
import { NlpModule } from './nlp/nlp.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromptsModule } from './prompts/prompts.module';
import { UsersModule } from './users/users.module';

/**
 * Root Nexora AI application module.
 *
 * Registers:
 * - Global configuration.
 * - Global application cache.
 * - Global request throttling.
 * - Core infrastructure modules.
 * - Application feature modules.
 */
@Module({
  imports: [
    /**
     * Loads environment variables and makes ConfigService
     * available throughout the application.
     */
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    /**
     * Registers one application-wide cache provider.
     *
     * The configured TTL is 100 seconds.
     */
    CacheModule.register({
      isGlobal: true,
      ttl: 100_000,
    }),

    /**
     * Defines the default application-wide rate limit.
     *
     * Each client may make up to 10 requests during
     * one 60-second window unless a route overrides it.
     */
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),

    /**
     * Infrastructure and application feature modules.
     */
    PrismaModule,
    AuthModule,
    UsersModule,
    MailModule,
    AuditModule,
    AdminModule,
    DataCollectionModule,
    CollectorsModule,
    DataSourcesModule,
    AiModule,
    NlpModule,
    PromptsModule,
    AlertsModule,
    ComplaintsModule,
    ContactMessagesModule,
    FeedbackModule,
    PaymentsModule,
    IdeasModule,
  ],

  controllers: [AppController],

  providers: [
    AppService,

    /**
     * Applies ThrottlerGuard globally.
     *
     * Importing ThrottlerModule alone defines the rate-limit
     * configuration but does not automatically protect routes.
     */
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
