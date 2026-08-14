import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Mobile administrator alerts workspace with feature parity with the web page.
///
/// It supports notification activity, sent communication history, search,
/// status/category/channel/audience/date/sort filters, paging, full record
/// inspection, and sending targeted or broadcast administrator messages.
///
/// @author Eman
class AdminAlertsPage extends StatefulWidget {
  const AdminAlertsPage({super.key});

  @override
  State<AdminAlertsPage> createState() => _AdminAlertsPageState();
}

class _AdminAlertsPageState extends State<AdminAlertsPage> {
  static const _pageSize = 20;

  final AdminApi _api = AdminApi.instance;
  final TextEditingController _searchController = TextEditingController();

  Timer? _searchDebounce;

  List<Map<String, dynamic>> _activityRows = const [];
  List<Map<String, dynamic>> _sentRows = const [];
  Map<String, dynamic> _summary = const {};

  _PageMeta _activityMeta = const _PageMeta();
  _PageMeta _sentMeta = const _PageMeta();

  String _ledgerMode = 'activity';
  String _search = '';
  String _status = 'all';
  String _type = '';
  String _sentChannel = '';
  String _sentAudience = '';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';

  DateTime? _fromDate;
  DateTime? _toDate;

  bool _activityLoading = true;
  bool _sentLoading = true;
  bool _refreshing = false;
  String _error = '';
  String _notice = '';

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    await Future.wait([
      _loadActivity(),
      _loadSent(),
    ]);
  }

  Map<String, dynamic> get _commonQuery {
    return {
      if (_search.isNotEmpty) 'search': _search,
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
    };
  }

  Future<void> _loadActivity({bool force = false, bool quiet = false}) async {
    if (!quiet && mounted) {
      setState(() {
        _activityLoading = true;
        _error = '';
      });
    }

    try {
      final listExtra = <String, dynamic>{
        ..._commonQuery,
        if (_type.isNotEmpty) 'type': _type,
        if (_status == 'read') 'isRead': 'true',
        if (_status == 'unread') 'isRead': 'false',
      };

      final results = await Future.wait<dynamic>([
        _api.getList(
          '/admin/alerts',
          page: _activityMeta.page,
          limit: _pageSize,
          sortBy: _sortBy,
          sortOrder: _sortOrder,
          force: force,
          extra: listExtra,
        ),
        _api.getSummary(
          '/admin/alerts/summary',
          force: force,
          query: _commonQuery,
        ),
      ]);

      if (!mounted) return;

      final list = _asMap(results[0]);
      final rows = _mapRows(list['items']);
      final meta = _asMap(list['meta']);

      setState(() {
        _activityRows = rows;
        _activityMeta = _PageMeta.fromMap(meta, fallbackCount: rows.length);
        _summary = _asMap(results[1]);
        _error = '';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load administrator alerts.');
    } finally {
      if (mounted) {
        setState(() => _activityLoading = false);
      }
    }
  }

  Future<void> _loadSent({bool force = false, bool quiet = false}) async {
    if (!quiet && mounted) {
      setState(() {
        _sentLoading = true;
        _error = '';
      });
    }

    try {
      final result = await _api.getList(
        '/admin/alerts/sent',
        page: _sentMeta.page,
        limit: _pageSize,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        force: force,
        extra: {
          ..._commonQuery,
          if (_sentChannel.isNotEmpty) 'channel': _sentChannel,
          if (_sentAudience.isNotEmpty) 'scope': _sentAudience,
        },
      );

      if (!mounted) return;

      final rows = _mapRows(result['items']);
      final meta = _asMap(result['meta']);

      setState(() {
        _sentRows = rows;
        _sentMeta = _PageMeta.fromMap(meta, fallbackCount: rows.length);
        _error = '';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load sent communication history.');
    } finally {
      if (mounted) {
        setState(() => _sentLoading = false);
      }
    }
  }

  Future<void> _refresh() async {
    if (_refreshing) return;

    setState(() => _refreshing = true);

    try {
      await Future.wait([
        _loadActivity(force: true, quiet: true),
        _loadSent(force: true, quiet: true),
      ]);
    } finally {
      if (mounted) {
        setState(() => _refreshing = false);
      }
    }
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _searchDebounce?.cancel();

    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      final next = value.trim();
      if (next == _search || !mounted) return;

      setState(() {
        _search = next;
        _activityMeta = _activityMeta.copyWith(page: 1);
        _sentMeta = _sentMeta.copyWith(page: 1);
      });

      _reloadCommonFilters();
    });
  }

  Future<void> _reloadCommonFilters() async {
    await Future.wait([
      _loadActivity(),
      _loadSent(quiet: _ledgerMode != 'sent'),
    ]);
  }

  Future<void> _switchLedger(String value) async {
    if (_ledgerMode == value) return;

    setState(() {
      _ledgerMode = value;
      if (value == 'activity') {
        _activityMeta = _activityMeta.copyWith(page: 1);
      } else {
        _sentMeta = _sentMeta.copyWith(page: 1);
      }
    });

    if (value == 'activity') {
      await _loadActivity();
    } else {
      await _loadSent();
    }
  }

  Future<void> _setStatus(String value) async {
    if (_status == value) return;

    setState(() {
      _status = value;
      _activityMeta = _activityMeta.copyWith(page: 1);
    });

    await _loadActivity();
  }

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<_AlertFilterResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AlertFilterSheet(
        ledgerMode: _ledgerMode,
        type: _type,
        channel: _sentChannel,
        audience: _sentAudience,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        fromDate: _fromDate,
        toDate: _toDate,
      ),
    );

    if (result == null || !mounted) return;

    setState(() {
      _type = result.type;
      _sentChannel = result.channel;
      _sentAudience = result.audience;
      _sortBy = result.sortBy;
      _sortOrder = result.sortOrder;
      _fromDate = result.fromDate;
      _toDate = result.toDate;
      _activityMeta = _activityMeta.copyWith(page: 1);
      _sentMeta = _sentMeta.copyWith(page: 1);
    });

    if (_ledgerMode == 'activity') {
      await _loadActivity();
      await _loadSent(quiet: true);
    } else {
      await _loadSent();
      await _loadActivity(quiet: true);
    }
  }

  Future<void> _openComposer() async {
    final notice = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _ComposeAlertSheet(),
    );

    if (notice == null || !mounted) return;

    setState(() {
      _notice = notice;
      _ledgerMode = 'sent';
      _sentMeta = _sentMeta.copyWith(page: 1);
    });

    await Future.wait([
      _loadActivity(force: true, quiet: true),
      _loadSent(force: true),
    ]);
  }

  Future<void> _openActivityDetail(Map<String, dynamic> item) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AlertDetailSheet(item: item),
    );
  }

  Future<void> _openSentDetail(Map<String, dynamic> item) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CommunicationDetailSheet(item: item),
    );
  }

  Future<void> _previousPage() async {
    if (_ledgerMode == 'activity') {
      if (_activityMeta.page <= 1) return;
      setState(() {
        _activityMeta = _activityMeta.copyWith(page: _activityMeta.page - 1);
      });
      await _loadActivity();
      return;
    }

    if (_sentMeta.page <= 1) return;
    setState(() {
      _sentMeta = _sentMeta.copyWith(page: _sentMeta.page - 1);
    });
    await _loadSent();
  }

  Future<void> _nextPage() async {
    if (_ledgerMode == 'activity') {
      if (_activityMeta.page >= _activityMeta.totalPages) return;
      setState(() {
        _activityMeta = _activityMeta.copyWith(page: _activityMeta.page + 1);
      });
      await _loadActivity();
      return;
    }

    if (_sentMeta.page >= _sentMeta.totalPages) return;
    setState(() {
      _sentMeta = _sentMeta.copyWith(page: _sentMeta.page + 1);
    });
    await _loadSent();
  }

  @override
  Widget build(BuildContext context) {
    final activeMeta = _ledgerMode == 'activity' ? _activityMeta : _sentMeta;
    final activeRows = _ledgerMode == 'activity' ? _activityRows : _sentRows;
    final activeLoading = _ledgerMode == 'activity' ? _activityLoading : _sentLoading;

    final totalAlerts = _int(_summary['totalAlerts'] ?? _activityMeta.total);
    final unreadAlerts = _int(_summary['unreadAlerts']);
    final readAlerts = _int(_summary['readAlerts']);
    final adminAlerts = _int(_summary['adminAlerts']);
    final recipients = _int(_summary['uniqueRecipients']);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 34),
              children: [
                AdminPageHeader(
                  eyebrow: 'Platform communication',
                  title: 'Alerts & messaging',
                  subtitle:
                      'Review notification activity and send targeted administrator communication by in-app alert, email, or both.',
                  icon: Icons.notifications_active_outlined,
                  onBack: () => Navigator.maybePop(context),
                  trailing: _RoundActionButton(
                    icon: Icons.refresh_rounded,
                    spinning: _refreshing,
                    onTap: _refreshing ? null : _refresh,
                  ),
                ),
                const SizedBox(height: 14),
                _ComposeButton(onTap: _openComposer),
                if (_error.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _FeedbackBanner(
                    message: _error,
                    error: true,
                    onClose: () => setState(() => _error = ''),
                  ),
                ],
                if (_notice.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _FeedbackBanner(
                    message: _notice,
                    onClose: () => setState(() => _notice = ''),
                  ),
                ],
                const SizedBox(height: 16),
                _MetricGrid(
                  total: totalAlerts,
                  unread: unreadAlerts,
                  admin: adminAlerts,
                  recipients: recipients,
                  read: readAlerts,
                ),
                const SizedBox(height: 16),
                _LedgerTabs(
                  mode: _ledgerMode,
                  activityCount: _activityMeta.total,
                  sentCount: _sentMeta.total,
                  onChanged: _switchLedger,
                ),
                if (_ledgerMode == 'activity') ...[
                  const SizedBox(height: 10),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _StatusPill(
                          label: 'All alerts',
                          selected: _status == 'all',
                          onTap: () => _setStatus('all'),
                        ),
                        const SizedBox(width: 7),
                        _StatusPill(
                          label: 'Unread',
                          selected: _status == 'unread',
                          onTap: () => _setStatus('unread'),
                        ),
                        const SizedBox(width: 7),
                        _StatusPill(
                          label: 'Read',
                          selected: _status == 'read',
                          onTap: () => _setStatus('read'),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 13),
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 50,
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: AppColors.border),
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.primaryDeep.withValues(alpha: .035),
                              blurRadius: 16,
                              offset: const Offset(0, 5),
                            ),
                          ],
                        ),
                        child: TextField(
                          controller: _searchController,
                          onChanged: _onSearchChanged,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                          ),
                          decoration: InputDecoration(
                            border: InputBorder.none,
                            contentPadding: const EdgeInsets.symmetric(vertical: 15),
                            hintText: _ledgerMode == 'activity'
                                ? 'Search alerts, recipients...'
                                : 'Search sent title, message or recipient...',
                            hintStyle: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 11.5,
                            ),
                            prefixIcon: const Icon(
                              Icons.search_rounded,
                              color: AppColors.primaryDark,
                              size: 21,
                            ),
                            suffixIcon: _searchController.text.isEmpty
                                ? null
                                : IconButton(
                                    onPressed: () {
                                      _searchController.clear();
                                      _onSearchChanged('');
                                    },
                                    icon: const Icon(
                                      Icons.close_rounded,
                                      size: 17,
                                      color: AppColors.textMuted,
                                    ),
                                  ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 9),
                    _FilterButton(
                      active: _hasActiveFilters,
                      onTap: _openFilters,
                    ),
                  ],
                ),
                const SizedBox(height: 13),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${activeMeta.total} ${activeMeta.total == 1 ? 'record' : 'records'}',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Text(
                      'Page ${activeMeta.page} of ${activeMeta.totalPages}',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (activeLoading)
                  const _LoadingState()
                else if (activeRows.isEmpty)
                  _EmptyState(
                    sent: _ledgerMode == 'sent',
                  )
                else ...[
                  if (_ledgerMode == 'activity')
                    ..._activityRows.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _ActivityCard(
                          item: item,
                          onTap: () => _openActivityDetail(item),
                        ),
                      ),
                    )
                  else
                    ..._sentRows.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _SentCard(
                          item: item,
                          onTap: () => _openSentDetail(item),
                        ),
                      ),
                    ),
                ],
                const SizedBox(height: 4),
                _PaginationBar(
                  meta: activeMeta,
                  onPrevious: activeMeta.page > 1 ? _previousPage : null,
                  onNext: activeMeta.page < activeMeta.totalPages ? _nextPage : null,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool get _hasActiveFilters {
    if (_fromDate != null || _toDate != null) return true;

    if (_ledgerMode == 'activity') {
      return _type.isNotEmpty || _sortBy != 'createdAt' || _sortOrder != 'desc';
    }

    return _sentChannel.isNotEmpty || _sentAudience.isNotEmpty;
  }
}

