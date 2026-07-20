import { Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { PublicPublicationsController } from './controllers/public-publications.controller';
import { UserPublicationsController } from './controllers/user-publications.controller';
import { IdeaPublicationAiService } from './services/idea-publication-ai.service';
import { IdeaPublicationQueryService } from './services/idea-publication-query.service';
import { IdeaPublicationService } from './services/idea-publication.service';

/**
 * Provides idea-publication management, discovery, and AI-assisted public
 * description generation.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [PublicPublicationsController, UserPublicationsController],
  providers: [
    IdeaPublicationService,
    IdeaPublicationQueryService,
    IdeaPublicationAiService,
  ],
  exports: [IdeaPublicationService, IdeaPublicationQueryService],
})
export class IdeaPublicationModule {}