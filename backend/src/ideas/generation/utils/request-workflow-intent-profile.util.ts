export type RequestWorkflowIntentFamily =
  | 'FOOD_STORAGE_CONDITION'
  | 'RESTORATION_CONSERVATION'
  | 'RENTAL_INVENTORY'
  | 'CUSTOM_COMMISSION'
  | 'SPECIFICATION_APPROVAL'
  | 'RESTAURANT_ENERGY'
  | 'TRANSACTION_ACCOUNT_ABUSE'
  | 'FACILITY_RESOURCE_MONITORING'
  | 'GENERAL';

export type RequestWorkflowIntentProfile = {
  readonly family: RequestWorkflowIntentFamily;
  readonly confidence: number;
  readonly actorMatched: boolean;
  readonly objectAxisCount: number;
  readonly workflowAxisCount: number;
  readonly failureAxisCount: number;
  readonly explicitEnergyIntent: boolean;
  readonly explicitFinancialIntent: boolean;
  readonly explicitCommissionIntent: boolean;
  readonly restorationIntent: boolean;
  readonly restorationSubject: string | null;
  readonly actorIdentityTerms: readonly string[];
  readonly objectIdentityTerms: readonly string[];
  readonly workflowIdentityTerms: readonly string[];
  readonly failureIdentityTerms: readonly string[];
  readonly outcomeIdentityTerms: readonly string[];
};

export class RequestWorkflowIntentProfileUtil {
  static resolve(requestDescription?: string | null): RequestWorkflowIntentProfile {
    const text = this.normalize(requestDescription ?? '');
    if (!text) return this.empty();

    const sentences = this.sentences(text);
    const actorIdentityTerms = this.extractTerms(sentences[0] ?? text, 5);
    const workflowIdentityTerms = this.extractTerms(
      sentences.find((item) => /\b(?:manage|track|monitor|analy[sz]|coordinate|review|assess|process|handle|deliver|maintain|compare|identify|confirm|record)\w*\b/u.test(item)) ?? text,
      7,
    );
    const failureIdentityTerms = this.extractTerms(
      sentences.find((item) => /\b(?:struggl|difficult|fragment|scatter|separate|missing|wrong|incorrect|delay|fail|error|waste|rework|unable|problem|issue)\w*\b/u.test(item)) ?? '',
      7,
    );
    const outcomeIdentityTerms = this.extractTerms(
      sentences.find((item) => /\b(?:lead|result|cause|higher|missed|waste|delay|cost|loss|risk|mistake|error|rework)\w*\b/u.test(item)) ?? '',
      7,
    );
    const objectIdentityTerms = this.extractObjectTerms(text, actorIdentityTerms, 8);

    return {
      family: 'GENERAL',
      confidence: 0.5,
      actorMatched: actorIdentityTerms.length > 0,
      objectAxisCount: objectIdentityTerms.length,
      workflowAxisCount: workflowIdentityTerms.length,
      failureAxisCount: failureIdentityTerms.length,
      explicitEnergyIntent: false,
      explicitFinancialIntent: false,
      explicitCommissionIntent: false,
      restorationIntent: false,
      restorationSubject: null,
      actorIdentityTerms,
      objectIdentityTerms,
      workflowIdentityTerms,
      failureIdentityTerms,
      outcomeIdentityTerms,
    };
  }

  static isTemplateQueryCompatible(
    requestDescription: string | null | undefined,
    candidate: string,
  ): boolean {
    const requestTokens = new Set(this.semanticTokens(requestDescription ?? ''));
    const candidateTokens = this.semanticTokens(candidate);
    if (candidateTokens.length === 0) return false;
    if (requestTokens.size === 0) return true;
    const overlap = candidateTokens.filter((token) => requestTokens.has(token)).length;
    return overlap >= 1 || candidateTokens.length <= 3;
  }

  private static extractObjectTerms(
    text: string,
    actorTerms: readonly string[],
    maxItems: number,
  ): string[] {
    const actor = new Set(actorTerms);
    return this.semanticTokens(text)
      .filter((token) => !actor.has(token))
      .slice(0, maxItems);
  }

  private static extractTerms(value: string, maxItems: number): string[] {
    return this.semanticTokens(value).slice(0, maxItems);
  }

  private static semanticTokens(value: string): string[] {
    const stop = new Set([
      'the','and','for','with','from','into','that','this','these','those','often','usually','frequently','information','data','system','systems','make','makes','making','can','could','may','each','their','they','them','which','when','where','while','across','between','through','about','more','most','very','also','only','been','being','have','has','had','are','was','were','will','would','should','than','then','such','same','different','user','users',
    ]);
    const seen = new Set<string>();
    const output: string[] = [];
    for (const token of this.normalize(value).split(/\s+/u)) {
      if (token.length < 3 || stop.has(token) || seen.has(token)) continue;
      seen.add(token);
      output.push(token);
    }
    return output;
  }

  private static sentences(value: string): string[] {
    return value.split(/[.!?]+/u).map((item) => item.trim()).filter(Boolean);
  }

  private static empty(): RequestWorkflowIntentProfile {
    return {
      family: 'GENERAL',
      confidence: 0,
      actorMatched: false,
      objectAxisCount: 0,
      workflowAxisCount: 0,
      failureAxisCount: 0,
      explicitEnergyIntent: false,
      explicitFinancialIntent: false,
      explicitCommissionIntent: false,
      restorationIntent: false,
      restorationSubject: null,
      actorIdentityTerms: [],
      objectIdentityTerms: [],
      workflowIdentityTerms: [],
      failureIdentityTerms: [],
      outcomeIdentityTerms: [],
    };
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
