import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that protects routes using JWT authentication.
 *
 * This guard validates the JWT access token provided in the
 * request. If the token is valid, the authenticated user is
 * attached to the request object; otherwise, access is denied.
 *
 * @author Eman
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') { }