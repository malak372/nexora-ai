import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_selection_field.dart';
import '../widgets/admin_ui.dart';

class AdminAuditTrailPage extends StatefulWidget {
  const AdminAuditTrailPage({super.key});

  @override
  State<AdminAuditTrailPage> createState() => _AdminAuditTrailPageState();
}

class _AdminAuditTrailPageState extends State<AdminAuditTrailPage> {
  static const _pageSize = 20;

  static const _actions = <AdminSelectionOption>[
    AdminSelectionOption(value: 'all', label: 'All actions', icon: Icons.history_rounded),
    AdminSelectionOption(value: 'ADMIN_UPDATE_USER', label: 'Update user', icon: Icons.manage_accounts_outlined),
    AdminSelectionOption(value: 'ADMIN_UPDATE_USER_STATUS', label: 'Update user status', icon: Icons.how_to_reg_outlined),
    AdminSelectionOption(value: 'ADMIN_SOFT_DELETE_USER', label: 'Soft-delete user', icon: Icons.person_off_outlined),
    AdminSelectionOption(value: 'ADMIN_ADJUST_USER_CREDITS', label: 'Adjust user credits', icon: Icons.toll_outlined),
    AdminSelectionOption(value: 'ADMIN_SEND_PASSWORD_RESET_EMAIL', label: 'Send password reset email', icon: Icons.password_rounded),
    AdminSelectionOption(value: 'ADMIN_UPDATE_SETTINGS', label: 'Update settings', icon: Icons.tune_rounded),
    AdminSelectionOption(value: 'ADMIN_UPDATE_PROMPT', label: 'Update prompt', icon: Icons.auto_awesome_outlined),
    AdminSelectionOption(value: 'ADMIN_CREATE_ALERT', label: 'Create alert', icon: Icons.notifications_active_outlined),
    AdminSelectionOption(value: 'ADMIN_CREATE_DATA_SOURCE', label: 'Create data source', icon: Icons.add_link_rounded),
    AdminSelectionOption(value: 'ADMIN_UPDATE_DATA_SOURCE', label: 'Update data source', icon: Icons.hub_outlined),
    AdminSelectionOption(value: 'ADMIN_ACTIVATE_DATA_SOURCE', label: 'Activate data source', icon: Icons.play_circle_outline_rounded),
    AdminSelectionOption(value: 'ADMIN_DEACTIVATE_DATA_SOURCE', label: 'Deactivate data source', icon: Icons.pause_circle_outline_rounded),
    AdminSelectionOption(value: 'ADMIN_CREATE_DOMAIN', label: 'Create domain', icon: Icons.layers_outlined),
    AdminSelectionOption(value: 'ADMIN_UPDATE_DOMAIN', label: 'Update domain', icon: Icons.layers_rounded),
    AdminSelectionOption(value: 'ADMIN_DEACTIVATE_DOMAIN', label: 'Deactivate domain', icon: Icons.layers_outlined),
    AdminSelectionOption(value: 'ADMIN_UPDATE_COMPLAINT', label: 'Update complaint', icon: Icons.report_problem_outlined),
    AdminSelectionOption(value: 'ADMIN_UPDATE_CONTACT_MESSAGE', label: 'Update contact message', icon: Icons.mail_outline_rounded),
    AdminSelectionOption(value: 'ADMIN_CREATE_AI_MODEL', label: 'Create AI model', icon: Icons.psychology_alt_outlined),
    AdminSelectionOption(value: 'ADMIN_UPDATE_AI_MODEL', label: 'Update AI model', icon: Icons.psychology_alt_outlined),
    AdminSelectionOption(value: 'ADMIN_ACTIVATE_AI_MODEL', label: 'Activate AI model', icon: Icons.play_arrow_rounded),
    AdminSelectionOption(value: 'ADMIN_DEACTIVATE_AI_MODEL', label: 'Deactivate AI model', icon: Icons.pause_rounded),
    AdminSelectionOption(value: 'ADMIN_SET_DEFAULT_AI_MODEL', label: 'Set default AI model', icon: Icons.star_outline_rounded),
    AdminSelectionOption(value: 'ADMIN_START_DATA_COLLECTION', label: 'Start data collection', icon: Icons.play_circle_outline_rounded),
    AdminSelectionOption(value: 'ADMIN_STOP_DATA_COLLECTION', label: 'Stop data collection', icon: Icons.stop_circle_outlined),
    AdminSelectionOption(value: 'ADMIN_HIDE_PUBLICATION', label: 'Hide publication', icon: Icons.visibility_off_outlined),
    AdminSelectionOption(value: 'ADMIN_RESTORE_PUBLICATION', label: 'Restore publication', icon: Icons.restore_rounded),
    AdminSelectionOption(value: 'ADMIN_ARCHIVE_PUBLICATION', label: 'Archive publication', icon: Icons.archive_outlined),
    AdminSelectionOption(value: 'ADMIN_REVIEW_PUBLICATION_REPORT', label: 'Review publication report', icon: Icons.fact_check_outlined),
    AdminSelectionOption(value: 'USER_GENERATE_IDEA', label: 'User generated idea', icon: Icons.lightbulb_outline_rounded),
    AdminSelectionOption(value: 'USER_UNLOCK_IDEA', label: 'User unlocked idea', icon: Icons.lock_open_rounded),
    AdminSelectionOption(value: 'USER_CREATE_COMPLAINT', label: 'User created complaint', icon: Icons.feedback_outlined),
    AdminSelectionOption(value: 'USER_CREATE_CONTACT_MESSAGE', label: 'User created contact message', icon: Icons.contact_mail_outlined),
    AdminSelectionOption(value: 'USER_AI_CHAT', label: 'User AI chat', icon: Icons.chat_bubble_outline_rounded),
    AdminSelectionOption(value: 'USER_UPDATE_PROFILE', label: 'User updated profile', icon: Icons.person_outline_rounded),
    AdminSelectionOption(value: 'USER_MARK_NOTIFICATION_READ', label: 'User read notification', icon: Icons.mark_email_read_outlined),
    AdminSelectionOption(value: 'USER_MARK_ALL_NOTIFICATIONS_READ', label: 'User read all notifications', icon: Icons.done_all_rounded),
    AdminSelectionOption(value: 'RUN_DATA_COLLECTION', label: 'Run data collection', icon: Icons.account_tree_outlined),
    AdminSelectionOption(value: 'COMPLETE_DATA_COLLECTION', label: 'Complete data collection', icon: Icons.task_alt_rounded),
    AdminSelectionOption(value: 'FAIL_DATA_COLLECTION', label: 'Fail data collection', icon: Icons.error_outline_rounded),
    AdminSelectionOption(value: 'STOP_DATA_COLLECTION', label: 'Stop data collection', icon: Icons.stop_circle_outlined),
    AdminSelectionOption(value: 'NLP_ANALYSIS_RUN', label: 'NLP analysis run', icon: Icons.analytics_outlined),
    AdminSelectionOption(value: 'ABSTRACT_GENERATION_RUN', label: 'Abstract generation run', icon: Icons.auto_awesome_outlined),
    AdminSelectionOption(value: 'PROMPT_HISTORY_CREATED', label: 'Prompt history created', icon: Icons.history_edu_outlined),
    AdminSelectionOption(value: 'USER_CREATE_PUBLICATION', label: 'User created publication', icon: Icons.post_add_rounded),
    AdminSelectionOption(value: 'USER_PUBLISH_IDEA', label: 'User published idea', icon: Icons.publish_rounded),
    AdminSelectionOption(value: 'USER_UPDATE_PUBLICATION', label: 'User updated publication', icon: Icons.edit_note_rounded),
    AdminSelectionOption(value: 'USER_ARCHIVE_PUBLICATION', label: 'User archived publication', icon: Icons.archive_outlined),
    AdminSelectionOption(value: 'USER_REPORT_PUBLICATION', label: 'User reported publication', icon: Icons.flag_outlined),
    AdminSelectionOption(value: 'USER_ACCEPT_PUBLICATION', label: 'User accepted publication', icon: Icons.check_circle_outline_rounded),
    AdminSelectionOption(value: 'USER_UNLOCK_PUBLICATION_ADVANCED', label: 'User unlocked publication advanced', icon: Icons.workspace_premium_outlined),
  ];

