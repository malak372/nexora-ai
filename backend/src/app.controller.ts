import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * Root application controller.
 *
 * Handles the default application endpoint.
 *
 *
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Returns the default application response.
   */
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
