/**
 * Returns true only when evidence describes an actual document/file access or
 * download failure. Mere mentions of "filed", "file", screenshots, reports,
 * attachments, or proof are intentionally insufficient.
 */
export function hasDocumentAccessOrDownloadFailure(value: string): boolean {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
    : '';
  if (!text) return false;

  const directActionFailure =
    /\b(?:cannot|can['’]?t|unable to|failed to|fails? to|won['’]?t|doesn['’]?t|does not)\s+(?:open|download|access|view|load|retrieve|get)\s+(?:the\s+|a\s+|an\s+|my\s+|this\s+|that\s+)?(?:document|file|pdf|attachment|syllabus|link)\b/iu.test(text);

  const objectStateFailure =
    /\b(?:document|file|pdf|attachment|syllabus|download(?:\s+link)?|document\s+link|file\s+link)\b[^.!?]{0,70}\b(?:cannot be opened|can['’]?t be opened|won['’]?t open|doesn['’]?t open|does not open|failed to open|fails? to open|download failed|download fails?|download error|access denied|permission denied|is unavailable|is missing|broken link|link is broken|returns? (?:an? )?error|gives? (?:an? )?error)\b/iu.test(text);

  const downloadFailure =
    /\bdownload(?:ing)?\b[^.!?]{0,50}\b(?:fails?|failed|failure|error|broken|unavailable|stuck|doesn['’]?t work|does not work|won['’]?t work)\b/iu.test(text) ||
    /\b(?:failed|failure|error|problem|issue)\b[^.!?]{0,35}\bdownload(?:ing)?\b/iu.test(text);

  return directActionFailure || objectStateFailure || downloadFailure;
}
