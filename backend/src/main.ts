import { ValidationPipe } from '@nestjs/common';

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
 * - Global DTO validation.
 * - Application port.
 *
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    /**
     * Preserves the original request body for providers
     * that require raw-body signature verification,
     * such as Stripe webhooks.
     */
    rawBody: true,
  });
     * Preserves the exact incoming request body.
     *
     * Required for payment providers that validate webhook
     * signatures against the original raw payload.
     */
    rawBody: true,
  });

  /**
   * Retrieve the underlying Express application with an explicit
   * type instead of allowing getInstance() to return any.
   */
  const expressApplication = app.getHttpAdapter().getInstance() as Express;

  /**
   * Trusts the first reverse proxy in front of the backend.
   *
   * This affects request IP resolution, protocol detection,
   * and secure-cookie behavior behind a proxy.
   */
  expressApplication.set('trust proxy', 1);

  /**
   * Parses Cookie headers.
   */
  app.use(cookieParser());

  /**
   * Adds a versioned prefix to application endpoints.
   */
  app.setGlobalPrefix('api/v1');

  /**
   * Allows the configured frontend to send authenticated requests
   * and secure guest-session cookies.
   */
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',

    credentials: true,
  });

  /**
   * Applies strict validation and transformation globally.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,

      /**
       * Rejects the request instead of silently removing
       * unknown properties.
       */
      forbidNonWhitelisted: true,

      transform: true,

      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  const port = Number(process.env.PORT) || 3000;

  await app.listen(port);
}

void bootstrap();
