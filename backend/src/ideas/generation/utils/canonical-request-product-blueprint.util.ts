import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';
import type { RequestProductBlueprint } from './request-product-blueprint.util';
import { RequestDynamicQueryUtil } from './request-dynamic-query.util';

/**
 * Builds a requester-locked product blueprint from the PREPARING-stage
 * canonical problem profile.
 *
 * This path deliberately does not classify the request into a reusable product
 * archetype. Once PREPARING has produced actor/object/workflow/failure/outcome
 * semantics, those values are the source of truth for deterministic fallbacks,
 * duplicate rescue, and validation repair. This prevents a broad account,
 * payment, booking, restoration, or approval keyword from substituting an
 * unrelated legacy template.
 */
export class CanonicalRequestProductBlueprintUtil {
  static build(input: {
    readonly profile: RequestCanonicalProblemProfile | null | undefined;
    readonly domainName?: string | null;
    readonly opportunityTitle?: string | null;
    readonly requestDescription?: string | null;
  }): RequestProductBlueprint | null {
    const profile =
      input.profile ??
      this.deriveProfileFromRequesterText(input.requestDescription ?? '');
    if (!profile) return null;

    const actor = this.clean(profile.actor) || 'Authorized operational users';
    const object = this.clean(profile.object) || 'requester-defined operational records';
    const workflow = this.clean(profile.workflow) || this.clean(profile.coreProblem);
    const coreProblem = this.clean(profile.coreProblem) || workflow;
    const failureModes = this.unique(profile.failureModes.map((value) => this.clean(value)))
      .filter(Boolean)
      .slice(0, 6);
    const consequences = this.unique(profile.consequences.map((value) => this.clean(value)))
      .filter(Boolean)
      .slice(0, 5);
    if (!workflow && !coreProblem && failureModes.length === 0) return null;

    const domainLabel = this.clean(input.domainName ?? '') || 'Requester Workflow';
    const opportunityTitle = this.clean(input.opportunityTitle ?? '');
    const safeOpportunityTitle = this.isGenericOrUnsafeOpportunityTitle(opportunityTitle)
      ? ''
      : opportunityTitle;
    const titleBase = safeOpportunityTitle || this.compactDomainLabel(domainLabel);
    const title = this.limitTitle(`${titleBase} Workflow Workspace`);
    const primaryFailures = failureModes.length > 0 ? failureModes : [coreProblem].filter(Boolean);
    const primaryConsequences = consequences.length > 0
      ? consequences
      : ['delayed, lower-quality, or less traceable operational decisions'];

    const workflowFocus = [
      workflow || coreProblem,
      `centered on ${object}`,
      primaryFailures.length > 0
        ? `with explicit tracking of ${primaryFailures.slice(0, 4).join('; ')}`
        : '',
      'and human-reviewed decisions that preserve evidence provenance and requester scope',
    ]
      .filter(Boolean)
      .join('; ');

    return {
      baseLabel: this.compactDomainLabel(domainLabel),
      title,
      workflowFocus,
      targetUsers: this.unique([
        actor,
        `${this.compactDomainLabel(domainLabel)} reviewers and decision owners`,
      ]).slice(0, 4),
      features: [
        `Unified requester-scope workspace for ${object}, with source timestamps, ownership, status history, and traceable changes`,
        `Cross-signal correlation view for ${primaryFailures.slice(0, 3).join('; ') || coreProblem}, without substituting a generic same-domain workflow`,
        `Problem-facet and evidence view that separates verified supporting signals from unvalidated requester assumptions`,
        'Human-reviewed case, action, or treatment decisions with evidence provenance, rationale, escalation state, and immutable audit history',
        `Outcome tracking for ${primaryConsequences.slice(0, 3).join('; ')}, using pilot baselines instead of unsupported prevalence or improvement claims`,
      ],
      objectives: [
        `Centralize the records required to execute and understand ${workflow || coreProblem}.`,
        `Measure and compare the requester-defined failure drivers: ${primaryFailures.join('; ')}.`,
        `Prioritize human-reviewed interventions according to their relationship with ${primaryConsequences.join('; ')} rather than switching to an unrelated legacy product archetype.`,
        'Establish a pilot baseline and measure directional change in analysis speed, coordination quality, repeated work, false positives, or unresolved cases as applicable to the requester workflow.',
      ],
      databaseEntities: [
        'WorkspaceRecord',
        'OperationalEvent',
        'EvidenceItem',
        'ProblemFacet',
        'ReviewCase',
        'ReviewDecision',
        'OutcomeRecord',
        'AuditEvent',
      ],
      metrics: this.unique([
        'problem-facet evidence coverage',
        'time to identify or triage the highest-impact failure driver',
        'human-review completion time',
        'unresolved or repeated-work trend',
        ...primaryConsequences.map((value) => this.metricLabel(value)),
      ]).slice(0, 7),
      workflowTerms: this.unique([
        workflow,
        object,
        ...primaryFailures,
      ]).filter(Boolean).slice(0, 10),
      painTerms: this.unique([
        coreProblem,
        ...primaryFailures,
        ...primaryConsequences,
      ]).filter(Boolean).slice(0, 10),
    };
  }

