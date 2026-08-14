import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../api/ai_models_api.dart';
import '../widgets/admin_ui.dart';
import '../widgets/admin_selection_field.dart';

class AdminAiMonitoringPage extends StatefulWidget {
  const AdminAiMonitoringPage({super.key});

  @override
  State<AdminAiMonitoringPage> createState() => _AdminAiMonitoringPageState();
}

class _AdminAiMonitoringPageState extends State<AdminAiMonitoringPage> {
  static const int _pageSize = 20;

  final AdminApi _api = AdminApi.instance;
  final AiModelsApi _modelsApi = AiModelsApi.instance;
  final TextEditingController _searchController = TextEditingController();

  Timer? _searchDebounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _rows = const [];
  List<Map<String, dynamic>> _configuredProviders = const [];
  Map<String, dynamic> _summary = const {};
  Map<String, dynamic> _baseSummary = const {};
  Map<String, dynamic> _charts = const {};

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  String _search = '';
  String _status = 'all';
  String _execution = 'all';
  String _providerKey = 'all';
  String _requestType = 'all';
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

    unawaited(_loadProviderCatalog());
    _load();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();

    super.dispose();
  }

  Future<void> _loadProviderCatalog({bool force = false}) async {
    try {
      final providers = await _modelsApi.providers(force: force);
      if (!mounted) return;
      setState(() {
        _configuredProviders = providers;
      });
    } catch (_) {}
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

    final commonQuery = _commonQuery();
    final activeQuery = _activeQuery();
    final listExtra = <String, dynamic>{...activeQuery}..remove('search');

    unawaited(
      _api
          .getSummary(
            '/admin/ai-monitoring/summary',
            force: force,
            query: activeQuery,
          )
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _summary = value);
          })
          .catchError((_) {}),
    );

    unawaited(
      _api
          .getSummary(
            '/admin/ai-monitoring/summary',
            force: force,
            query: commonQuery,
          )
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _baseSummary = value);
          })
          .catchError((_) {}),
    );

    unawaited(
      _api
          .getSummary(
            '/admin/ai-monitoring/charts',
            force: force,
            query: _dateOnlyQuery(),
          )
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _charts = value);
          })
          .catchError((_) {}),
    );

    try {
      final listPayload = await _api.getList(
        '/admin/ai-monitoring/logs',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: listExtra,
      );

      if (!mounted || requestId != _requestId) return;

      final meta = _asMap(listPayload['meta']);
      final rows = (listPayload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

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
      setState(() => _error = 'Could not load AI monitoring requests.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Map<String, dynamic> _commonQuery() {
    return {
      if (_search.isNotEmpty) 'search': _search,
      if (_providerKey != 'all') 'providerKey': _providerKey,
      if (_requestType != 'all') 'requestType': _requestType,
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
    };
  }

  Map<String, dynamic> _activeQuery() {
    final query = <String, dynamic>{..._commonQuery()};

    if (_status == 'success') {
      query['isSuccess'] = true;
    } else if (_status == 'failed') {
      query['isSuccess'] = false;
    }

    if (_execution == 'retryable') {
      query['isSuccess'] = false;
      query['isRetryable'] = true;
    } else if (_execution == 'fallback') {
      query['fallbackUsed'] = true;
    }

    return query;
  }

  Map<String, dynamic> _dateOnlyQuery() {
    return {
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
    };
  }

  void _onSearchChanged(String value) {
    setState(() {});

    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      final next = value.trim();

      if (next == _search || !mounted) {
        return;
      }

      setState(() {
        _search = next;
        _page = 1;
      });

      _load();
    });
  }

  void _selectStatus(String status) {
    if (_status == status) {
      return;
    }

    setState(() {
      _status = status;
      _page = 1;

      if (_status == 'success' && _execution == 'retryable') {
        _execution = 'all';
      }
    });

    _load();
  }

  Future<void> _exportCsv() async {
    if (_exporting) return;

    setState(() => _exporting = true);

    try {
      final bytes = await ApiClient.instance.getBytes(
        '/admin/ai-monitoring/logs/export/csv',
        query: {
          ..._activeQuery(),
          'sortBy': _sortBy,
          'sortOrder': _sortOrder,
        },
      );

      if (bytes.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No diagnostics were available to export.'),
          ),
        );
        return;
      }

      if (!mounted) return;

      final box = context.findRenderObject() as RenderBox?;
      final shareOrigin = box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size;

      await SharePlus.instance.share(
        ShareParams(
          subject: 'AI monitoring diagnostics',
          text: 'Voxidence AI monitoring diagnostics export',
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: 'ai-monitoring-diagnostics.csv',
            ),
          ],
          sharePositionOrigin: shareOrigin,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not export AI diagnostics.')),
      );
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _openFilters() async {
    var nextProvider = _providerKey;
    var nextRequestType = _requestType;
    var nextExecution = _execution;
    var nextSortBy = _sortBy;
    var nextSortOrder = _sortOrder;
    var nextFrom = _fromDate;
    var nextTo = _toDate;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return SafeArea(
              child: Container(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * .88,
                ),
                margin: const EdgeInsets.fromLTRB(10, 18, 10, 10),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 10, 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'REQUEST FILTERS',
                                  style: TextStyle(
                                    color: AppColors.primary,
                                    fontSize: 8.8,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 1.1,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Refine diagnostics',
                                  style: Theme.of(context).textTheme.titleLarge,
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
                        padding: const EdgeInsets.all(16),
                        children: [
                          _FilterSelect(
                            label: 'Provider',
                            icon: Icons.dns_outlined,
                            value: nextProvider,
                            options: _providerOptions(),
                            onChanged: (value) {
                              setModalState(() {
                                nextProvider = value;
                              });
                            },
                          ),
                          const SizedBox(height: 12),
                          _FilterSelect(
                            label: 'Request type',
                            icon: Icons.smart_toy_outlined,
                            value: nextRequestType,
                            options: _requestTypeOptions(),
                            onChanged: (value) {
                              setModalState(() {
                                nextRequestType = value;
                              });
                            },
                          ),
                          const SizedBox(height: 12),
                          _FilterSelect(
                            label: 'Execution path',
                            icon: Icons.account_tree_outlined,
                            value: nextExecution,
                            options: const [
                              _FilterOption('all', 'All execution paths'),
                              _FilterOption('retryable', 'Retryable failures'),
                              _FilterOption('fallback', 'Fallback attempts'),
                            ],
                            onChanged: (value) {
                              setModalState(() {
                                nextExecution = value;
                              });
                            },
                          ),
                          const SizedBox(height: 18),
                          const _SectionLabel('DATE RANGE'),
                          const SizedBox(height: 9),
                          Row(
                            children: [
                              Expanded(
                                child: _DateFilterButton(
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

                                    if (picked == null) {
                                      return;
                                    }

                                    setModalState(() {
                                      nextFrom = picked;

                                      if (nextTo != null &&
                                          picked.isAfter(nextTo!)) {
                                        nextTo = picked;
                                      }
                                    });
                                  },
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _DateFilterButton(
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

                                    if (picked == null) {
                                      return;
                                    }

                                    setModalState(() {
                                      nextTo = picked;

                                      if (nextFrom != null &&
                                          picked.isBefore(nextFrom!)) {
                                        nextFrom = picked;
                                      }
                                    });
                                  },
                                ),
                              ),
                            ],
                          ),
                          if (nextFrom != null || nextTo != null) ...[
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                onPressed: () {
                                  setModalState(() {
                                    nextFrom = null;
                                    nextTo = null;
                                  });
                                },
                                icon: const Icon(Icons.close_rounded, size: 16),
                                label: const Text('Clear date range'),
                              ),
                            ),
                          ],
                          const SizedBox(height: 14),
                          const _SectionLabel('SORT REQUESTS'),
                          const SizedBox(height: 9),
                          _FilterSelect(
                            label: 'Sort by',
                            icon: Icons.sort_rounded,
                            value: nextSortBy,
                            options: const [
                              _FilterOption('createdAt', 'Request date'),
                              _FilterOption('responseTimeMs', 'Latency'),
                              _FilterOption('costEstimate', 'Estimated cost'),
                              _FilterOption('attemptNumber', 'Attempt number'),
                              _FilterOption('providerKey', 'Provider'),
                              _FilterOption('requestType', 'Request type'),
                            ],
                            onChanged: (value) {
                              setModalState(() {
                                nextSortBy = value;
                              });
                            },
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: _OrderChoice(
                                  label: 'Ascending',
                                  icon: Icons.arrow_upward_rounded,
                                  selected: nextSortOrder == 'asc',
                                  onTap: () {
                                    setModalState(() {
                                      nextSortOrder = 'asc';
                                    });
                                  },
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _OrderChoice(
                                  label: 'Descending',
                                  icon: Icons.arrow_downward_rounded,
                                  selected: nextSortOrder == 'desc',
                                  onTap: () {
                                    setModalState(() {
                                      nextSortOrder = 'desc';
                                    });
                                  },
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
                      child: Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () {
                                setModalState(() {
                                  nextProvider = 'all';
                                  nextRequestType = 'all';
                                  nextExecution = 'all';
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
                            child: FilledButton(
                              onPressed: () =>
                                  Navigator.pop(sheetContext, true),
                              child: const Text('Apply filters'),
                            ),
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

    if (applied != true || !mounted) {
      return;
    }

    setState(() {
      _providerKey = nextProvider;
      _requestType = nextRequestType;
      _execution = nextExecution;
      _sortBy = nextSortBy;
      _sortOrder = nextSortOrder;
      _fromDate = nextFrom;
      _toDate = nextTo;
      _page = 1;

      if (_execution == 'retryable') {
        _status = 'failed';
      }
    });

    _load();
  }

  Future<void> _openDetails(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _AiRequestDetailsSheet(initialRow: row),
    );
  }

  List<_FilterOption> _providerOptions() {
    final labels = <String, String>{};

    void add(String rawKey, [String? rawLabel]) {
      final key = rawKey.trim().toLowerCase();
      if (key.isEmpty || key == 'all') return;
      final label = (rawLabel ?? '').trim();
      labels[key] = label.isEmpty ? _providerLabel(key) : label;
    }

    for (final provider in _configuredProviders) {
      final key = _text(provider['key']);
      final label = _text(provider['displayName'] ?? provider['name']);
      add(key, label);
    }

    final rawProviders = _charts['requestsByProvider'];
    if (rawProviders is List) {
      for (final item in rawProviders.whereType<Map>()) {
        final map = Map<String, dynamic>.from(item);
        final key = _text(map['providerKey'] ?? map['key'] ?? map['label']);
        add(key);
      }
    }

    for (final row in _rows) {
      add(_text(row['providerKey']));
    }

    if (_providerKey != 'all') {
      add(_providerKey);
    }

    if (labels.isEmpty) {
      add('google', 'Google AI');
      add('openrouter', 'OpenRouter');
      add('ollama', 'Ollama');
    }

    final keys = labels.keys.toList()
      ..sort((a, b) => labels[a]!.compareTo(labels[b]!));

    return [
      const _FilterOption('all', 'All providers'),
      ...keys.map((key) => _FilterOption(key, labels[key]!)),
    ];
  }

  List<_FilterOption> _requestTypeOptions() {
    final keys = <String>{
      'IDEA_GENERATION',
      'NLP_ENHANCEMENT',
      'AI_CHAT',
      'COMMENT_ANALYSIS',
      'DATA_COLLECTION',
      'PAYMENT',
      'OTHER',
    };

    final rawTypes = _charts['requestsByType'];
    if (rawTypes is List) {
      for (final item in rawTypes.whereType<Map>()) {
        final map = Map<String, dynamic>.from(item);
        final key = _text(map['requestType'] ?? map['key'] ?? map['label'])
            .trim()
            .toUpperCase();
        if (key.isNotEmpty) keys.add(key);
      }
    }

    for (final row in _rows) {
      final key = _text(row['requestType']).trim().toUpperCase();
      if (key.isNotEmpty) keys.add(key);
    }

    if (_requestType != 'all') {
      keys.add(_requestType.toUpperCase());
    }

    final ordered = keys.toList()
      ..sort((a, b) => _requestTypeLabel(a).compareTo(_requestTypeLabel(b)));

    return [
      const _FilterOption('all', 'All request types'),
      ...ordered.map((key) => _FilterOption(key, _requestTypeLabel(key))),
    ];
  }

  int _statusCount(String status) {
    return switch (status) {
      'success' => _int(_baseSummary['successfulRequests']),
      'failed' => _int(_baseSummary['failedRequests']),
      _ => _int(_baseSummary['totalRequests']),
    };
  }

  int get _activeFilterCount {
    var count = 0;

    if (_providerKey != 'all') count++;
    if (_requestType != 'all') count++;
    if (_execution != 'all') count++;
    if (_fromDate != null || _toDate != null) count++;
    if (_sortBy != 'createdAt' || _sortOrder != 'desc') count++;

    return count;
  }

  @override
  Widget build(BuildContext context) {
    final successRate = _double(_summary['successRate']);
    final averageLatency = _double(_summary['averageResponseTime']);
    final errorRate = _double(_summary['errorRate']);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () => _load(force: true, quiet: true),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 42),
                  sliver: SliverList.list(
                    children: [
                      AdminPageHeader(
                        accentColor: AppColors.primary,
                        title: 'AI monitoring',
                        subtitle:
                            'Inspect provider calls, retries, fallback paths, latency and execution results.',
                        eyebrow: 'Intelligence',
                        icon: Icons.monitor_heart_outlined,
                        onBack: () => Navigator.maybePop(context),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'Export diagnostics',
                              onPressed: _exporting ? null : _exportCsv,
                              style: IconButton.styleFrom(
                                backgroundColor: AppColors.surface,
                                foregroundColor: AppColors.primary,
                                fixedSize: const Size(44, 44),
                                side: const BorderSide(color: AppColors.border),
                              ),
                              icon: _exporting
                                  ? const SizedBox(
                                      width: 17,
                                      height: 17,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.primary,
                                      ),
                                    )
                                  : const Icon(Icons.ios_share_rounded, size: 19),
                            ),
                            const SizedBox(width: 6),
                            IconButton(
                              onPressed: _refreshing
                                  ? null
                                  : () => _load(force: true, quiet: true),
                              style: IconButton.styleFrom(
                                backgroundColor: AppColors.primarySoft,
                                foregroundColor: AppColors.primary,
                                fixedSize: const Size(44, 44),
                                side: const BorderSide(color: AppColors.border),
                              ),
                              icon: _refreshing
                                  ? const SizedBox(
                                      width: 17,
                                      height: 17,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.primary,
                                      ),
                                    )
                                  : const Icon(Icons.refresh_rounded, size: 20),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      _MonitoringMetricGrid(
                        totalRequests: _int(_summary['totalRequests']),
                        successfulRequests: _int(
                          _summary['successfulRequests'],
                        ),
                        failedRequests: _int(_summary['failedRequests']),
                        retryableFailures: _int(_summary['retryableFailures']),
                        successRate: successRate,
                        averageLatency: averageLatency,
                        totalCost: _double(_summary['totalCost']),
                      ),
                      const SizedBox(height: 8),
                      _MonitoringSignalStrip(
                        retryableFailures: _int(_summary['retryableFailures']),
                        fallbackAttempts: _int(_summary['fallbackAttempts']),
                        errorRate: errorRate,
                        totalCost: _double(_summary['totalCost']),
                      ),
                      const SizedBox(height: 15),
                      _StatusTabs(
                        selected: _status,
                        allCount: _statusCount('all'),
                        successCount: _statusCount('success'),
                        failedCount: _statusCount('failed'),
                        onSelected: _selectStatus,
                      ),
                      const SizedBox(height: 13),
                      Row(
                        children: [
                          Expanded(
                            child: AdminSearchField(
                              controller: _searchController,
                              hint:
                                  'Search model, provider, operation, user, idea or error…',
                              onChanged: _onSearchChanged,
                              onSubmitted: (_) {},
                            ),
                          ),
                          const SizedBox(width: 8),
                          SizedBox(
                            width: 50,
                            height: 50,
                            child: FilledButton.tonal(
                              onPressed: _openFilters,
                              style: FilledButton.styleFrom(
                                backgroundColor: _activeFilterCount > 0
                                    ? AppColors.pinkSoft
                                    : AppColors.primarySoft,
                                foregroundColor: _activeFilterCount > 0
                                    ? AppColors.pinkDeep
                                    : AppColors.primary,
                                padding: EdgeInsets.zero,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(15),
                                ),
                              ),
                              child: Stack(
                                clipBehavior: Clip.none,
                                children: [
                                  const Icon(Icons.tune_rounded, size: 20),
                                  if (_activeFilterCount > 0)
                                    Positioned(
                                      right: -7,
                                      top: -8,
                                      child: Container(
                                        constraints: const BoxConstraints(
                                          minWidth: 18,
                                          minHeight: 18,
                                        ),
                                        alignment: Alignment.center,
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 4,
                                        ),
                                        decoration: const BoxDecoration(
                                          color: AppColors.pink,
                                          shape: BoxShape.circle,
                                        ),
                                        child: Text(
                                          '$_activeFilterCount',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 8,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (_hasVisibleFilters) ...[
                        const SizedBox(height: 10),
                        _ActiveFilterChips(
                          providerKey: _providerKey,
                          requestType: _requestType,
                          execution: _execution,
                          fromDate: _fromDate,
                          toDate: _toDate,
                          sortBy: _sortBy,
                          sortOrder: _sortOrder,
                        ),
                      ],
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Text(
                            '${_formatNumber(_total)} records',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            'Page $_page of $_totalPages',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (_loading)
                        const AdminLoadingList(count: 5)
                      else if (_error.isNotEmpty && _rows.isEmpty)
                        AdminEmptyState(
                          title: 'Could not load AI diagnostics',
                          message: _error,
                          icon: Icons.cloud_off_outlined,
                          onRetry: () => _load(force: true),
                        )
                      else if (_rows.isEmpty)
                        const AdminEmptyState(
                          title: 'No matching request attempts',
                          message:
                              'Adjust the provider, status, date range or search phrase.',
                          icon: Icons.monitor_heart_outlined,
                        )
                      else ...[
                        ..._rows.map(
                          (row) => Padding(
                            padding: const EdgeInsets.only(bottom: 11),
                            child: _AiRequestCard(
                              row: row,
                              onTap: () => _openDetails(row),
                            ),
                          ),
                        ),
                        if (_error.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          _InlineError(message: _error),
                        ],
                        if (_totalPages > 1) ...[
                          const SizedBox(height: 5),
                          _MonitoringPagination(
                            page: _page,
                            totalPages: _totalPages,
                            total: _total,
                            shown: _rows.length,
                            pageSize: _pageSize,
                            onPrevious: _page <= 1
                                ? null
                                : () {
                                    setState(() {
                                      _page -= 1;
                                    });
                                    _load();
                                  },
                            onNext: _page >= _totalPages
                                ? null
                                : () {
                                    setState(() {
                                      _page += 1;
                                    });
                                    _load();
                                  },
                          ),
                        ],
                      ],
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

  bool get _hasVisibleFilters {
    return _providerKey != 'all' ||
        _requestType != 'all' ||
        _execution != 'all' ||
        _fromDate != null ||
        _toDate != null ||
        _sortBy != 'createdAt' ||
        _sortOrder != 'desc';
  }
}

class _MonitoringMetricGrid extends StatelessWidget {
  const _MonitoringMetricGrid({
    required this.totalRequests,
    required this.successfulRequests,
    required this.failedRequests,
    required this.retryableFailures,
    required this.successRate,
    required this.averageLatency,
    required this.totalCost,
  });

  final int totalRequests;
  final int successfulRequests;
  final int failedRequests;
  final int retryableFailures;
  final double successRate;
  final double averageLatency;
  final double totalCost;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 8) / 2;

        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            SizedBox(
              width: width,
              child: _MonitoringMetricCard(
                label: 'Total requests',
                value: _formatNumber(totalRequests),
                hint: 'Matching provider attempts',
                icon: Icons.monitor_heart_outlined,
                tone: AppColors.primarySoft,
                iconColor: AppColors.primary,
              ),
            ),
            SizedBox(
              width: width,
              child: _MonitoringMetricCard(
                label: 'Success rate',
                value: '${successRate.toStringAsFixed(1)}%',
                hint: '${_formatNumber(successfulRequests)} successful',
                icon: Icons.check_circle_outline_rounded,
                tone: const Color(0xFFE8F7F0),
                iconColor: AppColors.success,
              ),
            ),
            SizedBox(
              width: width,
              child: _MonitoringMetricCard(
                label: 'Failed requests',
                value: _formatNumber(failedRequests),
                hint: '${_formatNumber(retryableFailures)} retryable',
                icon: Icons.error_outline_rounded,
                tone: AppColors.pinkSoft,
                iconColor: AppColors.danger,
              ),
            ),
            SizedBox(
              width: width,
              child: _MonitoringMetricCard(
                label: 'Average latency',
                value: '${_formatNumber(averageLatency)} ms',
                hint: '${_formatMoney(totalCost)} estimated cost',
                icon: Icons.speed_rounded,
                tone: const Color(0xFFFFF5E8),
                iconColor: AppColors.warning,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _MonitoringMetricCard extends StatelessWidget {
  const _MonitoringMetricCard({
    required this.label,
    required this.value,
    required this.hint,
    required this.icon,
    required this.tone,
    required this.iconColor,
  });

  final String label;
  final String value;
  final String hint;
  final IconData icon;
  final Color tone;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      tint: tone.withValues(alpha: .66),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 29,
            height: 29,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .84),
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: AppColors.border.withValues(alpha: .72),
              ),
            ),
            child: Icon(icon, size: 14, color: iconColor),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 16,
              height: 1.05,
              fontWeight: FontWeight.w900,
              letterSpacing: -.35,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9,
              height: 1.15,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            hint,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.8,
              height: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _MonitoringSignalStrip extends StatelessWidget {
  const _MonitoringSignalStrip({
    required this.retryableFailures,
    required this.fallbackAttempts,
    required this.errorRate,
    required this.totalCost,
  });

  final int retryableFailures;
  final int fallbackAttempts;
  final double errorRate;
  final double totalCost;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(11),
      child: Wrap(
        spacing: 7,
        runSpacing: 7,
        children: [
          _SignalChip(
            icon: Icons.replay_rounded,
            value: _formatNumber(retryableFailures),
            label: 'retryable failures',
          ),
          _SignalChip(
            icon: Icons.account_tree_outlined,
            value: _formatNumber(fallbackAttempts),
            label: 'fallback attempts',
          ),
          _SignalChip(
            icon: Icons.warning_amber_rounded,
            value: '${errorRate.toStringAsFixed(1)}%',
            label: 'error rate',
          ),
          _SignalChip(
            icon: Icons.attach_money_rounded,
            value: _formatMoney(totalCost),
            label: 'estimated cost',
          ),
        ],
      ),
    );
  }
}

class _SignalChip extends StatelessWidget {
  const _SignalChip({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.primary),
          const SizedBox(width: 5),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.8,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusTabs extends StatelessWidget {
  const _StatusTabs({
    required this.selected,
    required this.allCount,
    required this.successCount,
    required this.failedCount,
    required this.onSelected,
  });

  final String selected;
  final int allCount;
  final int successCount;
  final int failedCount;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: _StatusTab(
              label: 'All',
              count: allCount,
              selected: selected == 'all',
              onTap: () => onSelected('all'),
            ),
          ),
          Expanded(
            child: _StatusTab(
              label: 'Successful',
              count: successCount,
              selected: selected == 'success',
              onTap: () => onSelected('success'),
            ),
          ),
          Expanded(
            child: _StatusTab(
              label: 'Failed',
              count: failedCount,
              selected: selected == 'failed',
              onTap: () => onSelected('failed'),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusTab extends StatelessWidget {
  const _StatusTab({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : Colors.transparent,
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 9),
          child: Column(
            children: [
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? AppColors.primary : AppColors.textMuted,
                  fontSize: 9.3,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _formatNumber(count),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected
                      ? AppColors.primary
                      : AppColors.textSecondary,
                  fontSize: 8.3,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveFilterChips extends StatelessWidget {
  const _ActiveFilterChips({
    required this.providerKey,
    required this.requestType,
    required this.execution,
    required this.fromDate,
    required this.toDate,
    required this.sortBy,
    required this.sortOrder,
  });

  final String providerKey;
  final String requestType;
  final String execution;
  final DateTime? fromDate;
  final DateTime? toDate;
  final String sortBy;
  final String sortOrder;

  @override
  Widget build(BuildContext context) {
    final chips = <String>[];

    if (providerKey != 'all') {
      chips.add('Provider · ${_titleCase(providerKey)}');
    }

    if (requestType != 'all') {
      chips.add('Type · ${_requestTypeLabel(requestType)}');
    }

    if (execution != 'all') {
      chips.add(
        execution == 'retryable' ? 'Retryable failures' : 'Fallback attempts',
      );
    }

    if (fromDate != null || toDate != null) {
      final from = fromDate == null
          ? 'Any'
          : DateFormat('MMM d').format(fromDate!);
      final to = toDate == null ? 'Any' : DateFormat('MMM d').format(toDate!);
      chips.add('$from → $to');
    }

    if (sortBy != 'createdAt' || sortOrder != 'desc') {
      chips.add('${_sortLabel(sortBy)} ${sortOrder == 'asc' ? '↑' : '↓'}');
    }

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: chips
          .map(
            (label) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.surfaceRose,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: AppColors.pink.withValues(alpha: .14),
                ),
              ),
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.primary,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class _AiRequestCard extends StatelessWidget {
  const _AiRequestCard({required this.row, required this.onTap});

  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final success = row['isSuccess'] == true;
    final retryable = row['isRetryable'] == true;
    final fallback = row['fallbackUsed'] == true;

    final modelName = _modelName(row);

    final provider = _titleCase(_text(row['providerKey'], fallback: 'Unknown'));

    final operationId = _text(row['operationId'], fallback: _text(row['id']));

    final attempt = _int(row['attemptNumber'], fallback: 1);

    final tokens = _int(row['inputTokens']) + _int(row['outputTokens']);

    final user = _asMap(row['user']);
    final idea = _asMap(row['idea']);

    final contextTitle = _text(
      user['fullName'],
      fallback: _text(user['email'], fallback: 'System operation'),
    );

    final contextSubtitle = _text(
      idea['title'],
      fallback: _text(row['endpoint'], fallback: 'No idea context'),
    );

    final errorCode = _text(row['errorCode']);

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminIconBadge(
                icon: Icons.smart_toy_outlined,
                size: 40,
                tone: success ? const Color(0xFFE8F7F0) : AppColors.pinkSoft,
                iconColor: success ? AppColors.success : AppColors.danger,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _requestTypeLabel(_text(row['requestType'])),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13.4,
                        height: 1.25,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Op ${_shortId(operationId, 9)} · Attempt $attempt',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.1,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _formatDate(row['createdAt'], compact: true),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.8,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 7),
              _OutcomePill(success: success, retryable: retryable),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: AppColors.background.withValues(alpha: .68),
              borderRadius: BorderRadius.circular(15),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                _CardInfoRow(
                  icon: Icons.dns_outlined,
                  label: 'Provider & model',
                  title: provider,
                  subtitle:
                      '$modelName · ${_text(row['apiModelId'], fallback: '—')}',
                ),
                const Divider(height: 17),
                _CardInfoRow(
                  icon: Icons.speed_rounded,
                  label: 'Performance',
                  title: '${_formatNumber(row['responseTimeMs'])} ms',
                  subtitle:
                      '${_formatNumber(tokens)} tokens · ${_formatMoney(row['costEstimate'])}',
                  trailing: 'HTTP ${_text(row['statusCode'], fallback: '—')}',
                ),
                const Divider(height: 17),
                _CardInfoRow(
                  icon: Icons.person_outline_rounded,
                  label: 'Context',
                  title: contextTitle,
                  subtitle: contextSubtitle,
                ),
              ],
            ),
          ),
          if (fallback || (!success && errorCode.isNotEmpty)) ...[
            const SizedBox(height: 9),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (fallback)
                  const _MiniTag(
                    icon: Icons.account_tree_outlined,
                    label: 'Fallback path',
                    tone: AppColors.primarySoft,
                    foreground: AppColors.primary,
                  ),
                if (!success && errorCode.isNotEmpty)
                  _MiniTag(
                    icon: Icons.warning_amber_rounded,
                    label: errorCode,
                    tone: AppColors.pinkSoft,
                    foreground: AppColors.danger,
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              const Text(
                'Tap to inspect retries, fallback and technical references',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.6,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 12,
                color: AppColors.sage,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CardInfoRow extends StatelessWidget {
  const _CardInfoRow({
    required this.icon,
    required this.label,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final String title;
  final String subtitle;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 15, color: AppColors.primary),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.7,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .5,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.6,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.8,
                  height: 1.3,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.border),
            ),
            child: Text(
              trailing!,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 7.8,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _AiRequestDetailsSheet extends StatefulWidget {
  const _AiRequestDetailsSheet({required this.initialRow});

  final Map<String, dynamic> initialRow;

  @override
  State<_AiRequestDetailsSheet> createState() => _AiRequestDetailsSheetState();
}

class _AiRequestDetailsSheetState extends State<_AiRequestDetailsSheet> {
  final AdminApi _api = AdminApi.instance;

  late Map<String, dynamic> _log;
  Map<String, dynamic> _operation = const {};

  bool _detailLoading = true;
  bool _operationLoading = true;
  String _detailError = '';

  @override
  void initState() {
    super.initState();

    _log = Map<String, dynamic>.from(widget.initialRow);

    _loadDiagnostics();
  }

  Future<void> _loadDiagnostics() async {
    final id = _text(_log['id']);

    if (id.isNotEmpty) {
      try {
        final detail = await _api.getDetail(
          '/admin/ai-monitoring/logs/$id',
          force: true,
        );

        if (mounted) {
          setState(() {
            _log = {..._log, ...detail};
          });
        }
      } on ApiException catch (error) {
        if (mounted) {
          setState(() {
            _detailError = error.message;
          });
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            _detailError = 'Could not refresh the complete request details.';
          });
        }
      }
    }

    if (mounted) {
      setState(() {
        _detailLoading = false;
      });
    }

    final operationId = _text(_log['operationId']);

    if (operationId.isEmpty) {
      if (mounted) {
        setState(() {
          _operationLoading = false;
        });
      }

      return;
    }

    try {
      final operation = await _api.getDetail(
        '/admin/ai-monitoring/operations/${Uri.encodeComponent(operationId)}',
        force: true,
      );

      if (mounted) {
        setState(() {
          _operation = operation;
        });
      }
    } catch (_) {
    } finally {
      if (mounted) {
        setState(() {
          _operationLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final success = _log['isSuccess'] == true;
    final retryable = _log['isRetryable'] == true;
    final fallback = _log['fallbackUsed'] == true;

    final provider = _titleCase(
      _text(_log['providerKey'], fallback: 'Unknown provider'),
    );

    final modelName = _modelName(_log);

    final totalTokens = _int(_log['inputTokens']) + _int(_log['outputTokens']);

    final user = _asMap(_log['user']);
    final idea = _asMap(_log['idea']);

    final attempts = (_operation['attempts'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .94,
      minChildSize: .62,
      maxChildSize: .98,
      builder: (context, controller) {
        return Container(
          margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(29),
            border: Border.all(color: AppColors.border),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(15, 10, 15, 28),
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
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AdminIconBadge(
                    icon: Icons.smart_toy_outlined,
                    size: 45,
                    tone: success
                        ? const Color(0xFFE8F7F0)
                        : AppColors.pinkSoft,
                    iconColor: success ? AppColors.success : AppColors.danger,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'AI REQUEST DIAGNOSTICS',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .9,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _requestTypeLabel(_text(_log['requestType'])),
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.25,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '$provider · $modelName',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 10,
                            height: 1.35,
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
              if (_detailLoading) ...[
                const SizedBox(height: 10),
                const LinearProgressIndicator(
                  minHeight: 2,
                  color: AppColors.primary,
                  backgroundColor: AppColors.primarySoft,
                ),
              ],
              if (_detailError.isNotEmpty) ...[
                const SizedBox(height: 10),
                _InlineError(message: _detailError),
              ],
              const SizedBox(height: 14),
              _OutcomeCard(
                success: success,
                retryable: retryable,
                fallback: fallback,
                responseTimeMs: _log['responseTimeMs'],
              ),
              const SizedBox(height: 11),
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = (constraints.maxWidth - 8) / 2;

                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.dns_outlined,
                          label: 'Provider',
                          value: provider,
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.memory_rounded,
                          label: 'API model',
                          value: _text(_log['apiModelId'], fallback: '—'),
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.flash_on_rounded,
                          label: 'Tokens',
                          value: _formatNumber(totalTokens),
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.speed_rounded,
                          label: 'Status code',
                          value: _text(_log['statusCode'], fallback: '—'),
                        ),
                      ),
                      SizedBox(
                        width: constraints.maxWidth,
                        child: _DetailItem(
                          icon: Icons.schedule_rounded,
                          label: 'Created',
                          value: _formatDate(_log['createdAt']),
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.monitor_heart_outlined,
                          label: 'Attempt',
                          value: '#${_int(_log['attemptNumber'], fallback: 1)}',
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: _DetailItem(
                          icon: Icons.attach_money_rounded,
                          label: 'Estimated cost',
                          value: _formatMoney(_log['costEstimate']),
                        ),
                      ),
                    ],
                  );
                },
              ),
              if (user.isNotEmpty || idea.isNotEmpty) ...[
                const SizedBox(height: 15),
                _ContextCard(user: user, idea: idea),
              ],
              if (!success &&
                  (_text(_log['errorCode']).isNotEmpty ||
                      _text(_log['errorMessage']).isNotEmpty)) ...[
                const SizedBox(height: 11),
                _RequestErrorCard(
                  code: _text(_log['errorCode'], fallback: 'REQUEST FAILURE'),
                  message: _text(
                    _log['errorMessage'],
                    fallback:
                        'The provider request failed without a stored message.',
                  ),
                ),
              ],
              const SizedBox(height: 20),
              _SectionHeading(
                eyebrow: 'OPERATION TIMELINE',
                title: 'Retries and fallback path',
                subtitle:
                    'Every provider attempt belonging to this logical AI operation.',
                trailing: _int(_operation['totalAttempts']) > 0
                    ? '${_int(_operation['totalAttempts'])} attempts'
                    : null,
              ),
              const SizedBox(height: 10),
              if (_operationLoading)
                const _TimelineLoading()
              else if (attempts.isEmpty)
                const _TimelineEmpty()
              else
                ...attempts.asMap().entries.map(
                  (entry) => Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: _AttemptCard(
                      attempt: entry.value,
                      fallbackNumber: entry.key + 1,
                    ),
                  ),
                ),
              const SizedBox(height: 14),
              const Divider(),
              const SizedBox(height: 14),
              const _SectionHeading(
                eyebrow: 'TECHNICAL REFERENCES',
                title: 'Request identifiers',
                subtitle:
                    'References used to trace the provider request and logical operation.',
              ),
              const SizedBox(height: 10),
              _TechnicalItem(label: 'Log ID', value: _text(_log['id'])),
              const SizedBox(height: 8),
              _TechnicalItem(
                label: 'Operation ID',
                value: _text(
                  _log['operationId'],
                  fallback: 'Legacy / unavailable',
                ),
              ),
              const SizedBox(height: 8),
              _TechnicalItem(
                label: 'Provider request ID',
                value: _text(_log['requestId'], fallback: '—'),
              ),
              const SizedBox(height: 8),
              _TechnicalItem(
                label: 'Endpoint',
                value: _text(_log['endpoint'], fallback: '—'),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _OutcomeCard extends StatelessWidget {
  const _OutcomeCard({
    required this.success,
    required this.retryable,
    required this.fallback,
    required this.responseTimeMs,
  });

  final bool success;
  final bool retryable;
  final bool fallback;
  final dynamic responseTimeMs;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      tint: success
          ? const Color(0xFFE8F7F0).withValues(alpha: .66)
          : AppColors.pinkSoft.withValues(alpha: .72),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _OutcomePill(success: success, retryable: retryable),
              if (fallback) ...[
                const SizedBox(width: 7),
                const _MiniTag(
                  icon: Icons.account_tree_outlined,
                  label: 'Fallback',
                  tone: AppColors.primarySoft,
                  foreground: AppColors.primary,
                ),
              ],
            ],
          ),
          const SizedBox(height: 13),
          Text(
            '${_formatNumber(responseTimeMs)} ms',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 26,
              fontWeight: FontWeight.w900,
              letterSpacing: -.55,
            ),
          ),
          const SizedBox(height: 3),
          const Text(
            'Provider response time',
            style: TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _OutcomePill extends StatelessWidget {
  const _OutcomePill({required this.success, required this.retryable});

  final bool success;
  final bool retryable;

  @override
  Widget build(BuildContext context) {
    final label = success ? 'Successful' : (retryable ? 'Retryable' : 'Failed');

    final background = success ? const Color(0xFFE8F7F0) : AppColors.pinkSoft;

    final foreground = success ? AppColors.success : AppColors.danger;

    final icon = success
        ? Icons.check_circle_outline_rounded
        : (retryable ? Icons.replay_rounded : Icons.cancel_outlined);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: foreground),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 8.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailItem extends StatelessWidget {
  const _DetailItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 74),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .74),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 29,
            height: 29,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 14, color: AppColors.primary),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.4,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .45,
                  ),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.4,
                    height: 1.35,
                    fontWeight: FontWeight.w800,
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

class _ContextCard extends StatelessWidget {
  const _ContextCard({required this.user, required this.idea});

  final Map<String, dynamic> user;
  final Map<String, dynamic> idea;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionLabel('REQUEST CONTEXT'),
          if (user.isNotEmpty) ...[
            const SizedBox(height: 10),
            _ContextRow(
              icon: Icons.person_outline_rounded,
              title: _text(user['fullName'], fallback: 'Platform user'),
              subtitle: _text(user['email'], fallback: '—'),
            ),
          ],
          if (idea.isNotEmpty) ...[
            const SizedBox(height: 10),
            _ContextRow(
              icon: Icons.auto_awesome_outlined,
              title: _text(idea['title'], fallback: 'Related idea'),
              subtitle: _shortId(_text(idea['id']), 13),
            ),
          ],
        ],
      ),
    );
  }
}

class _ContextRow extends StatelessWidget {
  const _ContextRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: AppColors.primary),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SelectableText(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              SelectableText(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.8,
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

class _RequestErrorCard extends StatelessWidget {
  const _RequestErrorCard({required this.code, required this.message});

  final String code;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.pink.withValues(alpha: .18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            size: 18,
            color: AppColors.danger,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SelectableText(
                  code,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  message,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.2,
                    height: 1.45,
                    fontWeight: FontWeight.w600,
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

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primary,
                  fontSize: 8.2,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .8,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 14.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              trailing!,
              style: const TextStyle(
                color: AppColors.primary,
                fontSize: 8.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _AttemptCard extends StatelessWidget {
  const _AttemptCard({required this.attempt, required this.fallbackNumber});

  final Map<String, dynamic> attempt;
  final int fallbackNumber;

  @override
  Widget build(BuildContext context) {
    final success = attempt['isSuccess'] == true;
    final retryable = attempt['isRetryable'] == true;
    final fallback = attempt['fallbackUsed'] == true;

    final number = _int(attempt['attemptNumber'], fallback: fallbackNumber);

    final provider = _titleCase(
      _text(attempt['providerKey'], fallback: 'Unknown provider'),
    );

    final model = _modelName(attempt);

    final apiModel = _text(
      attempt['apiModelId'],
      fallback: 'Unmapped API model',
    );

    final tokens = _int(attempt['inputTokens']) + _int(attempt['outputTokens']);

    final errorCode = _text(attempt['errorCode']);

    final errorMessage = _text(attempt['errorMessage']);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: success ? const Color(0xFFE8F7F0) : AppColors.pinkSoft,
            shape: BoxShape.circle,
            border: Border.all(
              color: success
                  ? AppColors.success.withValues(alpha: .18)
                  : AppColors.pink.withValues(alpha: .20),
            ),
          ),
          child: Text(
            '$number',
            style: TextStyle(
              color: success ? AppColors.success : AppColors.danger,
              fontSize: 9,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.background.withValues(alpha: .70),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            model,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '$provider · $apiModel',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.4,
                              height: 1.35,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    _OutcomePill(success: success, retryable: retryable),
                  ],
                ),
                const SizedBox(height: 9),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _AttemptFact(
                      icon: Icons.speed_rounded,
                      value: '${_formatNumber(attempt['responseTimeMs'])} ms',
                    ),
                    _AttemptFact(
                      icon: Icons.flash_on_rounded,
                      value: '${_formatNumber(tokens)} tokens',
                    ),
                    _AttemptFact(
                      icon: Icons.attach_money_rounded,
                      value: _formatMoney(attempt['costEstimate']),
                    ),
                    if (fallback)
                      const _AttemptFact(
                        icon: Icons.account_tree_outlined,
                        value: 'Fallback',
                        emphasized: true,
                      ),
                  ],
                ),
                if (!success &&
                    (errorCode.isNotEmpty || errorMessage.isNotEmpty)) ...[
                  const SizedBox(height: 9),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: AppColors.pinkSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.warning_amber_rounded,
                          size: 13,
                          color: AppColors.danger,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: SelectableText(
                            [
                              if (errorCode.isNotEmpty) errorCode,
                              if (errorMessage.isNotEmpty) errorMessage,
                            ].join(' — '),
                            style: const TextStyle(
                              color: AppColors.danger,
                              fontSize: 8.5,
                              height: 1.4,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _AttemptFact extends StatelessWidget {
  const _AttemptFact({
    required this.icon,
    required this.value,
    this.emphasized = false,
  });

  final IconData icon;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: emphasized ? AppColors.primarySoft : AppColors.surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 11,
            color: emphasized ? AppColors.primary : AppColors.textMuted,
          ),
          const SizedBox(width: 4),
          Text(
            value,
            style: TextStyle(
              color: emphasized
                  ? AppColors.primary
                  : AppColors.textSecondary,
              fontSize: 7.9,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _TechnicalItem extends StatelessWidget {
  const _TechnicalItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .74),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.6,
              fontWeight: FontWeight.w900,
              letterSpacing: .45,
            ),
          ),
          const SizedBox(height: 5),
          SelectableText(
            value.isEmpty ? '—' : value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 9,
              height: 1.4,
              fontWeight: FontWeight.w700,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

class _TimelineLoading extends StatelessWidget {
  const _TimelineLoading();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .48),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primary,
            ),
          ),
          SizedBox(width: 10),
          Text(
            'Loading operation diagnostics…',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _TimelineEmpty extends StatelessWidget {
  const _TimelineEmpty();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .74),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        children: [
          Icon(
            Icons.account_tree_outlined,
            size: 20,
            color: AppColors.primary,
          ),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'No operation timeline is available for this legacy request.',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.3,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MonitoringPagination extends StatelessWidget {
  const _MonitoringPagination({
    required this.page,
    required this.totalPages,
    required this.total,
    required this.shown,
    required this.pageSize,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final int total;
  final int shown;
  final int pageSize;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final start = shown == 0 ? 0 : ((page - 1) * pageSize) + 1;

    final end = shown == 0 ? 0 : ((page - 1) * pageSize) + shown;

    return AdminGlassCard(
      padding: const EdgeInsets.all(11),
      child: Column(
        children: [
          Text(
            'Showing $start–$end of ${_formatNumber(total)}',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.2,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onPrevious,
                  icon: const Icon(Icons.arrow_back_rounded, size: 16),
                  label: const Text('Previous'),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 9),
                child: Text(
                  '$page / $totalPages',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Expanded(
                child: FilledButton.tonalIcon(
                  onPressed: onNext,
                  icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                  label: const Text('Next'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FilterSelect extends StatelessWidget {
  const _FilterSelect({
    required this.label,
    required this.icon,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final String value;
  final List<_FilterOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return AdminSelectionField(
      key: ValueKey('$label-$value'),
      label: label,
      icon: icon,
      value: value,
      options: options
          .map(
            (option) => AdminSelectionOption(
              value: option.value,
              label: option.label,
              icon: icon,
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _FilterOption {
  const _FilterOption(this.value, this.label);

  final String value;
  final String label;
}

class _DateFilterButton extends StatelessWidget {
  const _DateFilterButton({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.background.withValues(alpha: .78),
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.calendar_month_outlined,
                size: 17,
                color: AppColors.primary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .5,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      value == null
                          ? 'Any date'
                          : DateFormat('MMM d, y').format(value!),
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

class _OrderChoice extends StatelessWidget {
  const _OrderChoice({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.background,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 15,
                color: selected ? AppColors.primary : AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected
                        ? AppColors.primary
                        : AppColors.textSecondary,
                    fontSize: 9,
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

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: const TextStyle(
        color: AppColors.primary,
        fontSize: 8.3,
        fontWeight: FontWeight.w900,
        letterSpacing: .8,
      ),
    );
  }
}

class _MiniTag extends StatelessWidget {
  const _MiniTag({
    required this.icon,
    required this.label,
    required this.tone,
    required this.foreground,
  });

  final IconData icon;
  final String label;
  final Color tone;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: foreground),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: foreground,
                fontSize: 7.9,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.pink.withValues(alpha: .18)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            size: 16,
            color: AppColors.danger,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.danger,
                fontSize: 9.2,
                height: 1.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }

  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }

  return <String, dynamic>{};
}

String _text(dynamic value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';

  return text.isEmpty ? fallback : text;
}

int _int(dynamic value, {int fallback = 0}) {
  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

double _double(dynamic value) {
  if (value is double) {
    return value;
  }

  if (value is num) {
    return value.toDouble();
  }

  return double.tryParse(value?.toString() ?? '') ?? 0;
}

String _formatNumber(dynamic value) {
  final number = value is num ? value : num.tryParse(value?.toString() ?? '');

  if (number == null) {
    return '0';
  }

  if (number is double && number % 1 != 0) {
    return NumberFormat('#,##0.##').format(number);
  }

  return NumberFormat.decimalPattern().format(number);
}

String _formatMoney(dynamic value) {
  final amount = _double(value);

  if (amount == 0) {
    return '\$0';
  }

  if (amount.abs() < .01) {
    return '\$${amount.toStringAsFixed(6)}';
  }

  return '\$${amount.toStringAsFixed(2)}';
}

String _formatDate(dynamic value, {bool compact = false}) {
  final raw = _text(value);

  if (raw.isEmpty) {
    return '—';
  }

  final parsed = DateTime.tryParse(raw)?.toLocal();

  if (parsed == null) {
    return raw;
  }

  return compact
      ? DateFormat('MMM d, y').format(parsed)
      : DateFormat('MMM d, y · h:mm a').format(parsed);
}

String _titleCase(String value) {
  return value
      .replaceAll('_', ' ')
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .map((part) {
        final lower = part.toLowerCase();

        return '${lower[0].toUpperCase()}${lower.substring(1)}';
      })
      .join(' ');
}

String _providerLabel(String value) {
  return switch (value.trim().toLowerCase()) {
    'google' => 'Google AI',
    'openrouter' => 'OpenRouter',
    'ollama' => 'Ollama',
    _ => _titleCase(value),
  };
}

String _requestTypeLabel(String value) {
  return switch (value.trim().toUpperCase()) {
    'DATA_COLLECTION' => 'Data collection',
    'COMMENT_ANALYSIS' => 'Comment analysis',
    'IDEA_GENERATION' => 'Idea generation',
    'AI_CHAT' => 'AI chat',
    'PAYMENT' => 'Payment',
    'NLP_ENHANCEMENT' => 'NLP enhancement',
    'OTHER' => 'Other',
    '' => 'AI request',
    _ => _titleCase(value),
  };
}

String _modelName(Map<String, dynamic> row) {
  final model = _asMap(row['aiModel']);

  return _text(
    model['displayName'],
    fallback: _text(
      model['modelName'],
      fallback: _text(row['apiModelId'], fallback: 'Unmapped model'),
    ),
  );
}

String _shortId(String value, int length) {
  if (value.isEmpty) {
    return '—';
  }

  return value.length > length + 1 ? '${value.substring(0, length)}…' : value;
}

String _sortLabel(String value) {
  return switch (value) {
    'responseTimeMs' => 'Latency',
    'costEstimate' => 'Estimated cost',
    'attemptNumber' => 'Attempt number',
    'providerKey' => 'Provider',
    'requestType' => 'Request type',
    _ => 'Request date',
  };
}

String _startOfDayIso(DateTime date) {
  return DateTime(date.year, date.month, date.day).toUtc().toIso8601String();
}

String _endOfDayIso(DateTime date) {
  return DateTime(
    date.year,
    date.month,
    date.day,
    23,
    59,
    59,
    999,
  ).toUtc().toIso8601String();
}
