/**
 * Normal-user generation constants.
 *
 * Backend stage keys remain the source of truth. The visual groups below
 * only simplify the presentation and never invent generation progress.
 *
 * @author Malak
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
    title: "Preparing",
    description: "Validating access and preparing the discovery request.",
    icon: Layers3,
    stageKeys: [
      "request-validation",
      "entitlement-check",
      "domain-resolution",
      "data-source-selection",
      "collection-job-resolution",
    ],
  },
  {
    key: "community",
    title: "Community Discovery",
    description: "Collecting useful public community discussions.",
    icon: Database,
    stageKeys: ["data-collection"],
  },
  {
    key: "nlp",
    title: "NLP Intelligence",
    description: "Finding repeated problems, needs, and opportunity signals.",
    icon: BrainCircuit,
    stageKeys: [
      "nlp-analysis",
      "community-ai-analysis",
      "opportunity-ranking",
    ],
  },
  {
    key: "models",
    title: "Multi-Model AI",
    description: "Building and comparing multiple candidate solutions.",
    icon: Sparkles,
    stageKeys: ["prompt-building", "core-idea-generation"],
  },
  {
    key: "validation",
    title: "Validation",
    description: "Checking quality, originality, and feasibility.",
    icon: SearchCheck,
    stageKeys: [
      "ai-output-validation",
      "duplicate-check",
      "idea-persistence",
    ],
  },
  {
    key: "workspace",
    title: "Workspace",
    description: "Finalizing the idea and its eligible advanced outputs.",
    icon: CheckCircle2,
    stageKeys: [
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

export const TERMINAL_RUN_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const COMPLETED_RUN_STATUSES = new Set([
  "COMPLETED",
  "SUCCEEDED",
]);
