import { Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { UnsupportedCollector } from '../base/unsupported.collector';

/**
 * Quora collector.
 *
 * Quora is intentionally marked as unsupported.
 *
 * Reason:
 * Quora does not provide an official public API for searching and
 * collecting questions, answers, comments, or engagement data.
 *
 * During technical evaluation, public scraping was tested using
 * browser automation. However, Quora frequently redirects public
 * search pages to login/sign-up screens and does not reliably expose
 * searchable content without authenticated access.
 *
 * Supporting Quora would require one or more of the following:
 * - Authenticated user sessions.
 * - Browser automation with stored cookies.
 * - Web scraping of unstable page structures.
 * - Handling login pages, anti-bot checks, or dynamic content.
 *
 * These approaches are not suitable for Nexora AI's current data
 * collection strategy because the project focuses on reliable,
 * publicly accessible, and maintainable data sources.
 *
 * Therefore, Quora remains registered as a known platform, but it is
 * excluded from automated collection until an official API or stable
 * public access method becomes available.
 *
 * @author Malak
 */
@Injectable()
export class QuoraCollector extends UnsupportedCollector {
  readonly sourceType = CollectionSourceType.QUORA;

  protected readonly platformName = 'Quora';
}
