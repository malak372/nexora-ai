import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  DUPLICATE_DETECTION_CANDIDATE_LIMIT,
  IDEA_GENERATION_ERROR_CODES,
  IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
  IDEA_TITLE_SIMILARITY_THRESHOLD,
  MAX_DUPLICATE_TEXT_LENGTH,
  MAX_DUPLICATE_TITLE_LENGTH,
} from '../constants/idea-generation.constants';
import type { CoreIdeaAiOutput } from '../types/idea-ai-output.type';

export type IdeaDuplicateDetectionDatabaseClient = Prisma.TransactionClient;

export type DuplicateIdeaCandidate = {
  readonly id: string;
  readonly title: string;
  readonly problemStatement: string;
  readonly objectives: Prisma.JsonValue;
  readonly targetUsers: Prisma.JsonValue;
  readonly partialAbstract: string | null;
  readonly fullAbstract: string | null;
  readonly createdAt: Date;
};

export type IdeaDuplicateReason =
  | 'EXACT_OR_NEAR_TITLE'
  | 'SEMANTIC_OVERLAP'
  | 'SAME_PROBLEM_FAMILY';

export type IdeaDuplicateCheckResult = {
  readonly isDuplicate: boolean;
  readonly highestSimilarity: number;
  readonly titleSimilarity: number;
  readonly semanticSimilarity: number;
  readonly workflowSimilarity: number;
  readonly sameProblemFamily: boolean;
  readonly familyPenalty: number;
  readonly duplicateReasons: readonly IdeaDuplicateReason[];
  readonly matchedIdea: DuplicateIdeaCandidate | null;
};

type RegionalCollectionScope = {
  readonly country: string;
  readonly city: string | null;
  readonly region: string | null;
};

/**
 * Detects exact, near-title, and semantic duplicates within one software
 * domain and one geographic collection scope.
 *
 * The check intentionally spans different users in the same area. This keeps
 * users who select the same domain and location from receiving materially
 * identical ideas, while still allowing the same general domain to produce
 * different ideas in different locations.
 *
 * Semantic comparison is provider-independent and uses a weighted token
 * fingerprint built from the title, problem statement, objectives, target
 * users, and available abstract.
 */