  static const _targets = <AdminSelectionOption>[
    AdminSelectionOption(value: 'all', label: 'All target types', icon: Icons.category_outlined),
    AdminSelectionOption(value: 'USER', label: 'User', icon: Icons.person_outline_rounded),
    AdminSelectionOption(value: 'IDEA', label: 'Idea', icon: Icons.lightbulb_outline_rounded),
    AdminSelectionOption(value: 'PAYMENT', label: 'Payment', icon: Icons.payments_outlined),
    AdminSelectionOption(value: 'DOMAIN', label: 'Domain', icon: Icons.layers_outlined),
    AdminSelectionOption(value: 'DATA_SOURCE', label: 'Data source', icon: Icons.hub_outlined),
    AdminSelectionOption(value: 'SYSTEM_SETTING', label: 'System setting', icon: Icons.tune_rounded),
    AdminSelectionOption(value: 'PROMPT', label: 'Prompt', icon: Icons.auto_awesome_outlined),
    AdminSelectionOption(value: 'COMPLAINT', label: 'Complaint', icon: Icons.feedback_outlined),
    AdminSelectionOption(value: 'AI_MODEL', label: 'AI model', icon: Icons.psychology_alt_outlined),
    AdminSelectionOption(value: 'IDEA_PUBLICATION', label: 'Publication', icon: Icons.article_outlined),
    AdminSelectionOption(value: 'CONTACT_MESSAGE', label: 'Contact message', icon: Icons.mail_outline_rounded),
    AdminSelectionOption(value: 'ALERT', label: 'Alert', icon: Icons.notifications_outlined),
    AdminSelectionOption(value: 'CREDIT_TRANSACTION', label: 'Credit transaction', icon: Icons.toll_outlined),
    AdminSelectionOption(value: 'DATA_COLLECTION', label: 'Data collection', icon: Icons.account_tree_outlined),
    AdminSelectionOption(value: 'NLP_ANALYSIS', label: 'NLP analysis', icon: Icons.analytics_outlined),
    AdminSelectionOption(value: 'IDEA_PUBLICATION_FEEDBACK', label: 'Publication feedback', icon: Icons.rate_review_outlined),
    AdminSelectionOption(value: 'IDEA_PUBLICATION_REPORT', label: 'Publication report', icon: Icons.flag_outlined),
    AdminSelectionOption(value: 'IDEA_PUBLICATION_ACCEPTANCE', label: 'Publication acceptance', icon: Icons.task_alt_rounded),
  ];

