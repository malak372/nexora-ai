import 'dart:async';

import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/network/api_client.dart';
import '../../../core/network/realtime_socket.dart';
import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

class AdminTeamChatPage extends StatefulWidget {
  const AdminTeamChatPage({
    super.key,
    this.initialAdminId,
    this.initialConversation,
  });

  final String? initialAdminId;
  final Map<String, dynamic>? initialConversation;

  @override
  State<AdminTeamChatPage> createState() => _AdminTeamChatPageState();
}

class _AdminTeamChatPageState extends State<AdminTeamChatPage> {
  final _api = AdminApi.instance;
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();

  List<Map<String, dynamic>> _administrators = const [];
  List<Map<String, dynamic>> _conversations = const [];
  List<Map<String, dynamic>> _messages = const [];
  String _currentUserId = '';
  String _activeConversationId = '';
  bool _loading = true;
  bool _messagesLoading = false;
  bool _sending = false;
  bool _directHandled = false;
  String _error = '';
  io.Socket? _socket;

  Map<String, dynamic>? get _activeConversation {
    for (final conversation in _conversations) {
      if (conversation['id']?.toString() == _activeConversationId) {
        return conversation;
      }
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  @override
  void dispose() {
    _socket?.off('admin-chat:message', _onSocketMessage);
    _socket?.off('admin-chat:conversation', _onSocketConversation);
    _socket?.off('admin-chat:read', _onSocketRead);
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    final user = await SessionStore.instance.readUser();
    _currentUserId = user?['id']?.toString() ?? '';
    await _loadConversations();
    await _connectSocket();
  }

  Future<void> _connectSocket() async {
    try {
      final socket = await RealtimeSocket.connect('/admin-chat');
      socket.off('admin-chat:message', _onSocketMessage);
      socket.off('admin-chat:conversation', _onSocketConversation);
      socket.off('admin-chat:read', _onSocketRead);
      socket.on('admin-chat:message', _onSocketMessage);
      socket.on('admin-chat:conversation', _onSocketConversation);
      socket.on('admin-chat:read', _onSocketRead);
      if (!socket.connected) socket.connect();
      _socket = socket;
    } catch (_) {}
  }

  void _onSocketMessage(dynamic raw) {
    if (raw is! Map || !mounted) return;
    final message = Map<String, dynamic>.from(raw);
    final conversationId = message['conversationId']?.toString() ?? '';

    if (conversationId == _activeConversationId) {
      final exists = _messages.any(
        (item) => item['id']?.toString() == message['id']?.toString(),
      );
      if (!exists) {
        setState(() => _messages = [..._messages, message]);
        _scrollToBottom();
      }
      if (message['senderId']?.toString() != _currentUserId) {
        unawaited(_api.markAdminConversationRead(conversationId));
      }
    }

    unawaited(_refreshConversations());
  }

  void _onSocketConversation(dynamic _) {
    unawaited(_refreshConversations());
  }

  void _onSocketRead(dynamic _) {}

  Future<void> _loadConversations() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }

    try {
      final conversations = await _api.getTeamChatConversations(force: true);
      if (!mounted) return;
      _conversations = conversations;

      try {
        _administrators = await _api.getTeamChatAdministrators();
      } catch (_) {
        _administrators = const [];
      }

      if (!_directHandled) {
        final initialConversation = widget.initialConversation;
        final initialConversationId =
            initialConversation?['id']?.toString().trim() ?? '';
        final requestedAdminId = widget.initialAdminId?.trim() ?? '';

        if (initialConversation != null && initialConversationId.isNotEmpty) {
          _directHandled = true;
          _upsertConversation(initialConversation, makeActive: true);
          await _loadMessages(initialConversationId);
        } else if (requestedAdminId.isNotEmpty) {
          _directHandled = true;
          final conversation = await _api.createDirectAdminConversation(
            requestedAdminId,
          );
          if (!mounted) return;
          _upsertConversation(conversation, makeActive: true);
          await _loadMessages(conversation['id']?.toString() ?? '');
        }
      }

      if (mounted) setState(() {});
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load team chat.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refreshConversations() async {
    try {
      final items = await _api.getTeamChatConversations(force: true);
      if (!mounted) return;
      setState(() => _conversations = items);
    } catch (_) {}
  }

  Future<void> _openConversation(Map<String, dynamic> conversation) async {
    final id = conversation['id']?.toString() ?? '';
    if (id.isEmpty) return;
    setState(() => _activeConversationId = id);
    await _loadMessages(id);
  }

  Future<void> _loadMessages(String conversationId) async {
    if (conversationId.isEmpty) return;
    setState(() {
      _messagesLoading = true;
      _error = '';
    });

    try {
      final payload = await _api.getAdminConversationMessages(conversationId);
      final raw = payload['messages'];
      final messages = raw is List
          ? raw
                .whereType<Map>()
                .map((item) => Map<String, dynamic>.from(item))
                .toList()
          : <Map<String, dynamic>>[];

      if (!mounted || _activeConversationId != conversationId) return;
      setState(() => _messages = messages);
      await _api.markAdminConversationRead(conversationId);
      await _refreshConversations();
      _scrollToBottom();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load messages.');
    } finally {
      if (mounted) setState(() => _messagesLoading = false);
    }
  }

  Future<void> _sendMessage() async {
    final content = _messageController.text.trim();
    if (content.isEmpty || _activeConversationId.isEmpty || _sending) return;

    setState(() => _sending = true);
    _messageController.clear();

    try {
      final message = await _api.sendAdminChatMessage(
        _activeConversationId,
        content,
      );
      if (!mounted) return;
      final exists = _messages.any(
        (item) => item['id']?.toString() == message['id']?.toString(),
      );
      if (!exists) setState(() => _messages = [..._messages, message]);
      await _refreshConversations();
      _scrollToBottom();
    } on ApiException catch (error) {
      if (!mounted) return;
      _messageController.text = content;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      _messageController.text = content;
      setState(() => _error = 'Could not send the message.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _startDirect(Map<String, dynamic> admin) async {
    final id = admin['id']?.toString() ?? '';
    if (id.isEmpty || admin['isCurrent'] == true) return;

    try {
      final conversation = await _api.createDirectAdminConversation(id);
      if (!mounted) return;
      _upsertConversation(conversation, makeActive: true);
      await _loadMessages(conversation['id']?.toString() ?? '');
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  void _upsertConversation(
    Map<String, dynamic> conversation, {
    bool makeActive = false,
  }) {
    final id = conversation['id']?.toString() ?? '';
    if (id.isEmpty) return;
    final next = _conversations
        .where((item) => item['id']?.toString() != id)
        .toList();
    next.insert(0, conversation);
    setState(() {
      _conversations = next;
      if (makeActive) _activeConversationId = id;
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _showNewConversationSheet() async {
    List<Map<String, dynamic>> administrators;

    try {
      administrators = await _api.getTeamChatAdministrators();
      if (!mounted) return;
      setState(() {
        _administrators = administrators;
        _error = '';
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
      return;
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not load administrators.');
      }
      return;
    }

    if (!mounted) return;

    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AdminChatNewConversationSheet(
        administrators: administrators,
        currentUserId: _currentUserId,
      ),
    );

    if (!mounted || selected == null) return;

    if (selected['type'] == 'direct') {
      final admin = selected['admin'];
      if (admin is Map) {
        await _startDirect(Map<String, dynamic>.from(admin));
      }
      return;
    }

    final title = selected['title']?.toString() ?? '';
    final memberIds =
        (selected['memberIds'] as List?)
            ?.map((value) => value.toString())
            .toList() ??
        const <String>[];

    try {
      final conversation = await _api.createAdminGroupConversation(
        title: title,
        memberIds: memberIds,
      );
      if (!mounted) return;
      _upsertConversation(conversation, makeActive: true);
      await _loadMessages(conversation['id']?.toString() ?? '');
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = _activeConversation;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(active == null ? 'Team chat' : _conversationName(active)),
        actions: [
          IconButton(
            onPressed: _showNewConversationSheet,
            tooltip: 'New conversation',
            icon: const Icon(Icons.add_comment_outlined),
          ),
          IconButton(
            onPressed: _refreshConversations,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: AdminWorkspaceBackground(
        child: SafeArea(
          top: false,
          child: active == null ? _buildConversationList() : _buildChat(active),
        ),
      ),
    );
  }

  Widget _buildConversationList() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _loadConversations,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 28),
        children: [
          AdminGlassCard(
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.forum_outlined,
                    color: AppColors.primaryDark,
                  ),
                ),
                const SizedBox(width: 11),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Administrator conversations',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Private direct messages and team groups.',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_error.isNotEmpty) ...[
            const SizedBox(height: 10),
            _ErrorBanner(message: _error),
          ],
          const SizedBox(height: 12),
          if (_loading)
            const AdminLoadingList(count: 5)
          else if (_conversations.isEmpty)
            _EmptyChatState(onStart: _showNewConversationSheet)
          else
            ..._conversations.map(_conversationTile),
        ],
      ),
    );
  }

  Widget _conversationTile(Map<String, dynamic> conversation) {
    final name = _conversationName(conversation);
    final lastMessage = conversation['lastMessage'];
    final lastContent = lastMessage is Map
        ? lastMessage['content']?.toString() ?? ''
        : '';
    final unread =
        int.tryParse(conversation['unreadCount']?.toString() ?? '') ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(17),
        child: InkWell(
          borderRadius: BorderRadius.circular(17),
          onTap: () => _openConversation(conversation),
          child: Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(17),
            ),
            child: Row(
              children: [
                AdminAvatar(
                  name: name,
                  avatarUrl: conversation['displayAvatarUrl']?.toString(),
                  size: 43,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          Text(
                            _formatShortTime(
                              conversation['lastMessageAt'] ??
                                  conversation['updatedAt'],
                            ),
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              lastContent.isEmpty
                                  ? 'Start the conversation'
                                  : lastContent,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.2,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                          if (unread > 0)
                            Container(
                              constraints: const BoxConstraints(minWidth: 20),
                              height: 20,
                              alignment: Alignment.center,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 5,
                              ),
                              decoration: const BoxDecoration(
                                color: AppColors.primaryDark,
                                borderRadius: BorderRadius.all(
                                  Radius.circular(999),
                                ),
                              ),
                              child: Text(
                                unread > 99 ? '99+' : '$unread',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 7.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChat(Map<String, dynamic> conversation) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(14, 9, 14, 9),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(bottom: BorderSide(color: AppColors.border)),
          ),
          child: Row(
            children: [
              IconButton(
                onPressed: () => setState(() => _activeConversationId = ''),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              AdminAvatar(
                name: _conversationName(conversation),
                avatarUrl: conversation['displayAvatarUrl']?.toString(),
                size: 39,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _conversationName(conversation),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _conversationSubtitle(conversation),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: _ErrorBanner(message: _error),
          ),
        Expanded(
          child: _messagesLoading
              ? const Center(
                  child: CircularProgressIndicator(color: AppColors.primary),
                )
              : _messages.isEmpty
              ? const _EmptyMessageState()
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.fromLTRB(13, 16, 13, 12),
                  itemCount: _messages.length,
                  itemBuilder: (_, index) => _messageBubble(_messages[index]),
                ),
        ),
        _messageComposer(),
      ],
    );
  }

  Widget _messageBubble(Map<String, dynamic> message) {
    final mine = message['senderId']?.toString() == _currentUserId;
    final senderRaw = message['sender'];
    final sender = senderRaw is Map
        ? Map<String, dynamic>.from(senderRaw)
        : <String, dynamic>{};
    final senderName = sender['fullName']?.toString() ?? 'Administrator';

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .76,
        ),
        margin: const EdgeInsets.only(bottom: 9),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (!mine) ...[
              AdminAvatar(
                name: senderName,
                avatarUrl: sender['avatarUrl']?.toString(),
                size: 27,
              ),
              const SizedBox(width: 6),
            ],
            Flexible(
              child: Container(
                padding: const EdgeInsets.fromLTRB(11, 8, 11, 7),
                decoration: BoxDecoration(
                  color: mine ? AppColors.primarySoft : AppColors.surface,
                  border: Border.all(
                    color: mine ? AppColors.borderStrong : AppColors.border,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(15),
                    topRight: const Radius.circular(15),
                    bottomLeft: Radius.circular(mine ? 15 : 5),
                    bottomRight: Radius.circular(mine ? 5 : 15),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!mine) ...[
                      Text(
                        senderName,
                        style: const TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 8.2,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                    ],
                    Text(
                      message['content']?.toString() ?? '',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.3,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Text(
                        _formatMessageTime(message['createdAt']),
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 7,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _messageComposer() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(11, 9, 11, 10),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _messageController,
                minLines: 1,
                maxLines: 5,
                maxLength: 3000,
                textInputAction: TextInputAction.newline,
                decoration: InputDecoration(
                  hintText: 'Write a message…',
                  counterText: '',
                  filled: true,
                  fillColor: AppColors.background,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 13,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: const BorderSide(color: AppColors.primary),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 44,
              height: 44,
              child: FilledButton(
                onPressed: _sending ? null : _sendMessage,
                style: FilledButton.styleFrom(
                  padding: EdgeInsets.zero,
                  backgroundColor: AppColors.primaryDark,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: _sending
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_rounded, size: 18),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _conversationName(Map<String, dynamic> conversation) {
    return conversation['displayName']?.toString().trim().isNotEmpty == true
        ? conversation['displayName'].toString()
        : 'Administrator';
  }

  String _conversationSubtitle(Map<String, dynamic> conversation) {
    if (conversation['type']?.toString() == 'GROUP') {
      final members = conversation['members'];
      final count = members is List ? members.length : 0;
      return '$count administrators';
    }

    final members = conversation['members'];
    if (members is List) {
      for (final raw in members.whereType<Map>()) {
        final member = Map<String, dynamic>.from(raw);
        if (member['id']?.toString() != _currentUserId) {
          return member['email']?.toString() ?? 'Direct message';
        }
      }
    }
    return 'Direct message';
  }

  String _formatShortTime(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return '';
    final now = DateTime.now();
    if (date.year == now.year &&
        date.month == now.month &&
        date.day == now.day) {
      return _clock(date);
    }
    return '${date.day}/${date.month}';
  }

  String _formatMessageTime(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    return date == null ? '' : _clock(date);
  }

  String _clock(DateTime date) {
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}

class _AdminChatNewConversationSheet extends StatefulWidget {
  const _AdminChatNewConversationSheet({
    required this.administrators,
    required this.currentUserId,
  });

  final List<Map<String, dynamic>> administrators;
  final String currentUserId;

  @override
  State<_AdminChatNewConversationSheet> createState() =>
      _AdminChatNewConversationSheetState();
}

class _AdminChatNewConversationSheetState
    extends State<_AdminChatNewConversationSheet> {
  final _title = TextEditingController();
  final _search = TextEditingController();
  final Set<String> _selected = {};
  bool _groupMode = false;

  @override
  void dispose() {
    _title.dispose();
    _search.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _availableAdmins {
    final query = _search.text.trim().toLowerCase();

    return widget.administrators.where((admin) {
      final id = admin['id']?.toString() ?? '';
      if (id.isEmpty ||
          id == widget.currentUserId ||
          admin['isCurrent'] == true) {
        return false;
      }

      if (query.isEmpty) return true;

      final name = admin['fullName']?.toString().toLowerCase() ?? '';
      final email = admin['email']?.toString().toLowerCase() ?? '';
      return name.contains(query) || email.contains(query);
    }).toList();
  }

  void _toggleSelectAll() {
    final ids = _availableAdmins
        .map((admin) => admin['id']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toSet();
    final allSelected = ids.isNotEmpty && ids.every(_selected.contains);

    setState(() {
      if (allSelected) {
        _selected.removeAll(ids);
      } else {
        _selected.addAll(ids);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final admins = _availableAdmins;
    final visibleIds = admins
        .map((admin) => admin['id']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toSet();
    final allVisibleSelected =
        visibleIds.isNotEmpty && visibleIds.every(_selected.contains);

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .86,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(25)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(17, 15, 12, 8),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Icon(
                      _groupMode
                          ? Icons.groups_2_outlined
                          : Icons.chat_bubble_outline_rounded,
                      color: AppColors.primaryDark,
                      size: 19,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _groupMode ? 'New group' : 'New private message',
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _groupMode
                              ? 'Choose at least two administrators.'
                              : 'Choose one administrator. Existing chats reopen automatically.',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(15, 4, 15, 10),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(
                    value: false,
                    label: Text('Direct'),
                    icon: Icon(Icons.person_outline_rounded),
                  ),
                  ButtonSegment(
                    value: true,
                    label: Text('Group'),
                    icon: Icon(Icons.groups_2_outlined),
                  ),
                ],
                selected: {_groupMode},
                onSelectionChanged: (value) {
                  setState(() {
                    _groupMode = value.first;
                    _selected.clear();
                    _title.clear();
                  });
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 15),
              child: TextField(
                controller: _search,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Search administrators...',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () {
                            _search.clear();
                            setState(() {});
                          },
                          icon: const Icon(Icons.close_rounded),
                        ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
            if (_groupMode) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(15, 11, 15, 5),
                child: TextField(
                  controller: _title,
                  maxLength: 80,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Group name',
                    counterText: '',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(15, 1, 15, 3),
                child: Row(
                  children: [
                    Text(
                      '${_selected.length} selected',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    TextButton.icon(
                      onPressed: visibleIds.isEmpty ? null : _toggleSelectAll,
                      icon: Icon(
                        allVisibleSelected
                            ? Icons.remove_done_rounded
                            : Icons.done_all_rounded,
                        size: 15,
                      ),
                      label: Text(
                        allVisibleSelected ? 'Clear visible' : 'Select all',
                      ),
                    ),
                  ],
                ),
              ),
            ] else
              const SizedBox(height: 9),
            Flexible(
              child: admins.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.fromLTRB(24, 30, 24, 34),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.person_search_outlined,
                            color: AppColors.textMuted,
                            size: 28,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _search.text.trim().isEmpty
                                ? 'No other active administrators are available.'
                                : 'No administrators match your search.',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      padding: const EdgeInsets.fromLTRB(10, 2, 10, 12),
                      itemCount: admins.length,
                      itemBuilder: (_, index) {
                        final admin = admins[index];
                        final id = admin['id']?.toString() ?? '';
                        final selected = _selected.contains(id);

                        return ListTile(
                          onTap: () {
                            if (_groupMode) {
                              setState(() {
                                selected
                                    ? _selected.remove(id)
                                    : _selected.add(id);
                              });
                            } else {
                              Navigator.pop(context, {
                                'type': 'direct',
                                'admin': admin,
                              });
                            }
                          },
                          leading: AdminAvatar(
                            name:
                                admin['fullName']?.toString() ??
                                'Administrator',
                            avatarUrl: admin['avatarUrl']?.toString(),
                            size: 40,
                          ),
                          title: Text(
                            admin['fullName']?.toString() ?? 'Administrator',
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          subtitle: Text(
                            admin['email']?.toString() ?? '',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.5,
                            ),
                          ),
                          trailing: _groupMode
                              ? Checkbox(
                                  value: selected,
                                  onChanged: (_) {
                                    setState(() {
                                      selected
                                          ? _selected.remove(id)
                                          : _selected.add(id);
                                    });
                                  },
                                )
                              : const Icon(Icons.chevron_right_rounded),
                        );
                      },
                    ),
            ),
            if (_groupMode)
              Padding(
                padding: const EdgeInsets.fromLTRB(15, 4, 15, 13),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed:
                        _title.text.trim().length >= 2 && _selected.length >= 2
                        ? () => Navigator.pop(context, {
                            'type': 'group',
                            'title': _title.text.trim(),
                            'memberIds': _selected.toList(),
                          })
                        : null,
                    icon: const Icon(Icons.group_add_outlined),
                    label: const Text('Create group'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.pinkLight),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: AppColors.danger,
          fontSize: 9.2,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _EmptyChatState extends StatelessWidget {
  const _EmptyChatState({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      child: Column(
        children: [
          const Icon(
            Icons.chat_bubble_outline_rounded,
            color: AppColors.primaryDark,
            size: 28,
          ),
          const SizedBox(height: 9),
          const Text(
            'No conversations yet',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Start a direct message or create an administrator group.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textMuted,
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onStart,
            icon: const Icon(Icons.add_comment_outlined, size: 16),
            label: const Text('New conversation'),
          ),
        ],
      ),
    );
  }
}

class _EmptyMessageState extends StatelessWidget {
  const _EmptyMessageState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.forum_outlined, color: AppColors.primaryDark, size: 29),
            SizedBox(height: 8),
            Text(
              'Start this conversation',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Only administrators in this thread can see these messages.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 9,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
