/**
 * Utility class responsible for creating standardized HTTP headers
 * used by external data collectors.
 *
 * Features:
 * - Provides reusable default JSON headers.
 * - Generates GitHub API request headers.
 * - Creates Bearer authentication headers for OAuth-based APIs.
 * - Ensures a consistent User-Agent across all outbound requests.
 *
 * Centralizing header creation improves maintainability,
 * reduces code duplication, and simplifies future updates.
 *
 * @author Malak
 */
export class CollectorHeaderUtil {
  /**
   * Returns the default headers for JSON-based HTTP requests.
   *
   * Includes:
   * - JSON response acceptance.
   * - Project User-Agent.
   *
   * Suitable for APIs that do not require authentication.
   *
   * @returns Default HTTP headers.
   */
  static json(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': 'NexoraAI-Graduation-Project',
    };
  }

  /**
   * Returns the recommended headers for GitHub REST API requests.
   *
   * Includes:
   * - GitHub API media type.
   * - GitHub API version.
   * - Project User-Agent.
   * - Optional Bearer authentication token.
   *
   * If no token is provided, only public GitHub resources
   * can be accessed.
   *
   * @param token Optional GitHub personal access token.
   * @returns GitHub API request headers.
   */
  static github(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NexoraAI-Graduation-Project',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Returns HTTP headers containing a Bearer authentication token.
   *
   * Suitable for OAuth-protected APIs such as:
   * - Reddit
   * - X (Twitter)
   * - LinkedIn
   * - Other services using Bearer authentication.
   *
   * Includes:
   * - Authorization header.
   * - JSON response acceptance.
   * - Project User-Agent.
   *
   * @param token OAuth access token.
   * @returns Authenticated HTTP headers.
   */
  static bearer(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'NexoraAI-Graduation-Project',
    };
  }
}