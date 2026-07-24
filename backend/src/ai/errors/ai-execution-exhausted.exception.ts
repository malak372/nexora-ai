import { ServiceUnavailableException } from '@nestjs/common';

import type { AiProviderErrorCode } from './ai-provider-error-code.enum';

/**
 * Signals that every model/provider candidate for one logical AI operation
 * failed after applying retries, structured-output compatibility mode, and
 * provider fallback.
 *
 * The operation identifier is retained as an internal property so optional
 * callers such as the NLP enhancement layer can correlate their graceful
 * rule-based fallback with the detailed ExternalApiLog attempt records.
 * It is deliberately not added to the public HTTP response body.
 *
 * @author Malak
 */
export class AiExecutionExhaustedException extends ServiceUnavailableException {
  constructor(
    message: string,
    public readonly operationId: string,
    public readonly lastErrorCode?: AiProviderErrorCode,
  ) {
    super(message);

    this.name = AiExecutionExhaustedException.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
