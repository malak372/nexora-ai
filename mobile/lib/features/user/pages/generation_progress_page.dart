// Realtime mobile generation progress for authenticated Voxidence users.
//
// The backend remains authoritative for progress and stage state. Socket.IO
// updates are combined with a periodic REST fallback, and completion is
// revealed with the same Normal/Premium celebration sequence used on web.
//
// @author Eman

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/network/realtime_socket.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import 'generation_completion_celebration.dart';
import '../widgets/user_ui.dart';
import '../widgets/workspace_navigation.dart';

class GenerationProgressPage extends StatefulWidget {
  const GenerationProgressPage({super.key, required this.runId});

  final String runId;

  @override
  State<GenerationProgressPage> createState() => _GenerationProgressPageState();
}

class _GenerationProgressPageState extends State<GenerationProgressPage> {
  static const _milestones =
      <({String title, String subtitle, IconData icon, List<String> keys})>[
        (
          title: 'Preparing request',
          subtitle:
              'Validating your request, access, domain, and selected evidence sources.',
          icon: Icons.layers_outlined,
          keys: [
            'request-validation',
            'entitlement-check',
            'domain-resolution',
            'data-source-selection',
          ],
        ),
        (
          title: 'Collecting evidence',
          subtitle:
              'Gathering and restoring relevant posts, comments, and source evidence.',
          icon: Icons.storage_rounded,
          keys: [
            'collection-job-resolution',
            'data-collection',
          ],
        ),
        (
          title: 'Understanding community needs',
          subtitle:
              'Cleaning evidence, extracting community needs, and ranking evidence-backed opportunities.',
          icon: Icons.psychology_alt_outlined,
          keys: [
            'nlp-analysis',
            'community-ai-analysis',
            'opportunity-ranking',
          ],
        ),
        (
          title: 'Creating the idea',
          subtitle:
              'Building the grounded prompt and generating the strongest solution candidates.',
          icon: Icons.auto_awesome_rounded,
          keys: [
            'prompt-building',
            'core-idea-generation',
          ],
        ),
        (
          title: 'Checking quality and originality',
          subtitle:
              'Checking structure, evidence coverage, originality, duplication, and solution quality.',
          icon: Icons.fact_check_outlined,
          keys: [
            'ai-output-validation',
            'duplicate-check',
          ],
        ),
        (
          title: 'Saving workspace',
          subtitle:
              'Saving the approved idea and preparing its final workspace.',
          icon: Icons.task_alt_rounded,
          keys: [
            'idea-persistence',
            'full-abstract-generation',
            'technology-stack-generation',
            'system-architecture-generation',
            'database-design-generation',
            'mvp-features-generation',
            'value-proposition-generation',
            'revenue-model-generation',
            'local-regulations-generation',
            'budget-estimation-generation',
            'feasibility-assessment-generation',
            'implementation-timeline-generation',
            'market-potential-generation',
            'nlp-executive-summary-generation',
            'community-feedback-summary-generation',
            'advanced-output-generation',
            'advanced-output-persistence',
            'finalization',
          ],
        ),
      ];

  static const Map<String, int> _stageOrder = <String, int>{
    'request-validation': 1,
    'entitlement-check': 2,
    'domain-resolution': 3,
    'data-source-selection': 4,
    'collection-job-resolution': 5,
    'data-collection': 6,
    'nlp-analysis': 7,
    'community-ai-analysis': 8,
    'opportunity-ranking': 9,
    'prompt-building': 10,
    'core-idea-generation': 11,
    'ai-output-validation': 12,
    'duplicate-check': 13,
    'idea-persistence': 14,
    'full-abstract-generation': 15,
    'technology-stack-generation': 16,
    'system-architecture-generation': 17,
    'database-design-generation': 18,
    'mvp-features-generation': 19,
    'value-proposition-generation': 20,
    'revenue-model-generation': 21,
    'local-regulations-generation': 22,
    'budget-estimation-generation': 23,
    'feasibility-assessment-generation': 24,
    'implementation-timeline-generation': 25,
    'market-potential-generation': 26,
    'nlp-executive-summary-generation': 27,
    'community-feedback-summary-generation': 28,
    'advanced-output-generation': 29,
    'advanced-output-persistence': 30,
    'finalization': 99,
  };

  Timer? _fallbackTimer;
  Timer? _elapsedTimer;
  io.Socket? _socket;
  Map<String, dynamic>? _run;
  Object? _error;
  String? _stageDisplayName;
  bool _cancelling = false;
  bool _cancelRequested = false;
  bool _realtimeConnected = false;
  bool _socketProven = false;
  bool _refreshInFlight = false;
  bool _terminalRefreshDone = false;
  bool _completionQueued = false;
  bool _cancelInitiatedHere = false;
  bool _cancellationDialogQueued = false;
  int _elapsedSeconds = 0;

