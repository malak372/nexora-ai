import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';
import '../widgets/admin_selection_field.dart';

class AdminAiAnalyticsPage extends StatefulWidget {
  const AdminAiAnalyticsPage({super.key});

  @override
  State<AdminAiAnalyticsPage> createState() => _AdminAiAnalyticsPageState();
}

class _AdminAiAnalyticsPageState extends State<AdminAiAnalyticsPage> {
  final AdminApi _api = AdminApi.instance;
  final TextEditingController _searchController = TextEditingController();

  Map<String, dynamic> _data = const {};

  DateTime? _fromDate;
  DateTime? _toDate;
  String _providerKey = 'all';
  String _requestType = 'all';

  String _sortBy = 'requests';
  String _sortOrder = 'desc';
  String _search = '';

  int _requestId = 0;

  bool _loading = true;
  bool _refreshing = false;
  String _error = '';

  static const _providerOptions = <_AnalyticsOption>[
    _AnalyticsOption('all', 'All providers'),
    _AnalyticsOption('google', 'Google AI'),
    _AnalyticsOption('openrouter', 'OpenRouter'),
    _AnalyticsOption('ollama', 'Ollama (Local)'),
  ];

  static const _requestTypeOptions = <_AnalyticsOption>[
    _AnalyticsOption('all', 'All request types'),
    _AnalyticsOption('IDEA_GENERATION', 'Idea generation'),
    _AnalyticsOption('AI_CHAT', 'AI chat'),
    _AnalyticsOption('COMMENT_ANALYSIS', 'Comment analysis'),
    _AnalyticsOption('NLP_ENHANCEMENT', 'NLP enhancement'),
    _AnalyticsOption('DATA_COLLECTION', 'Data collection'),
    _AnalyticsOption('OTHER', 'Other'),
  ];

