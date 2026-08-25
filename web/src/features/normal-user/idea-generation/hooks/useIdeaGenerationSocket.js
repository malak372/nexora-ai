/**
 * Real-time generation-run subscription with guaranteed live reconciliation.
 *
 * Socket.IO remains the primary channel and updates the UI immediately. A
 * lightweight HTTP reconciliation loop runs as a safety net. While the socket
 * is healthy it reconciles only occasionally; when realtime is unavailable it
 * falls back to frequent HTTP checks so the screen never freezes.
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

const SOCKET_RECONCILIATION_MS = 15_000;
const FALLBACK_RECONCILIATION_MS = 1_250;
const INITIAL_SOCKET_GRACE_MS = 750;
const RATE_LIMIT_RETRY_MS = 15_000;

const STAGE_SEQUENCE = new Map([
  ['preparing', 0],
  ['request-validation', 1],
  ['entitlement-check', 2],
  ['domain-resolution', 3],
  ['data-source-selection', 4],
  ['collection-job-resolution', 5],
  ['data-collection', 6],
  ['nlp-analysis', 7],
  ['community-ai-analysis', 8],
  ['opportunity-ranking', 9],
  ['prompt-building', 10],
  ['core-idea-generation', 11],
  ['ai-output-validation', 12],
  ['duplicate-check', 13],
  ['idea-persistence', 14],
  ['full-abstract-generation', 15],
  ['technology-stack-generation', 16],
  ['system-architecture-generation', 17],
  ['database-design-generation', 18],
  ['mvp-features-generation', 19],
  ['value-proposition-generation', 20],
  ['revenue-model-generation', 21],
  ['local-regulations-generation', 22],
  ['budget-estimation-generation', 23],
  ['feasibility-assessment-generation', 24],
  ['implementation-timeline-generation', 25],
  ['market-potential-generation', 26],
  ['nlp-executive-summary-generation', 27],
  ['community-feedback-summary-generation', 28],
  ['finalization', 99],
]);

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'NO_RESULT',
]);

function resolveForwardStage(currentKey, incomingKey) {
  if (!incomingKey) {
    return currentKey ?? null;
  }

  if (!currentKey) {
    return incomingKey;
  }

  const currentSequence =
    STAGE_SEQUENCE.get(currentKey) ?? 0;

  const incomingSequence =
    STAGE_SEQUENCE.get(incomingKey) ?? 0;

  return incomingSequence >= currentSequence
    ? incomingKey
    : currentKey;
}

function resolveFurthestStageKey(stages = []) {
  return stages.reduce((resolvedKey, stage) => {
    const stageKey =
      stage?.stageKey ??
      stage?.key;

    const status = String(
      stage?.status ?? '',
    ).toUpperCase();

    if (
      !stageKey ||
      ![
        'RUNNING',
        'COMPLETED',
        'SUCCEEDED',
        'SKIPPED',
      ].includes(status)
    ) {
      return resolvedKey;
    }

    return resolveForwardStage(
      resolvedKey,
      stageKey,
    );
  }, null);
}

function resolveFurthestStageProgress(stages = []) {
  return stages.reduce((progress, stage) => {
    const status = normalizeStatus(stage?.status);

    if (
      ![
        'RUNNING',
        'COMPLETED',
        'SUCCEEDED',
        'SKIPPED',
      ].includes(status)
    ) {
      return progress;
    }

    return Math.max(
      progress,
      Number(stage?.progressPercent ?? 0),
    );
  }, 0);
}

function getRunIdeaId(run) {
  return (
    run?.ideaId ??
    run?.idea?.id ??
    run?.idea?.ideaId ??
    null
  );
}

function isFullyResolvedTerminalRun(run) {
  const status = String(
    run?.status ?? '',
  ).toUpperCase();

  if (!TERMINAL_STATUSES.has(status)) {
    return false;
  }

  return (
    status !== 'COMPLETED' ||
    Boolean(getRunIdeaId(run))
  );
}

const STAGE_STATUS_RANK = new Map([
  ['PENDING', 0],
  ['RUNNING', 1],
  ['SKIPPED', 2],
  ['COMPLETED', 3],
  ['SUCCEEDED', 3],
  ['FAILED', 4],
]);

const RUN_STATUS_RANK = new Map([
  ['QUEUED', 0],
  ['RUNNING', 1],
  ['PAUSED', 2],
  ['RETRYING', 2],
  ['NO_RESULT', 3],
  ['FAILED', 4],
  ['CANCELLED', 4],
  ['COMPLETED', 5],
]);

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

function resolveRunStatus(currentStatus, incomingStatus) {
  const current = normalizeStatus(currentStatus);
  const incoming = normalizeStatus(incomingStatus);

  if (!incoming) return current || 'QUEUED';
  if (!current) return incoming;

  // A recovered PAUSED/RETRYING run legitimately transitions back to RUNNING.
  if (
    (current === 'PAUSED' || current === 'RETRYING') &&
    incoming === 'RUNNING'
  ) {
    return incoming;
  }

  const currentRank =
    RUN_STATUS_RANK.get(current) ?? -1;

  const incomingRank =
    RUN_STATUS_RANK.get(incoming) ?? -1;

  return incomingRank >= currentRank
    ? incoming
    : current;
}

function toTimestamp(value) {
  const timestamp = value
    ? Date.parse(value)
    : 0;

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

function mergeStage(stages, nextStage) {
  const incomingKey =
    nextStage?.stageKey ??
    nextStage?.key;

  if (!incomingKey) {
    return stages;
  }

  const index = stages.findIndex(
    (stage) =>
      (stage.stageKey ?? stage.key) ===
      incomingKey,
  );

  if (index === -1) {
    return [...stages, nextStage].sort(
      (a, b) =>
        Number(a.sequence ?? 0) -
        Number(b.sequence ?? 0),
    );
  }

  const current = stages[index];

  const currentStatus =
    normalizeStatus(current?.status);

  const incomingStatus =
    normalizeStatus(nextStage?.status);

  const currentRank =
    STAGE_STATUS_RANK.get(currentStatus) ?? -1;

  const incomingRank =
    STAGE_STATUS_RANK.get(incomingStatus) ?? -1;

  /*
   * Stage lifecycle direction is more authoritative than wall-clock ordering.
   * This prevents a delayed persisted RUNNING row from replacing an already
   * received COMPLETED realtime transition when clocks differ slightly.
   */
  if (incomingRank < currentRank) {
    return stages;
  }

  if (
    incomingRank === currentRank &&
    toTimestamp(nextStage.updatedAt) > 0 &&
    toTimestamp(current.updatedAt) >
      toTimestamp(nextStage.updatedAt)
  ) {
    return stages;
  }

  const copy = [...stages];

  copy[index] = {
    ...current,
    ...nextStage,
  };

  return copy.sort(
    (a, b) =>
      Number(a.sequence ?? 0) -
      Number(b.sequence ?? 0),
  );
}

