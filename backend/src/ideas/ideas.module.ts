import { Module } from '@nestjs/common';

import { FeedbackModule } from '../feedback/feedback.module';

import { IdeaGenerationModule } from './generation/idea-generation.module';
import { IdeaManagementModule } from './management/idea-management.module';
import { IdeaOutputsModule } from './outputs/idea-outputs.module';
import { IdeaPublicationModule } from './publication/idea-publication.module';
import { IdeaVotingModule } from './voting/idea-voting.module';

/**
 * Root bounded-context module for all idea-related capabilities.
 *
 * @author Malak
 */
@Module({
  imports: [
    IdeaGenerationModule,
    IdeaManagementModule,
    IdeaOutputsModule,
    IdeaPublicationModule,
    IdeaVotingModule,
    FeedbackModule,
  ],
  exports: [
    IdeaGenerationModule,
    IdeaManagementModule,
    IdeaOutputsModule,
    IdeaPublicationModule,
    IdeaVotingModule,
    FeedbackModule,
  ],
})
export class IdeasModule {}
