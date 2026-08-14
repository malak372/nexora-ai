import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_selection_field.dart';
import '../widgets/admin_ui.dart';

class AdminCreditsPage extends StatefulWidget {
  const AdminCreditsPage({super.key});

  @override
  State<AdminCreditsPage> createState() => _AdminCreditsPageState();
}

class _AdminCreditsPageState extends State<AdminCreditsPage> {
  static const _pageSize = 20;

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
  String _type = 'all';
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

  Map<String, dynamic> _dateQuery() {
    return {
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
        '/admin/credits/history',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: {
          if (_type != 'all') 'type': _type,
          ..._dateQuery(),
        },
      );

      if (!mounted || requestId != _requestId) return;
      final meta = _map(payload['meta']);
      final rows = _list(payload['items']);

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
      setState(() => _error = 'Could not load the credit ledger.');
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
    try {
      final results = await Future.wait([
        _api.getSummary(
          '/admin/credits/summary',
          force: force,
          query: _dateQuery(),
        ),
        _api.getSummary(
          '/admin/credits/charts',
          force: force,
          query: _dateQuery(),
        ),
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
      final bytes = await _api.exportCreditsCsv(
        search: _search,
        type: _type == 'all' ? null : _type,
        fromDate: _fromDate == null ? null : _startOfDayIso(_fromDate!),
        toDate: _toDate == null ? null : _endOfDayIso(_toDate!),
        sortBy: _sortBy,
        sortOrder: _sortOrder,
      );

      if (bytes.isEmpty) {
        throw const ApiException('The credit CSV export was empty.');
      }

      if (!mounted) return;
      final box = context.findRenderObject() as RenderBox?;
      final origin = box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size;

      await SharePlus.instance.share(
        ShareParams(
          subject: 'Voxidence credit ledger export',
          text: 'Credit administration export',
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: 'admin-credits.csv',
            ),
          ],
          sharePositionOrigin: origin,
        ),
      );
    } on ApiException catch (error) {
      if (mounted) _snack(error.message, error: true);
    } catch (_) {
      if (mounted) _snack('Could not export the credit ledger.', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _openFilters() async {
    var nextSortBy = _sortBy;
    var nextSortOrder = _sortOrder;
    var nextFrom = _fromDate;
    var nextTo = _toDate;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Container(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .82,
              ),
              margin: const EdgeInsets.fromLTRB(7, 0, 7, 7),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
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
                    padding: const EdgeInsets.fromLTRB(16, 12, 8, 10),
                    child: Row(
                      children: [
                        const AdminIconBadge(
                          icon: Icons.tune_rounded,
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
                                'LEDGER FILTERS',
                                style: TextStyle(
                                  color: AppColors.primary,
                                  fontSize: 8.4,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 1.05,
                                ),
                              ),
                              SizedBox(height: 3),
                              Text(
                                'Filter & sort credits',
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
                          onPressed: () => Navigator.pop(sheetContext),
                          icon: const Icon(Icons.close_rounded),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Flexible(
                    child: ListView(
                      shrinkWrap: true,
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
                      children: [
                        const _SectionLabel('DATE RANGE'),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: _DateButton(
                                label: 'From',
                                value: nextFrom,
                                onTap: () async {
                                  final picked = await showDatePicker(
                                    context: context,
                                    initialDate:
                                        nextFrom ?? nextTo ?? DateTime.now(),
                                    firstDate: DateTime(2020),
                                    lastDate: nextTo ?? DateTime(2100),
                                  );
                                  if (picked == null) return;
                                  setSheetState(() {
                                    nextFrom = picked;
                                    if (nextTo != null && picked.isAfter(nextTo!)) {
                                      nextTo = picked;
                                    }
                                  });
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _DateButton(
                                label: 'To',
                                value: nextTo,
                                onTap: () async {
                                  final picked = await showDatePicker(
                                    context: context,
                                    initialDate:
                                        nextTo ?? nextFrom ?? DateTime.now(),
                                    firstDate: nextFrom ?? DateTime(2020),
                                    lastDate: DateTime(2100),
                                  );
                                  if (picked == null) return;
                                  setSheetState(() {
                                    nextTo = picked;
                                    if (nextFrom != null && picked.isBefore(nextFrom!)) {
                                      nextFrom = picked;
                                    }
                                  });
                                },
                              ),
                            ),
                          ],
                        ),
                        if (nextFrom != null || nextTo != null) ...[
                          const SizedBox(height: 6),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: TextButton.icon(
                              onPressed: () {
                                setSheetState(() {
                                  nextFrom = null;
                                  nextTo = null;
                                });
                              },
                              icon: const Icon(Icons.close_rounded, size: 15),
                              label: const Text('Clear dates'),
                            ),
                          ),
                        ],
                        const SizedBox(height: 12),
                        const _SectionLabel('SORT LEDGER'),
                        const SizedBox(height: 8),
                        AdminSelectionField(
                          label: 'Sort by',
                          icon: Icons.sort_rounded,
                          value: nextSortBy,
                          options: _sortOptions,
                          onChanged: (value) {
                            setSheetState(() => nextSortBy = value);
                          },
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: _DirectionButton(
                                selected: nextSortOrder == 'asc',
                                icon: Icons.arrow_upward_rounded,
                                label: 'Ascending',
                                onTap: () {
                                  setSheetState(() => nextSortOrder = 'asc');
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _DirectionButton(
                                selected: nextSortOrder == 'desc',
                                icon: Icons.arrow_downward_rounded,
                                label: 'Descending',
                                onTap: () {
                                  setSheetState(() => nextSortOrder = 'desc');
                                },
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () {
                                  setSheetState(() {
                                    nextSortBy = 'createdAt';
                                    nextSortOrder = 'desc';
                                    nextFrom = null;
                                    nextTo = null;
                                  });
                                },
                                child: const Text('Reset'),
                              ),
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              flex: 2,
                              child: FilledButton.icon(
                                onPressed: () => Navigator.pop(sheetContext, true),
                                icon: const Icon(Icons.check_rounded, size: 18),
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
            );
          },
        );
      },
    );

    if (applied != true || !mounted) return;
    setState(() {
      _sortBy = nextSortBy;
      _sortOrder = nextSortOrder;
      _fromDate = nextFrom;
      _toDate = nextTo;
      _page = 1;
    });
    _load();
  }

  Future<void> _openDetail(Map<String, dynamic> transaction) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (context) => _CreditDetailSheet(transaction: transaction),
    );

    if (action == 'adjust' && mounted) {
      await _openAdjustment(_map(transaction['user']));
    }
  }

  Future<void> _openAdjustment([Map<String, dynamic>? initialUser]) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (context) => _AdjustCreditsSheet(initialUser: initialUser),
    );

    if (changed == true && mounted) {
      _snack('Credit balance adjusted successfully.');
      await _load(force: true, quiet: true);
    }
  }

  Map<String, int> get _typeCounts {
    final result = <String, int>{};
    for (final item in _list(_charts['transactionsByType'])) {
      final type = _string(item['type'] ?? item['label']).toUpperCase();
      if (type.isNotEmpty) result[type] = _int(item['count']);
    }
    return result;
  }

  void _snack(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.danger : AppColors.primary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalTransactions = _int(_summary['totalTransactions'] ?? _total);
    final purchased = _int(_summary['purchasedCredits']);
    final consumed = _int(_summary['deductedCredits']);
    final bonus = _int(_summary['bonusCredits']);
    final refunded = _int(_summary['refundedCredits']);
    final adminAdjustments = _int(_summary['adminAdjustments']);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true, quiet: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
              children: [
                AdminPageHeader(
                  accentColor: AppColors.primary,
                  title: 'Credits',
                  subtitle:
                      'Review every credit movement, inspect its source and apply audited balance adjustments.',
                  eyebrow: 'Finance',
                  icon: Icons.toll_outlined,
                  onBack: () => Navigator.maybePop(context),
                  trailing: Material(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(15),
                    child: InkWell(
                      onTap: () => _openAdjustment(),
                      borderRadius: BorderRadius.circular(15),
                      child: const SizedBox(
                        width: 46,
                        height: 46,
                        child: Icon(Icons.add_rounded, color: Colors.white),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                _LiveStrip(
                  total: totalTransactions,
                  exporting: _exporting,
                  refreshing: _refreshing,
                  onExport: _exporting ? null : _exportCsv,
                  onRefresh: _refreshing
                      ? null
                      : () => _load(force: true, quiet: true),
                ),
                const SizedBox(height: 14),
                _MetricGrid(
                  items: [
                    _MetricData(
                      icon: Icons.wallet_outlined,
                      label: 'Purchased',
                      value: _formatNumber(purchased),
                      hint: 'Credits from purchases',
                      tone: AppColors.primarySoft,
                    ),
                    _MetricData(
                      icon: Icons.remove_circle_outline_rounded,
                      label: 'Consumed',
                      value: _formatNumber(consumed),
                      hint: 'Generation & publication',
                      tone: AppColors.surface,
                    ),
                    _MetricData(
                      icon: Icons.card_giftcard_outlined,
                      label: 'Bonus',
                      value: _formatNumber(bonus),
                      hint: '$refunded refunded',
                      tone: AppColors.pinkSoft,
                    ),
                    _MetricData(
                      icon: Icons.admin_panel_settings_outlined,
                      label: 'Admin adjustments',
                      value: _signed(adminAdjustments),
                      hint: 'Net audited movement',
                      tone: const Color(0xFFEAF7F1),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                _TypeScroller(
                  value: _type,
                  total: totalTransactions,
                  counts: _typeCounts,
                  onChanged: (value) {
                    if (value == _type) return;
                    setState(() {
                      _type = value;
                      _page = 1;
                    });
                    _load();
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _searchController,
                        onChanged: _onSearchChanged,
                        decoration: InputDecoration(
                          hintText: 'Search user name or email…',
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon: _searchController.text.isEmpty
                              ? null
                              : IconButton(
                                  onPressed: () {
                                    _searchController.clear();
                                    _onSearchChanged('');
                                  },
                                  icon: const Icon(Icons.close_rounded, size: 17),
                                ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _FilterButton(active: _hasFilters, onTap: _openFilters),
                  ],
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_formatNumber(_total)} records',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Text(
                      '${_sortLabel(_sortBy)} · Page $_page of $_totalPages',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.6,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
                if (_error.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  _ErrorCard(message: _error, onRetry: () => _load(force: true)),
                ],
                const SizedBox(height: 10),
                if (_loading && _rows.isEmpty)
                  ...List.generate(4, (_) => const _CreditSkeleton())
                else if (_rows.isEmpty)
                  const _EmptyCard()
                else
                  ..._rows.map(
                    (transaction) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _CreditCard(
                        transaction: transaction,
                        onTap: () => _openDetail(transaction),
                        onAdjust: () => _openAdjustment(_map(transaction['user'])),
                      ),
                    ),
                  ),
                if (_totalPages > 1) ...[
                  const SizedBox(height: 4),
                  _Pagination(
                    page: _page,
                    totalPages: _totalPages,
                    loading: _loading,
                    onPrevious: _page <= 1
                        ? null
                        : () {
                            setState(() => _page--);
                            _load();
                          },
                    onNext: _page >= _totalPages
                        ? null
                        : () {
                            setState(() => _page++);
                            _load();
                          },
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool get _hasFilters {
    return _fromDate != null ||
        _toDate != null ||
        _sortBy != 'createdAt' ||
        _sortOrder != 'desc';
  }
}

const _sortOptions = [
  AdminSelectionOption(
    value: 'createdAt',
    label: 'Transaction date',
    icon: Icons.calendar_today_outlined,
  ),
  AdminSelectionOption(
    value: 'amount',
    label: 'Credit amount',
    icon: Icons.toll_outlined,
  ),
  AdminSelectionOption(
    value: 'balanceAfter',
    label: 'Balance after',
    icon: Icons.account_balance_wallet_outlined,
  ),
  AdminSelectionOption(
    value: 'type',
    label: 'Movement type',
    icon: Icons.category_outlined,
  ),
];

class _LiveStrip extends StatelessWidget {
  const _LiveStrip({
    required this.total,
    required this.exporting,
    required this.refreshing,
    required this.onExport,
    required this.onRefresh,
  });

  final int total;
  final bool exporting;
  final bool refreshing;
  final VoidCallback? onExport;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      tint: AppColors.primarySoft.withValues(alpha: .65),
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      radius: 17,
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: AppColors.success,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Live credit ledger',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  '${_formatNumber(total)} transactions',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: onRefresh,
            icon: Icon(
              refreshing ? Icons.sync_rounded : Icons.refresh_rounded,
              color: AppColors.primary,
              size: 20,
            ),
          ),
          TextButton.icon(
            onPressed: onExport,
            icon: Icon(
              exporting ? Icons.sync_rounded : Icons.download_rounded,
              size: 15,
            ),
            label: Text(exporting ? 'Preparing…' : 'CSV'),
          ),
        ],
      ),
    );
  }
}

class _MetricData {
  const _MetricData({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
    required this.tone,
  });

  final IconData icon;
  final String label;
  final String value;
  final String hint;
  final Color tone;
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.items});

  final List<_MetricData> items;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 10) / 2;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: items
              .map(
                (item) => SizedBox(
                  width: width,
                  child: AdminGlassCard(
                    tint: item.tone,
                    padding: const EdgeInsets.all(13),
                    radius: 20,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.surface.withValues(alpha: .8),
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: Icon(item.icon, size: 17, color: AppColors.primary),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          item.value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.45,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.label,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.hint,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class _TypeScroller extends StatelessWidget {
  const _TypeScroller({
    required this.value,
    required this.total,
    required this.counts,
    required this.onChanged,
  });

  final String value;
  final int total;
  final Map<String, int> counts;
  final ValueChanged<String> onChanged;

  static const _items = [
    ('all', 'All', Icons.history_rounded),
    ('PURCHASE', 'Purchased', Icons.wallet_outlined),
    ('BONUS', 'Bonus', Icons.card_giftcard_outlined),
    ('DEDUCTION_GENERATION', 'Generation', Icons.auto_awesome_outlined),
    ('DEDUCTION_PUBLICATION_ADVANCED', 'Publication', Icons.description_outlined),
    ('REFUND', 'Refunded', Icons.replay_rounded),
    ('ADMIN_ADJUSTMENT', 'Admin', Icons.admin_panel_settings_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: _items.map((item) {
          final selected = value == item.$1;
          final count = item.$1 == 'all' ? total : counts[item.$1] ?? 0;
          return Padding(
            padding: const EdgeInsets.only(right: 7),
            child: Material(
              color: selected ? AppColors.primary : AppColors.surface,
              borderRadius: BorderRadius.circular(99),
              child: InkWell(
                onTap: () => onChanged(item.$1),
                borderRadius: BorderRadius.circular(99),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(
                      color: selected ? AppColors.primary : AppColors.borderStrong,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        item.$3,
                        size: 13,
                        color: selected ? Colors.white : AppColors.primary,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        item.$2,
                        style: TextStyle(
                          color: selected ? Colors.white : AppColors.textSecondary,
                          fontSize: 9.2,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        _formatNumber(count),
                        style: TextStyle(
                          color: selected
                              ? Colors.white.withValues(alpha: .88)
                              : AppColors.primary,
                          fontSize: 8.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
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
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 58,
          height: 58,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: active ? AppColors.primary.withValues(alpha: .5) : AppColors.border,
            ),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(Icons.tune_rounded, color: AppColors.primary, size: 22),
              if (active)
                Positioned(
                  top: 12,
                  right: 12,
                  child: Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      color: AppColors.pink,
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

class _CreditCard extends StatelessWidget {
  const _CreditCard({
    required this.transaction,
    required this.onTap,
    required this.onAdjust,
  });

  final Map<String, dynamic> transaction;
  final VoidCallback onTap;
  final VoidCallback onAdjust;

  @override
  Widget build(BuildContext context) {
    final user = _map(transaction['user']);
    final type = _string(transaction['type']).toUpperCase();
    final amount = _int(transaction['amount']);
    final positive = amount >= 0;
    final contextLabel = _contextLabel(transaction);

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(13),
      radius: 20,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AdminIconBadge(
                icon: _typeIcon(type),
                size: 46,
                tone: _typeTone(type),
                iconColor: positive ? AppColors.primary : AppColors.pink,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _string(user['fullName']).isEmpty
                          ? 'Platform user'
                          : _string(user['fullName']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _string(user['email']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.1,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _signed(amount),
                    style: TextStyle(
                      color: positive ? AppColors.primary : AppColors.pinkDeep,
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Text(
                    'credits',
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _InfoChip(icon: _typeIcon(type), label: _typeLabel(type)),
              _InfoChip(
                icon: Icons.account_balance_wallet_outlined,
                label: '${_formatNumber(_int(transaction['balanceAfter']))} balance',
              ),
              if (contextLabel.isNotEmpty)
                _InfoChip(icon: Icons.link_rounded, label: contextLabel),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              const Icon(Icons.schedule_rounded, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  _formatDate(transaction['createdAt']),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Material(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(11),
                child: InkWell(
                  onTap: onAdjust,
                  borderRadius: BorderRadius.circular(11),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    child: Row(
                      children: [
                        Icon(Icons.add_card_rounded, size: 13, color: AppColors.primary),
                        SizedBox(width: 4),
                        Text(
                          'Adjust',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded, color: AppColors.sage),
            ],
          ),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primary),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 160),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.4,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreditDetailSheet extends StatelessWidget {
  const _CreditDetailSheet({required this.transaction});

  final Map<String, dynamic> transaction;

  @override
  Widget build(BuildContext context) {
    final user = _map(transaction['user']);
    final payment = _map(transaction['payment']);
    final idea = _map(transaction['idea']);
    final acceptance = _map(transaction['publicationAcceptance']);
    final publication = _map(acceptance['publication']);
    final type = _string(transaction['type']).toUpperCase();
    final amount = _int(transaction['amount']);

    return DraggableScrollableSheet(
      initialChildSize: .86,
      minChildSize: .58,
      maxChildSize: .96,
      expand: false,
      builder: (context, controller) {
        return Container(
          margin: const EdgeInsets.fromLTRB(7, 0, 7, 7),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: AppColors.border),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(16, 9, 16, 24),
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 13),
              Row(
                children: [
                  AdminIconBadge(
                    icon: _typeIcon(type),
                    size: 45,
                    tone: _typeTone(type),
                    iconColor: AppColors.primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'CREDIT LEDGER RECORD',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.05,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${_signed(amount)} credits',
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
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
              const SizedBox(height: 13),
              _DetailSection(
                title: 'User & movement',
                icon: Icons.person_outline_rounded,
                children: [
                  _DetailRow('User', _string(user['fullName']).isEmpty ? 'Platform user' : _string(user['fullName'])),
                  _DetailRow('Email', _string(user['email'])),
                  _DetailRow('Movement type', _typeLabel(type)),
                  _DetailRow('Amount', '${_signed(amount)} credits'),
                  _DetailRow('Balance after', '${_formatNumber(_int(transaction['balanceAfter']))} credits'),
                  _DetailRow('Created', _formatDate(transaction['createdAt'], long: true)),
                ],
              ),
              const SizedBox(height: 10),
              _DetailSection(
                title: 'Ledger identifiers',
                icon: Icons.receipt_long_outlined,
                children: [
                  _DetailRow('Transaction ID', _string(transaction['id']), mono: true),
                  _DetailRow('User ID', _string(user['id']), mono: true),
                ],
              ),
              if (payment.isNotEmpty) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Payment source',
                  icon: Icons.payments_outlined,
                  children: [
                    _DetailRow('Payment ID', _string(payment['id']), mono: true),
                    _DetailRow('Payment amount', _string(payment['amount'])),
                    _DetailRow('Payment method', _titleCase(_string(payment['paymentMethodKey']))),
                    _DetailRow('Payment status', _titleCase(_string(payment['status']))),
                  ],
                ),
              ],
              if (idea.isNotEmpty) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Idea context',
                  icon: Icons.auto_awesome_outlined,
                  children: [
                    _DetailRow('Idea', _string(idea['title'])),
                    _DetailRow('Idea ID', _string(idea['id']), mono: true),
                  ],
                ),
              ],
              if (publication.isNotEmpty) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Publication context',
                  icon: Icons.description_outlined,
                  children: [
                    _DetailRow('Publication', _string(publication['publicTitle'])),
                    _DetailRow('Publication ID', _string(publication['id']), mono: true),
                    _DetailRow('Acceptance ID', _string(acceptance['id']), mono: true),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              _DetailSection(
                title: 'Description',
                icon: Icons.notes_rounded,
                children: [
                  _DetailRow(
                    'Reason',
                    _string(transaction['description']).isEmpty
                        ? 'No description recorded.'
                        : _string(transaction['description']),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: () => Navigator.pop(context, 'adjust'),
                icon: const Icon(Icons.add_card_rounded, size: 17),
                label: const Text('Adjust this user'),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _AdjustCreditsSheet extends StatefulWidget {
  const _AdjustCreditsSheet({this.initialUser});

  final Map<String, dynamic>? initialUser;

  @override
  State<_AdjustCreditsSheet> createState() => _AdjustCreditsSheetState();
}

class _AdjustCreditsSheetState extends State<_AdjustCreditsSheet> {
  final _api = AdminApi.instance;
  final _searchController = TextEditingController();
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();

  Timer? _debounce;
  List<Map<String, dynamic>> _users = const [];
  Map<String, dynamic>? _selectedUser;
  bool _loadingUsers = false;
  bool _saving = false;
  bool _deduct = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _selectedUser = widget.initialUser;
    if (_selectedUser == null || _selectedUser!.isEmpty) {
      _loadUsers();
    } else {
      _searchController.text = _string(
        _selectedUser!['email'] ?? _selectedUser!['fullName'],
      );
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() => _loadingUsers = true);
    try {
      final payload = await _api.getList(
        '/admin/users',
        page: 1,
        limit: 8,
        search: _searchController.text.trim(),
        sortBy: 'createdAt',
        sortOrder: 'desc',
      );
      if (!mounted) return;
      setState(() => _users = _list(payload['items']));
    } catch (_) {
      if (mounted) setState(() => _users = const []);
    } finally {
      if (mounted) setState(() => _loadingUsers = false);
    }
  }

  void _onSearch(String value) {
    if (_selectedUser != null) return;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 240), _loadUsers);
  }

  Future<void> _submit() async {
    if (_saving) return;
    final user = _selectedUser;
    final rawAmount = int.tryParse(_amountController.text.trim());
    final description = _descriptionController.text.trim();

    if (user == null || user.isEmpty) {
      setState(() => _error = 'Choose a user first.');
      return;
    }
    if (rawAmount == null || rawAmount <= 0) {
      setState(() => _error = 'Enter a positive whole credit amount.');
      return;
    }
    if (description.length < 5) {
      setState(() => _error = 'Administrative reason must be at least 5 characters.');
      return;
    }

    setState(() {
      _saving = true;
      _error = '';
    });

    try {
      await _api.adjustCredits(
        userId: _string(user['id']),
        amount: _deduct ? -rawAmount : rawAmount,
        description: description,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not adjust this credit balance.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selectedUser;

    return DraggableScrollableSheet(
      initialChildSize: .9,
      minChildSize: .62,
      maxChildSize: .97,
      expand: false,
      builder: (context, controller) {
        return Container(
          margin: const EdgeInsets.fromLTRB(7, 0, 7, 7),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: AppColors.border),
          ),
          child: ListView(
            controller: controller,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(16, 9, 16, 26),
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 13),
              Row(
                children: [
                  const AdminIconBadge(
                    icon: Icons.add_card_rounded,
                    size: 44,
                    tone: AppColors.primarySoft,
                    iconColor: AppColors.primary,
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'AUDITED CREDIT ACTION',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.05,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Adjust user credits',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
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
              const SizedBox(height: 14),
              if (selected == null || selected.isEmpty) ...[
                TextField(
                  controller: _searchController,
                  onChanged: _onSearch,
                  decoration: const InputDecoration(
                    labelText: 'Find user',
                    hintText: 'Search name or email…',
                    prefixIcon: Icon(Icons.search_rounded),
                  ),
                ),
                const SizedBox(height: 9),
                if (_loadingUsers)
                  const LinearProgressIndicator(
                    color: AppColors.primary,
                    backgroundColor: AppColors.primarySoft,
                  )
                else if (_users.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 18),
                    child: Text(
                      'No matching users found.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                else
                  ..._users.map(
                    (user) => Padding(
                      padding: const EdgeInsets.only(bottom: 7),
                      child: Material(
                        color: AppColors.background.withValues(alpha: .65),
                        borderRadius: BorderRadius.circular(15),
                        child: InkWell(
                          onTap: () {
                            setState(() {
                              _selectedUser = user;
                              _searchController.text = _string(
                                user['email'] ?? user['fullName'],
                              );
                            });
                          },
                          borderRadius: BorderRadius.circular(15),
                          child: Container(
                            padding: const EdgeInsets.all(11),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(15),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Row(
                              children: [
                                AdminAvatar(
                                  name: _string(user['fullName']),
                                  avatarUrl: _string(user['avatarUrl']),
                                  size: 38,
                                ),
                                const SizedBox(width: 9),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _string(user['fullName']).isEmpty
                                            ? 'Platform user'
                                            : _string(user['fullName']),
                                        style: const TextStyle(
                                          color: AppColors.textPrimary,
                                          fontSize: 10.5,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      Text(
                                        _string(user['email']),
                                        style: const TextStyle(
                                          color: AppColors.textMuted,
                                          fontSize: 8.7,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Text(
                                  '${_formatNumber(_int(user['creditBalance']))} cr',
                                  style: const TextStyle(
                                    color: AppColors.primary,
                                    fontSize: 9,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ] else ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft.withValues(alpha: .66),
                    borderRadius: BorderRadius.circular(17),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      AdminAvatar(
                        name: _string(selected['fullName']),
                        avatarUrl: _string(selected['avatarUrl']),
                        size: 42,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _string(selected['fullName']).isEmpty
                                  ? 'Platform user'
                                  : _string(selected['fullName']),
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            Text(
                              _string(selected['email']),
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.8,
                              ),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: widget.initialUser == null
                            ? () {
                                setState(() {
                                  _selectedUser = null;
                                  _searchController.clear();
                                  _users = const [];
                                });
                                _loadUsers();
                              }
                            : null,
                        child: const Text('Change'),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _MovementButton(
                      selected: !_deduct,
                      icon: Icons.add_circle_outline_rounded,
                      label: 'Add credits',
                      onTap: () => setState(() => _deduct = false),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _MovementButton(
                      selected: _deduct,
                      icon: Icons.remove_circle_outline_rounded,
                      label: 'Deduct credits',
                      onTap: () => setState(() => _deduct = true),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _amountController,
                enabled: !_saving,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Credit amount',
                  hintText: 'e.g. 10',
                  prefixIcon: Icon(Icons.toll_outlined),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _descriptionController,
                enabled: !_saving,
                minLines: 3,
                maxLines: 5,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Administrative reason',
                  hintText: 'Explain why this balance adjustment is required…',
                  prefixIcon: Icon(Icons.notes_rounded),
                ),
              ),
              if (_error.isNotEmpty) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.pinkSoft,
                    borderRadius: BorderRadius.circular(13),
                    border: Border.all(color: AppColors.pinkLight),
                  ),
                  child: Text(
                    _error,
                    style: const TextStyle(
                      color: AppColors.danger,
                      fontSize: 9.3,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _saving ? null : _submit,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.check_rounded, size: 18),
                label: Text(_saving ? 'Saving…' : 'Save adjustment'),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MovementButton extends StatelessWidget {
  const _MovementButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String label;
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
          height: 50,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.borderStrong,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.title,
    required this.icon,
    required this.children,
  });

  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .58),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          ...children,
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value, {this.mono = false});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 8.8,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value.trim().isEmpty ? '—' : value,
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: mono ? 8.6 : 9.2,
                fontWeight: FontWeight.w800,
                fontFamily: mono ? 'monospace' : null,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: const TextStyle(
        color: AppColors.primary,
        fontSize: 8.2,
        fontWeight: FontWeight.w900,
        letterSpacing: 1.05,
      ),
    );
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({required this.label, required this.value, required this.onTap});

  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.background.withValues(alpha: .68),
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          height: 58,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(Icons.calendar_month_outlined, size: 17, color: AppColors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      value == null ? 'Any date' : DateFormat('MMM d, yyyy').format(value!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                      ),
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
}

class _DirectionButton extends StatelessWidget {
  const _DirectionButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String label;
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
          height: 51,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.borderStrong,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.pinkLight),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline_rounded, color: AppColors.danger, size: 17),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _CreditSkeleton extends StatelessWidget {
  const _CreditSkeleton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        height: 126,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 150,
              height: 14,
              decoration: BoxDecoration(
                color: AppColors.mint.withValues(alpha: .65),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              width: 220,
              height: 10,
              decoration: BoxDecoration(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const Spacer(),
            Container(
              height: 32,
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard();

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 18),
      radius: 20,
      child: const Column(
        children: [
          Icon(Icons.toll_outlined, size: 28, color: AppColors.primary),
          SizedBox(height: 8),
          Text(
            'No credit movements match these filters.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _Pagination extends StatelessWidget {
  const _Pagination({
    required this.page,
    required this.totalPages,
    required this.loading,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final bool loading;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: loading ? null : onPrevious,
            icon: const Icon(Icons.chevron_left_rounded, size: 17),
            label: const Text('Previous'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Text(
            '$page / $totalPages',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        Expanded(
          child: FilledButton.tonalIcon(
            onPressed: loading ? null : onNext,
            icon: const Icon(Icons.chevron_right_rounded, size: 17),
            label: const Text('Next'),
          ),
        ),
      ],
    );
  }
}

String _startOfDayIso(DateTime value) {
  return DateTime(value.year, value.month, value.day).toIso8601String();
}

String _endOfDayIso(DateTime value) {
  return DateTime(value.year, value.month, value.day, 23, 59, 59, 999).toIso8601String();
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList();
}

int _int(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

String _string(dynamic value) => value?.toString().trim() ?? '';

String _formatNumber(int value) => NumberFormat.decimalPattern().format(value);

String _signed(int value) => value > 0 ? '+${_formatNumber(value)}' : _formatNumber(value);

String _formatDate(dynamic value, {bool long = false}) {
  final text = _string(value);
  if (text.isEmpty) return '—';
  final date = DateTime.tryParse(text)?.toLocal();
  if (date == null) return text;
  return DateFormat(long ? 'MMM d, yyyy · HH:mm' : 'MMM d, yyyy · HH:mm').format(date);
}

String _titleCase(String value) {
  if (value.trim().isEmpty) return '—';
  return value
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}')
      .join(' ');
}

String _typeLabel(String type) {
  return switch (type) {
    'PURCHASE' => 'Purchase',
    'BONUS' => 'Bonus',
    'DEDUCTION_GENERATION' => 'Generation',
    'DEDUCTION_PUBLICATION_ADVANCED' => 'Publication advanced',
    'REFUND' => 'Refund',
    'ADMIN_ADJUSTMENT' => 'Admin adjustment',
    _ => _titleCase(type),
  };
}

IconData _typeIcon(String type) {
  return switch (type) {
    'PURCHASE' => Icons.wallet_outlined,
    'BONUS' => Icons.card_giftcard_outlined,
    'DEDUCTION_GENERATION' => Icons.auto_awesome_outlined,
    'DEDUCTION_PUBLICATION_ADVANCED' => Icons.description_outlined,
    'REFUND' => Icons.replay_rounded,
    'ADMIN_ADJUSTMENT' => Icons.admin_panel_settings_outlined,
    _ => Icons.toll_outlined,
  };
}

Color _typeTone(String type) {
  return switch (type) {
    'PURCHASE' => AppColors.primarySoft,
    'BONUS' => AppColors.pinkSoft,
    'DEDUCTION_GENERATION' => const Color(0xFFFFF7EC),
    'DEDUCTION_PUBLICATION_ADVANCED' => const Color(0xFFFFF7EC),
    'REFUND' => const Color(0xFFEAF7F1),
    'ADMIN_ADJUSTMENT' => AppColors.background,
    _ => AppColors.primarySoft,
  };
}

String _contextLabel(Map<String, dynamic> transaction) {
  final payment = _map(transaction['payment']);
  if (payment.isNotEmpty) return 'Payment ${_shortId(payment['id'])}';
  final idea = _map(transaction['idea']);
  if (idea.isNotEmpty) {
    final title = _string(idea['title']);
    return title.isEmpty ? 'Idea ${_shortId(idea['id'])}' : title;
  }
  final acceptance = _map(transaction['publicationAcceptance']);
  final publication = _map(acceptance['publication']);
  if (publication.isNotEmpty) {
    final title = _string(publication['publicTitle']);
    return title.isEmpty ? 'Publication ${_shortId(publication['id'])}' : title;
  }
  return _string(transaction['description']);
}

String _shortId(dynamic value, [int length = 8]) {
  final text = _string(value);
  if (text.length <= length) return text;
  return text.substring(0, length);
}

String _sortLabel(String value) {
  for (final option in _sortOptions) {
    if (option.value == value) return option.label;
  }
  return 'Transaction date';
}
