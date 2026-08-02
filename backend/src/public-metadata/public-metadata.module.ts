import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { PublicMetadataController } from './public-metadata.controller';
import { PublicMetadataService } from './public-metadata.service';

/**
 * Exposes safe public metadata required by guest and public interfaces.
 *
 * Imports PrismaModule because PublicMetadataService depends on PrismaService.
 *
 * @author Eman
 */
@Module({
    imports: [PrismaModule],
    controllers: [PublicMetadataController],
    providers: [PublicMetadataService],
    exports: [PublicMetadataService],
})
export class PublicMetadataModule { }