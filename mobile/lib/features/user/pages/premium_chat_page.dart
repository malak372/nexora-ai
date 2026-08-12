// Premium AI Chat with the same Socket.IO contract used by the web app.
// Sessions/history use REST while message submission and AI streaming are
// realtime through the backend /ai-chat namespace.
//
// Requires: flutter pub add socket_io_client
//
// @author  Malak

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/realtime_socket.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/uuid_v4.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';

class PremiumChatPage extends StatefulWidget {
  const PremiumChatPage({
    super.key,
    required this.ideaId,
    this.returnTitle = 'Idea workspace',
    this.returnSubtitle = 'Premium AI Chat',
    this.contextLabel = 'Idea workspace',
  });

  final String ideaId;

  /// The page the back arrow returns to.
  ///
  /// This keeps navigation context visible instead of showing a generic
  /// "AI Chat" title with no indication of where the user will go back.
  final String returnTitle;
  final String returnSubtitle;
  final String contextLabel;

  @override
  State<PremiumChatPage> createState() => _PremiumChatPageState();
}

class _PremiumChatPageState extends State<PremiumChatPage> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  final _draft = TextEditingController();
  final _scrollController = ScrollController();
  final SpeechToText _speech = SpeechToText();

  List<Map<String, dynamic>> _sessions = const [];
  List<Map<String, dynamic>> _messages = const [];
  String? _activeSessionId;
  String? _streamingMessageId;
  io.Socket? _socket;
  bool _loading = true;
  bool _creating = false;
  bool _sending = false;
  bool _connected = false;
  bool _speechReady = false;
  bool _listening = false;
  String _voiceBase = '';
  String _voiceHint = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSessions();
    _initSpeech();
  }

  @override
  void dispose() {
    _leaveAndDisposeSocket();
    _speech.cancel();
    _draft.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadSessions() async {
    try {
      final sessions = await UserApi.instance.getChatSessions(widget.ideaId);
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _error = null;
      });

      if (sessions.isNotEmpty) {
        final targetId = _activeSessionId != null &&
                sessions.any((item) => item['id']?.toString() == _activeSessionId)
            ? _activeSessionId!
            : sessions.first['id']?.toString();
        if (targetId != null && targetId.isNotEmpty) {
          await _openSession(targetId);
        }
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openSession(String sessionId) async {
    if (sessionId.isEmpty) return;
    setState(() {
      _activeSessionId = sessionId;
      _messages = const [];
      _error = null;
      _sending = false;
      _streamingMessageId = null;
    });

    try {
      final messages = await UserApi.instance.getChatMessages(sessionId);
      if (!mounted || _activeSessionId != sessionId) return;
      setState(() => _messages = messages);
      _scrollToBottom(jump: true);
      await _connectSocket(sessionId);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _connectSocket(String sessionId) async {
    _leaveAndDisposeSocket();
    try {
      final socket = await RealtimeSocket.connect('/ai-chat');
      if (!mounted || _activeSessionId != sessionId) {
        socket.dispose();
        return;
      }
      _socket = socket;

      socket.onConnect((_) {
        if (!mounted || _activeSessionId != sessionId) return;
        setState(() => _connected = true);
        socket.emit('chat:join-session', {'sessionId': sessionId});
      });

      socket.onDisconnect((_) {
        if (mounted) setState(() => _connected = false);
      });

      socket.onConnectError((dynamic error) {
        if (!mounted) return;
        setState(() {
          _connected = false;
          _error = 'Realtime connection was interrupted. Reconnecting…';
        });
      });

      socket.on('chat:session-joined', (dynamic payload) {
        final map = _asMap(payload);
        if (!mounted || map['sessionId']?.toString() != sessionId) return;
        setState(() {
          _connected = true;
          if (_error?.startsWith('Realtime connection') == true) _error = null;
        });
      });

      socket.on('chat:message-accepted', (dynamic payload) {
        final map = _asMap(payload);
        if (map['sessionId']?.toString() != sessionId) return;
        final userMessage = _asMap(map['userMessage']);
        final aiMessage = _asMap(map['aiMessage']);
        if (!mounted) return;
        setState(() {
          _messages = _mergeMessage(_messages, userMessage);
          _messages = _mergeMessage(_messages, aiMessage);
          _streamingMessageId = aiMessage['id']?.toString();
          _sending = true;
          _error = null;
        });
        _scrollToBottom();
      });

      socket.on('chat:message-stream-started', (dynamic payload) {
        final map = _asMap(payload);
        if (map['sessionId']?.toString() != sessionId) return;
        final message = _asMap(map['message']);
        if (!mounted) return;
        setState(() {
          _messages = _mergeMessage(_messages, message);
          _streamingMessageId = message['id']?.toString();
          _sending = true;
        });
      });

      socket.on('chat:message-chunk', (dynamic payload) {
        final map = _asMap(payload);
        if (map['sessionId']?.toString() != sessionId) return;
        final messageId = map['messageId']?.toString();
        final content = map['content']?.toString() ?? '';
        if (!mounted || messageId == null || content.isEmpty) return;

        setState(() {
          final next = _messages.map((message) {
            if (message['id']?.toString() != messageId) return message;
            return <String, dynamic>{
              ...message,
              'message': '${message['message'] ?? ''}$content',
              'status': 'STREAMING',
            };
          }).toList();
          _messages = next;
          _streamingMessageId = messageId;
          _sending = true;
        });
        _scrollToBottom();
      });

      void terminalHandler(dynamic payload) {
        final map = _asMap(payload);
        if (map['sessionId']?.toString() != sessionId) return;
        final message = _asMap(map['message']);
        if (!mounted) return;
        setState(() {
          _messages = _mergeMessage(_messages, message);
          _sending = false;
          _streamingMessageId = null;
        });
        _scrollToBottom();
        _refreshSessionTitles();
      }

      socket.on('chat:message-completed', terminalHandler);
      socket.on('chat:message-failed', terminalHandler);
      socket.on('chat:message-cancelled', terminalHandler);

      socket.on('chat:error', (dynamic payload) {
        final map = _asMap(payload);
        if (!mounted) return;
        setState(() {
          _error = map['message']?.toString() ?? 'AI Chat could not complete the request.';
          _sending = false;
        });
      });

      socket.connect();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _connected = false;
        _error = error is ApiException ? error.message : 'AI Chat could not connect.';
      });
    }
  }

  Future<void> _refreshSessionTitles() async {
    await Future<void>.delayed(const Duration(milliseconds: 1200));
    if (!mounted) return;
    try {
      final sessions = await UserApi.instance.getChatSessions(widget.ideaId);
      if (mounted) setState(() => _sessions = sessions);
    } catch (_) {
      // Session title refresh is optional and does not block chat.
    }
  }

  Future<void> _createSession() async {
    if (_creating) return;
    setState(() => _creating = true);
    try {
      final session = await UserApi.instance.createChatSession(widget.ideaId);
      final id = session['id']?.toString();
      final sessions = await UserApi.instance.getChatSessions(widget.ideaId);
      if (!mounted) return;
      setState(() => _sessions = sessions);
      if (id != null && id.isNotEmpty) await _openSession(id);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _renameSession(Map<String, dynamic> session) async {
    final id = session['id']?.toString() ?? '';
    if (id.isEmpty) return;

    final controller = TextEditingController(
      text: '${session['title'] ?? ''}'.trim(),
    );
    final title = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rename conversation'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 120,
          decoration: const InputDecoration(
            labelText: 'Conversation title',
            prefixIcon: Icon(Icons.edit_outlined),
          ),
          onSubmitted: (value) =>
              Navigator.of(dialogContext).pop(value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (title == null || title.trim().isEmpty || !mounted) return;

    try {
      final updated = await UserApi.instance.updateChatSession(
        id,
        title: title.trim(),
      );
      if (!mounted) return;
      setState(() {
        _sessions = _sessions
            .map(
              (item) => item['id']?.toString() == id
                  ? <String, dynamic>{
                      ...item,
                      ...updated,
                      'title': updated['title'] ?? title.trim(),
                    }
                  : item,
            )
            .toList();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _deleteSession(Map<String, dynamic> session) async {
    final id = session['id']?.toString() ?? '';
    if (id.isEmpty) return;

    final title = '${session['title'] ?? 'this conversation'}';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this chat?'),
        content: Text(
          '“$title” and its messages will be permanently removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      if (_activeSessionId == id) {
        _leaveAndDisposeSocket();
        setState(() {
          _activeSessionId = null;
          _messages = const [];
        });
      }
      await UserApi.instance.deleteChatSession(id);
      if (!mounted) return;
      setState(() {
        _sessions = _sessions
            .where((item) => item['id']?.toString() != id)
            .toList();
      });

      if (_sessions.isNotEmpty) {
        final nextId = _sessions.first['id']?.toString() ?? '';
        if (nextId.isNotEmpty) await _openSession(nextId);
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _initSpeech() async {
    try {
      final ready = await _speech.initialize(
        onStatus: (status) {
          if (!mounted) return;
          setState(() {
            _listening = status.toLowerCase().contains('listening');
            if (!_listening && _voiceHint.startsWith('Listening')) {
              _voiceHint = 'Tap the microphone to type with your voice';
            }
          });
        },
        onError: (error) {
          if (!mounted) return;
          final raw = error.errorMsg.toLowerCase();
          setState(() {
            _listening = false;
            _voiceHint = raw.contains('permission') || raw.contains('not-allowed')
                ? 'Allow microphone access to use voice typing.'
                : raw.contains('no-speech')
                    ? 'No speech detected — tap the microphone to try again'
                    : 'Voice typing stopped — tap the microphone to try again';
          });
        },
      );
      if (mounted) {
        setState(() {
          _speechReady = ready;
          _voiceHint = ready
              ? 'Tap the microphone to type with your voice'
              : 'Voice typing is not available on this device';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _speechReady = false;
          _voiceHint = 'Voice typing is not available on this device';
        });
      }
    }
  }

  Future<void> _toggleVoice() async {
    if (_sending || _activeSessionId == null) return;
    FocusManager.instance.primaryFocus?.unfocus();

    if (_speech.isListening || _listening) {
      await _speech.stop();
      if (mounted) {
        setState(() {
          _listening = false;
          _voiceHint = 'Tap the microphone to type with your voice';
        });
      }
      return;
    }

    if (!_speechReady) {
      await _initSpeech();
      if (!_speechReady) return;
    }

    _voiceBase = _draft.text.trimRight();
    try {
      await _speech.listen(
        onResult: _onSpeechResult,
        listenOptions: SpeechListenOptions(),
      );
      if (mounted) {
        setState(() {
          _listening = _speech.isListening;
          _voiceHint = 'Listening… your speech appears as text';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _listening = false;
          _voiceHint = 'The microphone could not start. Check permission and try again.';
        });
      }
    }
  }

  void _onSpeechResult(SpeechRecognitionResult result) {
    final spoken = result.recognizedWords.trim();
    if (spoken.isEmpty) return;

    final next = [_voiceBase, spoken]
        .where((value) => value.trim().isNotEmpty)
        .join(' ')
        .trim();

    _draft.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: next.length),
    );

    if (mounted && result.finalResult) {
      setState(() {
        _listening = false;
        _voiceHint = 'Tap the microphone to type with your voice';
      });
    }
  }

  Future<void> _sendMessage() async {
    final text = _draft.text.trim();
    if (text.isEmpty || _sending) return;

    var sessionId = _activeSessionId;
    if (sessionId == null) {
      await _createSession();
      sessionId = _activeSessionId;
    }
    if (sessionId == null) return;

    if (_socket?.connected != true) {
      await _connectSocket(sessionId);
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }

    if (_socket?.connected != true) {
      if (mounted) {
        setState(() => _error = 'Realtime connection is not ready. Try again in a moment.');
      }
      return;
    }

    _draft.clear();
    setState(() {
      _sending = true;
      _error = null;
    });

    _socket!.emit('chat:send-message', {
      'sessionId': sessionId,
      'clientRequestId': createUuidV4(),
      'message': text,
    });
  }

  void _cancelMessage() {
    final sessionId = _activeSessionId;
    final messageId = _streamingMessageId;
    if (sessionId == null || messageId == null || _socket?.connected != true) return;
    _socket!.emit('chat:cancel-message', {
      'sessionId': sessionId,
      'messageId': messageId,
    });
  }

  void _leaveAndDisposeSocket() {
    final socket = _socket;
    final sessionId = _activeSessionId;
    if (socket != null) {
      if (sessionId != null && socket.connected) {
        socket.emit('chat:leave-session', {'sessionId': sessionId});
      }
      socket.dispose();
    }
    _socket = null;
    _connected = false;
  }

  List<Map<String, dynamic>> _mergeMessage(
    List<Map<String, dynamic>> current,
    Map<String, dynamic> incoming,
  ) {
    final id = incoming['id']?.toString();
    if (id == null || id.isEmpty) return current;
    final index = current.indexWhere((message) => message['id']?.toString() == id);
    if (index < 0) return [...current, incoming];
    final next = [...current];
    next[index] = {...next[index], ...incoming};
    return next;
  }

  void _scrollToBottom({bool jump = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      final position = _scrollController.position.maxScrollExtent;
      if (jump) {
        _scrollController.jumpTo(position);
      } else {
        _scrollController.animateTo(
          position,
          duration: const Duration(milliseconds: 240),
          curve: Curves.easeOut,
        );
      }
    });
  }


  void _applyPrompt(String prompt) {
    _draft.value = TextEditingValue(
      text: prompt,
      selection: TextSelection.collapsed(offset: prompt.length),
    );

    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {});
  }




  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: Colors.transparent,
      drawerScrimColor:
          AppColors.primaryDeep.withValues(alpha: .18),
      drawer: _ChatConversationsDrawer(
        contextLabel: widget.contextLabel,
        sessions: _sessions,
        activeSessionId: _activeSessionId,
        creating: _creating,
        connected: _connected,
        onNewChat: () {
          Navigator.of(context).pop();
          Future<void>.microtask(_createSession);
        },
        onOpen: (sessionId) {
          Navigator.of(context).pop();
          Future<void>.microtask(
            () => _openSession(sessionId),
          );
        },
        onRename: (session) {
          Navigator.of(context).pop();
          Future<void>.microtask(
            () => _renameSession(session),
          );
        },
        onDelete: (session) {
          Navigator.of(context).pop();
          Future<void>.microtask(
            () => _deleteSession(session),
          );
        },
      ),
      appBar: AppBar(
        leadingWidth: 50,
        leading: IconButton(
          tooltip: 'Back to ${widget.returnTitle}',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(
            Icons.arrow_back_rounded,
            size: 22,
          ),
        ),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.returnTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              widget.returnSubtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 7.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        actions: [
          Center(
            child: _ConnectionBadge(
              connected: _connected,
            ),
          ),
          const SizedBox(width: 5),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Tooltip(
              message: 'Open conversations',
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () =>
                      _scaffoldKey.currentState?.openDrawer(),
                  borderRadius: BorderRadius.circular(12),
                  child: Ink(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.primarySoft,
                          AppColors.surfaceRose,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: AppColors.primaryDark
                            .withValues(alpha: .065),
                      ),
                    ),
                    child: const Icon(
                      Icons.menu_rounded,
                      size: 18,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: WorkspaceBackground(
        child: _loading
            ? const Center(
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.primary,
                ),
              )
            : Column(
                children: [
                  if (_error != null)
                    _ChatNotice(
                      message: _error!,
                    ),

                  Expanded(
                    child: _buildConversation(),
                  ),

                  _buildComposer(),
                ],
              ),
      ),
    );
  }

  Widget _buildConversation() {
    final noActiveConversation =
        _sessions.isEmpty || _activeSessionId == null;

    if (noActiveConversation || _messages.isEmpty) {
      return LayoutBuilder(
        builder: (context, constraints) {
          return SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(
              15,
              10,
              15,
              14,
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: math.max(
                  0,
                  constraints.maxHeight - 24,
                ),
              ),
              child: Center(
                child: _ChatWelcomeCard(
                  contextLabel: widget.contextLabel,
                  compact: !noActiveConversation,
                  onStart: noActiveConversation
                      ? (_creating ? null : _createSession)
                      : null,
                  onPrompt: _applyPrompt,
                ),
              ),
            ),
          );
        },
      );
    }

    return ListView.builder(
      controller: _scrollController,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        13,
        12,
        13,
        18,
      ),
      itemCount: _messages.length,
      itemBuilder: (context, index) {
        final message = _messages[index];
        final sender =
            '${message['sender'] ?? message['role'] ?? ''}'
                .toUpperCase();
        final isUser = sender == 'USER';
        final status =
            '${message['status'] ?? ''}'.toUpperCase();
        final text =
            '${message['message'] ?? message['content'] ?? ''}';

        final thinking = !isUser &&
            text.trim().isEmpty &&
            const {
              'PENDING',
              'STREAMING',
            }.contains(status);

        return _ChatMessageBubble(
          text: text,
          isUser: isUser,
          thinking: thinking,
          textDirection: _detectDirection(text),
        );
      },
    );
  }

  Widget _buildComposer() {
    final hasSession = _activeSessionId != null;

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          11,
          7,
          11,
          9,
        ),
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: .97),
          border: Border(
            top: BorderSide(
              color: AppColors.primaryDark
                  .withValues(alpha: .045),
            ),
          ),
          boxShadow: [
            BoxShadow(
              color:
                  AppColors.primaryDeep.withValues(alpha: .045),
              blurRadius: 17,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(
                5,
                4,
                5,
                4,
              ),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFFFCFEFD),
                    Color(0xFFF5FAF8),
                  ],
                ),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                  color: _listening
                      ? AppColors.pink.withValues(alpha: .24)
                      : AppColors.primary
                          .withValues(alpha: .11),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _draft,
                      minLines: 1,
                      maxLines: 4,
                      enabled: hasSession && !_sending,
                      textInputAction: TextInputAction.newline,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11,
                        height: 1.35,
                      ),
                      decoration: InputDecoration(
                        hintText: hasSession
                            ? 'Ask about this idea…'
                            : 'Create a conversation to start',
                        hintStyle: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.4,
                        ),
                        filled: false,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        disabledBorder: InputBorder.none,
                        contentPadding:
                            const EdgeInsets.fromLTRB(
                          9,
                          10,
                          7,
                          9,
                        ),
                      ),
                    ),
                  ),

                  _ComposerAction(
                    tooltip: _listening
                        ? 'Stop voice typing'
                        : 'Voice typing',
                    icon: _listening
                        ? Icons.stop_circle_outlined
                        : Icons.mic_none_rounded,
                    active: _listening,
                    onTap: hasSession &&
                            !_sending &&
                            _speechReady
                        ? _toggleVoice
                        : null,
                  ),

                  const SizedBox(width: 4),

                  if (_sending &&
                      _streamingMessageId != null)
                    _ComposerAction(
                      tooltip: 'Stop response',
                      icon: Icons.stop_rounded,
                      danger: true,
                      onTap: _cancelMessage,
                    )
                  else
                    _ComposerSendButton(
                      enabled: hasSession && !_sending,
                      onTap: _sendMessage,
                    ),
                ],
              ),
            ),

            if (hasSession && _voiceHint.isNotEmpty) ...[
              const SizedBox(height: 5),
              Row(
                children: [
                  Icon(
                    _listening
                        ? Icons.graphic_eq_rounded
                        : Icons.lock_outline_rounded,
                    size: 10,
                    color: _listening
                        ? AppColors.pinkDeep
                        : AppColors.textMuted,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      _listening
                          ? _voiceHint
                          : 'Private chat for this idea',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: _listening
                            ? AppColors.pinkDeep
                            : AppColors.textMuted,
                        fontSize: 6.7,
                        fontWeight: _listening
                            ? FontWeight.w800
                            : FontWeight.w600,
                      ),
                    ),
                  ),
                  if (!_listening)
                    Text(
                      _connected ? 'REALTIME' : 'CONNECTING',
                      style: TextStyle(
                        color: _connected
                            ? AppColors.success
                            : AppColors.textMuted,
                        fontSize: 5.2,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .48,
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  TextDirection _detectDirection(String text) {
    final arabic = RegExp(r'[\u0600-\u06FF]');
    return arabic.hasMatch(text) ? TextDirection.rtl : TextDirection.ltr;
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }
}









class _IdeaIntelligenceOrb extends StatelessWidget {
  const _IdeaIntelligenceOrb({
    required this.compact,
  });

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 43.0 : 49.0;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primarySoft,
              border: Border.all(
                color: AppColors.primary
                    .withValues(alpha: .10),
              ),
            ),
          ),
          Container(
            width: size * .72,
            height: size * .72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFF69C6C0),
                  Color(0xFF50AAA5),
                ],
              ),
              boxShadow: [
                BoxShadow(
                  color:
                      AppColors.primary.withValues(alpha: .12),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: const Icon(
              Icons.auto_awesome_rounded,
              color: Colors.white,
              size: 17,
            ),
          ),
          Positioned(
            top: 2,
            right: 4,
            child: Container(
              width: 7,
              height: 7,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatConversationsDrawer extends StatelessWidget {
  const _ChatConversationsDrawer({
    required this.contextLabel,
    required this.sessions,
    required this.activeSessionId,
    required this.creating,
    required this.connected,
    required this.onNewChat,
    required this.onOpen,
    required this.onRename,
    required this.onDelete,
  });

  final String contextLabel;
  final List<Map<String, dynamic>> sessions;
  final String? activeSessionId;
  final bool creating;
  final bool connected;

  final VoidCallback onNewChat;
  final ValueChanged<String> onOpen;
  final ValueChanged<Map<String, dynamic>> onRename;
  final ValueChanged<Map<String, dynamic>> onDelete;

  @override
  Widget build(BuildContext context) {
    final width =
        math.min(MediaQuery.sizeOf(context).width * .86, 360.0);

    return Drawer(
      width: width,
      elevation: 0,
      backgroundColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(
          right: Radius.circular(24),
        ),
      ),
      child: SafeArea(
        child: Container(
          margin: const EdgeInsets.fromLTRB(
            7,
            7,
            0,
            7,
          ),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFFFBFDFC),
                Color(0xFFF2F8F6),
                AppColors.surfaceRose,
              ],
              stops: [0, .68, 1],
            ),
            borderRadius: const BorderRadius.horizontal(
              right: Radius.circular(24),
            ),
            border: Border.all(
              color: Colors.white,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep
                    .withValues(alpha: .11),
                blurRadius: 28,
                offset: const Offset(8, 0),
              ),
            ],
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  13,
                  13,
                  10,
                  9,
                ),
                child: Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Color(0xFF68C5BF),
                            Color(0xFF50AAA5),
                          ],
                        ),
                        borderRadius:
                            BorderRadius.circular(13),
                      ),
                      child: const Icon(
                        Icons.forum_outlined,
                        size: 17,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'CHATS',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 6,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .7,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            contextLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 10.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: connected
                            ? const Color(0xFFEAF8F2)
                            : AppColors.primarySoft,
                        borderRadius:
                            BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: connected
                                  ? AppColors.success
                                  : AppColors.textMuted,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            connected ? 'LIVE' : 'SYNC',
                            style: TextStyle(
                              color: connected
                                  ? AppColors.success
                                  : AppColors.textMuted,
                              fontSize: 5.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close chats',
                      onPressed: () =>
                          Navigator.of(context).pop(),
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 19,
                      ),
                    ),
                  ],
                ),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(
                  11,
                  3,
                  11,
                  7,
                ),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: creating ? null : onNewChat,
                    borderRadius: BorderRadius.circular(14),
                    child: Ink(
                      height: 48,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.centerLeft,
                          end: Alignment.centerRight,
                          colors: [
                            Color(0xFFE5F5F1),
                            Color(0xFFFFF4F7),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: AppColors.primary
                              .withValues(alpha: .11),
                        ),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 31,
                            height: 31,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppColors.primary,
                              borderRadius:
                                  BorderRadius.circular(10),
                            ),
                            child: creating
                                ? const Padding(
                                    padding:
                                        EdgeInsets.all(7),
                                    child:
                                        CircularProgressIndicator(
                                      strokeWidth: 1.5,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(
                                    Icons.edit_note_rounded,
                                    size: 18,
                                    color: Colors.white,
                                  ),
                          ),
                          const SizedBox(width: 8),
                          const Expanded(
                            child: Column(
                              mainAxisAlignment:
                                  MainAxisAlignment.center,
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'New chat',
                                  style: TextStyle(
                                    color:
                                        AppColors.textPrimary,
                                    fontSize: 9.3,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                SizedBox(height: 1),
                                Text(
                                  'Start a clean conversation',
                                  style: TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 6.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Icon(
                            Icons.arrow_forward_rounded,
                            size: 13,
                            color: AppColors.primaryDark,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(
                  14,
                  7,
                  14,
                  6,
                ),
                child: Row(
                  children: [
                    const Text(
                      'RECENT CONVERSATIONS',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 5.7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .62,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,
                        borderRadius:
                            BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${sessions.length}',
                        style: const TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 5.7,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              Expanded(
                child: sessions.isEmpty
                    ? const _EmptyChatsDrawer()
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(
                          9,
                          3,
                          9,
                          16,
                        ),
                        physics:
                            const BouncingScrollPhysics(),
                        itemCount: sessions.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: 5),
                        itemBuilder: (context, index) {
                          final session = sessions[index];
                          final id =
                              session['id']?.toString() ?? '';

                          return _DrawerConversationTile(
                            title:
                                '${session['title'] ?? 'Conversation ${index + 1}'}',
                            selected:
                                id == activeSessionId,
                            onTap: () => onOpen(id),
                            onRename: () =>
                                onRename(session),
                            onDelete: () =>
                                onDelete(session),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DrawerConversationTile extends StatelessWidget {
  const _DrawerConversationTile({
    required this.title,
    required this.selected,
    required this.onTap,
    required this.onRename,
    required this.onDelete,
  });

  final String title;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: selected
            ? const LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [
                  Color(0xFFE6F5F2),
                  Color(0xFFFFF4F7),
                ],
              )
            : null,
        color: selected
            ? null
            : Colors.white.withValues(alpha: .56),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: selected
              ? AppColors.primary.withValues(alpha: .15)
              : AppColors.primaryDark
                  .withValues(alpha: .04),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onTap,
                borderRadius: BorderRadius.circular(13),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    9,
                    8,
                    4,
                    8,
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 31,
                        height: 31,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: selected
                              ? AppColors.primary
                              : AppColors.primarySoft,
                          borderRadius:
                              BorderRadius.circular(10),
                        ),
                        child: Icon(
                          selected
                              ? Icons.chat_bubble_rounded
                              : Icons.chat_bubble_outline_rounded,
                          size: 13,
                          color: selected
                              ? Colors.white
                              : AppColors.primaryDark,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 1,
                              overflow:
                                  TextOverflow.ellipsis,
                              style: const TextStyle(
                                color:
                                    AppColors.textPrimary,
                                fontSize: 8.8,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              selected
                                  ? 'CURRENT CHAT'
                                  : 'OPEN CHAT',
                              style: TextStyle(
                                color: selected
                                    ? AppColors.primaryDark
                                    : AppColors.textMuted,
                                fontSize: 5.3,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .48,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Chat options',
            padding: EdgeInsets.zero,
            iconSize: 17,
            icon: const Icon(
              Icons.more_horiz_rounded,
              color: AppColors.textMuted,
            ),
            onSelected: (value) {
              if (value == 'rename') {
                onRename();
              } else if (value == 'delete') {
                onDelete();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'rename',
                child: Row(
                  children: [
                    Icon(
                      Icons.edit_outlined,
                      size: 16,
                    ),
                    SizedBox(width: 8),
                    Text('Rename'),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'delete',
                child: Row(
                  children: [
                    Icon(
                      Icons.delete_outline_rounded,
                      size: 16,
                      color: AppColors.danger,
                    ),
                    SizedBox(width: 8),
                    Text('Delete'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptyChatsDrawer extends StatelessWidget {
  const _EmptyChatsDrawer();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 48,
              height: 48,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primarySoft,
              ),
              child: const Icon(
                Icons.chat_bubble_outline_rounded,
                size: 20,
                color: AppColors.primaryDark,
              ),
            ),
            const SizedBox(height: 9),
            const Text(
              'No conversations yet',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            const Text(
              'Start a new chat to build on this idea.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 7.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectionBadge extends StatelessWidget {
  const _ConnectionBadge({
    required this.connected,
  });

  final bool connected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: connected
            ? const Color(0xFFEAF8F2)
            : AppColors.primarySoft.withValues(alpha: .62),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: connected
              ? AppColors.success.withValues(alpha: .12)
              : AppColors.primaryDark.withValues(alpha: .06),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: connected
                  ? AppColors.success
                  : AppColors.textMuted,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            connected ? 'LIVE' : 'SYNC',
            style: TextStyle(
              color: connected
                  ? AppColors.success
                  : AppColors.textMuted,
              fontSize: 5.8,
              fontWeight: FontWeight.w900,
              letterSpacing: .58,
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatNotice extends StatelessWidget {
  const _ChatNotice({
    required this.message,
  });

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(
        14,
        5,
        14,
        3,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 8,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            AppColors.surfaceRose,
            Color(0xFFF5FAF8),
          ],
        ),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: AppColors.pink.withValues(alpha: .15),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 14,
            color: AppColors.pinkDeep,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.2,
                height: 1.35,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatWelcomeCard extends StatelessWidget {
  const _ChatWelcomeCard({
    required this.contextLabel,
    required this.onStart,
    required this.onPrompt,
    this.compact = false,
  });

  final String contextLabel;
  final VoidCallback? onStart;
  final ValueChanged<String> onPrompt;
  final bool compact;

  static const _prompts = <
      (String label, String prompt, IconData icon)>[
    (
      'Plan the next MVP step',
      'Suggest the next MVP step for this idea.',
      Icons.rocket_launch_outlined,
    ),
    (
      'Find implementation risks',
      'What are the biggest implementation risks?',
      Icons.shield_outlined,
    ),
    (
      'Improve the architecture',
      'Improve the architecture for scalability.',
      Icons.account_tree_outlined,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(
        maxWidth: 430,
      ),
      padding: EdgeInsets.fromLTRB(
        14,
        compact ? 13 : 16,
        14,
        14,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFBFDFC),
            Color(0xFFF0F8F5),
            AppColors.surfaceRose,
          ],
          stops: [0, .64, 1],
        ),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .06),
        ),
        boxShadow: [
          BoxShadow(
            color:
                AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 16,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _IdeaIntelligenceOrb(
                compact: compact,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'IDEA INTELLIGENCE',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 5.9,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .62,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      compact
                          ? 'What should we work on next?'
                          : 'Turn this idea into the next decision.',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: compact ? 13.2 : 14.5,
                        height: 1.13,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          Text(
            'Uses the context from $contextLabel. Ask about scope, architecture, risks, validation, or implementation.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.2,
              height: 1.4,
            ),
          ),

          const SizedBox(height: 10),

          const Row(
            children: [
              Icon(
                Icons.auto_awesome_rounded,
                size: 10,
                color: AppColors.primaryDark,
              ),
              SizedBox(width: 4),
              Text(
                'SUGGESTED STARTS',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 5.6,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .56,
                ),
              ),
            ],
          ),

          const SizedBox(height: 6),

          for (var i = 0; i < _prompts.length; i++) ...[
            _QuickPromptTile(
              icon: _prompts[i].$3,
              label: _prompts[i].$1,
              rose: i == 1,
              onTap: () => onPrompt(_prompts[i].$2),
            ),
            if (i != _prompts.length - 1)
              const SizedBox(height: 5),
          ],

          if (onStart != null) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onStart,
                icon: const Icon(
                  Icons.add_comment_outlined,
                  size: 14,
                ),
                label: const Text('Start a conversation'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(41),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 8.7,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}



class _QuickPromptTile extends StatelessWidget {
  const _QuickPromptTile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent =
        rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          height: 39,
          padding: const EdgeInsets.symmetric(horizontal: 9),
          decoration: BoxDecoration(
            color: rose
                ? AppColors.pinkSoft.withValues(alpha: .60)
                : AppColors.primarySoft.withValues(alpha: .58),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: accent.withValues(alpha: .05),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 27,
                height: 27,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .70),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(
                  icon,
                  size: 12.5,
                  color: accent,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Icon(
                Icons.arrow_forward_rounded,
                size: 11,
                color: accent,
              ),
            ],
          ),
        ),
      ),
    );
  }
}



class _ChatMessageBubble extends StatelessWidget {
  const _ChatMessageBubble({
    required this.text,
    required this.isUser,
    required this.thinking,
    required this.textDirection,
  });

  final String text;
  final bool isUser;
  final bool thinking;
  final TextDirection textDirection;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisAlignment: isUser
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        children: [
          if (!isUser) ...[
            Container(
              width: 27,
              height: 27,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFFE4F4F0),
                    Color(0xFFFFF2F6),
                  ],
                ),
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.primaryDark
                      .withValues(alpha: .05),
                ),
              ),
              child: const Icon(
                Icons.auto_awesome_rounded,
                size: 12,
                color: AppColors.primaryDark,
              ),
            ),
            const SizedBox(width: 6),
          ],

          Flexible(
            child: Container(
              constraints: BoxConstraints(
                maxWidth:
                    MediaQuery.sizeOf(context).width * .78,
              ),
              padding: const EdgeInsets.fromLTRB(
                11,
                9,
                11,
                9,
              ),
              decoration: BoxDecoration(
                gradient: isUser
                    ? const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(0xFF60BEB9),
                          Color(0xFF4FA9A4),
                        ],
                      )
                    : const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(0xFFFCFEFD),
                          Color(0xFFF2F8F6),
                        ],
                      ),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(
                    isUser ? 16 : 4,
                  ),
                  bottomRight: Radius.circular(
                    isUser ? 4 : 16,
                  ),
                ),
                border: isUser
                    ? null
                    : Border.all(
                        color: AppColors.primaryDark
                            .withValues(alpha: .055),
                      ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep
                        .withValues(alpha: .03),
                    blurRadius: 9,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: thinking
                  ? const _ThinkingDots()
                  : Text(
                      text,
                      textDirection: textDirection,
                      style: TextStyle(
                        color: isUser
                            ? Colors.white
                            : AppColors.textPrimary,
                        height: 1.47,
                        fontSize: 10.8,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}



class _ComposerAction extends StatelessWidget {
  const _ComposerAction({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.active = false,
    this.danger = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onTap;
  final bool active;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final accent = danger || active
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Ink(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: danger || active
                  ? AppColors.pinkSoft
                  : AppColors.primarySoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              size: 16,
              color: onTap == null
                  ? AppColors.silver
                  : accent,
            ),
          ),
        ),
      ),
    );
  }
}

class _ComposerSendButton extends StatelessWidget {
  const _ComposerSendButton({
    required this.enabled,
    required this.onTap,
  });

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            gradient: enabled
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF66C4BE),
                      Color(0xFF4FA9A4),
                    ],
                  )
                : null,
            color: enabled
                ? null
                : AppColors.primarySoft.withValues(alpha: .65),
            borderRadius: BorderRadius.circular(12),
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: .12),
                      blurRadius: 9,
                      offset: const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: Icon(
            Icons.arrow_upward_rounded,
            size: 17,
            color: enabled
                ? Colors.white
                : AppColors.silver,
          ),
        ),
      ),
    );
  }
}

class _ThinkingDots extends StatefulWidget {
  const _ThinkingDots();

  @override
  State<_ThinkingDots> createState() => _ThinkingDotsState();
}

class _ThinkingDotsState extends State<_ThinkingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final active = (_controller.value * 3).floor() % 3;
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(
            3,
            (index) => AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 6,
              height: 6,
              margin: const EdgeInsets.only(right: 4),
              decoration: BoxDecoration(
                color: index == active ? AppColors.primary : AppColors.silver,
                shape: BoxShape.circle,
              ),
            ),
          ),
        );
      },
    );
  }
}
