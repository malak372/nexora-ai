import type { ParsedIdeaAiOutput } from './idea-ai-output.type';

/**
 * One successfully generated and parsed candidate submitted to the AI judge.
 *
 * candidateId is the persisted IdeaGenerationCandidate identifier. Provider
 * and model identities are intentionally excluded from the judge prompt to
 * reduce model-brand and self-preference bias.
 *
 * @author Malak
 */
export type IdeaJudgeCandidateInput = {
  readonly candidateId: string;
  readonly parsedOutput: ParsedIdeaAiOutput;
};

/**
 * Explainable AI-judge scores returned for one candidate.
 *
 * Every numeric score uses a range from 0 to 100. overallScore is calculated
 * by the judge from the configured judge criteria only.
 *
 * @author Malak
 */
export type IdeaJudgeCandidateScore = {
  readonly candidateId: string;
  readonly localRelevance: number;
  readonly problemImportance: number;
  readonly innovation: number;
  readonly regulatoryFeasibility: number;
  readonly technicalFeasibility: number;
  readonly marketPotential: number;
  readonly implementationClarity: number;
  readonly overallScore: number;
  readonly strengths: readonly string[];
  readonly risks: readonly string[];
};

/**
 * Complete comparative decision returned by the AI judge.
 *
 * The winner must be one of the supplied candidate IDs. The judge may not
 * create, merge, or rewrite candidates.
 *
 * @author Malak
 */
export type IdeaJudgeEvaluation = {
  readonly winnerCandidateId: string;
  readonly confidence: number;
  readonly reason: string;
  readonly requiresLegalVerification: boolean;
  readonly scores: readonly IdeaJudgeCandidateScore[];
};

/**
 * Rendered prompt data passed to AiExecutionService.
 *
 * @author Malak
 */
export type IdeaJudgePrompt = {
  readonly systemInstruction: string;
  readonly userPrompt: string;
};