function mergeStages(
  currentStages = [],
  incomingStages = [],
) {
  return incomingStages.reduce(
    (merged, stage) =>
      mergeStage(merged, stage),
    currentStages,
  );
}

function mergeRunSnapshot(current, incoming) {
  const incomingStages = Array.isArray(
    incoming?.stages,
  )
    ? incoming.stages
    : [];

  if (!current) {
    const stages = mergeStages(
      [],
      incomingStages,
    );

    return {
      ...incoming,

      id:
        incoming?.id ??
        incoming?.runId,

      runId:
        incoming?.runId ??
        incoming?.id,

      ideaId:
        getRunIdeaId(incoming),

      status:
        resolveRunStatus(
          null,
          incoming?.status,
        ),

      progressPercent: Math.max(
        Number(
          incoming?.progressPercent ?? 0,
        ),
        resolveFurthestStageProgress(stages),
      ),

      currentStageKey: resolveForwardStage(
        incoming?.currentStageKey,
        resolveFurthestStageKey(stages),
      ),

      stages,
    };
  }

  const incomingTimestamp =
    toTimestamp(incoming?.updatedAt);

  const currentTimestamp =
    toTimestamp(current?.updatedAt);

  const incomingIsNewer =
    incomingTimestamp === 0 ||
    currentTimestamp === 0 ||
    incomingTimestamp >= currentTimestamp;

  /*
   * Parent-run timestamps and stage-row timestamps are independent. Never drop
   * an entire socket/HTTP snapshot just because an optimistic run event has a
   * newer updatedAt; merge stage rows separately and preserve monotonic
   * lifecycle/progress fields.
   */
  const merged = incomingIsNewer
    ? {
        ...current,
        ...incoming,
      }
    : {
        ...current,
      };

  if (!incomingIsNewer) {
    for (const key of [
      'ideaId',
      'ideaTitle',
      'idea',
      'completedAt',
      'errorCode',
      'errorMessage',
      'generationType',
      'type',
      'metadata',
    ]) {
      if (incoming?.[key] != null) {
        merged[key] = incoming[key];
      }
    }
  }

  const stages = mergeStages(
    current?.stages ?? [],
    incomingStages,
  );

  merged.id =
    incoming?.id ??
    incoming?.runId ??
    current?.id ??
    current?.runId;

  merged.runId =
    incoming?.runId ??
    incoming?.id ??
    current?.runId ??
    current?.id;

  merged.ideaId =
    getRunIdeaId(incoming) ??
    getRunIdeaId(current);

  merged.generationType =
    incoming?.generationType ??
    current?.generationType ??
    null;

  merged.startedAt =
    incoming?.startedAt ??
    current?.startedAt ??
    null;

  merged.completedAt =
    incoming?.completedAt ??
    current?.completedAt ??
    null;

  merged.cancelRequestedAt =
    incoming?.cancelRequestedAt ??
    current?.cancelRequestedAt ??
    null;

  merged.status = resolveRunStatus(
    current?.status,
    incoming?.status,
  );

  merged.progressPercent = Math.max(
    Number(
      current?.progressPercent ?? 0,
    ),
    Number(
      incoming?.progressPercent ?? 0,
    ),
    resolveFurthestStageProgress(stages),
  );

  merged.currentStageKey =
    resolveForwardStage(
      current?.currentStageKey,
      resolveForwardStage(
        incoming?.currentStageKey,
        resolveFurthestStageKey(stages),
      ),
    );

  merged.stages = stages;

  if (
    incomingTimestamp >= currentTimestamp &&
    incoming?.updatedAt != null
  ) {
    merged.updatedAt =
      incoming.updatedAt;
  } else {
    merged.updatedAt =
      current?.updatedAt ??
      incoming?.updatedAt ??
      null;
  }

  return merged;
}

