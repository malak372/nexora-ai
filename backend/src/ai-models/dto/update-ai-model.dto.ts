import {
  OmitType,
  PartialType,
} from '@nestjs/mapped-types';

import { CreateAiModelDto } from './create-ai-model.dto';

/**
 * DTO used to update editable AI-model metadata.
 *
 * isActive is excluded because activation and deactivation use
 * dedicated endpoints with audit and default-model protection.
 *
 * @author Malak
 */
export class UpdateAiModelDto extends PartialType(
  OmitType(
    CreateAiModelDto,
    ['isActive'] as const,
  ),
) {}