  static const _sortOptions = <AdminSelectionOption>[
    AdminSelectionOption(value: 'createdAt', label: 'Event date', icon: Icons.schedule_rounded),
    AdminSelectionOption(value: 'action', label: 'Action', icon: Icons.history_rounded),
    AdminSelectionOption(value: 'targetType', label: 'Target type', icon: Icons.category_outlined),
    AdminSelectionOption(value: 'targetId', label: 'Target ID', icon: Icons.tag_rounded),
  ];

  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _searchDebounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _summary = const {};
  Map<String, dynamic> _charts = const {};

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  String _search = '';
  String _action = 'all';
  String _targetType = 'all';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';
  DateTime? _fromDate;
  DateTime? _toDate;

  bool _loading = true;
  bool _refreshing = false;
  bool _exporting = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> _commonExtra() {
    return {
      if (_action != 'all') 'action': _action,
      if (_targetType != 'all') 'targetType': _targetType,
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
    };
  }

  Future<void> _load({bool force = false, bool quiet = false}) async {
    if (!mounted) return;
    final requestId = ++_requestId;

    setState(() {
      if (quiet) {
        _refreshing = true;
      } else {
        _loading = true;
      }
      _error = '';
    });

    unawaited(_loadAnalytics(requestId, force: force));

    try {
      final payload = await _api.getList(
        '/audit-logs',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: _commonExtra(),
      );

      if (!mounted || requestId != _requestId) return;

      final rows = _list(payload['items']);
      final meta = _map(payload['meta']);

      setState(() {
        _rows = rows;
        _total = _int(meta['total'] ?? rows.length);
        _totalPages = _int(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = 'Could not load the audit trail.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _loadAnalytics(int requestId, {required bool force}) async {
    final query = {
      if (_search.isNotEmpty) 'search': _search,
      ..._commonExtra(),
    };

    try {
      final results = await Future.wait([
        _api.getSummary('/audit-logs/summary', force: force, query: query),
        _api.getSummary('/audit-logs/charts', force: force, query: query),
      ]);

      if (!mounted || requestId != _requestId) return;
      setState(() {
        _summary = results[0];
        _charts = results[1];
      });
    } catch (_) {}
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      final next = value.trim();
      if (next == _search) return;
      setState(() {
        _search = next;
        _page = 1;
      });
      _load();
    });
  }

  Future<void> _exportCsv() async {
    if (_exporting) return;
    setState(() => _exporting = true);

    try {
      final bytes = await _api.exportAuditLogsCsv(
        search: _search,
        action: _action == 'all' ? null : _action,
        targetType: _targetType == 'all' ? null : _targetType,
        fromDate: _fromDate == null ? null : _startOfDayIso(_fromDate!),
        toDate: _toDate == null ? null : _endOfDayIso(_toDate!),
        sortBy: _sortBy,
        sortOrder: _sortOrder,
      );

      if (bytes.isEmpty) throw const ApiException('The audit CSV export was empty.');
      if (!mounted) return;

      final box = context.findRenderObject() as RenderBox?;
      final origin = box == null ? null : box.localToGlobal(Offset.zero) & box.size;

      await SharePlus.instance.share(
        ShareParams(
          subject: 'Voxidence audit trail export',
          text: 'Administrative audit trail export',
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: 'admin-audit-logs.csv',
            ),
          ],
          sharePositionOrigin: origin,
        ),
      );
    } on ApiException catch (error) {
      if (mounted) _snack(error.message, error: true);
    } catch (_) {
      if (mounted) _snack('Could not export the audit trail.', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _openFilters() async {
    var action = _action;
    var target = _targetType;
    var sortBy = _sortBy;
    var sortOrder = _sortOrder;
    var fromDate = _fromDate;
    var toDate = _toDate;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return FractionallySizedBox(
              heightFactor: .9,
              child: Container(
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 9),
                    Container(width: 38, height: 4, decoration: BoxDecoration(color: AppColors.silver, borderRadius: BorderRadius.circular(99))),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 12, 10, 10),
                      child: Row(
                        children: [
                          const AdminIconBadge(icon: Icons.manage_history_rounded, size: 40, tone: AppColors.primarySoft, iconColor: AppColors.primary),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('AUDIT FILTERS', style: TextStyle(color: AppColors.primary, fontSize: 8.5, fontWeight: FontWeight.w900, letterSpacing: 1.05)),
                                SizedBox(height: 2),
                                Text('Refine platform history', style: TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w900, letterSpacing: -.3)),
                              ],
                            ),
                          ),
                          IconButton(onPressed: () => Navigator.pop(sheetContext), icon: const Icon(Icons.close_rounded), color: AppColors.textSecondary),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 15, 16, 22),
                        children: [
                          AdminSelectionField(
                            label: 'Action',
                            value: action,
                            options: _actions,
                            icon: Icons.history_rounded,
                            onChanged: (value) => setSheetState(() => action = value),
                          ),
                          const SizedBox(height: 10),
                          AdminSelectionField(
                            label: 'Target type',
                            value: target,
                            options: _targets,
                            icon: Icons.category_outlined,
                            onChanged: (value) => setSheetState(() => target = value),
                          ),
                          const SizedBox(height: 16),
                          const _SectionLabel('DATE RANGE'),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: _DateField(
                                  label: 'From',
                                  value: fromDate,
                                  onTap: () async {
                                    final picked = await _pickDate(sheetContext, fromDate, firstDate: DateTime(2020), lastDate: toDate ?? DateTime.now());
                                    if (picked != null) setSheetState(() => fromDate = picked);
                                  },
                                ),
                              ),
                              const SizedBox(width: 9),
                              Expanded(
                                child: _DateField(
                                  label: 'To',
                                  value: toDate,
                                  onTap: () async {
                                    final picked = await _pickDate(sheetContext, toDate, firstDate: fromDate ?? DateTime(2020), lastDate: DateTime.now());
                                    if (picked != null) setSheetState(() => toDate = picked);
                                  },
                                ),
                              ),
                            ],
                          ),
                          if (fromDate != null || toDate != null) ...[
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () => setSheetState(() {
                                  fromDate = null;
                                  toDate = null;
                                }),
                                icon: const Icon(Icons.close_rounded, size: 15),
                                label: const Text('Clear dates'),
                              ),
                            ),
                          ],
                          const SizedBox(height: 8),
                          const _SectionLabel('SORT EVENTS'),
                          const SizedBox(height: 8),
                          AdminSelectionField(
                            label: 'Sort by',
                            value: sortBy,
                            options: _sortOptions,
                            icon: Icons.sort_rounded,
                            onChanged: (value) => setSheetState(() => sortBy = value),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(child: _DirectionButton(label: 'Ascending', icon: Icons.arrow_upward_rounded, selected: sortOrder == 'asc', onTap: () => setSheetState(() => sortOrder = 'asc'))),
                              const SizedBox(width: 9),
                              Expanded(child: _DirectionButton(label: 'Descending', icon: Icons.arrow_downward_rounded, selected: sortOrder == 'desc', onTap: () => setSheetState(() => sortOrder = 'desc'))),
                            ],
                          ),
                          const SizedBox(height: 18),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => setSheetState(() {
                                    action = 'all';
                                    target = 'all';
                                    sortBy = 'createdAt';
                                    sortOrder = 'desc';
                                    fromDate = null;
                                    toDate = null;
                                  }),
                                  child: const Text('Reset'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(child: FilledButton.icon(onPressed: () => Navigator.pop(sheetContext, true), icon: const Icon(Icons.check_rounded, size: 17), label: const Text('Apply filters'))),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );

    if (applied != true || !mounted) return;
    setState(() {
      _action = action;
      _targetType = target;
      _sortBy = sortBy;
      _sortOrder = sortOrder;
      _fromDate = fromDate;
      _toDate = toDate;
      _page = 1;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final totalLogs = _int(_summary['totalLogs'] ?? _total);
    final adminActions = _int(_summary['adminActions']);
    final systemEvents = _int(_summary['logsWithoutActor']);
    final uniqueActors = _int(_summary['uniqueActors']);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true, quiet: true),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                  sliver: SliverToBoxAdapter(
                    child: AdminPageHeader(
                      title: 'Audit trail',
                      subtitle: 'Administrative and system actions with actor, target and change history.',
                      eyebrow: 'Security & system',
                      icon: Icons.manage_history_rounded,
                      accentColor: AppColors.primary,
                      onBack: () => Navigator.of(context).pop(),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _SquareActionButton(icon: Icons.download_rounded, busy: _exporting, onTap: _exportCsv),
                          const SizedBox(width: 7),
                          _SquareActionButton(icon: Icons.refresh_rounded, busy: _refreshing, onTap: () => _load(force: true, quiet: true)),
                        ],
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  sliver: SliverGrid(
                    delegate: SliverChildListDelegate([
                      AdminMetricCard(label: 'Total records', value: _compactNumber(totalLogs), meta: 'Matching events', icon: Icons.receipt_long_outlined, tone: AppColors.primarySoft, iconColor: AppColors.primary),
                      AdminMetricCard(label: 'Admin actions', value: _compactNumber(adminActions), meta: 'Privileged', icon: Icons.admin_panel_settings_outlined, tone: const Color(0xFFEAF8F2), iconColor: AppColors.success),
                      AdminMetricCard(label: 'System events', value: _compactNumber(systemEvents), meta: 'No actor', icon: Icons.terminal_rounded, tone: const Color(0xFFF2F6F4), iconColor: AppColors.textSecondary),
                      AdminMetricCard(label: 'Active actors', value: _compactNumber(uniqueActors), meta: 'Distinct users', icon: Icons.groups_2_outlined, tone: const Color(0xFFF0F8F6), iconColor: AppColors.primary),
                    ]),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.32),
                  ),
                ),
                if (_topActivity.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    sliver: SliverToBoxAdapter(child: _ActivityStrip(items: _topActivity)),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Expanded(child: AdminSearchField(controller: _searchController, hint: 'Search actor, target ID or email...', onChanged: _onSearchChanged)),
                        const SizedBox(width: 9),
                        _FilterButton(activeCount: _activeFilterCount, onTap: _openFilters),
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Text('$_total records', style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5, fontWeight: FontWeight.w800)),
                        const Spacer(),
                        Text('${_sortLabel(_sortBy)} · ${_sortOrder == 'asc' ? 'Ascending' : 'Descending'} · Page $_page of $_totalPages', style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                ),
                if (_error.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                    sliver: SliverToBoxAdapter(child: _ErrorBanner(message: _error, onRetry: () => _load(force: true))),
                  ),
                if (_loading && _rows.isEmpty)
                  const SliverPadding(padding: EdgeInsets.fromLTRB(16, 8, 16, 24), sliver: SliverToBoxAdapter(child: AdminLoadingList(count: 5)))
                else if (_rows.isEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    sliver: SliverToBoxAdapter(child: AdminEmptyState(title: 'No audit records', message: 'Try another action, target type, date range or search phrase.', icon: Icons.manage_history_rounded, onRetry: () => _load(force: true))),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          if (index.isOdd) return const SizedBox(height: 9);
                          final row = _rows[index ~/ 2];
                          return _AuditCard(row: row, onTap: () => _openRecord(row));
                        },
                        childCount: _rows.isEmpty ? 0 : _rows.length * 2 - 1,
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
                  sliver: SliverToBoxAdapter(
                    child: _PaginationBar(
                      page: _page,
                      totalPages: _totalPages,
                      total: _total,
                      visible: _rows.length,
                      onPrevious: _page <= 1 ? null : () {
                        setState(() => _page -= 1);
                        _load();
                      },
                      onNext: _page >= _totalPages ? null : () {
                        setState(() => _page += 1);
                        _load();
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  int get _activeFilterCount {
    var count = 0;
    if (_action != 'all') count += 1;
    if (_targetType != 'all') count += 1;
    if (_fromDate != null || _toDate != null) count += 1;
    if (_sortBy != 'createdAt' || _sortOrder != 'desc') count += 1;
    return count;
  }

  List<_ActivityItem> get _topActivity {
    final byAction = _list(_charts['byAction']);
    final byTarget = _list(_charts['byTargetType']);
    final items = <_ActivityItem>[];
    for (final item in byAction.take(2)) {
      items.add(_ActivityItem(label: _humanize(_text(item['action'])), value: _int(item['count']), icon: Icons.bolt_outlined));
    }
    for (final item in byTarget.take(2)) {
      items.add(_ActivityItem(label: _humanize(_text(item['targetType'])), value: _int(item['count']), icon: Icons.category_outlined));
    }
    return items;
  }

  Future<void> _openRecord(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (sheetContext) => _AuditRecordSheet(row: row),
    );
  }

  void _snack(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.danger : AppColors.primary,
      ),
    );
  }
}

