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
import { useNavigate, useParams } from 'react-router-dom';

import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { getIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
import {
    createAiChatSocket,
    createChatSession,
    deleteChatSession,
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
    const { ideaId } = useParams();
    const navigate = useNavigate();

    const {
        isPremium,
        isLoading: accessLoading,
    } = useAccountAccess();

    const socketRef = useRef(null);
    const messagesRef = useRef(null);
    const bottomRef = useRef(null);
    const shouldAutoScrollRef = useRef(true);
    const recognitionRef = useRef(null);
    const voiceBaseDraftRef = useRef('');
    const sessionRequestRef = useRef(0);
    const pendingMessageRef = useRef(null);
    const titleRefreshTimerRef = useRef(null);

    const [idea, setIdea] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [sessionId, setSessionId] = useState('');
    const [loadingSessionId, setLoadingSessionId] = useState('');
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [creatingSession, setCreatingSession] = useState(false);
    const [deletingSessionId, setDeletingSessionId] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState('');
    const [error, setError] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [voiceSupported, setVoiceSupported] = useState(true);
    const [voiceHint, setVoiceHint] = useState('');

    const activeSession = useMemo(
        () => sessions.find((session) => session.id === sessionId),
        [sessions, sessionId],
    );

    const openSession = useCallback(async (nextSessionId) => {
        if (!nextSessionId) return;

        const requestId = sessionRequestRef.current + 1;
        sessionRequestRef.current = requestId;

        setSessionId(nextSessionId);
        setLoadingSessionId(nextSessionId);
        setMessages([]);
        setConfirmDeleteId('');
        setError('');
        shouldAutoScrollRef.current = true;

        try {
            const result = await listChatMessages(nextSessionId);

            if (sessionRequestRef.current !== requestId) return;

            const loadedMessages = result.items || [];

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

            setError(
                requestError.message ||
                'Chat messages could not be loaded.',
            );
        } finally {
            if (sessionRequestRef.current === requestId) {
                setLoadingSessionId('');
            }
        }
    }, []);

    useEffect(() => {
        if (accessLoading || !isPremium) {
            if (!accessLoading) {
                setLoading(false);
            }

            return undefined;
        }

        let mounted = true;

        const loadAiChatWorkspace = async () => {
            try {
                const [ideaResult, sessionResult] = await Promise.all([
                    getIdeaWorkspace(ideaId),
                    listChatSessions(ideaId),
                ]);

                if (!mounted) return;

                setIdea(ideaResult);

                const nextSessions = sessionResult.items || [];

                setSessions(nextSessions);

                if (nextSessions.length) {
                    await openSession(nextSessions[0].id);
                } else {
                    setSessionId('');
                    setMessages([]);
                }
            } catch (requestError) {
                if (mounted) {
                    setError(
                        requestError.message ||
                        'The AI chat workspace could not be loaded.',
                    );
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        loadAiChatWorkspace();

        return () => {
            mounted = false;
        };
    }, [
        accessLoading,
        ideaId,
        isPremium,
        openSession,
    ]);

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

        const socket = createAiChatSocket();

        socketRef.current = socket;

        const handleAccepted = ({ userMessage, aiMessage }) => {
            setMessages((current) => {
                const next = mergeMessage(
                    mergeMessage(current, userMessage),
                    aiMessage,
                );

                syncActiveSessionCount(next);
                return next;
            });

            setSending(true);
        };

        const handleChunk = ({ messageId, content }) => {
            setMessages((current) =>
                current.map((message) =>
                    message.id === messageId
                        ? {
                            ...message,
                            message: `${message.message || ''}${content}`,
                            status: 'STREAMING',
                        }
                        : message));
        };

        const handleTerminal = ({ message }) => {
            setMessages((current) => {
                const next = mergeMessage(current, message);
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

        socket.on('connect', () => {
            socket.emit('chat:join-session', {
                sessionId,
            }, (ack) => {
                const pending = pendingMessageRef.current;

                if (
                    ack?.success &&
                    pending?.sessionId === sessionId
                ) {
                    pendingMessageRef.current = null;
                    socket.emit(
                        'chat:send-message',
                        {
                            sessionId,
                            clientRequestId: crypto.randomUUID(),
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
                }
            });
        });

        socket.on('chat:message-accepted', handleAccepted);
        socket.on('chat:message-chunk', handleChunk);
        socket.on('chat:message-completed', handleTerminal);
        socket.on('chat:message-failed', handleTerminal);
        socket.on('chat:message-cancelled', handleTerminal);
        socket.on('chat:error', handleError);

        return () => {
            socket.emit('chat:leave-session', {
                sessionId,
            });

            window.clearTimeout(titleRefreshTimerRef.current);
            socket.disconnect();
            socketRef.current = null;
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

    useEffect(() => {
        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        setVoiceSupported(Boolean(SpeechRecognition));

        return () => {
            try {
                recognitionRef.current?.abort();
            } catch {
            }
            recognitionRef.current = null;
        };
    }, []);

    const toggleVoiceInput = () => {
        if (sending) return;

        setError('');
        setVoiceHint('');

        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }

        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            setVoiceSupported(false);
            setVoiceHint('Voice typing is unavailable in this browser');
            setError('Voice typing is not supported here. Use Chrome or Edge.');
            return;
        }

        setVoiceSupported(true);

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        const pageLanguage = document.documentElement.lang?.trim().toLowerCase();
        recognition.lang = pageLanguage?.startsWith('ar')
            ? 'ar'
            : pageLanguage?.startsWith('en')
                ? 'en-US'
                : navigator.language || 'en-US';

        let committed = draft;
        voiceBaseDraftRef.current = draft;

        recognition.onstart = () => {
            setIsListening(true);
            setVoiceHint('Listening… speak naturally');
        };

        recognition.onresult = (event) => {
            let interim = '';

            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const transcript = event.results[index][0]?.transcript || '';

                if (event.results[index].isFinal) {
                    committed = `${committed} ${transcript}`.trim();
                } else {
                    interim += transcript;
                }
            }

            setDraft(`${committed} ${interim}`.trim());
        };

        recognition.onerror = (event) => {
            setIsListening(false);

            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                setVoiceHint('Microphone permission is required');
                setError('Please allow microphone access to use voice typing.');
                return;
            }

            if (event.error === 'no-speech') {
                setVoiceHint('No speech detected — tap the microphone to try again');
                return;
            }

            setVoiceHint('Voice typing stopped');
            setError('Voice typing stopped. Please try again.');
        };

        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };

        recognitionRef.current = recognition;

        try {
            recognition.start();
        } catch {
            recognitionRef.current = null;
            setIsListening(false);
            setError('The microphone could not start. Please try again.');
        }
    };

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

    const emitChatMessage = useCallback((targetSessionId, message) => {
        if (!socketRef.current?.connected || !targetSessionId || !message) {
            pendingMessageRef.current = {
                sessionId: targetSessionId,
                message,
            };
            return;
        }

        socketRef.current.emit(
            'chat:send-message',
            {
                sessionId: targetSessionId,
                clientRequestId: crypto.randomUUID(),
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
            await openSession(created.id);
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
            recognitionRef.current?.stop();
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
                    message,
                };
                setSessions((current) => [created, ...current]);
                await openSession(targetSessionId);
                return;
            }

            const currentSession = sessions.find(
                (session) => session.id === targetSessionId,
            );
            const isFirstMessage =
                (currentSession?._count?.messages ?? messages.length) === 0;

            if (isFirstMessage) {
                const title = buildConversationTitle(message);
                const updated = await updateChatSession(targetSessionId, {
                    title,
                });

                setSessions((current) => current.map((session) =>
                    session.id === targetSessionId
                        ? { ...session, ...updated, title }
                        : session));
            }

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

    if (loading || accessLoading) {
        return (
            <section className="ai-chat-state">
                <div className="ai-chat-state__orb">
                    <LoaderCircle className="is-spinning" />
                </div>

                <span>Premium intelligence workspace</span>
                <h1>Preparing your AI chat</h1>
                <p>Connecting the conversation to your idea context and evidence.</p>
            </section>
        );
    }

    if (!isPremium) {
        return (
            <section className="ai-chat-state ai-chat-state--locked">
                <div className="ai-chat-state__orb">
                    <Crown size={30} />
                </div>

                <span>Premium workspace</span>
                <h1>AI Chat is a Premium feature</h1>

                <p>
                    Activate Premium credits to discuss architecture,
                    features, feasibility, and implementation with an
                    assistant that understands this idea.
                </p>

                <button
                    type="button"
                    onClick={() => navigate('/normal/credits')}
                >
                    <Sparkles size={17} />
                    View Premium credits
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
                        onClick={() => navigate(`/normal/ideas/${ideaId}`)}
                    >
                        <ArrowLeft size={17} />
                        <span>Idea workspace</span>
                    </button>

                    <div className="ai-chat-premium-mark" title="Premium AI workspace">
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
                            <span>Connected idea</span>
                            <b><Sparkles size={11} /> Live context</b>
                        </div>
                    </div>

                    <div className="ai-chat-idea-card__title-wrap">
                        <small>Voxidence is exploring</small>
                        <h2 title={idea?.title || 'Idea assistant'}>
                            {idea?.title || 'Idea assistant'}
                        </h2>
                    </div>

                    <div className="ai-chat-idea-card__status">
                        <CheckCircle2 size={13} />
                        <span>Idea knowledge synced</span>
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
                    <span>{creatingSession ? 'Creating…' : 'New conversation'}</span>
                    <Sparkles size={14} />
                </button>

                <div className="ai-chat-history-heading">
                    <span>Conversation history</span>
                    <b>{sessions.length}</b>
                </div>

                <nav aria-label="AI chat conversations">
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
                                    <strong>{session.title}</strong>
                                    <small className={loadingSessionId === session.id ? 'is-loading' : ''}>
                                        {loadingSessionId === session.id ? (
                                            <><LoaderCircle className="is-spinning" size={12} /> Loading chat…</>
                                        ) : (
                                            <>
                                                {session._count?.messages ?? 0}{' '}
                                                {(session._count?.messages ?? 0) === 1 ? 'message' : 'messages'}
                                            </>
                                        )}
                                    </small>
                                </span>
                            </button>

                            <button
                                className="ai-chat-session__delete"
                                type="button"
                                onClick={() => setConfirmDeleteId(session.id)}
                                aria-label={`Delete ${session.title}`}
                                title="Delete conversation"
                            >
                                <Trash2 size={15} />
                            </button>

                            {confirmDeleteId === session.id ? (
                                <div className="ai-chat-session__confirm">
                                    <span>Delete this chat?</span>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId('')}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="is-danger"
                                        onClick={() => removeSession(session.id)}
                                        disabled={deletingSessionId === session.id}
                                    >
                                        {deletingSessionId === session.id ? 'Deleting…' : 'Delete'}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </nav>

                <div className="ai-chat-sidebar__footer">
                    <WandSparkles size={17} />
                    <p>
                        Voxidence keeps every conversation connected to this idea and its generated outputs.
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
                                Voxidence AI Chat
                            </span>

                            <h1>{activeSession?.title || 'Voxidence Chat'}</h1>
                        </div>
                    </div>

                    <div className="ai-chat-live-status">
                        <i />
                        Ready to explore
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

                            <span className="ai-chat-eyebrow">Turn evidence into decisions</span>
                            <h2>Where should we take this idea next?</h2>
                            <p>
                                Ask AI Chat to challenge assumptions, shape the
                                product, or translate the idea into an actionable plan.
                            </p>

                            <div className="ai-chat-starters">
                                {STARTER_PROMPTS.map((starter) => {
                                    const StarterIcon = starter.icon;

                                    return (
                                        <button
                                            key={starter.label}
                                            type="button"
                                            onClick={() => setDraft(starter.prompt)}
                                        >
                                            <span><StarterIcon size={17} /></span>
                                            {starter.label}
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

                        return (
                            <motion.article
                                key={message.id}
                                className={`ai-chat-message ${isUser ? 'is-user' : 'is-ai'}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                <span className="ai-chat-message__avatar">
                                    {isUser ? 'You' : <Bot size={17} />}
                                </span>

                                <div className="ai-chat-message__content">
                                    {!isUser ? (
                                        <small className="ai-chat-message__label">
                                            AI Chat
                                        </small>
                                    ) : null}

                                    {isThinking ? (
                                        <span className="ai-chat-thinking" aria-label="AI is thinking">
                                            <i />
                                            <i />
                                            <i />
                                        </span>
                                    ) : (
                                        <div
                                            className="ai-chat-message__body"
                                            dir="auto"
                                        >
                                            {cleanAssistantMessage(
                                                message.message,
                                                isUser || isIdentityQuestion(
                                                    [...messages]
                                                        .slice(0, messageIndex)
                                                        .reverse()
                                                        .find((item) => item.sender === 'USER')
                                                        ?.message || '',
                                                ),
                                            )
                                                ?.split('\n')
                                                .map((line, lineIndex) => {
                                                    const trimmed = line.trim();
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
                                                            <h3 key={lineIndex}>
                                                                {parts(headingMatch[1])}
                                                            </h3>
                                                        );
                                                    }

                                                    if (bulletMatch) {
                                                        return (
                                                            <div className="ai-chat-message__list-row" key={lineIndex}>
                                                                <i aria-hidden="true" />
                                                                <span>{parts(bulletMatch[1])}</span>
                                                            </div>
                                                        );
                                                    }

                                                    if (numberedMatch) {
                                                        return (
                                                            <div className="ai-chat-message__list-row is-numbered" key={lineIndex}>
                                                                <b>{numberedMatch[1]}</b>
                                                                <span>{parts(numberedMatch[2])}</span>
                                                            </div>
                                                        );
                                                    }

                                                    return <p key={lineIndex}>{parts(line)}</p>;
                                                })}
                                        </div>
                                    )}

                                    {message.status === 'FAILED' ? (
                                        <small className="ai-chat-message__failure">
                                            {message.errorMessage || 'Response failed.'}
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
                        {error}
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
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder="Ask Voxidence anything about this idea…"
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
                            disabled={!voiceSupported || sending}
                            aria-label={isListening ? 'Stop voice typing' : 'Start voice typing'}
                            aria-pressed={isListening}
                            title={
                                voiceSupported
                                    ? isListening
                                        ? 'Stop voice typing'
                                        : 'Speak and convert your voice to text'
                                    : 'Voice typing is not supported in this browser'
                            }
                        >
                            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                            {isListening ? <span className="ai-chat-voice__pulse" /> : null}
                        </button>

                        <button
                            className="ai-chat-send"
                            type="submit"
                            disabled={!draft.trim() || sending}
                            aria-label="Send message"
                        >
                            {sending ? (
                                <LoaderCircle className="is-spinning" size={18} />
                            ) : (
                                <Send size={18} />
                            )}
                        </button>
                    </form>

                    <div className="ai-chat-composer-note">
                        <span className={isListening ? 'is-listening' : ''}>
                            {isListening ? (
                                <>
                                    <i />
                                    {voiceHint || 'Listening… your speech appears as text'}
                                </>
                            ) : (
                                voiceSupported
                                    ? 'Tap the microphone to type with your voice'
                                    : 'Voice typing is unavailable in this browser'
                            )}
                        </span>
                        <span>Enter to send · Shift + Enter for a new line</span>
                    </div>
                </div>
            </section>
        </motion.main>
    );
}