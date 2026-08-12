/**
 * Voxidence application bootstrap.
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
 *
 * @module main
 * @author Voxidence Team
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
 */
const DEFAULT_FRONTEND_URL = 'http://localhost:3001';

/**
 * Default backend HTTP port.
 */
const DEFAULT_BACKEND_PORT = 3000;

/**
 * Returns true when the origin points to a local development frontend.
 */
function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1') {
      return true;
    }

    if (/^10\./.test(host) || /^192\.168\./.test(host)) {
      return true;
    }

    const private172Match = /^172\.(\d{1,2})\./.exec(host);
    if (private172Match) {
      const secondOctet = Number(private172Match[1]);
      return secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Starts and configures the Voxidence backend application.
 */
async function bootstrap(): Promise<void> {
  const app =
    await NestFactory.create<NestExpressApplication>(
      AppModule,
      {
        rawBody: true,
      },
    );

  const configService = app.get(ConfigService);

  const expressApplication =
    app.getHttpAdapter().getInstance() as Express;

  expressApplication.set('trust proxy', 1);

  app.use(cookieParser());

  const configuredFrontendUrls =
    configService.get<string>(
      'FRONTEND_URL',
      DEFAULT_FRONTEND_URL,
    );

  const allowedOrigins = configuredFrontendUrls
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const nodeEnvironment =
    configService.get<string>('NODE_ENV', 'development');

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (
        nodeEnvironment !== 'production' &&
        isLocalDevelopmentOrigin(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(
        new Error(`CORS blocked origin: ${origin}`),
        false,
      );
    },
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
      'X-Admin-Sensitive-Token',
    ],
  });

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

  const enableSwagger =
    configService.get<string>(
      'ENABLE_SWAGGER',
      'true',
    ) === 'true';

  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Voxidence API')
      .setDescription(
        [
          'REST API documentation for the Voxidence backend.',
          '',
          'Voxidence provides:',
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
          description:
            'Refresh-token cookie used for session renewal.',
        },
        'refresh-token',
      )
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

    SwaggerModule.setup(
      'docs',
      app,
      swaggerDocument,
      {
        jsonDocumentUrl: 'docs-json',
        customSiteTitle:
          'Voxidence API Documentation',
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
  }

  app.useStaticAssets(
    join(process.cwd(), 'uploads'),
    {
      prefix: '/uploads/',
      maxAge: configService.get<string>(
        'UPLOAD_CACHE_MAX_AGE',
        '1d',
      ),
      immutable:
        configService.get<string>('NODE_ENV') ===
        'production',
    },
  );

  app.enableShutdownHooks();

  const port = configService.get<number>(
    'PORT',
    DEFAULT_BACKEND_PORT,
  );

  await app.listen(port, '0.0.0.0');

  const applicationUrl = await app.getUrl();

  console.log(
    `Voxidence backend: ${applicationUrl}`,
  );

  if (enableSwagger) {
    console.log(
      `Swagger documentation: ${applicationUrl}/docs`,
    );
  }
}

void bootstrap();