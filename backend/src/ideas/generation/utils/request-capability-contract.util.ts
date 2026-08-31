export type RequestedCapabilityRule = {
  readonly label: string;
  readonly request: RegExp;
  readonly implementation: RegExp;
  readonly promptInstruction: string;
};

/**
 * Shared requester-capability contract used by both Core prompting and the
 * deterministic quality gate. Keeping one rule table prevents the generator
 * from receiving a weaker contract than the evaluator later enforces.
 */
export class RequestCapabilityContractUtil {
  private static readonly rules: readonly RequestedCapabilityRule[] = [
    {
      label: 'detection/identification',
      request: /\b(?:detect|detects|detecting|identify|identifies|identifying)\b/iu,
      implementation: /\b(?:detect|detection|identif|anomal|flag(?:ging)?|outlier|classif)\w*\b/iu,
      promptInstruction:
        'explicitly implement detection or identification logic and state what is detected, from which inputs, and what happens after detection',
    },
    {
      label: 'tracking',
      request: /\b(?:track|tracks|tracking|trace|traces|tracing|follow|follows|following)\b/iu,
      implementation: /\b(?:track|tracking|trace|tracing|status|lifecycle|stage progression|item progression|queue)\w*\b/iu,
      promptInstruction:
        'explicitly maintain trackable state/progression for the requested object or workflow rather than only displaying a static summary',
    },
    {
      label: 'prediction/forecasting',
      request: /\b(?:predict|predicts|predicting|forecast|forecasting|estimate|estimates|estimating)\b/iu,
      implementation: /\b(?:predict|prediction|predictive|forecast|estimate|estimation|risk scor|probabil)\w*\b/iu,
      promptInstruction:
        'explicitly implement prediction/forecasting or estimation with named operational inputs and a usable output',
    },
    {
      label: 'prioritization/recommendation',
      request: /\b(?:recommend|recommends|recommending|suggest|suggesting|prioriti[sz]e|prioriti[sz]ing|rank|ranking)\b/iu,
      implementation: /\b(?:recommend|recommendation|suggest|prioriti[sz]|rank(?:ing)?|triage)\w*\b/iu,
      promptInstruction:
        'explicitly rank, prioritize, recommend, or suggest actions/items and explain what decision the output supports',
    },
    {
      label: 'optimization/capacity balancing',
      request: /\b(?:optimi[sz]e|optimi[sz]es|optimi[sz]ing|balance|balances|balancing|organize|organise|organizing|organising)\b/iu,
      implementation: /\b(?:optimi[sz]|balanc|organis|organiz|workload|capacity|allocation|schedul)\w*\b/iu,
      promptInstruction:
        'explicitly optimize, organize, balance, allocate, or schedule the constrained resources named by the requester',
    },
    {
      label: 'adaptive scheduling',
      request: /\b(?:adjust|adjusts|adjusting|reorganize|reorganizes|reorganizing|reorganise|reorganises|reorganising|reschedule|reschedules|rescheduling|replan|replanning)\b/iu,
      implementation: /\b(?:adjust|reorgani[sz]|reschedul|replan|rebalanc|reprioriti[sz]|schedule update|schedule revision)\w*\b/iu,
      promptInstruction:
        'explicitly change the schedule/plan when the triggering condition occurs (for example adjust, reschedule, replan, rebalance, or reprioritize); merely detecting or validating the condition is not sufficient',
    },
    {
      label: 'notification/alerting',
      request: /\b(?:remind|reminds|reminding|notify|notifies|notifying|alert|alerts|flag|flags|flagging)\b/iu,
      implementation: /\b(?:remind|reminder|notify|notification|alert|flag)\w*\b/iu,
      promptInstruction:
        'explicitly notify, alert, remind, or flag the relevant user and state the condition that triggers the notification',
    },
    {
      label: 'analysis/scoring',
      request: /\b(?:analy[sz]e|analy[sz]es|analy[sz]ing|score|scoring|assess|assessing)\b/iu,
      implementation: /\b(?:analy[sz]|analysis|analytics|scor|assessment|model inference)\w*\b/iu,
      promptInstruction:
        'explicitly analyze, assess, or score the requested records/events and state how the result is used in the workflow',
    },
    {
      label: 'data/workflow integration',
      request: /\b(?:combine|combines|combining|integrate|integrates|integrating|correlate|correlating)\b/iu,
      implementation: /\b(?:combin|integrat|unif|aggregat|merge|fusion|correlat)\w*\b/iu,
      promptInstruction:
        'explicitly combine/integrate/correlate the requested data or workflow inputs instead of describing them as isolated modules',
    },
    {
      label: 'response/dispatch action',
      request: /\b(?:respond|responds|responding|dispatch|dispatching|assign|assigning)\b/iu,
      implementation: /\b(?:respond|response|dispatch|assign|work order|case routing|maintenance task)\w*\b/iu,
      promptInstruction:
        'explicitly execute the requested response, dispatch, assignment, work-order, or routing action after the triggering event',
    },
  ];

  static resolveRequestedRules(
    desiredOutcome: string | null | undefined,
  ): readonly RequestedCapabilityRule[] {
    const requested = desiredOutcome?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!requested) return [];
    return this.rules.filter((rule) => rule.request.test(requested));
  }

  static resolveMissingCapabilities(
    desiredOutcome: string | null | undefined,
    candidateNarrative: string,
  ): string[] {
    return this.resolveRequestedRules(desiredOutcome)
      .filter((rule) => !rule.implementation.test(candidateNarrative))
      .map((rule) => rule.label);
  }

  static buildPromptChecklist(
    desiredOutcome: string | null | undefined,
  ): string {
    const requestedRules = this.resolveRequestedRules(desiredOutcome);
    if (requestedRules.length === 0) return '';

    return requestedRules
      .map(
        (rule, index) =>
          `${index + 1}. ${rule.label}: ${rule.promptInstruction}.`,
      )
      .join(' ');
  }
}
