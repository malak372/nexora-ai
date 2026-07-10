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
import { AuthRefreshService } from './refresh.service';

/**
 * Controller responsible for authentication token refresh operations.
 *
 * Handles issuing new access and refresh tokens using
 * a valid refresh token.
 *
 * Base route:
 * /auth/refresh
 *
 * @author Eman
 */
@Controller('auth/refresh')
export class RefreshController {
  constructor(private readonly authRefreshService: AuthRefreshService) {}

  /**
   * Refreshes authentication tokens using a valid refresh token.
   *
   * Returns 200 OK because this operation rotates tokens
   * without creating a new API resource.
   *
   * Endpoint:
   * POST /auth/refresh
   *
   * @param dto Refresh token request data.
   * @param req HTTP request metadata.
   * @returns New access token and refresh token.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authRefreshService.refresh(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
