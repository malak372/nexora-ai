import { BadRequestException, Injectable } from '@nestjs/common';

import {
  DomainResolutionSource,
  LanguageCode,
  PreferenceCategory,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Result returned after resolving one concrete domain
 * for an idea-generation request.
 */
export type DomainResolutionResult = {
  /** Resolved active domain identifier. */
  readonly domainId: string;

  /** Strategy that produced the selected domain. */
  readonly source: DomainResolutionSource;

  /** Confidence score between zero and one. */
  readonly confidence: number;
};

/**
 * Input used to resolve one concrete domain.
 */
type ResolveDomainInput = {
  /** Authenticated user identifier, when available. */
  readonly userId?: string;

  /** Domain explicitly selected by the requester. */
  readonly domainId?: string;

  /** Natural-language description supplied by the requester. */
  readonly description?: string;

  /** Keywords supplied with the generation request. */
  readonly keywords?: readonly string[];

  /** Requested generation language. */
  readonly language: LanguageCode;
};

type DomainCandidate = {
  readonly id: string;
  readonly name: string;
  readonly domainKeywords: readonly {
    readonly keyword: string;
  }[];
};

/**
 * Weighted domain score inferred from a user's historical actions.
 */
type HistoricalDomainScore = {
  readonly domainId: string;
  score: number;
};

/**
 * Resolves exactly one active, concrete domain for an idea-generation request.
 *
 * Resolution priority:
 * 1. Explicit concrete domain selected by the requester.
 * 2. Description and keywords supplied with the current request.
 * 3. Saved domain preferences of the authenticated user.
 * 4. The user's generated, favorite, and accepted-idea history.
 * 5. A deterministic system-wide domain fallback.
 *
 * The final fallback selects the least-used active concrete domain rather than
 * choosing randomly. This keeps results reproducible and improves domain
 * diversity across the platform.
 *
 * @author Malak
 */
@Injectable()
export class DomainResolutionService {
  private static readonly GENERATED_IDEA_WEIGHT = 3;
  private static readonly FAVORITE_IDEA_WEIGHT = 4;
  private static readonly ACCEPTED_IDEA_WEIGHT = 5;
  private static readonly MAX_HISTORY_RECORDS_PER_SIGNAL = 100;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves one active concrete domain for the supplied request.
   *
   * A General domain is treated as an instruction to continue automatic
   * resolution rather than as a concrete generation domain.
   */
  async resolve(input: ResolveDomainInput): Promise<DomainResolutionResult> {
    const selectedDomainResult = await this.resolveSelectedDomain(
      input.domainId,
    );

    if (selectedDomainResult) {
      return selectedDomainResult;
    }

    const domains = await this.loadConcreteDomains(input.language);

    if (domains.length === 0) {
      throw new BadRequestException('No active concrete domain is configured.');
    }

    /*
     * Explicit request text has priority over stored personalization because it
     * represents the user's current intent.
     */
    if (this.hasRequestSearchInput(input.description, input.keywords)) {
      const keywordResult = this.resolveByKeywords(
        domains,
        input.description,
        input.keywords,
      );

      if (keywordResult) {
        return keywordResult;
      }
    }

    const preferredDomainResult = await this.resolvePreferredDomain(
      input.userId,
      domains,
    );

    if (preferredDomainResult) {
      return preferredDomainResult;
    }

    const historicalDomainResult = await this.resolveFromUserHistory(
      input.userId,
      domains,
    );

    if (historicalDomainResult) {
      return historicalDomainResult;
    }

    return this.resolveSystemFallback(domains);
  }

  /** Loads all active concrete domains and their matching keywords. */
  private async loadConcreteDomains(
    language: LanguageCode,
  ): Promise<DomainCandidate[]> {
    const domains = await this.prisma.domain.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        domainKeywords: {
          where: {
            language: {
              in: [language, LanguageCode.ANY],
            },
          },
          select: {
            keyword: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return domains.filter((domain) => !this.isGeneral(domain.name));
  }

  /**
   * Resolves an explicitly selected domain.
   *
   * Selecting General continues automatic resolution.
   */
  private async resolveSelectedDomain(
    domainId?: string,
  ): Promise<DomainResolutionResult | null> {
    const normalizedDomainId = domainId?.trim();

    if (!normalizedDomainId) {
      return null;
    }

    const selectedDomain = await this.prisma.domain.findUnique({
      where: {
        id: normalizedDomainId,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    if (!selectedDomain || !selectedDomain.isActive) {
      throw new BadRequestException('The selected domain is unavailable.');
    }

    if (this.isGeneral(selectedDomain.name)) {
      return null;
    }

    return {
      domainId: selectedDomain.id,
      source: DomainResolutionSource.USER_SELECTED,
      confidence: 1,
    };
  }

  /**
   * Resolves a domain from both the legacy preference JSON and the structured
   * preference catalog selections.
   */
  private async resolvePreferredDomain(
    userId: string | undefined,
    domains: readonly DomainCandidate[],
  ): Promise<DomainResolutionResult | null> {
    if (!userId) {
      return null;
    }

    const [preference, selections] = await Promise.all([
      this.prisma.userPreference.findUnique({
        where: {
          userId,
        },
        select: {
          preferredDomains: true,
        },
      }),
      this.prisma.userPreferenceSelection.findMany({
        where: {
          userId,
          preferenceOption: {
            category: PreferenceCategory.DOMAIN,
            isActive: true,
          },
        },
        select: {
          preferenceOption: {
            select: {
              key: true,
              name: true,
            },
          },
        },
        orderBy: {
          selectedAt: 'asc',
        },
      }),
    ]);

    const preferredValues = [
      ...this.readStringArray(preference?.preferredDomains),
      ...selections.flatMap(({ preferenceOption }) => [
        preferenceOption.key,
        preferenceOption.name,
      ]),
    ];

    const matchedDomain = this.findFirstMatchingDomain(
      domains,
      preferredValues,
    );

    if (!matchedDomain) {
      return null;
    }

    return {
      domainId: matchedDomain.id,
      source: DomainResolutionSource.USER_PREFERENCE,
      confidence: 0.9,
    };
  }

  /**
   * Infers a domain from the user's behavioral history.
   *
   * Signals are weighted as follows:
   * - Generated idea: 3 points.
   * - Favorite idea: 4 points.
   * - Accepted publication: 5 points.
   *
   * Acceptance receives the highest weight because it represents the strongest
   * explicit commitment to an idea. Only active concrete domains are eligible.
   */
  private async resolveFromUserHistory(
    userId: string | undefined,
    domains: readonly DomainCandidate[],
  ): Promise<DomainResolutionResult | null> {
    if (!userId) {
      return null;
    }

    const domainIds = domains.map((domain) => domain.id);

    const [generatedIdeas, favoriteIdeas, acceptedIdeas] = await Promise.all([
      this.prisma.idea.findMany({
        where: {
          userId,
          deletedAt: null,
          domainId: {
            in: domainIds,
          },
        },
        select: {
          domainId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: DomainResolutionService.MAX_HISTORY_RECORDS_PER_SIGNAL,
      }),
      this.prisma.favoriteIdea.findMany({
        where: {
          userId,
          idea: {
            deletedAt: null,
            domainId: {
              in: domainIds,
            },
          },
        },
        select: {
          idea: {
            select: {
              domainId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: DomainResolutionService.MAX_HISTORY_RECORDS_PER_SIGNAL,
      }),
      this.prisma.ideaPublicationAcceptance.findMany({
        where: {
          userId,
          publication: {
            idea: {
              deletedAt: null,
              domainId: {
                in: domainIds,
              },
            },
          },
        },
        select: {
          publication: {
            select: {
              idea: {
                select: {
                  domainId: true,
                },
              },
            },
          },
        },
        orderBy: {
          acceptedAt: 'desc',
        },
        take: DomainResolutionService.MAX_HISTORY_RECORDS_PER_SIGNAL,
      }),
    ]);

    const scores = new Map<string, HistoricalDomainScore>();

    for (const idea of generatedIdeas) {
      this.addHistoricalScore(
        scores,
        idea.domainId,
        DomainResolutionService.GENERATED_IDEA_WEIGHT,
      );
    }

    for (const favorite of favoriteIdeas) {
      this.addHistoricalScore(
        scores,
        favorite.idea.domainId,
        DomainResolutionService.FAVORITE_IDEA_WEIGHT,
      );
    }

    for (const acceptance of acceptedIdeas) {
      this.addHistoricalScore(
        scores,
        acceptance.publication.idea.domainId,
        DomainResolutionService.ACCEPTED_IDEA_WEIGHT,
      );
    }

    const domainById = new Map(domains.map((domain) => [domain.id, domain]));

    const bestHistoricalMatch = [...scores.values()]
      .filter((item) => domainById.has(item.domainId))
      .sort((first, second) => {
        const scoreDifference = second.score - first.score;

        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        const firstName = domainById.get(first.domainId)?.name ?? '';
        const secondName = domainById.get(second.domainId)?.name ?? '';

        return firstName.localeCompare(secondName);
      })[0];

    if (!bestHistoricalMatch) {
      return null;
    }

    return {
      domainId: bestHistoricalMatch.domainId,
      source: DomainResolutionSource.USER_HISTORY,
      confidence: 0.75,
    };
  }

  /** Adds one weighted signal to a domain history score. */
  private addHistoricalScore(
    scores: Map<string, HistoricalDomainScore>,
    domainId: string,
    weight: number,
  ): void {
    const existing = scores.get(domainId);

    if (existing) {
      existing.score += weight;
      return;
    }

    scores.set(domainId, {
      domainId,
      score: weight,
    });
  }

  /**
   * Resolves the best domain using the current request text.
   *
   * Null is returned when no domain term matches, allowing safe fallback to
   * preferences and user history instead of rejecting the request.
   */
  private resolveByKeywords(
    domains: readonly DomainCandidate[],
    description?: string,
    keywords?: readonly string[],
  ): DomainResolutionResult | null {
    const searchText = [description ?? '', ...(keywords ?? [])]
      .join(' ')
      .trim()
      .toLowerCase();

    if (!searchText) {
      return null;
    }

    const rankedDomains = domains
      .map((domain) => {
        const terms = [
          domain.name,
          ...domain.domainKeywords.map((item) => item.keyword),
        ]
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean);

        const score = terms.reduce(
          (totalScore, term) =>
            totalScore +
            (searchText.includes(term)
              ? Math.max(1, term.split(/\s+/).length)
              : 0),
          0,
        );

        return {
          domain,
          score,
        };
      })
      .sort(
        (first, second) =>
          second.score - first.score ||
          first.domain.name.localeCompare(second.domain.name),
      );

    const bestMatch = rankedDomains[0];

    if (!bestMatch || bestMatch.score <= 0) {
      return null;
    }

    return {
      domainId: bestMatch.domain.id,
      source: DomainResolutionSource.KEYWORD_MATCH,
      confidence: Math.min(0.95, 0.55 + bestMatch.score * 0.08),
    };
  }

  /**
   * Selects a deterministic system fallback.
   *
   * The least-used active concrete domain is chosen to avoid permanently
   * favoring the first database row and to improve platform-wide diversity.
   */
  private async resolveSystemFallback(
    domains: readonly DomainCandidate[],
  ): Promise<DomainResolutionResult> {
    const usage = await this.prisma.idea.groupBy({
      by: ['domainId'],
      where: {
        deletedAt: null,
        domainId: {
          in: domains.map((domain) => domain.id),
        },
      },
      _count: {
        _all: true,
      },
    });

    const usageByDomainId = new Map(
      usage.map((item) => [item.domainId, item._count._all]),
    );

    const selectedDomain = [...domains].sort((first, second) => {
      const firstUsage = usageByDomainId.get(first.id) ?? 0;
      const secondUsage = usageByDomainId.get(second.id) ?? 0;

      return firstUsage - secondUsage || first.name.localeCompare(second.name);
    })[0];

    if (!selectedDomain) {
      throw new BadRequestException('No active concrete domain is configured.');
    }

    return {
      domainId: selectedDomain.id,
      source: DomainResolutionSource.SYSTEM_DEFAULT,
      confidence: 0.25,
    };
  }

  /** Returns true when the request contains meaningful text or keywords. */
  private hasRequestSearchInput(
    description?: string,
    keywords?: readonly string[],
  ): boolean {
    return Boolean(
      description?.trim() || keywords?.some((keyword) => keyword.trim()),
    );
  }

  /** Finds the first active domain matching an ID, name, or normalized key. */
  private findFirstMatchingDomain(
    domains: readonly DomainCandidate[],
    values: readonly string[],
  ): DomainCandidate | null {
    for (const value of values) {
      const normalizedValue = this.normalizeComparableValue(value);

      if (!normalizedValue) {
        continue;
      }

      const matchingDomain = domains.find(
        (domain) =>
          domain.id === value ||
          this.normalizeComparableValue(domain.name) === normalizedValue,
      );

      if (matchingDomain) {
        return matchingDomain;
      }
    }

    return null;
  }

  /** Normalizes catalog keys and domain names for stable comparison. */
  private normalizeComparableValue(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /** Determines whether a domain is a generic non-concrete category. */
  private isGeneral(name: string): boolean {
    const normalizedName = name.trim().toLowerCase();

    return ['general', 'عام', 'all'].includes(normalizedName);
  }

  /** Safely converts a Prisma JSON value into a clean string array. */
  private readStringArray(
    value: Prisma.JsonValue | null | undefined,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
