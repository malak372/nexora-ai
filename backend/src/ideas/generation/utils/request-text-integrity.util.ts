export type RequestTextIntegrityResult = {
  readonly text: string | null;
  readonly repaired: boolean;
  readonly reason: 'MID_TOKEN_PASTE_REPAIRED' | null;
};

/**
 * Structural request-text hygiene only.
 *
 * This utility does not infer a domain, problem, workflow, actor, or solution.
 * It only repairs one concrete editor corruption shape observed when a fresh
 * description is pasted into the middle of a previous word and the stale text
 * remains around it, for example:
 *
 *   "assignmenBicycle repair shops ... delivery time. t behavior"
 *
 * The inserted block is accepted only when both splice boundaries are visible:
 * - the new block starts immediately after lowercase letters with an uppercase
 *   letter and no separator;
 * - the block is a substantial sentence/paragraph;
 * - after its sentence-ending punctuation, a short lowercase suffix resumes the
 *   interrupted old word.
 *
 * This keeps semantic authority with AI while preventing stale editor state
 * from poisoning the immutable generation request.
 */
export class RequestTextIntegrityUtil {
  static normalize(value: string | null | undefined): RequestTextIntegrityResult {
    if (typeof value !== 'string') {
      return { text: null, repaired: false, reason: null };
    }

    const normalized = value
      .normalize('NFKC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (!normalized) {
      return { text: null, repaired: false, reason: null };
    }

    const repaired = this.extractMidTokenInsertedBlock(normalized);
    if (!repaired) {
      return { text: normalized, repaired: false, reason: null };
    }

    return {
      text: repaired,
      repaired: true,
      reason: 'MID_TOKEN_PASTE_REPAIRED',
    };
  }

  private static extractMidTokenInsertedBlock(text: string): string | null {
    const codePoints = Array.from(text);
    const offsets: number[] = [];
    let utf16Offset = 0;
    for (const codePoint of codePoints) {
      offsets.push(utf16Offset);
      utf16Offset += codePoint.length;
    }

    for (let index = 1; index < codePoints.length; index += 1) {
      const previous = codePoints[index - 1] ?? '';
      const current = codePoints[index] ?? '';
      if (!/\p{Ll}/u.test(previous) || !/\p{Lu}/u.test(current)) continue;

      let prefixStart = index - 1;
      while (prefixStart > 0 && /\p{L}/u.test(codePoints[prefixStart - 1] ?? '')) {
        prefixStart -= 1;
      }
      const prefix = codePoints.slice(prefixStart, index).join('');
      if (prefix.length < 4 || prefix.length > 24) continue;

      const insertionStart = offsets[index] ?? 0;
      const searchWindow = text.slice(insertionStart, insertionStart + 1600);
      const punctuation = /[.!?](?=\s+\p{Ll}{1,4}(?=\s|\p{P}|$))/gu;
      let boundary: RegExpExecArray | null;

      while ((boundary = punctuation.exec(searchWindow)) !== null) {
        const insertionEnd = insertionStart + boundary.index + boundary[0].length;
        const inserted = text.slice(insertionStart, insertionEnd).trim();
        const after = text.slice(insertionEnd);
        const suffixMatch = after.match(/^\s+(\p{Ll}{1,4})(?=\s|\p{P}|$)/u);
        if (!suffixMatch) continue;

        const suffix = suffixMatch[1] ?? '';
        const wordCount = inserted.split(/\s+/u).filter(Boolean).length;
        if (inserted.length < 80 || wordCount < 10) continue;

        const resumedOldText = after.slice(suffixMatch[0].length).trim();
        if (resumedOldText.split(/\s+/u).filter(Boolean).length < 3) continue;

        const interruptedTokenLength = prefix.length + suffix.length;
        if (interruptedTokenLength < 5 || interruptedTokenLength > 28) continue;

        return inserted
          .replace(/\s+/gu, ' ')
          .trim();
      }
    }

    return null;
  }
}
