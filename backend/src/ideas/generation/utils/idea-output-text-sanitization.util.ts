export class IdeaOutputTextSanitizationUtil {
  static normalizeIdempotentPhrases(value: string): string {
    let normalized = value.replace(/\s+/gu, ' ').trim();

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const previous = normalized;
      normalized = normalized
        .replace(/\b(a|an|the)\s+\1\b/giu, '$1')
        .replace(/\b(may|can|could|will|would|should|must)\s+\1\b/giu, '$1')
        .replace(/\b(to|of|for|with|and|or|that|this|these|those)\s+\1\b/giu, '$1')
        .replace(
          /\bhelp\s+ensure(?:\s+help(?:\s+ensure)?)+\b/giu,
          'help ensure',
        )
        .replace(
          /\bhelping\s+ensure(?:\s+help(?:ing)?(?:\s+ensure)?)+\b/giu,
          'helping ensure',
        )
        .replace(/\bhelp\s+help\s+ensure\b/giu, 'help ensure')
        .replace(/\bhelps\s+help\s+ensure\b/giu, 'helps ensure')
        .replace(/\bhelping\s+help\s+ensure\b/giu, 'helping ensure')
        .replace(
          /\bis designed to help\s+(?:help\s+)?ensure\b/giu,
          'is designed to help ensure',
        )
        .replace(
          /\bdesigned to help ensure\s+help(?:\s+ensure)?\b/giu,
          'designed to help ensure',
        )
        .replace(
          /\bhelp ensure that\s+help ensure that\b/giu,
          'help ensure that',
        )
        .replace(
          /\b(?:while|although|whereas)\s+(?:direct|indirect|community|external|supporting|retained)\s+(?=(?:the|one|a)\s+retained\b)/giu,
          '',
        )
        .replace(
          /\b(?:rather than|instead of)\s+(an?\s+)?([^.!?]{2,100}?)\s+is designed to help ensure(?=[.!?])/giu,
          (_match, article: string | undefined, phrase: string) =>
            `rather than ${(article ?? '')}${phrase}`.trim(),
        )
        .replace(
          /\b(?:rather than\s+)?precommitted percentage is designed to help ensure\b/giu,
          'rather than precommitted percentage targets',
        )
        .replace(
          /\b(?:rather than\s+)?fixed percentage is designed to help ensure\b/giu,
          'rather than fixed percentage targets',
        )
        .replace(/\ba\s+a\s+measurable\b/giu, 'a measurable')
        .replace(/\ban\s+an\s+measurable\b/giu, 'a measurable')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .replace(/[ \t]{2,}/gu, ' ')
        .trim();

      if (normalized === previous) break;
    }

    return normalized;
  }
}