class _AuditCard extends StatelessWidget {
  const _AuditCard({required this.row, required this.onTap});

  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final actor = _map(row['actor']);
    final action = _text(row['action']);
    final targetType = _text(row['targetType']);
    final actorName = _text(actor['fullName']).isNotEmpty ? _text(actor['fullName']) : 'System';
    final actorEmail = _text(actor['email']);
    final isAdmin = action.startsWith('ADMIN_');
    final tone = isAdmin ? const Color(0xFFEAF8F2) : AppColors.primarySoft;
    final accent = isAdmin ? AppColors.success : AppColors.primary;

    return AdminGlassCard(
      padding: const EdgeInsets.all(13),
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AdminIconBadge(icon: _actionIcon(action), size: 42, tone: tone, iconColor: accent),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_humanize(action), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textPrimary, fontSize: 12.3, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                Text(actorName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10.2, fontWeight: FontWeight.w800)),
                if (actorEmail.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(actorEmail, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2)),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 7,
                  runSpacing: 5,
                  children: [
                    _Tag(icon: Icons.category_outlined, text: targetType.isEmpty ? 'Unknown target' : _humanize(targetType)),
                    if (_text(row['targetId']).isNotEmpty) _Tag(icon: Icons.tag_rounded, text: _shortId(_text(row['targetId']))),
                    _Tag(icon: Icons.schedule_rounded, text: _formatDate(row['createdAt'])),
                  ],
                ),
              ],
            ),
          ),
          const Padding(padding: EdgeInsets.only(top: 12), child: Icon(Icons.arrow_forward_ios_rounded, size: 11, color: AppColors.sage)),
        ],
      ),
    );
  }
}

