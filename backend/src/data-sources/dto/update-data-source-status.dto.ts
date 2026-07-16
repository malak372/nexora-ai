import { IsBoolean } from 'class-validator';

/**
 * DTO used by administrators to activate
 * or deactivate a configured data source.
 *
 * Activation is allowed only when an operational
 * collector implementation exists in CollectorsFactory
 * for the corresponding DataSource.key.
 *
 * Example request body:
 *
 * {
 *   "isActive": true
 * }
 *
 * @author Malak
 */
export class UpdateDataSourceStatusDto {
  /**
   * New data-source activation state.
   *
   * true:
   * - Requests activation.
   * - Requires an implemented runtime collector.
   *
   * false:
   * - Deactivates the source.
   * - Prevents users from selecting it in new jobs.
   */
  @IsBoolean()
  isActive!: boolean;
}
