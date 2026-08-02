import {
    type ValidationArguments,
    ValidatorConstraint,
    type ValidatorConstraintInterface,
} from 'class-validator';

import type { GenerateGuestIdeaDto } from '../dto/generate-guest-idea.dto';

/**
 * Minimum number of words required when the guest does not choose a domain.
 */
export const GUEST_DESCRIPTION_MIN_WORDS = 4;

/**
 * Maximum number of words accepted in a guest problem description.
 */
export const GUEST_DESCRIPTION_MAX_WORDS = 120;

/**
 * Counts meaningful whitespace-separated words inside a description.
 *
 * @param value - Description value to inspect.
 * @returns The number of words in the normalized description.
 */
function countWords(value: unknown): number {
    if (typeof value !== 'string') {
        return 0;
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
        return 0;
    }

    return normalizedValue.split(/\s+/u).filter(Boolean).length;
}

/**
 * Validates the guest generation entry rule.
 *
 * A guest may continue in either of these cases:
 * - A domain is selected, even when the written description is absent or short.
 * - No domain is selected, but the description contains 4 to 120 words.
 *
 * Any provided description is always limited to 120 words.
 *
 * @author Eman
 */
@ValidatorConstraint({ name: 'GuestDescriptionOrDomain', async: false })
export class GuestDescriptionOrDomainConstraint
    implements ValidatorConstraintInterface {
    validate(_value: unknown, arguments_: ValidationArguments): boolean {
        const input = arguments_.object as GenerateGuestIdeaDto;
        const wordCount = countWords(input.description);
        const hasDomain =
            typeof input.domainId === 'string' && input.domainId.trim().length > 0;

        if (wordCount > GUEST_DESCRIPTION_MAX_WORDS) {
            return false;
        }

        return hasDomain || wordCount >= GUEST_DESCRIPTION_MIN_WORDS;
    }

    defaultMessage(arguments_: ValidationArguments): string {
        const input = arguments_.object as GenerateGuestIdeaDto;
        const wordCount = countWords(input.description);

        if (wordCount > GUEST_DESCRIPTION_MAX_WORDS) {
            return `Description must not exceed ${GUEST_DESCRIPTION_MAX_WORDS} words.`;
        }

        return `Choose a domain or provide a description with at least ${GUEST_DESCRIPTION_MIN_WORDS} words.`;
    }
}