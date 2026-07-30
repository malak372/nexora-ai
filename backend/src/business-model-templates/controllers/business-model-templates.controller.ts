import { Controller, Get, Param, Res } from '@nestjs/common';

import type { Response } from 'express';

import { BusinessModelTemplatesService } from '../services/business-model-templates.service';

/**
 * Exposes read-only endpoints for business-model templates.
 *
 * Responsibilities:
 * - Return all active templates.
 * - Return one active template by key.
 * - Download a blank HTML representation of a template.
 *
 * @author Malak
 */
@Controller('business-model-templates')
export class BusinessModelTemplatesController {
  constructor(
    private readonly businessModelTemplatesService: BusinessModelTemplatesService,
  ) {}

  /**
   * Returns all active business-model templates.
   */
  @Get()
  findActive() {
    return this.businessModelTemplatesService.findActive();
  }

  /**
   * Returns one active business-model template by key.
   *
   * @param key Business-model template key.
   */
  @Get(':key')
  findByKey(@Param('key') key: string) {
    return this.businessModelTemplatesService.findActiveByKey(key);
  }

  /**
   * Downloads a blank HTML file for the requested template.
   *
   * @param key Business-model template key.
   * @param response Express response used to stream the generated file.
   */
  @Get(':key/download')
  async downloadBlankTemplate(
    @Param('key') key: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.businessModelTemplatesService.renderBlankHtml(key);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );

    response.send(file.html);
  }
}
