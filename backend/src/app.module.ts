import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { CollectorsModule } from './collectors/collectors.module';
import { DataCollectionModule } from './data collection/data-collection.module';
import { MailModule } from './mail/mail.module';
import { NlpModule } from './nlp/nlp.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromptsModule } from './prompts/prompts.module';
import { UsersModule } from './users/users.module';
import { AlertsModule } from './alerts/alerts.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { ContactMessagesModule } from './contact-messages/contact-messages.module';

/**
 * Root application module.
 *
 * Registers global infrastructure and application feature modules.
 *
 * @author Malak
 */
@Module({
  imports: [
    /**
     * Loads application environment variables globally.
     */
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    /**
     * Registers the global application cache.
     */
    CacheModule.register({
      isGlobal: true,
      ttl: 100000,
    }),

    /**
     * Applies a default application-wide request limit.
     */
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),

    /**
     * Core infrastructure and feature modules.
     */
    AuthModule,
    PrismaModule,
    UsersModule,
    MailModule,
    AuditModule,
    AdminModule,
    DataCollectionModule,
    CollectorsModule,
    AiModule,
    NlpModule,
    PromptsModule,
    AlertsModule,
    ComplaintsModule,
    ContactMessagesModule,
  ],

  controllers: [AppController],

  providers: [AppService],
})
export class AppModule {}