  private static deriveProfileFromRequesterText(
    requestDescription: string,
  ): RequestCanonicalProblemProfile | null {
    const text = this.clean(requestDescription);
    if (!text) return null;

    const actor =
      this.clean(RequestDynamicQueryUtil.extractActor(text)) ||
      'Users and operators described by the requester';

    const sentences = text
      .split(/(?<=[.!?])\s+/u)
      .map((value) => this.clean(value))
      .filter(Boolean);
    const problemSentence =
      sentences.find((value) =>
        /\b(?:struggle|difficult|hard to|unable to|scattered|fragmented|separate systems?|making it difficult|fail(?:s|ed|ure)?|problem|issue)\b/iu.test(
          value,
        ),
      ) ?? sentences[0] ?? text;

    const becauseRecordsMatch = text.match(
      /\bbecause\s+([^.!?]{12,240}?)\s+(?:are|is)\s+(?:frequently\s+|often\s+)?(?:reviewed|managed|analyzed|analysed|tracked|stored|checked|handled)\s+(?:through\s+separate\s+systems|across\s+separate\s+systems|separately|in\s+separate\s+systems)/iu,
    );
    const standaloneRecordsMatch = text.match(
      /(?:^|[.!?]\s+)([^.!?]{12,240}?)\s+(?:are|is)\s+(?:frequently\s+|often\s+)?(?:reviewed|managed|analyzed|analysed|tracked|stored|checked|handled)\s+(?:through\s+separate\s+systems|across\s+separate\s+systems|separately|in\s+separate\s+systems)/iu,
    );
    const reviewedRecordsMatch = becauseRecordsMatch ?? standaloneRecordsMatch;
    const objectTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(text)
      .map((value) => this.clean(value))
      .filter(Boolean)
      .filter(
        (value) =>
          !/^(?:large|small|independent|organizations?|organisations?|because|often|frequently)$/iu.test(
            value,
          ),
      )
      .slice(0, 10);
    const object = this.clean(reviewedRecordsMatch?.[1] ?? '')
      .replace(/^(?:because|while|and)\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim() ||
      objectTerms.join(', ') ||
      'requester-defined operational records and signals';

    const workflowTerms = RequestDynamicQueryUtil.extractWorkflowTerms(text)
      .map((value) => this.clean(value))
      .filter(Boolean)
      .filter((value) => value.length >= 5)
      .slice(0, 6);
    const workflow = reviewedRecordsMatch
      ? `reviewing, correlating, and investigating ${object}`
      : workflowTerms.join('; ') || problemSentence;

    const struggleMatch = text.match(
      /\bstruggle(?:s|d)?\s+to\s+([^.!?]+?)(?=\s+(?:because|while|when)\b|[.!?]|$)/iu,
    );
    const consequenceMatch = text.match(
      /\b(?:can lead to|leads? to|results? in|caus(?:e|es|ing))\s+([^.!?]+)/iu,
    );
    const consequences = (consequenceMatch?.[1] ?? '')
      .split(/\s*,\s*|\s+and\s+/iu)
      .map((value) => this.clean(value).replace(/^and\s+/iu, ''))
      .filter(Boolean)
      .slice(0, 5);
    const failureModes = this.unique([
      this.clean(struggleMatch?.[1] ?? ''),
      /\bseparate systems?\b/iu.test(text)
        ? 'signals reviewed through separate systems'
        : '',
      ...workflowTerms.filter((value) =>
        /\b(?:fraud|unauthorized|suspicious|scattered|fragmented|delay|wrong|incorrect|missing|lost|repeated|waste|compromised|difficult|hard|separate|threat)\w*\b/iu.test(
          value,
        ),
      ),
    ])
      .filter(Boolean)
      .slice(0, 6);

    return {
      actor,
      object,
      coreProblem: problemSentence,
      workflow,
      failureModes:
        failureModes.length > 0 ? failureModes : [problemSentence],
      consequences,
    };
  }

  private static isGenericOrUnsafeOpportunityTitle(value: string): boolean {
    if (!value) return true;
    return /^(?:requester-defined workflow opportunity|most-evidenced request problem family|selected-domain evidence discovery|request-aligned operational friction)$/iu.test(value);
  }

  private static truncateAtBoundary(value: string, maxLength: number): string {
    const normalized = this.clean(value);
    if (normalized.length <= maxLength) return normalized;
    const bounded = normalized.slice(0, maxLength + 1);
    const boundary = Math.max(
      bounded.lastIndexOf('. '),
      bounded.lastIndexOf('; '),
      bounded.lastIndexOf(', '),
      bounded.lastIndexOf(' '),
    );
    return (boundary >= Math.floor(maxLength * 0.55)
      ? bounded.slice(0, boundary)
      : bounded.slice(0, maxLength)).trim();
  }

  private static compactDomainLabel(value: string): string {
    const cleaned = this.clean(value)
      .replace(/\b(?:operations?|management|records? management)\b/giu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    return this.truncateAtBoundary(cleaned || 'Requester Workflow', 72);
  }

  private static metricLabel(value: string): string {
    const cleaned = this.clean(value)
      .replace(/^(?:increased?|higher|significant|severe)\s+/iu, '')
      .replace(/[.!?]+$/gu, '');
    return cleaned
      ? `${this.truncateAtBoundary(cleaned, 90)} trend`
      : 'requester-defined outcome trend';
  }

  private static limitTitle(value: string): string {
    return this.truncateAtBoundary(value, 100);
  }

  private static unique(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
      const cleaned = this.clean(value);
      const key = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(key)) continue;
      seen.add(key);
      output.push(cleaned);
    }
    return output;
  }

  private static clean(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[\r\n]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
