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
export type DomainResolutionCandidate = {
  readonly domainId: string;
  readonly domainName: string;
  readonly score: number;
  readonly reasons: readonly string[];
};

export type DomainResolutionTrace = {
  /** Human-readable explanation of why this domain was selected. */
  readonly reasons: readonly string[];

  /** Saved preferences that directly participated in domain resolution. */
  readonly matchedInterests: readonly string[];

  /** Bounded ranked alternatives captured for observability only. */
  readonly candidates: readonly DomainResolutionCandidate[];
};

export type DomainResolutionResult = {
  /** Resolved active domain identifier. */
  readonly domainId: string;

  /** Resolved active domain name. */
  readonly domainName: string;

  /** Strategy that produced the selected domain. */
  readonly source: DomainResolutionSource;

  /** Confidence score between zero and one. */
  readonly confidence: number;

  /** Explainability metadata; it never changes pipeline decisions. */
  readonly trace: DomainResolutionTrace;
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
 * 4. The user's favorite-idea history.
 * 5. The user's recent generated-idea history.
 * 6. A deterministic system-wide domain fallback.
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
  private static readonly FAVORITE_IDEA_WEIGHT = 5;
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
    const hasCurrentRequest = this.hasRequestSearchInput(
      input.description,
      input.keywords,
    );

    /*
     * Explicit request text has priority over stored personalization because it
     * represents the user's current intent. If the request describes a domain
     * that is not configured yet, create a concrete active domain and persist
     * the same request terms as domain keywords. This keeps the next run fast
     * and prevents an unrelated preference/history fallback from replacing the
     * user's current problem scope.
     */
    if (hasCurrentRequest) {
      if (domains.length > 0) {
        const keywordResult = this.resolveByKeywords(
          domains,
          input.description,
          input.keywords,
        );

        if (keywordResult) {
          return keywordResult;
        }
      }

      const createdDomainResult = await this.resolveOrCreateRequestDomain(input);
      if (createdDomainResult) {
        return createdDomainResult;
      }
    }

    if (domains.length === 0) {
      throw new BadRequestException('No active concrete domain is configured.');
    }

    /*
     * These personalization reads are independent. Load them in one database
     * latency window, then apply the deterministic priority order in memory:
     * saved preferences -> favorites -> recent generation history.
     */
    const [
      preferredDomainResult,
      favoriteDomainResult,
      historicalDomainResult,
    ] = await Promise.all([
      this.resolvePreferredDomain(input.userId, domains),
      this.resolveFromFavorites(input.userId, domains),
      this.resolveFromGeneratedHistory(input.userId, domains),
    ]);

    if (preferredDomainResult) return preferredDomainResult;
    if (favoriteDomainResult) return favoriteDomainResult;
    if (historicalDomainResult) return historicalDomainResult;

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
      domainName: selectedDomain.name,
      source: DomainResolutionSource.USER_SELECTED,
      confidence: 1,
      trace: {
        reasons: ['The requester explicitly selected this domain.'],
        matchedInterests: [],
        candidates: [
          {
            domainId: selectedDomain.id,
            domainName: selectedDomain.name,
            score: 1,
            reasons: ['Explicit requester selection'],
          },
        ],
      },
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

    const matchedInterests = preferredValues.filter((value) => {
      const normalizedValue = this.normalizeComparableValue(value);
      return (
        matchedDomain.id === value ||
        this.normalizeComparableValue(matchedDomain.name) === normalizedValue
      );
    });

    const preferenceCandidates = domains
      .map((domain) => {
        const matchingValues = preferredValues.filter((value) => {
          const normalizedValue = this.normalizeComparableValue(value);
          return (
            domain.id === value ||
            this.normalizeComparableValue(domain.name) === normalizedValue
          );
        });

        return {
          domainId: domain.id,
          domainName: domain.name,
          score: matchingValues.length,
          reasons: matchingValues.map(
            (value) => `Matches saved domain preference: ${value}`,
          ),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (first, second) =>
          second.score - first.score ||
          first.domainName.localeCompare(second.domainName),
      )
      .slice(0, 3);

    return {
      domainId: matchedDomain.id,
      domainName: matchedDomain.name,
      source: DomainResolutionSource.USER_PREFERENCE,
      confidence: 0.9,
      trace: {
        reasons: [
          'Selected from the authenticated user\'s saved domain interests before using behavioral history or the system fallback.',
        ],
        matchedInterests: [...new Set(matchedInterests)],
        candidates: preferenceCandidates,
      },
    };
  }

  /**
   * Resolves the strongest domain from the user's favorite ideas.
   * Favorites are an explicit long-lived preference signal and therefore run
   * before generated-idea history when no current request/domain was supplied.
   */
  private async resolveFromFavorites(
    userId: string | undefined,
    domains: readonly DomainCandidate[],
  ): Promise<DomainResolutionResult | null> {
    if (!userId) {
      return null;
    }

    const domainIds = domains.map((domain) => domain.id);
    const favorites = await this.prisma.favoriteIdea.findMany({
      where: {
        userId,
        idea: {
          deletedAt: null,
          domainId: { in: domainIds },
        },
      },
      select: {
        idea: { select: { domainId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: DomainResolutionService.MAX_HISTORY_RECORDS_PER_SIGNAL,
    });

    const scores = new Map<string, HistoricalDomainScore>();
    for (const favorite of favorites) {
      this.addHistoricalScore(
        scores,
        favorite.idea.domainId,
        DomainResolutionService.FAVORITE_IDEA_WEIGHT,
      );
    }

    return this.buildHistoryResolution(
      domains,
      scores,
      0.84,
      'The user did not provide a current problem/domain, so favorite-idea history selected the most explicitly preferred domain.',
      'Favorite idea history',
    );
  }

  /**
   * Resolves the domain the user most often generates ideas for. This is used
   * only after current request text, selected domains, saved preferences, and
   * favorites have produced no usable signal.
   */
  private async resolveFromGeneratedHistory(
    userId: string | undefined,
    domains: readonly DomainCandidate[],
  ): Promise<DomainResolutionResult | null> {
    if (!userId) {
      return null;
    }

    const domainIds = domains.map((domain) => domain.id);
    const generatedIdeas = await this.prisma.idea.findMany({
      where: {
        userId,
        deletedAt: null,
        domainId: { in: domainIds },
      },
      select: { domainId: true },
      orderBy: { createdAt: 'desc' },
      take: DomainResolutionService.MAX_HISTORY_RECORDS_PER_SIGNAL,
    });

    const scores = new Map<string, HistoricalDomainScore>();
    for (const idea of generatedIdeas) {
      this.addHistoricalScore(
        scores,
        idea.domainId,
        DomainResolutionService.GENERATED_IDEA_WEIGHT,
      );
    }

    return this.buildHistoryResolution(
      domains,
      scores,
      0.72,
      "No current request, saved preference, or favorite-domain signal was available, so the user's recent generation history selected the domain.",
      'Recent generated-idea history',
    );
  }

  /** Converts weighted history signals into one deterministic domain result. */
  private buildHistoryResolution(
    domains: readonly DomainCandidate[],
    scores: ReadonlyMap<string, HistoricalDomainScore>,
    confidence: number,
    reason: string,
    candidateReason: string,
  ): DomainResolutionResult | null {
    const domainById = new Map(domains.map((domain) => [domain.id, domain]));
    const ordered = [...scores.values()]
      .filter((item) => domainById.has(item.domainId))
      .sort((first, second) => {
        const scoreDifference = second.score - first.score;
        if (scoreDifference !== 0) return scoreDifference;
        return (domainById.get(first.domainId)?.name ?? '').localeCompare(
          domainById.get(second.domainId)?.name ?? '',
        );
      });

    const best = ordered[0];
    if (!best) return null;

    const selectedDomain = domainById.get(best.domainId);
    if (!selectedDomain) return null;

    return {
      domainId: selectedDomain.id,
      domainName: selectedDomain.name,
      source: DomainResolutionSource.USER_HISTORY,
      confidence,
      trace: {
        reasons: [reason],
        matchedInterests: [],
        candidates: ordered.slice(0, 3).map((item) => ({
          domainId: item.domainId,
          domainName: domainById.get(item.domainId)?.name ?? item.domainId,
          score: item.score,
          reasons: [candidateReason],
        })),
      },
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
    const rawSearchText = [description ?? '', ...(keywords ?? [])]
      .join(' ')
      .trim();

    if (!rawSearchText) {
      return null;
    }

    const normalizedSearchText = this.normalizeSemanticText(rawSearchText);
    const searchTokens = new Set(
      normalizedSearchText.split(/\s+/).filter(Boolean),
    );

    const rankedDomains = domains
      .map((domain) => {
        const configuredTerms = [
          domain.name,
          ...domain.domainKeywords.map((item) => item.keyword),
          ...this.getDomainIntentAliases(domain.name),
        ]
          .map((term) => this.normalizeSemanticText(term))
          .filter(Boolean);

        let score = 0;
        const reasons: string[] = [];

        for (const term of [...new Set(configuredTerms)]) {
          const termTokens = term.split(/\s+/).filter(Boolean);

          if (normalizedSearchText.includes(term)) {
            const exactWeight = Math.max(3, termTokens.length * 3);
            score += exactWeight;
            reasons.push(`Matched request phrase: ${term}`);
            continue;
          }

          const matchedTokens = termTokens.filter((token) =>
            searchTokens.has(token),
          );

          if (matchedTokens.length === 0) {
            continue;
          }

          if (
            termTokens.length > 1 &&
            matchedTokens.length === 1 &&
            matchedTokens[0] === 'ai'
          ) {
            continue;
          }

          const coverage = matchedTokens.length / termTokens.length;

          if (coverage >= 0.5 || termTokens.length === 1) {
            const tokenWeight =
              matchedTokens.length * 2 + (coverage === 1 ? 1 : 0);
            score += tokenWeight;
            reasons.push(
              `Matched request terms: ${matchedTokens.join(', ')}`,
            );
          }
        }

        return {
          domain,
          score,
          reasons: [...new Set(reasons)].slice(0, 4),
        };
      })
      .sort(
        (first, second) =>
          second.score - first.score ||
          first.domain.name.localeCompare(second.domain.name),
      );

    const bestMatch = rankedDomains[0];

    if (!bestMatch || bestMatch.score < 2) {
      return null;
    }

    const secondBestScore = rankedDomains[1]?.score ?? 0;
    const lead = Math.max(0, bestMatch.score - secondBestScore);
    const confidence = Math.min(
      0.97,
      0.68 + Math.min(0.2, bestMatch.score * 0.02) + Math.min(0.08, lead * 0.02),
    );

    return {
      domainId: bestMatch.domain.id,
      domainName: bestMatch.domain.name,
      source: DomainResolutionSource.KEYWORD_MATCH,
      confidence,
      trace: {
        reasons: [
          'The current request intent matched this domain more strongly than stored preferences or historical behavior.',
          ...bestMatch.reasons,
        ],
        matchedInterests: [],
        candidates: rankedDomains
          .filter((candidate) => candidate.score > 0)
          .slice(0, 3)
          .map((candidate) => ({
            domainId: candidate.domain.id,
            domainName: candidate.domain.name,
            score: candidate.score,
            reasons:
              candidate.reasons.length > 0
                ? candidate.reasons
                : ['Matched normalized current-request terms'],
          })),
      },
    };
  }

  private normalizeSemanticText(value: string): string {
    const aliases: Readonly<Record<string, string>> = {
      financial: 'finance',
      finances: 'finance',
      financing: 'finance',
      administration: 'administrative',
      admin: 'administrative',
      companies: 'business',
      company: 'business',
      businesses: 'business',
      invoicing: 'invoice',
      invoices: 'invoice',
      expenses: 'expense',
      budgeting: 'budget',
      budgets: 'budget',
      reconciliations: 'reconciliation',
      payments: 'payment',
      payrolls: 'payroll',
      procurements: 'procurement',
    };

    return value
      .trim()
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => aliases[token] ?? token)
      .join(' ');
  }

  private getDomainIntentAliases(domainName: string): readonly string[] {
    const normalizedDomain = this.normalizeComparableValue(domainName);

    if (normalizedDomain === 'finance') {
      return [
        'financial management',
        'financial administration',
        'administrative finance',
        'finance operations',
        'business finance',
        'accounting',
        'bookkeeping',
        'invoice management',
        'expense management',
        'budget management',
        'payroll',
        'procurement',
        'reconciliation',
        'cash flow',
        'back office finance',
      ];
    }

    if (normalizedDomain === 'business operations') {
      return [
        'administration',
        'administrative operations',
        'business operations',
        'company operations',
        'office administration',
        'approval workflow',
        'document workflow',
        'back office operations',
        'internal operations',
        'manual administration',
        'workflow bottleneck',
      ];
    }

    if (normalizedDomain === 'artificial intelligence') {
      return [
        'artificial intelligence',
        'machine learning',
        'generative ai',
        'ai model',
        'model inference',
        'ai reliability',
        'model hallucination',
        'prompt reliability',
      ];
    }

    if (normalizedDomain === 'e commerce' || normalizedDomain === 'ecommerce') {
      return [
        'online commerce',
        'online store',
        'shopping',
        'checkout',
        'merchant',
        'order management',
      ];
    }

    if (normalizedDomain === 'agriculture') {
      return [
        'farming',
        'farm management',
        'irrigation',
        'crop management',
        'crop monitoring',
        'soil',
        'harvest',
        'agricultural operations',
      ];
    }

    if (normalizedDomain === 'energy') {
      return [
        'electricity',
        'solar',
        'power grid',
        'energy consumption',
        'energy monitoring',
        'battery',
        'utility',
        'power management',
      ];
    }

    if (normalizedDomain === 'education') {
      return [
        'learning',
        'teaching',
        'student',
        'students',
        'school',
        'university',
        'homework',
        'assignment',
        'coursework',
        'classroom',
        'grading',
      ];
    }

    if (normalizedDomain === 'healthcare') {
      return ['health', 'medical', 'clinic', 'patient', 'hospital'];
    }

    return [];
  }

  /**
   * Creates a concrete domain when current request text does not match any
   * configured domain. The operation is idempotent and stores a compact search
   * vocabulary so subsequent collection runs can reuse it immediately.
   */
  private async resolveOrCreateRequestDomain(
    input: ResolveDomainInput,
  ): Promise<DomainResolutionResult | null> {
    const domainName = this.inferDomainName(input.description, input.keywords);
    if (!domainName || this.isGeneral(domainName)) {
      return null;
    }

    const keywordCandidates = this.buildAutoDomainKeywords(
      input.description,
      input.keywords,
      domainName,
    );

    const persistDomain = () =>
      this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.domain.findFirst({
          where: {
            name: { equals: domainName, mode: 'insensitive' },
          },
          select: { id: true, name: true, isActive: true },
        });

        const resolved = existing
          ? existing.isActive
            ? existing
            : await transaction.domain.update({
                where: { id: existing.id },
                data: { isActive: true },
                select: { id: true, name: true, isActive: true },
              })
          : await transaction.domain.create({
              data: { name: domainName, isActive: true },
              select: { id: true, name: true, isActive: true },
            });

        if (keywordCandidates.length > 0) {
          await transaction.domainKeyword.createMany({
            data: keywordCandidates.map((keyword) => ({
              domainId: resolved.id,
              keyword,
              language: input.language,
            })),
            skipDuplicates: true,
          });
        }

        return resolved;
      });

    let domain: Awaited<ReturnType<typeof persistDomain>>;
    try {
      domain = await persistDomain();
    } catch (error: unknown) {
      /*
       * Two simultaneous unmatched requests can infer the same new domain.
       * Treat the unique-name race as success and reuse the winner instead of
       * surfacing a transient database error to idea generation.
       */
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
      ) {
        throw error;
      }

      const racedDomain = await this.prisma.domain.findFirst({
        where: { name: { equals: domainName, mode: 'insensitive' } },
        select: { id: true, name: true, isActive: true },
      });
      if (!racedDomain) throw error;

      domain = racedDomain.isActive
        ? racedDomain
        : await this.prisma.domain.update({
            where: { id: racedDomain.id },
            data: { isActive: true },
            select: { id: true, name: true, isActive: true },
          });

      if (keywordCandidates.length > 0) {
        await this.prisma.domainKeyword.createMany({
          data: keywordCandidates.map((keyword) => ({
            domainId: domain.id,
            keyword,
            language: input.language,
          })),
          skipDuplicates: true,
        });
      }
    }

    return {
      domainId: domain.id,
      domainName: domain.name,
      source: DomainResolutionSource.KEYWORD_MATCH,
      confidence: 0.72,
      trace: {
        reasons: [
          'The current request did not match an existing domain strongly enough, so a new active domain was created from the requester intent instead of falling back to unrelated personalization.',
          `Stored ${keywordCandidates.length} request-derived search keyword(s) for future collection.`,
        ],
        matchedInterests: [],
        candidates: [
          {
            domainId: domain.id,
            domainName: domain.name,
            score: 1,
            reasons: ['Auto-created from unmatched current-request intent'],
          },
        ],
      },
    };
  }

  /** Derives a stable short domain label from unmatched request text. */
  private inferDomainName(
    description?: string,
    keywords?: readonly string[],
  ): string | null {
    const requestText = [description ?? '', ...(keywords ?? [])]
      .join(' ')
      .normalize('NFKC')
      .toLowerCase();
    const knownDomain = this.inferKnownDomainName(requestText);
    if (knownDomain) return knownDomain;

    const stopWords = new Set([
      'a', 'an', 'and', 'are', 'about', 'for', 'from', 'in', 'into', 'is', 'of',
      'on', 'or', 'the', 'to', 'with', 'without', 'problem', 'problems', 'issue',
      'issues', 'need', 'needs', 'want', 'wants', 'software', 'system', 'app',
      'application', 'platform', 'user', 'users', 'using', 'use', 'help', 'make',
      'improve', 'solution', 'solutions', 'حل', 'مشكلة', 'مشاكل', 'في', 'من',
      'على', 'عن', 'مع', 'بدون', 'مستخدم', 'مستخدمين', 'تطبيق', 'نظام',
    ]);

    const source = [
      ...(keywords ?? []),
      description ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => token.length >= 3 && !stopWords.has(token));

    const unique = [...new Set(source)].slice(0, 3);
    if (unique.length === 0) return null;

    return unique
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ')
      .slice(0, 80);
  }

  /**
   * Maps common requester vocabulary to a canonical domain name even when the
   * corresponding domain row does not exist yet. This avoids creating labels
   * such as "Students Homework" when the actual missing domain is Education.
   */
  private inferKnownDomainName(requestText: string): string | null {
    const normalized = requestText
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const definitions: readonly { readonly name: string; readonly pattern: RegExp }[] = [
      {
        name: 'Education',
        pattern: /\b(?:student|students|homework|assignment|school|teacher|classroom|coursework|university|learning|grading)\b/u,
      },
      {
        name: 'Agriculture',
        pattern: /\b(?:agriculture|agricultural|farm|farming|farmer|crop|crops|irrigation|harvest|soil)\b/u,
      },
      {
        name: 'E-commerce',
        pattern: /\b(?:e commerce|ecommerce|checkout|shopping cart|online store|merchant|seller|order|orders|marketplace)\b/u,
      },
      {
        name: 'Energy',
        pattern: /\b(?:energy|electricity|solar|power grid|battery|utility|utilities|kilowatt|metering)\b/u,
      },
      {
        name: 'Healthcare',
        pattern: /\b(?:healthcare|medical|patient|patients|clinic|hospital|doctor|nurse|pharmacy)\b/u,
      },
      {
        name: 'Finance',
        pattern: /\b(?:finance|financial|accounting|invoice|expense|budget|payroll|reconciliation|cash flow)\b/u,
      },
      {
        name: 'Transportation',
        pattern: /\b(?:transportation|transport|transit|bus|route planning|fare|vehicle|commute|mobility)\b/u,
      },
      {
        name: 'Logistics',
        pattern: /\b(?:logistics|shipment|delivery|warehouse|fleet|dispatch|inventory handoff)\b/u,
      },
      {
        name: 'Artificial Intelligence',
        pattern: /\b(?:artificial intelligence|machine learning|generative ai|llm|model inference|prompt)\b/u,
      },
      {
        name: 'Business Operations',
        pattern: /\b(?:administration|administrative|back office|approval workflow|office operations|business operations|paperwork)\b/u,
      },
    ];

    return definitions.find((definition) => definition.pattern.test(normalized))?.name ?? null;
  }

  /** Builds bounded, search-friendly keywords for an auto-created domain. */
  private buildAutoDomainKeywords(
    description: string | undefined,
    keywords: readonly string[] | undefined,
    domainName: string,
  ): string[] {
    const normalized = [
      domainName,
      ...this.getDomainIntentAliases(domainName),
      ...(keywords ?? []),
      ...(description ? [description] : []),
    ]
      .map((value) =>
        value
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      )
      .filter(Boolean);

    const tokenCandidates = normalized
      .flatMap((value) => value.split(' '))
      .filter((value) => value.length >= 3)
      .filter(
        (value) =>
          !['problem', 'problems', 'issue', 'issues', 'need', 'needs', 'software', 'system', 'application', 'platform'].includes(value),
      );

    const phraseCandidates = normalized
      .filter((value) => value.split(' ').length <= 6)
      .slice(0, 6);

    return [...new Set([...phraseCandidates, ...tokenCandidates])].slice(0, 12);
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
      domainName: selectedDomain.name,
      source: DomainResolutionSource.SYSTEM_DEFAULT,
      confidence: 0.25,
      trace: {
        reasons: [
          'No explicit request, saved domain preference, or usable user-history signal was available; the deterministic least-used-domain fallback was used.',
        ],
        matchedInterests: [],
        candidates: [
          {
            domainId: selectedDomain.id,
            domainName: selectedDomain.name,
            score: 0.25,
            reasons: ['Deterministic system fallback'],
          },
        ],
      },
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