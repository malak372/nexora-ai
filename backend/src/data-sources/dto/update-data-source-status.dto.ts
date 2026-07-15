import { IsBoolean } from 'class-validator';

/**
 * DTO used to activate or deactivate a data source.
 *
 * A source cannot be activated unless an implemented
 * backend collector exists for its key.
 *
 * @author Malak
 */
export class UpdateDataSourceStatusDto {
  /**
   * New activation state.
   */
  @IsBoolean()
  isActive!: boolean;
}