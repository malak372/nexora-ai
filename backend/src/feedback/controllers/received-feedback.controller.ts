import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { GetReceivedFeedbackQueryDto } from '../dto/get-received-feedback-query.dto';
import { ReceivedFeedbackService } from '../services/received-feedback.service';

/** Private endpoint for publication owners to view received feedback. @author Eman */
@Controller('users/publications')
@UseGuards(JwtAuthGuard)
export class ReceivedFeedbackController {
  constructor(private readonly service: ReceivedFeedbackService) {}

  @Get(':publicationId/received-feedback')
  findReceived(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' }))
    publicationId: string,
    @Query() query: GetReceivedFeedbackQueryDto,
  ) {
    return this.service.findReceived(user.id, publicationId, query);
  }
}
