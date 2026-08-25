import { Prisma } from '@prisma/client';

/**
 * Returns true only for transient database connectivity failures that may
 * succeed after reconnecting. Validation, constraint and application errors
 * are deliberately excluded.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code);
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return ['P1001', 'P1002', 'P1017'].includes(error.errorCode ?? '');
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return [
    "can't reach database server",
    'connection error',
    'connection terminated',
    'connection reset',
    'server has closed the connection',
    'timed out fetching a new connection',
    'socket hang up',
    'econnreset',
    'etimedout',
    'response from the engine was empty',
    'query engine response was empty',
    'engine was empty',
    'engine is not yet connected',
    'engine is not connected',
    'query engine is not connected',
    'query engine has disconnected',
    'engine has disconnected',
    'prisma client is not connected',
    'unexpected eof',
    'connection closed unexpectedly',
  ].some((fragment) => message.includes(fragment));
}