class _AuditRecordSheet extends StatelessWidget {
  const _AuditRecordSheet({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final actor = _map(row['actor']);
    final oldValue = _sanitize(row['oldValue']);
    final newValue = _sanitize(row['newValue']);

    return FractionallySizedBox(
      heightFactor: .92,
      child: Container(
        decoration: const BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
        child: Column(
          children: [
            const SizedBox(height: 9),
            Container(width: 38, height: 4, decoration: BoxDecoration(color: AppColors.silver, borderRadius: BorderRadius.circular(99))),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 13, 10, 11),
              child: Row(
                children: [
                  AdminIconBadge(icon: _actionIcon(_text(row['action'])), size: 42, tone: AppColors.primarySoft, iconColor: AppColors.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('AUDIT RECORD', style: TextStyle(color: AppColors.primary, fontSize: 8.5, fontWeight: FontWeight.w900, letterSpacing: 1.05)),
                        const SizedBox(height: 2),
                        Text(_humanize(_text(row['action'])), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 2),
                        Text(_formatDate(row['createdAt']), style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5)),
                      ],
                    ),
                  ),
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded), color: AppColors.textSecondary),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                children: [
                  _InfoSection(
                    title: 'Actor & target',
                    icon: Icons.account_tree_outlined,
                    children: [
                      _InfoRow(label: 'Actor', value: _text(actor['fullName']).isEmpty ? 'System' : _text(actor['fullName'])),
                      _InfoRow(label: 'Actor email', value: _text(actor['email']).isEmpty ? '—' : _text(actor['email']), copyable: _text(actor['email']).isNotEmpty),
                      _InfoRow(label: 'Actor role', value: _text(actor['role']).isEmpty ? '—' : _humanize(_text(actor['role']))),
                      _InfoRow(label: 'Target type', value: _text(row['targetType']).isEmpty ? '—' : _humanize(_text(row['targetType']))),
                      _InfoRow(label: 'Target ID', value: _text(row['targetId']).isEmpty ? '—' : _text(row['targetId']), copyable: _text(row['targetId']).isNotEmpty),
                      _InfoRow(label: 'Audit ID', value: _text(row['id']).isEmpty ? '—' : _text(row['id']), copyable: _text(row['id']).isNotEmpty),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _SnapshotCard(title: 'Before', icon: Icons.history_rounded, value: oldValue),
                  const SizedBox(height: 12),
                  _SnapshotCard(title: 'After', icon: Icons.update_rounded, value: newValue),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SnapshotCard extends StatelessWidget {
  const _SnapshotCard({required this.title, required this.icon, required this.value});

  final String title;
  final IconData icon;
  final dynamic value;

  @override
  Widget build(BuildContext context) {
    final entries = _flattenSnapshot(value);
    return AdminGlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 7),
              Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.5, fontWeight: FontWeight.w900)),
              const Spacer(),
              Text('${entries.length} fields', style: const TextStyle(color: AppColors.textMuted, fontSize: 8.6, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 10),
          if (entries.isEmpty)
            const Text('No snapshot stored.', style: TextStyle(color: AppColors.textMuted, fontSize: 9.6))
          else
            ...entries.take(18).map(
              (entry) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 112, child: Text(_humanize(entry.key), style: const TextStyle(color: AppColors.textMuted, fontSize: 8.9, fontWeight: FontWeight.w700))),
                    Expanded(child: Text(entry.value, style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.5, height: 1.35, fontWeight: FontWeight.w700))),
                  ],
                ),
              ),
            ),
          if (entries.length > 18)
            Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text('+${entries.length - 18} more fields', style: const TextStyle(color: AppColors.primary, fontSize: 9, fontWeight: FontWeight.w900)),
            ),
        ],
      ),
    );
  }
}