  static const _sortOptions = <_AnalyticsOption>[
    _AnalyticsOption('requests', 'Request volume'),
    _AnalyticsOption('successRate', 'Success rate'),
    _AnalyticsOption('averageResponseTimeMs', 'Average latency'),
    _AnalyticsOption('tokens', 'Token usage'),
    _AnalyticsOption('cost', 'Estimated cost'),
    _AnalyticsOption('modelName', 'Model name'),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false, bool quiet = false}) async {
    if (!mounted) return;
    final requestId = ++_requestId;

    setState(() {
      _error = '';
      if (quiet) {
        _refreshing = true;
      } else if (_data.isEmpty) {
        _loading = true;
      }
    });

    try {
      final payload = await _api.getSummary(
        '/admin/ai/analytics/summary',
        force: force,
        query: _analyticsQuery(),
      );

      if (!mounted || requestId != _requestId) return;

      setState(() {
        _data = payload['data'] is Map
            ? Map<String, dynamic>.from(payload['data'] as Map)
            : payload;
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = 'Could not load AI usage analytics.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Map<String, dynamic> _analyticsQuery() {
    return {
      if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
      if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
      if (_providerKey != 'all') 'providerKey': _providerKey,
      if (_requestType != 'all') 'requestType': _requestType,
    };
  }

  String _startOfDayIso(DateTime value) {
    return DateTime(
      value.year,
      value.month,
      value.day,
    ).toUtc().toIso8601String();
  }

  String _endOfDayIso(DateTime value) {
    return DateTime(
      value.year,
      value.month,
      value.day,
      23,
      59,
      59,
      999,
    ).toUtc().toIso8601String();
  }

  Future<void> _openFilters() async {
    var nextFrom = _fromDate;
    var nextTo = _toDate;
    var nextProvider = _providerKey;
    var nextRequestType = _requestType;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> pickDate({required bool from}) async {
              final initial = from
                  ? nextFrom ?? nextTo ?? DateTime.now()
                  : nextTo ?? nextFrom ?? DateTime.now();

              final selected = await showDatePicker(
                context: context,
                initialDate: initial,
                firstDate: DateTime(2020),
                lastDate: DateTime.now().add(const Duration(days: 1)),
                helpText: from ? 'Select from date' : 'Select to date',
              );

              if (selected == null) {
                return;
              }

              setSheetState(() {
                if (from) {
                  nextFrom = selected;

                  if (nextTo != null && nextFrom!.isAfter(nextTo!)) {
                    nextTo = selected;
                  }
                } else {
                  nextTo = selected;

                  if (nextFrom != null && nextTo!.isBefore(nextFrom!)) {
                    nextFrom = selected;
                  }
                }
              });
            }

            return _AnalyticsFilterSheet(
              fromDate: nextFrom,
              toDate: nextTo,
              providerKey: nextProvider,
              requestType: nextRequestType,
              providerOptions: _providerOptions,
              requestTypeOptions: _requestTypeOptions,
              onPickFromDate: () => pickDate(from: true),
              onPickToDate: () => pickDate(from: false),
              onProviderChanged: (value) {
                setSheetState(() {
                  nextProvider = value;
                });
              },
              onRequestTypeChanged: (value) {
                setSheetState(() {
                  nextRequestType = value;
                });
              },
              onClear: () {
                setSheetState(() {
                  nextFrom = null;
                  nextTo = null;
                  nextProvider = 'all';
                  nextRequestType = 'all';
                });
              },
              onApply: () {
                Navigator.of(sheetContext).pop(true);
              },
            );
          },
        );
      },
    );

    if (applied != true || !mounted) {
      return;
    }

    setState(() {
      _fromDate = nextFrom;
      _toDate = nextTo;
      _providerKey = nextProvider;
      _requestType = nextRequestType;
    });

    await _load(force: true, quiet: true);
  }

  Future<void> _clearFilters() async {
    if (!_hasActiveFilters) {
      return;
    }

    setState(() {
      _fromDate = null;
      _toDate = null;
      _providerKey = 'all';
      _requestType = 'all';
    });

    await _load(force: true, quiet: true);
  }

  bool get _hasActiveFilters =>
      _fromDate != null ||
      _toDate != null ||
      _providerKey != 'all' ||
      _requestType != 'all';

  int get _activeFilterCount {
    var count = 0;

    if (_fromDate != null || _toDate != null) {
      count += 1;
    }

    if (_providerKey != 'all') {
      count += 1;
    }

    if (_requestType != 'all') {
      count += 1;
    }

    return count;
  }

  List<Map<String, dynamic>> get _rawModels {
    final source = _data['models'];

    if (source is! List) {
      return const [];
    }

    return source
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  List<Map<String, dynamic>> get _visibleModels {
    final query = _search.trim().toLowerCase();

    final prepared = _rawModels
        .where((item) {
          if (query.isEmpty) {
            return true;
          }

          final model = _asMap(item['model']);

          return [
            _modelName(item),
            model['apiModelId'],
            model['providerKey'],
          ].any((value) => value.toString().toLowerCase().contains(query));
        })
        .map((item) {
          final copy = <String, dynamic>{...item};

          final requests = _number(item['requests']);
          final successful = _number(item['successfulRequests']);

          copy['_successRate'] = _percent(successful, requests);

          copy['_tokens'] =
              _number(item['inputTokens']) + _number(item['outputTokens']);

          return copy;
        })
        .toList();

    final direction = _sortOrder == 'asc' ? 1 : -1;

    prepared.sort((a, b) {
      if (_sortBy == 'modelName') {
        return _modelName(
              a,
            ).toLowerCase().compareTo(_modelName(b).toLowerCase()) *
            direction;
      }

      if (_sortBy == 'successRate') {
        return _number(
              a['_successRate'],
            ).compareTo(_number(b['_successRate'])) *
            direction;
      }

      if (_sortBy == 'tokens') {
        return _number(a['_tokens']).compareTo(_number(b['_tokens'])) *
            direction;
      }

      return _number(a[_sortBy]).compareTo(_number(b[_sortBy])) * direction;
    });

    return prepared;
  }

  Map<String, dynamic>? get _mostUsedModel {
    if (_rawModels.isEmpty) {
      return null;
    }

    final rows = [
      ..._rawModels,
    ]..sort((a, b) => _number(b['requests']).compareTo(_number(a['requests'])));

    return rows.first;
  }

  Map<String, dynamic>? get _fastestModel {
    final rows =
        _rawModels
            .where((item) => _number(item['averageResponseTimeMs']) > 0)
            .toList()
          ..sort(
            (a, b) => _number(
              a['averageResponseTimeMs'],
            ).compareTo(_number(b['averageResponseTimeMs'])),
          );

    return rows.isEmpty ? null : rows.first;
  }

  @override
  Widget build(BuildContext context) {
    final totalRequests = _number(_data['totalRequests']);

    final successfulRequests = _number(_data['successfulRequests']);

    final failedRequests = _number(_data['failedRequests']);

    final successRate = _number(_data['successRate']);

    final averageLatency = _number(_data['averageResponseTimeMs']);

    final totalInputTokens = _number(_data['totalInputTokens']);

    final totalOutputTokens = _number(_data['totalOutputTokens']);

    final totalCost = _number(_data['totalCost']);

    final fallbackAttempts = _number(_data['fallbackAttempts']);

    final totalTokens = totalInputTokens + totalOutputTokens;

    final models = _visibleModels;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true, quiet: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 84),
              children: [
                AdminPageHeader(
                  accentColor: AppColors.primary,
                  title: 'AI analytics',
                  subtitle:
                      'Reliability, traffic, latency, token consumption and AI spend in one mobile workspace.',
                  eyebrow: 'AI intelligence',
                  icon: Icons.insights_outlined,
                  onBack: () => Navigator.maybePop(context),
                  trailing: _RefreshButton(
                    refreshing: _refreshing,
                    onTap: _loading || _refreshing
                        ? null
                        : () => _load(force: true, quiet: true),
                  ),
                ),

                const SizedBox(height: 16),

                if (_error.isNotEmpty && _data.isNotEmpty) ...[
                  _InlineAnalyticsError(message: _error),
                  const SizedBox(height: 10),
                ],

                if (_loading && _data.isEmpty)
                  const AdminLoadingList(count: 5)
                else if (_error.isNotEmpty && _data.isEmpty)
                  AdminEmptyState(
                    title: 'Could not load AI analytics',
                    message: _error,
                    icon: Icons.insights_outlined,
                    onRetry: () => _load(force: true),
                  )
                else ...[
                  _SectionHeading(
                    eyebrow: 'Usage overview',
                    icon: Icons.bar_chart_rounded,
                    title: 'AI economics & performance',
                    subtitle:
                        'Aggregated provider attempts, including retries, repairs and fallbacks.',
                    trailing: const _LivePill(),
                  ),

                  const SizedBox(height: 10),

                  _AnalyticsMetricGrid(
                    totalRequests: totalRequests,
                    successfulRequests: successfulRequests,
                    failedRequests: failedRequests,
                    successRate: successRate,
                    averageLatency: averageLatency,
                    totalCost: totalCost,
                  ),

                  const SizedBox(height: 9),

                  _AnalyticsSignalStrip(
                    inputTokens: totalInputTokens,
                    outputTokens: totalOutputTokens,
                    fallbackAttempts: fallbackAttempts,
                    models: _rawModels.length,
                  ),

                  const SizedBox(height: 11),

                  _FilterSummaryCard(
                    fromDate: _fromDate,
                    toDate: _toDate,
                    providerLabel: _labelFor(_providerOptions, _providerKey),
                    requestTypeLabel: _labelFor(
                      _requestTypeOptions,
                      _requestType,
                    ),
                    activeFilterCount: _activeFilterCount,
                    onOpen: _openFilters,
                    onClear: _hasActiveFilters ? _clearFilters : null,
                  ),

                  const SizedBox(height: 18),

                  _SectionHeading(
                    eyebrow: 'Model intelligence',
                    icon: Icons.memory_rounded,
                    title: 'Model usage',
                    subtitle:
                        '${models.length} matching models · ${_compactNumber(totalTokens)} total tokens',
                  ),

                  const SizedBox(height: 9),

                  _ModelHighlights(
                    mostUsed: _mostUsedModel == null
                        ? '—'
                        : _modelName(_mostUsedModel!),
                    fastest: _fastestModel == null
                        ? '—'
                        : _modelName(_fastestModel!),
                  ),

                  const SizedBox(height: 10),

                  _ModelControls(
                    controller: _searchController,
                    sortBy: _sortBy,
                    sortOrder: _sortOrder,
                    sortOptions: _sortOptions,
                    onSearchChanged: (value) {
                      setState(() {
                        _search = value;
                      });
                    },
                    onClearSearch: () {
                      _searchController.clear();

                      setState(() {
                        _search = '';
                      });
                    },
                    onSortChanged: (value) {
                      setState(() {
                        _sortBy = value;
                      });
                    },
                    onToggleOrder: () {
                      setState(() {
                        _sortOrder = _sortOrder == 'desc' ? 'asc' : 'desc';
                      });
                    },
                  ),

                  const SizedBox(height: 10),

                  if (models.isEmpty)
                    const AdminEmptyState(
                      title: 'No model usage found',
                      message:
                          'Try changing the analytics filters or model search.',
                      icon: Icons.memory_rounded,
                    )
                  else
                    ...models.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: _ModelUsageCard(
                          item: item,
                          totalRequests: totalRequests,
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RefreshButton extends StatelessWidget {
  const _RefreshButton({required this.refreshing, required this.onTap});

  final bool refreshing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: refreshing
              ? const SizedBox(
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                )
              : const Icon(
                  Icons.refresh_rounded,
                  size: 20,
                  color: AppColors.primary,
                ),
        ),
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.eyebrow,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String eyebrow;
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 13, color: AppColors.primary),
                  const SizedBox(width: 5),
                  Text(
                    eyebrow.toUpperCase(),
                    style: const TextStyle(
                      color: AppColors.primary,
                      fontSize: 8.3,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .8,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 16,
                  height: 1.1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.25,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.2,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ],
    );
  }
}

class _LivePill extends StatelessWidget {
  const _LivePill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _LiveDot(),
          SizedBox(width: 5),
          Text(
            'Aggregated',
            style: TextStyle(
              color: AppColors.primary,
              fontSize: 8.2,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveDot extends StatelessWidget {
  const _LiveDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: const BoxDecoration(
        color: AppColors.success,
        shape: BoxShape.circle,
      ),
    );
  }
}

class _AnalyticsMetricGrid extends StatelessWidget {
  const _AnalyticsMetricGrid({
    required this.totalRequests,
    required this.successfulRequests,
    required this.failedRequests,
    required this.successRate,
    required this.averageLatency,
    required this.totalCost,
  });

  final double totalRequests;
  final double successfulRequests;
  final double failedRequests;
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
              child: _AnalyticsMetricCard(
                icon: Icons.memory_rounded,
                label: 'AI requests',
                value: _wholeNumber(totalRequests),
                hint: '${_wholeNumber(successfulRequests)} successful attempts',
                tone: AppColors.primarySoft,
                iconColor: AppColors.primary,
              ),
            ),
            SizedBox(
              width: width,
              child: _AnalyticsMetricCard(
                icon: Icons.speed_rounded,
                label: 'Success rate',
                value: '${successRate.toStringAsFixed(2)}%',
                hint: '${_wholeNumber(failedRequests)} failed attempts',
                tone: successRate < 70
                    ? AppColors.pinkSoft
                    : const Color(0xFFE8F7F0),
                iconColor: successRate < 70
                    ? AppColors.danger
                    : AppColors.success,
              ),
            ),
            SizedBox(
              width: width,
              child: _AnalyticsMetricCard(
                icon: Icons.timer_outlined,
                label: 'Average latency',
                value: _formatLatency(averageLatency),
                hint: 'Across matching provider attempts',
                tone: const Color(0xFFFFF7EC),
                iconColor: AppColors.warning,
              ),
            ),
            SizedBox(
              width: width,
              child: _AnalyticsMetricCard(
                icon: Icons.paid_outlined,
                label: 'Estimated AI cost',
                value: _formatMoney(totalCost),
                hint: 'Backend-calculated usage estimate',
                tone: const Color(0xFFF0F7F3),
                iconColor: AppColors.primary,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _AnalyticsMetricCard extends StatelessWidget {
  const _AnalyticsMetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
    required this.tone,
    required this.iconColor,
  });

  final IconData icon;
  final String label;
  final String value;
  final String hint;
  final Color tone;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      tint: tone.withValues(alpha: .60),
      radius: 18,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 31,
            height: 31,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .88),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: AppColors.border.withValues(alpha: .78),
              ),
            ),
            child: Icon(icon, size: 15, color: iconColor),
          ),
          const SizedBox(height: 9),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 17,
              height: 1,
              fontWeight: FontWeight.w900,
              letterSpacing: -.45,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.3,
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
              fontSize: 7.6,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _AnalyticsSignalStrip extends StatelessWidget {
  const _AnalyticsSignalStrip({
    required this.inputTokens,
    required this.outputTokens,
    required this.fallbackAttempts,
    required this.models,
  });

  final double inputTokens;
  final double outputTokens;
  final double fallbackAttempts;
  final int models;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(9),
      radius: 17,
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          _AnalyticsSignalChip(
            icon: Icons.toll_outlined,
            value: _compactNumber(inputTokens),
            label: 'input tokens',
          ),
          _AnalyticsSignalChip(
            icon: Icons.bolt_rounded,
            value: _compactNumber(outputTokens),
            label: 'output tokens',
          ),
          _AnalyticsSignalChip(
            icon: Icons.account_tree_outlined,
            value: _wholeNumber(fallbackAttempts),
            label: 'fallback attempts',
          ),
          _AnalyticsSignalChip(
            icon: Icons.memory_outlined,
            value: models.toString(),
            label: 'models represented',
          ),
        ],
      ),
    );
  }
}

