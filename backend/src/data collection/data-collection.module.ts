import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit-logs/audit-logs.module';
import { CollectorsModule } from '../collectors/collectors.module';

import { DataCollectionController } from './data-collection.controller';
import { DataCollectionService } from './data-collection.service';
import { CollectionJobService } from './collection-jobs/collection-job.service';
import { SocialPostService } from './social-posts/social-post.service';
import { SocialCommentService } from './social-comments/social-comment.service';

/**
 * Module responsible for the data collection pipeline.
 *
 * Handles:
 * - Collection jobs.
 * - Platform collectors.
 * - Collected social posts.
 * - Collected social comments.
 * - Admin audit logging for collection actions.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, CollectorsModule],
  controllers: [DataCollectionController],
  providers: [
    DataCollectionService,
    CollectionJobService,
    SocialPostService,
    SocialCommentService,
  ],
  exports: [DataCollectionService],
})
export class DataCollectionModule {}