import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UserPermissionsService } from '../users/permissions/permissions.service';
import { UserValidationService } from '../users/validation/validation.service';

import { AdminIdeasController } from './controllers/admin-ideas.controller';
import { UserIdeasController } from './controllers/user-ideas.controller';

import { AdminIdeasService } from './services/admin-ideas.service';
import { UserIdeasService } from './services/user-ideas.service';

/**
 * Shared ideas domain module.
 *
 * Provides:
 * - Administrator idea monitoring.
 * - Administrator idea analytics.
 * - Authenticated-user idea retrieval.
 * - Access-aware idea output filtering.
 *
 * Future idea-generation and unlock workflows will also
 * be registered inside this module.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
  ],

  controllers: [
    AdminIdeasController,
    UserIdeasController,
  ],

  providers: [
    AdminIdeasService,
    UserIdeasService,
    UserValidationService,
    UserPermissionsService,
  ],

  exports: [
    AdminIdeasService,
    UserIdeasService,
  ],
})
export class IdeasModule {}