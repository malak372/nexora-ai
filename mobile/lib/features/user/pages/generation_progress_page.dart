// Realtime mobile generation progress using the backend Socket.IO gateway,
// with a lightweight REST fallback if the socket is interrupted.
//
// @author  Malak

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../../core/network/realtime_socket.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'idea_workspace_page.dart';

class GenerationProgressPage extends StatefulWidget {
  const GenerationProgressPage({super.key, required this.runId});

  final String runId;

  @override
  State<GenerationProgressPage> createState() => _GenerationProgressPageState();
}

class _GenerationProgressPageState extends State<GenerationProgressPage> {
  static const _milestones = <({String title, String subtitle, List<String> keys})>[
    (
      title: 'Preparing request',
      subtitle: 'Validating access, request details and the strongest domain direction.',
      keys: ['request-validation', 'entitlement-check', 'domain-resolution', 'data-source-selection'],
    ),
    (
      title: 'Collecting evidence',
      subtitle: 'Gathering relevant public signals from the best available sources.',
      keys: ['collection-job-resolution', 'data-collection'],
    ),
    (
      title: 'Understanding community needs',
      subtitle: 'NLP and community intelligence turn raw signals into ranked opportunities.',
      keys: ['nlp-analysis', 'community-ai-analysis', 'opportunity-ranking'],
    ),
    (
      title: 'Creating the idea',
      subtitle: 'Building prompts and comparing candidate software directions.',
      keys: ['prompt-building', 'core-idea-generation'],
    ),
    (
      title: 'Checking quality and originality',
      subtitle: 'Validating the strongest candidate and checking for duplicates.',
      keys: ['ai-output-validation', 'duplicate-check'],
    ),
    (
      title: 'Saving workspace',
      subtitle: 'Persisting the idea and preparing any advanced outputs available to your account.',
      keys: ['idea-persistence', 'advanced-output-generation', 'advanced-output-persistence', 'finalization'],
    ),
  ];
  Timer? _fallbackTimer;
  io.Socket? _socket;
  Map<String, dynamic>? _run;
  Object? _error;
  String? _stageDisplayName;
  bool _cancelling = false;
  bool _realtimeConnected = false;
  bool _terminalRefreshDone = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    _connectRealtime();
    _fallbackTimer = Timer.periodic(
      const Duration(seconds: 12),
      (_) => _refresh(silent: true),
    );
  }

  @override
  void dispose() {
    _fallbackTimer?.cancel();
    final socket = _socket;
    if (socket != null) {
      socket.emit('idea-generation.leave', {'runId': widget.runId});
      socket.dispose();
    }
    super.dispose();
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
        setState(() => _realtimeConnected = true);
        socket.emit('idea-generation.join', {'runId': widget.runId});
      });

      socket.onDisconnect((_) {
        if (mounted) setState(() => _realtimeConnected = false);
      });

      socket.onConnectError((_) {
        if (mounted) setState(() => _realtimeConnected = false);
      });

      socket.on('idea-generation.snapshot', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId) return;
        _applyRunUpdate(map);
      });

      socket.on('idea-generation.run.updated', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId) return;
        _applyRunUpdate(map);
      });

      socket.on('idea-generation.stage.updated', (dynamic payload) {
        final map = _asMap(payload);
        if (map['runId']?.toString() != widget.runId || !mounted) return;
        setState(() {
          _stageDisplayName = map['displayName']?.toString();
          final current = Map<String, dynamic>.from(_run ?? const {});
          current['currentStageKey'] = map['stageKey'];
          final stageProgress = map['progressPercent'];
          if (stageProgress is num && current['progressPercent'] == null) {
            current['progressPercent'] = stageProgress;
          }
          _run = current;
        });
      });

      socket.connect();
    } catch (_) {
      // REST fallback remains active; no blocking error is shown for socket loss.
    }
  }

  Future<void> _refresh({bool silent = false}) async {
    try {
      final run = await UserApi.instance.getGenerationRun(widget.runId);
      if (!mounted) return;
      setState(() {
        _run = run;
        _error = null;
      });
      await _handleTerminal(run);
    } catch (error) {
      if (!mounted || silent) return;
      setState(() => _error = error);
    }
  }

  void _applyRunUpdate(Map<String, dynamic> incoming) {
    if (!mounted) return;
    final next = Map<String, dynamic>.from(_run ?? const {});
    next.addAll(incoming);
    setState(() {
      _run = next;
      _error = null;
    });
    _handleTerminal(next);
  }

  Future<void> _handleTerminal(Map<String, dynamic> run) async {
    final status = '${run['status'] ?? ''}'.toUpperCase();
    if (!_isTerminal(status)) return;

    _fallbackTimer?.cancel();
    if (_terminalRefreshDone) return;
    _terminalRefreshDone = true;
    await UserSessionController.instance.load(force: true);
  }

  bool _isTerminal(String status) =>
      const {'COMPLETED', 'FAILED', 'CANCELLED'}.contains(status);

  Future<void> _cancel() async {
    setState(() => _cancelling = true);
    try {
      await UserApi.instance.cancelGeneration(widget.runId);
      await _refresh();
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final run = _run;
    final status = '${run?['status'] ?? 'QUEUED'}'.toUpperCase();
    final progress =
        ((run?['progressPercent'] as num?)?.toDouble() ?? 0).clamp(0, 100);
    final stage = _stageDisplayName ?? _stageLabel(run?['currentStageKey']?.toString());
    final ideaId = run?['ideaId']?.toString();
    final completed = status == 'COMPLETED';
    final failed = status == 'FAILED';
    final cancelled = status == 'CANCELLED';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Generation progress'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: StatusChip(
                label: _realtimeConnected ? 'LIVE' : 'SYNC',
                positive: _realtimeConnected,
              ),
            ),
          ),
        ],
      ),
      body: WorkspaceBackground(
        child: SafeArea(
          top: false,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 40),
            children: [
              VoxCard(
                child: Column(
                  children: [
                    Container(
                      width: 76,
                      height: 76,
                      decoration: BoxDecoration(
                        color: completed
                            ? AppColors.primarySoft
                            : failed || cancelled
                                ? AppColors.pinkSoft
                                : AppColors.surfaceMuted,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        completed
                            ? Icons.check_rounded
                            : failed
                                ? Icons.error_outline_rounded
                                : cancelled
                                    ? Icons.stop_circle_outlined
                                    : Icons.auto_awesome_rounded,
                        color: completed
                            ? AppColors.success
                            : failed || cancelled
                                ? AppColors.pinkDeep
                                : AppColors.primaryDark,
                        size: 34,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      completed
                          ? 'Your idea is ready'
                          : failed
                              ? 'Generation stopped'
                              : cancelled
                                  ? 'Generation cancelled'
                                  : 'Evidence pipeline is working',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 7),
                    Text(
                      stage,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 20),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        minHeight: 9,
                        value: completed ? 1 : progress / 100,
                        backgroundColor: AppColors.border,
                        color: failed || cancelled ? AppColors.pink : AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 9),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          status,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '${progress.round()}%',
                          style: const TextStyle(
                            color: AppColors.primaryDeep,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const SectionHeading(
                title: 'Live pipeline',
                subtitle: 'Six evidence-led milestones — the same generation journey shown on web.',
              ),
              const SizedBox(height: 10),
              ...List.generate(_milestones.length, (index) {
                final currentIndex = _milestoneIndex(run?['currentStageKey']?.toString(), progress);
                final isDone = completed || index < currentIndex;
                final isCurrent = !completed && !failed && !cancelled && index == currentIndex;
                final milestone = _milestones[index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: VoxCard(
                    padding: const EdgeInsets.all(12),
                    tint: isCurrent
                        ? AppColors.primarySoft.withValues(alpha: .72)
                        : isDone
                            ? AppColors.surface.withValues(alpha: .92)
                            : AppColors.surfaceMuted.withValues(alpha: .56),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: isDone || isCurrent ? AppColors.primary : Colors.white,
                            shape: BoxShape.circle,
                            border: Border.all(color: isDone || isCurrent ? AppColors.primary : AppColors.border),
                          ),
                          child: isDone
                              ? const Icon(Icons.check_rounded, size: 17, color: Colors.white)
                              : Text('${index + 1}', style: TextStyle(color: isCurrent ? Colors.white : AppColors.textMuted, fontSize: 10, fontWeight: FontWeight.w900)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(milestone.title, style: TextStyle(color: isCurrent ? AppColors.primaryDeep : AppColors.textPrimary, fontSize: 10.8, fontWeight: FontWeight.w900)),
                              const SizedBox(height: 3),
                              Text(milestone.subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.1, height: 1.34)),
                            ],
                          ),
                        ),
                        if (isCurrent) const Padding(padding: EdgeInsets.only(top: 7), child: SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2))),
                      ],
                    ),
                  ),
                );
              }),
              if (!completed && !failed && !cancelled) ...[
                const SizedBox(height: 3),
                const InlineNotice(
                  icon: Icons.shield_outlined,
                  message: 'You can safely leave this page. Your generation keeps running and can be reopened from the dashboard.',
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 12),
                EmptyState(
                  icon: Icons.wifi_off_rounded,
                  title: 'Connection interrupted',
                  message:
                      'Your run is safe on the server. Tap refresh to recover the latest progress.',
                  action: FilledButton(
                    onPressed: _refresh,
                    child: const Text('Refresh'),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              if (completed && ideaId != null && ideaId.isNotEmpty)
                FilledButton.icon(
                  onPressed: () {
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute(
                        builder: (_) => IdeaWorkspacePage(ideaId: ideaId),
                      ),
                    );
                  },
                  icon: const Icon(Icons.arrow_forward_rounded),
                  label: const Text('Open idea workspace'),
                )
              else if (!failed && !cancelled)
                OutlinedButton.icon(
                  onPressed: _cancelling ? null : _cancel,
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: Text(_cancelling ? 'Cancelling...' : 'Cancel generation'),
                )
              else
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Back to workspace'),
                ),
            ],
          ),
        ),
      ),
    );
  }

  int _milestoneIndex(String? stageKey, num progress) {
    final normalized = (stageKey ?? '').trim().toLowerCase().replaceAll('_', '-');
    if (normalized.isNotEmpty) {
      for (var i = 0; i < _milestones.length; i += 1) {
        if (_milestones[i].keys.any((key) => normalized.contains(key))) return i;
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
