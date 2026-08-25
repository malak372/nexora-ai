/**
 * Request-scoped semantic contract for online-pharmacy / digital-healthcare
 * marketplace fraud and account-abuse workflows.
 *
 * This utility intentionally separates three concepts:
 * - Direct evidence: the same online-pharmacy / e-prescription workflow.
 * - Supporting evidence: a real adjacent commerce/payment/account-abuse signal
 *   that proves one atomic mechanism without being called pharmacy evidence.
 * - Retrieval candidate: enough identity + workflow to be worth semantic AI
 *   inspection, while blocking clinical-drug-abuse and food-delivery collisions.
 */
export class RequestOnlinePharmacyFraudUtil {
  static isRequest(requestDescription?: string | null): boolean {
    const request = this.normalize(requestDescription ?? '');
    if (!request) return false;
    const actor = this.hasPharmacyMarketplaceIdentity(request);
    const abuse = this.hasAbuseMechanism(request);
    const operational = this.hasOperationalWorkflow(request);
    return actor && abuse && operational;
  }

  static isDirectEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    if (!this.isRequest(requestDescription)) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || this.hasClinicalOrDeliveryCollision(evidence)) return false;

    return (
      this.hasPharmacyMarketplaceIdentity(evidence) &&
      this.hasAbuseMechanism(evidence) &&
      this.hasOperationalWorkflow(evidence) &&
      this.hasProblemImpact(evidence)
    );
  }

  static isSupportingEvidence(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    if (!this.isRequest(requestDescription)) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || this.hasClinicalOrDeliveryCollision(evidence)) return false;
    if (this.isDirectEvidence(requestDescription, evidenceText)) return true;

    const sameSectorPartial =
      this.hasPharmacyMarketplaceIdentity(evidence) &&
      this.hasAbuseMechanism(evidence) &&
      (this.hasOperationalWorkflow(evidence) || this.hasProblemImpact(evidence));

    const adjacentDigitalCommerce =
      this.hasAdjacentCommerceIdentity(evidence) &&
      this.hasAdjacentAccountOrPaymentAbuse(evidence) &&
      (this.hasDetectionOrReviewProblem(evidence) || this.hasProblemImpact(evidence));

    return sameSectorPartial || adjacentDigitalCommerce;
  }

  static isPlausibleRetrievalCandidate(
    requestDescription: string | null | undefined,
    evidenceText: string,
  ): boolean {
    if (!this.isRequest(requestDescription)) return false;
    const evidence = this.normalize(evidenceText);
    if (!evidence || evidence.length < 20) return false;
    if (this.hasClinicalOrDeliveryCollision(evidence)) return false;

    const directLane =
      this.hasPharmacyMarketplaceIdentity(evidence) &&
      this.hasAbuseMechanism(evidence) &&
      (this.hasOperationalWorkflow(evidence) || this.hasProblemImpact(evidence));

    const adjacentLane =
      this.hasAdjacentCommerceIdentity(evidence) &&
      this.hasAdjacentAccountOrPaymentAbuse(evidence) &&
      this.hasDetectionOrReviewProblem(evidence);

    return directLane || adjacentLane;
  }

  static buildSourceQueries(sourceKey: string): string[] {
    const source = this.normalize(sourceKey);
    if (source === 'reddit' || source === 'forum') {
      return [
        'online pharmacy fraudulent prescription detection account takeover problem',
        'digital pharmacy compromised account unauthorized delivery address change',
        'e pharmacy suspicious purchase payment fraud customer account',
        'online pharmacy identity verification false positive legitimate order blocked',
        'e prescription fraud pharmacy account security investigation',
        'pharmacy marketplace unauthorized payment information change fraud',
        'digital marketplace account takeover payment change false positive fraud review',
        'ecommerce fraud review legitimate order false positive account compromise',
      ];
    }
    if (source === 'crossref') {
      return [
        'online pharmacy prescription fraud detection',
        'electronic prescription fraud detection pharmacy information systems',
        'digital pharmacy account takeover payment fraud',
        'online pharmacy identity verification fraud false positives',
        'healthcare ecommerce marketplace fraud detection account security',
        'e prescription security unauthorized prescription transaction',
        'digital marketplace account takeover fraud detection false positive',
      ];
    }
    if (source === 'news' || source === 'gdelt' || source === 'blog') {
      return [
        'online pharmacy fraudulent prescriptions account takeover fraud detection',
        'digital pharmacy suspicious purchases unauthorized payment account changes',
        'e prescription fraud compromised pharmacy customer accounts',
        'online pharmacy delivery address change account fraud security alert',
        'pharmacy marketplace identity verification fraud false positive orders',
        'digital healthcare marketplace payment fraud account compromise',
      ];
    }
    if (source === 'youtube') {
      return [
        'online pharmacy fraud detection prescription account security',
        'digital pharmacy account takeover suspicious orders identity verification',
        'e prescription fraud detection pharmacy security',
      ];
    }
    return [
      'online pharmacy prescription fraud account security',
      'digital pharmacy suspicious purchase payment fraud',
      'e prescription identity verification fraud detection',
    ];
  }

  static preferredSubreddits(): string[] {
    return ['pharmacy', 'cybersecurity', 'scams'];
  }

  static preferredStackExchangeSites(): string[] {
    return ['security.stackexchange.com', 'medicalsciences.stackexchange.com'];
  }

  private static hasPharmacyMarketplaceIdentity(value: string): boolean {
    return /\b(?:online pharmac(?:y|ies)|digital pharmac(?:y|ies)|e[- ]?pharmac(?:y|ies)|internet pharmac(?:y|ies)|pharmacy marketplaces?|digital healthcare marketplaces?|healthcare marketplaces?|online prescription platforms?|e[- ]?prescription platforms?|electronic prescription systems?|e[- ]?prescribing platforms?)\b/u.test(value);
  }

  private static hasAbuseMechanism(value: string): boolean {
    return /\b(?:fraudulent prescriptions?|prescription fraud|fake prescriptions?|forged prescriptions?|prescription forgery|e[- ]?prescription fraud|prescription misuse|suspicious purchases?|suspicious orders?|payment fraud|transaction fraud|unauthorized payments?|unauthorized payment changes?|unauthorized delivery changes?|delivery address changes?|payment information changes?|account takeover|compromised (?:customer|user|pharmacy)?\s*accounts?|unauthorized account changes?|identity theft|coordinated abuse|fraudulent orders?)\b/u.test(value);
  }

  private static hasOperationalWorkflow(value: string): boolean {
    return /\b(?:prescription records?|transaction histor(?:y|ies)|payment histor(?:y|ies)|account activity|account logs?|identity checks?|identity verification|security alerts?|risk signals?|fraud detection|fraud monitoring|transaction monitoring|reviewed separately|separate systems?|fragmented systems?|siloed|disconnected|correlat\w*|investigat\w*|recogniz\w* coordinated|detect\w* coordinated|order review|manual review|fraud review)\b/u.test(value);
  }

  private static hasProblemImpact(value: string): boolean {
    return /\b(?:financial losses?|fraud losses?|privacy risks?|privacy breach|data exposure|delayed legitimate orders?|block\w* legitimate orders?|genuine customers? block\w*|unnecessary restrictions?|false positives?|customer friction|delayed fulfillment|delayed fulfilment|unauthorized purchase|unauthorized transaction|account compromise)\b/u.test(value);
  }

  private static hasAdjacentCommerceIdentity(value: string): boolean {
    return /\b(?:e[- ]?commerce|online marketplace|digital marketplace|online retailer|digital commerce|payment platform|payment system|electronic payment|digital payment|online payment|merchant platform|customer account|user account)\w*\b/u.test(value);
  }

  private static hasAdjacentAccountOrPaymentAbuse(value: string): boolean {
    return /\b(?:account takeover|account compromise|compromised accounts?|unauthorized payment|unauthorized transaction|payment fraud|transaction fraud|identity theft|fraudulent purchase|suspicious purchase|suspicious transaction|delivery address change|payment information change|fraudulent order)\w*\b/u.test(value);
  }

  private static hasDetectionOrReviewProblem(value: string): boolean {
    return /\b(?:fraud detection|risk detection|security alert|identity verification|false positive|manual review|review queue|investigation|hard to detect|difficult to detect|delayed detection|fragmented|siloed|separate systems?|correlat\w*|monitor\w*)\b/u.test(value);
  }

  private static hasClinicalOrDeliveryCollision(value: string): boolean {
    const directIdentity = this.hasPharmacyMarketplaceIdentity(value);
    const clinicalOnly = /\b(?:chronic pain|pain management|opioid use disorder|opioid misuse|prescription opioid abuse|analgesic abuse|drug dependence|substance use disorder|abuse[- ]deterrent formulations?|pain medicine|geriatrics?|clinical treatment)\b/u.test(value) &&
      !this.hasAbuseMechanism(value);
    const foodDelivery = /\b(?:food delivery|meal delivery|restaurant delivery|delivery rider|rider performance|restaurant orders?|food orders?|grocery delivery)\b/u.test(value) && !directIdentity;
    const genericPromotion = /\b(?:buy|order)\s+(?:adderall|xanax|opioids?|medicine|medication|pills?)\s+online\b/u.test(value) &&
      !/\b(?:fraud detection|security|investigation|risk|scam|fraudulent)\b/u.test(value);
    const genericFalsePositive = /^\s*false positive(?: rate)?\s*$/u.test(value);
    return clinicalOnly || foodDelivery || genericPromotion || genericFalsePositive;
  }

  private static normalize(value: string): string {
    return value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[“”]/gu, '"')
      .replace(/[’]/gu, "'")
      .replace(/[^\p{L}\p{N}\s&+/_'-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }
}