class _InfoSection extends StatelessWidget {
  const _InfoSection({required this.title, required this.icon, required this.children});

  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [Icon(icon, size: 16, color: AppColors.primary), const SizedBox(width: 7), Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.5, fontWeight: FontWeight.w900))]),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.copyable = false});

  final String label;
  final String value;
  final bool copyable;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 104, child: Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w700))),
          Expanded(child: Text(value, style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.8, height: 1.35, fontWeight: FontWeight.w700))),
          if (copyable) ...[
            const SizedBox(width: 5),
            InkWell(
              onTap: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
              },
              borderRadius: BorderRadius.circular(8),
              child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.copy_rounded, size: 14, color: AppColors.primary)),
            ),
          ],
        ],
      ),
    );
  }
}

class _ActivityItem {
  const _ActivityItem({required this.label, required this.value, required this.icon});

  final String label;
  final int value;
  final IconData icon;
}

class _ActivityStrip extends StatelessWidget {
  const _ActivityStrip({required this.items});

  final List<_ActivityItem> items;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('TOP ACTIVITY', style: TextStyle(color: AppColors.primary, fontSize: 8.2, fontWeight: FontWeight.w900, letterSpacing: 1.0)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: items.map((item) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
              decoration: BoxDecoration(color: AppColors.primarySoft, borderRadius: BorderRadius.circular(13), border: Border.all(color: AppColors.border)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(item.icon, size: 12, color: AppColors.primary),
                  const SizedBox(width: 5),
                  ConstrainedBox(constraints: const BoxConstraints(maxWidth: 130), child: Text(item.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 8.7, fontWeight: FontWeight.w800))),
                  const SizedBox(width: 5),
                  Text('${item.value}', style: const TextStyle(color: AppColors.textPrimary, fontSize: 8.7, fontWeight: FontWeight.w900)),
                ],
              ),
            )).toList(),
          ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 11, color: AppColors.textMuted),
        const SizedBox(width: 4),
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 140), child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textMuted, fontSize: 8.8, fontWeight: FontWeight.w600))),
      ],
    );
  }
}

