import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT authentication guard.
 *
 * Validates the access token using the registered JWT strategy
 * and attaches the authenticated user to the request.
 *
 * @author Eman
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') { }