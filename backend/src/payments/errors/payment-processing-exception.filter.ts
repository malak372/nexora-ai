import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';

import { PaymentErrorCode } from './payment-error-code.enum';
import { PaymentProcessingError } from './payment-processing.error';

@Catch(PaymentProcessingError)
export class PaymentProcessingExceptionFilter implements ExceptionFilter {
  catch(exception: PaymentProcessingError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const statusCode = this.resolveStatusCode(exception.code);

    response.status(statusCode).json({
      statusCode,
      error: this.resolveErrorLabel(statusCode),
      message: exception.message,
      code: exception.code,
      details: exception.details,
    });
  }

  private resolveStatusCode(code: PaymentErrorCode): number {
    switch (code) {
      case PaymentErrorCode.PAYMENT_NOT_FOUND:
      case PaymentErrorCode.IDEA_NOT_FOUND:
      case PaymentErrorCode.SYSTEM_SETTINGS_NOT_FOUND:
        return HttpStatus.NOT_FOUND;

      case PaymentErrorCode.IDEA_ACCESS_DENIED:
        return HttpStatus.FORBIDDEN;

      case PaymentErrorCode.CURRENCY_RATE_UNAVAILABLE:
        return HttpStatus.SERVICE_UNAVAILABLE;

      case PaymentErrorCode.PAYMENT_SESSION_CREATION_FAILED:
      case PaymentErrorCode.INVALID_PAYMENT_SESSION_RESPONSE:
      case PaymentErrorCode.PAYMENT_PROCESSING_FAILED:
      case PaymentErrorCode.CREDIT_PURCHASE_PROCESSING_FAILED:
      case PaymentErrorCode.DIRECT_UNLOCK_PROCESSING_FAILED:
        return HttpStatus.BAD_GATEWAY;

      case PaymentErrorCode.PAYMENT_ALREADY_COMPLETED:
      case PaymentErrorCode.DUPLICATE_PROVIDER_PAYMENT:
      case PaymentErrorCode.DUPLICATE_PROVIDER_SESSION:
      case PaymentErrorCode.IDEA_ALREADY_UNLOCKED:
        return HttpStatus.CONFLICT;

      default:
        return HttpStatus.BAD_REQUEST;
    }
  }

  private resolveErrorLabel(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'Service Unavailable';
      case HttpStatus.BAD_GATEWAY:
        return 'Bad Gateway';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      default:
        return 'Bad Request';
    }
  }
}