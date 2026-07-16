import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import cookieParser from 'cookie-parser';

import type { Express } from 'express';

import { AppModule } from './app.module';

/**
 * Starts and configures the Nexora AI backend application.
 *
 * Configures:
 * - Raw request-body preservation for webhook verification.
 * - Trusted reverse-proxy handling.
 * - Cookie parsing.
 * - Global API prefix.
 * - CORS with credentials.
 * - Global DTO validation and transformation.
 * - Graceful application shutdown hooks.
 * - Application port.
 */
async function bootstrap(): Promise<void> {
  /**
   * rawBody preserves the exact incoming request payload.
   *
   * This is required by payment providers such as Stripe
   * when validating webhook signatures.
   */
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  /**
   * Retrieves the underlying Express application with an
   * explicit type instead of allowing getInstance() to
   * return an untyped value.
   */
  const expressApplication = app.getHttpAdapter().getInstance() as Express;

  /**
   * Trusts the first reverse proxy in front of the backend.
   *
   * This affects:
   * - Request IP resolution.
   * - HTTPS protocol detection.
   * - Secure-cookie behavior behind a reverse proxy.
   */
  expressApplication.set('trust proxy', 1);

  /**
   * Parses Cookie request headers.
   */
  app.use(cookieParser());

  /**
   * Adds a versioned prefix to all application endpoints.
   */
  app.setGlobalPrefix('api/v1');

  /**
   * Allows the configured frontend application to send
   * authenticated requests and secure session cookies.
   */
  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
    credentials: true,
  });

  /**
   * Applies strict global DTO validation.
   *
   * whitelist:
   * Removes properties that are not declared in a DTO.
   *
   * forbidNonWhitelisted:
   * Rejects requests containing undeclared properties rather
   * than silently removing them.
   *
   * transform:
   * Converts request values into DTO class instances.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  /**
   * Enables graceful resource cleanup when the process receives
   * a supported operating-system shutdown signal.
   */
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port);
}

void bootstrap();
