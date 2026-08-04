/**
 * Nexora AI application bootstrap.
 *
 * Starts and configures the backend application, including:
 * - Raw request-body preservation for webhook verification.
 * - Trusted reverse-proxy handling.
 * - HTTP cookie parsing.
 * - Cross-origin resource sharing with credentials.
 * - Global DTO validation and transformation.
 * - Swagger/OpenAPI documentation.
 * - Public uploads directory.
 * - Graceful application shutdown.
 * * @module main
 * @author Nexora AI Team
 */

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';

import cookieParser from 'cookie-parser';

import type { Express } from 'express';

import { join } from 'node:path';

import { AppModule } from './app.module';

import { GUEST_SESSION_COOKIE_NAME } from './utilities/constants/guest-session.constants';

/**
 * Default local frontend URL.
 *
 * This value is used only when FRONTEND_URL is not configured
 * inside the backend environment variables.
 */
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

/**
 * Default backend HTTP port.
 */
const DEFAULT_BACKEND_PORT = 3000;

/**
 * Starts and configures the Nexora AI backend application.
 *
 * @returns A promise that resolves after the HTTP server starts.
 */
async function bootstrap(): Promise<void> {
  /**
   * rawBody preserves the original incoming request payload.
   *
   * Payment providers such as Stripe require the exact raw body
   * when validating webhook signatures.
   */
  const app =
    await NestFactory.create<NestExpressApplication>(
      AppModule,
      {
        rawBody: true,
      },
    );

  const configService = app.get(ConfigService);

  /**
   * Retrieves the underlying Express application.
   *
   * This is required to configure Express-specific settings,
   * such as trusted reverse proxies.
   */
  const expressApplication =
    app.getHttpAdapter().getInstance() as Express;

  /**
   * Trusts the first reverse proxy in front of the backend.
   *
   * This affects:
   * - Client IP resolution.
   * - HTTPS protocol detection.
   * - Secure cookies when deployed behind a proxy.
   */
  expressApplication.set('trust proxy', 1);

  /**
   * Parses incoming Cookie headers.
   *
   * Parsed values become available through request.cookies.
   */
  app.use(cookieParser());

  /**
   * Reads one or more allowed frontend origins.
   *
   * FRONTEND_URL may contain multiple comma-separated URLs.
   *
   * Example:
   * FRONTEND_URL=http://localhost:3000,http://localhost:3001
   */
  const configuredFrontendUrls =
    configService.get<string>(
      'FRONTEND_URL',
      DEFAULT_FRONTEND_URL,
    );

  const allowedOrigins = configuredFrontendUrls
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  /**
   * Enables credentialed cross-origin requests.
   *
   * credentials must remain enabled so the frontend can send:
   * - Refresh-token cookies.
   * - Guest-session cookies.
   */
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ],
  });

  /**
   * Applies strict DTO validation globally.
   *
   * whitelist:
   * Removes properties not declared by the DTO.
   *
   * forbidNonWhitelisted:
   * Rejects requests containing unknown properties.
   *
   * transform:
   * Converts incoming values into DTO class instances.
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
   * Configures the Nexora AI OpenAPI document.
   */
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexora AI API')
    .setDescription(
      [
        'REST API documentation for the Nexora AI backend.',
        '',
        'Nexora AI provides:',
        '- Authentication and user management.',
        '- Community data collection.',
        '- NLP analysis and AI enhancement.',
        '- Software idea generation.',
        '- Credit and payment management.',
        '- Idea publication, ratings, voting, and feedback.',
        '- Administrative monitoring and analytics.',
      ].join('\n'),
    )
    .setVersion('1.0.0')

    /**
     * JWT access-token authentication.
     */
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter the JWT access token.',
      },
      'access-token',
    )

    /**
     * Refresh-token cookie authentication.
     */
    .addCookieAuth(
      'refresh_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
        description:
          'Refresh-token cookie used for session renewal.',
      },
      'refresh-token',
    )

    /**
     * Guest-session cookie authentication.
     *
     * The imported constant ensures Swagger uses the exact same
     * cookie name as the guest-session controller and services.
     */
    .addCookieAuth(
      GUEST_SESSION_COOKIE_NAME,
      {
        type: 'apiKey',
        in: 'cookie',
        name: GUEST_SESSION_COOKIE_NAME,
        description:
          'HTTP-only guest-session cookie used for guest idea generation.',
      },
      'guest-session',
    )
    .build();

  const swaggerDocument =
    SwaggerModule.createDocument(
      app,
      swaggerConfig,
    );

  /**
   * Exposes Swagger UI outside any API route prefix.
   *
   * Swagger UI:
   * http://localhost:3000/docs
   *
   * OpenAPI JSON:
   * http://localhost:3000/docs-json
   */
  SwaggerModule.setup(
    'docs',
    app,
    swaggerDocument,
    {
      jsonDocumentUrl: 'docs-json',
      customSiteTitle:
        'Nexora AI API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        docExpansion: 'none',
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    },
  );

  /**
   * Serves user-uploaded files publicly.
   *
   * Local directory:
   * <project-root>/uploads
   *
   * Public route:
   * /uploads/*
   */
  app.useStaticAssets(
    join(process.cwd(), 'uploads'),
    {
      prefix: '/uploads/',
    },
  );

  /**
   * Enables graceful resource cleanup when the application
   * receives a supported operating-system shutdown signal.
   */
  app.enableShutdownHooks();

  /**
   * Reads the backend port from environment variables.
   */
  const port = configService.get<number>(
    'PORT',
    DEFAULT_BACKEND_PORT,
  );

  /**
   * Starts the server on all available network interfaces.
   *
   * This allows access from:
   * - The local web frontend.
   * - Mobile devices on the same network.
   * - Docker or deployment infrastructure.
   */
  await app.listen(port, '0.0.0.0');

  const applicationUrl = await app.getUrl();

  console.log(
    `Nexora AI backend: ${applicationUrl}`,
  );

  console.log(
    `Swagger documentation: ${applicationUrl}/docs`,
  );
}

/**
 * Explicitly marks the bootstrap promise as intentionally ignored.
 */
void bootstrap();