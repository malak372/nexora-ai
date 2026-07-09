/**
 * JSON output schema required for premium credit-based idea generation.
 *
 * Premium users receive a complete software project proposal,
 * including technical architecture, business planning,
 * NLP insights, and implementation guidance.
 */
export const PREMIUM_OUTPUT_FORMAT = `
{
  "title": "string",
  "problemStatement": "string",
  "objectives": "string",
  "targetUsers": "string",
  "fullAbstract": "string",

  "technologyStack": [
    "string"
  ],

  "systemArchitecture": "string",
  "databaseDesign": "string",

  "mvpFeatures": [
    "string"
  ],

  "businessModel": "string",
  "revenueModel": "string",

  "budgetEstimation": "string",
  "implementationTimeline": "string",

  "feasibilityAssessment": "string",
  "marketPotential": "string",

  "localRegulations": "string",
  "valueProposition": "string",

  "nlpAnalysis": "string",
  "nlpConfidence": number,

  "commentAnalysisSummary": "string",

  "recurringProblems": [
    "string"
  ],

  "extractedKeywords": [
    "string"
  ],

  "sampleComments": [
    "string"
  ],

  "commentsCount": number
}
`;