class _ComposeAlertSheet extends StatefulWidget {
  const _ComposeAlertSheet();

  @override
  State<_ComposeAlertSheet> createState() => _ComposeAlertSheetState();
}

class _ComposeAlertSheetState extends State<_ComposeAlertSheet> {
  final AdminApi _api = AdminApi.instance;
  final TextEditingController _userSearchController = TextEditingController();
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();

  Timer? _searchDebounce;

  String _scope = 'selected';
  List<Map<String, dynamic>> _selectedUsers = [];
  List<Map<String, dynamic>> _users = const [];

  bool _loadingUsers = false;
  bool _sendInApp = true;
  bool _sendEmail = false;
  bool _confirmBroadcast = false;
  bool _sending = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _userSearchController.dispose();
    _titleController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers({String search = ''}) async {
    if (_scope != 'selected') return;

    setState(() => _loadingUsers = true);

    try {
      final result = await _api.getList(
        '/admin/users',
        page: 1,
        limit: 10,
        search: search,
        sortBy: 'fullName',
        sortOrder: 'asc',
        force: true,
        extra: const {'isActive': 'true'},
      );

      if (!mounted) return;
      setState(() => _users = _mapRows(result['items']));
    } catch (_) {
      if (!mounted) return;
      setState(() => _users = const []);
    } finally {
      if (mounted) {
        setState(() => _loadingUsers = false);
      }
    }
  }

