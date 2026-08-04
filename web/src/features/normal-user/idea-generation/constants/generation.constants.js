/**
 * Shared idea-generation presentation constants.
 *
 * Backend stage keys remain the source of truth. The six visual groups provide
 * a concise progress story for both normal and premium users without exposing
 * internal implementation details.
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
    description: 'Checking access and generation context.',
    icon: Layers3,
    stageKeys: [
      'request-validation',
      'entitlement-check',
      'domain-resolution',
      'data-source-selection',
      'collection-job-resolution',
    ],
  },
  {
    key: 'community',
    number: 2,
    title: 'Collecting',
    description: 'Gathering relevant community evidence.',
    icon: Database,
    stageKeys: ['data-collection'],
  },
  {
    key: 'nlp',
    number: 3,
    title: 'Analyzing',
    description: 'Finding repeated problems and needs.',
    icon: BrainCircuit,
    stageKeys: [
      'nlp-analysis',
      'community-ai-analysis',
      'opportunity-ranking',
    ],
  },
  {
    key: 'models',
    number: 4,
    title: 'Generating',
    description: 'Building strong solution candidates.',
    icon: Sparkles,
    stageKeys: [
      'prompt-building',
      'core-idea-generation',
    ],
  },
  {
    key: 'validation',
    number: 5,
    title: 'Validating',
    description: 'Checking quality and originality.',
    icon: SearchCheck,
    stageKeys: [
      'ai-output-validation',
      'duplicate-check',
      'idea-persistence',
    ],
  },
  {
    key: 'workspace',
    number: 6,
    title: 'Finalizing',
    description: 'Preparing the saved idea workspace.',
    icon: CheckCircle2,
    stageKeys: ['finalization'],
  },
];

export const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const COMPLETED_RUN_STATUSES = new Set([
  'COMPLETED',
  'SUCCEEDED',
]);