class _AnalyticsSignalChip extends StatelessWidget {
  const _AnalyticsSignalChip({
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
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .62),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border.withValues(alpha: .78)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primary),
          const SizedBox(width: 5),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 9.2,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.1,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterSummaryCard extends StatelessWidget {
  const _FilterSummaryCard({
    required this.fromDate,
    required this.toDate,
    required this.providerLabel,
    required this.requestTypeLabel,
    required this.activeFilterCount,
    required this.onOpen,
    required this.onClear,
  });

  final DateTime? fromDate;
  final DateTime? toDate;
  final String providerLabel;
  final String requestTypeLabel;
  final int activeFilterCount;
  final VoidCallback onOpen;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final dateLabel = fromDate == null && toDate == null
        ? 'All dates'
        : '${fromDate == null ? 'Any' : _shortDate(fromDate!)} → ${toDate == null ? 'Now' : _shortDate(toDate!)}';

    return AdminGlassCard(
      padding: const EdgeInsets.all(12),
      radius: 18,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 31,
                height: 31,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.tune_rounded,
                  size: 15,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: 9),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Analytics filters',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.3,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Filter the backend aggregation before comparing models.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.5,
                        height: 1.25,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              if (onClear != null)
                TextButton(
                  onPressed: onClear,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.pinkDeep,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(0, 34),
                  ),
                  child: const Text(
                    'Clear',
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              const SizedBox(width: 2),
              FilledButton.tonalIcon(
                onPressed: onOpen,
                style: FilledButton.styleFrom(
                  backgroundColor: activeFilterCount > 0
                      ? AppColors.primarySoft
                      : AppColors.surfaceMuted,
                  foregroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 9,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                icon: const Icon(Icons.filter_alt_outlined, size: 14),
                label: Text(
                  activeFilterCount > 0
                      ? 'Filters · $activeFilterCount'
                      : 'Filters',
                  style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _FilterValue(icon: Icons.date_range_outlined, text: dateLabel),
              _FilterValue(icon: Icons.dns_outlined, text: providerLabel),
              _FilterValue(
                icon: Icons.category_outlined,
                text: requestTypeLabel,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FilterValue extends StatelessWidget {
  const _FilterValue({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .75),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border.withValues(alpha: .72)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primary),
          const SizedBox(width: 4),
          Text(
            text,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.2,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModelHighlights extends StatelessWidget {
  const _ModelHighlights({required this.mostUsed, required this.fastest});

  final String mostUsed;
  final String fastest;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _HighlightCard(
            icon: Icons.trending_up_rounded,
            label: 'Most used',
            value: mostUsed,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _HighlightCard(
            icon: Icons.bolt_rounded,
            label: 'Fastest',
            value: fastest,
          ),
        ),
      ],
    );
  }
}

class _HighlightCard extends StatelessWidget {
  const _HighlightCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      radius: 16,
      tint: AppColors.primarySoft.withValues(alpha: .42),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 14, color: AppColors.primary),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.7,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
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
          ),
        ],
      ),
    );
  }
}