  void _onUserSearch(String value) {
    setState(() {});
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 260), () {
      if (mounted) {
        _loadUsers(search: value.trim());
      }
    });
  }

  bool get _canSend {
    final hasRecipients = _scope == 'broadcast'
        ? _confirmBroadcast
        : _selectedUsers.isNotEmpty;

    return !_sending &&
        hasRecipients &&
        (_sendInApp || _sendEmail) &&
        _titleController.text.trim().isNotEmpty &&
        _messageController.text.trim().isNotEmpty;
  }

  void _addUser(Map<String, dynamic> user) {
    final id = _string(user['id']);
    if (id.isEmpty || _selectedUsers.any((row) => _string(row['id']) == id)) {
      return;
    }
    if (_selectedUsers.length >= 50) return;

    setState(() {
      _selectedUsers = [..._selectedUsers, user];
      _userSearchController.clear();
    });
    _loadUsers();
  }

  void _removeUser(String id) {
    setState(() {
      _selectedUsers = _selectedUsers
          .where((row) => _string(row['id']) != id)
          .toList();
    });
  }

  Future<void> _send() async {
    if (!_canSend) return;

    setState(() {
      _sending = true;
      _error = '';
    });

    try {
      final result = await _api.sendAlert({
        if (_scope == 'selected')
          'userIds': _selectedUsers.map((row) => _string(row['id'])).toList(),
        if (_scope == 'broadcast') 'broadcast': true,
        'title': _titleController.text.trim(),
        'message': _messageController.text.trim(),
        'sendInApp': _sendInApp,
        'sendEmail': _sendEmail,
      });

      if (!mounted) return;

      final recipients = _int(result['recipientCount']);
      final delivery = _asMap(result['delivery']);
      final emailDelivery = _asMap(delivery['email']);
      final failedEmails = _int(emailDelivery['failedCount']);

      String notice;
      if (failedEmails > 0) {
        notice =
            'Communication sent, but $failedEmails email ${failedEmails == 1 ? 'delivery failed' : 'deliveries failed'}.';
      } else if (_sendInApp && _sendEmail) {
        notice = 'In-app alert and email sent to $recipients recipients.';
      } else if (_sendInApp) {
        notice = 'In-app alert sent to $recipients recipients.';
      } else {
        notice = 'Email sent to $recipients recipients.';
      }

      Navigator.of(context).pop(notice);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not send this communication.');
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.viewInsetsOf(context);
    final selectedIds = _selectedUsers.map((row) => _string(row['id'])).toSet();
    final availableUsers = _users
        .where((row) => !selectedIds.contains(_string(row['id'])))
        .toList();

    return Padding(
      padding: EdgeInsets.only(bottom: viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .93,
        ),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 12, 10),
              child: Row(
                children: [
                  const AdminIconBadge(
                    icon: Icons.send_rounded,
                    size: 40,
                    tone: AppColors.primarySoft,
                    iconColor: AppColors.primaryDark,
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'SEND COMMUNICATION',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.4,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.1,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'New administrator alert',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _sending ? null : () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                    color: AppColors.textMuted,
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                children: [
                  const _SectionLabel(
                    icon: Icons.groups_2_outlined,
                    eyebrow: 'RECIPIENTS',
                    title: 'Who should receive this communication?',
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _ChoiceCard(
                          icon: Icons.person_outline_rounded,
                          title: 'Selected users',
                          selected: _scope == 'selected',
                          onTap: () {
                            setState(() {
                              _scope = 'selected';
                              _confirmBroadcast = false;
                            });
                            _loadUsers(search: _userSearchController.text.trim());
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _ChoiceCard(
                          icon: Icons.groups_rounded,
                          title: 'All active users',
                          selected: _scope == 'broadcast',
                          onTap: () {
                            setState(() {
                              _scope = 'broadcast';
                              _selectedUsers = [];
                              _userSearchController.clear();
                            });
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_scope == 'selected') ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${_selectedUsers.length} ${_selectedUsers.length == 1 ? 'recipient' : 'recipients'} selected',
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        if (_selectedUsers.isNotEmpty)
                          TextButton(
                            onPressed: () => setState(() => _selectedUsers = []),
                            child: const Text('Clear all'),
                          ),
                      ],
                    ),
                    if (_selectedUsers.isNotEmpty)
                      Wrap(
                        spacing: 7,
                        runSpacing: 7,
                        children: _selectedUsers.map((user) {
                          final id = _string(user['id']);
                          final name = _userName(user);
                          return InputChip(
                            label: Text(
                              name,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            avatar: CircleAvatar(
                              backgroundColor: AppColors.primarySoft,
                              child: Text(
                                _initial(user),
                                style: const TextStyle(
                                  color: AppColors.primaryDark,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            deleteIcon: const Icon(Icons.close_rounded, size: 14),
                            onDeleted: () => _removeUser(id),
                            backgroundColor: AppColors.surfaceMuted,
                            side: const BorderSide(color: AppColors.border),
                          );
                        }).toList(),
                      ),
                    if (_selectedUsers.length < 50) ...[
                      const SizedBox(height: 10),
                      TextField(
                        controller: _userSearchController,
                        onChanged: _onUserSearch,
                        decoration: _inputDecoration(
                          hint: 'Search active user by name or email...',
                          icon: Icons.search_rounded,
                          trailing: _loadingUsers
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : null,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        constraints: const BoxConstraints(maxHeight: 220),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: availableUsers.isEmpty && !_loadingUsers
                            ? const Padding(
                                padding: EdgeInsets.all(18),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.person_search_outlined,
                                      color: AppColors.textMuted,
                                      size: 20,
                                    ),
                                    SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        'No active user matches this search.',
                                        style: TextStyle(
                                          color: AppColors.textMuted,
                                          fontSize: 10.5,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              )
                            : ListView.separated(
                                shrinkWrap: true,
                                padding: const EdgeInsets.symmetric(vertical: 5),
                                itemCount: availableUsers.length,
                                separatorBuilder: (_, _) => const Divider(
                                  height: 1,
                                  color: AppColors.border,
                                ),
                                itemBuilder: (_, index) {
                                  final user = availableUsers[index];
                                  return ListTile(
                                    dense: true,
                                    visualDensity: VisualDensity.compact,
                                    leading: CircleAvatar(
                                      radius: 17,
                                      backgroundColor: AppColors.primarySoft,
                                      child: Text(
                                        _initial(user),
                                        style: const TextStyle(
                                          color: AppColors.primaryDark,
                                          fontSize: 10,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                    ),
                                    title: Text(
                                      _userName(user),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: AppColors.textPrimary,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    subtitle: Text(
                                      _string(user['email']),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: AppColors.textMuted,
                                        fontSize: 9.5,
                                      ),
                                    ),
                                    trailing: const Icon(
                                      Icons.add_circle_outline_rounded,
                                      color: AppColors.primaryDark,
                                      size: 19,
                                    ),
                                    onTap: () => _addUser(user),
                                  );
                                },
                              ),
                      ),
                    ],
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.all(13),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceRose,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppColors.pinkLight),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            color: AppColors.pinkDeep,
                            size: 19,
                          ),
                          SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              'Broadcast delivery sends the selected channel(s) to every active registered user.',
                              style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 10.5,
                                height: 1.45,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  const _SectionLabel(
                    icon: Icons.hub_outlined,
                    eyebrow: 'CHANNELS',
                    title: 'Choose one or both delivery channels.',
                  ),
                  const SizedBox(height: 10),
                  _ChannelCard(
                    checked: _sendInApp,
                    icon: Icons.notifications_none_rounded,
                    title: 'In-app notification',
                    description: 'Persist the alert in the user notification center.',
                    onChanged: (value) => setState(() => _sendInApp = value),
                  ),
                  const SizedBox(height: 8),
                  _ChannelCard(
                    checked: _sendEmail,
                    icon: Icons.mail_outline_rounded,
                    title: 'Email',
                    description: 'Deliver the same administrator message by email.',
                    onChanged: (value) => setState(() => _sendEmail = value),
                  ),
                  const SizedBox(height: 20),
                  const _SectionLabel(
                    icon: Icons.edit_note_rounded,
                    eyebrow: 'MESSAGE',
                    title: 'Write the administrator communication.',
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _titleController,
                    maxLength: 100,
                    onChanged: (_) => setState(() {}),
                    decoration: _inputDecoration(
                      hint: 'Communication title',
                      icon: Icons.title_rounded,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _messageController,
                    minLines: 5,
                    maxLines: 9,
                    maxLength: 3000,
                    onChanged: (_) => setState(() {}),
                    decoration: _inputDecoration(
                      hint: 'Write the message users should receive...',
                      icon: Icons.message_outlined,
                      alignLabelWithHint: true,
                    ),
                  ),
                  if (_scope == 'broadcast') ...[
                    const SizedBox(height: 4),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _confirmBroadcast,
                      onChanged: (value) {
                        setState(() => _confirmBroadcast = value ?? false);
                      },
                      activeColor: AppColors.primaryDark,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text(
                        'I understand this will be sent to all active users.',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                  if (_error.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    _FeedbackBanner(
                      message: _error,
                      error: true,
                      onClose: () => setState(() => _error = ''),
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 16),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _sending ? null : () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(47),
                        side: const BorderSide(color: AppColors.borderStrong),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(15),
                        ),
                      ),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      onPressed: _canSend ? _send : null,
                      icon: _sending
                          ? const SizedBox(
                              width: 15,
                              height: 15,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.send_rounded, size: 16),
                      label: Text(
                        _scope == 'broadcast'
                            ? 'Send to all active users'
                            : 'Send to ${_selectedUsers.length} selected',
                        overflow: TextOverflow.ellipsis,
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primaryDark,
                        foregroundColor: Colors.white,
                        minimumSize: const Size.fromHeight(47),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(15),
                        ),
                      ),
                    ),
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

class _AlertFilterSheet extends StatefulWidget {
  const _AlertFilterSheet({
    required this.ledgerMode,
    required this.type,
    required this.channel,
    required this.audience,
    required this.sortBy,
    required this.sortOrder,
    required this.fromDate,
    required this.toDate,
  });

  final String ledgerMode;
  final String type;
  final String channel;
  final String audience;
  final String sortBy;
  final String sortOrder;
  final DateTime? fromDate;
  final DateTime? toDate;

  @override
  State<_AlertFilterSheet> createState() => _AlertFilterSheetState();
}

class _AlertFilterSheetState extends State<_AlertFilterSheet> {
  late String _type;
  late String _channel;
  late String _audience;
  late String _sortBy;
  late String _sortOrder;
  DateTime? _fromDate;
  DateTime? _toDate;

  @override
  void initState() {
    super.initState();
    _type = widget.type;
    _channel = widget.channel;
    _audience = widget.audience;
    _sortBy = widget.sortBy;
    _sortOrder = widget.sortOrder;
    _fromDate = widget.fromDate;
    _toDate = widget.toDate;
  }

  Future<void> _pickDate(bool from) async {
    final initial = from
        ? (_fromDate ?? _toDate ?? DateTime.now())
        : (_toDate ?? _fromDate ?? DateTime.now());

    final selected = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 3650)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: Theme.of(context).colorScheme.copyWith(
              primary: AppColors.primaryDark,
              surface: AppColors.surface,
            ),
          ),
          child: child!,
        );
      },
    );

    if (selected == null || !mounted) return;

    setState(() {
      if (from) {
        _fromDate = selected;
        if (_toDate != null && selected.isAfter(_toDate!)) {
          _toDate = selected;
        }
      } else {
        _toDate = selected;
        if (_fromDate != null && selected.isBefore(_fromDate!)) {
          _fromDate = selected;
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 22),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Filter communication',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Narrow the ledger without losing any web controls.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 10.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _type = '';
                        _channel = '';
                        _audience = '';
                        _sortBy = 'createdAt';
                        _sortOrder = 'desc';
                        _fromDate = null;
                        _toDate = null;
                      });
                    },
                    child: const Text('Reset'),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (widget.ledgerMode == 'activity') ...[
                const Text(
                  'Category',
                  style: _labelStyle,
                ),
                const SizedBox(height: 7),
                _SelectField(
                  value: _type,
                  items: const {
                    '': 'All categories',
                    'ADMIN': 'Admin notices',
                    'SYSTEM': 'System',
                    'PAYMENT': 'Payment',
                    'CREDIT_LOW': 'Credit low',
                    'CREDIT_EXHAUSTED': 'Credits exhausted',
                  },
                  onChanged: (value) => setState(() => _type = value),
                ),
                const SizedBox(height: 14),
                const Text('Sort alerts', style: _labelStyle),
                const SizedBox(height: 7),
                Row(
                  children: [
                    Expanded(
                      child: _SelectField(
                        value: _sortBy,
                        items: const {
                          'createdAt': 'Newest activity',
                          'title': 'Title',
                          'type': 'Category',
                          'isRead': 'Read status',
                        },
                        onChanged: (value) => setState(() => _sortBy = value),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 54,
                      height: 50,
                      child: OutlinedButton(
                        onPressed: () {
                          setState(() {
                            _sortOrder = _sortOrder == 'asc' ? 'desc' : 'asc';
                          });
                        },
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          side: const BorderSide(color: AppColors.borderStrong),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(15),
                          ),
                        ),
                        child: Icon(
                          _sortOrder == 'asc'
                              ? Icons.arrow_upward_rounded
                              : Icons.arrow_downward_rounded,
                          color: AppColors.primaryDark,
                          size: 19,
                        ),
                      ),
                    ),
                  ],
                ),
              ] else ...[
                const Text('Channel', style: _labelStyle),
                const SizedBox(height: 7),
                _SelectField(
                  value: _channel,
                  items: const {
                    '': 'All channels',
                    'IN_APP': 'In-app only',
                    'EMAIL': 'Email only',
                    'BOTH': 'In-app + email',
                  },
                  onChanged: (value) => setState(() => _channel = value),
                ),
                const SizedBox(height: 14),
                const Text('Audience', style: _labelStyle),
                const SizedBox(height: 7),
                _SelectField(
                  value: _audience,
                  items: const {
                    '': 'All audiences',
                    'SELECTED': 'Selected users',
                    'BROADCAST': 'Broadcasts',
                  },
                  onChanged: (value) => setState(() => _audience = value),
                ),
              ],
              const SizedBox(height: 14),
              const Text('Date range', style: _labelStyle),
              const SizedBox(height: 7),
              Row(
                children: [
                  Expanded(
                    child: _DateButton(
                      label: 'From',
                      date: _fromDate,
                      onTap: () => _pickDate(true),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _DateButton(
                      label: 'To',
                      date: _toDate,
                      onTap: () => _pickDate(false),
                    ),
                  ),
                ],
              ),
              if (_fromDate != null || _toDate != null)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _fromDate = null;
                        _toDate = null;
                      });
                    },
                    icon: const Icon(Icons.close_rounded, size: 14),
                    label: const Text('Clear dates'),
                  ),
                ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      context,
                      _AlertFilterResult(
                        type: _type,
                        channel: _channel,
                        audience: _audience,
                        sortBy: _sortBy,
                        sortOrder: _sortOrder,
                        fromDate: _fromDate,
                        toDate: _toDate,
                      ),
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(47),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  child: const Text('Apply filters'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AlertFilterResult {
  const _AlertFilterResult({
    required this.type,
    required this.channel,
    required this.audience,
    required this.sortBy,
    required this.sortOrder,
    required this.fromDate,
    required this.toDate,
  });

  final String type;
  final String channel;
  final String audience;
  final String sortBy;
  final String sortOrder;
  final DateTime? fromDate;
  final DateTime? toDate;
}

class _AlertDetailSheet extends StatelessWidget {
  const _AlertDetailSheet({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final user = _asMap(item['user']);
    final isRead = _bool(item['isRead']);
    final type = _string(item['type']).isEmpty ? 'SYSTEM' : _string(item['type']);

    return _InspectorShell(
      icon: Icons.message_outlined,
      eyebrow: 'IN-APP COMMUNICATION',
      title: _string(item['title']).isEmpty ? 'Alert' : _string(item['title']),
      subtitle: _formatDateTime(item['createdAt']),
      children: [
        _InspectorSummaryGrid(
          items: [
            _InspectorSummary(
              icon: Icons.person_outline_rounded,
              label: 'Recipient',
              value: _userName(user),
              hint: _string(user['email']).isEmpty ? '—' : _string(user['email']),
            ),
            _InspectorSummary(
              icon: Icons.notifications_none_rounded,
              label: 'Category',
              value: _titleCase(type),
              hint: 'Persisted in-app alert',
            ),
            _InspectorSummary(
              icon: isRead ? Icons.check_circle_outline_rounded : Icons.inbox_outlined,
              label: 'Delivery state',
              value: isRead ? 'Read by user' : 'Unread',
              hint: isRead
                  ? 'The user opened this notification.'
                  : 'Waiting in the user notification center.',
            ),
          ],
        ),
        const SizedBox(height: 14),
        _MessageCard(
          title: 'Administrator communication',
          message: _string(item['message']),
        ),
        const SizedBox(height: 14),
        _MetaGrid(
          values: {
            'Alert ID': _string(item['id']),
            'User ID': _string(user['id']),
            'Created': _formatDateTime(item['createdAt']),
            'Channel': 'In-app notification',
          },
        ),
      ],
    );
  }
}

class _CommunicationDetailSheet extends StatelessWidget {
  const _CommunicationDetailSheet({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final channels = _asMap(item['channels']);
    final delivery = _asMap(item['delivery']);
    final inApp = _bool(channels['inApp']);
    final email = _bool(channels['email']);
    final failed = _int(delivery['emailFailedCount']);
    final delivered =
        _int(delivery['inAppDeliveredCount']) + _int(delivery['emailSentCount']);
    final actor = _asMap(item['actor']);
    final recipients = _mapRows(item['recipients']);
    final recipientCount = _int(item['recipientCount']);
    final scope = _string(item['scope']);

    return _InspectorShell(
      icon: Icons.send_rounded,
      eyebrow: 'ADMIN SENT COMMUNICATION',
      title: _string(item['title']).isEmpty ? 'Sent communication' : _string(item['title']),
      subtitle: _formatDateTime(item['createdAt']),
      children: [
        _InspectorSummaryGrid(
          items: [
            _InspectorSummary(
              icon: Icons.groups_2_outlined,
              label: 'Audience',
              value: scope == 'BROADCAST'
                  ? 'All active users'
                  : '$recipientCount selected ${recipientCount == 1 ? 'user' : 'users'}',
              hint: '$recipientCount recipients',
            ),
            _InspectorSummary(
              icon: Icons.hub_outlined,
              label: 'Channels',
              value: inApp && email ? 'In-app + Email' : inApp ? 'In-app' : 'Email',
              hint: 'Requested delivery channels',
            ),
            _InspectorSummary(
              icon: failed > 0
                  ? Icons.warning_amber_rounded
                  : Icons.check_circle_outline_rounded,
              label: 'Delivery',
              value: _communicationStatus(item),
              hint: '$delivered deliveries · $failed email failures',
            ),
          ],
        ),
        const SizedBox(height: 14),
        _MessageCard(
          title: 'Sent content',
          message: _string(item['message']),
        ),
        if (scope == 'SELECTED') ...[
          const SizedBox(height: 14),
          _RecipientHistory(
            recipients: recipients,
            channels: channels,
            total: recipientCount,
          ),
        ],
        const SizedBox(height: 14),
        _MetaGrid(
          values: {
            'Communication ID': _string(item['id']),
            'Sent by': _userName(actor, fallback: 'Administrator'),
            'Database record': _bool(item['persisted']) ? 'Persisted' : '—',
            'Completed': _formatDateTime(item['completedAt']),
            'In-app delivered': '${_int(delivery['inAppDeliveredCount'])}',
            'Email delivered': '${_int(delivery['emailSentCount'])}',
            'Email failed': '${_int(delivery['emailFailedCount'])}',
            'Stored message': _string(item['message']).isNotEmpty ? 'Yes' : 'No',
          },
        ),
      ],
    );
  }
}

class _InspectorShell extends StatelessWidget {
  const _InspectorShell({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .92,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 12, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AdminIconBadge(
                  icon: icon,
                  size: 42,
                  tone: AppColors.primarySoft,
                  iconColor: AppColors.primaryDark,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        eyebrow,
                        style: const TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 8.2,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.05,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        title,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                          height: 1.12,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                  color: AppColors.textMuted,
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 26),
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecipientHistory extends StatelessWidget {
  const _RecipientHistory({
    required this.recipients,
    required this.channels,
    required this.total,
  });

  final List<Map<String, dynamic>> recipients;
  final Map<String, dynamic> channels;
  final int total;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'RECIPIENTS',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8.2,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Selected users and delivery results',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                '$total total',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (recipients.isEmpty)
            const Text(
              'No recipient details were stored for this historical record.',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 10.5,
                height: 1.4,
              ),
            )
          else
            ...recipients.map((recipient) {
              final inApp = _bool(channels['inApp']);
              final email = _bool(channels['email']);
              final emailStatus = _string(recipient['emailStatus']);
              return Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.border)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CircleAvatar(
                      radius: 17,
                      backgroundColor: AppColors.primarySoft,
                      child: Text(
                        _initial(recipient),
                        style: const TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _userName(recipient),
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 11,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            _string(recipient['email']).isEmpty
                                ? '—'
                                : _string(recipient['email']),
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.2,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 5,
                            children: [
                              if (inApp)
                                _MiniState(
                                  icon: Icons.notifications_none_rounded,
                                  label: _bool(recipient['inAppDelivered'])
                                      ? 'In-app delivered'
                                      : 'In-app not delivered',
                                  positive: _bool(recipient['inAppDelivered']),
                                ),
                              if (email)
                                _MiniState(
                                  icon: Icons.mail_outline_rounded,
                                  label: emailStatus == 'SENT'
                                      ? 'Email sent'
                                      : emailStatus == 'FAILED'
                                          ? 'Email failed'
                                          : 'Email pending',
                                  positive: emailStatus == 'SENT',
                                  pending: emailStatus != 'SENT' && emailStatus != 'FAILED',
                                ),
                            ],
                          ),
                          if (_string(recipient['emailError']).isNotEmpty) ...[
                            const SizedBox(height: 5),
                            Text(
                              _string(recipient['emailError']),
                              style: const TextStyle(
                                color: AppColors.danger,
                                fontSize: 8.8,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({
    required this.total,
    required this.unread,
    required this.admin,
    required this.recipients,
    required this.read,
  });

  final int total;
  final int unread;
  final int admin;
  final int recipients;
  final int read;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _MetricItem(
                  icon: Icons.notifications_none_rounded,
                  label: 'Total alerts',
                  value: total,
                  hint: 'In-app records',
                ),
              ),
              const _MetricDivider(),
              Expanded(
                child: _MetricItem(
                  icon: Icons.mark_email_unread_outlined,
                  label: 'Unread',
                  value: unread,
                  hint: 'Needs attention',
                  rose: true,
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 9),
            child: Divider(height: 1, color: AppColors.border),
          ),
          Row(
            children: [
              Expanded(
                child: _MetricItem(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'Admin notices',
                  value: admin,
                  hint: 'Created by admins',
                ),
              ),
              const _MetricDivider(),
              Expanded(
                child: _MetricItem(
                  icon: Icons.groups_2_outlined,
                  label: 'Recipients',
                  value: recipients,
                  hint: '$read already read',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricDivider extends StatelessWidget {
  const _MetricDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 46,
      margin: const EdgeInsets.symmetric(horizontal: 8),
      color: AppColors.border,
    );
  }
}

class _MetricItem extends StatelessWidget {
  const _MetricItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final int value;
  final String hint;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final iconTone = rose ? AppColors.pinkSoft : AppColors.primarySoft;
    final iconColor = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: iconTone,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 17, color: iconColor),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    '$value',
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 18,
                      height: 1,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 9.3,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                hint,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.1,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ComposeButton extends StatelessWidget {
  const _ComposeButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          height: 58,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.borderStrong),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.primaryDark,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDark.withValues(alpha: .16),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.send_rounded,
                  size: 16,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 11),
              const Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Send a new alert',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'In-app, email, or both',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.2,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: AppColors.surface.withValues(alpha: .78),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.arrow_forward_rounded,
                  size: 15,
                  color: AppColors.primaryDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LedgerTabs extends StatelessWidget {
  const _LedgerTabs({
    required this.mode,
    required this.activityCount,
    required this.sentCount,
    required this.onChanged,
  });

  final String mode;
  final int activityCount;
  final int sentCount;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: _LedgerTab(
              icon: Icons.notifications_none_rounded,
              label: 'Activity',
              count: activityCount,
              selected: mode == 'activity',
              onTap: () => onChanged('activity'),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: _LedgerTab(
              icon: Icons.send_outlined,
              label: 'Sent',
              count: sentCount,
              selected: mode == 'sent',
              onTap: () => onChanged('sent'),
            ),
          ),
        ],
      ),
    );
  }
}

class _LedgerTab extends StatelessWidget {
  const _LedgerTab({
    required this.icon,
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : Colors.transparent,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 15,
                color: selected ? AppColors.primaryDark : AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected ? AppColors.textPrimary : AppColors.textMuted,
                    fontSize: 10.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Container(
                constraints: const BoxConstraints(minWidth: 20),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: selected ? AppColors.surface : AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '$count',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: selected ? AppColors.primaryDark : AppColors.textMuted,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(99),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? AppColors.primaryDark : AppColors.textSecondary,
              fontSize: 9.4,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }
}

class _FilterButton extends StatelessWidget {
  const _FilterButton({required this.active, required this.onTap});

  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          width: 54,
          height: 50,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: active ? AppColors.primary : AppColors.border,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .03),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(
                Icons.tune_rounded,
                color: AppColors.primaryDark,
                size: 20,
              ),
              if (active)
                Positioned(
                  right: 10,
                  top: 9,
                  child: Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.pinkDeep,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundActionButton extends StatelessWidget {
  const _RoundActionButton({
    required this.icon,
    required this.onTap,
    this.spinning = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final bool spinning;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .035),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Center(
            child: spinning
                ? const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(icon, color: AppColors.primaryDark, size: 19),
          ),
        ),
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = _asMap(item['user']);
    final isRead = _bool(item['isRead']);
    final type = _string(item['type']).isEmpty ? 'SYSTEM' : _string(item['type']);

    return AdminGlassCard(
      onTap: onTap,
      radius: 20,
      padding: const EdgeInsets.all(13),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AdminIconBadge(
            icon: _alertTypeIcon(type),
            size: 43,
            tone: _alertTypeTone(type),
            iconColor: _alertTypeColor(type),
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
                        _string(item['title']).isEmpty ? 'Alert' : _string(item['title']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    _ReadBadge(isRead: isRead),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _string(item['message']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.4,
                    height: 1.38,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 9,
                  runSpacing: 5,
                  children: [
                    _TinyMeta(
                      icon: Icons.person_outline_rounded,
                      text: _userName(user),
                    ),
                    _TinyMeta(
                      icon: Icons.sell_outlined,
                      text: _titleCase(type),
                    ),
                    _TinyMeta(
                      icon: Icons.schedule_rounded,
                      text: _formatShortDateTime(item['createdAt']),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 5),
          const Padding(
            padding: EdgeInsets.only(top: 13),
            child: Icon(
              Icons.chevron_right_rounded,
              color: AppColors.sage,
              size: 21,
            ),
          ),
        ],
      ),
    );
  }
}

class _SentCard extends StatelessWidget {
  const _SentCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final actor = _asMap(item['actor']);
    final status = _communicationStatus(item);
    final scope = _string(item['scope']);
    final recipientCount = _int(item['recipientCount']);

    return AdminGlassCard(
      onTap: onTap,
      radius: 20,
      padding: const EdgeInsets.all(13),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AdminIconBadge(
            icon: Icons.send_rounded,
            size: 43,
            tone: AppColors.primarySoft,
            iconColor: AppColors.primaryDark,
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
                        _string(item['title']).isEmpty
                            ? 'Sent communication'
                            : _string(item['title']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    _CommunicationStateBadge(status: status),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _string(item['message']),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.4,
                    height: 1.38,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 9,
                  runSpacing: 5,
                  children: [
                    _TinyMeta(
                      icon: scope == 'BROADCAST'
                          ? Icons.groups_rounded
                          : Icons.person_outline_rounded,
                      text: scope == 'BROADCAST'
                          ? 'All active users'
                          : '$recipientCount selected',
                    ),
                    _TinyMeta(
                      icon: Icons.hub_outlined,
                      text: _channelLabel(item),
                    ),
                    _TinyMeta(
                      icon: Icons.schedule_rounded,
                      text: _formatShortDateTime(item['createdAt']),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  'Sent by ${_userName(actor, fallback: 'Administrator')}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 5),
          const Padding(
            padding: EdgeInsets.only(top: 13),
            child: Icon(
              Icons.chevron_right_rounded,
              color: AppColors.sage,
              size: 21,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReadBadge extends StatelessWidget {
  const _ReadBadge({required this.isRead});

  final bool isRead;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: isRead ? AppColors.primarySoft : AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isRead ? Icons.done_rounded : Icons.circle,
            size: isRead ? 10 : 7,
            color: isRead ? AppColors.primaryDark : AppColors.pinkDeep,
          ),
          const SizedBox(width: 3),
          Text(
            isRead ? 'Read' : 'Unread',
            style: TextStyle(
              color: isRead ? AppColors.primaryDark : AppColors.pinkDeep,
              fontSize: 7.8,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _CommunicationStateBadge extends StatelessWidget {
  const _CommunicationStateBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final failed = status == 'Failed';
    final partial = status == 'Partial';
    final pending = status == 'Pending';
    final color = failed
        ? AppColors.danger
        : partial || pending
            ? AppColors.warning
            : AppColors.success;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontSize: 7.8,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _TinyMeta extends StatelessWidget {
  const _TinyMeta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: AppColors.textMuted),
        const SizedBox(width: 3),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 145),
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.7,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class _PaginationBar extends StatelessWidget {
  const _PaginationBar({
    required this.meta,
    required this.onPrevious,
    required this.onNext,
  });

  final _PageMeta meta;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final start = meta.total == 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
    final end = (meta.page * meta.limit).clamp(0, meta.total);

    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onPrevious,
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.chevron_left_rounded, size: 20),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  'Page ${meta.page} of ${meta.totalPages}',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Showing $start–$end of ${meta.total}',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onNext,
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.chevron_right_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}

class _FeedbackBanner extends StatelessWidget {
  const _FeedbackBanner({
    required this.message,
    required this.onClose,
    this.error = false,
  });

  final String message;
  final VoidCallback onClose;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final accent = error ? AppColors.danger : AppColors.success;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 7, 8),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withValues(alpha: .22)),
      ),
      child: Row(
        children: [
          Icon(
            error ? Icons.error_outline_rounded : Icons.check_circle_outline_rounded,
            color: accent,
            size: 17,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.8,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          IconButton(
            onPressed: onClose,
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close_rounded, size: 15),
            color: AppColors.textMuted,
          ),
        ],
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 58),
      child: Center(
        child: Column(
          children: [
            CircularProgressIndicator(color: AppColors.primaryDark),
            SizedBox(height: 12),
            Text(
              'Loading communication activity…',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.sent});

  final bool sent;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 38),
      child: Column(
        children: [
          AdminIconBadge(
            icon: sent ? Icons.outbox_outlined : Icons.notifications_off_outlined,
            size: 48,
          ),
          const SizedBox(height: 12),
          Text(
            sent
                ? 'No sent communications match these filters.'
                : 'No notification activity matches these filters.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 12.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'Try another filter, date range or search phrase.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textMuted,
              fontSize: 10,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({
    required this.icon,
    required this.eyebrow,
    required this.title,
  });

  final IconData icon;
  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AdminIconBadge(icon: icon, size: 36),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.icon,
    required this.title,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.borderStrong,
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 17,
                color: selected ? AppColors.primaryDark : AppColors.textMuted,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: selected ? AppColors.primaryDark : AppColors.textSecondary,
                    fontSize: 10.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (selected)
                const Icon(
                  Icons.check_circle_rounded,
                  size: 15,
                  color: AppColors.primaryDark,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChannelCard extends StatelessWidget {
  const _ChannelCard({
    required this.checked,
    required this.icon,
    required this.title,
    required this.description,
    required this.onChanged,
  });

  final bool checked;
  final IconData icon;
  final String title;
  final String description;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: checked ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: () => onChanged(!checked),
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: checked ? AppColors.primary : AppColors.borderStrong,
            ),
          ),
          child: Row(
            children: [
              AdminIconBadge(
                icon: icon,
                size: 36,
                tone: checked ? AppColors.surface : AppColors.primarySoft,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.2,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                checked ? Icons.check_circle_rounded : Icons.circle_outlined,
                color: checked ? AppColors.primaryDark : AppColors.silver,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectField extends StatelessWidget {
  const _SelectField({
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String value;
  final Map<String, String> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        filled: true,
        fillColor: AppColors.background,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: AppColors.borderStrong),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(color: AppColors.primary),
        ),
      ),
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 10.5,
        fontWeight: FontWeight.w800,
      ),
      items: items.entries
          .map(
            (entry) => DropdownMenuItem<String>(
              value: entry.key,
              child: Text(entry.value),
            ),
          )
          .toList(),
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({required this.label, required this.date, required this.onTap});

  final String label;
  final DateTime? date;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.calendar_month_outlined, size: 16),
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8,
              fontWeight: FontWeight.w700,
            ),
          ),
          Text(
            date == null ? 'Any date' : DateFormat('MMM d, yyyy').format(date!),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 9.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
      style: OutlinedButton.styleFrom(
        alignment: Alignment.centerLeft,
        foregroundColor: AppColors.primaryDark,
        minimumSize: const Size.fromHeight(50),
        side: const BorderSide(color: AppColors.borderStrong),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(15),
        ),
      ),
    );
  }
}

class _InspectorSummaryGrid extends StatelessWidget {
  const _InspectorSummaryGrid({required this.items});

  final List<_InspectorSummary> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: items
          .map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AdminIconBadge(icon: item.icon, size: 34),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.label.toUpperCase(),
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 7.7,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .6,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            item.value,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 11.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            item.hint,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class _InspectorSummary {
  const _InspectorSummary({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
  });

  final IconData icon;
  final String label;
  final String value;
  final String hint;
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.borderStrong),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome_outlined,
                size: 16,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            message.isEmpty ? '—' : message,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11,
              height: 1.55,
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaGrid extends StatelessWidget {
  const _MetaGrid({required this.values});

  final Map<String, String> values;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 8) / 2;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: values.entries
              .map(
                (entry) => Container(
                  width: width,
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.key.toUpperCase(),
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 7.4,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .5,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        entry.value.isEmpty ? '—' : entry.value,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 9.7,
                          height: 1.3,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class _MiniState extends StatelessWidget {
  const _MiniState({
    required this.icon,
    required this.label,
    required this.positive,
    this.pending = false,
  });

  final IconData icon;
  final String label;
  final bool positive;
  final bool pending;

  @override
  Widget build(BuildContext context) {
    final color = pending
        ? AppColors.warning
        : positive
            ? AppColors.success
            : AppColors.danger;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: color),
          const SizedBox(width: 3),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 7.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _PageMeta {
  const _PageMeta({
    this.page = 1,
    this.limit = _AdminAlertsPageState._pageSize,
    this.total = 0,
    this.totalPages = 1,
  });

  final int page;
  final int limit;
  final int total;
  final int totalPages;

  factory _PageMeta.fromMap(Map<String, dynamic> map, {required int fallbackCount}) {
    final rawLimit = _int(map['limit'] ?? _AdminAlertsPageState._pageSize);
    final limit = rawLimit <= 0 ? _AdminAlertsPageState._pageSize : rawLimit;
    final total = _int(map['total'] ?? fallbackCount);
    final page = _int(map['page'] ?? 1).clamp(1, 999999).toInt();
    final fallbackPages = total == 0 ? 1 : ((total + limit - 1) ~/ limit);
    final totalPages = _int(map['totalPages'] ?? fallbackPages).clamp(1, 999999).toInt();

    return _PageMeta(
      page: page,
      limit: limit,
      total: total,
      totalPages: totalPages,
    );
  }

  _PageMeta copyWith({int? page, int? limit, int? total, int? totalPages}) {
    return _PageMeta(
      page: page ?? this.page,
      limit: limit ?? this.limit,
      total: total ?? this.total,
      totalPages: totalPages ?? this.totalPages,
    );
  }
}

const _labelStyle = TextStyle(
  color: AppColors.textSecondary,
  fontSize: 9.5,
  fontWeight: FontWeight.w900,
);

InputDecoration _inputDecoration({
  required String hint,
  required IconData icon,
  Widget? trailing,
  bool alignLabelWithHint = false,
}) {
  return InputDecoration(
    hintText: hint,
    alignLabelWithHint: alignLabelWithHint,
    hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 10.5),
    prefixIcon: Icon(icon, color: AppColors.primaryDark, size: 19),
    suffixIcon: trailing == null
        ? null
        : Padding(
            padding: const EdgeInsets.all(14),
            child: trailing,
          ),
    filled: true,
    fillColor: AppColors.background,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(15),
      borderSide: const BorderSide(color: AppColors.borderStrong),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(15),
      borderSide: const BorderSide(color: AppColors.primary),
    ),
  );
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _mapRows(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
}

String _string(dynamic value) => value?.toString().trim() ?? '';

int _int(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(_string(value)) ?? 0;
}

bool _bool(dynamic value) {
  if (value is bool) return value;
  final text = _string(value).toLowerCase();
  return text == 'true' || text == '1' || text == 'yes';
}

String _userName(Map<String, dynamic> user, {String fallback = 'Platform user'}) {
  final name = _string(user['fullName']);
  if (name.isNotEmpty) return name;
  final email = _string(user['email']);
  if (email.isNotEmpty) return email;
  return fallback;
}

String _initial(Map<String, dynamic> user) {
  final source = _userName(user, fallback: 'U');
  return source.isEmpty ? 'U' : source.substring(0, 1).toUpperCase();
}

String _titleCase(String value) {
  return value
      .toLowerCase()
      .split('_')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

DateTime? _parseDate(dynamic value) {
  final raw = _string(value);
  if (raw.isEmpty) return null;
  return DateTime.tryParse(raw)?.toLocal();
}

String _formatDateTime(dynamic value) {
  final date = _parseDate(value);
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy · h:mm a').format(date);
}

String _formatShortDateTime(dynamic value) {
  final date = _parseDate(value);
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy · h:mm a').format(date);
}

String _startOfDayIso(DateTime date) {
  return DateTime(date.year, date.month, date.day).toUtc().toIso8601String();
}

String _endOfDayIso(DateTime date) {
  return DateTime(date.year, date.month, date.day, 23, 59, 59, 999)
      .toUtc()
      .toIso8601String();
}

String _channelLabel(Map<String, dynamic> item) {
  final explicit = _string(item['channel']);
  if (explicit == 'BOTH') return 'In-app + Email';
  if (explicit == 'EMAIL') return 'Email';
  if (explicit == 'IN_APP') return 'In-app';

  final channels = _asMap(item['channels']);
  final inApp = _bool(channels['inApp']);
  final email = _bool(channels['email']);

  if (inApp && email) return 'In-app + Email';
  if (email) return 'Email';
  return 'In-app';
}

String _communicationStatus(Map<String, dynamic> item) {
  switch (_string(item['status']).toUpperCase()) {
    case 'FAILED':
      return 'Failed';
    case 'PARTIAL':
      return 'Partial';
    case 'PENDING':
      return 'Pending';
    default:
      return 'Delivered';
  }
}

IconData _alertTypeIcon(String type) {
  switch (type) {
    case 'ADMIN':
      return Icons.admin_panel_settings_outlined;
    case 'PAYMENT':
      return Icons.payment_outlined;
    case 'CREDIT_LOW':
    case 'CREDIT_EXHAUSTED':
      return Icons.toll_outlined;
    default:
      return Icons.notifications_none_rounded;
  }
}

Color _alertTypeTone(String type) {
  switch (type) {
    case 'ADMIN':
      return AppColors.surfaceMuted;
    case 'PAYMENT':
      return AppColors.primarySoft;
    case 'CREDIT_LOW':
    case 'CREDIT_EXHAUSTED':
      return AppColors.surfaceRose;
    default:
      return AppColors.surfaceMuted;
  }
}

Color _alertTypeColor(String type) {
  switch (type) {
    case 'CREDIT_LOW':
    case 'CREDIT_EXHAUSTED':
      return AppColors.pinkDeep;
    default:
      return AppColors.primaryDark;
  }
}
