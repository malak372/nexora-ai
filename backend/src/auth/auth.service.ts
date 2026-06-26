import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import type { StringValue } from 'ms';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateAccessToken(user: {
    id: string;
    email: string;
    role: UserRole;
    accountStatus: AccountStatus;
  }) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret_nexora',
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as StringValue,
      },
    );
  }

  private async generateRefreshToken(userId: string) {
    const refreshToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return refreshToken;
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        role: UserRole.USER,
        accountStatus: AccountStatus.NORMAL,
        freeGenerationLimit: 3,
        freeGenerationsUsed: 0,
        creditBalance: 0,
      },
    });

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);

    return {
      message: 'Registered successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        freeGenerationLimit: user.freeGenerationLimit,
        freeGenerationsUsed: user.freeGenerationsUsed,
        creditBalance: user.creditBalance,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);

    return {
      message: 'Logged in successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        freeGenerationLimit: user.freeGenerationLimit,
        freeGenerationsUsed: user.freeGenerationsUsed,
        creditBalance: user.creditBalance,
      },
    };
  }

  async refresh(dto: RefreshDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const accessToken = await this.generateAccessToken(storedToken.user);

    return {
      accessToken,
    };
  }

  async logout(dto: RefreshDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Logged out successfully',
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
        creditBalance: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