export function useIdeaGenerationSocket(
  runId,
  initialRun = null,
) {
  const socketRef =
    useRef(null);

  const mountedRef =
    useRef(true);

  const requestInFlightRef =
    useRef(false);

  const reconciliationTimerRef =
    useRef(null);

  const runRef =
    useRef(initialRun);

  const socketProvenRef =
    useRef(false);

  const [run, setRun] =
    useState(initialRun);

  const [
    connectionState,
    setConnectionState,
  ] = useState('connecting');

  const [error, setError] =
    useState('');

  const [
    errorStatus,
    setErrorStatus,
  ] = useState(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const loadSnapshot = useCallback(
    async ({
      silent = false,
    } = {}) => {
      if (
        !runId ||
        requestInFlightRef.current
      ) {
        return runRef.current;
      }

      requestInFlightRef.current = true;

      try {
        const data =
          await getGenerationRun(runId);

        if (mountedRef.current) {
          setRun((current) =>
            mergeRunSnapshot(
              current,
              data,
            ),
          );

          setError('');
          setErrorStatus(null);
        }

        return data;
      } catch (requestError) {
        const status =
          requestError?.response?.status ??
          null;

        if (
          mountedRef.current &&
          !silent
        ) {
          const isPermanentAccessError =
            status === 403 ||
            status === 404;

          if (isPermanentAccessError) {
            setErrorStatus(status);

            setError(
              requestError?.response
                ?.data?.message ||
                requestError?.message ||
                'Generation progress could not be refreshed.',
            );
          } else {
            /*
             * Temporary HTTP failures must not replace
             * the active generation screen.
             *
             * Socket.IO remains the primary source for
             * live progress and the reconciliation loop
             * will keep retrying automatically.
             */
            setErrorStatus(null);
            setError('');

            setConnectionState(
              (current) =>
                current === 'connected'
                  ? current
                  : 'reconnecting',
            );
          }
        }

        throw requestError;
      } finally {
        requestInFlightRef.current = false;
      }
    },
    [runId],
  );

  const resolvedIdeaId =
    getRunIdeaId(run);

  const runStatus =
    String(
      run?.status ?? '',
    ).toUpperCase();

  /*
   * A COMPLETED socket event may arrive a fraction
   * before the final idea relationship is hydrated.
   *
   * Reconcile once more until the idea id becomes
   * available instead of treating the run as incomplete.
   */
  useEffect(() => {
    if (
      runStatus !== 'COMPLETED' ||
      resolvedIdeaId
    ) {
      return;
    }

    loadSnapshot({
      silent: true,
    }).catch(() => undefined);
  }, [
    loadSnapshot,
    resolvedIdeaId,
    runStatus,
  ]);

  useEffect(() => {
    if (!runId) {
      return undefined;
    }

    mountedRef.current = true;
    socketProvenRef.current = false;

    const seededRun =
      initialRun &&
      String(
        initialRun?.runId ??
          initialRun?.id ??
          '',
      ) === String(runId)
        ? initialRun
        : null;

    setRun(seededRun);
    runRef.current = seededRun;

    setError('');
    setErrorStatus(null);

    setConnectionState(
      'connecting',
    );

    const clearReconciliationTimer =
      () => {
        if (
          reconciliationTimerRef.current
        ) {
          window.clearTimeout(
            reconciliationTimerRef.current,
          );

          reconciliationTimerRef.current =
            null;
        }
      };

    const scheduleReconciliation =
      (delay) => {
        clearReconciliationTimer();

        if (
          !mountedRef.current ||
          isFullyResolvedTerminalRun(
            runRef.current,
          )
        ) {
          return;
        }

        reconciliationTimerRef.current =
          window.setTimeout(
            async () => {
              let nextDelay =
                socketProvenRef.current
                  ? SOCKET_RECONCILIATION_MS
                  : FALLBACK_RECONCILIATION_MS;

              try {
                await loadSnapshot({
                  silent: true,
                });
              } catch (requestError) {
                if (
                  requestError
                    ?.response?.status === 429
                ) {
                  nextDelay =
                    RATE_LIMIT_RETRY_MS;
                }
              } finally {
                scheduleReconciliation(
                  nextDelay,
                );
              }
            },
            delay,
          );
      };

    /*
     * Give Socket.IO a short opportunity to establish
     * the realtime stream before starting REST fallback.
     */
    scheduleReconciliation(
      INITIAL_SOCKET_GRACE_MS,
    );

    const socket = io(
      `${SOCKET_URL}/idea-generation`,
      {
        auth: (callback) => {
          callback({
            token: getAccessToken(),
          });
        },

        withCredentials: true,

        reconnection: true,

        reconnectionAttempts:
          Infinity,

        reconnectionDelay:
          350,

        reconnectionDelayMax:
          3_000,

        timeout:
          8_000,
      },
    );

    socketRef.current = socket;

    const markRealtimeEvent = () => {
      socketProvenRef.current = true;

      setConnectionState(
        'connected',
      );

      clearReconciliationTimer();

      /*
       * Once realtime is proven healthy, REST becomes
       * only an occasional consistency check.
       */
      scheduleReconciliation(
        SOCKET_RECONCILIATION_MS,
      );
    };

    socket.on(
      'connect',
      () => {
        setConnectionState(
          'joining',
        );

        socket.emit(
          'idea-generation.join',
          {
            runId,
          },
          (acknowledgement) => {
            if (!mountedRef.current) {
              return;
            }

            if (
              acknowledgement?.success
            ) {
              setConnectionState(
                'connected',
              );

              setError('');
              setErrorStatus(null);

              return;
            }

            /*
             * Socket connected but room join failed.
             * Keep the page alive using HTTP fallback.
             */
            setConnectionState(
              'fallback',
            );

            scheduleReconciliation(
              FALLBACK_RECONCILIATION_MS,
            );
          },
        );
      },
    );

    socket.on(
      'disconnect',
      () => {
        socketProvenRef.current =
          false;

        setConnectionState(
          'reconnecting',
        );

        scheduleReconciliation(
          250,
        );
      },
    );

    socket.on(
      'connect_error',
      () => {
        socketProvenRef.current =
          false;

        setConnectionState(
          'fallback',
        );

        scheduleReconciliation(
          250,
        );
      },
    );

    socket.on(
      'idea-generation.snapshot',
      (payload) => {
        if (
          payload?.runId !== runId
        ) {
          return;
        }

        markRealtimeEvent();

        setRun((current) =>
          mergeRunSnapshot(
            current,
            payload,
          ),
        );

        setError('');
        setErrorStatus(null);
      },
    );

    socket.on(
      'idea-generation.run.updated',
      (payload) => {
        if (
          payload?.runId !== runId
        ) {
          return;
        }

        markRealtimeEvent();

        setRun((current) =>
          mergeRunSnapshot(
            current,
            payload,
          ),
        );

        setError('');
        setErrorStatus(null);
      },
    );

    socket.on(
      'idea-generation.stage.updated',
      (payload) => {
        if (
          payload?.runId !== runId
        ) {
          return;
        }

        markRealtimeEvent();

        setRun((current) => {
          const stages =
            mergeStage(
              current?.stages ?? [],
              payload,
            );

          const payloadStatus =
            normalizeStatus(
              payload?.status,
            );

          const nextStatus =
            payloadStatus === 'RUNNING'
              ? resolveRunStatus(
                  current?.status,
                  'RUNNING',
                )
              : current?.status ??
                'RUNNING';

          return {
            ...(current ?? {
              id: runId,
              runId,
              status: 'QUEUED',
              progressPercent: 0,
              currentStageKey: null,
              startedAt: null,
              stages: [],
            }),

            status:
              nextStatus,

            startedAt:
              current?.startedAt ??
              (
                payloadStatus === 'RUNNING'
                  ? payload?.startedAt ?? null
                  : null
              ),

            progressPercent:
              Math.max(
                Number(
                  current?.progressPercent ?? 0,
                ),
                Number(
                  payload?.progressPercent ?? 0,
                ),
                resolveFurthestStageProgress(
                  stages,
                ),
              ),

            currentStageKey: [
              'RUNNING',
              'COMPLETED',
              'SUCCEEDED',
              'SKIPPED',
            ].includes(payloadStatus)
              ? resolveForwardStage(
                  current?.currentStageKey,
                  payload?.stageKey,
                )
              : current?.currentStageKey,

            stages,
          };
        });

        setError('');
        setErrorStatus(null);
      },
    );

    return () => {
      mountedRef.current = false;

      clearReconciliationTimer();

      if (socket.connected) {
        socket.emit(
          'idea-generation.leave',
          {
            runId,
          },
          () => undefined,
        );
      }

      socket.removeAllListeners();
      socket.disconnect();

      socketRef.current = null;
    };
  }, [
    initialRun,
    loadSnapshot,
    runId,
  ]);

  return {
    run,
    connectionState,
    error,
    errorStatus,

    refresh: () =>
      loadSnapshot(),
  };
}