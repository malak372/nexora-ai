import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    /**
     * Preserves the original request body for providers
     * that require raw-body signature verification,
     * such as Stripe webhooks.
     */
    rawBody: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      /**
       * Removes properties that are not declared in the DTO.
       */
      whitelist: true,

      /**
       * Rejects the request instead of silently removing
       * unknown properties.
       */
      forbidNonWhitelisted: true,

      /**
       * Applies class-transformer transformations.
       */
      transform: true,

      transformOptions: {
        /**
         * Numeric conversion is handled explicitly through
         * @Type(() => Number), avoiding unsafe implicit conversion.
         */
        enableImplicitConversion: false,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
