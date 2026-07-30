import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BusinessModelTemplatesController } from './controllers/business-model-templates.controller';
import { BusinessModelTemplatesService } from './services/business-model-templates.service';

/**
 * Configures the business model templates feature.
 *
 * Responsibilities:
 * - Registers the controller responsible for handling
 *   business model template HTTP requests.
 * - Provides the service responsible for managing
 *   business model template operations.
 * - Imports PrismaModule to enable database access.
 * - Exports BusinessModelTemplatesService so it can be
 *   reused by other modules when required.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],
  controllers: [BusinessModelTemplatesController],
  providers: [BusinessModelTemplatesService],
  exports: [BusinessModelTemplatesService],
})
export class BusinessModelTemplatesModule {}
