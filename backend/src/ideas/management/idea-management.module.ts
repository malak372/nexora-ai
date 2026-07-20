import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { AdminIdeasController } from './admin/controllers/admin-ideas.controller';
import { AdminIdeasService } from './admin/services/admin-ideas.service';
import { UserIdeasController } from './user/controllers/user-ideas.controller';
import { UserIdeasService } from './user/services/user-ideas.service';

/**
 * Idea-management bounded-context module.
 *
 * Owns authenticated user queries and administrator monitoring for
 * already persisted ideas. It intentionally does not execute generation.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],
  controllers: [UserIdeasController, AdminIdeasController],
  providers: [UserIdeasService, AdminIdeasService],
  exports: [UserIdeasService, AdminIdeasService],
})
export class IdeaManagementModule {}