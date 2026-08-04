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
    Crown,
    LoaderCircle,
    MessageSquarePlus,
    Send,
    Sparkles,
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
    listChatMessages,
    listChatSessions,
} from '../api/aiChatApi';

import '../styles/ai-chat.css';

/**
 * Adds a new chat message to the current message list or updates an existing
 * message when another version of the same message is received.
 *
 * This is required because AI messages may initially arrive with a pending
 * state and later be updated while streaming or after completion.
 *
 * @param {Array<object>} items Current chat messages.
 * @param {object} message Incoming or updated message.
 * @returns {Array<object>} Updated message collection.
 */
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

/**
 * Displays the Premium AI chat workspace for a selected idea.
 *
 * The component verifies Premium access, loads the selected idea and its
 * conversations, connects to the AI chat WebSocket, and streams assistant
 * responses into the active conversation.
 *
 * @returns {JSX.Element} Premium AI chat page.
 *
 * @author Eman
 */
export default function AiChatPage() {
    const { ideaId } = useParams();
    const navigate = useNavigate();

    const {
        isPremium,
        isLoading: accessLoading,
    } = useAccountAccess();

    /**
     * Keeps the current WebSocket connection without causing renders.
     */
    const socketRef = useRef(null);

    /**
     * References the bottom of the messages list for automatic scrolling.
     */
    const bottomRef = useRef(null);

    const [idea, setIdea] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [sessionId, setSessionId] = useState('');
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    /**
     * Returns the complete active session object based on the selected
     * session identifier.
     */
    const activeSession = useMemo(
        () => sessions.find((session) => session.id === sessionId),
        [sessions, sessionId],
    );

    /**
     * Opens a conversation and retrieves all of its stored messages.
     *
     * @param {string} nextSessionId Session identifier to open.
     * @returns {Promise<void>}
     */
    const openSession = useCallback(async (nextSessionId) => {
        if (!nextSessionId) return;

        setSessionId(nextSessionId);

        const result = await listChatMessages(nextSessionId);

        setMessages(result.items);
    }, []);

    /**
     * Loads the selected idea and its available AI chat sessions.
     *
     * A default conversation is automatically created when the idea does not
     * have any previous chat sessions.
     */
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

                let nextSessions = sessionResult.items;

                if (!nextSessions.length) {
                    const created = await createChatSession(
                        ideaId,
                        'Idea strategy chat',
                    );

                    nextSessions = [created];
                }

                setSessions(nextSessions);

                await openSession(nextSessions[0].id);
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

    /**
     * Creates and manages the real-time WebSocket connection for the active
     * conversation.
     *
     * The socket listens for message acceptance, streaming chunks, completed
     * responses, failed responses, cancelled responses, and connection errors.
     */
    useEffect(() => {
        if (!sessionId || !isPremium) {
            return undefined;
        }

        const socket = createAiChatSocket();

        socketRef.current = socket;

        /**
         * Inserts the accepted user message and placeholder AI message.
         *
         * @param {object} payload WebSocket event payload.
         * @param {object} payload.userMessage Saved user message.
         * @param {object} payload.aiMessage Pending AI message.
         */
        const handleAccepted = ({ userMessage, aiMessage }) => {
            setMessages((current) =>
                mergeMessage(
                    mergeMessage(current, userMessage),
                    aiMessage,
                ));

            setSending(true);
        };

        /**
         * Appends a streamed text chunk to the corresponding AI message.
         *
         * @param {object} payload WebSocket event payload.
         * @param {string} payload.messageId AI message identifier.
         * @param {string} payload.content Streamed text content.
         */
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

        /**
         * Handles completed, failed, or cancelled AI messages.
         *
         * @param {object} payload WebSocket event payload.
         * @param {object} payload.message Final message representation.
         */
        const handleTerminal = ({ message }) => {
            setMessages((current) => mergeMessage(current, message));
            setSending(false);
        };

        /**
         * Handles errors returned by the chat WebSocket.
         *
         * @param {object} payload Error payload.
         */
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

            socket.disconnect();
            socketRef.current = null;
        };
    }, [isPremium, sessionId]);

    /**
     * Automatically scrolls to the latest message whenever the conversation
     * content changes.
     */
    useEffect(() => {
        bottomRef.current?.scrollIntoView({
            behavior: 'smooth',
        });
    }, [messages]);

    /**
     * Creates and opens a new conversation for the current idea.
     *
     * @returns {Promise<void>}
     */
    const addSession = async () => {
        try {
            setError('');

            const created = await createChatSession(
                ideaId,
                `Idea chat ${sessions.length + 1}`,
            );

            setSessions((current) => [
                created,
                ...current,
            ]);

            await openSession(created.id);
        } catch (requestError) {
            setError(
                requestError.message ||
                'A new conversation could not be created.',
            );
        }
    };

    /**
     * Sends the user's message through the active WebSocket connection.
     *
     * Each request receives a unique client identifier to prevent duplicate
     * message processing.
     *
     * @param {React.FormEvent<HTMLFormElement> | React.KeyboardEvent} event
     * Form submission or keyboard event.
     */
    const sendMessage = (event) => {
        event.preventDefault();

        const message = draft.trim();

        if (
            !message ||
            !socketRef.current?.connected ||
            sending
        ) {
            return;
        }

        setError('');
        setDraft('');
        setSending(true);

        socketRef.current.emit(
            'chat:send-message',
            {
                sessionId,
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
    };

    /**
     * Shows the initial loading state while Premium access and chat data are
     * being resolved.
     */
    if (loading || accessLoading) {
        return (
            <section className="ai-chat-state">
                <LoaderCircle className="is-spinning" />

                <h1>
                    Opening your premium AI workspace
                </h1>
            </section>
        );
    }

    /**
     * Prevents Normal users from accessing the Premium-only AI chat feature.
     */
    if (!isPremium) {
        return (
            <section className="ai-chat-state ai-chat-state--locked">
                <Crown size={34} />

                <h1>
                    AI Chat is a Premium feature
                </h1>

                <p>
                    Activate Premium credits to discuss architecture,
                    features, feasibility, and implementation with an
                    assistant that knows this idea.
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
        >
            <aside className="ai-chat-sidebar">
                <button
                    className="ai-chat-back"
                    type="button"
                    onClick={() => navigate(`/normal/ideas/${ideaId}`)}
                >
                    <ArrowLeft size={17} />
                    Idea workspace
                </button>

                <div className="ai-chat-idea">
                    <span>
                        <Bot size={22} />
                    </span>

                    <div>
                        <small>
                            Premium AI Chat
                        </small>

                        <strong>
                            {idea?.title || 'Idea assistant'}
                        </strong>
                    </div>
                </div>

                <button
                    className="ai-chat-new"
                    type="button"
                    onClick={addSession}
                >
                    <MessageSquarePlus size={17} />
                    New conversation
                </button>

                <nav>
                    {sessions.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            className={
                                session.id === sessionId
                                    ? 'is-active'
                                    : ''
                            }
                            onClick={() => openSession(session.id)}
                        >
                            <strong>
                                {session.title}
                            </strong>

                            <small>
                                {session._count?.messages ?? 0} messages
                            </small>
                        </button>
                    ))}
                </nav>
            </aside>

            <section className="ai-chat-panel">
                <header>
                    <div>
                        <span>
                            <Sparkles size={16} />
                        </span>

                        <div>
                            <small>
                                Context-aware conversation
                            </small>

                            <h1>
                                {activeSession?.title || 'AI Chat'}
                            </h1>
                        </div>
                    </div>

                    <b>
                        Premium
                    </b>
                </header>

                <div className="ai-chat-messages">
                    {!messages.length ? (
                        <div className="ai-chat-empty">
                            <Bot size={30} />

                            <h2>
                                Ask anything about this idea
                            </h2>

                            <p>
                                Explore the technology stack, database,
                                architecture, MVP, market potential, budget,
                                or implementation plan.
                            </p>
                        </div>
                    ) : null}

                    {messages.map((message) => (
                        <article
                            key={message.id}
                            className={
                                `ai-chat-message ${message.sender === 'USER'
                                    ? 'is-user'
                                    : 'is-ai'
                                }`
                            }
                        >
                            <span>
                                {message.sender === 'USER'
                                    ? 'You'
                                    : <Bot size={16} />}
                            </span>

                            <div>
                                <p>
                                    {message.message || (
                                        message.status === 'PENDING'
                                            ? 'Thinking…'
                                            : ''
                                    )}
                                </p>

                                {message.status === 'FAILED' ? (
                                    <small>
                                        {message.errorMessage ||
                                            'Response failed.'}
                                    </small>
                                ) : null}
                            </div>
                        </article>
                    ))}

                    <div ref={bottomRef} />
                </div>

                {error ? (
                    <p className="ai-chat-error">
                        {error}
                    </p>
                ) : null}

                <form
                    className="ai-chat-composer"
                    onSubmit={sendMessage}
                >
                    <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Ask Voxidence AI about this idea…"
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
                        type="submit"
                        disabled={!draft.trim() || sending}
                        aria-label="Send message"
                    >
                        <Send size={18} />
                    </button>
                </form>
            </section>
        </motion.main>
    );
}