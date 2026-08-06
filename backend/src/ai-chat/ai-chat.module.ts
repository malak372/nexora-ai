/**
 * Registers authenticated HTTP and Socket.IO AI chat capabilities.
 *
 * @author Eman
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PromptsModule } from '../prompts/prompts.module';
import { AiChatController } from './controllers/ai-chat.controller';
import { WsExceptionFilter } from './filters/ws-exception.filter';
import { AiChatGateway } from './gateways/ai-chat.gateway';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { AiChatAccessService } from './services/ai-chat-access.service';
import { AiChatContextService } from './services/ai-chat-context.service';
import { AiChatStreamService } from './services/ai-chat-stream.service';
import { AiChatTitleService } from './services/ai-chat-title.service';
import { AiChatService } from './services/ai-chat.service';
import { AiChatMessageReaderService } from './services/messages/ai-chat-message-reader.service';
import { AiChatMessageWriterService } from './services/messages/ai-chat-message-writer.service';

/**
 * AI chat feature module.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AiModule,
    PromptsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [AiChatController],
  providers: [
    AiChatGateway,
    WsJwtAuthGuard,
    WsExceptionFilter,
    AiChatAccessService,
    AiChatContextService,
    AiChatStreamService,
    AiChatTitleService,
    AiChatService,
    AiChatMessageReaderService,
    AiChatMessageWriterService,
  ],
  exports: [AiChatService, AiChatAccessService],
})
export class AiChatModule { }