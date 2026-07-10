/**
 * Centralized cache keys for authenticated user data.
 *
 * @author Eman
 */
export const userCacheKeys = {
  profile: (userId: string) => `user:${userId}:profile`,
  summary: (userId: string) => `user:${userId}:summary`,
  credits: (userId: string) => `user:${userId}:credits`,
  activity: (userId: string) => `user:${userId}:activity`,
  preferences: (userId: string) => `user:${userId}:preferences`,
};