class _ModelControls extends StatelessWidget {
  const _ModelControls({
    required this.controller,
    required this.sortBy,
    required this.sortOrder,
    required this.sortOptions,
    required this.onSearchChanged,
    required this.onClearSearch,
    required this.onSortChanged,
    required this.onToggleOrder,
  });

  final TextEditingController controller;
  final String sortBy;
  final String sortOrder;
  final List<_AnalyticsOption> sortOptions;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onClearSearch;
  final ValueChanged<String> onSortChanged;
  final VoidCallback onToggleOrder;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(10),
      radius: 17,
      child: Column(
        children: [
          TextField(
            controller: controller,
            onChanged: onSearchChanged,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
            ),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search model, API model or provider…',
              hintStyle: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.6,
              ),
              prefixIcon: const Icon(Icons.search_rounded, size: 17),
              suffixIcon: controller.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: onClearSearch,
                      icon: const Icon(Icons.close_rounded, size: 16),
                    ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 11,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _CompactDropdown(
                  value: sortBy,
                  options: sortOptions,
                  icon: Icons.sort_rounded,
                  onChanged: onSortChanged,
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 44,
                height: 44,
                child: OutlinedButton(
                  onPressed: onToggleOrder,
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.zero,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(13),
                    ),
                  ),
                  child: Icon(
                    sortOrder == 'desc'
                        ? Icons.arrow_downward_rounded
                        : Icons.arrow_upward_rounded,
                    size: 17,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ModelUsageCard extends StatelessWidget {
  const _ModelUsageCard({required this.item, required this.totalRequests});

  final Map<String, dynamic> item;
  final double totalRequests;

  @override
  Widget build(BuildContext context) {
    final model = _asMap(item['model']);

    final requests = _number(item['requests']);

    final successful = _number(item['successfulRequests']);

    final failed = _number(item['failedRequests']);

    final successRate = _percent(successful, requests);

    final averageLatency = _number(item['averageResponseTimeMs']);

    final inputTokens = _number(item['inputTokens']);

    final outputTokens = _number(item['outputTokens']);

    final tokens = inputTokens + outputTokens;

    final cost = _number(item['cost']);

    final traffic = _percent(requests, totalRequests);

    final provider = _providerName(model['providerKey']?.toString());

    final apiModelId = model['apiModelId']?.toString().trim();

    final reliabilityColor = successRate >= 90
        ? AppColors.success
        : successRate >= 70
        ? AppColors.warning
        : AppColors.danger;

    return AdminGlassCard(
      padding: const EdgeInsets.all(12),
      radius: 18,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.memory_rounded,
                  size: 18,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _modelName(item),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12,
                        height: 1.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '$provider · ${apiModelId == null || apiModelId.isEmpty ? 'Legacy / unmapped' : apiModelId}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.3,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _ReliabilityBadge(
                successRate: successRate,
                color: reliabilityColor,
              ),
            ],
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: _ModelStat(
                  label: 'Requests',
                  value: _wholeNumber(requests),
                  meta:
                      '${_wholeNumber(successful)} success · ${_wholeNumber(failed)} failed',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ModelStat(
                  label: 'Latency',
                  value: _formatLatency(averageLatency),
                  meta: 'Average response',
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _ModelStat(
                  label: 'Tokens',
                  value: _compactNumber(tokens),
                  meta:
                      '${_compactNumber(inputTokens)} in · ${_compactNumber(outputTokens)} out',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ModelStat(
                  label: 'Estimated cost',
                  value: _formatMoney(cost),
                  meta: 'Matching attempts',
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Text(
                'Traffic share',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.4,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    minHeight: 6,
                    value: traffic / 100,
                    backgroundColor: AppColors.primarySoft,
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      AppColors.primary,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${traffic.toStringAsFixed(1)}%',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReliabilityBadge extends StatelessWidget {
  const _ReliabilityBadge({required this.successRate, required this.color});

  final double successRate;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: .18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 4),
          Text(
            '${successRate.toStringAsFixed(1)}%',
            style: TextStyle(
              color: color,
              fontSize: 8.2,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModelStat extends StatelessWidget {
  const _ModelStat({
    required this.label,
    required this.value,
    required this.meta,
  });

  final String label;
  final String value;
  final String meta;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .66),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border.withValues(alpha: .72)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.7,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10.3,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            meta,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.2,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _AnalyticsFilterSheet extends StatelessWidget {
  const _AnalyticsFilterSheet({
    required this.fromDate,
    required this.toDate,
    required this.providerKey,
    required this.requestType,
    required this.providerOptions,
    required this.requestTypeOptions,
    required this.onPickFromDate,
    required this.onPickToDate,
    required this.onProviderChanged,
    required this.onRequestTypeChanged,
    required this.onClear,
    required this.onApply,
  });

  final DateTime? fromDate;
  final DateTime? toDate;
  final String providerKey;
  final String requestType;
  final List<_AnalyticsOption> providerOptions;
  final List<_AnalyticsOption> requestTypeOptions;
  final VoidCallback onPickFromDate;
  final VoidCallback onPickToDate;
  final ValueChanged<String> onProviderChanged;
  final ValueChanged<String> onRequestTypeChanged;
  final VoidCallback onClear;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Container(
          margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.graphite.withValues(alpha: .12),
                blurRadius: 30,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.silver.withValues(alpha: .55),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                const SizedBox(height: 13),
                const Row(
                  children: [
                    AdminIconBadge(icon: Icons.tune_rounded, size: 38),
                    SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Analytics filters',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Match the same backend aggregation filters used on the web.',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 15),
                Row(
                  children: [
                    Expanded(
                      child: _DateFilterButton(
                        label: 'From date',
                        value: fromDate == null
                            ? 'Any date'
                            : _longDate(fromDate!),
                        onTap: onPickFromDate,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _DateFilterButton(
                        label: 'To date',
                        value: toDate == null ? 'Any date' : _longDate(toDate!),
                        onTap: onPickToDate,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                _LabeledDropdown(
                  label: 'Provider',
                  icon: Icons.dns_outlined,
                  value: providerKey,
                  options: providerOptions,
                  onChanged: onProviderChanged,
                ),
                const SizedBox(height: 9),
                _LabeledDropdown(
                  label: 'Request type',
                  icon: Icons.category_outlined,
                  value: requestType,
                  options: requestTypeOptions,
                  onChanged: onRequestTypeChanged,
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: onClear,
                        icon: const Icon(Icons.close_rounded, size: 15),
                        label: const Text('Clear'),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: onApply,
                        icon: const Icon(Icons.check_rounded, size: 15),
                        label: const Text('Apply filters'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DateFilterButton extends StatelessWidget {
  const _DateFilterButton({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.background.withValues(alpha: .7),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.date_range_outlined,
                size: 15,
                color: AppColors.primary,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .45,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.2,
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

class _LabeledDropdown extends StatelessWidget {
  const _LabeledDropdown({
    required this.label,
    required this.icon,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final String value;
  final List<_AnalyticsOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return AdminSelectionField(
      label: label,
      icon: icon,
      value: value,
      options: options
          .map(
            (option) => AdminSelectionOption(
              value: option.key,
              label: option.label,
              icon: icon,
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _CompactDropdown extends StatelessWidget {
  const _CompactDropdown({
    required this.value,
    required this.options,
    required this.icon,
    required this.onChanged,
  });

  final String value;
  final List<_AnalyticsOption> options;
  final IconData icon;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return AdminSelectionField(
      label: 'Select',
      icon: icon,
      value: value,
      compact: true,
      options: options
          .map(
            (option) => AdminSelectionOption(
              value: option.key,
              label: option.label,
              icon: icon,
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _InlineAnalyticsError extends StatelessWidget {
  const _InlineAnalyticsError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.pinkLight.withValues(alpha: .7)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            size: 15,
            color: AppColors.danger,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.danger,
                fontSize: 9.3,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AnalyticsOption {
  const _AnalyticsOption(this.key, this.label);

  final String key;
  final String label;
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }

  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }

  return const {};
}

double _number(dynamic value) {
  if (value is num) {
    return value.toDouble();
  }

  return double.tryParse(value?.toString() ?? '') ?? 0;
}

double _percent(double part, double whole) {
  if (whole <= 0) {
    return 0;
  }

  final value = (part / whole) * 100;

  return value.clamp(0, 100).toDouble();
}

String _modelName(Map<String, dynamic> item) {
  final model = _asMap(item['model']);

  final modelName = model['modelName']?.toString().trim() ?? '';

  if (modelName.isNotEmpty) {
    return modelName;
  }

  final apiModelId = model['apiModelId']?.toString().trim() ?? '';

  if (apiModelId.isNotEmpty) {
    return apiModelId;
  }

  return 'Unmapped model';
}

String _providerName(String? key) {
  switch ((key ?? '').trim().toLowerCase()) {
    case 'google':
      return 'Google AI';

    case 'openrouter':
      return 'OpenRouter';

    case 'ollama':
      return 'Ollama (Local)';

    default:
      return key == null || key.trim().isEmpty ? 'Unknown provider' : key;
  }
}

String _labelFor(List<_AnalyticsOption> options, String key) {
  for (final option in options) {
    if (option.key == key) {
      return option.label;
    }
  }

  return options.first.label;
}

String _wholeNumber(double value) {
  return NumberFormat.decimalPattern('en_US').format(value.round());
}

String _compactNumber(double value) {
  if (!value.isFinite) {
    return '0';
  }

  return NumberFormat.compact(locale: 'en_US').format(value);
}

String _formatMoney(double value) {
  if (!value.isFinite || value == 0) {
    return r'$0';
  }

  if (value.abs() < .01) {
    return '\$${value.toStringAsFixed(6)}';
  }

  return '\$${value.toStringAsFixed(4)}';
}

String _formatLatency(double value) {
  if (!value.isFinite || value <= 0) {
    return '0 ms';
  }

  if (value >= 1000) {
    final seconds = value / 1000;

    return '${seconds.toStringAsFixed(value >= 10000 ? 1 : 2)}s';
  }

  return '${value.round()} ms';
}

String _shortDate(DateTime value) => DateFormat('MMM d').format(value);

String _longDate(DateTime value) => DateFormat('MMM d, yyyy').format(value);
