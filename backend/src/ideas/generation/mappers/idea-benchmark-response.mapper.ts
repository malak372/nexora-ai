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
  contextSnapshot?: unknown,
) {
  const selectedCandidate = candidates.find((candidate) => candidate.selected);
  const postRescueSelection = resolvePostBenchmarkRescueSelection(contextSnapshot);

  const persistedSelection = selectedCandidate
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
    : null;

  const contextFallbackSelection =
    persistedSelection === null && postRescueSelection === null
      ? resolveContextFallbackSelection(contextSnapshot)
      : null;

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
    selectedCandidate:
      postRescueSelection ?? persistedSelection ?? contextFallbackSelection,
    postBenchmarkRescueApplied:
      postRescueSelection !== null || contextFallbackSelection !== null,
  };
}

function resolvePostBenchmarkRescueSelection(contextSnapshot: unknown) {
  if (!isRecord(contextSnapshot)) return null;
  const rawCandidates = contextSnapshot.benchmarkCandidates;
  if (!Array.isArray(rawCandidates)) return null;

  const rescueCandidate = rawCandidates.find((candidate) => {
    if (!isRecord(candidate) || candidate.selected !== true) return false;
    return (
      typeof candidate.candidateId === 'string' &&
      candidate.candidateId.includes(':duplicate-rescue:')
    );
  });

  if (!isRecord(rescueCandidate)) return null;

  const score = firstFiniteNumber(
    rescueCandidate.finalScore,
    rescueCandidate.qualityScore,
  );
  if (score === null) return null;

  const opportunityRank = firstFiniteNumber(rescueCandidate.opportunityRank);
  const parsedOutput = isRecord(rescueCandidate.parsedOutput)
    ? rescueCandidate.parsedOutput
    : null;
  const coreIdea =
    parsedOutput && isRecord(parsedOutput.coreIdea)
      ? parsedOutput.coreIdea
      : null;
  const finalTitle =
    coreIdea && typeof coreIdea.title === 'string'
      ? coreIdea.title.trim()
      : '';
  const strategy = String(rescueCandidate.candidateId)
    .split(':duplicate-rescue:')[1]
    ?.replace(/[-_]+/gu, ' ')
    .trim();

  return {
    candidateId: String(rescueCandidate.candidateId),
    aiModelId: null,
    providerKey: 'deterministic-rescue',
    apiModelId: 'post-benchmark-duplicate-rescue',
    modelName: 'deterministic-duplicate-rescue',
    displayName: 'Deterministic duplicate rescue',
    opportunityRank:
      opportunityRank === null ? 1 : Math.max(1, Math.round(opportunityRank)),
    opportunityTitle:
      typeof rescueCandidate.opportunityTitle === 'string'
        ? rescueCandidate.opportunityTitle
        : finalTitle || 'Post-benchmark duplicate rescue',
    deterministicScore: score,
    overallScore: score,
    semanticDiversityAdjustedScore: null,
    judgeScore: null,
    hybridFinalScore: score,
    finalScore: score,
    judgeReason: strategy
      ? `Final product was re-evaluated after deterministic duplicate rescue (${strategy}).`
      : 'Final product was re-evaluated after deterministic duplicate rescue.',
    judgeConfidence: null,
    requiresLegalVerification: null,
  };
}

function resolveContextFallbackSelection(contextSnapshot: unknown) {
  if (!isRecord(contextSnapshot)) return null;
  const rawCandidates = contextSnapshot.benchmarkCandidates;
  if (!Array.isArray(rawCandidates)) return null;

  const selected = rawCandidates.find(
    (candidate) => isRecord(candidate) && candidate.selected === true,
  );
  if (!isRecord(selected)) return null;

  const candidateId =
    typeof selected.candidateId === 'string' ? selected.candidateId.trim() : '';
  const score = firstFiniteNumber(selected.finalScore, selected.qualityScore);
  if (!candidateId || score === null) return null;

  const parsedOutput = isRecord(selected.parsedOutput)
    ? selected.parsedOutput
    : null;
  const coreIdea =
    parsedOutput && isRecord(parsedOutput.coreIdea)
      ? parsedOutput.coreIdea
      : null;
  const finalTitle =
    coreIdea && typeof coreIdea.title === 'string'
      ? coreIdea.title.trim()
      : '';
  const opportunityRank = firstFiniteNumber(selected.opportunityRank);

  return {
    candidateId,
    aiModelId: null,
    providerKey: 'availability-fallback',
    apiModelId: 'post-benchmark-availability-fallback',
    modelName: 'availability-fallback',
    displayName: 'Structurally valid availability fallback',
    opportunityRank:
      opportunityRank === null ? 1 : Math.max(1, Math.round(opportunityRank)),
    opportunityTitle:
      typeof selected.opportunityTitle === 'string'
        ? selected.opportunityTitle
        : finalTitle || 'Requester-defined availability fallback',
    deterministicScore: score,
    overallScore: score,
    semanticDiversityAdjustedScore: null,
    judgeScore: null,
    hybridFinalScore: score,
    finalScore: score,
    judgeReason:
      'The model benchmark did not retain a normally successful candidate, but the pipeline preserved and validated a structurally usable requester-aligned fallback so the run could complete without substituting another problem.',
    judgeConfidence: null,
    requiresLegalVerification: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}
