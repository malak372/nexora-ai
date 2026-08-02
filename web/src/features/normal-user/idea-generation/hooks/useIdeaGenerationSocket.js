/**
 * Real-time generation-run subscription with guaranteed live reconciliation.
 *
 * Socket.IO remains the primary channel and updates the UI immediately. A
 * lightweight HTTP reconciliation loop also runs while the generation is
 * active, so a temporary socket/auth/network issue can never leave the screen
 * frozen at 0% until a manual reload.
 *
 * @author Malak
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { getAccessToken } from '../../../auth/shared/auth.storage';
import { getGenerationRun } from '../api/ideaGenerationApi';

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL?.replace(/\/$/, '') ||
  process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
  process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
  'http://localhost:3000';

const SOCKET_RECONCILIATION_MS = 4_000;
const FALLBACK_RECONCILIATION_MS = 2_000;
const RATE_LIMIT_RETRY_MS = 15_000;
const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'NO_RESULT',
]);

function toTimestamp(value) {
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeStage(stages, nextStage) {
  const incomingKey = nextStage.stageKey ?? nextStage.key;
  const index = stages.findIndex(
    (stage) => (stage.stageKey ?? stage.key) === incomingKey,
  );

  if (index === -1) {
    return [...stages, nextStage].sort(
      (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
    );
  }

  const current = stages[index];

  if (
    toTimestamp(nextStage.updatedAt) > 0 &&
    toTimestamp(current.updatedAt) > toTimestamp(nextStage.updatedAt)
  ) {
    return stages;
  }

  const copy = [...stages];
  copy[index] = { ...current, ...nextStage };
  return copy;
}

function mergeStages(currentStages = [], incomingStages = []) {
  return incomingStages.reduce(
    (merged, stage) => mergeStage(merged, stage),
    currentStages,
  );
}

function mergeRunSnapshot(current, incoming) {
  if (!current) {
    return {
      ...incoming,
      id: incoming?.id ?? incoming?.runId,
      runId: incoming?.runId ?? incoming?.id,
      stages: incoming?.stages ?? [],
    };
  }

  if (
    toTimestamp(incoming?.updatedAt) > 0 &&
    toTimestamp(current?.updatedAt) > toTimestamp(incoming?.updatedAt)
  ) {
    return current;
  }

  return {
    ...current,
    ...incoming,
    id: incoming?.id ?? incoming?.runId ?? current?.id,
    runId: incoming?.runId ?? incoming?.id ?? current?.runId,
    progressPercent: Math.max(
      Number(current?.progressPercent ?? 0),
      Number(incoming?.progressPercent ?? 0),
    ),
    stages: mergeStages(current?.stages ?? [], incoming?.stages ?? []),
  };
}

export function useIdeaGenerationSocket(runId) {
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);
  const reconciliationTimerRef = useRef(null);
  const runRef = useRef(null);
  const socketProvenRef = useRef(false);

  const [run, setRun] = useState(null);
  const [connectionState, setConnectionState] = useState('connecting');
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const loadSnapshot = useCallback(
    async ({ silent = false } = {}) => {
      if (!runId || requestInFlightRef.current) {
        return runRef.current;
      }

      requestInFlightRef.current = true;

      try {
        const data = await getGenerationRun(runId);

        if (mountedRef.current) {
          setRun((current) => mergeRunSnapshot(current, data));
          setError('');
          setErrorStatus(null);
        }

        return data;
      } catch (requestError) {
        const status = requestError?.response?.status ?? null;

        if (mountedRef.current && !silent) {
          setErrorStatus(status);
          setError(
            status === 429
              ? 'Live progress is still running. Status synchronization will retry automatically.'
              : requestError?.response?.data?.message ||
                  requestError?.message ||
                  'Generation progress could not be refreshed.',
          );
        }

        throw requestError;
      } finally {
        requestInFlightRef.current = false;
      }
    },
    [runId],
  );

  useEffect(() => {
    if (!runId) return undefined;

    mountedRef.current = true;
    socketProvenRef.current = false;

    const clearReconciliationTimer = () => {
      if (reconciliationTimerRef.current) {
        window.clearTimeout(reconciliationTimerRef.current);
        reconciliationTimerRef.current = null;
      }
    };

    const scheduleReconciliation = (delay) => {
      clearReconciliationTimer();

      if (
        !mountedRef.current ||
        TERMINAL_STATUSES.has(runRef.current?.status)
      ) {
        return;
      }

      reconciliationTimerRef.current = window.setTimeout(async () => {
        let nextDelay = socketProvenRef.current
          ? SOCKET_RECONCILIATION_MS
          : FALLBACK_RECONCILIATION_MS;

        try {
          await loadSnapshot({ silent: true });
        } catch (requestError) {
          if (requestError?.response?.status === 429) {
            nextDelay = RATE_LIMIT_RETRY_MS;
          }
        } finally {
          scheduleReconciliation(nextDelay);
        }
      }, delay);
    };

    // Fetch immediately. This catches stages that started before the page mounted.
    loadSnapshot({ silent: false })
      .catch(() => undefined)
      .finally(() => scheduleReconciliation(FALLBACK_RECONCILIATION_MS));

    const socket = io(`${SOCKET_URL}/idea-generation`, {
      transports: ['websocket', 'polling'],
      auth: (callback) => {
        callback({ token: getAccessToken() });
      },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4_000,
      timeout: 10_000,
    });

    socketRef.current = socket;

    const markRealtimeEvent = () => {
      socketProvenRef.current = true;
      setConnectionState('connected');
    };

    socket.on('connect', () => {
      setConnectionState('joining');

      socket.emit('idea-generation.join', { runId }, (acknowledgement) => {
        if (!mountedRef.current) return;

        if (acknowledgement?.success) {
          setConnectionState('connected');
          setError('');
          setErrorStatus(null);

          // Reconcile once after joining so no event can be missed between the
          // initial HTTP request and room subscription.
          loadSnapshot({ silent: true }).catch(() => undefined);
          return;
        }

        setConnectionState('fallback');
      });
    });

    socket.on('disconnect', () => {
      socketProvenRef.current = false;
      setConnectionState('reconnecting');
    });

    socket.on('connect_error', () => {
      socketProvenRef.current = false;
      setConnectionState('fallback');
    });

    socket.on('idea-generation.snapshot', (payload) => {
      if (payload?.runId !== runId) return;

      markRealtimeEvent();
      setRun((current) => mergeRunSnapshot(current, payload));
      setError('');
      setErrorStatus(null);
    });

    socket.on('idea-generation.run.updated', (payload) => {
      if (payload?.runId !== runId) return;

      markRealtimeEvent();
      setRun((current) => mergeRunSnapshot(current, payload));
    });

    socket.on('idea-generation.stage.updated', (payload) => {
      if (payload?.runId !== runId) return;

      markRealtimeEvent();
      setRun((current) => {
        const stages = mergeStage(current?.stages ?? [], payload);

        return {
          ...(current ?? { id: runId, runId, stages: [] }),
          progressPercent: Math.max(
            Number(current?.progressPercent ?? 0),
            Number(payload.progressPercent ?? 0),
          ),
          currentStageKey:
            payload.status === 'RUNNING'
              ? payload.stageKey
              : current?.currentStageKey,
          stages,
        };
      });
    });

    return () => {
      mountedRef.current = false;
      clearReconciliationTimer();

      if (socket.connected) {
        socket.emit('idea-generation.leave', { runId }, () => undefined);
      }

      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadSnapshot, runId]);

  return {
    run,
    connectionState,
    error,
    errorStatus,
    refresh: () => loadSnapshot(),
  };
}