class _SquareActionButton extends StatelessWidget {
  const _SquareActionButton({required this.icon, required this.busy, required this.onTap});

  final IconData icon;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(15), border: Border.all(color: AppColors.borderStrong)),
          child: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary)) : Icon(icon, size: 19, color: AppColors.primary),
        ),
      ),
    );
  }
}

class _FilterButton extends StatelessWidget {
  const _FilterButton({required this.activeCount, required this.onTap});

  final int activeCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 58,
          height: 58,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.borderStrong)),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              const Icon(Icons.tune_rounded, color: AppColors.primary, size: 21),
              if (activeCount > 0)
                Positioned(
                  right: -9,
                  top: -9,
                  child: Container(
                    width: 18,
                    height: 18,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.primary),
                    child: Text('$activeCount', style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w900)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text, style: const TextStyle(color: AppColors.primary, fontSize: 8.2, fontWeight: FontWeight.w900, letterSpacing: 1.05));
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.value, required this.onTap});

  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFFCFEFD),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 58,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.borderStrong)),
          child: Row(
            children: [
              const Icon(Icons.calendar_month_outlined, size: 18, color: AppColors.primary),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label.toUpperCase(), style: const TextStyle(color: AppColors.textMuted, fontSize: 8, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(value == null ? 'Any date' : DateFormat('MMM d, y').format(value!), style: const TextStyle(color: AppColors.textPrimary, fontSize: 10.4, fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DirectionButton extends StatelessWidget {
  const _DirectionButton({required this.label, required this.icon, required this.selected, required this.onTap});

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 50,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: selected ? AppColors.primary : AppColors.borderStrong)),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: selected ? AppColors.primary : AppColors.textMuted),
              const SizedBox(width: 6),
              Text(label, style: TextStyle(color: selected ? AppColors.primary : AppColors.textSecondary, fontSize: 9.3, fontWeight: FontWeight.w900)),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaginationBar extends StatelessWidget {
  const _PaginationBar({required this.page, required this.totalPages, required this.total, required this.visible, required this.onPrevious, required this.onNext});

  final int page;
  final int totalPages;
  final int total;
  final int visible;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final from = visible == 0 ? 0 : (page - 1) * _AdminAuditTrailPageState._pageSize + 1;
    final to = visible == 0 ? 0 : from + visible - 1;
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      child: Row(
        children: [
          Expanded(child: Text('Showing $from–$to of $total', style: const TextStyle(color: AppColors.textMuted, fontSize: 9, fontWeight: FontWeight.w700))),
          IconButton(onPressed: onPrevious, icon: const Icon(Icons.chevron_left_rounded), color: AppColors.primary, iconSize: 20),
          Text('$page / $totalPages', style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.5, fontWeight: FontWeight.w900)),
          IconButton(onPressed: onNext, icon: const Icon(Icons.chevron_right_rounded), color: AppColors.primary, iconSize: 20),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.pinkSoft, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.pinkLight.withValues(alpha: .72))),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, size: 17, color: AppColors.danger),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.6, fontWeight: FontWeight.w700))),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

