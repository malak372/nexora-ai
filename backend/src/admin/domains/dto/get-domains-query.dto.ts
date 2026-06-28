import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for querying domains.
 *
 * Supports pagination, date range filtering,
 * and sorting options inherited from ListQueryDto.
 *
 * @author Malak
 */
export class GetDomainsQueryDto extends ListQueryDto {}