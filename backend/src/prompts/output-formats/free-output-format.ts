/**
 * JSON output schema required for free registered users.
 *
 * Free users receive the complete project overview within
 * their free generation quota, without premium planning details.
 */
export const FREE_OUTPUT_FORMAT = `
{
  "title": "string",
  "problemStatement": "string",
  "objectives": "string",
  "targetUsers": "string",
  "partialAbstract": "string"
}
`;