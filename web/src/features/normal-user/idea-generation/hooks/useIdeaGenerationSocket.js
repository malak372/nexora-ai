/**
 * Real-time generation-run subscription with HTTP fallback polling.
 *
 * Socket authentication reads the token from the existing auth storage
 * helper used by the login page.
 *
 * @author Malak
 */

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import { getAccessToken } from '../../../auth/shared/auth.storage';
import { getGenerationRun } from '../api/ideaGenerationApi';

const SOCKET_URL =
    process.env.REACT_APP_SOCKET_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
    process.env.REACT_APP_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

/**
 * Inserts or updates one generation stage while preserving sequence order.
 *
 * @param {Array} stages Existing stages.
 * @param {Object} nextStage Incoming stage event.
 * @returns {Array} Updated stages.
 */
function mergeStage(stages, nextStage) {
    const incomingKey = nextStage.stageKey ?? nextStage.key;
    const index = stages.findIndex(
        (stage) => (stage.stageKey ?? stage.key) === incomingKey,
    );

    if (index === -1) {
        return [...stages, nextStage].sort(
            (a, b) =>
                Number(a.sequence ?? 0) -
                Number(b.sequence ?? 0),
        );
    }

    const copy = [...stages];

    copy[index] = {
        ...copy[index],
        ...nextStage,
    };

    return copy;
}

/**
 * Subscribes to a generation run and refreshes it through HTTP when needed.
 *
 * @param {string} runId Generation-run identifier.
 * @returns {{
 *   run: Object|null,
 *   connectionState: string,
 *   error: string,
 *   refresh: Function
 * }}
 */
export function useIdeaGenerationSocket(runId) {
    const socketRef = useRef(null);
    const [run, setRun] = useState(null);
    const [connectionState, setConnectionState] =
        useState('connecting');
    const [error, setError] = useState('');
    const [errorStatus, setErrorStatus] = useState(null);

    useEffect(() => {
        if (!runId) {
            return undefined;
        }

        let active = true;
        let pollingId;

        const loadFallback = async () => {
            try {
                const data = await getGenerationRun(runId);

                if (active) {
                    setRun(data);
                    setError('');
                    setErrorStatus(null);
                }
            } catch (requestError) {
                if (active) {
                    setErrorStatus(requestError?.response?.status ?? null);
                    setError(
                        requestError?.response?.data?.message ||
                            requestError?.message ||
                            'Generation progress could not be refreshed.',
                    );
                }
            }
        };

        loadFallback();

        pollingId = window.setInterval(loadFallback, 7000);

        const socket = io(`${SOCKET_URL}/idea-generation`, {
            transports: ['websocket', 'polling'],
            auth: {
                token: getAccessToken(),
            },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            setConnectionState('connected');
            socket.emit('idea-generation.join', { runId });
        });

        socket.on('disconnect', () => {
            setConnectionState('reconnecting');
        });

        socket.on('connect_error', () => {
            setConnectionState('fallback');
        });

        socket.on('idea-generation.snapshot', (payload) => {
            if (payload.runId === runId) {
                setRun(payload);
            }
        });

        socket.on('idea-generation.run.updated', (payload) => {
            if (payload.runId !== runId) {
                return;
            }

            setRun((current) => ({
                ...(current ?? {}),
                ...payload,
                stages: current?.stages ?? payload.stages ?? [],
            }));
        });

        socket.on('idea-generation.stage.updated', (payload) => {
            if (payload.runId !== runId) {
                return;
            }

            setRun((current) => ({
                ...(current ?? {
                    runId,
                    stages: [],
                }),
                currentStageKey:
                    payload.status === 'RUNNING'
                        ? payload.stageKey
                        : current?.currentStageKey,
                stages: mergeStage(
                    current?.stages ?? [],
                    payload,
                ),
            }));
        });

        return () => {
            active = false;
            window.clearInterval(pollingId);

            socket.emit('idea-generation.leave', { runId });
            socket.disconnect();
            socketRef.current = null;
        };
    }, [runId]);

    return {
        run,
        connectionState,
        error,
        errorStatus,
        refresh: async () => {
            const data = await getGenerationRun(runId);

            setRun(data);

            return data;
        },
    };
}
