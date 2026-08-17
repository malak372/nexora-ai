import {
    ArrowLeft,
    Check,
    LoaderCircle,
    MessageCircleMore,
    Plus,
    RefreshCw,
    Search,
    Send,
    UsersRound,
    X,
} from 'lucide-react';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import { getStoredUser } from '../../../auth/shared/auth.storage';
import { resolveMediaUrl } from '../../../../utils/mediaUrl';
import { getApiErrorMessage } from '../../shared/api/adminApi';
import AdminSensitiveAccessGate from '../../shared/components/AdminSensitiveAccessGate';
import '../../shared/styles/admin-pages.css';
import {
    adminTeamChatApi,
    getAdminTeamChatSocket,
} from '../api/adminTeamChatApi';
import '../styles/admin-team-chat.css';

const TEAM_CHAT_SCOPE = 'TEAM_CHAT';

/**
 * Formats a conversation timestamp for display in the
 * administrator conversation list.
 *
 * Messages from the current day are displayed using time,
 * while older conversations are displayed using month and day.
 *
 * @param {string|Date|null|undefined} value The timestamp to format.
 * @returns {string} The formatted conversation timestamp.
 *
 * @author Eman
 */
function formatConversationTime(value) {
    if (!value) return '';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Formats a message timestamp using the user's local time.
 *
 * @param {string|Date|null|undefined} value The message timestamp.
 * @returns {string} The formatted message time.
 *
 * @author Eman
 */
function formatMessageTime(value) {
    if (!value) return '';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Generates initials from an administrator name.
 *
 * Up to the first two words are used to generate
 * the avatar fallback initials.
 *
 * @param {string} name The administrator name.
 * @returns {string} Uppercase initials.
 *
 * @author Eman
 */
function initials(name = 'Admin') {
    return (
        String(name)
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toUpperCase() || 'A'
    );
}

/**
 * Displays an administrator avatar.
 *
 * If an avatar image exists, its resolved media URL is displayed.
 * Otherwise, administrator initials are shown as a fallback.
 *
 * @param {object} props Component properties.
 * @param {string} props.name Administrator display name.
 * @param {string|null|undefined} props.url Administrator avatar URL.
 * @param {'normal'|'small'|'tiny'} [props.size='normal'] Avatar size.
 * @returns {JSX.Element} The rendered avatar.
 *
 * @author Eman
 */
function Avatar({ name, url, size = 'normal' }) {
    const avatarUrl = resolveMediaUrl(url || '');

    return (
        <span className={`admin-team-chat-avatar is-${size}`}>
            {avatarUrl ? (
                <img src={avatarUrl} alt="" />
            ) : (
                <b>{initials(name)}</b>
            )}
        </span>
    );
}

function DirectMessageModal({
    open,
    administrators,
    conversations,
    busyId,
    loading,
    onClose,
    onSelect,
}) {
    const [query, setQuery] = useState('');

    useEffect(() => {
        if (!open) {
            setQuery('');
        }
    }, [open]);

    const availableAdministrators = useMemo(
        () => administrators.filter((admin) => !admin.isCurrent),
        [administrators],
    );

    const filteredAdministrators = useMemo(() => {
        const value = query.trim().toLowerCase();

        if (!value) return availableAdministrators;

        return availableAdministrators.filter((admin) =>
            [admin.fullName, admin.email]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(value),
        );
    }, [availableAdministrators, query]);

    if (!open) return null;

    return (
        <div
            className="admin-team-chat-modal-backdrop"
            onMouseDown={busyId ? undefined : onClose}
        >
            <section
                className="admin-team-chat-modal admin-team-chat-direct-modal"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header>
                    <div>
                        <span>
                            <MessageCircleMore size={18} />
                        </span>

                        <div>
                            <strong>New private message</strong>
                            <small>
                                Choose one administrator. Existing direct chats reopen automatically.
                            </small>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={Boolean(busyId)}
                    >
                        <X size={17} />
                    </button>
                </header>

                <label className="admin-team-chat-modal__search">
                    <Search size={15} />

                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search administrators…"
                        autoFocus
                    />
                </label>

                <div className="admin-team-chat-modal__members admin-team-chat-direct-list">
                    {loading ? (
                        <div className="admin-team-chat-modal__empty">
                            <LoaderCircle className="admin-spin" size={18} />
                            Loading administrators…
                        </div>
                    ) : filteredAdministrators.length ? (
                        filteredAdministrators.map((admin) => {
                            const existingConversation = conversations.find(
                                (conversation) =>
                                    conversation.type === 'DIRECT' &&
                                    conversation.members?.some(
                                        (member) => member.id === admin.id,
                                    ),
                            );
                            const busy = busyId === admin.id;

                            return (
                                <button
                                    key={admin.id}
                                    type="button"
                                    onClick={() => onSelect(admin.id)}
                                    disabled={Boolean(busyId)}
                                >
                                    <Avatar
                                        name={admin.fullName}
                                        url={admin.avatarUrl}
                                        size="small"
                                    />

                                    <span>
                                        <strong>{admin.fullName}</strong>
                                        <small>{admin.email}</small>
                                    </span>

                                    <em>
                                        {busy ? (
                                            <LoaderCircle
                                                className="admin-spin"
                                                size={14}
                                            />
                                        ) : existingConversation ? (
                                            'Open chat'
                                        ) : (
                                            'Message'
                                        )}
                                    </em>
                                </button>
                            );
                        })
                    ) : (
                        <div className="admin-team-chat-modal__empty">
                            {query.trim()
                                ? 'No administrators match your search.'
                                : 'No other active administrators are available.'}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

/**
 * Modal used to create a new administrator group conversation.
 *
 * The modal allows the administrator to:
 * - Enter a group name.
 * - Select administrator members.
 * - Create a group containing at least two selected administrators.
 *
 * Local modal state is reset whenever the modal is closed.
 *
 * @param {object} props Component properties.
 * @param {boolean} props.open Whether the modal is visible.
 * @param {Array} props.administrators Available administrators.
 * @param {boolean} props.busy Whether group creation is in progress.
 * @param {Function} props.onClose Handler used to close the modal.
 * @param {Function} props.onCreate Handler used to create the group.
 * @returns {JSX.Element|null} The group modal or null when closed.
 *
 * @author Eman
 */
function GroupModal({
    open,
    administrators,
    busy,
    onClose,
    onCreate,
}) {
    const [title, setTitle] = useState('');
    const [selected, setSelected] = useState([]);

    useEffect(() => {
        if (!open) {
            setTitle('');
            setSelected([]);
        }
    }, [open]);

    const selectableAdministrators = administrators.filter(
        (admin) => !admin.isCurrent,
    );

    const allSelected =
        selectableAdministrators.length > 0 &&
        selectableAdministrators.every((admin) =>
            selected.includes(admin.id),
        );

    if (!open) return null;

    /**
     * Adds or removes an administrator from the
     * current group member selection.
     *
     * @param {string} id Administrator ID.
     */
    const toggle = (id) => {
        setSelected((current) =>
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id],
        );
    };

    return (
        <div
            className="admin-team-chat-modal-backdrop"
            onMouseDown={onClose}
        >
            <section
                className="admin-team-chat-modal"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header>
                    <div>
                        <span>
                            <UsersRound size={18} />
                        </span>

                        <div>
                            <strong>New admin group</strong>
                            <small>Select at least two administrators.</small>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                    >
                        <X size={17} />
                    </button>
                </header>

                <label className="admin-team-chat-modal__title">
                    <span>Group name</span>

                    <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={80}
                        placeholder="e.g. Operations team"
                    />
                </label>

                <div className="admin-team-chat-modal__member-tools">
                    <span>Members</span>

                    <button
                        type="button"
                        onClick={() =>
                            setSelected(
                                allSelected
                                    ? []
                                    : selectableAdministrators.map(
                                        (admin) => admin.id,
                                    ),
                            )
                        }
                        disabled={!selectableAdministrators.length || busy}
                    >
                        {allSelected ? 'Clear all' : 'Select all'}
                    </button>
                </div>

                <div className="admin-team-chat-modal__members">
                    {selectableAdministrators.map((admin) => {
                        const checked = selected.includes(admin.id);

                        return (
                            <button
                                key={admin.id}
                                type="button"
                                className={checked ? 'is-selected' : ''}
                                onClick={() => toggle(admin.id)}
                            >
                                <Avatar
                                    name={admin.fullName}
                                    url={admin.avatarUrl}
                                    size="small"
                                />

                                <span>
                                    <strong>{admin.fullName}</strong>
                                    <small>{admin.email}</small>
                                </span>

                                <i>
                                    {checked ? <Check size={13} /> : null}
                                </i>
                            </button>
                        );
                    })}
                </div>

                <footer>
                    <button
                        type="button"
                        className="admin-btn"
                        onClick={onClose}
                        disabled={busy}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        className="admin-btn admin-btn--primary"
                        disabled={
                            busy ||
                            title.trim().length < 2 ||
                            selected.length < 2
                        }
                        onClick={() =>
                            onCreate({
                                title: title.trim(),
                                memberIds: selected,
                            })
                        }
                    >
                        {busy ? (
                            <LoaderCircle
                                className="admin-spin"
                                size={15}
                            />
                        ) : (
                            <Plus size={15} />
                        )}

                        Create group
                    </button>
                </footer>
            </section>
        </div>
    );
}

/**
 * Administrator team-chat page.
 *
 * Provides the complete administrator messaging interface,
 * including:
 * - Loading administrator conversations.
 * - Loading available administrators.
 * - Searching conversations.
 * - Opening direct conversations using URL parameters.
 * - Displaying and sending messages.
 * - Marking conversations as read.
 * - Maintaining unread message counts.
 * - Receiving real-time Socket.IO updates.
 * - Creating administrator group conversations.
 *
 * @returns {JSX.Element} The administrator team-chat page.
 *
 * @author Eman
 */
export default function AdminTeamChatPage() {
    const [searchParams, setSearchParams] = useSearchParams();

    const currentUser = useMemo(
        () => getStoredUser() || {},
        [],
    );

    const currentUserId = currentUser.id;

    const messagesEndRef = useRef(null);
    const directHandledRef = useRef('');

    const [accessToken, setAccessToken] = useState('');
    const [administrators, setAdministrators] = useState([]);
    const [conversations, setConversations] = useState([]);
    const [activeId, setActiveId] = useState('');
    const [messages, setMessages] = useState([]);
    const [search, setSearch] = useState('');
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(false);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [administratorsLoading, setAdministratorsLoading] = useState(false);
    const [error, setError] = useState('');
    const [directOpen, setDirectOpen] = useState(false);
    const [directBusyId, setDirectBusyId] = useState('');
    const [groupOpen, setGroupOpen] = useState(false);
    const [groupBusy, setGroupBusy] = useState(false);

    const locked = !accessToken;

    const onVerified = useCallback(async (token) => {
        setAccessToken(token);
        setError('');
    }, []);

    /**
     * Resolves the currently selected conversation
     * from the loaded conversation collection.
     */
    const activeConversation = useMemo(
        () =>
            conversations.find(
                (conversation) => conversation.id === activeId,
            ) || null,
        [conversations, activeId],
    );

    /**
     * Filters the loaded conversations using the current search value.
     *
     * Searchable data includes:
     * - Conversation display name.
     * - Latest message content.
     * - Member email addresses.
     */
    const filteredConversations = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) return conversations;

        return conversations.filter((conversation) => {
            const haystack = [
                conversation.displayName,
                conversation.lastMessage?.content,
                ...(conversation.members || []).map(
                    (member) => member.email,
                ),
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return haystack.includes(query);
        });
    }, [conversations, search]);

    /**
     * Calculates the total number of unread messages
     * across all administrator conversations.
     */
    const unreadTotal = useMemo(
        () =>
            conversations.reduce(
                (total, item) =>
                    total + Number(item.unreadCount || 0),
                0,
            ),
        [conversations],
    );

    const refreshAdministrators = useCallback(async () => {
        setAdministratorsLoading(true);

        try {
            const adminData = await adminTeamChatApi.administrators();
            const nextAdministrators = Array.isArray(adminData)
                ? adminData
                : [];

            setAdministrators(nextAdministrators);
            setError('');

            return nextAdministrators;
        } catch (requestError) {
            setError(
                getApiErrorMessage(
                    requestError,
                    'Could not load administrators.',
                ),
            );

            return null;
        } finally {
            setAdministratorsLoading(false);
        }
    }, []);

    const openDirectModal = useCallback(() => {
        setDirectOpen(true);
        void refreshAdministrators();
    }, [refreshAdministrators]);

    const openGroupModal = useCallback(() => {
        setGroupOpen(true);
        void refreshAdministrators();
    }, [refreshAdministrators]);

    const openDirectConversation = useCallback(async (adminId) => {
        if (!adminId || directBusyId) return null;

        setDirectBusyId(adminId);

        try {
            const conversation = await adminTeamChatApi.direct(adminId);

            setConversations((current) => {
                const without = current.filter(
                    (item) => item.id !== conversation.id,
                );

                return [conversation, ...without];
            });

            setActiveId(conversation.id);
            setDirectOpen(false);
            setError('');

            return conversation;
        } catch (requestError) {
            setError(
                getApiErrorMessage(
                    requestError,
                    'Could not start this conversation.',
                ),
            );

            return null;
        } finally {
            setDirectBusyId('');
        }
    }, [directBusyId]);

    /**
     * Loads administrator conversations and available administrators.
     *
     * When `quiet` is enabled, the existing page remains visible
     * while the refresh state is displayed instead of the main
     * loading state.
     *
     * @param {object} options Loading options.
     * @param {boolean} options.quiet Whether the refresh is silent.
     * @returns {Promise<void>}
     */
    const loadConversations = useCallback(
        async ({ quiet = false } = {}) => {
            if (quiet) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            try {
                const [conversationData, adminData] =
                    await Promise.all([
                        adminTeamChatApi.conversations(),
                        adminTeamChatApi.administrators(),
                    ]);

                const nextConversations = Array.isArray(
                    conversationData,
                )
                    ? conversationData
                    : [];

                setConversations(nextConversations);

                setAdministrators(
                    Array.isArray(adminData) ? adminData : [],
                );

                setActiveId(
                    (current) =>
                        current || nextConversations[0]?.id || '',
                );

                setError('');
            } catch (requestError) {
                setError(
                    getApiErrorMessage(
                        requestError,
                        'Could not load team chat.',
                    ),
                );
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [],
    );

    /**
     * Loads messages for a selected conversation.
     *
     * After the messages are retrieved, the conversation is marked
     * as read and its local unread counter is reset.
     *
     * @param {string} conversationId Conversation ID.
     * @returns {Promise<void>}
     */
    const loadMessages = useCallback(
        async (conversationId) => {
            if (!conversationId) {
                setMessages([]);
                return;
            }

            setMessagesLoading(true);

            try {
                const payload =
                    await adminTeamChatApi.messages(conversationId);

                setMessages(
                    Array.isArray(payload?.messages)
                        ? payload.messages
                        : [],
                );

                await adminTeamChatApi
                    .markRead(conversationId)
                    .catch(() => undefined);

                setConversations((current) =>
                    current.map((conversation) =>
                        conversation.id === conversationId
                            ? {
                                ...conversation,
                                unreadCount: 0,
                            }
                            : conversation,
                    ),
                );
            } catch (requestError) {
                setError(
                    getApiErrorMessage(
                        requestError,
                        'Could not load conversation messages.',
                    ),
                );
            } finally {
                setMessagesLoading(false);
            }
        },
        [],
    );

    /**
     * Loads the administrator team-chat data
     * when the page is first mounted.
     */
    useEffect(() => {
        if (locked) return;
        loadConversations();
    }, [loadConversations, locked]);

    /**
     * Handles direct-conversation requests supplied through
     * the `adminId` URL search parameter.
     *
     * Once the direct conversation is created or retrieved,
     * the corresponding conversation becomes active and the
     * URL parameter is removed.
     */
    useEffect(() => {
        const adminId =
            searchParams.get('adminId') || '';

        if (
            locked ||
            !adminId ||
            directHandledRef.current === adminId
        ) {
            return;
        }

        directHandledRef.current = adminId;

        openDirectConversation(adminId).then((conversation) => {
            if (!conversation) {
                directHandledRef.current = '';
                return;
            }

            const next = new URLSearchParams(searchParams);

            next.delete('adminId');

            setSearchParams(next, {
                replace: true,
            });
        });
    }, [
        locked,
        openDirectConversation,
        searchParams,
        setSearchParams,
    ]);

    /**
     * Loads the messages belonging to the
     * currently selected conversation.
     */
    useEffect(() => {
        if (locked) return;
        loadMessages(activeId);
    }, [activeId, loadMessages, locked]);

    /**
     * Automatically scrolls the message area to
     * the latest message whenever the message list changes.
     */
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
        });
    }, [messages]);

    /**
     * Registers real-time administrator chat Socket.IO listeners.
     *
     * Supported socket events:
     * - `admin-chat:message`
     * - `admin-chat:conversation`
     * - `admin-chat:read`
     *
     * Listeners are removed when the effect is cleaned up.
     */
    useEffect(() => {
        if (locked) return undefined;

        const socket = getAdminTeamChatSocket();

        const onMessage = (message) => {
            if (!message?.conversationId) return;

            if (message.conversationId === activeId) {
                setMessages((current) =>
                    current.some(
                        (item) => item.id === message.id,
                    )
                        ? current
                        : [...current, message],
                );

                if (message.senderId !== currentUserId) {
                    adminTeamChatApi
                        .markRead(activeId)
                        .catch(() => undefined);
                }
            }

            loadConversations({
                quiet: true,
            });
        };

        const onConversation = () =>
            loadConversations({
                quiet: true,
            });

        const onRead = () => undefined;

        socket.on(
            'admin-chat:message',
            onMessage,
        );

        socket.on(
            'admin-chat:conversation',
            onConversation,
        );

        socket.on(
            'admin-chat:read',
            onRead,
        );

        return () => {
            socket.off(
                'admin-chat:message',
                onMessage,
            );

            socket.off(
                'admin-chat:conversation',
                onConversation,
            );

            socket.off(
                'admin-chat:read',
                onRead,
            );
        };
    }, [
        activeId,
        currentUserId,
        loadConversations,
        locked,
    ]);

    /**
     * Sends the current message draft to the
     * active administrator conversation.
     *
     * Empty messages, missing conversations, and duplicate
     * submissions while a message is sending are ignored.
     *
     * @param {React.FormEvent<HTMLFormElement>} event Form submit event.
     * @returns {Promise<void>}
     */
    const sendMessage = async (event) => {
        event.preventDefault();

        const content = draft.trim();

        if (
            !content ||
            !activeId ||
            sending
        ) {
            return;
        }

        setSending(true);
        setDraft('');

        try {
            const message =
                await adminTeamChatApi.send(
                    activeId,
                    content,
                );

            setMessages((current) =>
                current.some(
                    (item) => item.id === message.id,
                )
                    ? current
                    : [...current, message],
            );

            await loadConversations({
                quiet: true,
            });
        } catch (requestError) {
            setDraft(content);

            setError(
                getApiErrorMessage(
                    requestError,
                    'Could not send the message.',
                ),
            );
        } finally {
            setSending(false);
        }
    };

    /**
     * Creates a new administrator group conversation.
     *
     * Once created, the conversation is added to the
     * conversation collection, selected automatically,
     * and the creation modal is closed.
     *
     * @param {object} body Group conversation payload.
     * @returns {Promise<void>}
     */
    const createGroup = async (body) => {
        setGroupBusy(true);

        try {
            const conversation =
                await adminTeamChatApi.createGroup(body);

            setConversations((current) => [
                conversation,
                ...current,
            ]);

            setActiveId(conversation.id);
            setGroupOpen(false);
            setError('');
        } catch (requestError) {
            setError(
                getApiErrorMessage(
                    requestError,
                    'Could not create the group conversation.',
                ),
            );
        } finally {
            setGroupBusy(false);
        }
    };

    return (
        <>
            <main
                className={`admin-page admin-team-chat-page admin-sensitive-page-content ${locked ? 'is-sensitive-locked' : ''
                    }`}
                aria-hidden={locked ? 'true' : undefined}
            >
                <section className="admin-hero admin-team-chat-hero">
                    <div>
                        <span className="admin-eyebrow">
                            <MessageCircleMore size={15} />
                            People & access
                        </span>

                        <h1>Team chat</h1>

                        <p>
                            Private conversations between verified
                            administrators inside Voxidence.
                        </p>
                    </div>

                    <div className="admin-team-chat-hero__actions">
                        <span className="admin-team-chat-unread">
                            <b>{unreadTotal}</b> unread
                        </span>

                        <button
                            type="button"
                            className="admin-btn"
                            onClick={() =>
                                loadConversations({
                                    quiet: true,
                                })
                            }
                            disabled={refreshing}
                        >
                            <RefreshCw
                                size={14}
                                className={
                                    refreshing
                                        ? 'admin-spin'
                                        : ''
                                }
                            />

                            Refresh
                        </button>

                        <button
                            type="button"
                            className="admin-btn admin-btn--primary"
                            onClick={openDirectModal}
                        >
                            <MessageCircleMore size={15} />
                            New message
                        </button>

                        <button
                            type="button"
                            className="admin-btn"
                            onClick={openGroupModal}
                        >
                            <UsersRound size={15} />
                            New group
                        </button>
                    </div>
                </section>

                {error ? (
                    <div className="admin-team-chat-error">
                        <span>{error}</span>

                        <button
                            type="button"
                            onClick={() => setError('')}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : null}

                <section className="admin-team-chat-shell">
                    <aside
                        className={`admin-team-chat-list ${activeConversation
                            ? 'has-active-mobile'
                            : ''
                            }`}
                    >
                        <div className="admin-team-chat-list__head">
                            <div>
                                <strong>Conversations</strong>
                                <small>
                                    {conversations.length} active threads
                                </small>
                            </div>
                        </div>

                        <label className="admin-team-chat-search">
                            <Search size={15} />

                            <input
                                value={search}
                                onChange={(event) =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search conversations…"
                            />
                        </label>

                        <div className="admin-team-chat-list__body">
                            {loading ? (
                                <div className="admin-team-chat-state">
                                    <LoaderCircle
                                        className="admin-spin"
                                        size={21}
                                    />

                                    <span>
                                        Loading conversations…
                                    </span>
                                </div>
                            ) : filteredConversations.length ? (
                                filteredConversations.map(
                                    (conversation) => (
                                        <button
                                            type="button"
                                            key={conversation.id}
                                            className={`admin-team-chat-thread ${activeId ===
                                                conversation.id
                                                ? 'is-active'
                                                : ''
                                                }`}
                                            onClick={() =>
                                                setActiveId(
                                                    conversation.id,
                                                )
                                            }
                                        >
                                            <Avatar
                                                name={
                                                    conversation.displayName
                                                }
                                                url={
                                                    conversation.displayAvatarUrl
                                                }
                                            />

                                            <span className="admin-team-chat-thread__copy">
                                                <span>
                                                    <strong>
                                                        {
                                                            conversation.displayName
                                                        }
                                                    </strong>

                                                    <time>
                                                        {formatConversationTime(
                                                            conversation.lastMessageAt ||
                                                            conversation.updatedAt,
                                                        )}
                                                    </time>
                                                </span>

                                                <span>
                                                    <small>
                                                        {conversation
                                                            .lastMessage
                                                            ?.content ||
                                                            (conversation.type ===
                                                                'GROUP'
                                                                ? `${conversation
                                                                    .members
                                                                    ?.length ||
                                                                0
                                                                } administrators`
                                                                : 'Start the conversation')}
                                                    </small>

                                                    {conversation.unreadCount ? (
                                                        <b>
                                                            {conversation.unreadCount >
                                                                99
                                                                ? '99+'
                                                                : conversation.unreadCount}
                                                        </b>
                                                    ) : null}
                                                </span>
                                            </span>
                                        </button>
                                    ),
                                )
                            ) : (
                                <div className="admin-team-chat-state">
                                    <MessageCircleMore size={24} />

                                    <strong>
                                        No conversations yet
                                    </strong>

                                    <span>
                                        Start a private chat with one administrator
                                        or create a group.
                                    </span>

                                    <div className="admin-team-chat-state__actions">
                                        <button
                                            type="button"
                                            onClick={openDirectModal}
                                        >
                                            <MessageCircleMore size={13} />
                                            New message
                                        </button>

                                        <button
                                            type="button"
                                            onClick={openGroupModal}
                                        >
                                            <UsersRound size={13} />
                                            New group
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </aside>

                    <div
                        className={`admin-team-chat-conversation ${activeConversation
                            ? 'is-open'
                            : ''
                            }`}
                    >
                        {activeConversation ? (
                            <>
                                <header className="admin-team-chat-conversation__head">
                                    <button
                                        type="button"
                                        className="admin-team-chat-back"
                                        onClick={() =>
                                            setActiveId('')
                                        }
                                    >
                                        <ArrowLeft size={17} />
                                    </button>

                                    <Avatar
                                        name={
                                            activeConversation.displayName
                                        }
                                        url={
                                            activeConversation.displayAvatarUrl
                                        }
                                    />

                                    <div>
                                        <strong>
                                            {
                                                activeConversation.displayName
                                            }
                                        </strong>

                                        <small>
                                            {activeConversation.type ===
                                                'GROUP'
                                                ? `${activeConversation
                                                    .members?.length ||
                                                0
                                                } administrators`
                                                : activeConversation.members?.find(
                                                    (member) =>
                                                        member.id !==
                                                        currentUserId,
                                                )?.email ||
                                                'Direct administrator message'}
                                        </small>
                                    </div>

                                    <span className="admin-team-chat-private">
                                        Private
                                    </span>
                                </header>

                                <div className="admin-team-chat-messages">
                                    {messagesLoading ? (
                                        <div className="admin-team-chat-state">
                                            <LoaderCircle
                                                className="admin-spin"
                                                size={21}
                                            />

                                            <span>
                                                Loading messages…
                                            </span>
                                        </div>
                                    ) : messages.length ? (
                                        messages.map((message) => {
                                            const mine =
                                                message.senderId ===
                                                currentUserId;

                                            return (
                                                <div
                                                    key={message.id}
                                                    className={`admin-team-chat-message ${mine
                                                        ? 'is-mine'
                                                        : ''
                                                        }`}
                                                >
                                                    {!mine ? (
                                                        <Avatar
                                                            name={
                                                                message.sender
                                                                    ?.fullName
                                                            }
                                                            url={
                                                                message.sender
                                                                    ?.avatarUrl
                                                            }
                                                            size="tiny"
                                                        />
                                                    ) : null}

                                                    <div>
                                                        {!mine ? (
                                                            <strong>
                                                                {message.sender
                                                                    ?.fullName ||
                                                                    'Administrator'}
                                                            </strong>
                                                        ) : null}

                                                        <p>
                                                            {message.content}
                                                        </p>

                                                        <time>
                                                            {formatMessageTime(
                                                                message.createdAt,
                                                            )}
                                                        </time>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="admin-team-chat-empty-chat">
                                            <span>
                                                <MessageCircleMore
                                                    size={25}
                                                />
                                            </span>

                                            <strong>
                                                Start this conversation
                                            </strong>

                                            <p>
                                                Messages are visible only
                                                to administrators who belong
                                                to this thread.
                                            </p>
                                        </div>
                                    )}

                                    <div ref={messagesEndRef} />
                                </div>

                                <form
                                    className="admin-team-chat-composer"
                                    onSubmit={sendMessage}
                                >
                                    <textarea
                                        value={draft}
                                        onChange={(event) =>
                                            setDraft(
                                                event.target.value,
                                            )
                                        }
                                        onKeyDown={(event) => {
                                            if (
                                                event.key ===
                                                'Enter' &&
                                                !event.shiftKey
                                            ) {
                                                event.preventDefault();

                                                event.currentTarget.form?.requestSubmit();
                                            }
                                        }}
                                        placeholder="Write a message…"
                                        maxLength={3000}
                                        rows={1}
                                    />

                                    <button
                                        type="submit"
                                        disabled={
                                            !draft.trim() ||
                                            sending
                                        }
                                        aria-label="Send message"
                                    >
                                        {sending ? (
                                            <LoaderCircle
                                                className="admin-spin"
                                                size={17}
                                            />
                                        ) : (
                                            <Send size={17} />
                                        )}
                                    </button>
                                </form>
                            </>
                        ) : (
                            <div className="admin-team-chat-empty-chat is-main">
                                <span>
                                    <MessageCircleMore size={29} />
                                </span>

                                <strong>
                                    Select or start a conversation
                                </strong>

                                <p>
                                    Private chats stay one-to-one, while groups
                                    can include multiple administrators.
                                </p>

                                <div className="admin-team-chat-empty-chat__actions">
                                    <button
                                        type="button"
                                        className="admin-btn admin-btn--primary"
                                        onClick={openDirectModal}
                                    >
                                        <MessageCircleMore size={14} />
                                        New message
                                    </button>

                                    <button
                                        type="button"
                                        className="admin-btn"
                                        onClick={openGroupModal}
                                    >
                                        <UsersRound size={14} />
                                        New group
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                <DirectMessageModal
                    open={directOpen}
                    administrators={administrators}
                    conversations={conversations}
                    busyId={directBusyId}
                    loading={administratorsLoading}
                    onClose={() =>
                        !directBusyId &&
                        setDirectOpen(false)
                    }
                    onSelect={openDirectConversation}
                />

                <GroupModal
                    open={groupOpen}
                    administrators={administrators}
                    busy={groupBusy}
                    onClose={() =>
                        !groupBusy &&
                        setGroupOpen(false)
                    }
                    onCreate={createGroup}
                />
            </main>

            {locked ? (
                <AdminSensitiveAccessGate
                    scope={TEAM_CHAT_SCOPE}
                    title="Unlock team chat"
                    description="Confirm your current administrator password before viewing private administrator conversations or sending team messages."
                    onVerified={onVerified}
                />
            ) : null}
        </>
    );
}