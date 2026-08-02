import { Injectable, Logger } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

interface DatabaseLanguageRow {
    code: string;
}

export interface PublicLanguageOption {
    code: LanguageCode;
    name: string;
}

const LANGUAGE_NAMES: Readonly<Record<LanguageCode, string>> = {
    [LanguageCode.ANY]: 'Auto detect',
    [LanguageCode.EN]: 'English',
    [LanguageCode.AR]: 'Arabic',
    [LanguageCode.FR]: 'French',
    [LanguageCode.ES]: 'Spanish',
    [LanguageCode.DE]: 'German',
    [LanguageCode.TR]: 'Turkish',
};

/**
 * Provides public metadata that must stay synchronized with database values.
 *
 * @author Eman
 */
@Injectable()
export class PublicMetadataService {
    private readonly logger = new Logger(PublicMetadataService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Reads supported language codes from the PostgreSQL LanguageCode enum.
     *
     * Reading the enum from PostgreSQL prevents the frontend from maintaining
     * a separate hard-coded list that can become outdated.
     */
    async getLanguages(): Promise<PublicLanguageOption[]> {
        try {
            const rows = await this.prisma.$queryRaw<DatabaseLanguageRow[]>`
                SELECT unnest(enum_range(NULL::"LanguageCode"))::text AS code
            `;

            return rows
                .map((row) => row.code as LanguageCode)
                .filter((code) => Object.values(LanguageCode).includes(code))
                .map((code) => ({
                    code,
                    name: LANGUAGE_NAMES[code],
                }));
        } catch (error) {
            this.logger.warn(
                'Could not read LanguageCode from PostgreSQL; using Prisma enum values.',
            );

            return Object.values(LanguageCode).map((code) => ({
                code,
                name: LANGUAGE_NAMES[code],
            }));
        }
    }
}