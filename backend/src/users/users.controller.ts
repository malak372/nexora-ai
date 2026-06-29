import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GetUserCreditHistoryQueryDto } from './dto/get-user-credit-history-query.dto';
import { GetUserIdeasQueryDto } from './dto/get-user-ideas-query.dto';
import { GetUserNotificationsQueryDto } from './dto/get-user-notifications-query.dto';
import { GetUserPaymentsQueryDto } from './dto/get-user-payments-query.dto';
import { UserActivityService } from './services/user-activity.service';
import { UserCreditsService } from './services/user-credits.service';
import { UserIdeasService } from './services/user-ideas.service';
import { UserNotificationsService } from './services/user-notifications.service';
import { UserPaymentsService } from './services/user-payments.service';
import { UserProfileService } from './services/user-profile.service';
import { UserSummaryService } from './services/user-summary.service';

/**
 * Controller responsible for authenticated user management operations.
 *
 * This controller exposes endpoints for managing
 * the authenticated user's account, including:
 * - Profile management
 * - Free generation tracking
 * - Credit management
 * - Credit transaction history
 * - Payment history
 * - Generated ideas
 * - Notifications
 * - User summary
 * - Recent activity
 *
 * Base route:
 * /users
 *
 * All endpoints require JWT authentication.
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly userCreditsService: UserCreditsService,
    private readonly userPaymentsService: UserPaymentsService,
    private readonly userIdeasService: UserIdeasService,
    private readonly userNotificationsService: UserNotificationsService,
    private readonly userSummaryService: UserSummaryService,
    private readonly userActivityService: UserActivityService,
  ) {}

  /**
   * Retrieves the authenticated user's profile.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns User profile information.
   */
  @Get('profile')
  getProfile(@CurrentUser() user: { id: string }) {
    return this.userProfileService.getProfile(user.id);
  }

  /**
   * Updates the authenticated user's profile.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param dto - Profile information to update.
   * @returns Updated user profile.
   */
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userProfileService.updateProfile(user.id, dto);
  }

  /**
   * Retrieves the authenticated user's free generation usage.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns Free generation usage statistics.
   */
  @Get('free-generations')
  getFreeGenerations(@CurrentUser() user: { id: string }) {
    return this.userProfileService.getFreeGenerations(user.id);
  }

  /**
   * Retrieves the authenticated user's credit information.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns User credit balance, account status, and premium status.
   */
  @Get('credits')
  getCredits(@CurrentUser() user: { id: string }) {
    return this.userCreditsService.getCredits(user.id);
  }

  /**
   * Retrieves the authenticated user's credit transaction history.
   *
   * Supports pagination, date filtering, searching,
   * filtering by transaction type, and sorting.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param query - Query parameters for listing credit transactions.
   * @returns Paginated credit transaction history with pagination metadata.
   */
  @Get('credits/history')
  getCreditHistory(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserCreditHistoryQueryDto,
  ) {
    return this.userCreditsService.getCreditHistory(user.id, query);
  }

  /**
   * Retrieves the authenticated user's payment history.
   *
   * Supports pagination, date filtering, searching,
   * filtering by payment properties, and sorting.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param query - Query parameters for listing payment history.
   * @returns Paginated payment history with pagination metadata.
   */
  @Get('payments')
  getPaymentHistory(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentHistory(user.id, query);
  }

  /**
   * Retrieves the authenticated user's generated ideas.
   *
   * Supports pagination, date filtering, searching,
   * filtering by idea properties, and sorting.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param query - Query parameters for listing generated ideas.
   * @returns Paginated generated ideas with pagination metadata.
   */
  @Get('ideas')
  getGeneratedIdeas(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserIdeasQueryDto,
  ) {
    return this.userIdeasService.getGeneratedIdeas(user.id, query);
  }

  /**
   * Retrieves the authenticated user's notifications.
   *
   * Supports pagination, date filtering, searching,
   * filtering by read status and notification type, and sorting.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param query - Query parameters for listing notifications.
   * @returns Paginated user notifications with pagination metadata.
   */
  @Get('notifications')
  getNotifications(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserNotificationsQueryDto,
  ) {
    return this.userNotificationsService.getNotifications(user.id, query);
  }

  /**
   * Marks a specific notification as read.
   *
   * The notification must belong to the authenticated user.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param notificationId - Notification ID.
   * @returns Updated notification.
   */
  @Patch('notifications/:id/read')
  markNotificationAsRead(
    @CurrentUser() user: { id: string },
    @Param('id') notificationId: string,
  ) {
    return this.userNotificationsService.markNotificationAsRead(
      user.id,
      notificationId,
    );
  }

  /**
   * Marks all unread notifications as read.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns Success message and number of updated notifications.
   */
  @Patch('notifications/read-all')
  markAllNotificationsAsRead(@CurrentUser() user: { id: string }) {
    return this.userNotificationsService.markAllNotificationsAsRead(user.id);
  }

  /**
   * Retrieves a dashboard-style summary for the authenticated user.
   *
   * The summary includes profile basics, credit balance,
   * free generation usage, generated ideas count,
   * and unread notifications count.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns User account summary.
   */
  @Get('summary')
  getSummary(@CurrentUser() user: { id: string }) {
    return this.userSummaryService.getSummary(user.id);
  }

  /**
   * Retrieves the authenticated user's recent activity.
   *
   * Returns the latest generated idea, payment,
   * credit transaction, and alert or notification.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns Recent user activity overview.
   */
  @Get('activity')
  getActivity(@CurrentUser() user: { id: string }) {
    return this.userActivityService.getActivity(user.id);
  }
}