  @override
  void initState() {
    super.initState();
    // Socket.IO is the primary live channel. The initial REST read is only a
    // silent reconciliation safety net, so a temporary HTTP timeout never
    // replaces the live progress screen with an error state.
    unawaited(_refresh(silent: true));
    unawaited(_connectRealtime());
    _scheduleReconciliation(after: const Duration(milliseconds: 900));

    _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _isTerminal(_status)) return;
      setState(() => _elapsedSeconds += 1);
    });
  }

  @override
  void dispose() {
    _fallbackTimer?.cancel();
    _elapsedTimer?.cancel();

    final socket = _socket;
    if (socket != null) {
      if (socket.connected) {
        socket.emit('idea-generation.leave', {'runId': widget.runId});
      }
      socket.dispose();
    }

    super.dispose();
  }

  String get _status => '${_run?['status'] ?? 'QUEUED'}'.toUpperCase();

  void _scheduleReconciliation({Duration? after}) {
    _fallbackTimer?.cancel();

    if (!mounted || _isTerminal(_status)) return;

    final delay =
        after ??
        (_socketProven
            ? const Duration(seconds: 8)
            : const Duration(milliseconds: 900));

    _fallbackTimer = Timer(delay, () async {
      await _refresh(silent: true);

      if (mounted && !_isTerminal(_status)) {
        _scheduleReconciliation();
      }
    });
  }

  void _markRealtimeEvent() {
    if (!mounted) return;

    final needsUpdate = !_socketProven || !_realtimeConnected;
    _socketProven = true;

    if (needsUpdate) {
      setState(() => _realtimeConnected = true);
    }

    _scheduleReconciliation(after: const Duration(seconds: 8));
  }

  Future<void> _connectRealtime() async {
    try {
      final socket = await RealtimeSocket.connect('/idea-generation');

      if (!mounted) {
        socket.dispose();
        return;
      }

      _socket = socket;

      socket.onConnect((_) {
        if (!mounted) return;

        // A TCP/WebSocket connection alone is not enough to call the UI live.
        // We mark the channel live only after the room snapshot or another
        // generation event proves that the backend subscription is working.
        _socketProven = false;
        setState(() => _realtimeConnected = false);

        socket.emitWithAck(
          'idea-generation.join',
          {'runId': widget.runId},
          ack: (dynamic acknowledgement) {
            if (!mounted) return;

            final ack = _asMap(acknowledgement);
            if (ack['success'] == true) {
              _markRealtimeEvent();

              // Pull once after the room acknowledgement. The gateway also
              // emits an authoritative snapshot, but this protects the first
              // render if that packet races the listener on a reconnect.
              unawaited(_refresh(silent: true));
              return;
            }

            _socketProven = false;
            setState(() => _realtimeConnected = false);
            _scheduleReconciliation(
              after: const Duration(milliseconds: 900),
            );
          },
        );

        _scheduleReconciliation(
          after: const Duration(milliseconds: 900),
        );
      });

      socket.onDisconnect((_) {
        if (!mounted) return;
        _socketProven = false;
        setState(() => _realtimeConnected = false);
        _scheduleReconciliation(after: const Duration(milliseconds: 900));
      });

      socket.onConnectError((_) {
        if (!mounted) return;
        _socketProven = false;
        setState(() => _realtimeConnected = false);
        _scheduleReconciliation(after: const Duration(milliseconds: 900));
      });

      socket.on('idea-generation.snapshot', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId) return;

        _markRealtimeEvent();
        _applyRunUpdate(map);
      });

      socket.on('idea-generation.run.updated', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId) return;

        _markRealtimeEvent();
        _applyRunUpdate(map);
      });

      socket.on('idea-generation.stage.updated', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId || !mounted) return;

        _markRealtimeEvent();
        _applyStageUpdate(map);
      });

      socket.connect();
    } catch (_) {
      if (!mounted) return;
      _socketProven = false;
      setState(() => _realtimeConnected = false);
      _scheduleReconciliation(after: const Duration(milliseconds: 900));
    }
  }

  Future<void> _refresh({bool silent = false}) async {
    if (_refreshInFlight) return;

    _refreshInFlight = true;

    try {
      final run = await UserApi.instance.getGenerationRun(widget.runId);

      if (!mounted) return;

      final merged = _mergeRunSnapshot(_run, run);

      setState(() {
        _run = merged;
        _error = null;
        _stageDisplayName = _stageDisplayFromRun(merged);
        _elapsedSeconds = _elapsedFromRun(merged);
        _cancelRequested =
            _cancelRequested || merged['cancelRequestedAt'] != null;
      });

      await _handleTerminal(merged);
    } catch (error) {
      if (!mounted || silent) return;
      setState(() => _error = error);
    } finally {
      _refreshInFlight = false;
    }
  }

  void _applyRunUpdate(Map<String, dynamic> incoming) {
    if (!mounted) return;

    final next = _mergeRunSnapshot(_run, incoming);

    setState(() {
      _run = next;
      _error = null;
      _stageDisplayName = _stageDisplayFromRun(next);
      _elapsedSeconds = _elapsedFromRun(next);
      _cancelRequested =
          _cancelRequested || next['cancelRequestedAt'] != null;
    });

    unawaited(_handleTerminal(next));
  }

  void _applyStageUpdate(Map<String, dynamic> incoming) {
    if (!mounted) return;

    final current = Map<String, dynamic>.from(
      _run ??
          <String, dynamic>{
            'id': widget.runId,
            'runId': widget.runId,
            'status': 'QUEUED',
            'progressPercent': 0,
            'currentStageKey': null,
            'stages': <Map<String, dynamic>>[],
          },
    );

    final incomingStatus = '${incoming['status'] ?? ''}'.toUpperCase();
    final stageKey = '${incoming['stageKey'] ?? incoming['key'] ?? ''}'.trim();

    final nextProgress = _maxNumber(
      current['progressPercent'],
      incoming['progressPercent'],
    );

    final nextStage = const {
      'RUNNING',
      'COMPLETED',
      'SUCCEEDED',
      'SKIPPED',
    }.contains(incomingStatus)
        ? _resolveForwardStage(current['currentStageKey']?.toString(), stageKey)
        : current['currentStageKey']?.toString();

    final stages = _mergeStages(
      _asStageList(current['stages']),
      <Map<String, dynamic>>[incoming],
    );

    setState(() {
      _stageDisplayName = incoming['displayName']?.toString();
      current['status'] =
          '${current['status'] ?? 'QUEUED'}'.toUpperCase() == 'QUEUED' &&
              incomingStatus == 'RUNNING'
          ? 'RUNNING'
          : current['status'] ?? 'RUNNING';
      current['progressPercent'] = nextProgress;
      current['currentStageKey'] = nextStage;
      current['stages'] = stages;

      if ((current['startedAt'] == null ||
              '${current['startedAt']}'.trim().isEmpty) &&
          incomingStatus == 'RUNNING') {
        current['startedAt'] = incoming['startedAt'];
      }

      _run = current;
      _error = null;
    });
  }

  Map<String, dynamic> _mergeRunSnapshot(
    Map<String, dynamic>? current,
    Map<String, dynamic> incoming,
  ) {
    if (current == null || current.isEmpty) {
      final initial = Map<String, dynamic>.from(incoming);
      initial['id'] = incoming['id'] ?? incoming['runId'] ?? widget.runId;
      initial['runId'] = incoming['runId'] ?? incoming['id'] ?? widget.runId;
      initial['stages'] = _asStageList(incoming['stages']);
      initial['currentStageKey'] = _resolveForwardStage(
        incoming['currentStageKey']?.toString(),
        _furthestStageKey(initial['stages']),
      );
      return initial;
    }

    final incomingTimestamp = _timestamp(incoming['updatedAt']);
    final currentTimestamp = _timestamp(current['updatedAt']);
    final incomingIsNewer =
        incomingTimestamp == 0 ||
        currentTimestamp == 0 ||
        incomingTimestamp >= currentTimestamp;

    /*
     * Do not reject an entire snapshot because the parent run's updatedAt is
     * older than an optimistic run event. Stage rows can be newer even when the
     * run row intentionally is not persisted at every tiny boundary. Rejecting
     * the whole payload was the main reason the mobile timeline could appear
     * stuck while the backend had already advanced.
     */
    final merged = Map<String, dynamic>.from(current);

    if (incomingIsNewer) {
      merged.addAll(incoming);
    } else {
      // Preserve newer parent-run fields while still accepting durable fields
      // that only arrive after completion/persistence.
      for (final key in <String>[
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
        final value = incoming[key];
        if (value != null) {
          merged[key] = value;
        }
      }
    }

    merged['id'] = incoming['id'] ??
        incoming['runId'] ??
        current['id'] ??
        current['runId'] ??
        widget.runId;

    merged['runId'] = incoming['runId'] ??
        incoming['id'] ??
        current['runId'] ??
        current['id'] ??
        widget.runId;

    merged['ideaId'] = incoming['ideaId'] ?? current['ideaId'];
    merged['startedAt'] = incoming['startedAt'] ?? current['startedAt'];
    merged['completedAt'] = incoming['completedAt'] ?? current['completedAt'];
    merged['cancelRequestedAt'] =
        incoming['cancelRequestedAt'] ?? current['cancelRequestedAt'];

    final incomingStages = _asStageList(incoming['stages']);
    final mergedStages = _mergeStages(
      _asStageList(current['stages']),
      incomingStages,
    );

    // Stage snapshots are merged independently from the parent run timestamp.
    merged['stages'] = mergedStages;
    merged['progressPercent'] = _maxNumber(
      current['progressPercent'],
      incoming['progressPercent'],
    );

    merged['currentStageKey'] = _resolveForwardStage(
      current['currentStageKey']?.toString(),
      _resolveForwardStage(
        incoming['currentStageKey']?.toString(),
        _furthestStageKey(incomingStages),
      ),
    );

    final currentStatus = '${current['status'] ?? 'QUEUED'}'.toUpperCase();
    final incomingStatus = '${incoming['status'] ?? ''}'.toUpperCase();
    final resumedFromRetry =
        currentStatus == 'RETRYING' && incomingStatus == 'RUNNING';

    if (resumedFromRetry ||
        _statusRank(incomingStatus) >= _statusRank(currentStatus)) {
      merged['status'] =
          incomingStatus.isEmpty ? currentStatus : incomingStatus;
    } else {
      merged['status'] = currentStatus;
    }

    if (incomingTimestamp >= currentTimestamp && incoming['updatedAt'] != null) {
      merged['updatedAt'] = incoming['updatedAt'];
    } else {
      merged['updatedAt'] = current['updatedAt'];
    }

    return merged;
  }

  int _statusRank(String status) {
    return switch (status.trim().toUpperCase()) {
      'QUEUED' => 0,
      'RUNNING' => 1,
      'RETRYING' => 2,
      'NO_RESULT' => 3,
      'FAILED' => 4,
      'CANCELLED' => 4,
      'COMPLETED' => 5,
      _ => -1,
    };
  }

  String? _stageDisplayFromRun(Map<String, dynamic> run) {
    final currentKey = '${run['currentStageKey'] ?? ''}'.trim();
    if (currentKey.isEmpty) return null;

    for (final stage in _asStageList(run['stages'])) {
      final key = '${stage['stageKey'] ?? stage['key'] ?? ''}'.trim();
      if (key != currentKey) continue;

      final displayName = '${stage['displayName'] ?? ''}'.trim();
      if (displayName.isNotEmpty) return displayName;
    }

    return null;
  }

  int _stageStatusRank(String status) {
    return switch (status.trim().toUpperCase()) {
      'PENDING' => 0,
      'RUNNING' => 1,
      'SKIPPED' => 2,
      'COMPLETED' => 3,
      'SUCCEEDED' => 3,
      'FAILED' => 4,
      _ => -1,
    };
  }

  List<Map<String, dynamic>> _mergeStages(
    List<Map<String, dynamic>> current,
    List<Map<String, dynamic>> incoming,
  ) {
    final merged = <Map<String, dynamic>>[
      ...current.map(Map<String, dynamic>.from),
    ];

    for (final stage in incoming) {
      final key = '${stage['stageKey'] ?? stage['key'] ?? ''}'.trim();
      if (key.isEmpty) continue;

      final index = merged.indexWhere(
        (item) => '${item['stageKey'] ?? item['key'] ?? ''}'.trim() == key,
      );

      if (index < 0) {
        merged.add(Map<String, dynamic>.from(stage));
        continue;
      }

      final existing = merged[index];
      final incomingTimestamp = _timestamp(stage['updatedAt']);
      final currentTimestamp = _timestamp(existing['updatedAt']);
      final incomingStatus = '${stage['status'] ?? ''}'.toUpperCase();
      final existingStatus = '${existing['status'] ?? ''}'.toUpperCase();
      final incomingRank = _stageStatusRank(incomingStatus);
      final existingRank = _stageStatusRank(existingStatus);

      /*
       * Lifecycle direction is more authoritative than wall-clock ordering.
       * This protects RUNNING -> COMPLETED when the API process and remote
       * database clocks differ slightly.
       */
      if (incomingRank < existingRank) {
        continue;
      }

      if (incomingRank == existingRank &&
          incomingTimestamp > 0 &&
          currentTimestamp > 0 &&
          currentTimestamp > incomingTimestamp) {
        continue;
      }

      merged[index] = Map<String, dynamic>.from(existing)..addAll(stage);
    }

    merged.sort(
      (a, b) => _stageSequence(a).compareTo(_stageSequence(b)),
    );

    return merged;
  }

  List<Map<String, dynamic>> _asStageList(dynamic value) {
    if (value is! List) return <Map<String, dynamic>>[];

    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  int _stageSequence(Map<String, dynamic> stage) {
    final sequence = stage['sequence'];
    if (sequence is num) return sequence.toInt();

    final key = '${stage['stageKey'] ?? stage['key'] ?? ''}'.trim();
    return _stageOrder[key] ?? 0;
  }

  String? _furthestStageKey(dynamic stagesRaw) {
    final stages = _asStageList(stagesRaw);
    String? resolved;

    for (final stage in stages) {
      final status = '${stage['status'] ?? ''}'.toUpperCase();
      if (!const {
        'RUNNING',
        'COMPLETED',
        'SUCCEEDED',
        'SKIPPED',
      }.contains(status)) {
        continue;
      }

      final key = '${stage['stageKey'] ?? stage['key'] ?? ''}'.trim();
      resolved = _resolveForwardStage(resolved, key);
    }

    return resolved;
  }

  String? _resolveForwardStage(String? currentKey, String? incomingKey) {
    final current = (currentKey ?? '').trim();
    final incoming = (incomingKey ?? '').trim();

    if (incoming.isEmpty) return current.isEmpty ? null : current;
    if (current.isEmpty) return incoming;

    final currentSequence = _stageOrder[current] ?? 0;
    final incomingSequence = _stageOrder[incoming] ?? 0;

    return incomingSequence >= currentSequence ? incoming : current;
  }

  double _maxNumber(dynamic first, dynamic second) {
    final a = first is num ? first.toDouble() : double.tryParse('$first') ?? 0;
    final b =
        second is num ? second.toDouble() : double.tryParse('$second') ?? 0;

    return a >= b ? a : b;
  }

  int _timestamp(dynamic value) {
    final raw = '${value ?? ''}'.trim();
    if (raw.isEmpty) return 0;
    return DateTime.tryParse(raw)?.millisecondsSinceEpoch ?? 0;
  }

  Future<void> _handleTerminal(Map<String, dynamic> run) async {
    final status = '${run['status'] ?? ''}'.toUpperCase();
    if (!_isTerminal(status)) return;

    _fallbackTimer?.cancel();
    _elapsedTimer?.cancel();

    if (!_terminalRefreshDone) {
      _terminalRefreshDone = true;
      await UserSessionController.instance.load(force: true);
    }

    if (status == 'COMPLETED') {
      await _queueCompletionCelebration(run);
      return;
    }

    if (status == 'CANCELLED' && _cancelInitiatedHere) {
      await _queueCancellationSuccessDialog();
    }
  }

  Future<void> _queueCancellationSuccessDialog() async {
    if (_cancellationDialogQueued) return;
    _cancellationDialogQueued = true;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        useRootNavigator: true,
        builder: (dialogContext) => SafeArea(
          child: Center(
            child: Dialog(
              backgroundColor: Colors.transparent,
              insetPadding: const EdgeInsets.symmetric(horizontal: 24),
              child: Container(
                padding: const EdgeInsets.fromLTRB(22, 24, 22, 20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: Colors.white),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: .16),
                      blurRadius: 40,
                      offset: const Offset(0, 16),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 62,
                      height: 62,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppColors.primarySoft,
                            AppColors.surfaceRose.withValues(alpha: .72),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Icon(
                        Icons.check_circle_outline_rounded,
                        size: 31,
                        color: AppColors.primaryDeep,
                      ),
                    ),
                    const SizedBox(height: 15),
                    const Text(
                      'Cancellation completed',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.35,
                      ),
                    ),
                    const SizedBox(height: 7),
                    const Text(
                      'The active generation run was stopped safely. You can return to Generate Idea and start a new run whenever you are ready.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.5,
                        height: 1.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 19),
                    FilledButton.icon(
                      onPressed: () {
                        Navigator.of(dialogContext).pop();
                        if (!mounted) return;
                        Navigator.of(context).pushNamedAndRemoveUntil(
                          '/normal/generate',
                          (route) => route.isFirst,
                        );
                      },
                      icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                      label: const Text('Back to Generate Idea'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    });
  }

  Future<void> _queueCompletionCelebration(Map<String, dynamic> run) async {
    if (_completionQueued) return;

    final ideaId = _ideaId(run);
    if (ideaId.isEmpty) return;
    _completionQueued = true;

    var title = _ideaTitleFromRun(run);
    if (title.isEmpty) {
      try {
        final idea = await UserApi.instance.getIdeaDetails(ideaId, force: true);
        title = '${idea['title'] ?? ''}'.trim();
      } catch (_) {
        // The celebration can still use the standard title if details lag.
      }
    }

    if (!mounted) return;
    final isPremium = _isPremiumGeneration(run);
    final resolvedTitle = title.isEmpty ? 'Your new Voxidence idea' : title;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final openIdea = await showGenerationCompletionCelebration(
        context,
        isPremium: isPremium,
        ideaTitle: resolvedTitle,
      );
      if (!mounted || openIdea != true) return;
      Navigator.of(context).pushReplacementNamed('/normal/ideas/$ideaId');
    });
  }

  bool _isPremiumGeneration(Map<String, dynamic> run) {
    final generationType = '${run['generationType'] ?? run['type'] ?? ''}'
        .trim()
        .toUpperCase();
    if (generationType.contains('PREMIUM')) return true;

    final metadata = _asMap(run['metadata']);
    if (metadata['premiumOutputsEnabled'] == true ||
        metadata['includePremiumOutputs'] == true) {
      return true;
    }

    return UserSessionController.instance.summary?.isPremium == true;
  }

  String _ideaId(Map<String, dynamic> run) {
    final direct = '${run['ideaId'] ?? ''}'.trim();
    if (direct.isNotEmpty) return direct;
    final idea = _asMap(run['idea']);
    return '${idea['id'] ?? idea['ideaId'] ?? ''}'.trim();
  }

  String _ideaTitleFromRun(Map<String, dynamic> run) {
    final direct = '${run['ideaTitle'] ?? ''}'.trim();
    if (direct.isNotEmpty) return direct;
    final idea = _asMap(run['idea']);
    return '${idea['title'] ?? ''}'.trim();
  }

  int _elapsedFromRun(Map<String, dynamic> run) {
    final raw = '${run['startedAt'] ?? run['createdAt'] ?? ''}'.trim();
    final startedAt = DateTime.tryParse(raw)?.toLocal();
    if (startedAt == null) return _elapsedSeconds;
    final seconds = DateTime.now().difference(startedAt).inSeconds;
    return seconds < 0 ? 0 : seconds;
  }

  bool _isTerminal(String status) =>
      const {'COMPLETED', 'FAILED', 'CANCELLED', 'NO_RESULT'}.contains(status);

  Future<void> _pollCancellationUntilTerminal() async {
    for (var attempt = 0; attempt < 60; attempt += 1) {
      if (!mounted || _isTerminal(_status)) return;

      await _refresh(silent: true);
      if (!mounted || _isTerminal(_status)) return;

      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
  }

  Future<void> _cancel() async {
    if (_cancelling || _cancelRequested || _isTerminal(_status)) return;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Container(
          margin: const EdgeInsets.all(12),
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: Colors.white),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .14),
                blurRadius: 38,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(height: 18),
              const SoftIconBadge(
                icon: Icons.stop_circle_outlined,
                size: 50,
                rose: true,
              ),
              const SizedBox(height: 13),
              const Text(
                'Cancel this generation?',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Active AI and collection work will be interrupted where supported. Anything already saved remains protected.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10.3,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(sheetContext).pop(false),
                      child: const Text('Keep running'),
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.of(sheetContext).pop(true),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.danger,
                      ),
                      child: const Text('Cancel run'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    if (confirmed != true || !mounted) return;

    _cancelInitiatedHere = true;
    setState(() {
      _cancelling = true;
      _cancelRequested = true;
    });
    try {
      await UserApi.instance.cancelGeneration(widget.runId);
      await _pollCancellationUntilTerminal();
      _scheduleReconciliation(after: const Duration(milliseconds: 400));
    } catch (error) {
      if (mounted) {
        final backendAlreadyAccepted = _run?['cancelRequestedAt'] != null;
        if (!backendAlreadyAccepted) _cancelInitiatedHere = false;
        setState(() {
          _error = error;
          _cancelRequested = backendAlreadyAccepted;
        });
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final run = _run;
    final status = _status;
    final progress = ((run?['progressPercent'] as num?)?.toDouble() ?? 0)
        .clamp(0.0, 100.0)
        .toDouble();

    final completed = status == 'COMPLETED';
    final failed = status == 'FAILED';
    final cancelled = status == 'CANCELLED';
    final stage = _cancelRequested && !completed && !failed && !cancelled
        ? 'Cancelling generation...'
        : (_stageDisplayName ??
            _stageLabel(run?['currentStageKey']?.toString()));

    final currentIndex = _milestoneIndex(
      run?['currentStageKey']?.toString(),
      progress,
    );

    final completedCount = completed ? _milestones.length : currentIndex;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _ProgressTopBar(
                realtimeConnected: _realtimeConnected,
                onBack: () => Navigator.of(context).maybePop(),
                onRefresh: _refresh,
              ),
              Expanded(
                child: ListView(
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(14, 5, 14, 34),
                  children: [
                    _ProgressHero(
                      progress: completed ? 100 : progress,
                      stage: stage,
                      elapsedSeconds: _elapsedSeconds,
                      completed: completed,
                      failed: failed,
                      cancelled: cancelled,
                      realtimeConnected: _realtimeConnected,
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.fromLTRB(15, 15, 15, 13),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(25),
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Colors.white.withValues(alpha: .96),
                            AppColors.surface.withValues(alpha: .92),
                            AppColors.primarySoft.withValues(alpha: .34),
                          ],
                        ),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: .96),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDeep.withValues(alpha: .055),
                            blurRadius: 25,
                            offset: const Offset(0, 9),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 42,
                                height: 42,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: AppColors.primarySoft,
                                  borderRadius: BorderRadius.circular(14),
                                ),
                                child: const Icon(
                                  Icons.account_tree_outlined,
                                  size: 19,
                                  color: AppColors.primaryDark,
                                ),
                              ),
                              const SizedBox(width: 10),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'LIVE INTELLIGENCE PIPELINE',
                                      style: TextStyle(
                                        color: AppColors.primaryDark,
                                        fontSize: 7.5,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: .92,
                                      ),
                                    ),
                                    SizedBox(height: 3),
                                    Text(
                                      'What Voxidence is doing now',
                                      style: TextStyle(
                                        color: AppColors.textPrimary,
                                        fontSize: 14.5,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: -.22,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 9,
                                  vertical: 6,
                                ),
                                decoration: BoxDecoration(
                                  color: completed
                                      ? AppColors.primarySoft
                                      : Colors.white,
                                  borderRadius: BorderRadius.circular(99),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Text(
                                  '$completedCount/${_milestones.length}',
                                  style: const TextStyle(
                                    color: AppColors.primaryDeep,
                                    fontSize: 8.6,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          ...List.generate(_milestones.length, (index) {
                            final isDone = completed || index < currentIndex;
                            final isCurrent =
                                !completed &&
                                !failed &&
                                !cancelled &&
                                index == currentIndex;

                            return _PipelineMilestone(
                              index: index,
                              milestone: _milestones[index],
                              done: isDone,
                              current: isCurrent,
                              last: index == _milestones.length - 1,
                            );
                          }),
                          const SizedBox(height: 7),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(99),
                            child: LinearProgressIndicator(
                              value: (completed ? 100 : progress) / 100,
                              minHeight: 6,
                              backgroundColor: AppColors.border,
                              color: failed || cancelled
                                  ? AppColors.pink
                                  : AppColors.primary,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 11),
                    if (!completed && !failed && !cancelled)
                      Container(
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              AppColors.primarySoft.withValues(alpha: .68),
                              AppColors.surfaceRose.withValues(alpha: .44),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(17),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.shield_outlined,
                              size: 16,
                              color: AppColors.primaryDark,
                            ),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'You can leave this page. The generation run continues safely on the server and can be recovered from My Ideas.',
                                style: TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 8.9,
                                  height: 1.38,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    if (_error != null) ...[
                      const SizedBox(height: 10),
                      InlineNotice(
                        icon: Icons.wifi_off_rounded,
                        message:
                            'Connection was interrupted. Your run is safe — refresh to recover the latest backend state.',
                        error: true,
                      ),
                    ],
                    const SizedBox(height: 12),
                    if (!completed && !failed && !cancelled)
                      OutlinedButton.icon(
                        onPressed: _cancelling || _cancelRequested ? null : _cancel,
                        icon: _cancelling || _cancelRequested
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(
                                Icons.stop_circle_outlined,
                                size: 18,
                              ),
                        label: Text(
                          _cancelling || _cancelRequested
                              ? 'Cancelling generation...'
                              : 'Cancel generation',
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(47),
                          foregroundColor: AppColors.danger,
                          side: BorderSide(
                            color: AppColors.pink.withValues(alpha: .38),
                          ),
                          backgroundColor:
                              AppColors.surfaceRose.withValues(alpha: .42),
                        ),
                      )
                    else if (failed || cancelled)
                      FilledButton.icon(
                        onPressed: () => Navigator.of(context).maybePop(),
                        icon: const Icon(Icons.arrow_back_rounded, size: 18),
                        label: const Text('Back to generate'),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  int _milestoneIndex(String? stageKey, num progress) {
    final normalized = (stageKey ?? '').trim().toLowerCase().replaceAll(
      '_',
      '-',
    );
    if (normalized.isNotEmpty) {
      for (var i = 0; i < _milestones.length; i += 1) {
        if (_milestones[i].keys.any((key) => normalized.contains(key))) {
          return i;
        }
      }
    }
    if (progress >= 95) return 5;
    if (progress >= 78) return 4;
    if (progress >= 58) return 3;
    if (progress >= 32) return 2;
    if (progress >= 12) return 1;
    return 0;
  }

  String _stageLabel(String? stage) {
    if (stage == null || stage.trim().isEmpty) {
      return 'Preparing the next pipeline step...';
    }
    final clean = stage.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase();
    if (clean.isEmpty) return 'Working on your idea...';
    return '${clean[0].toUpperCase()}${clean.substring(1)}';
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }
}

class _ProgressTopBar extends StatelessWidget {
  const _ProgressTopBar({
    required this.realtimeConnected,
    required this.onBack,
    required this.onRefresh,
  });

  final bool realtimeConnected;
  final VoidCallback onBack;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 7, 14, 8),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .92),
        border: Border(
          bottom: BorderSide(
            color: AppColors.border.withValues(alpha: .72),
          ),
        ),
      ),
      child: Row(
        children: [
          WorkspaceBackButton(onPressed: onBack),
          const SizedBox(width: 9),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Generation progress',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 16.2,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.3,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Evidence-led intelligence pipeline',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: realtimeConnected
                  ? AppColors.primarySoft
                  : AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(99),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  realtimeConnected
                      ? Icons.radio_button_checked
                      : Icons.sync_rounded,
                  size: 11,
                  color: realtimeConnected
                      ? AppColors.success
                      : AppColors.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  realtimeConnected ? 'LIVE' : 'SYNC',
                  style: TextStyle(
                    color: realtimeConnected
                        ? AppColors.primaryDeep
                        : AppColors.textMuted,
                    fontSize: 7.2,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .45,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Material(
            color: Colors.white.withValues(alpha: .88),
            borderRadius: BorderRadius.circular(13),
            child: InkWell(
              onTap: onRefresh,
              borderRadius: BorderRadius.circular(13),
              child: Container(
                width: 37,
                height: 37,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.refresh_rounded,
                  color: AppColors.primaryDeep,
                  size: 18,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressHero extends StatelessWidget {
  const _ProgressHero({
    required this.progress,
    required this.stage,
    required this.elapsedSeconds,
    required this.completed,
    required this.failed,
    required this.cancelled,
    required this.realtimeConnected,
  });

  final double progress;
  final String stage;
  final int elapsedSeconds;
  final bool completed;
  final bool failed;
  final bool cancelled;
  final bool realtimeConnected;

  @override
  Widget build(BuildContext context) {
    final terminalProblem = failed || cancelled;

    final title = completed
        ? 'Your idea is ready.'
        : failed
            ? 'Generation stopped.'
            : cancelled
                ? 'Generation cancelled.'
                : progress < 24
                    ? 'Discovery is opening up.'
                    : progress < 62
                        ? 'Evidence is becoming opportunity.'
                        : progress < 90
                            ? 'The idea is taking shape.'
                            : 'Final validation is almost done.';

    return Container(
      clipBehavior: Clip.antiAlias,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 15),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        border: Border.all(color: Colors.white.withValues(alpha: .96)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: terminalProblem
              ? [
                  AppColors.surfaceRose,
                  AppColors.surface,
                ]
              : [
                  const Color(0xFFFFFEFD),
                  const Color(0xFFEAF7F4),
                  const Color(0xFFFFF6F8),
                ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .075),
            blurRadius: 30,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -38,
            top: -48,
            child: Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .07),
              ),
            ),
          ),
          Positioned(
            left: -42,
            bottom: -55,
            child: Container(
              width: 126,
              height: 126,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .05),
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _ProgressRing(
                    progress: progress,
                    failed: terminalProblem,
                    completed: completed,
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'LIVE GENERATION RUN',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 7.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .95,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            title,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 19.6,
                              height: 1.05,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.48,
                            ),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            stage,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 9.8,
                              height: 1.42,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 15),
              Container(
                padding: const EdgeInsets.fromLTRB(11, 9, 11, 9),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    _HeroMetric(
                      icon: Icons.schedule_rounded,
                      value: '${elapsedSeconds}s',
                      label: 'elapsed',
                    ),
                    Container(
                      width: 1,
                      height: 28,
                      color: AppColors.border,
                    ),
                    _HeroMetric(
                      icon: realtimeConnected
                          ? Icons.sensors_rounded
                          : Icons.sync_rounded,
                      value: realtimeConnected ? 'Live' : 'Sync',
                      label: 'connection',
                      positive: realtimeConnected,
                    ),
                    Container(
                      width: 1,
                      height: 28,
                      color: AppColors.border,
                    ),
                    _HeroMetric(
                      icon: completed
                          ? Icons.check_circle_rounded
                          : Icons.auto_awesome_rounded,
                      value: completed ? 'Done' : '${progress.round()}%',
                      label: completed ? 'saved' : 'complete',
                    ),
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

class _HeroMetric extends StatelessWidget {
  const _HeroMetric({
    required this.icon,
    required this.value,
    required this.label,
    this.positive = false,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Icon(
            icon,
            size: 14,
            color: positive ? AppColors.success : AppColors.primaryDark,
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 9.4,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 6.8,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressRing extends StatelessWidget {
  const _ProgressRing({
    required this.progress,
    required this.failed,
    required this.completed,
  });

  final double progress;
  final bool failed;
  final bool completed;

  @override
  Widget build(BuildContext context) {
    final value = (progress / 100).clamp(0.0, 1.0).toDouble();

    return Container(
      width: 91,
      height: 91,
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: .96),
            AppColors.primarySoft.withValues(alpha: .70),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: .11),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          CircularProgressIndicator(
            value: value,
            strokeWidth: 6.5,
            strokeCap: StrokeCap.round,
            backgroundColor: AppColors.border,
            color: failed ? AppColors.pink : AppColors.primary,
          ),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (completed)
                  const Icon(
                    Icons.check_rounded,
                    color: AppColors.success,
                    size: 25,
                  )
                else
                  Text(
                    '${progress.round()}',
                    style: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 20,
                      height: .95,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -.6,
                    ),
                  ),
                const SizedBox(height: 2),
                Text(
                  completed ? 'READY' : '% COMPLETE',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.2,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .52,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PipelineMilestone extends StatelessWidget {
  const _PipelineMilestone({
    required this.index,
    required this.milestone,
    required this.done,
    required this.current,
    required this.last,
  });

  final int index;
  final ({String title, String subtitle, IconData icon, List<String> keys})
      milestone;
  final bool done;
  final bool current;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 38,
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    gradient: done || current
                        ? const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Color(0xFF69C6C0),
                              Color(0xFF4B9D96),
                            ],
                          )
                        : null,
                    color: done || current ? null : Colors.white,
                    border: Border.all(
                      color: done || current
                          ? Colors.transparent
                          : AppColors.borderStrong,
                    ),
                    boxShadow: current
                        ? [
                            BoxShadow(
                              color: AppColors.primary.withValues(alpha: .16),
                              blurRadius: 0,
                              spreadRadius: 4,
                            ),
                          ]
                        : null,
                  ),
                  child: done
                      ? const Icon(
                          Icons.check_rounded,
                          color: Colors.white,
                          size: 16,
                        )
                      : Icon(
                          milestone.icon,
                          color: current ? Colors.white : AppColors.textMuted,
                          size: 16,
                        ),
                ),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      decoration: BoxDecoration(
                        color: done ? AppColors.primary : AppColors.border,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              margin: EdgeInsets.only(bottom: last ? 3 : 9),
              padding: const EdgeInsets.fromLTRB(11, 10, 10, 10),
              decoration: BoxDecoration(
                gradient: current
                    ? LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.primarySoft.withValues(alpha: .88),
                          Colors.white.withValues(alpha: .92),
                        ],
                      )
                    : null,
                color: current
                    ? null
                    : done
                        ? Colors.white.withValues(alpha: .76)
                        : AppColors.surfaceMuted.withValues(alpha: .34),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: current
                      ? AppColors.primary.withValues(alpha: .40)
                      : AppColors.border.withValues(alpha: .82),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              '${index + 1}'.padLeft(2, '0'),
                              style: TextStyle(
                                color: current
                                    ? AppColors.primaryDeep
                                    : AppColors.textMuted,
                                fontSize: 6.8,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .5,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                milestone.title,
                                style: TextStyle(
                                  color: current
                                      ? AppColors.primaryDeep
                                      : AppColors.textPrimary,
                                  fontSize: 10.2,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          milestone.subtitle,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.5,
                            height: 1.36,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (current)
                    const Padding(
                      padding: EdgeInsets.only(top: 4, left: 8),
                      child: SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  else if (done)
                    const Padding(
                      padding: EdgeInsets.only(top: 3, left: 8),
                      child: Icon(
                        Icons.verified_rounded,
                        size: 15,
                        color: AppColors.success,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
