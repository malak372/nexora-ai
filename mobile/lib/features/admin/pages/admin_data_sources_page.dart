import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

class AdminDataSourcesPage extends StatefulWidget {
  const AdminDataSourcesPage({super.key});

  @override
  State<AdminDataSourcesPage> createState() => _AdminDataSourcesPageState();
}

class _AdminDataSourcesPageState extends State<AdminDataSourcesPage> {
  static const _pageSize = 20;

  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _debounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _items = const [];
  Map<String, dynamic> _summary = const {};

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  String _search = '';
  String _sortBy = 'displayName';
  String _sortOrder = 'asc';

  bool? _isActive;
  bool? _isImplemented;
  bool? _supportsPosts;
  bool? _supportsComments;
  bool? _supportsRegion;
  bool? _supportsLanguage;

  bool _loading = true;
  bool _refreshing = false;
  bool _syncing = false;
  String _error = '';

  static const _sortOptions = <_DataSourceSortOption>[
    _DataSourceSortOption(
      key: 'displayName',
      label: 'Display name',
      icon: Icons.sort_by_alpha_rounded,
    ),
    _DataSourceSortOption(
      key: 'key',
      label: 'Source key',
      icon: Icons.key_rounded,
    ),
    _DataSourceSortOption(
      key: 'createdAt',
      label: 'Created date',
      icon: Icons.calendar_month_outlined,
    ),
    _DataSourceSortOption(
      key: 'updatedAt',
      label: 'Last update',
      icon: Icons.update_rounded,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _filterQuery => {
        if (_isActive != null) 'isActive': _isActive.toString(),
        if (_isImplemented != null)
          'isImplemented': _isImplemented.toString(),
        if (_supportsPosts != null)
          'supportsPosts': _supportsPosts.toString(),
        if (_supportsComments != null)
          'supportsComments': _supportsComments.toString(),
        if (_supportsRegion != null)
          'supportsRegion': _supportsRegion.toString(),
        if (_supportsLanguage != null)
          'supportsLanguage': _supportsLanguage.toString(),
      };

  int get _activeFilterCount => [
        _isActive,
        _isImplemented,
        _supportsPosts,
        _supportsComments,
        _supportsRegion,
        _supportsLanguage,
      ].where((value) => value != null).length;

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

    unawaited(
      _api
          .getSummary('/admin/data-sources/summary', force: force)
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _summary = value);
          })
          .catchError((_) {}),
    );

    try {
      final payload = await _api.getList(
        '/admin/data-sources',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: _filterQuery,
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
      setState(() => _error = 'Could not load data sources.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 260), () {
      final next = value.trim();
      if (next == _search) return;
      setState(() {
        _search = next;
        _page = 1;
      });
      _load();
    });
  }

  Future<void> _refresh() => _load(force: true, quiet: true);

  Future<void> _openSort() async {
    var draftSort = _sortBy;
    var draftOrder = _sortOrder;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return _DataSourceSheet(
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
                          'Sort data sources',
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
                      'Choose the field and order. Sorting is applied before pagination.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.2,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 13),
                    ..._sortOptions.map((option) {
                      final selected = option.key == draftSort;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 7),
                        child: _ChoiceTile(
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
                    _SheetPrimaryButton(
                      icon: Icons.check_rounded,
                      label: 'Apply sorting',
                      onPressed: () => Navigator.pop(sheetContext, true),
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

  Future<void> _openFilters() async {
    var active = _isActive;
    var implemented = _isImplemented;
    var posts = _supportsPosts;
    var comments = _supportsComments;
    var region = _supportsRegion;
    var language = _supportsLanguage;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return _DataSourceSheet(
              maxHeightFactor: .9,
              child: Column(
                children: [
                  const _SheetHandle(),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Filter data sources',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.35,
                              ),
                            ),
                            SizedBox(height: 4),
                            Text(
                              'Focus the directory by operational state or capability.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.2,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          setSheetState(() {
                            active = null;
                            implemented = null;
                            posts = null;
                            comments = null;
                            region = null;
                            language = null;
                          });
                        },
                        child: const Text('Reset'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: ListView(
                      padding: EdgeInsets.zero,
                      children: [
                        _TriStateFilter(
                          icon: Icons.power_settings_new_rounded,
                          title: 'Access state',
                          subtitle: 'Whether new collection jobs may use it.',
                          value: active,
                          trueLabel: 'Active',
                          falseLabel: 'Inactive',
                          onChanged: (value) {
                            setSheetState(() => active = value);
                          },
                        ),
                        const SizedBox(height: 9),
                        _TriStateFilter(
                          icon: Icons.extension_outlined,
                          title: 'Implementation switch',
                          subtitle: 'Administrator implementation enablement.',
                          value: implemented,
                          trueLabel: 'Enabled',
                          falseLabel: 'Disabled',
                          onChanged: (value) {
                            setSheetState(() => implemented = value);
                          },
                        ),
                        const SizedBox(height: 9),
                        _TriStateFilter(
                          icon: Icons.article_outlined,
                          title: 'Post records',
                          subtitle: 'Sources that can return post-like records.',
                          value: posts,
                          trueLabel: 'Supported',
                          falseLabel: 'Not supported',
                          onChanged: (value) {
                            setSheetState(() => posts = value);
                          },
                        ),
                        const SizedBox(height: 9),
                        _TriStateFilter(
                          icon: Icons.forum_outlined,
                          title: 'Comments & reviews',
                          subtitle: 'Comments, reviews or reply collection.',
                          value: comments,
                          trueLabel: 'Supported',
                          falseLabel: 'Not supported',
                          onChanged: (value) {
                            setSheetState(() => comments = value);
                          },
                        ),
                        const SizedBox(height: 9),
                        _TriStateFilter(
                          icon: Icons.public_rounded,
                          title: 'Region filtering',
                          subtitle: 'Real geographical filtering support.',
                          value: region,
                          trueLabel: 'Supported',
                          falseLabel: 'Not supported',
                          onChanged: (value) {
                            setSheetState(() => region = value);
                          },
                        ),
                        const SizedBox(height: 9),
                        _TriStateFilter(
                          icon: Icons.translate_rounded,
                          title: 'Language filtering',
                          subtitle: 'External platform language filtering.',
                          value: language,
                          trueLabel: 'Supported',
                          falseLabel: 'Not supported',
                          onChanged: (value) {
                            setSheetState(() => language = value);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  _SheetPrimaryButton(
                    icon: Icons.tune_rounded,
                    label: 'Apply filters',
                    onPressed: () => Navigator.pop(sheetContext, true),
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    if (!mounted || applied != true) return;
    setState(() {
      _isActive = active;
      _isImplemented = implemented;
      _supportsPosts = posts;
      _supportsComments = comments;
      _supportsRegion = region;
      _supportsLanguage = language;
      _page = 1;
    });
    _load();
  }

  Future<void> _synchronize() async {
    if (_syncing) return;
    setState(() => _syncing = true);

    try {
      final result = await _api.synchronizeDataSources();
      if (!mounted) return;
      final updated = _toInt(result['updatedCount']);
      final deactivated = _toInt(result['automaticallyDeactivatedCount']);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            updated == 0
                ? 'Collector registry is already synchronized.'
                : 'Synchronized $updated source${updated == 1 ? '' : 's'} · $deactivated automatically deactivated.',
          ),
        ),
      );
      await _load(force: true, quiet: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _createSource() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .2),
      builder: (_) => const _DataSourceEditorSheet(),
    );

    if (!mounted || changed != true) return;
    await _load(force: true, quiet: true);
  }

  Future<void> _inspect(Map<String, dynamic> item) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .2),
      builder: (_) => _DataSourceDetailSheet(item: item),
    );

    if (!mounted || changed != true) return;
    await _load(force: true, quiet: true);
  }

  String get _sortLabel {
    final match = _sortOptions.where((option) => option.key == _sortBy);
    final label = match.isEmpty ? 'Display name' : match.first.label;
    return '$label · ${_sortOrder == 'asc' ? 'A–Z' : 'Z–A'}';
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
            color: AppColors.primaryDark,
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
                        title: 'Data sources',
                        subtitle:
                            'Control collection providers, capabilities and runtime availability.',
                        eyebrow: 'Data & evidence',
                        icon: Icons.hub_outlined,
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
                                  side: const BorderSide(color: AppColors.border),
                                ),
                                icon: const Icon(Icons.refresh_rounded),
                              ),
                      ),
                      const SizedBox(height: 14),
                      _SourceControlHero(summary: _summary),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: _WorkspaceAction(
                              icon: Icons.add_rounded,
                              title: 'Add source',
                              subtitle: 'Create provider metadata',
                              emphasized: true,
                              onTap: _createSource,
                            ),
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: _WorkspaceAction(
                              icon: _syncing
                                  ? Icons.sync_rounded
                                  : Icons.sync_alt_rounded,
                              title: _syncing ? 'Syncing…' : 'Sync registry',
                              subtitle: 'Verify collectors',
                              onTap: _syncing ? null : _synchronize,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      AdminGlassCard(
                        radius: 23,
                        padding: const EdgeInsets.all(13),
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
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Source directory',
                                        style: TextStyle(
                                          color: AppColors.textPrimary,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      SizedBox(height: 2),
                                      Text(
                                        'Search, filter and inspect operational state.',
                                        style: TextStyle(
                                          color: AppColors.textMuted,
                                          fontSize: 8.8,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 11),
                            AdminSearchField(
                              controller: _searchController,
                              hint: 'Search name, key or description…',
                              onChanged: _onSearchChanged,
                              onSubmitted: (_) {
                                _debounce?.cancel();
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
                                    eyebrow: 'SORT',
                                    label: _sortLabel,
                                    onTap: _openSort,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _ToolButton(
                                    icon: Icons.tune_rounded,
                                    eyebrow: 'FILTER',
                                    label: _activeFilterCount == 0
                                        ? 'All sources'
                                        : '$_activeFilterCount active',
                                    active: _activeFilterCount > 0,
                                    onTap: _openFilters,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      if (_loading && _items.isEmpty)
                        const AdminLoadingList(count: 5)
                      else if (_error.isNotEmpty && _items.isEmpty)
                        AdminEmptyState(
                          title: 'Could not load data sources',
                          message: _error,
                          icon: Icons.cloud_off_outlined,
                          onRetry: () => _load(force: true),
                        )
                      else if (_items.isEmpty)
                        AdminEmptyState(
                          title: 'No matching sources',
                          message:
                              'Try clearing the search or operational filters.',
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
                              '$_total sources',
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
                            child: _DataSourceCard(
                              item: item,
                              onTap: () => _inspect(item),
                            ),
                          ),
                        ),
                        const SizedBox(height: 3),
                        _Pagination(
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

class _SourceControlHero extends StatelessWidget {
  const _SourceControlHero({required this.summary});

  final Map<String, dynamic> summary;

  @override
  Widget build(BuildContext context) {
    final total = _toInt(summary['total']);
    final active = _toInt(summary['active']);
    final available = _toInt(summary['available']);
    final runtime = _toInt(summary['runtimeImplemented']);

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.hub_outlined, size: 13, color: AppColors.primaryDark),
                    SizedBox(width: 6),
                    Text(
                      'COLLECTION CONTROL',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.4,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .75,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.surfaceRose,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$available available',
                  style: const TextStyle(
                    color: AppColors.pinkDeep,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Know what can collect before a run starts.',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 19,
              height: 1.1,
              fontWeight: FontWeight.w900,
              letterSpacing: -.35,
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'Administrative state, runtime collector coverage and source capabilities in one mobile workspace.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.4,
              height: 1.42,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 13),
          Row(
            children: [
              Expanded(
                child: _HeroMetric(
                  icon: Icons.storage_outlined,
                  value: '$total',
                  label: 'Total',
                  tone: AppColors.primarySoft,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _HeroMetric(
                  icon: Icons.toggle_on_outlined,
                  value: '$active',
                  label: 'Active',
                  tone: AppColors.surfaceRose,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _HeroMetric(
                  icon: Icons.extension_outlined,
                  value: '$runtime',
                  label: 'Runtime',
                  tone: AppColors.primarySoft,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _HeroMetric(
                  icon: Icons.check_circle_outline_rounded,
                  value: '$available',
                  label: 'Ready',
                  tone: AppColors.mint.withValues(alpha: .55),
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
    required this.tone,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border.withValues(alpha: .7)),
      ),
      child: Column(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.3,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkspaceAction extends StatelessWidget {
  const _WorkspaceAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.emphasized = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(19),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
          decoration: BoxDecoration(
            color: emphasized ? AppColors.primarySoft : AppColors.surface,
            borderRadius: BorderRadius.circular(19),
            border: Border.all(
              color: emphasized ? AppColors.borderStrong : AppColors.border,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: emphasized ? AppColors.surface : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.5,
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
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          height: 54,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: active
                ? AppColors.primarySoft
                : AppColors.background.withValues(alpha: .62),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: active ? AppColors.borderStrong : AppColors.border,
            ),
          ),
          child: Row(
            children: [
              Icon(icon, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.6,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .7,
                      ),
                    ),
                    const SizedBox(height: 2),
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
                Icons.keyboard_arrow_down_rounded,
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

class _DataSourceCard extends StatelessWidget {
  const _DataSourceCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = _string(item['displayName'], fallback: 'Unnamed source');
    final key = _string(item['key'], fallback: 'unknown');
    final description = _string(item['description']);
    final active = _bool(item['isActive']);
    final implemented = _bool(item['isImplemented']);
    final runtime = _bool(item['runtimeImplemented']);
    final available = _bool(item['isAvailable']);
    final usage = item['usage'] is Map
        ? Map<String, dynamic>.from(item['usage'] as Map)
        : <String, dynamic>{};

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(13),
      radius: 21,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminIconBadge(
                icon: Icons.hub_outlined,
                size: 42,
                tone: available ? AppColors.primarySoft : AppColors.surfaceRose,
                iconColor:
                    available ? AppColors.primaryDark : AppColors.pinkDeep,
              ),
              const SizedBox(width: 10),
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
                        fontSize: 12.7,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      key,
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              _StateBadge(active: active, available: available),
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.sage,
                size: 19,
              ),
            ],
          ),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 9),
            Text(
              description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _TinyPill(
                icon: implemented
                    ? Icons.extension_rounded
                    : Icons.extension_off_outlined,
                label: implemented ? 'Enabled' : 'Impl off',
              ),
              _TinyPill(
                icon: runtime ? Icons.memory_rounded : Icons.memory_outlined,
                label: runtime ? 'Runtime ready' : 'No collector',
                rose: !runtime,
              ),
              if (_bool(item['supportsPosts']))
                const _TinyPill(icon: Icons.article_outlined, label: 'Posts'),
              if (_bool(item['supportsComments']))
                const _TinyPill(icon: Icons.forum_outlined, label: 'Comments'),
              if (_bool(item['supportsRegion']))
                const _TinyPill(icon: Icons.public_rounded, label: 'Region'),
              if (_bool(item['supportsLanguage']))
                const _TinyPill(icon: Icons.translate_rounded, label: 'Language'),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              const Icon(
                Icons.account_tree_outlined,
                size: 13,
                color: AppColors.textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                '${_toInt(usage['collectionJobs'])} jobs',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.2,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 11),
              const Icon(
                Icons.dataset_outlined,
                size: 13,
                color: AppColors.textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                '${_toInt(usage['socialPosts'])} records',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.2,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StateBadge extends StatelessWidget {
  const _StateBadge({required this.active, required this.available});

  final bool active;
  final bool available;

  @override
  Widget build(BuildContext context) {
    final label = available ? 'Available' : active ? 'Active' : 'Inactive';
    final rose = !available;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: rose ? AppColors.surfaceRose : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
          fontSize: 7.4,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _TinyPill extends StatelessWidget {
  const _TinyPill({
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
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: rose ? AppColors.surfaceRose : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 11,
            color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: rose ? AppColors.pinkDeep : AppColors.textSecondary,
              fontSize: 7.3,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _DataSourceDetailSheet extends StatefulWidget {
  const _DataSourceDetailSheet({required this.item});

  final Map<String, dynamic> item;

  @override
  State<_DataSourceDetailSheet> createState() => _DataSourceDetailSheetState();
}

class _DataSourceDetailSheetState extends State<_DataSourceDetailSheet> {
  final _api = AdminApi.instance;
  late Map<String, dynamic> _item;
  bool _loading = false;
  bool _changingStatus = false;
  bool _deleting = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _item = Map<String, dynamic>.from(widget.item);
    unawaited(_hydrate());
  }

  Future<void> _hydrate({bool force = false}) async {
    final id = _string(_item['id']);
    if (id.isEmpty) return;
    setState(() => _loading = true);
    try {
      final detail = await _api.getDetail(
        '/admin/data-sources/$id',
        force: force,
      );
      if (!mounted || detail.isEmpty) return;
      setState(() => _item = {..._item, ...detail});
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleStatus(bool value) async {
    if (_changingStatus) return;
    final id = _string(_item['id']);
    if (id.isEmpty) return;
    setState(() => _changingStatus = true);
    try {
      final updated = await _api.setDataSourceStatus(id, value);
      if (!mounted) return;
      setState(() {
        _item = {..._item, ...updated};
        _changed = true;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(value ? 'Data source activated.' : 'Data source deactivated.'),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (mounted) setState(() => _changingStatus = false);
    }
  }

  Future<void> _delete() async {
    if (_deleting) return;

    final id = _string(_item['id']);
    if (id.isEmpty) return;

    final usage = _item['usage'] is Map
        ? Map<String, dynamic>.from(_item['usage'] as Map)
        : <String, dynamic>{};
    final collectionJobs = _toInt(usage['collectionJobs']);
    final socialPosts = _toInt(usage['socialPosts']);
    final inUse = collectionJobs > 0 || socialPosts > 0;

    if (inUse) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'This source is used by $collectionJobs collection job${collectionJobs == 1 ? '' : 's'} and $socialPosts collected post${socialPosts == 1 ? '' : 's'}. Deactivate it instead.',
          ),
        ),
      );
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .24),
      builder: (dialogContext) {
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.symmetric(horizontal: 22),
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .12),
                  blurRadius: 30,
                  offset: const Offset(0, 14),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceRose,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: const Icon(
                        Icons.delete_outline_rounded,
                        color: AppColors.pinkDeep,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'DELETE DATA SOURCE',
                            style: TextStyle(
                              color: AppColors.pinkDeep,
                              fontSize: 7.8,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            _string(_item['displayName'], fallback: _string(_item['key'])),
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                const Text(
                  'This permanently removes the source from the administrator registry. This action cannot be undone.',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.2,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.pinkDeep,
                          foregroundColor: Colors.white,
                        ),
                        icon: const Icon(Icons.delete_outline_rounded, size: 17),
                        label: const Text('Delete'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );

    if (!mounted || confirmed != true) return;

    setState(() => _deleting = true);

    try {
      final result = await _api.deleteDataSource(id);
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _string(result['message'], fallback: 'Data source deleted successfully.'),
          ),
        ),
      );

      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  Future<void> _edit() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .2),
      builder: (_) => _DataSourceEditorSheet(item: _item),
    );
    if (!mounted || changed != true) return;
    _changed = true;
    await _hydrate(force: true);
  }

  void _close() => Navigator.pop(context, _changed);

  @override
  Widget build(BuildContext context) {
    final name = _string(_item['displayName'], fallback: 'Data source');
    final key = _string(_item['key'], fallback: '—');
    final active = _bool(_item['isActive']);
    final implemented = _bool(_item['isImplemented']);
    final runtime = _bool(_item['runtimeImplemented']);
    final available = _bool(_item['isAvailable']);
    final description = _string(_item['description']);
    final usage = _item['usage'] is Map
        ? Map<String, dynamic>.from(_item['usage'] as Map)
        : <String, dynamic>{};
    final configuration = _item['configuration'];

    return _DataSourceSheet(
      maxHeightFactor: .94,
      child: Column(
        children: [
          const _SheetHandle(),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminIconBadge(
                icon: Icons.hub_outlined,
                size: 45,
                tone: available ? AppColors.primarySoft : AppColors.surfaceRose,
                iconColor:
                    available ? AppColors.primaryDark : AppColors.pinkDeep,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SOURCE INSPECTOR',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      name,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        height: 1.1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      key,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: _close,
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          if (_loading) ...[
            const SizedBox(height: 7),
            const LinearProgressIndicator(
              minHeight: 2,
              color: AppColors.primary,
              backgroundColor: AppColors.primarySoft,
            ),
          ],
          const SizedBox(height: 12),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: available
                        ? AppColors.primarySoft.withValues(alpha: .72)
                        : AppColors.surfaceRose,
                    borderRadius: BorderRadius.circular(19),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 38,
                        height: 38,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          available
                              ? Icons.check_circle_outline_rounded
                              : Icons.info_outline_rounded,
                          size: 18,
                          color: available
                              ? AppColors.primaryDark
                              : AppColors.pinkDeep,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              available ? 'Operational and available' : 'Not fully available',
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 11.2,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              available
                                  ? 'Active, implementation enabled and runtime collector present.'
                                  : 'Inspect access, implementation and runtime collector state below.',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.2,
                                height: 1.3,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 11),
                _SectionCard(
                  title: 'Operational state',
                  icon: Icons.power_settings_new_rounded,
                  child: Column(
                    children: [
                      _InfoRow(
                        label: 'Active',
                        value: active ? 'Yes' : 'No',
                        icon: Icons.toggle_on_outlined,
                      ),
                      _InfoRow(
                        label: 'Implementation switch',
                        value: implemented ? 'Enabled' : 'Disabled',
                        icon: Icons.extension_outlined,
                      ),
                      _InfoRow(
                        label: 'Runtime collector',
                        value: runtime ? 'Registered' : 'Unavailable',
                        icon: Icons.memory_rounded,
                        last: true,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                _SectionCard(
                  title: 'Source profile',
                  icon: Icons.badge_outlined,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _InfoRow(label: 'Display name', value: name),
                      _InfoRow(label: 'Key', value: key),
                      if (description.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text(
                          'Description',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 7.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          description,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.2,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                _SectionCard(
                  title: 'Capabilities',
                  icon: Icons.tune_rounded,
                  child: Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      _CapabilityBadge(
                        icon: Icons.article_outlined,
                        label: 'Posts',
                        supported: _bool(_item['supportsPosts']),
                      ),
                      _CapabilityBadge(
                        icon: Icons.forum_outlined,
                        label: 'Comments',
                        supported: _bool(_item['supportsComments']),
                      ),
                      _CapabilityBadge(
                        icon: Icons.public_rounded,
                        label: 'Region',
                        supported: _bool(_item['supportsRegion']),
                      ),
                      _CapabilityBadge(
                        icon: Icons.translate_rounded,
                        label: 'Language',
                        supported: _bool(_item['supportsLanguage']),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                _SectionCard(
                  title: 'Usage',
                  icon: Icons.insights_outlined,
                  child: Row(
                    children: [
                      Expanded(
                        child: _UsageMetric(
                          value: '${_toInt(usage['collectionJobs'])}',
                          label: 'Collection jobs',
                          icon: Icons.account_tree_outlined,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _UsageMetric(
                          value: '${_toInt(usage['socialPosts'])}',
                          label: 'Collected posts',
                          icon: Icons.dataset_outlined,
                        ),
                      ),
                    ],
                  ),
                ),
                if (configuration != null) ...[
                  const SizedBox(height: 10),
                  _SectionCard(
                    title: 'Configuration',
                    icon: Icons.data_object_rounded,
                    child: SelectableText(
                      _prettyJson(configuration),
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.2,
                        height: 1.45,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                _SectionCard(
                  title: 'Record history',
                  icon: Icons.history_rounded,
                  child: Column(
                    children: [
                      _InfoRow(
                        label: 'Created',
                        value: _formatDate(_item['createdAt']),
                      ),
                      _InfoRow(
                        label: 'Updated',
                        value: _formatDate(_item['updatedAt']),
                        last: true,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: (_toInt(usage['collectionJobs']) > 0 || _toInt(usage['socialPosts']) > 0)
                        ? AppColors.surfaceRose
                        : AppColors.primarySoft.withValues(alpha: .55),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        (_toInt(usage['collectionJobs']) > 0 || _toInt(usage['socialPosts']) > 0)
                            ? Icons.lock_outline_rounded
                            : Icons.delete_sweep_outlined,
                        size: 15,
                        color: (_toInt(usage['collectionJobs']) > 0 || _toInt(usage['socialPosts']) > 0)
                            ? AppColors.pinkDeep
                            : AppColors.primaryDark,
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          (_toInt(usage['collectionJobs']) > 0 || _toInt(usage['socialPosts']) > 0)
                              ? 'Deletion is blocked because this source is referenced by historical collection data. You can deactivate it without removing evidence history.'
                              : 'This source has no historical collection references and can be permanently deleted from the registry.',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.2,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _changingStatus || _deleting
                      ? null
                      : () => _toggleStatus(!active),
                  icon: Icon(
                    active
                        ? Icons.pause_circle_outline_rounded
                        : Icons.play_circle_outline_rounded,
                    size: 17,
                  ),
                  label: Text(active ? 'Deactivate' : 'Activate'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _deleting ? null : _edit,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primarySoft,
                    foregroundColor: AppColors.primaryDark,
                    side: const BorderSide(color: AppColors.borderStrong),
                  ),
                  icon: const Icon(Icons.edit_outlined, size: 17),
                  label: const Text('Edit source'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: (_toInt(usage['collectionJobs']) > 0 ||
                          _toInt(usage['socialPosts']) > 0 ||
                          _deleting)
                  ? null
                  : _delete,
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.pinkDeep,
                side: BorderSide(
                  color: AppColors.pinkDeep.withValues(alpha: .24),
                ),
                backgroundColor: AppColors.surfaceRose.withValues(alpha: .5),
              ),
              icon: _deleting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.pinkDeep,
                      ),
                    )
                  : const Icon(Icons.delete_outline_rounded, size: 17),
              label: Text(
                (_toInt(usage['collectionJobs']) > 0 ||
                        _toInt(usage['socialPosts']) > 0)
                    ? 'Source is in use'
                    : 'Delete data source',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DataSourceEditorSheet extends StatefulWidget {
  const _DataSourceEditorSheet({this.item});

  final Map<String, dynamic>? item;

  @override
  State<_DataSourceEditorSheet> createState() => _DataSourceEditorSheetState();
}

class _DataSourceEditorSheetState extends State<_DataSourceEditorSheet> {
  final _api = AdminApi.instance;
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _keyController;
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _configurationController;

  late bool _isActive;
  late bool _isImplemented;
  late bool _supportsPosts;
  late bool _supportsComments;
  late bool _supportsRegion;
  late bool _supportsLanguage;
  bool _saving = false;

  bool get _editing => widget.item != null;
  bool get _runtimeImplemented => _bool(widget.item?['runtimeImplemented']);

  @override
  void initState() {
    super.initState();
    final item = widget.item ?? const <String, dynamic>{};
    _keyController = TextEditingController(text: _string(item['key']));
    _nameController = TextEditingController(text: _string(item['displayName']));
    _descriptionController = TextEditingController(text: _string(item['description']));
    _configurationController = TextEditingController(
      text: item['configuration'] == null ? '' : _prettyJson(item['configuration']),
    );
    _isActive = _bool(item['isActive']);
    _isImplemented = _editing ? _bool(item['isImplemented']) : false;
    _supportsPosts = _editing ? _bool(item['supportsPosts']) : true;
    _supportsComments = _bool(item['supportsComments']);
    _supportsRegion = _bool(item['supportsRegion']);
    _supportsLanguage = _bool(item['supportsLanguage']);
  }

  @override
  void dispose() {
    _keyController.dispose();
    _nameController.dispose();
    _descriptionController.dispose();
    _configurationController.dispose();
    super.dispose();
  }

  dynamic _parseConfiguration() {
    final raw = _configurationController.text.trim();
    if (raw.isEmpty) return null;
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      throw const FormatException('Configuration must be a JSON object.');
    }
    return Map<String, dynamic>.from(decoded);
  }

  Future<void> _save() async {
    if (_saving || !_formKey.currentState!.validate()) return;

    dynamic configuration;
    try {
      configuration = _parseConfiguration();
    } on FormatException catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
      return;
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Configuration contains invalid JSON.')),
      );
      return;
    }

    setState(() => _saving = true);

    final body = <String, dynamic>{
      if (!_editing) 'key': _keyController.text.trim().toLowerCase(),
      'displayName': _nameController.text.trim(),
      'description': _descriptionController.text.trim(),
      'isActive': _isActive,
      'isImplemented': _isImplemented,
      'supportsPosts': _supportsPosts,
      'supportsComments': _supportsComments,
      'supportsRegion': _supportsRegion,
      'supportsLanguage': _supportsLanguage,
      if (_editing)
        'configuration': configuration ?? <String, dynamic>{}
      else 'configuration': ?configuration,
    };

    try {
      if (_editing) {
        await _api.updateDataSource(_string(widget.item!['id']), body);
      } else {
        await _api.createDataSource(body);
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _DataSourceSheet(
      maxHeightFactor: .95,
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            const _SheetHandle(),
            const SizedBox(height: 12),
            Row(
              children: [
                AdminIconBadge(
                  icon: _editing ? Icons.edit_outlined : Icons.add_rounded,
                  size: 42,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _editing ? 'Edit data source' : 'Create data source',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _editing
                            ? 'Update metadata, capabilities and administrative state.'
                            : 'Register collection provider metadata for the platform.',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 8.5,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  if (!_editing) ...[
                    TextFormField(
                      controller: _keyController,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Source key',
                        hintText: 'youtube',
                        prefixIcon: Icon(Icons.key_rounded),
                      ),
                      validator: (value) {
                        final text = value?.trim() ?? '';
                        if (text.length < 2) return 'Enter at least 2 characters.';
                        if (!RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$').hasMatch(text)) {
                          return 'Use lowercase letters, numbers and single hyphens.';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 10),
                  ] else ...[
                    _LockedField(
                      icon: Icons.key_rounded,
                      label: 'Source key',
                      value: _keyController.text,
                    ),
                    const SizedBox(height: 10),
                  ],
                  TextFormField(
                    controller: _nameController,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Display name',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      if (text.length < 2) return 'Enter at least 2 characters.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _descriptionController,
                    maxLines: 3,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      alignLabelWithHint: true,
                      prefixIcon: Padding(
                        padding: EdgeInsets.only(bottom: 52),
                        child: Icon(Icons.notes_rounded),
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  _EditorSection(
                    title: 'Operational state',
                    icon: Icons.power_settings_new_rounded,
                    children: [
                      _EditorSwitch(
                        title: 'Implementation enabled',
                        subtitle: _editing && !_runtimeImplemented
                            ? 'No deployed collector is registered for this key.'
                            : 'Administrator implementation switch.',
                        value: _isImplemented,
                        onChanged: (value) {
                          setState(() {
                            _isImplemented = value;
                            if (!value) _isActive = false;
                          });
                        },
                      ),
                      _EditorSwitch(
                        title: 'Active',
                        subtitle: 'Allow new collection jobs to use this source.',
                        value: _isActive,
                        onChanged: (value) {
                          setState(() => _isActive = value);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _EditorSection(
                    title: 'Collection capabilities',
                    icon: Icons.tune_rounded,
                    children: [
                      _EditorSwitch(
                        title: 'Posts',
                        subtitle: 'Returns post-like records.',
                        value: _supportsPosts,
                        onChanged: (value) {
                          setState(() => _supportsPosts = value);
                        },
                      ),
                      _EditorSwitch(
                        title: 'Comments / reviews',
                        subtitle: 'Returns comments, reviews or replies.',
                        value: _supportsComments,
                        onChanged: (value) {
                          setState(() => _supportsComments = value);
                        },
                      ),
                      _EditorSwitch(
                        title: 'Region filtering',
                        subtitle: 'Supports real geographical filtering.',
                        value: _supportsRegion,
                        onChanged: (value) {
                          setState(() => _supportsRegion = value);
                        },
                      ),
                      _EditorSwitch(
                        title: 'Language filtering',
                        subtitle: 'Supports external language filtering.',
                        value: _supportsLanguage,
                        onChanged: (value) {
                          setState(() => _supportsLanguage = value);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _configurationController,
                    maxLines: 7,
                    decoration: const InputDecoration(
                      labelText: 'Configuration JSON',
                      hintText: '{\n  "option": true\n}',
                      alignLabelWithHint: true,
                      prefixIcon: Padding(
                        padding: EdgeInsets.only(bottom: 110),
                        child: Icon(Icons.data_object_rounded),
                      ),
                    ),
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10.5,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft.withValues(alpha: .55),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Text(
                      'Activation is accepted only when implementation is enabled and a matching runtime collector is deployed.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.1,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primarySoft,
                  foregroundColor: AppColors.primaryDark,
                  side: const BorderSide(color: AppColors.borderStrong),
                ),
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.primaryDark,
                        ),
                      )
                    : const Icon(Icons.check_rounded, size: 18),
                label: Text(_editing ? 'Save changes' : 'Create source'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LockedField extends StatelessWidget {
  const _LockedField({
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 17, color: AppColors.primaryDark),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.3,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.4,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.lock_outline_rounded, size: 15, color: AppColors.sage),
        ],
      ),
    );
  }
}

class _EditorSection extends StatelessWidget {
  const _EditorSection({
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
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .65),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(icon, size: 15, color: AppColors.primaryDark),
              const SizedBox(width: 7),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.4,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          ...children,
        ],
      ),
    );
  }
}

class _EditorSwitch extends StatelessWidget {
  const _EditorSwitch({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        visualDensity: VisualDensity.compact,
        activeTrackColor: AppColors.primary,
        title: Text(
          title,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 9.7,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 7.5,
            height: 1.25,
          ),
        ),
        value: value,
        onChanged: onChanged,
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 29,
                height: 29,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, size: 14, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.7,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          child,
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.label,
    required this.value,
    this.icon,
    this.last = false,
  });

  final String label;
  final String value;
  final IconData? icon;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: AppColors.primaryDark),
            const SizedBox(width: 7),
          ],
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 8.1,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 8.8,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CapabilityBadge extends StatelessWidget {
  const _CapabilityBadge({
    required this.icon,
    required this.label,
    required this.supported,
  });

  final IconData icon;
  final String label;
  final bool supported;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: supported ? AppColors.primarySoft : AppColors.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 12,
            color: supported ? AppColors.primaryDark : AppColors.sage,
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: supported ? AppColors.textPrimary : AppColors.textMuted,
              fontSize: 7.8,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 5),
          Icon(
            supported ? Icons.check_rounded : Icons.close_rounded,
            size: 11,
            color: supported ? AppColors.primaryDark : AppColors.sage,
          ),
        ],
      ),
    );
  }
}

class _UsageMetric extends StatelessWidget {
  const _UsageMetric({
    required this.value,
    required this.label,
    required this.icon,
  });

  final String value;
  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _TriStateFilter extends StatelessWidget {
  const _TriStateFilter({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.trueLabel,
    required this.falseLabel,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool? value;
  final String trueLabel;
  final String falseLabel;
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.6,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: _TriOption(
                  label: 'All',
                  selected: value == null,
                  onTap: () => onChanged(null),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _TriOption(
                  label: trueLabel,
                  selected: value == true,
                  onTap: () => onChanged(true),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: _TriOption(
                  label: falseLabel,
                  selected: value == false,
                  onTap: () => onChanged(false),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TriOption extends StatelessWidget {
  const _TriOption({
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
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(11),
        child: Ink(
          height: 36,
          decoration: BoxDecoration(
            color: selected ? AppColors.primarySoft : AppColors.surface,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Align(
            alignment: Alignment.center,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                label,
                style: TextStyle(
                  color: selected ? AppColors.primaryDark : AppColors.textSecondary,
                  fontSize: 8,
                  fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({
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
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
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
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(color: AppColors.border),
                ),
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                  ),
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
          height: 40,
          decoration: BoxDecoration(
            color: selected ? AppColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: AppColors.primaryDark),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  color: selected ? AppColors.textPrimary : AppColors.textSecondary,
                  fontSize: 8.3,
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

class _SheetPrimaryButton extends StatelessWidget {
  const _SheetPrimaryButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: FilledButton.icon(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primarySoft,
          foregroundColor: AppColors.primaryDark,
          side: const BorderSide(color: AppColors.borderStrong),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        icon: Icon(icon, size: 18),
        label: Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
      ),
    );
  }
}

class _DataSourceSheet extends StatelessWidget {
  const _DataSourceSheet({
    required this.child,
    this.maxHeightFactor = .9,
  });

  final Widget child;
  final double maxHeightFactor;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return FractionallySizedBox(
      heightFactor: maxHeightFactor,
      alignment: Alignment.bottomCenter,
      child: Container(
        padding: EdgeInsets.fromLTRB(16, 10, 16, 16 + bottom),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: child,
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

class _Pagination extends StatelessWidget {
  const _Pagination({
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      radius: 18,
      child: Row(
        children: [
          IconButton(
            onPressed: loading ? null : onPrevious,
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  '$start–$end of $total',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Page $page of $totalPages',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.7,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: loading ? null : onNext,
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }
}

class _DataSourceSortOption {
  const _DataSourceSortOption({
    required this.key,
    required this.label,
    required this.icon,
  });

  final String key;
  final String label;
  final IconData icon;
}

String _string(dynamic value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

bool _bool(dynamic value) {
  if (value is bool) return value;
  final text = value?.toString().trim().toLowerCase();
  return text == 'true' || text == '1';
}

int _toInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

String _formatDate(dynamic value) {
  final raw = value?.toString().trim() ?? '';
  if (raw.isEmpty) return '—';
  final parsed = DateTime.tryParse(raw)?.toLocal();
  if (parsed == null) return raw;
  return DateFormat('MMM d, yyyy · HH:mm').format(parsed);
}

String _prettyJson(dynamic value) {
  try {
    return const JsonEncoder.withIndent('  ').convert(value);
  } catch (_) {
    return value?.toString() ?? '{}';
  }
}