@Injectable()
export class IdeaDuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    domainId: string,
    collectionJobId: string,
    idea: CoreIdeaAiOutput,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<IdeaDuplicateCheckResult> {
    const normalizedDomainId = domainId.trim();
    const normalizedCollectionJobId = collectionJobId.trim();
    const normalizedTitle = this.normalizeText(
      idea.title,
      MAX_DUPLICATE_TITLE_LENGTH,
    );

    if (!normalizedDomainId || !normalizedCollectionJobId || !normalizedTitle) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
        message:
          'A valid domain, collection job, and generated idea are required.',
      });
    }

    const client = database ?? this.prisma;
    const regionalScope = await this.getRegionalScope(
      client,
      normalizedCollectionJobId,
    );

    const storedIdeas = await client.idea.findMany({
      where: {
        domainId: normalizedDomainId,
        deletedAt: null,
        collectionJob: {
          is: this.buildRegionalCollectionFilter(regionalScope),
        },
      },
      select: {
        id: true,
        title: true,
        problemStatement: true,
        objectives: true,
        targetUsers: true,
        partialAbstract: true,
        fullAbstract: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: DUPLICATE_DETECTION_CANDIDATE_LIMIT,
    });

    const candidates = storedIdeas.map((storedIdea) =>
      this.mapStoredIdeaToCandidate(storedIdea),
    );

    let matchedIdea: DuplicateIdeaCandidate | null = null;
    let highestSimilarity = 0;
    let highestTitleSimilarity = 0;
    let highestSemanticSimilarity = 0;
    let highestWorkflowSimilarity = 0;
    let highestCapabilitySimilarity = 0;
    let highestSameProblemFamily = false;

    const newFingerprint = this.buildFingerprint(idea);

    for (const candidate of candidates) {
      const titleSimilarity = this.calculateDiceSimilarity(
        this.toTokenSet(normalizedTitle),
        this.toTokenSet(
          this.normalizeText(candidate.title, MAX_DUPLICATE_TITLE_LENGTH),
        ),
      );

      const candidateFingerprint = this.buildCandidateFingerprint(candidate);
      const semanticSimilarity = this.calculateWeightedSemanticSimilarity(
        newFingerprint,
        candidateFingerprint,
      );
      const workflowSimilarity = this.calculateWorkflowSimilarity(
        newFingerprint,
        candidateFingerprint,
      );
      const capabilitySimilarity = this.calculateCapabilitySimilarity(
        idea,
        candidate,
      );
      const sameProblemFamily = this.belongsToSameProblemFamily(
        idea,
        candidate,
      );

      /*
       * Problem-family equality is diagnostic context, not an automatic
       * duplicate score. A generation is expected to address the assigned
       * opportunity family, so it is rejected only when the family also shares
       * a strongly similar problem representation and workflow.
       */
      const familyCompoundDuplicate =
        sameProblemFamily &&
        semanticSimilarity >= 0.68 &&
        workflowSimilarity >= 0.7;
      const capabilityWorkflowDuplicate =
        capabilitySimilarity >= 0.72 && workflowSimilarity >= 0.58;
      const candidateIsDuplicate =
        titleSimilarity >= 0.9 ||
        semanticSimilarity >= 0.82 ||
        familyCompoundDuplicate ||
        capabilityWorkflowDuplicate;
      const combinedSimilarity = Math.max(
        titleSimilarity,
        semanticSimilarity,
        familyCompoundDuplicate || capabilityWorkflowDuplicate
          ? Math.max(workflowSimilarity, capabilitySimilarity)
          : 0,
      );

      if (
        combinedSimilarity > highestSimilarity ||
        (candidateIsDuplicate && matchedIdea === null)
      ) {
        highestSimilarity = combinedSimilarity;
        highestTitleSimilarity = titleSimilarity;
        highestSemanticSimilarity = semanticSimilarity;
        highestWorkflowSimilarity = workflowSimilarity;
        highestCapabilitySimilarity = capabilitySimilarity;
        highestSameProblemFamily = sameProblemFamily;
        matchedIdea = candidate;
      }

      if (titleSimilarity === 1) {
        break;
      }
    }

    const nearTitleDuplicate = highestTitleSimilarity >= 0.9;
    const directSemanticDuplicate = highestSemanticSimilarity >= 0.82;
    const familyCompoundDuplicate =
      highestSameProblemFamily &&
      highestSemanticSimilarity >= 0.68 &&
      highestWorkflowSimilarity >= 0.7;
    const capabilityWorkflowDuplicate =
      highestCapabilitySimilarity >= 0.72 && highestWorkflowSimilarity >= 0.58;
    const isDuplicate =
      nearTitleDuplicate ||
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate;
    const duplicateReasons: IdeaDuplicateReason[] = [];

    if (nearTitleDuplicate) {
      duplicateReasons.push('EXACT_OR_NEAR_TITLE');
    }

    if (
      directSemanticDuplicate ||
      familyCompoundDuplicate ||
      capabilityWorkflowDuplicate
    ) {
      duplicateReasons.push('SEMANTIC_OVERLAP');
    }

    if (familyCompoundDuplicate) {
      duplicateReasons.push('SAME_PROBLEM_FAMILY');
    }

    return {
      isDuplicate,
      highestSimilarity: this.round(highestSimilarity),
      titleSimilarity: this.round(highestTitleSimilarity),
      semanticSimilarity: this.round(highestSemanticSimilarity),
      workflowSimilarity: this.round(highestWorkflowSimilarity),
      sameProblemFamily: highestSameProblemFamily,
      familyPenalty: 0,
      duplicateReasons,
      matchedIdea,
    };
  }

  async assertNotDuplicate(
    domainId: string,
    collectionJobId: string,
    idea: CoreIdeaAiOutput,
    database?: IdeaDuplicateDetectionDatabaseClient,
  ): Promise<void> {
    const result = await this.check(domainId, collectionJobId, idea, database);

    if (!result.isDuplicate) {
      return;
    }

    throw new ConflictException({
      code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
      message:
        'A semantically similar idea already exists for this domain and geographic area.',
      details: {
        matchedIdeaId: result.matchedIdea?.id ?? null,
        matchedTitle: result.matchedIdea?.title ?? null,
        highestSimilarity: result.highestSimilarity,
        titleSimilarity: result.titleSimilarity,
        semanticSimilarity: result.semanticSimilarity,
        workflowSimilarity: result.workflowSimilarity,
        sameProblemFamily: result.sameProblemFamily,
        familyPenalty: result.familyPenalty,
        duplicateReasons: result.duplicateReasons,
        titleThreshold: IDEA_TITLE_SIMILARITY_THRESHOLD,
        semanticThreshold: IDEA_SEMANTIC_SIMILARITY_THRESHOLD,
      },
    });
  }

  private async getRegionalScope(
    client: PrismaService | Prisma.TransactionClient,
    collectionJobId: string,
  ): Promise<RegionalCollectionScope> {
    const collectionJob = await client.collectionJob.findUnique({
      where: { id: collectionJobId },
      select: {
        country: true,
        city: true,
        region: true,
      },
    });

    if (!collectionJob) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
        message:
          'The collection job required for duplicate detection was not found.',
      });
    }

    const normalizedCountry = collectionJob.country?.trim();

    if (!normalizedCountry) {
      throw new ConflictException({
        code: IDEA_GENERATION_ERROR_CODES.DUPLICATE_IDEA,
        message:
          'The collection job does not contain a valid country for duplicate detection.',
      });
    }

    return {
      country: normalizedCountry,
      city: this.normalizeOptionalLocation(collectionJob.city),
      region: this.normalizeOptionalLocation(collectionJob.region),
    };
  }

  private buildRegionalCollectionFilter(
    scope: RegionalCollectionScope,
  ): Prisma.CollectionJobWhereInput {
    return {
      country: {
        equals: scope.country,
        mode: 'insensitive',
      },
      city: scope.city ? { equals: scope.city, mode: 'insensitive' } : null,
      region: scope.region
        ? { equals: scope.region, mode: 'insensitive' }
        : null,
    };
  }

  private normalizeOptionalLocation(value: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private mapStoredIdeaToCandidate(idea: {
    readonly id: string;
    readonly title: string;
    readonly problemStatement: string | null;
    readonly objectives: Prisma.JsonValue;
    readonly targetUsers: Prisma.JsonValue;
    readonly partialAbstract: string | null;
    readonly fullAbstract: string | null;
    readonly createdAt: Date;
  }): DuplicateIdeaCandidate {
    return {
      id: idea.id,
      title: idea.title.trim(),
      problemStatement: idea.problemStatement?.trim() ?? '',
      objectives: idea.objectives,
      targetUsers: idea.targetUsers,
      partialAbstract: idea.partialAbstract?.trim() || null,
      fullAbstract: idea.fullAbstract?.trim() || null,
      createdAt: idea.createdAt,
    };
  }

  private buildFingerprint(
    idea: CoreIdeaAiOutput,
  ): Record<string, Set<string>> {
    return {
      title: this.tokenize(idea.title),
      problem: this.tokenize(idea.problemStatement),
      objectives: this.tokenize(idea.objectives.join(' ')),
      users: this.tokenize(idea.targetUsers.join(' ')),
      abstract: this.tokenize(
        idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
      ),
    };
  }

  private buildCandidateFingerprint(
    idea: DuplicateIdeaCandidate,
  ): Record<string, Set<string>> {
    return {
      title: this.tokenize(idea.title),
      problem: this.tokenize(idea.problemStatement),
      objectives: this.tokenize(this.jsonText(idea.objectives)),
      users: this.tokenize(this.jsonText(idea.targetUsers)),
      abstract: this.tokenize(idea.fullAbstract ?? idea.partialAbstract ?? ''),
    };
  }

  /**
   * Detects repeated product directions even when branding and wording change.
   * The family comparison intentionally focuses on the primary problem and
   * workflow rather than generic terms such as platform or dashboard.
   */
  private belongsToSameProblemFamily(
    idea: CoreIdeaAiOutput,
    candidate: DuplicateIdeaCandidate,
  ): boolean {
    const first = [
      idea.title,
      idea.problemStatement,
      ...idea.objectives,
      ...idea.targetUsers,
      idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const second = [
      candidate.title,
      candidate.problemStatement,
      this.jsonText(candidate.objectives),
      this.jsonText(candidate.targetUsers),
      candidate.fullAbstract ?? candidate.partialAbstract ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase();

    const families: readonly RegExp[] = [
      /authentication|account activation|login|sign in|verification|credential|password recovery/iu,
      /data loss|synchroni[sz]|backup|restore|recovery|missing history/iu,
      /navigation|interface|usability|back button|scroll|popup/iu,
      /cross-device|desktop|laptop|mobile-only|computer access/iu,
      /paywall|pricing|subscription|cost restriction|paid access/iu,
    ];

    return families.some((family) => family.test(first) && family.test(second));
  }
  /**
   * Detects repeated capability combinations even when the model changes the
   * product name and rewrites the problem statement. This closes the gap where
   * two ideas share the same workbench, recommendation, local-processing, and
   * export workflow but remain below the token-similarity threshold.
   */
  private calculateCapabilitySimilarity(
    idea: CoreIdeaAiOutput,
    candidate: DuplicateIdeaCandidate,
  ): number {
    const first = this.extractCapabilities(
      [
        idea.title,
        idea.problemStatement,
        ...idea.objectives,
        ...idea.targetUsers,
        idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
      ].join(' '),
    );
    const second = this.extractCapabilities(
      [
        candidate.title,
        candidate.problemStatement,
        this.jsonText(candidate.objectives),
        this.jsonText(candidate.targetUsers),
        candidate.fullAbstract ?? candidate.partialAbstract ?? '',
      ].join(' '),
    );

    return this.calculateDiceSimilarity(first, second);
  }

  private extractCapabilities(value: string): Set<string> {
    const normalized = this.normalizeText(value, MAX_DUPLICATE_TEXT_LENGTH);
    const capabilities: Array<readonly [string, RegExp]> = [
      [
        'ai-recommendation',
        /recommend|suggest|discover|algorithm chain|recipe generation/iu,
      ],
      [
        'transformation-workbench',
        /transformation|encoding|hashing|compression|cryptographic|workbench/iu,
      ],
      [
        'sandbox-testing',
        /sandbox|test|validate|reorder|interactive workbench/iu,
      ],
      [
        'local-first',
        /local[- ]first|on-device|offline|client-side|webassembly/iu,
      ],
      [
        'privacy-isolation',
        /privacy|data isolation|never leaves|external server/iu,
      ],
      ['recipe-export', /recipe|workflow export|exportable|reproducible/iu],
      ['audit-trace', /audit log|step-by-step|history|trace/iu],
      ['sdk-backend', /sdk|vendor backend|host-integrated/iu],
      [
        'subscription-recovery',
        /subscription|receipt|entitlement|restore purchase/iu,
      ],
      [
        'productivity-context',
        /productivity|tab management|page content|user intent/iu,
      ],
      [
        'streaming-middleware',
        /streaming|tcp|udp|raspberry pi|real-time transmission/iu,
      ],
    ];

    return new Set(
      capabilities
        .filter(([, pattern]) => pattern.test(normalized))
        .map(([name]) => name),
    );
  }

  /**
   * Measures similarity of the candidate's operational flow separately from
   * broad topic similarity. Objectives and abstracts carry most of the weight
   * because they describe what users do and how the product delivers value.
   */
  private calculateWorkflowSimilarity(
    first: Record<string, Set<string>>,
    second: Record<string, Set<string>>,
  ): number {
    return (
      this.calculateDiceSimilarity(first.objectives, second.objectives) * 0.6 +
      this.calculateDiceSimilarity(first.abstract, second.abstract) * 0.4
    );
  }

  private calculateWeightedSemanticSimilarity(
    first: Record<string, Set<string>>,
    second: Record<string, Set<string>>,
  ): number {
    return (
      this.calculateDiceSimilarity(first.title, second.title) * 0.2 +
      this.calculateDiceSimilarity(first.problem, second.problem) * 0.35 +
      this.calculateDiceSimilarity(first.objectives, second.objectives) * 0.2 +
      this.calculateDiceSimilarity(first.users, second.users) * 0.1 +
      this.calculateDiceSimilarity(first.abstract, second.abstract) * 0.15
    );
  }

  private calculateDiceSimilarity(
    first: Set<string>,
    second: Set<string>,
  ): number {
    if (first.size === 0 || second.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const token of first) {
      if (second.has(token)) {
        intersection += 1;
      }
    }

    return (2 * intersection) / (first.size + second.size);
  }

  private tokenize(value: string): Set<string> {
    return this.toTokenSet(
      this.normalizeText(value, MAX_DUPLICATE_TEXT_LENGTH),
    );
  }

  private normalizeText(value: string, maxLength: number): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private toTokenSet(value: string): Set<string> {
    return new Set(
      value
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    );
  }

  private jsonText(value: Prisma.JsonValue): string {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .join(' ');
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }
}
