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

class AdminPaymentsPage extends StatefulWidget {
  const AdminPaymentsPage({super.key});

  @override
  State<AdminPaymentsPage> createState() => _AdminPaymentsPageState();
}

class _AdminPaymentsPageState extends State<AdminPaymentsPage> {
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
  String _status = 'all';
  String _purpose = 'all';
  String _provider = 'all';
  String _method = 'all';
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

  Map<String, dynamic> _listExtra() {
    return {
      if (_purpose != 'all') 'paymentPurpose': _purpose,
      if (_provider != 'all') 'providerKey': _provider,
      if (_method != 'all') 'paymentMethodKey': _method,
      ..._dateQuery(),
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
        '/admin/payments',
        page: _page,
        limit: _pageSize,
        search: _search,
        status: _status == 'all' ? null : _status,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: _listExtra(),
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
      setState(() => _error = 'Could not load payment activity.');
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
          '/admin/payments/summary',
          force: force,
          query: _dateQuery(),
        ),
        _api.getSummary(
          '/admin/payments/charts',
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
      final bytes = await _api.exportPaymentsCsv(
        search: _search,
        status: _status == 'all' ? null : _status,
        paymentPurpose: _purpose == 'all' ? null : _purpose,
        paymentMethodKey: _method == 'all' ? null : _method,
        providerKey: _provider == 'all' ? null : _provider,
        fromDate: _fromDate == null ? null : _startOfDayIso(_fromDate!),
        toDate: _toDate == null ? null : _endOfDayIso(_toDate!),
        sortBy: _sortBy,
        sortOrder: _sortOrder,
      );

      if (bytes.isEmpty) {
        throw const ApiException('The payments CSV export was empty.');
      }

      if (!mounted) return;
      final box = context.findRenderObject() as RenderBox?;
      final origin = box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size;

      await SharePlus.instance.share(
        ShareParams(
          subject: 'Voxidence payments export',
          text: 'Payments administration export',
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: 'admin-payments.csv',
            ),
          ],
          sharePositionOrigin: origin,
        ),
      );
    } on ApiException catch (error) {
      if (mounted) _snack(error.message, error: true);
    } catch (_) {
      if (mounted) _snack('Could not export payments.', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _openFilters() async {
    var nextPurpose = _purpose;
    var nextProvider = _provider;
    var nextMethod = _method;
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
                maxHeight: MediaQuery.sizeOf(context).height * .91,
              ),
              margin: const EdgeInsets.fromLTRB(7, 0, 7, 7),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: AppColors.border),
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
                                'PAYMENT FILTERS',
                                style: TextStyle(
                                  color: AppColors.primary,
                                  fontSize: 8.4,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 1.05,
                                ),
                              ),
                              SizedBox(height: 3),
                              Text(
                                'Filter & sort payments',
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
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                      children: [
                        AdminSelectionField(
                          label: 'Payment purpose',
                          icon: Icons.category_outlined,
                          value: nextPurpose,
                          options: _purposeOptions,
                          onChanged: (value) {
                            setSheetState(() => nextPurpose = value);
                          },
                        ),
                        const SizedBox(height: 10),
                        AdminSelectionField(
                          label: 'Gateway provider',
                          icon: Icons.hub_outlined,
                          value: nextProvider,
                          options: _providerOptions(),
                          onChanged: (value) {
                            setSheetState(() => nextProvider = value);
                          },
                        ),
                        const SizedBox(height: 10),
                        AdminSelectionField(
                          label: 'Payment method',
                          icon: Icons.credit_card_outlined,
                          value: nextMethod,
                          options: _methodOptions(),
                          onChanged: (value) {
                            setSheetState(() => nextMethod = value);
                          },
                        ),
                        const SizedBox(height: 18),
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
                        const _SectionLabel('SORT PAYMENTS'),
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
                                    nextPurpose = 'all';
                                    nextProvider = 'all';
                                    nextMethod = 'all';
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
      _purpose = nextPurpose;
      _provider = nextProvider;
      _method = nextMethod;
      _sortBy = nextSortBy;
      _sortOrder = nextSortOrder;
      _fromDate = nextFrom;
      _toDate = nextTo;
      _page = 1;
    });
    _load();
  }

  List<AdminSelectionOption> _providerOptions() {
    final counts = <String, int>{};
    final labels = <String, String>{'stripe': 'Stripe'};

    for (final item in _list(_charts['paymentsByProvider'])) {
      final key = _string(
        item['providerKey'] ?? item['key'] ?? item['label'],
      ).toLowerCase();
      if (key.isEmpty) continue;
      labels[key] = key == 'stripe' ? 'Stripe' : _titleCase(key);
      counts[key] = _int(item['count']);
    }

    for (final row in _rows) {
      final key = _string(row['providerKey']).toLowerCase();
      if (key.isEmpty) continue;
      labels.putIfAbsent(
        key,
        () => key == 'stripe' ? 'Stripe' : _titleCase(key),
      );
    }

    if (_provider != 'all') {
      labels.putIfAbsent(_provider, () => _titleCase(_provider));
    }

    final keys = labels.keys.toList()
      ..sort((a, b) => labels[a]!.compareTo(labels[b]!));

    return [
      const AdminSelectionOption(
        value: 'all',
        label: 'All providers',
        icon: Icons.hub_outlined,
      ),
      ...keys.map(
        (key) => AdminSelectionOption(
          value: key,
          label: labels[key]!,
          icon: Icons.hub_outlined,
          description: counts.containsKey(key)
              ? '${counts[key]} payments'
              : key == 'stripe'
                  ? 'Secure card gateway'
                  : null,
        ),
      ),
    ];
  }

  List<AdminSelectionOption> _methodOptions() {
    final counts = <String, int>{};
    final labels = <String, String>{'card': 'Card'};

    for (final item in _list(_charts['paymentsByPaymentMethod'])) {
      final key = _string(
        item['paymentMethodKey'] ?? item['key'] ?? item['label'],
      ).toLowerCase();
      if (key.isEmpty) continue;
      labels[key] = key == 'card' ? 'Card' : _titleCase(key);
      counts[key] = _int(item['count']);
    }

    for (final row in _rows) {
      final key = _string(row['paymentMethodKey']).toLowerCase();
      if (key.isEmpty) continue;
      labels.putIfAbsent(
        key,
        () => key == 'card' ? 'Card' : _titleCase(key),
      );
    }

    if (_method != 'all') {
      labels.putIfAbsent(_method, () => _titleCase(_method));
    }

    final keys = labels.keys.toList()
      ..sort((a, b) => labels[a]!.compareTo(labels[b]!));

    return [
      const AdminSelectionOption(
        value: 'all',
        label: 'All payment methods',
        icon: Icons.credit_card_outlined,
      ),
      ...keys.map(
        (key) => AdminSelectionOption(
          value: key,
          label: labels[key]!,
          icon: Icons.credit_card_outlined,
          description: counts.containsKey(key)
              ? '${counts[key]} payments'
              : key == 'card'
                  ? 'Card checkout'
                  : null,
        ),
      ),
    ];
  }

  Future<void> _openDetail(Map<String, dynamic> payment) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.graphite.withValues(alpha: .18),
      builder: (context) => _PaymentDetailSheet(payment: payment),
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

  @override
  Widget build(BuildContext context) {
    final totalPayments = _int(_summary['totalPayments'] ?? _total);
    final successful = _int(_summary['successfulPayments']);
    final pending = _int(_summary['pendingPayments']);
    final failed = _int(_summary['failedPayments']);
    final refunded = _int(_summary['refundedPayments']);
    final successRate = totalPayments == 0 ? 0.0 : successful * 100 / totalPayments;

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
                  title: 'Payments',
                  subtitle:
                      'Monitor revenue, transaction health, purchase purpose and gateway activity.',
                  eyebrow: 'Finance',
                  icon: Icons.payments_outlined,
                  onBack: () => Navigator.maybePop(context),
                  trailing: _HeaderAction(
                    icon: _refreshing ? Icons.sync_rounded : Icons.refresh_rounded,
                    onTap: _refreshing ? null : () => _load(force: true, quiet: true),
                  ),
                ),
                const SizedBox(height: 14),
                _LiveStrip(
                  label: 'Live billing ledger',
                  value: '$totalPayments transactions',
                  actionLabel: _exporting ? 'Preparing…' : 'Export CSV',
                  actionIcon: _exporting ? Icons.sync_rounded : Icons.download_rounded,
                  onAction: _exporting ? null : _exportCsv,
                ),
                const SizedBox(height: 14),
                _MetricGrid(
                  items: [
                    _MetricData(
                      icon: Icons.account_balance_wallet_outlined,
                      label: 'Revenue',
                      value: _money(_summary['totalRevenue'], 'USD'),
                      hint: 'Captured value',
                      tone: AppColors.primarySoft,
                    ),
                    _MetricData(
                      icon: Icons.check_circle_outline_rounded,
                      label: 'Successful',
                      value: _formatNumber(successful),
                      hint: '${successRate.toStringAsFixed(1)}% success',
                      tone: const Color(0xFFEAF7F1),
                    ),
                    _MetricData(
                      icon: Icons.schedule_rounded,
                      label: 'Pending',
                      value: _formatNumber(pending),
                      hint: 'Awaiting confirmation',
                      tone: const Color(0xFFFFF7EC),
                    ),
                    _MetricData(
                      icon: Icons.error_outline_rounded,
                      label: 'Needs attention',
                      value: _formatNumber(failed),
                      hint: '$refunded refunded',
                      tone: AppColors.pinkSoft,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _BillingSnapshot(summary: _summary, charts: _charts),
                const SizedBox(height: 14),
                _StatusScroller(
                  value: _status,
                  counts: {
                    'all': totalPayments,
                    'SUCCEEDED': successful,
                    'PENDING': pending,
                    'FAILED': failed,
                    'REFUNDED': refunded,
                  },
                  onChanged: (value) {
                    if (value == _status) return;
                    setState(() {
                      _status = value;
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
                          hintText: 'Search customer name or email…',
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
                    _FilterButton(
                      active: _hasFilters,
                      onTap: _openFilters,
                    ),
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
                  ...List.generate(4, (_) => const _PaymentSkeleton())
                else if (_rows.isEmpty)
                  const _EmptyCard()
                else
                  ..._rows.map(
                    (payment) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _PaymentCard(
                        payment: payment,
                        onTap: () => _openDetail(payment),
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
    return _purpose != 'all' ||
        _provider != 'all' ||
        _method != 'all' ||
        _fromDate != null ||
        _toDate != null ||
        _sortBy != 'createdAt' ||
        _sortOrder != 'desc';
  }
}

const _purposeOptions = [
  AdminSelectionOption(
    value: 'all',
    label: 'All purposes',
    icon: Icons.category_outlined,
  ),
  AdminSelectionOption(
    value: 'BUY_CREDITS',
    label: 'Buy credits',
    icon: Icons.toll_outlined,
  ),
  AdminSelectionOption(
    value: 'DIRECT_UNLOCK',
    label: 'Direct unlock',
    icon: Icons.key_outlined,
  ),
  AdminSelectionOption(
    value: 'ACCEPT_PUBLICATION',
    label: 'Accept publication',
    icon: Icons.verified_outlined,
  ),
  AdminSelectionOption(
    value: 'UNLOCK_PUBLICATION_ADVANCED',
    label: 'Publication advanced',
    icon: Icons.layers_outlined,
  ),
];

const _sortOptions = [
  AdminSelectionOption(
    value: 'createdAt',
    label: 'Payment date',
    icon: Icons.calendar_today_outlined,
  ),
  AdminSelectionOption(
    value: 'amount',
    label: 'Amount',
    icon: Icons.payments_outlined,
  ),
  AdminSelectionOption(
    value: 'status',
    label: 'Status',
    icon: Icons.flag_outlined,
  ),
  AdminSelectionOption(
    value: 'paymentPurpose',
    label: 'Purpose',
    icon: Icons.category_outlined,
  ),
  AdminSelectionOption(
    value: 'creditsAmount',
    label: 'Credits amount',
    icon: Icons.toll_outlined,
  ),
];

class _HeaderAction extends StatelessWidget {
  const _HeaderAction({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: AppColors.border),
          ),
          child: Icon(icon, color: AppColors.primary, size: 21),
        ),
      ),
    );
  }
}

class _LiveStrip extends StatelessWidget {
  const _LiveStrip({
    required this.label,
    required this.value,
    required this.actionLabel,
    required this.actionIcon,
    required this.onAction,
  });

  final String label;
  final String value;
  final String actionLabel;
  final IconData actionIcon;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      tint: AppColors.primarySoft.withValues(alpha: .68),
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
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          TextButton.icon(
            onPressed: onAction,
            icon: Icon(actionIcon, size: 15),
            label: Text(actionLabel),
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
                    radius: 20,
                    padding: const EdgeInsets.all(13),
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
                            letterSpacing: -.5,
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

class _BillingSnapshot extends StatelessWidget {
  const _BillingSnapshot({required this.summary, required this.charts});

  final Map<String, dynamic> summary;
  final Map<String, dynamic> charts;

  @override
  Widget build(BuildContext context) {
    final topUsers = _list(charts['topPayingUsers']);
    final topUser = topUsers.isEmpty ? null : topUsers.first;
    final user = topUser == null ? const <String, dynamic>{} : _map(topUser['user']);
    final topName = _string(user['fullName'] ?? user['email']);

    return AdminGlassCard(
      padding: const EdgeInsets.all(13),
      radius: 19,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.insights_outlined, size: 17, color: AppColors.primary),
              SizedBox(width: 7),
              Text(
                'Billing snapshot',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _MiniFact(
                icon: Icons.toll_outlined,
                label: '${_formatNumber(_int(summary['creditsSold']))} credits sold',
              ),
              _MiniFact(
                icon: Icons.replay_rounded,
                label: '${_money(summary['totalRefunds'], 'USD')} refunded',
              ),
              _MiniFact(
                icon: Icons.add_card_outlined,
                label: '${_formatNumber(_int(summary['creditPurchasePayments']))} credit purchases',
              ),
              _MiniFact(
                icon: Icons.key_outlined,
                label: '${_formatNumber(_int(summary['directUnlockPayments']))} direct unlocks',
              ),
              if (topName.isNotEmpty)
                _MiniFact(
                  icon: Icons.workspace_premium_outlined,
                  label: 'Top payer · $topName',
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniFact extends StatelessWidget {
  const _MiniFact({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.primary),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.8,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusScroller extends StatelessWidget {
  const _StatusScroller({
    required this.value,
    required this.counts,
    required this.onChanged,
  });

  final String value;
  final Map<String, int> counts;
  final ValueChanged<String> onChanged;

  static const _items = [
    ('all', 'All'),
    ('SUCCEEDED', 'Succeeded'),
    ('PENDING', 'Pending'),
    ('FAILED', 'Failed'),
    ('REFUNDED', 'Refunded'),
  ];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: _items.map((item) {
          final selected = value == item.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 7),
            child: Material(
              color: selected ? AppColors.primary : AppColors.surface,
              borderRadius: BorderRadius.circular(99),
              child: InkWell(
                onTap: () => onChanged(item.$1),
                borderRadius: BorderRadius.circular(99),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(
                      color: selected ? AppColors.primary : AppColors.borderStrong,
                    ),
                  ),
                  child: Row(
                    children: [
                      Text(
                        item.$2,
                        style: TextStyle(
                          color: selected ? Colors.white : AppColors.textSecondary,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        _formatNumber(counts[item.$1] ?? 0),
                        style: TextStyle(
                          color: selected
                              ? Colors.white.withValues(alpha: .88)
                              : AppColors.primary,
                          fontSize: 8.7,
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

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.payment, required this.onTap});

  final Map<String, dynamic> payment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = _map(payment['user']);
    final name = _string(user['fullName']).isEmpty
        ? 'Platform user'
        : _string(user['fullName']);
    final email = _string(user['email']);
    final status = _string(payment['status']).toUpperCase();
    final purpose = _string(payment['paymentPurpose']).toUpperCase();
    final currency = _string(payment['currency']).isEmpty
        ? 'USD'
        : _string(payment['currency']);

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
                icon: _purposeIcon(purpose),
                size: 46,
                tone: _purposeTone(purpose),
                iconColor: AppColors.primary,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
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
                      email.isEmpty ? 'Payment ${_shortId(payment['id'])}' : email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.2,
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
                    _money(payment['amount'], currency),
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  _StatusPill(status: status),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _InfoChip(
                icon: _purposeIcon(purpose),
                label: _purposeLabel(purpose),
              ),
              _InfoChip(
                icon: Icons.hub_outlined,
                label: _titleCase(_string(payment['providerKey'])),
              ),
              _InfoChip(
                icon: Icons.credit_card_outlined,
                label: _titleCase(_string(payment['paymentMethodKey'])),
              ),
              if (_int(payment['creditsAmount']) > 0)
                _InfoChip(
                  icon: Icons.toll_outlined,
                  label: '${_formatNumber(_int(payment['creditsAmount']))} credits',
                ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              const Icon(Icons.schedule_rounded, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  _formatDate(payment['createdAt']),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.sage),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final tone = switch (status) {
      'SUCCEEDED' => const Color(0xFFE8F7F0),
      'PENDING' => const Color(0xFFFFF5E8),
      'FAILED' => AppColors.pinkSoft,
      'REFUNDED' => AppColors.primarySoft,
      _ => AppColors.background,
    };
    final foreground = switch (status) {
      'FAILED' => AppColors.danger,
      'PENDING' => AppColors.warning,
      _ => AppColors.primary,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        _titleCase(status),
        style: TextStyle(
          color: foreground,
          fontSize: 8.2,
          fontWeight: FontWeight.w900,
        ),
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
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(
              label.isEmpty ? '—' : label,
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

class _PaymentDetailSheet extends StatelessWidget {
  const _PaymentDetailSheet({required this.payment});

  final Map<String, dynamic> payment;

  @override
  Widget build(BuildContext context) {
    final user = _map(payment['user']);
    final invoice = _map(payment['invoice']);
    final idea = _map(payment['idea']);
    final status = _string(payment['status']).toUpperCase();
    final purpose = _string(payment['paymentPurpose']).toUpperCase();
    final currency = _string(payment['currency']).isEmpty
        ? 'USD'
        : _string(payment['currency']);

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
                    icon: _purposeIcon(purpose),
                    size: 45,
                    tone: _purposeTone(purpose),
                    iconColor: AppColors.primary,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'PAYMENT RECORD',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.1,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _money(payment['amount'], currency),
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(status: status),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _DetailSection(
                title: 'Customer & purpose',
                icon: Icons.person_outline_rounded,
                children: [
                  _DetailRow('Customer', _string(user['fullName']).isEmpty ? 'Platform user' : _string(user['fullName'])),
                  _DetailRow('Email', _string(user['email'])),
                  _DetailRow('Purpose', _purposeLabel(purpose)),
                  _DetailRow('Payment method', _titleCase(_string(payment['paymentMethodKey']))),
                  _DetailRow('Provider', _titleCase(_string(payment['providerKey']))),
                ],
              ),
              const SizedBox(height: 10),
              _DetailSection(
                title: 'Transaction identifiers',
                icon: Icons.receipt_long_outlined,
                children: [
                  _DetailRow('Payment ID', _string(payment['id']), mono: true),
                  _DetailRow('Transaction reference', _string(payment['transactionReference']), mono: true),
                  _DetailRow('Provider payment ID', _string(payment['providerPaymentId']), mono: true),
                  _DetailRow('Provider session ID', _string(payment['providerSessionId']), mono: true),
                ],
              ),
              if (_int(payment['creditsAmount']) > 0 ||
                  _int(payment['bonusCreditsAmount']) > 0 ||
                  payment['activatesPremium'] == true) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Credits & premium',
                  icon: Icons.toll_outlined,
                  children: [
                    if (_int(payment['creditsAmount']) > 0)
                      _DetailRow('Credits purchased', _formatNumber(_int(payment['creditsAmount']))),
                    if (_int(payment['bonusCreditsAmount']) > 0)
                      _DetailRow('Bonus credits', _formatNumber(_int(payment['bonusCreditsAmount']))),
                    if (payment['creditPriceAtPurchase'] != null)
                      _DetailRow('Credit unit price', _money(payment['creditPriceAtPurchase'], currency)),
                    if (payment['activatesPremium'] == true)
                      const _DetailRow('Premium activation', 'Included'),
                    if (payment['premiumActivationFeeAtPurchase'] != null)
                      _DetailRow('Premium activation fee', _money(payment['premiumActivationFeeAtPurchase'], currency)),
                  ],
                ),
              ],
              if (idea.isNotEmpty || _string(payment['publicationId']).isNotEmpty) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Related content',
                  icon: Icons.auto_awesome_outlined,
                  children: [
                    if (idea.isNotEmpty)
                      _DetailRow('Idea', _string(idea['title'] ?? idea['id'])),
                    if (_string(payment['publicationId']).isNotEmpty)
                      _DetailRow('Publication ID', _string(payment['publicationId']), mono: true),
                  ],
                ),
              ],
              if (invoice.isNotEmpty) ...[
                const SizedBox(height: 10),
                _DetailSection(
                  title: 'Invoice',
                  icon: Icons.description_outlined,
                  children: [
                    _DetailRow('Invoice number', _string(invoice['invoiceNumber']), mono: true),
                    _DetailRow('Invoice status', _titleCase(_string(invoice['status']))),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              _DetailSection(
                title: 'Timeline',
                icon: Icons.schedule_rounded,
                children: [
                  _DetailRow('Created', _formatDate(payment['createdAt'], long: true)),
                  _DetailRow('Updated', _formatDate(payment['updatedAt'], long: true)),
                  if (payment['paidAt'] != null)
                    _DetailRow('Paid at', _formatDate(payment['paidAt'], long: true)),
                  if (payment['failedAt'] != null)
                    _DetailRow('Failed at', _formatDate(payment['failedAt'], long: true)),
                  if (payment['refundedAt'] != null)
                    _DetailRow('Refunded at', _formatDate(payment['refundedAt'], long: true)),
                ],
              ),
              if (_string(payment['failureReason']).isNotEmpty) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.pinkSoft,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.pinkLight),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.error_outline_rounded, size: 17, color: AppColors.danger),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Failure reason',
                              style: TextStyle(
                                color: AppColors.danger,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _string(payment['failureReason']),
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 9.5,
                                height: 1.4,
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
        );
      },
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

class _PaymentSkeleton extends StatelessWidget {
  const _PaymentSkeleton();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        height: 132,
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
              width: 165,
              height: 14,
              decoration: BoxDecoration(
                color: AppColors.mint.withValues(alpha: .65),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 10),
            Container(
              width: 225,
              height: 10,
              decoration: BoxDecoration(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const Spacer(),
            Container(
              height: 34,
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
          Icon(Icons.payments_outlined, size: 28, color: AppColors.primary),
          SizedBox(height: 8),
          Text(
            'No payments match these filters.',
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

double _double(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

String _string(dynamic value) => value?.toString().trim() ?? '';

String _formatNumber(int value) => NumberFormat.decimalPattern().format(value);

String _money(dynamic value, String currency) {
  final amount = _double(value);
  final normalized = currency.trim().isEmpty ? 'USD' : currency.trim().toUpperCase();
  try {
    return NumberFormat.simpleCurrency(name: normalized).format(amount);
  } catch (_) {
    return '${amount.toStringAsFixed(2)} $normalized';
  }
}

String _formatDate(dynamic value, {bool long = false}) {
  final text = _string(value);
  if (text.isEmpty) return '—';
  final date = DateTime.tryParse(text)?.toLocal();
  if (date == null) return text;
  return DateFormat(long ? 'MMM d, yyyy · HH:mm' : 'MMM d, yyyy · HH:mm').format(date);
}

String _shortId(dynamic value, [int length = 8]) {
  final text = _string(value);
  if (text.length <= length) return text;
  return text.substring(0, length);
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

String _purposeLabel(String purpose) {
  return switch (purpose) {
    'BUY_CREDITS' => 'Buy credits',
    'DIRECT_UNLOCK' => 'Direct unlock',
    'ACCEPT_PUBLICATION' => 'Accept publication',
    'UNLOCK_PUBLICATION_ADVANCED' => 'Publication advanced',
    _ => _titleCase(purpose),
  };
}

IconData _purposeIcon(String purpose) {
  return switch (purpose) {
    'BUY_CREDITS' => Icons.toll_outlined,
    'DIRECT_UNLOCK' => Icons.key_outlined,
    'ACCEPT_PUBLICATION' => Icons.verified_outlined,
    'UNLOCK_PUBLICATION_ADVANCED' => Icons.layers_outlined,
    _ => Icons.receipt_long_outlined,
  };
}

Color _purposeTone(String purpose) {
  return switch (purpose) {
    'BUY_CREDITS' => AppColors.primarySoft,
    'DIRECT_UNLOCK' => const Color(0xFFFFF7EC),
    'ACCEPT_PUBLICATION' => const Color(0xFFEAF7F1),
    'UNLOCK_PUBLICATION_ADVANCED' => AppColors.pinkSoft,
    _ => AppColors.background,
  };
}

String _sortLabel(String value) {
  for (final option in _sortOptions) {
    if (option.value == value) return option.label;
  }
  return 'Payment date';
}
