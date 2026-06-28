import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

/**
 * Handles authentication operations such as registration,
 * login, token refresh, logout, and retrieving the current user.
 *
 * @author Eman
 */
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * Registers a new user account.
   *
   * @param dto - User registration data.
   * @returns Newly registered user with authentication tokens.
   */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Authenticates a user.
   *
   * @param dto - User login credentials.
   * @returns Access and refresh tokens.
   */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Generates a new access token using a valid refresh token.
   *
   * @param dto - Refresh token request.
   * @returns New access token and refresh token.
   */
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * Logs out the authenticated user.
   *
   * Invalidates the provided refresh token.
   *
   * @param dto - Refresh token to revoke.
   * @returns Logout confirmation.
   */
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto);
  }

  /**
   * Returns the authenticated user's information.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns Authenticated user profile.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.authService.me(user.id);
  }
}