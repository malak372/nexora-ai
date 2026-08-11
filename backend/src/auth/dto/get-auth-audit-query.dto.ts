import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { AuthAction } from '@prisma/client';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Administrator authentication-security filters.
 *
 * @author Eman
 */
export class GetAuthAuditQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(AuthAction)
  action?: AuthAction;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isSuccess?: boolean;
}