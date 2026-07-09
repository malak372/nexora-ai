/**
 * JSON output schema required for guest idea generation.
 *
 * Guests receive only the project title and a limited abstract
 * to encourage account registration or idea unlocking.
 */
export const GUEST_OUTPUT_FORMAT = `
{
  "title": "string",
  "limitedAbstract": "string"
}
`;