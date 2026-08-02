import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminFeedbackController } from './controllers/admin-feedback.controller';
import { ReceivedFeedbackController } from './controllers/received-feedback.controller';
import { UserFeedbackController } from './controllers/user-feedback.controller';
import { GuestFeedbackController } from './controllers/guest-feedback.controller';
import { AdminFeedbackService } from './services/admin-feedback.service';
import { ReceivedFeedbackService } from './services/received-feedback.service';
import { UserFeedbackService } from './services/user-feedback.service';

/** Publication ratings and private feedback module.
 * @author Eman 
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    AdminFeedbackController,
    UserFeedbackController,
    GuestFeedbackController,
    ReceivedFeedbackController,
  ],
  providers: [
    AdminFeedbackService,
    UserFeedbackService,
    ReceivedFeedbackService,
  ],
  exports: [UserFeedbackService, ReceivedFeedbackService],
})
export class FeedbackModule { }