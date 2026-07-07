import { Module } from '@nestjs/common';
import { TextCleaningService } from './text-cleaning/text-cleaning.service';

@Module({
  providers: [TextCleaningService],
  exports: [TextCleaningService],
})
export class NlpModule {}
