import { PartialType } from '@nestjs/mapped-types';

import { CreateAiModelDto } from './create-ai-model.dto';

/**
 * DTO used by administrators to update AI model metadata.
 *
 * All fields are optional.
 *
 * Default selection is intentionally excluded and handled through:
 * PATCH /ai-models/:id/default
 *
 * @author Malak
 */
export class UpdateAiModelDto extends PartialType(CreateAiModelDto) {}