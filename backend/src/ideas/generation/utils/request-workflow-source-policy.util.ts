import type { RequestCanonicalProblemProfile } from '../types/request-collection-plan.type';

/**
 * Generic retrieval-source policy derived from the requester-owned problem
 * shape. It never maps a named business/domain to a hard-coded source.
 */
export class RequestWorkflowSourcePolicyUtil {
  static shouldSuppressAppReviewLanes(input: {
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): boolean {
    const problemText = this.problemOwnedText(
      input.requestDescription ?? '',
      input.problemProfile,
    );
    if (!problemText) return false;

    const physicalOperationalWorkflow = /\b(?:workshop|workshops|shop|shops|studio|studios|facility|facilities|warehouse|warehouses|factory|factories|plant|plants|production|manufacturing|assembly|material|materials|inventory|stock|supplies|equipment|machinery|batch|batches|measurement|measurements|cutting|finishing|fitting|packaging|pickup|delivery deadline|customer order|custom order|maintenance task|field service)\b/iu.test(
      problemText,
    );
    const problemNativeAppIdentity = /\b(?:mobile app|mobile application|software application|software system|digital service|web portal|website|account login|sign[- ]?in|subscription|app update|application update|sync failure|synchronization failure|api|sdk|browser extension|desktop app)\b/iu.test(
      problemText,
    );

    return physicalOperationalWorkflow && !problemNativeAppIdentity;
  }

  static isAppReviewSource(sourceKey: string): boolean {
    const key = sourceKey.trim().toLocaleLowerCase();
    return key === 'app-store' || key === 'google-play';
  }

  static shouldSuppressDeveloperCommunityLanes(input: {
    readonly requestDescription?: string | null;
    readonly problemProfile?: RequestCanonicalProblemProfile | null;
  }): boolean {
    const problemText = this.problemOwnedText(
      input.requestDescription ?? '',
      input.problemProfile,
    );
    if (!problemText) return false;

    const problemNativeTechnicalIdentity = /\b(?:software|mobile app|mobile application|web app|web application|website|api|sdk|database|server|runtime|deployment|container runtime|docker|kubernetes|webhook|endpoint|authentication|authorization|login|sign[- ]?in|network traffic|firewall|sandbox|source code|code execution|build pipeline|ci\/?cd|cloud infrastructure|model inference|machine learning model|llm|rag system|browser extension|desktop app)\b/iu.test(
      problemText,
    );

    return !problemNativeTechnicalIdentity;
  }

  static isDeveloperCommunitySource(sourceKey: string): boolean {
    return ['github', 'stackoverflow', 'dev-to', 'hacker-news'].includes(
      sourceKey.trim().toLocaleLowerCase(),
    );
  }

  private static problemOwnedText(
    requestDescription: string,
    problemProfile?: RequestCanonicalProblemProfile | null,
  ): string {
    const descriptionProblemClause = requestDescription
      .normalize('NFKC')
      .split(
        /\b(?:a smarter|a better|a proposed|the proposed|a platform could|a system could|software could|a solution could|the system could)\b/iu,
        1,
      )[0]
      ?.trim() ?? '';

    return [
      descriptionProblemClause,
      problemProfile?.actor ?? '',
      problemProfile?.object ?? '',
      problemProfile?.workflow ?? '',
      problemProfile?.friction ?? '',
      ...(problemProfile?.failureModes ?? []),
      ...(problemProfile?.consequences ?? []),
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
