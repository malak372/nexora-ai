import { Controller, Get } from '@nestjs/common';

import { AppService } from './app.service';

/**
 * Root application controller.
 *
 * Handles the default API endpoint and provides a simple
 * response that can be used to confirm that the backend
 * application is running.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Returns the default application response.
   *
   * Endpoint:
   * GET /api/v1
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
