import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
 * - Swagger/OpenAPI documentation.
 * - Graceful application shutdown hooks.
 * - Application port.
 *
 * @author Malak
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
   * Retrieves the underlying Express application using
   * an explicit Express type.
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
   * Parses incoming Cookie request headers and exposes
   * their values through request.cookies.
   */
  app.use(cookieParser());

  /**
   * Allows the configured frontend applications to send
   * authenticated cross-origin requests.
   *
   * FRONTEND_URL may contain one URL or multiple comma-separated URLs.
   *
   * Example:
   * FRONTEND_URL=http://localhost:3000,http://localhost:5173
   */
  const configuredFrontendUrls = configService.get<string>(
    'FRONTEND_URL',
    'http://localhost:3000',
  );

  const allowedOrigins = configuredFrontendUrls
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ],
  });

  /**
   * Applies strict global DTO validation.
   *
   * whitelist:
   * Removes properties that are not declared in a DTO.
   *
   * forbidNonWhitelisted:
   * Rejects requests containing undeclared properties.
   *
   * transform:
   * Converts incoming request values into DTO class instances.
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
   * Configures the OpenAPI document displayed by Swagger UI.
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
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter the JWT access token.',
      },
      'access-token',
    )
    .addCookieAuth(
      'refresh_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
        description: 'Refresh-token cookie used for session renewal.',
      },
      'refresh-token',
    )
    .addCookieAuth(
      'guest_session',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'guest_session',
        description: 'Guest-session cookie used for guest idea generation.',
      },
      'guest-session',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  /**
   * Exposes Swagger UI outside the global API prefix.
   *
   * Swagger UI:
   * http://localhost:3000/docs
   *
   * OpenAPI JSON:
   * http://localhost:3000/docs-json
   */
  SwaggerModule.setup('docs', app, swaggerDocument, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'Nexora AI API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  /**
   * Enables graceful resource cleanup when the process receives
   * a supported operating-system shutdown signal.
   */
  app.enableShutdownHooks();

  /**
   * Reads the application port from the environment.
   */
  const port = configService.get<number>('PORT', 3000);

  /**
   * Starts the HTTP server.
   */
  await app.listen(port);

  const applicationUrl = await app.getUrl();

  console.log(`Swagger documentation: ${applicationUrl}/docs`);
}

/**
 * Explicitly marks the returned promise as intentionally ignored.
 */
void bootstrap();
