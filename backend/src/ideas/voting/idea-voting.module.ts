import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { PublicationVotesController } from './controllers/publication-votes.controller';
import { IdeaVotingService } from './services/idea-voting.service';

/**
 * Provides publication-voting functionality for the Ideas module.
 *
 * This module registers:
 * - The authenticated publication-voting controller.
 * - The voting business service.
 *
 * It imports the Prisma module to access the database and exports the
 * voting service so it can be reused by other modules when needed.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],

  controllers: [PublicationVotesController],

  providers: [IdeaVotingService],

  exports: [IdeaVotingService],
})
export class IdeaVotingModule {}
