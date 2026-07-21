import { ApiRequestType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/** Filters external API logs using extensible provider registry keys. @author Malak */
export class GetAiLogsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  providerKey?: string;

  @IsOptional()
  @IsEnum(ApiRequestType)
  requestType?: ApiRequestType;

  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    return value;
  })
  @IsBoolean()
  isSuccess?: boolean;
}
