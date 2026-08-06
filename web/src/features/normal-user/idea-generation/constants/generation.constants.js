/**
 * Six user-facing milestones for the detailed backend pipeline.
 *
 * Backend stages stay separate for retries, monitoring, and persistence. The
 * frontend deliberately groups them into six clear milestones so the user sees
 * one active spinner and one meaningful transition at a time.
 */
import {
  BrainCircuit,
  CheckCircle2,
  Database,
  Layers3,
  SearchCheck,
  Sparkles,
} from "lucide-react";

export const GENERATION_TYPES = {
  NORMAL_FREE: "NORMAL_FREE",
  PREMIUM_CREDIT: "PREMIUM_CREDIT",
};

export const LANGUAGE_OPTIONS = [
  { value: "ANY", label: "Any language" },
  { value: "EN", label: "English" },
  { value: "AR", label: "Arabic" },
  { value: "FR", label: "French" },
  { value: "ES", label: "Spanish" },
  { value: "DE", label: "German" },
  { value: "TR", label: "Turkish" },
];

export const VISUAL_PIPELINE_GROUPS = [
  {
    key: "prepare",
    number: 1,
    title: "Preparing request",
    description: "Validating your request, access, domain, and selected evidence sources.",
    icon: Layers3,
    stageKeys: [
      "request-validation",
      "entitlement-check",
      "domain-resolution",
      "data-source-selection",
    ],
  },
  {
    key: "evidence",
    number: 2,
    title: "Collecting evidence",
    description: "Gathering and restoring relevant posts, comments, and source evidence.",
    icon: Database,
    stageKeys: [
      "collection-job-resolution",
      "data-collection",
    ],
  },
  {
    key: "insights",
    number: 3,
    title: "Understanding community needs",
    description: "Cleaning evidence, extracting community needs, and ranking evidence-backed opportunities.",
    icon: BrainCircuit,
    stageKeys: [
      "nlp-analysis",
      "community-ai-analysis",
      "opportunity-ranking",
    ],
  },
  {
    key: "generation",
    number: 4,
    title: "Creating the idea",
    description: "Building the grounded prompt and generating the strongest solution candidates.",
    icon: Sparkles,
    stageKeys: [
      "prompt-building",
      "core-idea-generation",
    ],
  },
  {
    key: "quality",
    number: 5,
    title: "Checking quality and originality",
    description: "Checking structure, evidence coverage, originality, duplication, and solution quality.",
    icon: SearchCheck,
    stageKeys: [
      "ai-output-validation",
      "duplicate-check",
    ],
  },
  {
    key: "workspace",
    number: 6,
    title: "Saving workspace",
    description: "Saving the approved idea and preparing its final workspace.",
    icon: CheckCircle2,
    stageKeys: [
      "idea-persistence",
      "full-abstract-generation",
      "technology-stack-generation",
      "system-architecture-generation",
      "database-design-generation",
      "mvp-features-generation",
      "value-proposition-generation",
      "revenue-model-generation",
      "local-regulations-generation",
      "budget-estimation-generation",
      "feasibility-assessment-generation",
      "implementation-timeline-generation",
      "market-potential-generation",
      "nlp-executive-summary-generation",
      "community-feedback-summary-generation",
      "finalization",
    ],
  },
];

export const BACKEND_STAGE_TO_VISUAL_INDEX = new Map(
  VISUAL_PIPELINE_GROUPS.flatMap((group, index) =>
    group.stageKeys.map((stageKey) => [stageKey, index]),
  ),
);

export const TERMINAL_RUN_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const COMPLETED_RUN_STATUSES = new Set([
  "COMPLETED",
  "SUCCEEDED",
]);
