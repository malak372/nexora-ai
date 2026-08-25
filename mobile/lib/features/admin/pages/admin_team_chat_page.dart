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

class _AdminTeamChatPageState extends State<AdminTeamChatPage>
    with WidgetsBindingObserver {
  final _api = AdminApi.instance;
  final _messageController = TextEditingController();
  final _messageFocusNode = FocusNode();
  final _scrollController = ScrollController();

  List<Map<String, dynamic>> _conversations = const [];
  List<Map<String, dynamic>> _messages = const [];
  String _currentUserId = '';
  String _activeConversationId = '';
  bool _loading = true;
  bool _messagesLoading = false;
  String _deletingMessageId = '';
  bool _directHandled = false;
  String _error = '';
  io.Socket? _socket;
  Timer? _activeConversationSyncTimer;
  Timer? _socketReconnectTimer;
  bool _activeMessagesSyncing = false;
  bool _socketReady = false;

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
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_resumeRealtime());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _activeConversationSyncTimer?.cancel();
    _socketReconnectTimer?.cancel();
    _detachSocketListeners();
    _messageController.dispose();
    _messageFocusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    final user = await SessionStore.instance.readUser();
    _currentUserId = user?['id']?.toString() ?? '';
    await _connectSocket();
    await _loadConversations();
  }

  Future<void> _connectSocket() async {
    try {
      final socket = await RealtimeSocket.connect('/admin-chat');
      _detachSocketListeners();
      _socket = socket;
      _attachSocketListeners(socket);

      if (socket.connected) {
        _socketReady = true;
        _restartActiveConversationSync();
        unawaited(_syncRealtimeState());
      } else {
        _socketReady = false;
        _restartActiveConversationSync();
        socket.connect();
      }
    } catch (_) {
      _socketReady = false;
      _restartActiveConversationSync();
      _scheduleSocketReconnect();
    }
  }

  void _attachSocketListeners(io.Socket socket) {
    socket.onConnect(_onSocketConnect);
    socket.onReconnect(_onSocketReconnect);
    socket.onDisconnect(_onSocketDisconnect);
    socket.onConnectError(_onSocketConnectError);
    socket.onError(_onSocketError);
    socket.on('admin-chat:ready', _onSocketReady);
    socket.on('admin-chat:message', _onSocketMessage);
    socket.on('admin-chat:conversation', _onSocketConversation);
    socket.on('admin-chat:read', _onSocketRead);
    socket.on('admin-chat:message-deleted', _onSocketMessageDeleted);
  }

  void _detachSocketListeners() {
    final socket = _socket;
    if (socket == null) return;
    socket.off('connect', _onSocketConnect);
    socket.off('reconnect', _onSocketReconnect);
    socket.off('disconnect', _onSocketDisconnect);
    socket.off('connect_error', _onSocketConnectError);
    socket.off('error', _onSocketError);
    socket.off('admin-chat:ready', _onSocketReady);
    socket.off('admin-chat:message', _onSocketMessage);
    socket.off('admin-chat:conversation', _onSocketConversation);
    socket.off('admin-chat:read', _onSocketRead);
    socket.off('admin-chat:message-deleted', _onSocketMessageDeleted);
  }

  void _onSocketConnect(dynamic _) {
    _socketReconnectTimer?.cancel();
    _socketReady = false;
    _restartActiveConversationSync();
    unawaited(_syncRealtimeState());
  }

  void _onSocketReconnect(dynamic _) {
    _socketReconnectTimer?.cancel();
    _socketReady = false;
    _restartActiveConversationSync();
    unawaited(_syncRealtimeState());
  }

  void _onSocketReady(dynamic _) {
    _socketReconnectTimer?.cancel();
    _socketReady = true;
    _restartActiveConversationSync();
    unawaited(_syncRealtimeState());
  }

  void _onSocketDisconnect(dynamic _) {
    _socketReady = false;
    _restartActiveConversationSync();
    unawaited(_syncActiveConversationNow());
    _scheduleSocketReconnect();
  }

  void _onSocketConnectError(dynamic _) {
    _socketReady = false;
    _restartActiveConversationSync();
    unawaited(_syncActiveConversationNow());
    _scheduleSocketReconnect();
  }

  void _onSocketError(dynamic _) {
    if (_socket?.connected == true) return;
    _socketReady = false;
    _restartActiveConversationSync();
    _scheduleSocketReconnect();
  }

  void _scheduleSocketReconnect() {
    if (!mounted) return;
    _socketReconnectTimer?.cancel();
    _socketReconnectTimer = Timer(const Duration(milliseconds: 150), () {
      if (!mounted) return;
      final socket = _socket;
      if (socket == null) {
        unawaited(_connectSocket());
        return;
      }
      if (!socket.connected) {
        socket.connect();
      }
    });
  }

  Future<void> _resumeRealtime() async {
    final socket = _socket;
    if (socket == null) {
      await _connectSocket();
      return;
    }

    if (!socket.connected) {
      _socketReady = false;
      _restartActiveConversationSync();
      socket.connect();
      await _syncActiveConversationNow();
      return;
    }

    _socketReady = true;
    _restartActiveConversationSync();
    await _syncRealtimeState();
  }

  Future<void> _syncRealtimeState() async {
    if (!mounted) return;

    final conversationId = _activeConversationId;
    if (conversationId.isNotEmpty) {
      await _refreshActiveMessagesQuietly(conversationId);
    }

    await _refreshConversations();
  }

  void _startActiveConversationSync() {
    _restartActiveConversationSync();
  }

  void _restartActiveConversationSync() {
    _activeConversationSyncTimer?.cancel();

    if (!mounted || _activeConversationId.isEmpty) return;

    final connected = _socketReady && _socket?.connected == true;
    final interval = connected
        ? const Duration(milliseconds: 1200)
        : const Duration(milliseconds: 350);

    _activeConversationSyncTimer = Timer(interval, () async {
      if (!mounted || _activeConversationId.isEmpty) return;
      await _syncActiveConversationNow();
      _restartActiveConversationSync();
    });
  }

  Future<void> _syncActiveConversationNow() async {
    final conversationId = _activeConversationId;
    if (!mounted || conversationId.isEmpty || _activeMessagesSyncing) return;

    await _refreshActiveMessagesQuietly(conversationId);
  }

  bool _sameMessages(
    List<Map<String, dynamic>> current,
    List<Map<String, dynamic>> incoming,
  ) {
    if (current.length != incoming.length) return false;

    for (var index = 0; index < current.length; index++) {
      final currentMessage = current[index];
      final incomingMessage = incoming[index];

      if (currentMessage['id']?.toString() !=
              incomingMessage['id']?.toString() ||
          currentMessage['content']?.toString() !=
              incomingMessage['content']?.toString() ||
          currentMessage['deletedAt']?.toString() !=
              incomingMessage['deletedAt']?.toString()) {
        return false;
      }
    }

    return true;
  }

  bool _matchesPendingMessage(
    Map<String, dynamic> optimistic,
    Map<String, dynamic> confirmed,
  ) {
    if (optimistic['conversationId']?.toString() !=
            confirmed['conversationId']?.toString() ||
        optimistic['senderId']?.toString() !=
            confirmed['senderId']?.toString() ||
        optimistic['content']?.toString() != confirmed['content']?.toString()) {
      return false;
    }

    final optimisticCreated = DateTime.tryParse(
      optimistic['createdAt']?.toString() ?? '',
    );
    final confirmedCreated = DateTime.tryParse(
      confirmed['createdAt']?.toString() ?? '',
    );

    if (optimisticCreated == null || confirmedCreated == null) return true;

    return optimisticCreated.difference(confirmedCreated).inSeconds.abs() <= 30;
  }

  List<Map<String, dynamic>> _mergeConfirmedMessage(
    List<Map<String, dynamic>> current,
    Map<String, dynamic> message,
  ) {
    final messageId = message['id']?.toString() ?? '';
    final optimisticIndex = current.indexWhere(
      (item) =>
          item['__optimistic'] == true && _matchesPendingMessage(item, message),
    );
    final confirmedIndex = current.indexWhere(
      (item) => item['id']?.toString() == messageId,
    );

    if (confirmedIndex >= 0) {
      if (optimisticIndex >= 0 && optimisticIndex != confirmedIndex) {
        final next = [...current];
        next.removeAt(optimisticIndex);
        return next;
      }
      return current;
    }

    if (optimisticIndex >= 0) {
      final next = [...current];
      next[optimisticIndex] = message;
      return next;
    }

    return [...current, message];
  }

  List<Map<String, dynamic>> _preservePendingMessages(
    List<Map<String, dynamic>> current,
    List<Map<String, dynamic>> incoming,
  ) {
    final pending = current
        .where((item) => item['__optimistic'] == true)
        .toList();

    if (pending.isEmpty) return incoming;

    final next = [...incoming];
    final matchedConfirmed = <int>{};

    for (final optimistic in pending) {
      var matchIndex = -1;
      for (var index = 0; index < incoming.length; index++) {
        if (matchedConfirmed.contains(index)) continue;
        final confirmed = incoming[index];
        if (_matchesPendingMessage(optimistic, confirmed)) {
          matchIndex = index;
          break;
        }
      }

      if (matchIndex >= 0) {
        matchedConfirmed.add(matchIndex);
      } else {
        next.add(optimistic);
      }
    }

    return next;
  }

  Future<void> _refreshActiveMessagesQuietly(String conversationId) async {
    if (_activeMessagesSyncing) return;
    _activeMessagesSyncing = true;

    try {
      final payload = await _api.getAdminConversationMessages(conversationId);
      final raw = payload['messages'];
      final incoming = raw is List
          ? raw
                .whereType<Map>()
                .map((item) => Map<String, dynamic>.from(item))
                .toList()
          : <Map<String, dynamic>>[];

      if (!mounted || _activeConversationId != conversationId) return;
      final nextMessages = _preservePendingMessages(_messages, incoming);
      if (_sameMessages(_messages, nextMessages)) return;

      setState(() => _messages = nextMessages);
      unawaited(_api.markAdminConversationRead(conversationId));
      unawaited(_refreshConversations());
      _scrollToBottom();
    } catch (_) {
    } finally {
      _activeMessagesSyncing = false;
    }
  }

  void _onSocketMessage(dynamic raw) {
    if (raw is! Map || !mounted) return;

    _socketReady = true;
    _restartActiveConversationSync();

    final message = Map<String, dynamic>.from(raw);
    final conversationId = message['conversationId']?.toString() ?? '';
    final messageId = message['id']?.toString() ?? '';

    if (conversationId.isEmpty || messageId.isEmpty) return;

    final isActive = conversationId == _activeConversationId;
    final mine = message['senderId']?.toString() == _currentUserId;

    if (isActive) {
      setState(() {
        _messages = _mergeConfirmedMessage(_messages, message);
        _applyMessageToConversation(message, read: true);
      });
      _scrollToBottom();

      if (!mine) {
        unawaited(_api.markAdminConversationRead(conversationId));
      }
      return;
    }

    final knownConversation = _conversations.any(
      (conversation) => conversation['id']?.toString() == conversationId,
    );

    if (knownConversation) {
      setState(() => _applyMessageToConversation(message, read: mine));
    } else {
      unawaited(_refreshConversations());
    }
  }

  void _applyMessageToConversation(
    Map<String, dynamic> message, {
    required bool read,
  }) {
    final conversationId = message['conversationId']?.toString() ?? '';
    if (conversationId.isEmpty) return;

    final index = _conversations.indexWhere(
      (conversation) => conversation['id']?.toString() == conversationId,
    );
    if (index < 0) return;

    final existing = _conversations[index];
    final previousUnread =
        int.tryParse(existing['unreadCount']?.toString() ?? '') ?? 0;
    final previousLastId = (existing['lastMessage'] is Map)
        ? (existing['lastMessage'] as Map)['id']?.toString() ?? ''
        : '';
    final incomingId = message['id']?.toString() ?? '';
    final mine = message['senderId']?.toString() == _currentUserId;
    final nextUnread = read || mine
        ? 0
        : previousLastId == incomingId
        ? previousUnread
        : previousUnread + 1;

    final updated = <String, dynamic>{
      ...existing,
      'lastMessage': message,
      'lastMessageAt': message['createdAt'],
      'updatedAt': message['createdAt'],
      'unreadCount': nextUnread,
    };

    _conversations = [
      updated,
      ..._conversations.where(
        (conversation) => conversation['id']?.toString() != conversationId,
      ),
    ];
  }

  void _onSocketConversation(dynamic raw) {
    final payload = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final conversationId = payload['conversationId']?.toString() ?? '';

    if (conversationId.isNotEmpty && conversationId == _activeConversationId) {
      unawaited(_refreshActiveMessagesQuietly(conversationId));
    }

    unawaited(_refreshConversations());
  }

  void _onSocketRead(dynamic _) {}

  void _onSocketMessageDeleted(dynamic raw) {
    if (raw is! Map || !mounted) return;

    final payload = Map<String, dynamic>.from(raw);
    final conversationId = payload['conversationId']?.toString() ?? '';
    final messageId = payload['messageId']?.toString() ?? '';
    final scope = payload['scope']?.toString() ?? '';
    final userId = payload['userId']?.toString() ?? '';

    if (messageId.isEmpty) return;
    if (scope != 'everyone' && userId != _currentUserId) return;

    if (conversationId == _activeConversationId) {
      setState(() {
        _messages = _messages
            .where((message) => message['id']?.toString() != messageId)
            .toList();
        if (_deletingMessageId == messageId) {
          _deletingMessageId = '';
        }
      });
    }

    unawaited(_refreshConversations());
  }

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
      } catch (_) {
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
    _startActiveConversationSync();
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

  Future<Map<String, dynamic>> _sendMessageTransport(
    String conversationId,
    String content,
  ) async {
    final socket = _socket;

    if (_socketReady && socket != null && socket.connected) {
      final completer = Completer<Map<String, dynamic>>();

      socket.emitWithAck(
        'admin-chat:send',
        {'conversationId': conversationId, 'content': content},
        ack: (dynamic raw) {
          if (completer.isCompleted) return;

          if (raw is! Map) {
            completer.completeError(
              const ApiException('Could not send the message.'),
            );
            return;
          }

          final acknowledgement = Map<String, dynamic>.from(raw);
          final rawMessage = acknowledgement['message'];

          if (acknowledgement['success'] == true && rawMessage is Map) {
            completer.complete(Map<String, dynamic>.from(rawMessage));
            return;
          }

          final message =
              acknowledgement['error']?.toString().trim().isNotEmpty == true
              ? acknowledgement['error'].toString().trim()
              : 'Could not send the message.';

          completer.completeError(ApiException(message));
        },
      );

      return completer.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () {
          throw const ApiException('Realtime message send timed out.');
        },
      );
    }

    return _api.sendAdminChatMessage(conversationId, content);
  }

  Future<void> _sendMessage() async {
    final content = _messageController.text.trim();
    final conversationId = _activeConversationId;

    if (content.isEmpty || conversationId.isEmpty) return;

    final optimisticId =
        'local-${DateTime.now().microsecondsSinceEpoch}-${_messages.length}';
    final optimisticMessage = <String, dynamic>{
      'id': optimisticId,
      'conversationId': conversationId,
      'senderId': _currentUserId,
      'content': content,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'sender': <String, dynamic>{'id': _currentUserId},
      '__optimistic': true,
    };

    _messageController.clear();
    setState(() {
      _error = '';
      _messages = [..._messages, optimisticMessage];
      _applyMessageToConversation(optimisticMessage, read: true);
    });
    _scrollToBottom();
    _messageFocusNode.requestFocus();

    try {
      final message = await _sendMessageTransport(conversationId, content);
      if (!mounted) return;

      if (_activeConversationId == conversationId) {
        setState(() {
          _messages = _mergeConfirmedMessage(_messages, message);
          _applyMessageToConversation(message, read: true);
        });
        _scrollToBottom();
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      _restoreFailedMessage(optimisticId, content);
      setState(() => _error = error.message);
      unawaited(_refreshConversations());
    } catch (_) {
      if (!mounted) return;
      _restoreFailedMessage(optimisticId, content);
      setState(() => _error = 'Could not send the message.');
      unawaited(_refreshConversations());
    }
  }

  void _restoreFailedMessage(String optimisticId, String content) {
    setState(() {
      _messages = _messages
          .where((item) => item['id']?.toString() != optimisticId)
          .toList();
    });

    final currentDraft = _messageController.text;
    final restored = currentDraft.trim().isEmpty
        ? content
        : '$content\n$currentDraft';

    _messageController.value = TextEditingValue(
      text: restored,
      selection: TextSelection.collapsed(offset: restored.length),
    );

    _messageFocusNode.requestFocus();
  }

  Future<void> _deleteMessage(
    Map<String, dynamic> message,
    String scope,
  ) async {
    final conversationId = _activeConversationId;
    final messageId = message['id']?.toString() ?? '';

    if (conversationId.isEmpty ||
        messageId.isEmpty ||
        _deletingMessageId.isNotEmpty) {
      return;
    }

    final normalizedScope = scope == 'everyone' ? 'everyone' : 'me';
    final mine = message['senderId']?.toString() == _currentUserId;

    if (normalizedScope == 'everyone' && !mine) return;

    setState(() {
      _deletingMessageId = messageId;
      _error = '';
    });

    try {
      await _api.deleteAdminChatMessage(
        conversationId,
        messageId,
        scope: normalizedScope,
      );

      if (!mounted) return;

      setState(() {
        _messages = _messages
            .where((item) => item['id']?.toString() != messageId)
            .toList();
      });

      await _refreshConversations();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not delete the message.');
      }
    } finally {
      if (mounted && _deletingMessageId == messageId) {
        setState(() => _deletingMessageId = '');
      }
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
        title: active == null ? const Text('Team chat') : null,
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
                                color: AppColors.primary,
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
    final messageId = message['id']?.toString() ?? '';
    final mine = message['senderId']?.toString() == _currentUserId;
    final deleting = messageId.isNotEmpty && _deletingMessageId == messageId;

    final senderRaw = message['sender'];
    final sender = senderRaw is Map
        ? Map<String, dynamic>.from(senderRaw)
        : <String, dynamic>{};

    final senderName = sender['fullName']?.toString() ?? 'Administrator';

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .86,
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
            if (messageId.isNotEmpty) ...[
              const SizedBox(width: 3),
              SizedBox(
                width: 30,
                height: 30,
                child: deleting
                    ? const Padding(
                        padding: EdgeInsets.all(8),
                        child: CircularProgressIndicator(
                          strokeWidth: 1.8,
                          color: AppColors.primaryDark,
                        ),
                      )
                    : PopupMenuButton<String>(
                        tooltip: 'Message options',
                        padding: EdgeInsets.zero,
                        iconSize: 18,
                        icon: const Icon(
                          Icons.more_vert_rounded,
                          color: AppColors.textMuted,
                          size: 18,
                        ),
                        onSelected: (scope) =>
                            unawaited(_deleteMessage(message, scope)),
                        itemBuilder: (context) => [
                          const PopupMenuItem<String>(
                            value: 'me',
                            height: 42,
                            child: Row(
                              children: [
                                Icon(
                                  Icons.delete_outline_rounded,
                                  size: 18,
                                  color: AppColors.textPrimary,
                                ),
                                SizedBox(width: 9),
                                Text(
                                  'Delete for me',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (mine)
                            const PopupMenuItem<String>(
                              value: 'everyone',
                              height: 42,
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.delete_forever_outlined,
                                    size: 18,
                                    color: Colors.redAccent,
                                  ),
                                  SizedBox(width: 9),
                                  Text(
                                    'Delete for everyone',
                                    style: TextStyle(
                                      color: Colors.redAccent,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
            ],
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
                focusNode: _messageFocusNode,
                minLines: 1,
                maxLines: 5,
                maxLength: 3000,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => unawaited(_sendMessage()),
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
                onPressed: _sendMessage,
                style: FilledButton.styleFrom(
                  padding: EdgeInsets.zero,
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: const Icon(Icons.send_rounded, size: 18),
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
