import {
  BrainCircuit,
  CheckCircle2,
  Database,
  Layers3,
  SearchCheck,
  Sparkles,
} from 'lucide-react';

export const GENERATION_TYPES = {
  NORMAL_FREE: 'NORMAL_FREE',
  PREMIUM_CREDIT: 'PREMIUM_CREDIT',
};

export const LANGUAGE_OPTIONS = [
  { value: 'ANY', label: 'Any language' },
  { value: 'EN', label: 'English' },
  { value: 'AR', label: 'Arabic' },
  { value: 'FR', label: 'French' },
  { value: 'ES', label: 'Spanish' },
  { value: 'DE', label: 'German' },
  { value: 'TR', label: 'Turkish' },
];

export const VISUAL_PIPELINE_GROUPS = [
  {
    key: 'prepare',
    number: 1,
    title: 'Preparing',
    description: 'We understand your signal and set up the right discovery foundations.',
    icon: Layers3,
    stageKeys: [
      'preparing',
      'request-validation',
      'entitlement-check',
      'domain-resolution',
      'data-source-selection',
    ],
  },
  {
    key: 'evidence',
    number: 2,
    title: 'Broad collection',
    description: 'Collecting signals across news, research, social and more.',
    icon: Database,
    stageKeys: [
      'collection-job-resolution',
      'data-collection',
    ],
  },
  {
    key: 'insights',
    number: 3,
    title: 'Community AI analysis',
    description: 'Analyzing conversations, needs, pain points and emerging patterns.',
    icon: BrainCircuit,
    stageKeys: [
      'nlp-analysis',
      'community-ai-analysis',
      'opportunity-ranking',
    ],
  },
  {
    key: 'generation',
    number: 4,
    title: 'Core idea generation',
    description: 'Synthesizing evidence into one strongest opportunity.',
    icon: Sparkles,
    stageKeys: [
      'prompt-building',
      'core-idea-generation',
    ],
  },
  {
    key: 'quality',
    number: 5,
    title: 'Validation',
    description: 'Validating with real-world signals and evidence quality.',
    icon: SearchCheck,
    stageKeys: [
      'ai-output-validation',
      'duplicate-check',
    ],
  },
  {
    key: 'workspace',
    number: 6,
    title: 'Workspace ready',
    description: 'Preparing your workspace with the final idea and next steps.',
    icon: CheckCircle2,
    stageKeys: [
      'idea-persistence',
      'full-abstract-generation',
      'technology-stack-generation',
      'system-architecture-generation',
      'database-design-generation',
      'mvp-features-generation',
      'value-proposition-generation',
      'revenue-model-generation',
      'local-regulations-generation',
      'budget-estimation-generation',
      'feasibility-assessment-generation',
      'implementation-timeline-generation',
      'market-potential-generation',
      'nlp-executive-summary-generation',
      'community-feedback-summary-generation',
      'finalization',
    ],
  },
];

export const BACKEND_STAGE_TO_VISUAL_INDEX = new Map(
  VISUAL_PIPELINE_GROUPS.flatMap((group, index) =>
    group.stageKeys.map((stageKey) => [stageKey, index]),
  ),
);

export const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const COMPLETED_RUN_STATUSES = new Set([
  'COMPLETED',
  'SUCCEEDED',
]);
