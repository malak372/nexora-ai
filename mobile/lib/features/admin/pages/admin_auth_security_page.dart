import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_selection_field.dart';
import '../widgets/admin_ui.dart';

class AdminAuthSecurityPage extends StatefulWidget {
  const AdminAuthSecurityPage({super.key});

  @override
  State<AdminAuthSecurityPage> createState() => _AdminAuthSecurityPageState();
}

class _AdminAuthSecurityPageState extends State<AdminAuthSecurityPage> {
  static const _pageSize = 20;

  static const _actions = <AdminSelectionOption>[
    AdminSelectionOption(value: 'all', label: 'All authentication events', icon: Icons.shield_outlined),
    AdminSelectionOption(value: 'REGISTER', label: 'Register', icon: Icons.person_add_alt_1_rounded),
    AdminSelectionOption(value: 'LOGIN_SUCCESS', label: 'Login success', icon: Icons.login_rounded),
    AdminSelectionOption(value: 'LOGIN_FAILED', label: 'Login failed', icon: Icons.gpp_bad_outlined),
    AdminSelectionOption(value: 'LOGOUT', label: 'Logout', icon: Icons.logout_rounded),
    AdminSelectionOption(value: 'REFRESH_TOKEN', label: 'Refresh token', icon: Icons.refresh_rounded),
    AdminSelectionOption(value: 'CHANGE_PASSWORD', label: 'Change password', icon: Icons.password_rounded),
    AdminSelectionOption(value: 'FORGOT_PASSWORD', label: 'Forgot password', icon: Icons.key_off_outlined),
    AdminSelectionOption(value: 'RESET_PASSWORD', label: 'Reset password', icon: Icons.key_rounded),
    AdminSelectionOption(value: 'EMAIL_VERIFIED', label: 'Email verified', icon: Icons.mark_email_read_outlined),
    AdminSelectionOption(value: 'RESEND_VERIFICATION_EMAIL', label: 'Resend verification email', icon: Icons.forward_to_inbox_outlined),
    AdminSelectionOption(value: 'ACCOUNT_LOCKED', label: 'Account locked', icon: Icons.lock_outline_rounded),
    AdminSelectionOption(value: 'ACCOUNT_DEACTIVATED', label: 'Account deactivated', icon: Icons.person_off_outlined),
    AdminSelectionOption(value: 'EMAIL_CHANGED', label: 'Email changed', icon: Icons.alternate_email_rounded),
    AdminSelectionOption(value: 'VERIFICATION_EMAIL_SENT', label: 'Verification email sent', icon: Icons.send_outlined),
    AdminSelectionOption(value: 'VERIFY_EMAIL_FAILED', label: 'Verify email failed', icon: Icons.email_outlined),
    AdminSelectionOption(value: 'RESET_PASSWORD_FAILED', label: 'Reset password failed', icon: Icons.key_off_outlined),
    AdminSelectionOption(value: 'REFRESH_TOKEN_FAILED', label: 'Refresh token failed', icon: Icons.sync_problem_rounded),
  ];

  static const _sortOptions = <AdminSelectionOption>[
    AdminSelectionOption(value: 'createdAt', label: 'Event date', icon: Icons.schedule_rounded),
    AdminSelectionOption(value: 'action', label: 'Event type', icon: Icons.security_rounded),
    AdminSelectionOption(value: 'email', label: 'Email', icon: Icons.alternate_email_rounded),
    AdminSelectionOption(value: 'isSuccess', label: 'Result', icon: Icons.verified_outlined),
  ];

  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _searchDebounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _summary = const {};

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  String _search = '';
  String _action = 'all';
  String _result = 'all';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';
  DateTime? _fromDate;
  DateTime? _toDate;

