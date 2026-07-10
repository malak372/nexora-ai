import { OmitType, PartialType } from '@nestjs/mapped-types';

import { CreateAiModelDto } from './create-ai-model.dto';

/**
 * DTO used by administrators to update editable AI-model metadata.
 *
 * All inherited properties are optional.
 *
 * isActive is intentionally excluded.
 *
 * Activation and deactivation must use:
 * - PATCH /ai-models/:id/activate
 * - PATCH /ai-models/:id/deactivate
 *
 * This prevents bypassing:
 * - Default-model protection.
 * - Dedicated audit actions.
 * - Health reset behavior.
 *
 * Default selection is also handled through:
 * - PATCH /ai-models/:id/default
 *
 * Operational health properties are never exposed through this DTO.
 *
 * @author Malak
 */
export class UpdateAiModelDto extends PartialType(
  OmitType(CreateAiModelDto, ['isActive'] as const),
) {}
