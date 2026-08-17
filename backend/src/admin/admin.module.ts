import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminInvitationAcceptanceController } from './administrators/controllers/admin-invitation-acceptance.controller';
import { AdministratorsController } from './administrators/controllers/administrators.controller';
import { AdministratorsService } from './administrators/administrators.service';
import { AiMonitoringController } from './ai-monitoring/ai-monitoring.controller';
import { AiMonitoringService } from './ai-monitoring/ai-monitoring.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { AdminSensitiveAccessController } from './sensitive-access/admin-sensitive-access.controller';
import { AdminSensitiveAccessService } from './sensitive-access/admin-sensitive-access.service';
import { AdminTeamChatController } from './team-chat/controllers/admin-team-chat.controller';
import {
  AdminTeamChatGateway,
  AdminTeamChatSocketAuthService,
} from './team-chat/gateways/admin-team-chat.gateway';
import { AdminTeamChatService } from './team-chat/services/admin-team-chat.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Groups all administrator-only features.
 *
 * @author Eman
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MailModule,
    AuditModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.getOrThrow<string>(
            'JWT_ACCESS_SECRET',
          ),
      }),
    }),
  ],

  controllers: [
    DashboardController,
    AiMonitoringController,
    UsersController,
    SettingsController,
    CommentsController,

    AdministratorsController,
    AdminInvitationAcceptanceController,

    AdminSensitiveAccessController,

    AdminTeamChatController,
  ],

  providers: [
    DashboardService,
    AiMonitoringService,
    UsersService,
    SettingsService,
    CommentsService,

    AdministratorsService,

    AdminSensitiveAccessService,

    AdminTeamChatService,
    AdminTeamChatSocketAuthService,
    AdminTeamChatGateway,
  ],
})
export class AdminModule { }