Future<DateTime?> _pickDate(BuildContext context, DateTime? current, {required DateTime firstDate, required DateTime lastDate}) {
  return showDatePicker(
    context: context,
    initialDate: current ?? lastDate,
    firstDate: firstDate,
    lastDate: lastDate,
    builder: (context, child) => Theme(data: Theme.of(context).copyWith(colorScheme: Theme.of(context).colorScheme.copyWith(primary: AppColors.primary)), child: child!),
  );
}

IconData _actionIcon(String action) {
  if (action.startsWith('ADMIN_')) return Icons.admin_panel_settings_outlined;
  if (action.startsWith('USER_')) return Icons.person_outline_rounded;
  if (action.contains('DATA_COLLECTION')) return Icons.account_tree_outlined;
  if (action.contains('NLP')) return Icons.analytics_outlined;
  if (action.contains('PROMPT')) return Icons.auto_awesome_outlined;
  return Icons.history_rounded;
}

String _sortLabel(String value) {
  for (final option in _AdminAuditTrailPageState._sortOptions) {
    if (option.value == value) return option.label;
  }
  return 'Event date';
}

String _startOfDayIso(DateTime date) => DateTime(date.year, date.month, date.day).toUtc().toIso8601String();
String _endOfDayIso(DateTime date) => DateTime(date.year, date.month, date.day, 23, 59, 59, 999).toUtc().toIso8601String();

String _formatDate(dynamic value) {
  final raw = _text(value);
  if (raw.isEmpty) return '—';
  final date = DateTime.tryParse(raw)?.toLocal();
  if (date == null) return raw;
  return DateFormat('MMM d, y · HH:mm').format(date);
}

String _shortId(String value) => value.length <= 16 ? value : '${value.substring(0, 8)}…${value.substring(value.length - 5)}';
String _compactNumber(int value) => NumberFormat.compact().format(value);
String _text(dynamic value) => value?.toString().trim() ?? '';
int _int(dynamic value) => value is num ? value.toInt() : int.tryParse(_text(value)) ?? 0;
Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic value) => value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : const [];

String _humanize(String value) {
  if (value.trim().isEmpty) return 'Unknown';
  return value
      .toLowerCase()
      .split('_')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

dynamic _sanitize(dynamic value, [String parentKey = '']) {
  const sensitive = ['password', 'passwordhash', 'accesstoken', 'refreshtoken', 'token', 'secret', 'apikey', 'authorization', 'cookie'];
  final normalized = parentKey.toLowerCase();
  if (sensitive.any(normalized.contains)) return '[REDACTED]';
  if (value is List) return value.map((item) => _sanitize(item)).toList();
  if (value is Map) {
    return Map<String, dynamic>.fromEntries(
      value.entries.map((entry) => MapEntry(entry.key.toString(), _sanitize(entry.value, entry.key.toString()))),
    );
  }
  return value;
}

List<MapEntry<String, String>> _flattenSnapshot(dynamic value) {
  if (value == null) return const [];
  if (value is Map) {
    final result = <MapEntry<String, String>>[];
    for (final entry in value.entries) {
      final key = entry.key.toString();
      final item = entry.value;
      if (item is Map || item is List) {
        result.add(MapEntry(key, const JsonEncoder.withIndent('  ').convert(item)));
      } else {
        result.add(MapEntry(key, _primitive(item)));
      }
    }
    return result;
  }
  if (value is List) {
    return [MapEntry('Values', const JsonEncoder.withIndent('  ').convert(value))];
  }
  return [MapEntry('Value', _primitive(value))];
}

String _primitive(dynamic value) {
  if (value == null) return 'Null';
  if (value is bool) return value ? 'Yes' : 'No';
  if (value is num) return value.toString();
  final raw = value.toString();
  final date = DateTime.tryParse(raw)?.toLocal();
  if (date != null && RegExp(r'^\d{4}-\d{2}-\d{2}T').hasMatch(raw)) return DateFormat('MMM d, y · HH:mm').format(date);
  return raw.isEmpty ? 'Empty' : raw;
}
