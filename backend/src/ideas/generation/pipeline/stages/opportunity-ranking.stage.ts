import { BadRequestException, Injectable } from '@nestjs/common';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { IdeaOpportunityRankingService } from '../../services/idea-opportunity-ranking.service';
import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';
import type { IdeaOpportunityRanking } from '../../types/idea-opportunity-ranking.type';

/**
 * Ranks evidence-backed product opportunities before prompt construction.
 *
 * This checkpoint prevents the generation model from choosing an arbitrary
 * first NLP item or over-focusing on a generic label such as "Problem" or
 * "App". The selected opportunity and alternatives remain deterministic and
 * traceable inside the generation context.
 *
 * @author Malak
 */
@Injectable()
export class OpportunityRankingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING;

  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly opportunityRankingService: IdeaOpportunityRankingService,
  ) {}

  shouldExecute(): boolean {
    return true;
  }

  execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    if (!context.nlp) {
      return Promise.reject(
        new BadRequestException({
          code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
          message: 'NLP analysis is required before opportunity ranking.',
        }),
      );
    }

    let ranking: IdeaOpportunityRanking;

    try {
      ranking = this.opportunityRankingService.rank(context.nlp, [
        context.location.country,
        context.location.city ?? '',
        context.location.region ?? '',
      ]);
    } catch (error: unknown) {
      return Promise.reject(
        new BadRequestException({
          code: IDEA_GENERATION_ERROR_CODES.NLP_ANALYSIS_FAILED,
          message:
            error instanceof Error
              ? error.message
              : 'Unable to rank the discovered product opportunities.',
        }),
      );
    }

    const result: IdeaGenerationStageExecutionResult = {
      context: {
        ...context,
        opportunityRanking: ranking,
      },
      resultPreview: `Ranked ${ranking.evaluatedCount} opportunity candidate(s); selected "${ranking.selected.title}" with score ${(ranking.selected.finalScore * 100).toFixed(1)}. ${ranking.selectionReason}`,
      metadata: {
        selectedTitle: ranking.selected.title,
        selectedScore: ranking.selected.finalScore,
        shortlistedOpportunities: [
          ranking.selected,
          ...ranking.alternatives.slice(0, 4),
        ].map((opportunity) => ({
          rank: opportunity.rank,
          title: opportunity.title,
          score: opportunity.finalScore,
        })),
        selectionReason: ranking.selectionReason,
        evidenceCoverage: ranking.evidenceCoverage,
        evaluatedCount: ranking.evaluatedCount,
        qualityWarnings: [...ranking.qualityWarnings],
      },
    };

    return Promise.resolve(result);
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}