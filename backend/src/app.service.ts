import { Injectable } from '@nestjs/common';

/**
 * Root application service.
 *
 * Provides the default response for the application.
 *
 * @author Eman
 */
@Injectable()
export class AppService {
  /**
   * Returns the default welcome message.
   */
  getHello(): string {
    return 'Hello World!';
  }
}