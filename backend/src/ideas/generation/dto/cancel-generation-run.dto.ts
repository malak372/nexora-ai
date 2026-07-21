import { Transform, type TransformFnParams } from 'class-transformer';

import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional request body used when cancelling an active
 * idea-generation run.
 *
 * Cancellation is cooperative:
 * - The run is marked as cancellation requested.
 * - The pipeline stops at the next safe checkpoint.
 * - An active external request may finish before cancellation
 *   becomes effective.
 *
 * The optional reason is intended for audit logging and
 * diagnostics. It is not currently stored on IdeaGenerationRun
 * because the Prisma model does not contain a cancellationReason
 * field.
 *
 * @author Malak
 */
export class CancelGenerationRunDto {
  /**
   * Optional user-provided cancellation reason.
   *
   * The controller or cancellation service may forward this
   * value to the audit-log system. It must not be assumed to be
   * persisted directly on IdeaGenerationRun.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: TransformFnParams): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalizedValue = value.trim();

    return normalizedValue || undefined;
  })
  reason?: string;
}