  bool _loading = true;
  bool _refreshing = false;
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
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
    };
  }

  Map<String, dynamic> _listExtra() {
    return {
      ..._commonExtra(),
      if (_result != 'all') 'isSuccess': _result == 'success',
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

    unawaited(_loadSummary(requestId, force: force));

    try {
      final payload = await _api.getList(
        '/admin/auth-audit-logs',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: _listExtra(),
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
      setState(() => _error = 'Could not load authentication security activity.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _loadSummary(int requestId, {required bool force}) async {
    try {
      final value = await _api.getSummary(
        '/admin/auth-audit-logs/summary',
        force: force,
        query: {
          if (_search.isNotEmpty) 'search': _search,
          ..._commonExtra(),
        },
      );

      if (!mounted || requestId != _requestId) return;
      setState(() => _summary = value);
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

  Future<void> _openFilters() async {
    var action = _action;
    var result = _result;
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
              heightFactor: .88,
              child: Container(
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 9),
                    Container(
                      width: 38,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.silver,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 12, 10, 10),
                      child: Row(
                        children: [
                          const AdminIconBadge(
                            icon: Icons.security_rounded,
                            size: 40,
                            tone: AppColors.primarySoft,
                            iconColor: AppColors.primary,
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'SECURITY FILTERS',
                                  style: TextStyle(
                                    color: AppColors.primary,
                                    fontSize: 8.5,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 1.05,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Refine authentication activity',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: -.3,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(sheetContext),
                            icon: const Icon(Icons.close_rounded),
                            color: AppColors.textSecondary,
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 15, 16, 22),
                        children: [
                          AdminSelectionField(
                            label: 'Event type',
                            value: action,
                            options: _actions,
                            icon: Icons.key_rounded,
                            onChanged: (value) => setSheetState(() => action = value),
                          ),
                          const SizedBox(height: 10),
                          AdminSelectionField(
                            label: 'Result',
                            value: result,
                            options: const [
                              AdminSelectionOption(value: 'all', label: 'All results', icon: Icons.shield_outlined),
                              AdminSelectionOption(value: 'success', label: 'Successful', icon: Icons.verified_outlined),
                              AdminSelectionOption(value: 'failed', label: 'Failed', icon: Icons.gpp_bad_outlined),
                            ],
                            icon: Icons.verified_user_outlined,
                            onChanged: (value) => setSheetState(() => result = value),
                          ),
                          const SizedBox(height: 16),
                          _SectionLabel('DATE RANGE'),
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
                          _SectionLabel('SORT EVENTS'),
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
                              Expanded(
                                child: _DirectionButton(
                                  label: 'Ascending',
                                  icon: Icons.arrow_upward_rounded,
                                  selected: sortOrder == 'asc',
                                  onTap: () => setSheetState(() => sortOrder = 'asc'),
                                ),
                              ),
                              const SizedBox(width: 9),
                              Expanded(
                                child: _DirectionButton(
                                  label: 'Descending',
                                  icon: Icons.arrow_downward_rounded,
                                  selected: sortOrder == 'desc',
                                  onTap: () => setSheetState(() => sortOrder = 'desc'),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 18),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: () => setSheetState(() {
                                    action = 'all';
                                    result = 'all';
                                    sortBy = 'createdAt';
                                    sortOrder = 'desc';
                                    fromDate = null;
                                    toDate = null;
                                  }),
                                  child: const Text('Reset'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: FilledButton.icon(
                                  onPressed: () => Navigator.pop(sheetContext, true),
                                  icon: const Icon(Icons.check_rounded, size: 17),
                                  label: const Text('Apply filters'),
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
            );
          },
        );
      },
    );

    if (applied != true || !mounted) return;

    setState(() {
      _action = action;
      _result = result;
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
    final total = _int(_summary['totalEvents'] ?? _total);
    final successful = _int(_summary['successfulEvents']);
    final failed = _int(_summary['failedEvents']);
    final uniqueIps = _int(_summary['uniqueIpAddresses']);
    final uniqueUsers = _int(_summary['uniqueUsers']);
    final lockEvents = _int(_summary['accountLockEvents']);

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
                      title: 'Auth security',
                      subtitle: 'Authentication events, failures, devices and network context.',
                      eyebrow: 'Security & system',
                      icon: Icons.security_outlined,
                      accentColor: AppColors.primary,
                      onBack: () => Navigator.of(context).pop(),
                      trailing: _RefreshButton(
                        busy: _refreshing,
                        onTap: () => _load(force: true, quiet: true),
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: _SecurityPulse(
                      failed: failed,
                      lockEvents: lockEvents,
                      uniqueUsers: uniqueUsers,
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  sliver: SliverGrid(
                    delegate: SliverChildListDelegate([
                      AdminMetricCard(
                        label: 'Total events',
                        value: _compactNumber(total),
                        meta: 'Matching logs',
                        icon: Icons.key_rounded,
                        tone: AppColors.primarySoft,
                        iconColor: AppColors.primary,
                      ),
                      AdminMetricCard(
                        label: 'Successful',
                        value: _compactNumber(successful),
                        meta: 'Authenticated',
                        icon: Icons.verified_outlined,
                        tone: const Color(0xFFEAF8F2),
                        iconColor: AppColors.success,
                      ),
                      AdminMetricCard(
                        label: 'Failed',
                        value: _compactNumber(failed),
                        meta: '$lockEvents locked',
                        icon: Icons.gpp_bad_outlined,
                        tone: AppColors.pinkSoft,
                        iconColor: AppColors.danger,
                      ),
                      AdminMetricCard(
                        label: 'Network sources',
                        value: _compactNumber(uniqueIps),
                        meta: '$uniqueUsers users',
                        icon: Icons.fingerprint_rounded,
                        tone: const Color(0xFFF0F8F6),
                        iconColor: AppColors.primary,
                      ),
                    ]),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 1.32,
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Expanded(
                          child: AdminSearchField(
                            controller: _searchController,
                            hint: 'Search email, account, IP or device...',
                            onChanged: _onSearchChanged,
                          ),
                        ),
                        const SizedBox(width: 9),
                        _FilterButton(
                          activeCount: _activeFilterCount,
                          onTap: _openFilters,
                        ),
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Expanded(
                          child: Wrap(
                            spacing: 7,
                            runSpacing: 7,
                            children: [
                              _QuickResultChip(
                                label: 'All',
                                count: _total,
                                selected: _result == 'all',
                                onTap: () => _setQuickResult('all'),
                              ),
                              _QuickResultChip(
                                label: 'Successful',
                                count: successful,
                                selected: _result == 'success',
                                onTap: () => _setQuickResult('success'),
                              ),
                              _QuickResultChip(
                                label: 'Failed',
                                count: failed,
                                selected: _result == 'failed',
                                onTap: () => _setQuickResult('failed'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Page $_page of $_totalPages',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_error.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                    sliver: SliverToBoxAdapter(
                      child: _ErrorBanner(message: _error, onRetry: () => _load(force: true)),
                    ),
                  ),
                if (_loading && _rows.isEmpty)
                  const SliverPadding(
                    padding: EdgeInsets.fromLTRB(16, 8, 16, 24),
                    sliver: SliverToBoxAdapter(child: AdminLoadingList(count: 5)),
                  )
                else if (_rows.isEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    sliver: SliverToBoxAdapter(
                      child: AdminEmptyState(
                        title: 'No security events',
                        message: 'Try another event, result, date range or search phrase.',
                        icon: Icons.lock_outline_rounded,
                        onRetry: () => _load(force: true),
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          if (index.isOdd) return const SizedBox(height: 9);
                          final row = _rows[index ~/ 2];
                          return _SecurityEventCard(
                            row: row,
                            onTap: () => _openEvent(row),
                          );
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
    if (_result != 'all') count += 1;
    if (_fromDate != null || _toDate != null) count += 1;
    if (_sortBy != 'createdAt' || _sortOrder != 'desc') count += 1;
    return count;
  }

  void _setQuickResult(String value) {
    if (_result == value) return;
    setState(() {
      _result = value;
      _page = 1;
    });
    _load();
  }

  Future<void> _openEvent(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (sheetContext) => _SecurityEventSheet(row: row),
    );
  }
}

class _SecurityPulse extends StatelessWidget {
  const _SecurityPulse({required this.failed, required this.lockEvents, required this.uniqueUsers});

  final int failed;
  final int lockEvents;
  final int uniqueUsers;

  @override
  Widget build(BuildContext context) {
    final calm = failed == 0 && lockEvents == 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        color: calm ? const Color(0xFFEEF8F5) : AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: calm ? AppColors.borderStrong : AppColors.pinkLight.withValues(alpha: .72)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: calm ? AppColors.success : AppColors.danger,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              calm ? 'Authentication telemetry is clear' : '$failed failed events · $lockEvents account locks',
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Text(
            '$uniqueUsers users',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.2,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _SecurityEventCard extends StatelessWidget {
  const _SecurityEventCard({required this.row, required this.onTap});

  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = _map(row['user']);
    final success = row['isSuccess'] == true;
    final name = _text(user['fullName']).isNotEmpty ? _text(user['fullName']) : 'Platform user';
    final email = _text(user['email']).isNotEmpty ? _text(user['email']) : _text(row['email']);
    final action = _humanize(_text(row['action']));
    final ip = _text(row['ipAddress']).isEmpty ? 'Unknown IP' : _text(row['ipAddress']);
    final device = _deviceLabel(_text(row['userAgent']));

    return AdminGlassCard(
      padding: const EdgeInsets.all(13),
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AdminIconBadge(
            icon: success ? Icons.verified_user_outlined : Icons.gpp_bad_outlined,
            size: 42,
            tone: success ? const Color(0xFFEAF8F2) : AppColors.pinkSoft,
            iconColor: success ? AppColors.success : AppColors.danger,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        action,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 12.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    _ResultPill(success: success),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.2,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if (email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 9.3),
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 7,
                  runSpacing: 5,
                  children: [
                    _MetaTag(icon: Icons.fingerprint_rounded, text: ip),
                    _MetaTag(icon: Icons.devices_rounded, text: device),
                    _MetaTag(icon: Icons.schedule_rounded, text: _formatDate(row['createdAt'])),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 4),
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Icon(Icons.arrow_forward_ios_rounded, size: 11, color: AppColors.sage),
          ),
        ],
      ),
    );
  }
}

class _SecurityEventSheet extends StatelessWidget {
  const _SecurityEventSheet({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final user = _map(row['user']);
    final success = row['isSuccess'] == true;
    final email = _text(user['email']).isNotEmpty ? _text(user['email']) : _text(row['email']);
    final name = _text(user['fullName']).isNotEmpty ? _text(user['fullName']) : (email.isEmpty ? 'Unknown account' : email);
    final userAgent = _text(row['userAgent']);
    final message = _text(row['message']);

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
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(color: AppColors.silver, borderRadius: BorderRadius.circular(99)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 13, 10, 11),
              child: Row(
                children: [
                  AdminIconBadge(
                    icon: success ? Icons.verified_user_outlined : Icons.gpp_bad_outlined,
                    size: 42,
                    tone: success ? const Color(0xFFEAF8F2) : AppColors.pinkSoft,
                    iconColor: success ? AppColors.success : AppColors.danger,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'AUTHENTICATION EVENT',
                          style: TextStyle(color: AppColors.primary, fontSize: 8.5, fontWeight: FontWeight.w900, letterSpacing: 1.05),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _humanize(_text(row['action'])),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 2),
                        Text(_formatDate(row['createdAt']), style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5)),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                    color: AppColors.textSecondary,
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                children: [
                  _DetailHero(
                    title: success ? 'Authentication completed successfully' : 'Authentication event failed',
                    body: message.isEmpty ? 'No additional security message was recorded for this event.' : message,
                    success: success,
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    title: 'Account',
                    icon: Icons.person_outline_rounded,
                    children: [
                      _DetailRow(label: 'Name', value: name),
                      _DetailRow(label: 'Email', value: email.isEmpty ? '—' : email, copyable: email.isNotEmpty),
                      _DetailRow(label: 'Role', value: _text(user['role']).isEmpty ? '—' : _humanize(_text(user['role']))),
                      _DetailRow(label: 'Account active', value: user.isEmpty ? '—' : (user['isActive'] == true ? 'Yes' : 'No')),
                      _DetailRow(label: 'Email verified', value: user.isEmpty ? '—' : (user['isVerified'] == true ? 'Yes' : 'No')),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    title: 'Network & device',
                    icon: Icons.devices_other_rounded,
                    children: [
                      _DetailRow(label: 'IP address', value: _text(row['ipAddress']).isEmpty ? 'Unknown IP' : _text(row['ipAddress']), copyable: _text(row['ipAddress']).isNotEmpty),
                      _DetailRow(label: 'Device', value: _deviceLabel(userAgent)),
                      _DetailRow(label: 'User agent', value: userAgent.isEmpty ? 'Not stored' : userAgent, copyable: userAgent.isNotEmpty),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    title: 'Record metadata',
                    icon: Icons.data_object_rounded,
                    children: [
                      _DetailRow(label: 'Log ID', value: _text(row['id']).isEmpty ? '—' : _text(row['id']), copyable: _text(row['id']).isNotEmpty),
                      _DetailRow(label: 'User ID', value: _text(row['userId']).isNotEmpty ? _text(row['userId']) : (_text(user['id']).isEmpty ? '—' : _text(user['id'])), copyable: _text(row['userId']).isNotEmpty || _text(user['id']).isNotEmpty),
                      _DetailRow(label: 'Event result', value: success ? 'Successful' : 'Failed'),
                      _DetailRow(label: 'Created', value: _formatDate(row['createdAt'])),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailHero extends StatelessWidget {
  const _DetailHero({required this.title, required this.body, required this.success});

  final String title;
  final String body;
  final bool success;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: success ? const Color(0xFFEEF8F5) : AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: success ? AppColors.borderStrong : AppColors.pinkLight.withValues(alpha: .7)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(success ? Icons.check_circle_outline_rounded : Icons.error_outline_rounded, color: success ? AppColors.success : AppColors.danger, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.3, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.8, height: 1.45)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({required this.title, required this.icon, required this.children});

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
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 7),
              Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.5, fontWeight: FontWeight.w900)),
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value, this.copyable = false});

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
          SizedBox(
            width: 104,
            child: Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.8, height: 1.35, fontWeight: FontWeight.w700)),
          ),
          if (copyable) ...[
            const SizedBox(width: 5),
            InkWell(
              onTap: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
              },
              borderRadius: BorderRadius.circular(8),
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(Icons.copy_rounded, size: 14, color: AppColors.primary),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ResultPill extends StatelessWidget {
  const _ResultPill({required this.success});

  final bool success;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: success ? const Color(0xFFE8F7F0) : AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(success ? Icons.check_circle_outline_rounded : Icons.error_outline_rounded, size: 11, color: success ? AppColors.success : AppColors.danger),
          const SizedBox(width: 4),
          Text(
            success ? 'Successful' : 'Failed',
            style: TextStyle(color: success ? AppColors.success : AppColors.danger, fontSize: 8.4, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _MetaTag extends StatelessWidget {
  const _MetaTag({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 11, color: AppColors.textMuted),
        const SizedBox(width: 4),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 150),
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 8.8, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

class _QuickResultChip extends StatelessWidget {
  const _QuickResultChip({required this.label, required this.count, required this.selected, required this.onTap});

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? AppColors.primary.withValues(alpha: .5) : AppColors.borderStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: TextStyle(color: selected ? AppColors.primary : AppColors.textSecondary, fontSize: 9.2, fontWeight: FontWeight.w900)),
              const SizedBox(width: 5),
              Text('$count', style: const TextStyle(color: AppColors.textMuted, fontSize: 8.8, fontWeight: FontWeight.w800)),
            ],
          ),
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

class _RefreshButton extends StatelessWidget {
  const _RefreshButton({required this.busy, required this.onTap});

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
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(15), border: Border.all(color: AppColors.borderStrong)),
          child: busy
              ? const SizedBox(width: 17, height: 17, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary))
              : const Icon(Icons.refresh_rounded, color: AppColors.primary, size: 21),
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
    final from = visible == 0 ? 0 : (page - 1) * _AdminAuthSecurityPageState._pageSize + 1;
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
    builder: (context, child) {
      return Theme(
        data: Theme.of(context).copyWith(
          colorScheme: Theme.of(context).colorScheme.copyWith(primary: AppColors.primary),
        ),
        child: child!,
      );
    },
  );
}

String _startOfDayIso(DateTime date) => DateTime(date.year, date.month, date.day).toUtc().toIso8601String();
String _endOfDayIso(DateTime date) => DateTime(date.year, date.month, date.day, 23, 59, 59, 999).toUtc().toIso8601String();

String _deviceLabel(String userAgent) {
  if (userAgent.isEmpty) return 'Unknown device';
  final platform = userAgent.contains('Android')
      ? 'Android'
      : RegExp(r'iPhone|iPad|iPod', caseSensitive: false).hasMatch(userAgent)
          ? 'iOS'
          : userAgent.contains('Windows')
              ? 'Windows'
              : RegExp(r'Macintosh|Mac OS X', caseSensitive: false).hasMatch(userAgent)
                  ? 'macOS'
                  : userAgent.contains('Linux')
                      ? 'Linux'
                      : 'Unknown OS';
  final browser = userAgent.contains('Edg/')
      ? 'Edge'
      : userAgent.contains('Chrome/')
          ? 'Chrome'
          : userAgent.contains('Firefox/')
              ? 'Firefox'
              : userAgent.contains('Safari/')
                  ? 'Safari'
                  : 'Unknown browser';
  return '$browser on $platform';
}

String _formatDate(dynamic value) {
  final raw = _text(value);
  if (raw.isEmpty) return '—';
  final date = DateTime.tryParse(raw)?.toLocal();
  if (date == null) return raw;
  return DateFormat('MMM d, y · HH:mm').format(date);
}

String _humanize(String value) {
  if (value.trim().isEmpty) return 'Authentication event';
  return value
      .toLowerCase()
      .split('_')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _compactNumber(int value) => NumberFormat.compact().format(value);
String _text(dynamic value) => value?.toString().trim() ?? '';
int _int(dynamic value) => value is num ? value.toInt() : int.tryParse(_text(value)) ?? 0;
Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic value) => value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : const [];
