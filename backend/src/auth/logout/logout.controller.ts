import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { RefreshDto } from '../dto/refresh.dto';
import { AuthLogoutService } from './logout.service';

/**
 * Controller responsible for user logout.
 *
 * Revokes the provided refresh token to terminate
 * the associated authenticated session.
 *
 * Base route:
 * /auth/logout
 *
 * @author Eman
 */
@Controller('auth/logout')
export class LogoutController {
  constructor(private readonly authLogoutService: AuthLogoutService) {}

  /**
   * Revokes the provided refresh token.
   *
   * Returns 200 OK because the operation updates an existing
   * authentication session without creating a new resource.
   *
   * Endpoint:
   * POST /auth/logout
   *
   * @param dto - Refresh token to revoke.
   * @param request - Current HTTP request containing client metadata.
   * @returns Logout confirmation message.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.authLogoutService.logout(dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
