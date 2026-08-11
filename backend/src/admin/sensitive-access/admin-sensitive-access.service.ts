import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AdminSensitiveScope } from './dto/verify-admin-sensitive-access.dto';

const SENSITIVE_ACCESS_TTL_SECONDS = 10 * 60;

type SensitiveAccessPayload = {
  v: 1;
  sub: string;
  scope: AdminSensitiveScope;
  exp: number;
  nonce: string;
};

@Injectable()
export class AdminSensitiveAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async verifyPassword(
    adminId: string,
    password: string,
    scope: AdminSensitiveScope,
  ) {
    const administrator = await this.prisma.user.findFirst({
      where: {
        id: adminId,
        role: UserRole.ADMIN,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!administrator) {
      throw new UnauthorizedException('Administrator account is unavailable.');
    }

    const passwordMatches = await bcrypt.compare(
      password,
      administrator.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Incorrect administrator password.');
    }

    const expiresAt = new Date(
      Date.now() + SENSITIVE_ACCESS_TTL_SECONDS * 1000,
    );

    return {
      accessToken: this.signPayload({
        v: 1,
        sub: administrator.id,
        scope,
        exp: Math.floor(expiresAt.getTime() / 1000),
        nonce: randomBytes(12).toString('hex'),
      }),
      scope,
      expiresAt,
    };
  }

  assertAccess(
    token: string | undefined,
    adminId: string,
    requiredScope: AdminSensitiveScope,
  ): void {
    if (!token) {
      throw new ForbiddenException(
        'Password verification is required for this administrator workspace.',
      );
    }

    const payload = this.verifySignature(token);
    const now = Math.floor(Date.now() / 1000);

    if (
      !payload ||
      payload.v !== 1 ||
      payload.sub !== adminId ||
      payload.scope !== requiredScope ||
      payload.exp <= now
    ) {
      throw new ForbiddenException(
        'Sensitive administrator access has expired. Verify your password again.',
      );
    }
  }

  private signPayload(payload: SensitiveAccessPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.createSignature(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifySignature(token: string): SensitiveAccessPayload | null {
    const [encodedPayload, suppliedSignature, extraPart] = token.split('.');

    if (!encodedPayload || !suppliedSignature || extraPart) {
      return null;
    }

    const expectedSignature = this.createSignature(encodedPayload);
    const expectedBuffer = Buffer.from(expectedSignature);
    const suppliedBuffer = Buffer.from(suppliedSignature);

    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      return null;
    }

    try {
      return JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SensitiveAccessPayload;
    } catch {
      return null;
    }
  }

  private createSignature(encodedPayload: string): string {
    const secret =
      this.configService.get<string>('ADMIN_SENSITIVE_ACCESS_SECRET') ||
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');

    return createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');
  }
}
