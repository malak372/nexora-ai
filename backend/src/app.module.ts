import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit-logs/audit-logs.module';

import { MailModule } from './mail/mail.module';

import { CollectorsModule } from './collectors/collectors.module';
import { DataCollectionModule } from './data collection/data-collection.module';
import { NlpModule } from './nlp/nlp.module';
import { PromptsModule } from './prompts/prompts.module';
import { AiModule  } from './ai/ai.module';
import {AiModelsModule} from './ai-models/ai-models.module';

/**
 * Root application module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

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
    AuditModule,
    AdminModule,
    DataCollectionModule,
    CollectorsModule,
    AiModule,
    AdminModule,
    NlpModule,
    PromptsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
