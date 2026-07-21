import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { RefreshDto } from '../dto/refresh.dto';
import { AuthRefreshService } from './refresh.service';

const REFRESH_RATE_LIMIT_TTL_MS = 60_000;

/**
 * Controller responsible for authentication-token refresh operations.
 *
 * Issues a new access token and rotates the provided refresh token
 * when the current refresh token is valid.
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
   * Returns 200 OK because the operation rotates an existing
   * authentication session without creating a new API resource.
   *
   * Rate limit:
   * - 10 requests per minute.
   *
   * Endpoint:
   * POST /auth/refresh
   *
   * @param dto - Refresh-token request data.
   * @param request - Current HTTP request containing client metadata.
   * @returns New access token and rotated refresh token.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 10,
      ttl: REFRESH_RATE_LIMIT_TTL_MS,
    },
  })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.authRefreshService.refresh(dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
