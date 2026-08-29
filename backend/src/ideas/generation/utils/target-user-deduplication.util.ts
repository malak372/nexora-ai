/**
 * Removes semantically redundant target-user labels while preserving the most
 * informative wording.
 *
 * This utility is deliberately domain-agnostic. It does not contain industry,
 * persona, or test-case names; it compares normalized role phrases so a broad
 * singular role does not survive next to a more specific form of the same
 * role, while genuinely different roles remain.
 */
export class TargetUserDeduplicationUtil {
  static deduplicate(
    values: readonly string[],
    maxItems = 4,
  ): string[] {
    const output: string[] = [];

    for (const raw of values) {
      const candidate = raw.replace(/\s+/gu, ' ').trim();
      if (!candidate) continue;

      const duplicateIndex = output.findIndex((existing) =>
        this.areEquivalent(existing, candidate),
      );

      if (duplicateIndex < 0) {
        output.push(candidate);
        continue;
      }

      const existing = output[duplicateIndex];
      if (!existing) continue;

      if (this.specificityScore(candidate) > this.specificityScore(existing)) {
        output[duplicateIndex] = candidate;
      }
    }

    return output.slice(0, Math.max(1, maxItems));
  }

  private static areEquivalent(left: string, right: string): boolean {
    const leftNormalized = this.normalize(left);
    const rightNormalized = this.normalize(right);
    if (!leftNormalized || !rightNormalized) return false;
    if (leftNormalized === rightNormalized) return true;

    const leftTokens = this.tokens(leftNormalized);
    const rightTokens = this.tokens(rightNormalized);
    if (leftTokens.length === 0 || rightTokens.length === 0) return false;

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
    const minSize = Math.min(leftSet.size, rightSet.size);
    const maxSize = Math.max(leftSet.size, rightSet.size);

    if (minSize === 1 && overlap === 1) {
      const singleton = leftSet.size === 1 ? leftTokens[0] : rightTokens[0];
      const longer = leftSet.size === 1 ? rightTokens : leftTokens;
      return Boolean(
        singleton &&
          singleton.length >= 4 &&
          longer[longer.length - 1] === singleton,
      );
    }

    const containment = overlap / Math.max(1, minSize);
    const jaccard = overlap / Math.max(1, leftSet.size + rightSet.size - overlap);

    return (
      (containment >= 0.85 && maxSize - minSize <= 2) ||
      jaccard >= 0.72
    );
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/&/gu, ' and ')
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/[–—-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private static tokens(value: string): string[] {
    return value
      .split(/\s+/u)
      .map((token) => this.singularize(token))
      .filter((token) => token.length >= 3 && !this.isConnector(token));
  }

  private static singularize(token: string): string {
    if (token.length > 5 && token.endsWith('ies')) {
      return `${token.slice(0, -3)}y`;
    }
    if (
      token.length > 4 &&
      token.endsWith('s') &&
      !token.endsWith('ss') &&
      !token.endsWith('us') &&
      !token.endsWith('is')
    ) {
      return token.slice(0, -1);
    }
    return token;
  }

  private static isConnector(token: string): boolean {
    return new Set([
      'and',
      'the',
      'for',
      'with',
      'from',
      'into',
      'who',
      'that',
      'their',
      'participating',
      'participant',
      'pilot',
      'primary',
      'authorized',
    ]).has(token);
  }

  private static specificityScore(value: string): number {
    const normalized = this.normalize(value);
    const tokens = this.tokens(normalized);
    return tokens.length * 100 + normalized.length;
  }
}
