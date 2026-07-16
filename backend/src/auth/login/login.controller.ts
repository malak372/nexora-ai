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

import { LoginDto } from '../dto/login.dto';
import { AuthLoginService } from './login.service';

/**
 * Controller responsible for user login.
 *
 * Handles user authentication by validating credentials
 * and issuing access and refresh tokens.
 *
 * Base route:
 * /auth/login
 *
 * @author Eman
 */
@Controller('auth/login')
export class LoginController {
  constructor(private readonly authLoginService: AuthLoginService) { }

  /**
   * Authenticates an active and verified user.
   *
   * Rate limit:
   * - 5 requests per minute.
   *
   * Endpoint:
   * POST /auth/login
   *
   * @param dto - User login credentials.
   * @param request - Current HTTP request containing client metadata.
   * @returns Access token, refresh token, and authenticated user data.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
    },
  })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authLoginService.login(dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
