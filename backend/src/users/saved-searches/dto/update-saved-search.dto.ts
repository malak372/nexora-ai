import { PartialType } from '@nestjs/mapped-types';
import { CreateSavedSearchDto } from './create-saved-search.dto';

/**
 * Updates an authenticated user's saved idea-generation search.
 *
 * All fields are optional, while validation rules are inherited from the
 * creation DTO to keep create and update behavior consistent.
 *
 * @author Eman
 */
export class UpdateSavedSearchDto extends PartialType(CreateSavedSearchDto) {}
