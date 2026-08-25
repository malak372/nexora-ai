import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AuditModule } from '../audit-logs/audit-logs.module';

import { CollectorsModule } from '../collectors/collectors.module';

import { DataCollectionController } from './data-collection.controller';

import { DataCollectionService } from './data-collection.service';
import { CollectorSourceHealthService } from './collector-source-health.service';

import { CollectionJobService } from './collection-jobs/collection-job.service';

import { SocialPostService } from './social-posts/social-post.service';

import { SocialCommentService } from './social-comments/social-comment.service';

/**
 * Module responsible for the standalone
 * Data Collection pipeline stage.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, CollectorsModule],

  controllers: [DataCollectionController],

  providers: [
    DataCollectionService,
    CollectorSourceHealthService,
    CollectionJobService,
    SocialPostService,
    SocialCommentService,
  ],

  exports: [DataCollectionService, CollectorSourceHealthService],
})
export class DataCollectionModule {}
