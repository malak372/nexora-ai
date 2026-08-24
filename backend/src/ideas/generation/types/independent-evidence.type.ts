/**
 * Evidence categories used when validating whether a quoted community text
 * represents an independently reported user problem.
 *
 * Only USER_COMPLAINT, FEATURE_REQUEST, and REVIEW contribute to the verified
 * recurrence count. Technical tickets and specifications remain useful for
 * understanding implementation context, but they must not be counted as
 * independent people experiencing the problem.
 *
 * @author Malak
 */
export const INDEPENDENT_EVIDENCE_KINDS = {
  DIRECT_USER_COMPLAINT: 'DIRECT_USER_COMPLAINT',
  USER_COMPLAINT: 'USER_COMPLAINT',
  USER_QUESTION: 'USER_QUESTION',
  GENERAL_COMMENTARY: 'GENERAL_COMMENTARY',
  SECONDARY_REPORT: 'SECONDARY_REPORT',
  EDITORIAL_ANALYSIS: 'EDITORIAL_ANALYSIS',
  NEWS_REPORT: 'NEWS_REPORT',
  FEATURE_REQUEST: 'FEATURE_REQUEST',
  REVIEW: 'REVIEW',
  OBSERVED_UNMET_NEED: 'OBSERVED_UNMET_NEED',
  POSITIVE_FEEDBACK: 'POSITIVE_FEEDBACK',
  TECHNICAL_TICKET: 'TECHNICAL_TICKET',
  SPECIFICATION: 'SPECIFICATION',
  UNKNOWN: 'UNKNOWN',
} as const;

export type IndependentEvidenceKind =
  (typeof INDEPENDENT_EVIDENCE_KINDS)[keyof typeof INDEPENDENT_EVIDENCE_KINDS];

/**
 * Auditable provenance attached to one retained evidence quote.
 *
 * The identityKey is deterministic and privacy-preserving. It is derived from
 * the source, author when available, and parent discussion thread. Raw author
 * names are not exposed in generation responses.
 *
 * @author Malak
 */
export type IndependentEvidence = {
  readonly text: string;
  readonly sourceKey: string;
  readonly postExternalId: string;
  readonly commentExternalId: string | null;
  readonly threadExternalId: string;
  readonly identityKey: string;
  readonly evidenceKind: IndependentEvidenceKind;
  readonly qualifiesForRecurrence: boolean;
};
