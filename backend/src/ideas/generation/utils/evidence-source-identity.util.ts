/**
 * Resolves a provenance-aware external-source identity for evidence counting.
 *
 * Collector keys describe transport lanes (for example `news`), not always an
 * independent publisher. When documentary collectors preserve a publisher in
 * the title/text, count that publisher separately so four unrelated news
 * outlets do not collapse into one synthetic source merely because they were
 * fetched through the same collector.
 *
 * This utility never changes semantic relevance. It only normalizes provenance
 * for independence/corroboration counters.
 */
export class EvidenceSourceIdentityUtil {
  private static readonly publisherAwareSourceKeys = new Set([
    'news',
    'gdelt',
    'blog',
  ]);

  static resolve(input: {
    readonly sourceKey: string;
    readonly title?: string | null;
    readonly text?: string | null;
    readonly id?: string | null;
    readonly jointSourceIdentities?: readonly string[];
  }): string {
    const sourceKey = this.normalizeToken(input.sourceKey) || 'unknown';

    const host = this.extractHostname(input.id);
    if (host && !this.isCollectorHostname(host)) {
      return `host:${host}`;
    }

    if (this.publisherAwareSourceKeys.has(sourceKey)) {
      const publisher =
        this.extractPublisher(input.title) ??
        this.extractPublisher(input.text);
      if (publisher) {
        return `publisher:${publisher}`;
      }
    }

    return sourceKey;
  }

  static resolveAll(input: {
    readonly sourceKey: string;
    readonly title?: string | null;
    readonly text?: string | null;
    readonly id?: string | null;
    readonly jointSourceIdentities?: readonly string[];
  }): readonly string[] {
    const joint = (input.jointSourceIdentities ?? [])
      .map((value) => value.trim())
      .filter(Boolean);
    return joint.length > 0 ? [...new Set(joint)] : [this.resolve(input)];
  }

  static count(
    items: readonly {
      readonly sourceKey: string;
      readonly title?: string | null;
      readonly text?: string | null;
      readonly id?: string | null;
      readonly jointSourceIdentities?: readonly string[];
    }[],
  ): number {
    return new Set(items.flatMap((item) => this.resolveAll(item))).size;
  }

  private static extractHostname(value?: string | null): string | null {
    const raw = value?.trim();
    if (!raw) return null;

    const match = raw.match(/https?:\/\/[^\s]+/iu);
    if (!match) return null;

    try {
      const hostname = new URL(match[0]).hostname
        .toLocaleLowerCase()
        .replace(/^www\./u, '')
        .trim();
      return hostname || null;
    } catch {
      return null;
    }
  }

  private static isCollectorHostname(hostname: string): boolean {
    return /(?:^|\.)google\.com$|(?:^|\.)googleapis\.com$|(?:^|\.)reddit\.com$|(?:^|\.)youtube\.com$/iu.test(
      hostname,
    );
  }

  private static extractPublisher(value?: string | null): string | null {
    const raw = value?.replace(/\s+/gu, ' ').trim();
    if (!raw || raw.length < 6) return null;

    /*
     * Most News/GDELT rows preserve the outlet as the final " - Publisher"
     * suffix. Use the final suffix only, keep it compact, and reject fragments
     * that look like another sentence rather than a publisher name.
     */
    const separators = [' - ', ' – ', ' — ', ' | '];
    for (const separator of separators) {
      const index = raw.lastIndexOf(separator);
      if (index <= 0) continue;
      const candidate = raw.slice(index + separator.length).trim();
      const normalized = this.normalizePublisher(candidate);
      if (normalized) return normalized;
    }

    /*
     * Collector text can duplicate "Title - Publisher" several times. When
     * the first occurrence is followed by another copy, extract that compact
     * publisher even if the complete text does not end with it.
     */
    const repeatedMatch = raw.match(
      /\s(?:-|–|—|\|)\s([\p{L}\p{N}][\p{L}\p{N}.&'’()\-\s]{1,70}?)(?=\s{1,3}[\p{Lu}\d][^\n]{8,}\s(?:-|–|—|\|)\s)/u,
    );
    return this.normalizePublisher(repeatedMatch?.[1] ?? null);
  }

  private static normalizePublisher(value?: string | null): string | null {
    if (!value) return null;
    const compact = value
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .replace(/^[\s:;,.-]+|[\s:;,.-]+$/gu, '')
      .trim();
    if (!compact || compact.length < 2 || compact.length > 72) return null;

    const words = compact.split(/\s+/u).filter(Boolean);
    if (words.length === 0 || words.length > 9) return null;
    if (/[!?]{1,}|[.!?]\s+[\p{Lu}\d]/u.test(compact)) return null;

    return this.normalizeToken(compact);
  }

  private static normalizeToken(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}.&'’()\-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
