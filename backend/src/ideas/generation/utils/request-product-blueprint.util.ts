export type RequestProductBlueprint = {
  readonly baseLabel: string;
  readonly title: string;
  readonly workflowFocus: string;
  readonly targetUsers: readonly string[];
  readonly features: readonly string[];
  readonly objectives: readonly string[];
  readonly databaseEntities: readonly string[];
  readonly metrics: readonly string[];
  readonly workflowTerms: readonly string[];
  readonly painTerms: readonly string[];
};

export class RequestProductBlueprintUtil {
  static build(input: {
    readonly requestDescription?: string | null;
    readonly domainName?: string | null;
    readonly opportunityTitle?: string | null;
    readonly evidenceDescription?: string | null;
    readonly problemFamilyKey?: string | null;
    readonly enableEvidenceDerivedFeatureCapability?: boolean;
    readonly enableEvidenceDerivedProblemWorkflow?: boolean;
  }): RequestProductBlueprint | null {
    const request = this.clean(input.requestDescription ?? '');
    const opportunity = this.clean(input.opportunityTitle ?? '');
    const evidence = this.clean(input.evidenceDescription ?? '');
    const source = request || opportunity || evidence;
    if (!source) return null;

    const workflowTerms = this.extractTerms(source, 8);
    const painTerms = this.extractPainTerms(source, 6);
    const actor = this.extractActor(request || source);
    const domain = this.clean(input.domainName ?? '');
    const baseLabel = this.titleCase(
      actor || domain || workflowTerms.slice(0, 3).join(' ') || 'Workflow',
    );
    const workflowFocus = this.clean(
      workflowTerms.slice(0, 5).join(' ') || 'the requester-defined workflow',
    );
    const pain = painTerms[0] || 'requester-defined workflow friction';
    const titleSeed = opportunity || `${baseLabel} ${this.titleCase(workflowTerms.slice(0, 3).join(' ') || 'Workflow')}`;
    const title = this.truncateAtBoundary(titleSeed, 100);

    return {
      baseLabel,
      title,
      workflowFocus,
      targetUsers: [actor || `${baseLabel} users`],
      features: [
        `Structured records for ${workflowFocus}`,
        `Traceable changes and source history for ${workflowFocus}`,
        `Human-reviewed exception handling for ${pain}`,
        `Search, filtering, and status visibility across the requester-defined workflow`,
      ],
      objectives: [
        `Centralize the information required for ${workflowFocus}`,
        `Reduce ${pain} without changing the requester-defined problem`,
        `Preserve traceability for decisions, revisions, and exceptions`,
        `Measure pilot outcomes before making broader market claims`,
      ],
      databaseEntities: [
        'WorkflowRecord',
        'WorkflowRevision',
        'SourceReference',
        'DecisionRecord',
        'StatusEvent',
      ],
      metrics: [
        'workflow cycle time',
        'rework or correction count',
        'unresolved exception age',
        'decision traceability coverage',
      ],
      workflowTerms,
      painTerms,
    };
  }

  private static extractActor(value: string): string {
    const firstSentence = value.split(/[.!?]+/u)[0] ?? value;
    const match = firstSentence.match(/^(.{3,90}?)\s+(?:often|frequently|usually|commonly|struggle|struggles|face|faces|need|needs|manage|manages)\b/iu);
    return this.clean(match?.[1] ?? '').replace(/^(?:independent|many|some)\s+/iu, '').trim();
  }

  private static extractPainTerms(value: string, maxItems: number): string[] {
    const normalized = this.clean(value);
    const candidates = normalized
      .split(/[,;.!?]+/u)
      .map((part) => part.trim())
      .filter((part) => /\b(?:wrong|incorrect|missing|delay|delayed|waste|wasted|rework|failure|failed|error|cost|loss|risk|difficult|fragmented|scattered|inconsistent|unnecessary|unable)\w*\b/iu.test(part));
    return this.unique(candidates.map((item) => this.truncateAtBoundary(item, 120))).slice(0, maxItems);
  }

  private static extractTerms(value: string, maxItems: number): string[] {
    const stop = new Set([
      'the','and','for','with','from','that','this','these','those','often','usually','frequently','information','data','system','systems','problem','problems','their','they','them','which','making','difficult','can','may','into','across','between','through','while','when','where','about','more','most','user','users',
    ]);
    const output: string[] = [];
    const seen = new Set<string>();
    for (const token of this.clean(value).toLocaleLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
      if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
      seen.add(token);
      output.push(token);
      if (output.length >= maxItems) break;
    }
    return output;
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

  private static truncateAtBoundary(value: string, maxLength: number): string {
    const cleaned = this.clean(value);
    if (cleaned.length <= maxLength) return cleaned;
    const prefix = cleaned.slice(0, maxLength + 1);
    const sentence = prefix.match(/^(.{20,}?[.!?])(?:\s|$)/u)?.[1];
    if (sentence) return sentence.trim();
    const word = prefix.slice(0, maxLength).replace(/\s+\S*$/u, '').trim();
    return word || cleaned.slice(0, maxLength).trim();
  }

  private static titleCase(value: string): string {
    return this.clean(value)
      .split(/\s+/u)
      .map((word) => word ? `${word[0].toLocaleUpperCase()}${word.slice(1)}` : '')
      .join(' ');
  }

  private static clean(value: string): string {
    return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  }
}
