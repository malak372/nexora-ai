import { Injectable } from '@nestjs/common';

import { IDEA_JUDGE_CRITERIA_WEIGHTS } from '../constants/idea-judge.constants';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type {
  IdeaJudgeCandidateInput,
  IdeaJudgePrompt,
} from '../types/idea-judge.type';

/**
 * Builds the complete prompt sent to the comparative AI judge.
 *
 * Prompt construction is isolated from provider execution so it can be tested,
 * reviewed, and versioned independently. Provider and model identities are
 * omitted from the candidate payload to reduce brand and self-preference bias.
 *
 * The deterministic evaluator is deliberately excluded from this prompt. It
 * may remain available for validation and internal analytics, but it does not
 * guide or participate in winner selection.
 *
 * @author Malak
 */
@Injectable()
export class IdeaCandidateJudgePromptService {
  /**
   * Builds the system instruction and structured user prompt.
   *
   * @param context Current idea-generation context.
   * @param candidates Every successfully generated and parsed candidate.
   * @returns Prompt data ready for AiExecutionService.
   */
  build(
    context: IdeaGenerationContext,
    candidates: readonly IdeaJudgeCandidateInput[],
  ): IdeaJudgePrompt {
    return {
      systemInstruction: this.buildSystemInstruction(),
      userPrompt: this.buildUserPrompt(context, candidates),
    };
  }

  private buildSystemInstruction(): string {
    return [
      'You are Nexora AI comparative software-project evaluator.',
      'Evaluate every supplied candidate fairly and choose exactly one existing winner.',
      'Do not create, merge, rewrite, expand, repair, or improve any candidate.',
      'Return winnerCandidateId exactly as supplied.',
      'Use only the supplied local context and candidate content as evidence.',
      'Do not infer that unsupported claims are true merely because a candidate states them.',
      'Treat regulatory feasibility as a preliminary risk assessment, never as verified legal advice or guaranteed compliance.',
      'Penalize generic CRUD-only concepts, unsupported factual or local claims, duplicated concepts, decorative localization, unclear users, unrealistic implementation, and invented infrastructure constraints.',
      'A requested country, city, region, keyword, or feature is not evidence that a corresponding local condition or service failure exists.',
      'Prefer candidates that distinguish evidence-supported findings from cautious product inferences.',
      'Penalize definitive claims about residents, institutions, authorities, service reliability, rates, regulations, language preferences, connectivity, or infrastructure when candidate content provides no support for them.',
      'Reward meaningful differentiation, evidence-grounded problems, practical implementation, clear users, and realistic sustainable value.',
      'Provider and model identities are intentionally omitted and must not influence the evaluation.',
      'Return valid JSON matching the supplied response schema and no additional text.',
    ].join(' ');
  }

  private buildUserPrompt(
    context: IdeaGenerationContext,
    candidates: readonly IdeaJudgeCandidateInput[],
  ): string {
    const payload = {
      task: 'Compare all supplied software-project candidates and select the strongest existing candidate for the specified local context.',
      candidateCount: candidates.length,
      location: {
        country: context.location.country,
        city: context.location.city,
        region: context.location.region,
        radiusKm: context.location.radiusKm,
        preferredLanguage: context.location.language,
      },
      domain: {
        id: context.domainId,
        name: context.domainName,
      },
      evaluationCriteriaWeights: IDEA_JUDGE_CRITERIA_WEIGHTS,
      scoringInstructions: {
        scoreRange: '0-100',
        overallScore:
          'Calculate overallScore using exactly the supplied criterion weights. The application may combine this score with an independent deterministic quality score after your evaluation.',
        localRelevance:
          'Assess whether the solution is realistically deployable in the specified country, city, and region without treating location names as evidence. Reward meaningful local adaptation and penalize decorative localization or invented local conditions.',
        problemImportance:
          'Assess severity, frequency, evidence support, affected users, and practical value. Lower the score when the candidate states a local failure, shortage, rate, behavior, or institutional condition as fact without supplied support.',
        innovation:
          'Assess meaningful and useful differentiation from common solutions. Do not reward novelty without practical value.',
        regulatoryFeasibility:
          'Assess likely regulatory complexity and risk only. Lower the score when important requirements are unknown or unsupported.',
        technicalFeasibility:
          'Assess realistic implementation using available technologies, data, integrations, skills, and infrastructure.',
        marketPotential:
          'Assess realistic demand, adoption value, target-user willingness, scalability, and sustainable value.',
        implementationClarity:
          'Assess clarity of scope, objectives, target users, solution direction, and deliverability.',
      },
      mandatoryRules: {
        evaluateEveryCandidate: true,
        returnExactlyOneScorePerCandidate: true,
        scoresMustBeAnArray: true,
        scoreArrayLengthMustEqualCandidateCount: true,
        chooseExistingCandidateOnly: true,
        preserveCandidateIdsExactly: true,
        doNotMergeCandidates: true,
        doNotCreateNewCandidate: true,
        doNotUseExternalScoresInsideJudge: true,
        locationIsContextNotEvidence: true,
        keywordsAreSearchIntentNotEvidence: true,
        requestedFeaturesDoNotProveRootCauses: true,
        penalizeUnsupportedDefinitiveClaims: true,
        rewardCautiousEvidenceGroundedWording: true,
        legalAssessmentIsPreliminary: true,
        requiresLegalVerification:
          'Return true when the selected idea depends on laws, licenses, regulated data, public-sector approval, finance, health, education, transport, identity, privacy, or uncertain local requirements.',
      },
      requiredResponseTemplate: {
        winnerCandidateId: candidates[0]?.candidateId ?? '',
        confidence: 0,
        reason: 'Explain why the selected existing candidate is strongest.',
        requiresLegalVerification: false,
        scores: candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          localRelevance: 0,
          problemImportance: 0,
          innovation: 0,
          regulatoryFeasibility: 0,
          technicalFeasibility: 0,
          marketPotential: 0,
          implementationClarity: 0,
          overallScore: 0,
          strengths: ['One concise strength.'],
          risks: [],
        })),
      },
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        idea: {
          coreIdea: candidate.parsedOutput.coreIdea,
          advancedOutputSummaries: candidate.parsedOutput.advancedOutputs.map(
            (output) => ({
              outputKey: output.outputKey,
              title: output.title,
              content: output.content.slice(0, 1_500),
            }),
          ),
        },
      })),
    };

    return JSON.stringify(payload);
  }
}