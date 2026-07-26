import { Prisma } from '@prisma/client';

/**
 * Safe benchmark-candidate projection shared by user, run-monitoring, and
 * administrator idea-detail endpoints.
 *
 * Raw and parsed provider responses are intentionally excluded because they
 * may contain internal prompt context or unnecessary provider payloads.
 */
export const IDEA_BENCHMARK_CANDIDATE_SELECT =
  Prisma.validator<Prisma.IdeaGenerationCandidateSelect>()({
    id: true,
    aiModelId: true,
    providerKey: true,
    apiModelId: true,
    modelName: true,
    displayName: true,
    opportunityRank: true,
    opportunityTitle: true,
    overallScore: true,
    semanticDiversityAdjustedScore: true,
    hybridFinalScore: true,
    finalScore: true,
    semanticDiversityScore: true,
    maximumSimilarity: true,
    mostSimilarCandidateId: true,
    semanticDuplicateRisk: true,
    innovationScore: true,
    marketFitScore: true,
    technicalQualityScore: true,
    completenessScore: true,
    originalityScore: true,
    aiJudgeScore: true,
    localRelevanceScore: true,
    problemImportanceScore: true,
    aiJudgeInnovationScore: true,
    regulatoryFeasibilityScore: true,
    technicalFeasibilityScore: true,
    marketPotentialScore: true,
    implementationClarityScore: true,
    judgeStrengths: true,
    judgeRisks: true,
    judgeReason: true,
    judgeConfidence: true,
    requiresLegalVerification: true,
    inputTokens: true,
    outputTokens: true,
    costEstimate: true,
    responseTimeMs: true,
    selected: true,
    errorCode: true,
    errorMessage: true,
    createdAt: true,
    aiModel: {
      select: {
        modelName: true,
        displayName: true,
      },
    },
  });

export type IdeaBenchmarkCandidateRecord =
  Prisma.IdeaGenerationCandidateGetPayload<{
    select: typeof IDEA_BENCHMARK_CANDIDATE_SELECT;
  }>;

/** Converts Prisma Decimal fields into JSON-safe numbers. */
export function mapIdeaBenchmarkCandidate(
  candidate: IdeaBenchmarkCandidateRecord,
) {
  const aiJudgeScore = candidate.aiJudgeScore?.toNumber() ?? null;

  const deterministicScore = candidate.overallScore?.toNumber() ?? null;
  const semanticDiversityAdjustedScore =
    candidate.semanticDiversityAdjustedScore?.toNumber() ?? null;
  const hybridFinalScore = candidate.hybridFinalScore?.toNumber() ?? null;

  return {
    ...candidate,
    deterministicScore,
    overallScore: deterministicScore,
    semanticDiversityAdjustedScore,
    hybridFinalScore,
    // Backward-compatible alias with unambiguous hybrid semantics.
    finalScore: hybridFinalScore,
    semanticDiversityScore:
      candidate.semanticDiversityScore?.toNumber() ?? null,
    maximumSimilarity: candidate.maximumSimilarity?.toNumber() ?? null,
    innovationScore: candidate.innovationScore?.toNumber() ?? null,
    marketFitScore: candidate.marketFitScore?.toNumber() ?? null,
    technicalQualityScore: candidate.technicalQualityScore?.toNumber() ?? null,
    completenessScore: candidate.completenessScore?.toNumber() ?? null,
    originalityScore: candidate.originalityScore?.toNumber() ?? null,
    aiJudgeScore,
    judgeScore: aiJudgeScore,
    localRelevanceScore: candidate.localRelevanceScore?.toNumber() ?? null,
    problemImportanceScore:
      candidate.problemImportanceScore?.toNumber() ?? null,
    aiJudgeInnovationScore:
      candidate.aiJudgeInnovationScore?.toNumber() ?? null,
    regulatoryFeasibilityScore:
      candidate.regulatoryFeasibilityScore?.toNumber() ?? null,
    technicalFeasibilityScore:
      candidate.technicalFeasibilityScore?.toNumber() ?? null,
    marketPotentialScore: candidate.marketPotentialScore?.toNumber() ?? null,
    implementationClarityScore:
      candidate.implementationClarityScore?.toNumber() ?? null,
    judgeConfidence: candidate.judgeConfidence?.toNumber() ?? null,
    costEstimate: candidate.costEstimate?.toNumber() ?? null,
  };
}

/** Builds a concise dashboard summary without hiding full candidate details. */
export function buildIdeaBenchmarkSummary(
  candidates: readonly ReturnType<typeof mapIdeaBenchmarkCandidate>[],
) {
  const selectedCandidate = candidates.find((candidate) => candidate.selected);

  return {
    totalCandidates: candidates.length,
    successfulCandidates: candidates.filter(
      (candidate) => candidate.errorCode === null,
    ).length,
    qualityRejectedCandidates: candidates.filter(
      (candidate) => candidate.errorCode === 'QUALITY_GATE_REJECTED',
    ).length,
    failedCandidates: candidates.filter(
      (candidate) =>
        candidate.errorCode !== null &&
        candidate.errorCode !== 'QUALITY_GATE_REJECTED',
    ).length,
    selectedCandidate: selectedCandidate
      ? {
          candidateId: selectedCandidate.id,
          aiModelId: selectedCandidate.aiModelId,
          providerKey: selectedCandidate.providerKey,
          apiModelId: selectedCandidate.apiModelId,
          modelName: selectedCandidate.modelName,
          displayName: selectedCandidate.displayName,
          opportunityRank: selectedCandidate.opportunityRank,
          opportunityTitle: selectedCandidate.opportunityTitle,
          deterministicScore: selectedCandidate.deterministicScore,
          overallScore: selectedCandidate.overallScore,
          semanticDiversityAdjustedScore:
            selectedCandidate.semanticDiversityAdjustedScore,
          judgeScore: selectedCandidate.judgeScore,
          hybridFinalScore: selectedCandidate.hybridFinalScore,
          finalScore: selectedCandidate.hybridFinalScore,
          judgeReason: selectedCandidate.judgeReason,
          judgeConfidence: selectedCandidate.judgeConfidence,
          requiresLegalVerification:
            selectedCandidate.requiresLegalVerification,
        }
      : null,
  };
}
