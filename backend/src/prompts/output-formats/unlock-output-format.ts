/**
 * JSON output schema required for direct idea unlock requests.
 *
 * Unlock requests expand an existing generated idea with
 * advanced technical, business, and implementation details.
 */
export const UNLOCK_OUTPUT_FORMAT = `
{
  "expandedIdea": true,

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