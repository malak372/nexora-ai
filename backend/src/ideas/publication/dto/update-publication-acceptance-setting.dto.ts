import { IsBoolean } from 'class-validator';

export class UpdatePublicationAcceptanceSettingDto {
    @IsBoolean()
    allowAdoption!: boolean;
}