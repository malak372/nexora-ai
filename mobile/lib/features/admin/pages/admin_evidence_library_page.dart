import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

class AdminEvidenceLibraryPage extends StatefulWidget {
  const AdminEvidenceLibraryPage({super.key});

  @override
  State<AdminEvidenceLibraryPage> createState() =>
      _AdminEvidenceLibraryPageState();
}

class _AdminEvidenceLibraryPageState extends State<AdminEvidenceLibraryPage> {
  static const _pageSize = 20;

  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _searchDebounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _items = const [];
  Map<String, dynamic> _summary = const {};
  List<_EvidenceSourceOption> _sourceOptions = const [];

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  String _search = '';
  String _sortBy = 'collectedAt';
  String _sortOrder = 'desc';
  String _dataSourceId = '';

  bool _loading = true;
  bool _refreshing = false;
  bool _sourcesLoading = true;
  String _error = '';

  static const _sortOptions = <_EvidenceSortOption>[
    _EvidenceSortOption(
      key: 'createdAt',
      label: 'Added to library',
      icon: Icons.library_add_outlined,
    ),
    _EvidenceSortOption(
      key: 'collectedAt',
      label: 'Collection date',
      icon: Icons.event_available_outlined,
    ),
    _EvidenceSortOption(
      key: 'publishedAt',
      label: 'Published date',
      icon: Icons.public_outlined,
    ),
    _EvidenceSortOption(
      key: 'likesCount',
      label: 'Engagement',
      icon: Icons.favorite_border_rounded,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadSources();
    _load();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false, bool quiet = false}) async {
    final requestId = ++_requestId;

    if (mounted) {
      setState(() {
        if (quiet) {
          _refreshing = true;
        } else {
          _loading = true;
        }
        _error = '';
      });
    }

    final query = <String, dynamic>{
      if (_search.isNotEmpty) 'search': _search,
      if (_dataSourceId.isNotEmpty) 'dataSourceId': _dataSourceId,
    };

    unawaited(
      _api
          .getSummary(
            '/admin/comments/summary',
            force: force,
            query: query,
          )
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _summary = value);
          })
          .catchError((_) {}),
    );

    try {
      final payload = await _api.getList(
        '/admin/comments',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: {
          if (_dataSourceId.isNotEmpty) 'dataSourceId': _dataSourceId,
        },
      );

      if (!mounted || requestId != _requestId) return;

      final rows = (payload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final meta = payload['meta'] is Map
          ? Map<String, dynamic>.from(payload['meta'] as Map)
          : <String, dynamic>{};

      setState(() {
        _items = rows;
        _total = _toInt(meta['total'] ?? rows.length);
        _totalPages = _toInt(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = 'Could not load the evidence library.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _loadSources({bool force = false}) async {
    if (mounted) setState(() => _sourcesLoading = true);

    try {
      final charts = await _api.getSummary(
        '/admin/comments/charts',
        force: force,
      );
      var options = _sourceOptionsFromCharts(charts);

      if (options.isEmpty) {
        final payload = await _api.getList(
          '/admin/data-sources',
          page: 1,
          limit: 100,
          sortBy: 'displayName',
          sortOrder: 'asc',
          force: force,
        );
        options = (payload['items'] as List? ?? const [])
            .whereType<Map>()
            .map((row) {
              final item = Map<String, dynamic>.from(row);
              return _EvidenceSourceOption(
                id: _first(item, const ['id']),
                label: _first(
                  item,
                  const ['displayName', 'name', 'key'],
                  fallback: 'Unknown source',
                ),
              );
            })
            .where((option) => option.id.isNotEmpty)
            .toList();
      }

      options.sort(
        (a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()),
      );

      if (mounted) setState(() => _sourceOptions = options);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _sourcesLoading = false);
    }
  }

  List<_EvidenceSourceOption> _sourceOptionsFromCharts(
    Map<String, dynamic> charts,
  ) {
    dynamic raw;
    for (final key in const ['byDataSource', 'dataSources', 'sources']) {
      if (charts[key] is List) {
        raw = charts[key];
        break;
      }
    }

    if (raw is! List) return const [];

    final seen = <String>{};
    final result = <_EvidenceSourceOption>[];
    for (final value in raw.whereType<Map>()) {
      final item = Map<String, dynamic>.from(value);
      final id = _first(item, const ['dataSourceId', 'id']);
      if (id.isEmpty || !seen.add(id)) continue;
      result.add(
        _EvidenceSourceOption(
          id: id,
          label: _first(
            item,
            const ['label', 'displayName', 'name', 'key'],
            fallback: 'Unknown source',
          ),
          count: _toInt(
            item['count'] ?? item['total'] ?? item['records'],
          ),
        ),
      );
    }
    return result;
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      final next = value.trim();
      if (next == _search) return;
      setState(() {
        _search = next;
        _page = 1;
      });
      _load();
    });
  }

  Future<void> _refresh() async {
    await Future.wait([
      _load(force: true, quiet: true),
      _loadSources(force: true),
    ]);
  }

  Future<void> _openSort() async {
    var draftSort = _sortBy;
    var draftOrder = _sortOrder;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return _EvidenceSheet(
              maxHeightFactor: .82,
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _SheetHandle(),
                    const SizedBox(height: 14),
                    const Row(
                      children: [
                        Icon(
                          Icons.swap_vert_rounded,
                          size: 20,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 8),
                        Text(
                          'Sort evidence',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.3,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Choose the field first, then the order. Sorting happens before pagination.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.2,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 13),
                    ..._sortOptions.map((option) {
                      final selected = draftSort == option.key;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 7),
                        child: _EvidenceChoiceTile(
                          icon: option.icon,
                          title: option.label,
                          selected: selected,
                          onTap: () {
                            setSheetState(() => draftSort = option.key);
                          },
                        ),
                      );
                    }),
                    const SizedBox(height: 3),
                    _DirectionPicker(
                      value: draftOrder,
                      onChanged: (value) {
                        setSheetState(() => draftOrder = value);
                      },
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: FilledButton.icon(
                        onPressed: () => Navigator.pop(sheetContext, true),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        icon: const Icon(Icons.check_rounded, size: 18),
                        label: const Text(
                          'Apply sorting',
                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                    ),
                    const SizedBox(height: 2),
                  ],
                ),
              ),
            );
          },
        );
      },
    );

    if (!mounted || applied != true) return;
    setState(() {
      _sortBy = draftSort;
      _sortOrder = draftOrder;
      _page = 1;
    });
    _load();
  }

  Future<void> _openSourceFilter() async {
    var draft = _dataSourceId;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return _EvidenceSheet(
              maxHeightFactor: .82,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SheetHandle(),
                  const SizedBox(height: 15),
                  const Text(
                    'Filter by data source',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -.35,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Show every source or focus the evidence directory on one provider.',
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 9.4,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        children: [
                          _EvidenceChoiceTile(
                            icon: Icons.all_inbox_outlined,
                            title: 'All data sources',
                            subtitle: 'Show evidence from every source',
                            selected: draft.isEmpty,
                            onTap: () => setSheetState(() => draft = ''),
                          ),
                          const SizedBox(height: 7),
                          if (_sourcesLoading && _sourceOptions.isEmpty)
                            const Padding(
                              padding: EdgeInsets.all(22),
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.primary,
                              ),
                            )
                          else if (_sourceOptions.isEmpty)
                            const Padding(
                              padding: EdgeInsets.all(18),
                              child: Text(
                                'No evidence sources are available yet.',
                                style: TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 10,
                                ),
                              ),
                            )
                          else
                            ..._sourceOptions.map((source) {
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 7),
                                child: _EvidenceChoiceTile(
                                  icon: Icons.storage_outlined,
                                  title: source.label,
                                  subtitle: source.count > 0
                                      ? '${source.count} records'
                                      : null,
                                  selected: draft == source.id,
                                  onTap: () {
                                    setSheetState(() => draft = source.id);
                                  },
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => setSheetState(() => draft = ''),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(0, 49),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: const Text('Reset'),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        flex: 2,
                        child: FilledButton.icon(
                          onPressed: () => Navigator.pop(sheetContext, true),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 49),
                            backgroundColor: AppColors.primarySoft,
                            foregroundColor: AppColors.primaryDark,
                            side: const BorderSide(color: AppColors.borderStrong),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          icon: const Icon(Icons.filter_alt_outlined, size: 18),
                          label: const Text(
                            'Apply source',
                            style: TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    if (!mounted || applied != true || draft == _dataSourceId) return;
    setState(() {
      _dataSourceId = draft;
      _page = 1;
    });
    _load();
  }

  Future<void> _inspect(Map<String, dynamic> item) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .20),
      builder: (sheetContext) => _EvidenceInspector(item: item),
    );
  }

  String get _sortLabel => _sortOptions
      .firstWhere(
        (option) => option.key == _sortBy,
        orElse: () => _sortOptions[1],
      )
      .label;

  String get _sourceLabel {
    if (_dataSourceId.isEmpty) return 'All data sources';
    for (final option in _sourceOptions) {
      if (option.id == _dataSourceId) return option.label;
    }
    return 'Selected source';
  }

  int get _languageCount {
    final summaryValue = _toInt(
      _summary['languagesCount'] ?? _summary['languageCount'],
    );
    if (summaryValue > 0) return summaryValue;
    return _items
        .map(_evidenceLanguage)
        .where((value) => value.isNotEmpty && value != '—')
        .toSet()
        .length;
  }

  int get _sourceCount {
    final summaryValue = _toInt(
      _summary['dataSourcesCount'] ??
          _summary['sourcesCount'] ??
          _summary['sourceCount'] ??
          _summary['platformsCount'],
    );
    if (summaryValue > 0) return summaryValue;
    if (_sourceOptions.isNotEmpty) return _sourceOptions.length;
    return _items.map(_evidenceSource).where((value) => value.isNotEmpty).toSet().length;
  }

  int get _metricTotal {
    final summaryValue = _toInt(
      _summary['total'] ??
          _summary['totalComments'] ??
          _summary['totalEvidence'] ??
          _summary['count'],
    );
    return summaryValue > 0 ? summaryValue : _total;
  }

  String get _lastCollection {
    final value = _first(
      _summary,
      const [
        'lastCollectedAt',
        'latestCollectedAt',
        'lastCollectionAt',
        'lastCollected',
      ],
    );
    if (value.isNotEmpty) return value;

    DateTime? latest;
    String original = '';
    for (final item in _items) {
      final raw = _collectedAt(item);
      final parsed = DateTime.tryParse(raw);
      if (parsed != null && (latest == null || parsed.isAfter(latest))) {
        latest = parsed;
        original = raw;
      }
    }
    return original;
  }

  @override
  Widget build(BuildContext context) {
    final start = _total == 0 ? 0 : ((_page - 1) * _pageSize) + 1;
    final end = (_page * _pageSize).clamp(0, _total).toInt();

    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: _refresh,
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 13, 14, 116),
                  sliver: SliverList.list(
                    children: [
                      AdminPageHeader(
                        title: 'Evidence Library',
                        subtitle:
                            'Inspect collected external evidence and source context.',
                        eyebrow: 'Data & evidence',
                        icon: Icons.dataset_outlined,
                        onBack: () => Navigator.maybePop(context),
                        trailing: _refreshing
                            ? const SizedBox(
                                width: 42,
                                height: 42,
                                child: Center(
                                  child: SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: AppColors.primaryDark,
                                    ),
                                  ),
                                ),
                              )
                            : IconButton(
                                onPressed: _refresh,
                                style: IconButton.styleFrom(
                                  backgroundColor: AppColors.primarySoft,
                                  foregroundColor: AppColors.primaryDark,
                                  side: const BorderSide(
                                    color: AppColors.border,
                                  ),
                                ),
                                icon: const Icon(Icons.refresh_rounded),
                              ),
                      ),
                      const SizedBox(height: 14),
                      _EvidenceHero(
                        total: _metricTotal,
                        sourceCount: _sourceCount,
                        languageCount: _languageCount,
                        lastCollection: _lastCollection,
                      ),
                      const SizedBox(height: 13),
                      AdminGlassCard(
                        padding: const EdgeInsets.all(13),
                        radius: 23,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                AdminIconBadge(
                                  icon: Icons.manage_search_rounded,
                                  size: 36,
                                ),
                                SizedBox(width: 9),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Explore evidence',
                                        style: TextStyle(
                                          color: AppColors.textPrimary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      SizedBox(height: 2),
                                      Text(
                                        'Search, sort and focus on a collection source.',
                                        style: TextStyle(
                                          color: AppColors.textMuted,
                                          fontSize: 8.8,
                                          height: 1.3,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            AdminSearchField(
                              controller: _searchController,
                              hint: 'Search collected evidence text...',
                              onChanged: _onSearchChanged,
                              onSubmitted: (_) {
                                _searchDebounce?.cancel();
                                final next = _searchController.text.trim();
                                if (next == _search) return;
                                setState(() {
                                  _search = next;
                                  _page = 1;
                                });
                                _load();
                              },
                            ),
                            const SizedBox(height: 9),
                            Row(
                              children: [
                                Expanded(
                                  child: _ToolButton(
                                    icon: _sortOrder == 'asc'
                                        ? Icons.arrow_upward_rounded
                                        : Icons.arrow_downward_rounded,
                                    eyebrow: 'SORT EVIDENCE',
                                    label: _sortLabel,
                                    onTap: _openSort,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _ToolButton(
                                    icon: Icons.storage_outlined,
                                    eyebrow: 'DATA SOURCE',
                                    label: _sourceLabel,
                                    active: _dataSourceId.isNotEmpty,
                                    onTap: _openSourceFilter,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 8,
                              ),
                              decoration: BoxDecoration(
                                color: AppColors.primarySoft.withValues(alpha: .55),
                                borderRadius: BorderRadius.circular(13),
                              ),
                              child: const Row(
                                children: [
                                  Icon(
                                    Icons.verified_user_outlined,
                                    size: 14,
                                    color: AppColors.primaryDark,
                                  ),
                                  SizedBox(width: 7),
                                  Expanded(
                                    child: Text(
                                      'Read-only evidence · no moderation actions',
                                      style: TextStyle(
                                        color: AppColors.textSecondary,
                                        fontSize: 8.4,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 13),
                      if (_loading && _items.isEmpty)
                        const AdminLoadingList(count: 6)
                      else if (_error.isNotEmpty && _items.isEmpty)
                        AdminEmptyState(
                          title: 'Could not load evidence',
                          message: _error,
                          icon: Icons.cloud_off_outlined,
                          onRetry: () => _load(force: true),
                        )
                      else if (_items.isEmpty)
                        AdminEmptyState(
                          title: _search.isNotEmpty || _dataSourceId.isNotEmpty
                              ? 'No matching evidence'
                              : 'No collected evidence yet',
                          message: _search.isNotEmpty || _dataSourceId.isNotEmpty
                              ? 'Try a different phrase or data source.'
                              : 'Evidence records will appear after collection runs.',
                          icon: Icons.search_off_rounded,
                        )
                      else ...[
                        Row(
                          children: [
                            Container(
                              width: 7,
                              height: 7,
                              decoration: const BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 7),
                            Text(
                              '$_total records',
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 10.2,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const Spacer(),
                            Text(
                              'Page $_page of $_totalPages',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.6,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 9),
                        ..._items.map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 9),
                            child: _EvidenceRecordCard(
                              item: item,
                              onTap: () => _inspect(item),
                            ),
                          ),
                        ),
                        const SizedBox(height: 3),
                        _EvidencePagination(
                          start: start,
                          end: end,
                          total: _total,
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
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EvidenceHero extends StatelessWidget {
  const _EvidenceHero({
    required this.total,
    required this.sourceCount,
    required this.languageCount,
    required this.lastCollection,
  });

  final int total;
  final int sourceCount;
  final int languageCount;
  final String lastCollection;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: AppColors.borderStrong),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 22,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -34,
            top: -42,
            child: Container(
              width: 128,
              height: 128,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primarySoft.withValues(alpha: .68),
              ),
            ),
          ),
          Positioned(
            right: 8,
            top: 16,
            child: Container(
              width: 7,
              height: 7,
              decoration: const BoxDecoration(
                color: AppColors.pink,
                shape: BoxShape.circle,
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.travel_explore_rounded,
                          size: 12,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'EVIDENCE INTELLIGENCE',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 7.3,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .72,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceRose,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text(
                      'READ ONLY',
                      style: TextStyle(
                        color: AppColors.pinkDeep,
                        fontSize: 7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .5,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 13),
              const Text(
                'Inspect the evidence behind the ideas.',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 19.5,
                  height: 1.08,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.35,
                ),
              ),
              const SizedBox(height: 5),
              const Padding(
                padding: EdgeInsets.only(right: 46),
                child: Text(
                  'Collected external voices, source context and discovery signals in one focused admin view.',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.2,
                    height: 1.42,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 13),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 2.28,
                children: [
                  _EvidenceMetric(
                    icon: Icons.description_outlined,
                    label: 'Total evidence',
                    value: _compactNumber(total),
                    tone: AppColors.primarySoft,
                  ),
                  _EvidenceMetric(
                    icon: Icons.storage_outlined,
                    label: 'Data sources',
                    value: '$sourceCount',
                    tone: AppColors.surfaceRose,
                  ),
                  _EvidenceMetric(
                    icon: Icons.translate_rounded,
                    label: 'Languages',
                    value: '$languageCount',
                    tone: AppColors.surface,
                  ),
                  _EvidenceMetric(
                    icon: Icons.schedule_rounded,
                    label: 'Last collection',
                    value: _formatDate(lastCollection, compact: true),
                    tone: AppColors.primarySoft.withValues(alpha: .58),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EvidenceMetric extends StatelessWidget {
  const _EvidenceMetric({
    required this.icon,
    required this.label,
    required this.value,
    required this.tone,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border.withValues(alpha: .92)),
      ),
      child: Row(
        children: [
          Container(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .88),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.border.withValues(alpha: .7)),
            ),
            child: Icon(icon, size: 15, color: AppColors.primaryDark),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  label,
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
          ),
        ],
      ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  const _ToolButton({
    required this.icon,
    required this.eyebrow,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String eyebrow;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Ink(
          height: 51,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: active
                ? AppColors.primarySoft.withValues(alpha: .88)
                : AppColors.background.withValues(alpha: .7),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: active ? AppColors.borderStrong : AppColors.border,
            ),
          ),
          child: Row(
            children: [
              Icon(icon, size: 17, color: AppColors.primaryDark),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 5.9,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .65,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.1,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.expand_more_rounded,
                size: 16,
                color: AppColors.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EvidenceRecordCard extends StatelessWidget {
  const _EvidenceRecordCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final source = _evidenceSource(item);
    final sentiment = _evidenceSentiment(item);
    final content = _compactText(_evidenceContent(item), 150);

    return AdminGlassCard(
      padding: EdgeInsets.zero,
      radius: 20,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 10, 11),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 42,
              height: 42,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                _sourceInitial(source),
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    content.isEmpty ? 'Evidence record' : content,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 11.1,
                      height: 1.32,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Wrap(
                    spacing: 6,
                    runSpacing: 5,
                    children: [
                      _MiniMeta(
                        icon: Icons.storage_outlined,
                        label: source,
                      ),
                      _MiniMeta(
                        icon: Icons.translate_rounded,
                        label: _evidenceLanguage(item),
                      ),
                      _MiniMeta(
                        icon: Icons.favorite_border_rounded,
                        label: '${_evidenceEngagement(item)}',
                      ),
                      if (sentiment.isNotEmpty)
                        _MiniMeta(
                          icon: Icons.psychology_alt_outlined,
                          label: sentiment,
                          rose: sentiment.toLowerCase().contains('negative'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 7),
                  Row(
                    children: [
                      const Icon(
                        Icons.schedule_rounded,
                        size: 12,
                        color: AppColors.textMuted,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Collected ${_formatDate(_collectedAt(item), compact: true)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 5),
            const Padding(
              padding: EdgeInsets.only(top: 11),
              child: Icon(
                Icons.chevron_right_rounded,
                size: 20,
                color: AppColors.sage,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniMeta extends StatelessWidget {
  const _MiniMeta({
    required this.icon,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: rose ? AppColors.surfaceRose : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10,
            color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
          ),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 110),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: rose ? AppColors.pinkDeep : AppColors.textSecondary,
                fontSize: 7.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EvidenceInspector extends StatelessWidget {
  const _EvidenceInspector({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final source = _evidenceSource(item);
    final content = _evidenceContent(item);
    final sentiment = _evidenceSentiment(item);
    final url = _sourceUrl(item);
    final externalId = _first(
      item,
      const ['externalId', 'sourceId', 'commentId', 'id'],
      fallback: '—',
    );

    return _EvidenceSheet(
      maxHeightFactor: .92,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const _SheetHandle(),
          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Text(
                  _sourceInitial(source),
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'EVIDENCE INSPECTOR',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.2,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .85,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      source,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Read-only record captured by the evidence pipeline.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.5,
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
          Flexible(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(13),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(19),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(
                              Icons.description_outlined,
                              size: 14,
                              color: AppColors.primaryDark,
                            ),
                            SizedBox(width: 6),
                            Text(
                              'COLLECTED TEXT',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 7.2,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .75,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 9),
                        SelectableText(
                          content.isEmpty ? 'No collected text available.' : content,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 11.1,
                            height: 1.48,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft.withValues(alpha: .68),
                      borderRadius: BorderRadius.circular(17),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.verified_user_outlined,
                          size: 17,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Evidence, not a platform comment',
                                style: TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              SizedBox(height: 3),
                              Text(
                                'Kept for collection transparency, NLP review and debugging. It has no moderation action.',
                                style: TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 8.3,
                                  height: 1.35,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 2.05,
                    children: [
                      _InspectorField(label: 'Source', value: source),
                      _InspectorField(
                        label: 'Author',
                        value: _evidenceAuthor(item),
                      ),
                      _InspectorField(
                        label: 'Language',
                        value: _evidenceLanguage(item),
                      ),
                      _InspectorField(
                        label: 'Engagement',
                        value: '${_evidenceEngagement(item)}',
                      ),
                      _InspectorField(
                        label: 'Sentiment',
                        value: sentiment.isEmpty ? 'Not analyzed' : sentiment,
                      ),
                      _InspectorField(
                        label: 'Published',
                        value: _formatDate(_publishedAt(item)),
                      ),
                      _InspectorField(
                        label: 'Collected',
                        value: _formatDate(_collectedAt(item)),
                      ),
                      _InspectorField(label: 'External ID', value: externalId),
                    ],
                  ),
                  if (_isHttpUrl(url)) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final uri = Uri.tryParse(url);
                          if (uri != null) {
                            await launchUrl(
                              uri,
                              mode: LaunchMode.externalApplication,
                            );
                          }
                        },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryDark,
                          side: const BorderSide(color: AppColors.borderStrong),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        icon: const Icon(Icons.open_in_new_rounded, size: 17),
                        label: const Text(
                          'Open original source',
                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InspectorField extends StatelessWidget {
  const _InspectorField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 6.5,
              fontWeight: FontWeight.w900,
              letterSpacing: .55,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value.isEmpty ? '—' : value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 9.1,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _EvidencePagination extends StatelessWidget {
  const _EvidencePagination({
    required this.start,
    required this.end,
    required this.total,
    required this.page,
    required this.totalPages,
    required this.loading,
    required this.onPrevious,
    required this.onNext,
  });

  final int start;
  final int end;
  final int total;
  final int page;
  final int totalPages;
  final bool loading;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(11),
      radius: 18,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Showing $start–$end of $total',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.1,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Text(
                'Page $page of $totalPages',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.7,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: loading ? null : onPrevious,
                  icon: const Icon(Icons.chevron_left_rounded, size: 18),
                  label: const Text('Previous'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: loading ? null : onNext,
                  icon: const Icon(Icons.chevron_right_rounded, size: 18),
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

class _EvidenceSheet extends StatelessWidget {
  const _EvidenceSheet({
    required this.child,
    this.maxHeightFactor = .9,
    this.padding = const EdgeInsets.fromLTRB(16, 10, 16, 17),
  });

  final Widget child;
  final double maxHeightFactor;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * maxHeightFactor,
        ),
        child: Material(
          color: AppColors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: Padding(
            padding: padding,
            child: child,
          ),
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.center,
      child: Container(
        width: 42,
        height: 4,
        decoration: BoxDecoration(
          color: AppColors.silver,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}

class _EvidenceChoiceTile extends StatelessWidget {
  const _EvidenceChoiceTile({
    required this.icon,
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .95)
                : AppColors.background.withValues(alpha: .68),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? AppColors.borderStrong : Colors.transparent,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .8),
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(color: AppColors.border),
                ),
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
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
                        fontSize: 10.6,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 7.9,
                          height: 1.25,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? AppColors.primary : AppColors.surface,
                  border: Border.all(
                    color: selected ? AppColors.primary : AppColors.border,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DirectionPicker extends StatelessWidget {
  const _DirectionPicker({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: _DirectionOption(
              icon: Icons.arrow_upward_rounded,
              label: 'Ascending',
              selected: value == 'asc',
              onTap: () => onChanged('asc'),
            ),
          ),
          const SizedBox(width: 5),
          Expanded(
            child: _DirectionOption(
              icon: Icons.arrow_downward_rounded,
              label: 'Descending',
              selected: value == 'desc',
              onTap: () => onChanged('desc'),
            ),
          ),
        ],
      ),
    );
  }
}

class _DirectionOption extends StatelessWidget {
  const _DirectionOption({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          height: 42,
          decoration: BoxDecoration(
            color: selected ? AppColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: AppColors.primaryDark),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.textPrimary
                      : AppColors.textSecondary,
                  fontSize: 8.4,
                  fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EvidenceSortOption {
  const _EvidenceSortOption({
    required this.key,
    required this.label,
    required this.icon,
  });

  final String key;
  final String label;
  final IconData icon;
}

class _EvidenceSourceOption {
  const _EvidenceSourceOption({
    required this.id,
    required this.label,
    this.count = 0,
  });

  final String id;
  final String label;
  final int count;
}

String _evidenceContent(Map<String, dynamic> row) => _first(
      row,
      const ['content', 'text', 'body', 'comment', 'message', 'description'],
      fallback: '',
    );

String _evidenceAuthor(Map<String, dynamic> row) => _first(
      row,
      const [
        'author',
        'authorName',
        'username',
        'userName',
        'channelTitle',
        'creator',
      ],
      fallback: 'Unknown author',
    );

String _evidenceLanguage(Map<String, dynamic> row) => _first(
      row,
      const ['languageCode', 'language', 'lang', 'locale'],
      fallback: '—',
    );

String _evidenceSource(Map<String, dynamic> row) {
  final value = _nestedFirstRaw(
    row,
    const [
      'post.dataSource.displayName',
      'post.dataSource.key',
      'dataSource.displayName',
      'dataSource.name',
      'dataSource.key',
      'sourceName',
      'sourceType',
      'platform',
      'provider',
      'source',
      'post.sourceType',
      'post.source',
      'collectionJob.sourceType',
    ],
  );

  if (value is Map) {
    return _first(
      Map<String, dynamic>.from(value),
      const ['displayName', 'name', 'label', 'key', 'type'],
      fallback: 'External source',
    );
  }

  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? 'External source' : text;
}

int _evidenceEngagement(Map<String, dynamic> row) => _toInt(
      row['likesCount'] ??
          row['likeCount'] ??
          row['likes'] ??
          row['upvotes'] ??
          row['score'] ??
          row['reactionsCount'],
    );

String _evidenceSentiment(Map<String, dynamic> row) {
  final raw = row['sentiment'] ?? row['sentimentLabel'] ?? row['sentimentClass'];
  if (raw is Map) {
    return _first(
      Map<String, dynamic>.from(raw),
      const ['label', 'name', 'value'],
      fallback: '',
    );
  }
  final text = raw?.toString().trim() ?? '';
  return text.toLowerCase() == 'null' ? '' : text;
}

String _publishedAt(Map<String, dynamic> row) => _first(
      row,
      const ['publishedAt', 'postedAt', 'createdAtSource', 'sourceCreatedAt'],
      fallback: '',
    );

String _collectedAt(Map<String, dynamic> row) => _first(
      row,
      const ['collectedAt', 'fetchedAt', 'ingestedAt', 'createdAt'],
      fallback: '',
    );

String _sourceUrl(Map<String, dynamic> row) => _firstNested(
      row,
      const [
        'post.url',
        'sourcePost.url',
        'url',
        'sourceUrl',
        'permalink',
        'link',
      ],
      fallback: '',
    );

String _first(
  Map<String, dynamic> object,
  List<String> keys, {
  String fallback = '—',
}) {
  for (final key in keys) {
    final value = object[key];
    if (value == null) continue;
    final text = value.toString().trim();
    if (text.isNotEmpty && text.toLowerCase() != 'null') return text;
  }
  return fallback;
}

String _firstNested(
  Map<String, dynamic> object,
  List<String> paths, {
  String fallback = '—',
}) {
  final raw = _nestedFirstRaw(object, paths);
  if (raw == null) return fallback;
  final text = raw.toString().trim();
  return text.isEmpty || text.toLowerCase() == 'null' ? fallback : text;
}

dynamic _nestedFirstRaw(Map<String, dynamic> object, List<String> paths) {
  for (final path in paths) {
    dynamic current = object;
    var valid = true;
    for (final part in path.split('.')) {
      if (current is Map && current.containsKey(part)) {
        current = current[part];
      } else {
        valid = false;
        break;
      }
    }
    if (valid && current != null) {
      if (current is String && current.trim().isEmpty) continue;
      return current;
    }
  }
  return null;
}

int _toInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

String _compactText(String value, int max) {
  final normalized = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (normalized.length <= max) return normalized;
  return '${normalized.substring(0, max).trimRight()}…';
}

String _sourceInitial(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'E';
  return text.substring(0, 1).toUpperCase();
}

String _formatDate(String value, {bool compact = false}) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return '—';
  final local = parsed.toLocal();
  return compact
      ? DateFormat('MMM d, yyyy').format(local)
      : DateFormat('MMM d, yyyy · h:mm a').format(local);
}

String _compactNumber(int value) {
  if (value >= 1000000) {
    final number = value / 1000000;
    return '${number.toStringAsFixed(number >= 10 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    final number = value / 1000;
    return '${number.toStringAsFixed(number >= 10 ? 0 : 1)}K';
  }
  return '$value';
}

bool _isHttpUrl(String value) {
  final uri = Uri.tryParse(value);
  return uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
}
