/**
 * Premium AI chat page for discussing a specific generated idea.
 *
 * This page provides Premium users with:
 * - Idea-aware AI conversations.
 * - Multiple chat sessions for each idea.
 * - Real-time AI response streaming through WebSocket events.
 * - Previous conversation and message retrieval.
 * - Premium access validation.
 *
 * @author Eman
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
    ArrowLeft,
    Bot,
    BrainCircuit,
    CheckCircle2,
    Crown,
    Database,
    Layers3,
    Lightbulb,
    LoaderCircle,
    MessageSquarePlus,
    Mic,
    MicOff,
    Send,
    Sparkles,
    Trash2,
    WandSparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { useUserExperience } from '../../../../system/user-experience';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import useVoiceTyping from '../../shared/components/useVoiceTyping';
import { getIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
import { getDiscoveryById } from '../../discoveries/api/discoveriesApi';
import {
    createAiChatSocket,
    createChatSession,
    deleteChatSession,
    scheduleAiChatSocketDisconnect,
    invalidateChatMessages,
    invalidateChatSessions,
    listChatMessages,
    updateChatSession,
    listChatSessions,
} from '../api/aiChatApi';

import '../styles/ai-chat.css';

const STARTER_PROMPTS = [
    {
        icon: Layers3,
        label: 'Design the architecture',
        prompt: 'Design a clear system architecture for this idea and explain the role of each major component.',
    },
    {
        icon: Database,
        label: 'Plan the database',
        prompt: 'Propose a practical database design for this idea, including the main entities and relationships.',
    },
    {
        icon: Lightbulb,
        label: 'Refine the MVP',
        prompt: 'Help me define the strongest MVP for this idea and prioritize the features that should be built first.',
    },
];

const getTextDirection = (value = '') =>
    /[\u0600-\u06FF]/u.test(String(value)) ? 'rtl' : 'ltr';


const isIdentityQuestion = (value = '') => {
    const normalized = String(value).trim().toLowerCase();

    return /(?:what(?:'s| is) your name|who are you|your name|name of (?:the )?(?:ai|assistant)|شو اسمك|ما اسمك|ايش اسمك|إيش اسمك|مين انت|مين أنت|من انت|من أنت|شو بتسمي حالك|عرف عن حالك|عرّف عن حالك)/i.test(normalized);
};

const cleanAssistantMessage = (value = '', allowIdentity = false) => {
    if (!value) return value;

    let cleaned = String(value)
        .replace(
            /^(?:hello|hi|hey|welcome|مرحب(?:اً|ا)?|أهلاً|اهلاً|أهلًا|السلام عليكم)[!,.،\s-]*/i,
            '',
        )
        .trimStart();

    if (allowIdentity) {
        return cleaned;
    }

    const identityPatterns = [
        /(?:^|[.!?؟\n]\s*)(?:i(?:'m| am)|this is)\s+voxidence(?:\s+(?:ai|assistant|chat assistant))?[^.!?؟\n]*(?:[.!?؟]|$)/gi,
        /(?:^|[.!?؟\n]\s*)my name is\s+voxidence[^.!?؟\n]*(?:[.!?؟]|$)/gi,
        /(?:^|[.!?؟\n]\s*)voxidence\s+(?:here|is your\s+(?:ai\s+)?assistant)[^.!?؟\n]*(?:[.!?؟]|$)/gi,
        /(?:^|[.!?؟\n]\s*)(?:أنا|انا)\s+(?:فوكسيدنس|voxidence)[^.!?؟\n]*(?:[.!?؟]|$)/gi,
        /(?:^|[.!?؟\n]\s*)اسمي\s+(?:فوكسيدنس|voxidence)[^.!?؟\n]*(?:[.!?؟]|$)/gi,
        /(?:^|[.!?؟\n]\s*)(?:فوكسيدنس|voxidence)\s+(?:هنا|هو مساعدك|هي مساعدتك)[^.!?؟\n]*(?:[.!?؟]|$)/gi,
    ];

    identityPatterns.forEach((pattern) => {
        cleaned = cleaned.replace(pattern, ' ');
    });

    return cleaned
        .replace(/^[,،;:!?.؟\s-]+/, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
};

const mergeMessage = (items, message) => {
    if (!message?.id) return items;

    const index = items.findIndex((item) => item.id === message.id);

    if (index === -1) {
        return [...items, message];
    }

    const next = [...items];

    next[index] = {
        ...next[index],
        ...message,
    };

    return next;
};


export default function AiChatPage() {
    const { language: uiLanguage, t } = useUserExperience();
    const { ideaId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const chatOrigin = location.state?.chatOrigin || 'owned-idea';
    const acceptedPublicationId = location.state?.publicationId || '';
    const returnTo =
        location.state?.returnTo ||
        (chatOrigin === 'accepted-publication' && acceptedPublicationId
            ? workspacePath(`/normal/accepted/${acceptedPublicationId}/workspace`)
            : workspacePath(`/normal/ideas/${ideaId}`));
    const returnLabel =
        location.state?.returnLabel ||
        (chatOrigin === 'accepted-publication'
            ? 'Accepted idea'
            : 'Idea workspace');

    const routeIdeaSeed = location.state?.ideaSeed ?? null;

    const {
        isPremium,
        isLoading: accessLoading,
    } = useAccountAccess();

    const socketRef = useRef(null);
    const joinedSessionRef = useRef('');
    const messagesRef = useRef(null);
    const bottomRef = useRef(null);
    const shouldAutoScrollRef = useRef(true);
    const sessionRequestRef = useRef(0);
    const pendingMessageRef = useRef(null);
    const titleRefreshTimerRef = useRef(null);
    const sessionMessagesCacheRef = useRef(new Map());
    const sessionIdRef = useRef('');

    const [idea, setIdea] = useState(() =>
        routeIdeaSeed || {
            id: ideaId,
            title: location.state?.ideaTitle || 'Idea workspace',
        });
    const [sessions, setSessions] = useState([]);
    const [sessionId, setSessionId] = useState('');
    const [loadingSessionId, setLoadingSessionId] = useState('');
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [creatingSession, setCreatingSession] = useState(false);
    const [deletingSessionId, setDeletingSessionId] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState('');
    const [error, setError] = useState('');

    const activeSession = useMemo(
        () => sessions.find((session) => session.id === sessionId),
        [sessions, sessionId],
    );

    const openSession = useCallback(async (nextSessionId) => {
        if (!nextSessionId) return;

        const requestId = sessionRequestRef.current + 1;
        sessionRequestRef.current = requestId;

        const cachedMessages =
            sessionMessagesCacheRef.current.get(nextSessionId) || null;

        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setLoadingSessionId(cachedMessages ? '' : nextSessionId);
        setMessages(cachedMessages || []);
        setConfirmDeleteId('');
        setError('');
        shouldAutoScrollRef.current = true;

        try {
            const result = await listChatMessages(nextSessionId);

            if (sessionRequestRef.current !== requestId) return;

            const loadedMessages = result.items || [];

            sessionMessagesCacheRef.current.set(
                nextSessionId,
                loadedMessages,
            );
            setMessages(loadedMessages);
            setSessions((current) => current.map((session) =>
                session.id === nextSessionId
                    ? {
                        ...session,
                        _count: {
                            ...(session._count || {}),
                            messages: loadedMessages.length,
                        },
                    }
                    : session));
        } catch (requestError) {
            if (sessionRequestRef.current !== requestId) return;

            if (!cachedMessages) {
                setError(
                    requestError.message ||
                    'Chat messages could not be loaded.',
                );
            }
        } finally {
            if (sessionRequestRef.current === requestId) {
                setLoadingSessionId('');
            }
        }
    }, []);

    useEffect(() => {
        if (!isPremium) {
            return undefined;
        }

        let mounted = true;

        const loadIdeaContext = async () => {
            if (routeIdeaSeed) {
                setIdea(routeIdeaSeed);
                return;
            }

            try {
                const ideaResult =
                    chatOrigin === 'accepted-publication' && acceptedPublicationId
                        ? await getDiscoveryById(acceptedPublicationId).then((payload) => {
                            const publication = payload?.publication ?? payload;

                            return {
                                id: ideaId,
                                title:
                                    publication?.publicTitle ||
                                    location.state?.ideaTitle ||
                                    'Accepted idea',
                                domain:
                                    publication?.domain ||
                                    (publication?.domainName
                                        ? { name: publication.domainName }
                                        : null),
                                acceptedPublicationId,
                            };
                        })
                        : await getIdeaWorkspace(ideaId);

                if (mounted && ideaResult) {
                    setIdea(ideaResult);
                }
            } catch {
                // Idea metadata is an enhancement; sessions can still open.
            }
        };

        const loadSessions = async () => {
            try {
                const sessionResult = await listChatSessions(ideaId);

                if (!mounted) return;

                const nextSessions = sessionResult.items || [];
                setSessions(nextSessions);

                if (!sessionIdRef.current && nextSessions.length) {
                    void openSession(nextSessions[0].id);
                }
            } catch (requestError) {
                if (mounted) {
                    setError(
                        requestError.message ||
                        'AI chat sessions could not be loaded.',
                    );
                }
            }
        };

        void loadIdeaContext();
        void loadSessions();

        return () => {
            mounted = false;
        };
    }, [
        acceptedPublicationId,
        chatOrigin,
        ideaId,
        isPremium,
        location.state?.ideaTitle,
        openSession,
        routeIdeaSeed,
    ]);


    useEffect(() => {
        if (accessLoading) {
            return;
        }

        if (!isPremium) {
            scheduleAiChatSocketDisconnect();
            socketRef.current = null;
            joinedSessionRef.current = '';
            return;
        }

        if (!socketRef.current) {
            /*
             * Connect to the AI Chat namespace as soon as the page is usable.
             * The socket can then join a newly created conversation instantly
             * instead of paying the WebSocket handshake cost after Send.
             */
            socketRef.current = createAiChatSocket();
        }
    }, [accessLoading, isPremium]);

    useEffect(() => () => {
        scheduleAiChatSocketDisconnect();
        socketRef.current = null;
        joinedSessionRef.current = '';
    }, []);

    const syncActiveSessionCount = useCallback((nextMessages) => {
        setSessions((current) => current.map((session) =>
            session.id === sessionId
                ? {
                    ...session,
                    lastMessageAt: new Date().toISOString(),
                    _count: {
                        ...(session._count || {}),
                        messages: nextMessages.length,
                    },
                }
                : session));
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId || !isPremium) {
            return undefined;
        }

        const socket = socketRef.current || createAiChatSocket();
        socketRef.current = socket;

        const handleAccepted = ({ userMessage, aiMessage }) => {
            invalidateChatMessages(sessionId);
            invalidateChatSessions(ideaId);

            setMessages((current) => {
                const stableMessages = current.filter(
                    (message) => !message.__optimistic,
                );
                const next = mergeMessage(
                    mergeMessage(stableMessages, userMessage),
                    aiMessage,
                );

                sessionMessagesCacheRef.current.set(sessionId, next);
                syncActiveSessionCount(next);
                return next;
            });

            setSending(true);
        };

        const handleStreamStarted = ({ message }) => {
            if (!message?.id) return;

            setMessages((current) =>
                current.map((item) =>
                    item.id === message.id
                        ? {
                            ...item,
                            ...message,
                            message: '',
                            status: 'STREAMING',
                        }
                        : item));
        };

        const handleChunk = ({ messageId, content }) => {
            setMessages((current) =>
                current.map((message) => {
                    if (message.id !== messageId) {
                        return message;
                    }

                    const existingText =
                        message.status === 'PENDING' ||
                            message.message === 'Generating response…'
                            ? ''
                            : message.message || '';

                    return {
                        ...message,
                        message: `${existingText}${content}`,
                        status: 'STREAMING',
                    };
                }));
        };

        const handleTerminal = ({ message }) => {
            invalidateChatMessages(sessionId);
            invalidateChatSessions(ideaId);

            setMessages((current) => {
                const next = mergeMessage(current, message);
                sessionMessagesCacheRef.current.set(sessionId, next);
                syncActiveSessionCount(next);
                return next;
            });
            setSending(false);

            if (message?.status === 'COMPLETED') {
                window.clearTimeout(titleRefreshTimerRef.current);
                titleRefreshTimerRef.current = window.setTimeout(async () => {
                    try {
                        const result = await listChatSessions(ideaId);
                        setSessions(result.items || []);
                    } catch {
                        // Title refresh is optional and must not interrupt chat.
                    }
                }, 1800);
            }
        };

        const handleError = (payload) => {
            setError(
                payload?.message ||
                'AI chat connection failed.',
            );

            setSending(false);
        };

        const sendPendingMessage = () => {
            const pending = pendingMessageRef.current;

            if (pending?.sessionId !== sessionId) {
                return;
            }

            pendingMessageRef.current = null;

            socket.emit(
                'chat:send-message',
                {
                    sessionId,
                    clientRequestId:
                        pending.clientRequestId ||
                        crypto.randomUUID(),
                    message: pending.message,
                },
                (sendAck) => {
                    if (!sendAck?.success) {
                        setError(
                            sendAck?.error?.message ||
                            'Your message could not be sent.',
                        );
                        setSending(false);
                    }
                },
            );
        };

        const joinCurrentSession = () => {
            joinedSessionRef.current = '';

            socket.emit(
                'chat:join-session',
                {
                    sessionId,
                },
                (ack) => {
                    if (!ack?.success) {
                        setError(
                            ack?.error?.message ||
                            'The conversation could not be opened.',
                        );
                        setSending(false);
                        return;
                    }

                    joinedSessionRef.current = sessionId;
                    sendPendingMessage();
                },
            );
        };

        const handleDisconnect = () => {
            joinedSessionRef.current = '';
        };

        socket.on('connect', joinCurrentSession);
        socket.on('disconnect', handleDisconnect);
        socket.on('chat:message-accepted', handleAccepted);
        socket.on('chat:message-stream-started', handleStreamStarted);
        socket.on('chat:message-chunk', handleChunk);
        socket.on('chat:message-completed', handleTerminal);
        socket.on('chat:message-failed', handleTerminal);
        socket.on('chat:message-cancelled', handleTerminal);
        socket.on('chat:error', handleError);

        if (socket.connected) {
            joinCurrentSession();
        }

        return () => {
            if (socket.connected) {
                socket.emit('chat:leave-session', {
                    sessionId,
                });
            }

            window.clearTimeout(titleRefreshTimerRef.current);
            socket.off('connect', joinCurrentSession);
            socket.off('disconnect', handleDisconnect);
            socket.off('chat:message-accepted', handleAccepted);
            socket.off('chat:message-stream-started', handleStreamStarted);
            socket.off('chat:message-chunk', handleChunk);
            socket.off('chat:message-completed', handleTerminal);
            socket.off('chat:message-failed', handleTerminal);
            socket.off('chat:message-cancelled', handleTerminal);
            socket.off('chat:error', handleError);

            if (joinedSessionRef.current === sessionId) {
                joinedSessionRef.current = '';
            }
        };
    }, [ideaId, isPremium, sessionId, syncActiveSessionCount]);

    const scrollMessagesToBottom = useCallback((behavior = 'smooth') => {
        bottomRef.current?.scrollIntoView({
            behavior,
            block: 'end',
        });
    }, []);

    const handleMessagesScroll = useCallback((event) => {
        const element = event.currentTarget;
        const distanceFromBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight;

        shouldAutoScrollRef.current = distanceFromBottom < 90;
    }, []);

    useEffect(() => {
        if (shouldAutoScrollRef.current) {
            scrollMessagesToBottom(messages.length > 1 ? 'smooth' : 'auto');
        }
    }, [messages, scrollMessagesToBottom]);

    const {
        isListening,
        isSupported: voiceSupported,
        error: voiceError,
        toggle: toggleVoiceInput,
        stop: stopVoiceInput,
    } = useVoiceTyping({
        value: draft,
        onChange: setDraft,
        preferredLanguage: uiLanguage === 'ar' ? 'AR' : 'EN',
        maxLength: 4000,
        disabled: sending,
    });

    const buildConversationTitle = (message = '') => {
        const normalized = String(message)
            .replace(/\s+/g, ' ')
            .replace(/[?!.,،؛:]+$/g, '')
            .trim();

        if (!normalized) return 'New conversation';

        const words = normalized.split(' ').slice(0, 8);
        const title = words.join(' ');

        return title.length > 64
            ? `${title.slice(0, 61).trimEnd()}…`
            : title;
    };

    const appendOptimisticTurn = useCallback((targetSessionId, message) => {
        const now = new Date().toISOString();

        setMessages((current) => [
            ...current.filter((item) => !item.__optimistic),
            {
                id: `optimistic-user-${crypto.randomUUID()}`,
                sessionId: targetSessionId,
                sender: 'USER',
                status: 'COMPLETED',
                message,
                createdAt: now,
                updatedAt: now,
                completedAt: now,
                __optimistic: true,
            },
            {
                id: `optimistic-ai-${crypto.randomUUID()}`,
                sessionId: targetSessionId,
                sender: 'AI',
                status: 'PENDING',
                message: '',
                createdAt: now,
                updatedAt: now,
                completedAt: null,
                __optimistic: true,
            },
        ]);
    }, []);

    const emitChatMessage = useCallback((targetSessionId, message) => {
        if (!targetSessionId || !message) {
            return;
        }

        const clientRequestId = crypto.randomUUID();
        const socket = socketRef.current;
        const canSendNow =
            socket?.connected &&
            joinedSessionRef.current === targetSessionId;

        if (!canSendNow) {
            pendingMessageRef.current = {
                sessionId: targetSessionId,
                clientRequestId,
                message,
            };
            return;
        }

        socket.emit(
            'chat:send-message',
            {
                sessionId: targetSessionId,
                clientRequestId,
                message,
            },
            (ack) => {
                if (!ack?.success) {
                    setError(
                        ack?.error?.message ||
                        'Your message could not be sent.',
                    );
                    setSending(false);
                }
            },
        );
    }, []);

    const activateEmptySession = useCallback((createdSession) => {
        if (!createdSession?.id) {
            throw new Error('The new conversation did not return a valid identifier.');
        }

        sessionRequestRef.current += 1;
        sessionMessagesCacheRef.current.set(createdSession.id, []);
        sessionIdRef.current = createdSession.id;
        setSessionId(createdSession.id);
        setLoadingSessionId('');
        setMessages([]);
        setConfirmDeleteId('');
        setError('');
        shouldAutoScrollRef.current = true;
    }, []);

    const addSession = async () => {
        if (creatingSession) return;

        try {
            setError('');
            setCreatingSession(true);

            const created = await createChatSession(
                ideaId,
                'New conversation',
            );

            setSessions((current) => [created, ...current]);
            activateEmptySession(created);
        } catch (requestError) {
            setError(
                requestError.message ||
                'A new conversation could not be created.',
            );
        } finally {
            setCreatingSession(false);
        }
    };

    const removeSession = async (targetSessionId) => {
        if (!targetSessionId || deletingSessionId) return;

        try {
            setError('');
            setDeletingSessionId(targetSessionId);

            await deleteChatSession(targetSessionId);

            const remainingSessions = sessions.filter(
                (session) => session.id !== targetSessionId,
            );

            setSessions(remainingSessions);
            setConfirmDeleteId('');

            if (targetSessionId === sessionId) {
                if (remainingSessions.length) {
                    await openSession(remainingSessions[0].id);
                } else {
                    sessionIdRef.current = '';
                    setSessionId('');
                    setMessages([]);
                }
            }
        } catch (requestError) {
            setError(
                requestError.message ||
                'The conversation could not be deleted.',
            );
        } finally {
            setDeletingSessionId('');
        }
    };

    const sendMessage = async (event) => {
        event.preventDefault();

        const message = draft.trim();

        if (!message || sending || creatingSession) {
            return;
        }

        setError('');

        if (isListening) {
            stopVoiceInput();
        }

        setDraft('');
        setSending(true);
        shouldAutoScrollRef.current = true;

        try {
            let targetSessionId = sessionId;

            if (!targetSessionId) {
                setCreatingSession(true);

                const created = await createChatSession(
                    ideaId,
                    buildConversationTitle(message),
                );

                targetSessionId = created.id;
                pendingMessageRef.current = {
                    sessionId: targetSessionId,
                    clientRequestId: crypto.randomUUID(),
                    message,
                };
                setSessions((current) => [created, ...current]);
                activateEmptySession(created);
                appendOptimisticTurn(targetSessionId, message);
                return;
            }

            const currentSession = sessions.find(
                (session) => session.id === targetSessionId,
            );
            const isFirstMessage =
                (currentSession?._count?.messages ?? messages.length) === 0;

            if (isFirstMessage) {
                const title = buildConversationTitle(message);

                setSessions((current) => current.map((session) =>
                    session.id === targetSessionId
                        ? { ...session, title }
                        : session));

                void updateChatSession(targetSessionId, {
                    title,
                })
                    .then((updated) => {
                        setSessions((current) => current.map((session) =>
                            session.id === targetSessionId
                                ? { ...session, ...updated, title }
                                : session));
                    })
                    .catch(() => {
                        /*
                         * Title persistence is cosmetic and must never delay
                         * or fail the actual AI message submission.
                         */
                    });
            }

            appendOptimisticTurn(targetSessionId, message);
            emitChatMessage(targetSessionId, message);
        } catch (requestError) {
            setDraft(message);
            setSending(false);
            setError(
                requestError.message ||
                'Your message could not be sent.',
            );
        } finally {
            setCreatingSession(false);
        }
    };

    if (!accessLoading && !isPremium) {
        return (
            <section className="ai-chat-state ai-chat-state--locked">
                <div className="ai-chat-state__orb">
                    <Crown size={30} />
                </div>

                <span>{t('Premium workspace')}</span>
                <h1>{t('AI Chat is a Premium feature')}</h1>

                <p>
                    {t('Activate Premium credits to discuss architecture, features, feasibility, and implementation with an assistant that understands this idea.')}
                </p>

                <button
                    type="button"
                    onClick={() => navigate(workspacePath('/normal/upgrade'))}
                >
                    <Sparkles size={17} />
                    {t('View Premium credits')}
                </button>
            </section>
        );
    }

    return (
        <motion.main
            className="ai-chat-page"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
        >
            <div className="ai-chat-ambient ai-chat-ambient--one" />
            <div className="ai-chat-ambient ai-chat-ambient--two" />

            <aside className="ai-chat-sidebar">
                <div className="ai-chat-sidebar__top">
                    <button
                        className="ai-chat-back"
                        type="button"
                        onClick={() =>
                            navigate(returnTo, {
                                state:
                                    chatOrigin === 'accepted-publication'
                                        ? { forceRefresh: true }
                                        : undefined,
                            })
                        }
                    >
                        <ArrowLeft size={17} />
                        <span>{t(returnLabel)}</span>
                    </button>

                    <div className="ai-chat-premium-mark" title={t('Premium AI workspace')}>
                        <Crown size={15} />
                    </div>
                </div>

                <div className="ai-chat-idea-card">
                    <div className="ai-chat-idea-card__glow" aria-hidden="true" />

                    <div className="ai-chat-idea-card__top">
                        <div className="ai-chat-idea-card__icon">
                            <BrainCircuit size={23} />
                            <i />
                        </div>

                        <div className="ai-chat-idea-card__heading">
                            <span>{t('Connected idea')}</span>
                            <b><Sparkles size={11} /> {t('Live context')}</b>
                        </div>
                    </div>

                    <div className="ai-chat-idea-card__title-wrap">
                        <small>{t('Voxidence is exploring')}</small>
                        <h2 title={idea?.title || t('Idea assistant')}>
                            {idea?.title || t('Idea assistant')}
                        </h2>
                    </div>

                    <div className="ai-chat-idea-card__status">
                        <CheckCircle2 size={13} />
                        <span>{t('Idea knowledge synced')}</span>
                    </div>
                </div>

                <button
                    className="ai-chat-new"
                    type="button"
                    onClick={addSession}
                    disabled={creatingSession}
                >
                    {creatingSession ? (
                        <LoaderCircle className="is-spinning" size={18} />
                    ) : (
                        <MessageSquarePlus size={18} />
                    )}
                    <span>{t(creatingSession ? 'Creating…' : 'New conversation')}</span>
                    <Sparkles size={14} />
                </button>

                <div className="ai-chat-history-heading">
                    <span>{t('Conversation history')}</span>
                    <b>{sessions.length}</b>
                </div>

                <nav aria-label={t('AI chat conversations')}>
                    {sessions.map((session, index) => (
                        <div
                            key={session.id}
                            className={`ai-chat-session ${session.id === sessionId ? 'is-active' : ''
                                }`}
                        >
                            <button
                                className="ai-chat-session__open"
                                type="button"
                                onClick={() => openSession(session.id)}
                                aria-current={session.id === sessionId ? 'page' : undefined}
                            >
                                <span className="ai-chat-session-index">
                                    {String(index + 1).padStart(2, '0')}
                                </span>

                                <span className="ai-chat-session-copy">
                                    <strong data-idea-content="true" dir="auto">{session.title === 'New conversation' ? t('New conversation') : session.title}</strong>
                                    <small className={loadingSessionId === session.id ? 'is-loading' : ''}>
                                        {loadingSessionId === session.id ? (
                                            <><LoaderCircle className="is-spinning" size={12} /> {t('Loading chat…')}</>
                                        ) : (
                                            <>
                                                {session._count?.messages ?? 0}{' '}
                                                {t((session._count?.messages ?? 0) === 1 ? 'message' : 'messages')}
                                            </>
                                        )}
                                    </small>
                                </span>
                            </button>

                            <button
                                className="ai-chat-session__delete"
                                type="button"
                                onClick={() => setConfirmDeleteId(session.id)}
                                aria-label={t('Delete conversation')}
                                title={t('Delete conversation')}
                            >
                                <Trash2 size={15} />
                            </button>

                            {confirmDeleteId === session.id ? (
                                <div className="ai-chat-session__confirm">
                                    <span>{t('Delete this chat?')}</span>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId('')}
                                    >
                                        {t('Cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        className="is-danger"
                                        onClick={() => removeSession(session.id)}
                                        disabled={deletingSessionId === session.id}
                                    >
                                        {t(deletingSessionId === session.id ? 'Deleting…' : 'Delete')}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </nav>

                <div className="ai-chat-sidebar__footer">
                    <WandSparkles size={17} />
                    <p>
                        {t('Voxidence keeps every conversation connected to this idea and its generated outputs.')}
                    </p>
                </div>
            </aside>

            <section className="ai-chat-panel">
                <header className="ai-chat-header">
                    <div className="ai-chat-header__identity">
                        <span className="ai-chat-header__icon">
                            <Bot size={19} />
                            <i />
                        </span>

                        <div>
                            <span className="ai-chat-eyebrow">
                                {t('Voxidence AI Chat')}
                            </span>

                            <h1>{activeSession?.title === 'New conversation' ? t('New conversation') : (activeSession?.title || t('Voxidence Chat'))}</h1>
                        </div>
                    </div>

                    <div className="ai-chat-live-status">
                        <i />
                        {t('Ready to explore')}
                    </div>
                </header>

                <div
                    ref={messagesRef}
                    className="ai-chat-messages"
                    onScroll={handleMessagesScroll}
                >
                    {!messages.length ? (
                        <motion.div
                            className="ai-chat-empty"
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <div className="ai-chat-empty__visual">
                                <span className="ai-chat-empty__ring ai-chat-empty__ring--one" />
                                <span className="ai-chat-empty__ring ai-chat-empty__ring--two" />
                                <div>
                                    <BrainCircuit size={34} />
                                </div>
                            </div>

                            <span className="ai-chat-eyebrow">{t('Turn evidence into decisions')}</span>
                            <h2>{t('Where should we take this idea next?')}</h2>
                            <p>
                                {t('Ask AI Chat to challenge assumptions, shape the product, or translate the idea into an actionable plan.')}
                            </p>

                            <div className="ai-chat-starters">
                                {STARTER_PROMPTS.map((starter) => {
                                    const StarterIcon = starter.icon;

                                    return (
                                        <button
                                            key={starter.label}
                                            type="button"
                                            onClick={() => setDraft(t(starter.prompt))}
                                        >
                                            <span><StarterIcon size={17} /></span>
                                            {t(starter.label)}
                                        </button>
                                    );
                                })}
                            </div>
                        </motion.div>
                    ) : null}

                    {messages.map((message, messageIndex) => {
                        const isUser = message.sender === 'USER';
                        const isThinking =
                            !message.message &&
                            ['PENDING', 'STREAMING'].includes(message.status);
                        const previousUserMessage = [...messages]
                            .slice(0, messageIndex)
                            .reverse()
                            .find((item) => item.sender === 'USER')
                            ?.message || '';
                        const cleanedMessage = isThinking
                            ? ''
                            : cleanAssistantMessage(
                                message.message,
                                isUser || isIdentityQuestion(previousUserMessage),
                            );

                        return (
                            <motion.article
                                key={message.id}
                                className={`ai-chat-message ${isUser ? 'is-user' : 'is-ai'}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <span className="ai-chat-message__avatar">
                                    {isUser ? t('You') : <Bot size={17} />}
                                </span>

                                <div className="ai-chat-message__content">
                                    {!isUser ? (
                                        <small className="ai-chat-message__label">
                                            {t('AI Chat')}
                                        </small>
                                    ) : null}

                                    {isThinking ? (
                                        <span className="ai-chat-thinking" aria-label={t('AI is thinking')}>
                                            <i />
                                            <i />
                                            <i />
                                        </span>
                                    ) : (
                                        <div
                                            className="ai-chat-message__body"
                                            data-idea-content="true"
                                            dir={getTextDirection(cleanedMessage)}
                                        >
                                            {cleanedMessage
                                                ?.split('\n')
                                                .map((line, lineIndex) => {
                                                    const trimmed = line.trim();
                                                    const lineDirection = getTextDirection(
                                                        trimmed || cleanedMessage,
                                                    );
                                                    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)/);
                                                    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
                                                    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
                                                    const parts = (value) => value
                                                        .split(/(\*\*[^*]+\*\*)/g)
                                                        .filter(Boolean)
                                                        .map((part, partIndex) =>
                                                            part.startsWith('**') && part.endsWith('**')
                                                                ? (
                                                                    <strong key={`${lineIndex}-${partIndex}`}>
                                                                        {part.slice(2, -2)}
                                                                    </strong>
                                                                )
                                                                : part);

                                                    if (!trimmed) {
                                                        return <span className="ai-chat-message__space" key={lineIndex} />;
                                                    }

                                                    if (headingMatch) {
                                                        return (
                                                            <h3 key={lineIndex} dir={lineDirection}>
                                                                {parts(headingMatch[1])}
                                                            </h3>
                                                        );
                                                    }

                                                    if (bulletMatch) {
                                                        return (
                                                            <div
                                                                className="ai-chat-message__list-row"
                                                                key={lineIndex}
                                                                dir={lineDirection}
                                                            >
                                                                <i aria-hidden="true" />
                                                                <span>{parts(bulletMatch[1])}</span>
                                                            </div>
                                                        );
                                                    }

                                                    if (numberedMatch) {
                                                        return (
                                                            <div
                                                                className="ai-chat-message__list-row is-numbered"
                                                                key={lineIndex}
                                                                dir={lineDirection}
                                                            >
                                                                <b>{numberedMatch[1]}</b>
                                                                <span>{parts(numberedMatch[2])}</span>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <p key={lineIndex} dir={lineDirection}>
                                                            {parts(line)}
                                                        </p>
                                                    );
                                                })}
                                        </div>
                                    )}

                                    {message.status === 'FAILED' ? (
                                        <small className="ai-chat-message__failure">
                                            {message.errorMessage ? t(message.errorMessage) : t('Response failed.')}
                                        </small>
                                    ) : null}
                                </div>
                            </motion.article>
                        );
                    })}

                    <div ref={bottomRef} />
                </div>

                {error ? (
                    <p className="ai-chat-error" role="alert">
                        {t(error)}
                    </p>
                ) : null}

                <div className="ai-chat-composer-shell">
                    <form
                        className="ai-chat-composer"
                        onSubmit={sendMessage}
                    >
                        <div className="ai-chat-composer__spark">
                            <Sparkles size={17} />
                        </div>

                        <textarea
                            dir={draft.trim()
                                ? getTextDirection(draft)
                                : (uiLanguage === 'ar' ? 'rtl' : 'ltr')}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder={t('Ask Voxidence anything about this idea…')}
                            maxLength={4000}
                            rows={1}
                            onKeyDown={(event) => {
                                if (
                                    event.key === 'Enter' &&
                                    !event.shiftKey
                                ) {
                                    sendMessage(event);
                                }
                            }}
                        />

                        <button
                            className={`ai-chat-voice ${isListening ? 'is-listening' : ''}`}
                            type="button"
                            onClick={toggleVoiceInput}
                            disabled={sending}
                            aria-label={t(isListening ? 'Stop voice typing' : 'Start voice typing')}
                            aria-pressed={isListening}
                            title={
                                voiceSupported
                                    ? isListening
                                        ? t('Stop voice typing')
                                        : t('Speak and convert your voice to text')
                                    : t('Voice typing is unavailable in this browser')
                            }
                        >
                            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                            {isListening ? <span className="ai-chat-voice__pulse" /> : null}
                        </button>

                        <button
                            className="ai-chat-send"
                            type="submit"
                            disabled={!draft.trim() || sending}
                            aria-label={t('Send message')}
                        >
                            {sending ? (
                                <LoaderCircle className="is-spinning" size={18} />
                            ) : (
                                <Send size={18} />
                            )}
                        </button>
                    </form>

                    <div className="ai-chat-composer-note">
                        {voiceError ? <span>{t(voiceError)}</span> : <span />}
                        <span>{t('Enter to send · Shift + Enter for a new line')}</span>
                    </div>
                </div>
            </section>
        </motion.main>
    );
}