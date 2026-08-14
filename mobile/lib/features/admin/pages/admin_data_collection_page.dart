import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

const _collectionStatuses = ['all', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED'];

const _collectionSortOptions = <_CollectionSortOption>[
  _CollectionSortOption('createdAt', 'Created date'),
  _CollectionSortOption('startedAt', 'Started date'),
  _CollectionSortOption('completedAt', 'Completed date'),
  _CollectionSortOption('totalPosts', 'Posts collected'),
  _CollectionSortOption('totalComments', 'Comments collected'),
];

class AdminDataCollectionPage extends StatefulWidget {
  const AdminDataCollectionPage({super.key});

  @override
  State<AdminDataCollectionPage> createState() => _AdminDataCollectionPageState();
}

class _AdminDataCollectionPageState extends State<AdminDataCollectionPage> {
  final _api = AdminApi.instance;
  final _client = ApiClient.instance;
  final _searchController = TextEditingController();

  Timer? _debounce;
  List<Map<String, dynamic>> _items = const [];
  Map<String, dynamic> _statusPayload = const {};
  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  String _search = '';
  String _status = 'all';
  String _source = 'all';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';
  bool _loading = true;
  bool _refreshing = false;
  String _error = '';
  int _requestId = 0;

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

  Future<void> _load({bool force = false, bool quiet = false}) async {
    final requestId = ++_requestId;

    if (quiet) {
      setState(() {
        _refreshing = true;
        _error = '';
      });
    } else {
      setState(() {
        _loading = true;
        _error = '';
      });
    }

    unawaited(_hydrateStatus(requestId, force: force));

    try {
      final payload = await _api.getList(
        '/data-collection/jobs',
        page: _page,
        limit: 20,
        search: _search,
        status: _status == 'all' ? null : _status,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: {if (_source != 'all') 'dataSourceKey': _source},
      );

      if (!mounted || requestId != _requestId) return;

      final rows = (payload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
      final meta = _map(payload['meta']);

      setState(() {
        _items = rows;
        _total = _int(meta['total'], rows.length);
        _totalPages = _int(meta['totalPages'], 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = 'Could not load collection runs.');
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _hydrateStatus(int requestId, {required bool force}) async {
    try {
      final value = await _api.getSummary('/data-collection/status', force: force);
      if (!mounted || requestId != _requestId) return;
      final nested = _map(value['data']);
      setState(() => _statusPayload = nested.isNotEmpty ? nested : value);
    } catch (_) {}
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 280), () {
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

  void _setStatus(String value) {
    if (_status == value) return;
    setState(() {
      _status = value;
      _page = 1;
    });
    _load();
  }

  Future<void> _openFilters() async {
    final selection = await showModalBottomSheet<_CollectionFilterSelection>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .16),
      builder: (_) => _CollectionFiltersSheet(
        status: _status,
        source: _source,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        sources: _availableSources,
      ),
    );

    if (!mounted || selection == null) return;
    final changed = selection.status != _status ||
        selection.source != _source ||
        selection.sortBy != _sortBy ||
        selection.sortOrder != _sortOrder;
    if (!changed) return;

    setState(() {
      _status = selection.status;
      _source = selection.source;
      _sortBy = selection.sortBy;
      _sortOrder = selection.sortOrder;
      _page = 1;
    });
    _load();
  }

  Future<void> _openDetails(Map<String, dynamic> run) async {
    final message = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (_) => _CollectionDetailsSheet(
        run: run,
        onLoad: _loadDetail,
        onStop: _stopRun,
        onRetry: _retryRun,
      ),
    );

    if (!mounted || message == null || message.isEmpty) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    await _load(force: true, quiet: true);
  }

  Future<Map<String, dynamic>> _loadDetail(String id) async {
    return _api.getDetail('/data-collection/jobs/$id');
  }

  Future<void> _stopRun(String id) async {
    await _client.post('/data-collection/$id/stop', data: const {});
    _invalidateCollection();
  }

  Future<void> _retryRun(Map<String, dynamic> run) async {
    final sources = _collectionSources(run);
    final sourceKeys = sources.map(_sourceKey).where((value) => value.isNotEmpty).toList();
    final keywords = _keywords(run['keywords']);
    final domain = _map(run['domain']);
    final domainId = _text(run['domainId']).isNotEmpty ? _text(run['domainId']) : _text(domain['id']);

    final body = <String, dynamic>{
      if (domainId.isNotEmpty) 'domainId': domainId,
      if (_text(run['language']).isNotEmpty) 'language': _text(run['language']),
      if (_text(run['country']).isNotEmpty) 'country': _text(run['country']),
      if (_text(run['city']).isNotEmpty) 'city': _text(run['city']),
      if (_text(run['region']).isNotEmpty) 'region': _text(run['region']),
      if (_number(run['radiusKm']) > 0) 'radiusKm': _number(run['radiusKm']),
      if (sourceKeys.isNotEmpty) 'dataSourceKeys': sourceKeys,
      if (keywords.isNotEmpty) 'keywords': keywords,
    };

    await _client.post('/data-collection/run', data: body);
    _invalidateCollection();
  }

  void _invalidateCollection() {
    _client.invalidate('/data-collection/jobs');
    _client.invalidate('/data-collection/status');
    _client.invalidate('/data-collection');
    _client.invalidate('/admin/dashboard');
  }

  List<Map<String, dynamic>> get _availableSources {
    final value = _statusPayload['dataSources'];
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final jobs = _map(_statusPayload['jobs']);
    final running = _int(jobs['running']);
    final completed = _int(jobs['completed']);
    final failed = _int(jobs['failed']);
    final stopped = _int(jobs['stopped']);
    final pending = _int(jobs['pending']);
    final statusTotal = _int(jobs['total'], running + completed + failed + stopped + pending);
    final totalRuns = statusTotal > 0 ? statusTotal : _total;
    final available = _statusPayload['available'] != false;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primaryDark,
            backgroundColor: AppColors.surface,
            onRefresh: () => _load(force: true, quiet: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 30),
              children: [
                AdminPageHeader(
                  title: 'Data collection',
                  subtitle: 'Track collection jobs and source execution state.',
                  eyebrow: 'Data & evidence',
                  icon: Icons.account_tree_outlined,
                  onBack: () => Navigator.of(context).maybePop(),
                  trailing: _HeaderAction(
                    icon: Icons.refresh_rounded,
                    busy: _refreshing,
                    onTap: _refreshing ? null : () => _load(force: true, quiet: true),
                  ),
                ),
                const SizedBox(height: 18),
                _CollectionOverviewCard(
                  available: available,
                  sources: _availableSources.length,
                  total: totalRuns,
                  running: running,
                  completed: completed,
                  failed: failed,
                  stopped: stopped,
                  pending: pending,
                ),
                const SizedBox(height: 16),
                _CollectionStatusTabs(
                  value: _status,
                  jobs: jobs,
                  total: totalRuns,
                  onChanged: _setStatus,
                ),
                const SizedBox(height: 14),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 58,
                        child: TextField(
                          controller: _searchController,
                          onChanged: _onSearchChanged,
                          textInputAction: TextInputAction.search,
                          decoration: InputDecoration(
                            hintText: 'Search collection runs...',
                            prefixIcon: const Icon(Icons.search_rounded, size: 21),
                            suffixIcon: _searchController.text.isEmpty
                                ? null
                                : IconButton(
                                    onPressed: () {
                                      _searchController.clear();
                                      _onSearchChanged('');
                                      setState(() {});
                                    },
                                    icon: const Icon(Icons.close_rounded, size: 18),
                                  ),
                            filled: true,
                            fillColor: AppColors.surface.withValues(alpha: .92),
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(18),
                              borderSide: const BorderSide(color: AppColors.borderStrong),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(18),
                              borderSide: const BorderSide(color: AppColors.borderStrong),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(18),
                              borderSide: const BorderSide(color: AppColors.primary, width: 1.35),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    _ToolbarFilterButton(
                      onTap: _openFilters,
                      active: _status != 'all' ||
                          _source != 'all' ||
                          _sortBy != 'createdAt' ||
                          _sortOrder != 'desc',
                    ),
                  ],
                ),
                if (_source != 'all') ...[
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: GestureDetector(
                      onTap: () {
                        setState(() {
                          _source = 'all';
                          _page = 1;
                        });
                        _load();
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                        decoration: BoxDecoration(
                          color: AppColors.primarySoft,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _sourceLabel(_source, _availableSources),
                              style: const TextStyle(
                                color: AppColors.primaryDeep,
                                fontSize: 9.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(width: 5),
                            const Icon(Icons.close_rounded, size: 14, color: AppColors.primaryDark),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text(
                      '$totalRuns records',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const Spacer(),
                    if (_totalPages > 1)
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
                if (_loading && _items.isEmpty)
                  const _LoadingCards()
                else if (_error.isNotEmpty && _items.isEmpty)
                  _ErrorCard(message: _error, onRetry: () => _load(force: true))
                else if (_items.isEmpty)
                  const _StateCard(
                    icon: Icons.account_tree_outlined,
                    title: 'No collection runs found',
                    message: 'Try another status, data source, or search term.',
                  )
                else ...[
                  ..._items.map(
                    (run) => Padding(
                      padding: const EdgeInsets.only(bottom: 11),
                      child: _CollectionRunCard(run: run, onTap: () => _openDetails(run)),
                    ),
                  ),
                  if (_totalPages > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: _PaginationBar(
                        page: _page,
                        totalPages: _totalPages,
                        onPrevious: _page <= 1
                            ? null
                            : () {
                                setState(() => _page -= 1);
                                _load();
                              },
                        onNext: _page >= _totalPages
                            ? null
                            : () {
                                setState(() => _page += 1);
                                _load();
                              },
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

class _CollectionOverviewCard extends StatelessWidget {
  const _CollectionOverviewCard({
    required this.available,
    required this.sources,
    required this.total,
    required this.running,
    required this.completed,
    required this.failed,
    required this.stopped,
    required this.pending,
  });

  final bool available;
  final int sources;
  final int total;
  final int running;
  final int completed;
  final int failed;
  final int stopped;
  final int pending;

  @override
  Widget build(BuildContext context) {
    final attention = failed + stopped;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 15, 16, 16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFF1F9F6), Color(0xFFFFFAFB)],
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.borderStrong.withValues(alpha: .8)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 20,
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
                width: 39,
                height: 39,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.account_tree_outlined,
                  size: 19,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: available ? AppColors.success : AppColors.pink,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          available ? 'Live collection pipeline' : 'Pipeline unavailable',
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 11.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '$sources configured source${sources == 1 ? '' : 's'} · $pending pending',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.surface.withValues(alpha: .82),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: AppColors.border),
                ),
                child: Text(
                  '$total runs',
                  style: const TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 15),
          LayoutBuilder(
            builder: (context, constraints) {
              final itemWidth = (constraints.maxWidth - 16) / 3;
              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _CollectionOverviewMetric(
                    width: itemWidth,
                    icon: Icons.play_circle_outline_rounded,
                    label: 'Running',
                    value: running,
                    tint: AppColors.primarySoft,
                  ),
                  _CollectionOverviewMetric(
                    width: itemWidth,
                    icon: Icons.check_circle_outline_rounded,
                    label: 'Completed',
                    value: completed,
                    tint: const Color(0xFFF3FAF7),
                  ),
                  _CollectionOverviewMetric(
                    width: itemWidth,
                    icon: Icons.error_outline_rounded,
                    label: 'Attention',
                    value: attention,
                    tint: attention > 0 ? AppColors.surfaceRose : AppColors.surface,
                  ),
                ],
              );
            },
          ),
          if (attention > 0) ...[
            const SizedBox(height: 10),
            Text(
              '$failed failed · $stopped stopped',
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 8.7,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _CollectionOverviewMetric extends StatelessWidget {
  const _CollectionOverviewMetric({
    required this.width,
    required this.icon,
    required this.label,
    required this.value,
    required this.tint,
  });

  final double width;
  final IconData icon;
  final String label;
  final int value;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: .9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border.withValues(alpha: .8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(height: 7),
          Text(
            '$value',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              height: 1,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.3,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _CollectionStatusTabs extends StatelessWidget {
  const _CollectionStatusTabs({
    required this.value,
    required this.jobs,
    required this.total,
    required this.onChanged,
  });

  final String value;
  final Map<String, dynamic> jobs;
  final int total;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    int countFor(String status) {
      if (status == 'all') return total;
      return _int(jobs[status.toLowerCase()]);
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _collectionStatuses.map((status) {
          final selected = value == status;
          final label = status == 'all' ? 'All' : _readable(status);
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () => onChanged(status),
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                decoration: BoxDecoration(
                  color: selected ? AppColors.primarySoft : AppColors.surface,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: selected ? AppColors.primary.withValues(alpha: .35) : AppColors.border,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: selected ? AppColors.primaryDeep : AppColors.textSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      countFor(status).toString(),
                      style: TextStyle(
                        color: selected ? AppColors.primaryDark : AppColors.textMuted,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _CollectionRunCard extends StatelessWidget {
  const _CollectionRunCard({required this.run, required this.onTap});

  final Map<String, dynamic> run;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final domain = _map(run['domain']);
    final domainName = _text(domain['name']).isEmpty ? 'Unknown domain' : _text(domain['name']);
    final sources = _collectionSources(run);
    final posts = _int(run['totalPosts']);
    final comments = _int(run['totalComments']);
    final location = _location(run);
    final status = _text(run['status']).toUpperCase();

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 14, 12, 13),
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: .94),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: AppColors.borderStrong.withValues(alpha: .8)),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .025),
              blurRadius: 16,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        child: Column(
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _statusVisual(status).soft,
                    borderRadius: BorderRadius.circular(15),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Icon(Icons.account_tree_outlined, size: 22, color: _statusVisual(status).foreground),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        domainName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14.1,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Run ${_shortId(run['id'])} · ${_text(run['language']).isEmpty ? 'ANY' : _text(run['language'])}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.4,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 7),
                _RunStatusPill(status: status),
                const SizedBox(width: 6),
                const Icon(Icons.chevron_right_rounded, size: 21, color: AppColors.sage),
              ],
            ),
            const SizedBox(height: 11),
            Row(
              children: [
                Expanded(
                  child: _InfoLine(
                    icon: location.isEmpty ? Icons.public_rounded : Icons.location_on_outlined,
                    text: location.isEmpty ? 'Global scope' : location,
                  ),
                ),
                const SizedBox(width: 8),
                _InfoLine(
                  icon: Icons.schedule_rounded,
                  text: _duration(run['startedAt'], run['completedAt'], status),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.fromLTRB(11, 9, 11, 9),
              decoration: BoxDecoration(
                color: AppColors.background.withValues(alpha: .74),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: AppColors.border.withValues(alpha: .65)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: sources.isEmpty
                        ? const Text(
                            'No source execution records',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.9,
                              fontWeight: FontWeight.w700,
                            ),
                          )
                        : Wrap(
                            spacing: 5,
                            runSpacing: 5,
                            children: [
                              ...sources.take(2).map(
                                (source) => _SourceChip(label: _sourceName(source)),
                              ),
                              if (sources.length > 2) _SourceChip(label: '+${sources.length - 2}'),
                            ],
                          ),
                  ),
                  const SizedBox(width: 8),
                  _EvidenceCount(icon: Icons.article_outlined, value: posts),
                  const SizedBox(width: 8),
                  _EvidenceCount(icon: Icons.forum_outlined, value: comments),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: AppColors.textMuted),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: AppColors.primaryDeep,
          fontSize: 8.3,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _EvidenceCount extends StatelessWidget {
  const _EvidenceCount({required this.icon, required this.value});

  final IconData icon;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: AppColors.primaryDark),
        const SizedBox(width: 3),
        Text(
          value.toString(),
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 8.8,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _RunStatusPill extends StatelessWidget {
  const _RunStatusPill({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final visual = _statusVisual(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: visual.soft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        visual.label,
        style: TextStyle(
          color: visual.foreground,
          fontSize: 8.9,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _CollectionFiltersSheet extends StatefulWidget {
  const _CollectionFiltersSheet({
    required this.status,
    required this.source,
    required this.sortBy,
    required this.sortOrder,
    required this.sources,
  });

  final String status;
  final String source;
  final String sortBy;
  final String sortOrder;
  final List<Map<String, dynamic>> sources;

  @override
  State<_CollectionFiltersSheet> createState() => _CollectionFiltersSheetState();
}

class _CollectionFiltersSheetState extends State<_CollectionFiltersSheet> {
  late String _status;
  late String _source;
  late String _sortBy;
  late String _sortOrder;

  @override
  void initState() {
    super.initState();
    _status = widget.status;
    _source = widget.source;
    _sortBy = widget.sortBy;
    _sortOrder = widget.sortOrder;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * .82),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(18, 10, 18, 18 + MediaQuery.paddingOf(context).bottom),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: AppColors.sage.withValues(alpha: .45),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const Row(
              children: [
                Icon(Icons.tune_rounded, size: 19, color: AppColors.primaryDark),
                SizedBox(width: 8),
                Text(
                  'Collection filters',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const _SheetLabel('Run status'),
            const SizedBox(height: 9),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _collectionStatuses
                  .map(
                    (status) => _SheetChoice(
                      label: status == 'all' ? 'All runs' : _readable(status),
                      selected: _status == status,
                      onTap: () => setState(() => _status = status),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 20),
            const _SheetLabel('Data source'),
            const SizedBox(height: 9),
            _RadioRow(
              label: 'All data sources',
              selected: _source == 'all',
              onTap: () => setState(() => _source = 'all'),
            ),
            ...widget.sources.map((source) {
              final key = _text(source['key']);
              if (key.isEmpty) return const SizedBox.shrink();
              return _RadioRow(
                label: _text(source['displayName']).isEmpty ? key : _text(source['displayName']),
                selected: _source == key,
                onTap: () => setState(() => _source = key),
              );
            }),
            const SizedBox(height: 17),
            const _SheetLabel('Sort by'),
            const SizedBox(height: 9),
            ..._collectionSortOptions.map(
              (option) => _RadioRow(
                label: option.label,
                selected: _sortBy == option.key,
                onTap: () => setState(() => _sortBy = option.key),
              ),
            ),
            const SizedBox(height: 17),
            const _SheetLabel('Order'),
            const SizedBox(height: 9),
            Row(
              children: [
                Expanded(
                  child: _OrderChoice(
                    icon: Icons.arrow_upward_rounded,
                    label: 'Ascending',
                    selected: _sortOrder == 'asc',
                    onTap: () => setState(() => _sortOrder = 'asc'),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: _OrderChoice(
                    icon: Icons.arrow_downward_rounded,
                    label: 'Descending',
                    selected: _sortOrder == 'desc',
                    onTap: () => setState(() => _sortOrder = 'desc'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      setState(() {
                        _status = 'all';
                        _source = 'all';
                        _sortBy = 'createdAt';
                        _sortOrder = 'desc';
                      });
                    },
                    child: const Text('Reset'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () => Navigator.of(context).pop(
                      _CollectionFilterSelection(
                        status: _status,
                        source: _source,
                        sortBy: _sortBy,
                        sortOrder: _sortOrder,
                      ),
                    ),
                    child: const Text('Apply filters'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CollectionDetailsSheet extends StatefulWidget {
  const _CollectionDetailsSheet({
    required this.run,
    required this.onLoad,
    required this.onStop,
    required this.onRetry,
  });

  final Map<String, dynamic> run;
  final Future<Map<String, dynamic>> Function(String id) onLoad;
  final Future<void> Function(String id) onStop;
  final Future<void> Function(Map<String, dynamic> run) onRetry;

  @override
  State<_CollectionDetailsSheet> createState() => _CollectionDetailsSheetState();
}

class _CollectionDetailsSheetState extends State<_CollectionDetailsSheet> {
  late Map<String, dynamic> _run;
  bool _hydrating = true;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _run = Map<String, dynamic>.from(widget.run);
    unawaited(_hydrate());
  }

  Future<void> _hydrate() async {
    final id = _text(_run['id']);
    if (id.isEmpty) {
      setState(() => _hydrating = false);
      return;
    }
    try {
      final value = await widget.onLoad(id);
      if (!mounted) return;
      final nested = _map(value['data']);
      setState(() {
        _run = nested.isNotEmpty ? nested : value;
        _hydrating = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _hydrating = false);
    }
  }

  Future<void> _stop() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        title: const Text('Stop collection run?'),
        content: const Text('The active collection job will be asked to stop. Existing collected evidence is kept.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Stop run')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.onStop(_text(_run['id']));
      if (!mounted) return;
      Navigator.of(context).pop('Collection run stopped.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not stop this collection run.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retry() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.onRetry(_run);
      if (!mounted) return;
      Navigator.of(context).pop('A fresh collection run was started with the same configuration.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not retry this collection run.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _text(_run['status']).toUpperCase();
    final domain = _map(_run['domain']);
    final sources = _collectionSources(_run);
    final keywords = _keywords(_run['keywords']);
    final posts = _int(_run['totalPosts']);
    final comments = _int(_run['totalComments']);
    final running = status == 'RUNNING';
    final retryable = status == 'FAILED' || status == 'STOPPED';
    final createdBy = _map(_run['createdBy']);
    final creator = _text(createdBy['fullName']).isNotEmpty
        ? _text(createdBy['fullName'])
        : _text(createdBy['email']).isNotEmpty
            ? _text(createdBy['email'])
            : _text(_run['createdById']).isNotEmpty
                ? 'User ${_shortId(_run['createdById'])}'
                : 'Internal / legacy';

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .9,
      minChildSize: .62,
      maxChildSize: .97,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 12, 10),
                child: Column(
                  children: [
                    Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.sage.withValues(alpha: .45),
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        Container(
                          width: 43,
                          height: 43,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: _statusVisual(status).soft,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(
                            Icons.account_tree_outlined,
                            size: 21,
                            color: _statusVisual(status).foreground,
                          ),
                        ),
                        const SizedBox(width: 11),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _text(domain['name']).isEmpty ? 'Collection run' : _text(domain['name']),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 17.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                'Run ${_shortId(_run['id'])} · ${_date(_run['createdAt'])}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 9.2,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_hydrating)
                          const Padding(
                            padding: EdgeInsets.only(right: 6),
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
                            ),
                          ),
                        IconButton(
                          onPressed: _busy ? null : () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(18, 17, 18, 26),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _DetailMetric(
                            label: 'Pipeline status',
                            value: _statusVisual(status).label,
                            icon: Icons.monitor_heart_outlined,
                            tint: _statusVisual(status).soft,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _DetailMetric(
                            label: 'Evidence',
                            value: '${posts + comments}',
                            icon: Icons.dataset_outlined,
                            tint: AppColors.primarySoft,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _DetailMetric(
                            label: 'Duration',
                            value: _duration(_run['startedAt'], _run['completedAt'], status),
                            icon: Icons.timer_outlined,
                            tint: AppColors.surfaceRose,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _DetailSection(
                      title: 'Run context',
                      icon: Icons.layers_outlined,
                      child: Column(
                        children: [
                          _FactRow(label: 'Domain', value: _text(domain['name']).isEmpty ? '—' : _text(domain['name'])),
                          _FactRow(label: 'Language', value: _text(_run['language']).isEmpty ? '—' : _text(_run['language'])),
                          _FactRow(label: 'Started by', value: creator),
                          _FactRow(label: 'Location', value: _location(_run).isEmpty ? 'No location restriction' : _location(_run)),
                          _FactRow(label: 'Radius', value: _number(_run['radiusKm']) > 0 ? '${_number(_run['radiusKm'])} km' : 'Not set'),
                          _FactRow(label: 'Run ID', value: _text(_run['id']).isEmpty ? '—' : _text(_run['id']), mono: true),
                        ],
                      ),
                    ),
                    if (keywords.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _DetailSection(
                        title: 'Keywords',
                        icon: Icons.sell_outlined,
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: keywords
                              .take(12)
                              .map((value) => _SourceChip(label: value))
                              .toList(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    _DetailSection(
                      title: 'Source execution',
                      icon: Icons.storage_outlined,
                      child: sources.isEmpty
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'No source execution records are attached to this run.',
                                style: TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 9.6,
                                  height: 1.4,
                                ),
                              ),
                            )
                          : Column(
                              children: sources
                                  .map((source) => _SourceExecutionRow(source: source))
                                  .toList(),
                            ),
                    ),
                    const SizedBox(height: 12),
                    _DetailSection(
                      title: 'Timing',
                      icon: Icons.schedule_rounded,
                      child: Column(
                        children: [
                          _FactRow(label: 'Created', value: _date(_run['createdAt'])),
                          _FactRow(label: 'Started', value: _date(_run['startedAt'])),
                          _FactRow(label: 'Updated', value: _date(_run['updatedAt'])),
                          _FactRow(label: 'Completed', value: _date(_run['completedAt'])),
                        ],
                      ),
                    ),
                    if (_text(_run['failedReason']).isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(13),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceRose,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppColors.pink.withValues(alpha: .2)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.error_outline_rounded, size: 18, color: AppColors.pinkDeep),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _text(_run['failedReason']),
                                style: const TextStyle(
                                  color: AppColors.pinkDeep,
                                  fontSize: 9.8,
                                  height: 1.4,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceRose,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(
                          _error,
                          style: const TextStyle(
                            color: AppColors.pinkDeep,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                    if (running || retryable) ...[
                      const SizedBox(height: 18),
                      if (running)
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _stop,
                          icon: _busy
                              ? const SizedBox(
                                  width: 15,
                                  height: 15,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.stop_circle_outlined, size: 18),
                          label: const Text('Stop collection run'),
                        ),
                      if (retryable)
                        FilledButton.icon(
                          onPressed: _busy ? null : _retry,
                          icon: _busy
                              ? const SizedBox(
                                  width: 15,
                                  height: 15,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.refresh_rounded, size: 18),
                          label: const Text('Retry with same configuration'),
                        ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _DetailMetric extends StatelessWidget {
  const _DetailMetric({
    required this.label,
    required this.value,
    required this.icon,
    required this.tint,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 94,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.primaryDark),
          const Spacer(),
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
          const SizedBox(height: 3),
          Text(
            label,
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
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({required this.title, required this.icon, required this.child});

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .64),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 7),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 11.3,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 11),
          child,
        ],
      ),
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({required this.label, required this.value, this.mono = false});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 86,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.1,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: mono ? 8.6 : 9.6,
                height: 1.35,
                fontWeight: FontWeight.w800,
                fontFamily: mono ? 'monospace' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SourceExecutionRow extends StatelessWidget {
  const _SourceExecutionRow({required this.source});

  final Map<String, dynamic> source;

  @override
  Widget build(BuildContext context) {
    final status = _text(source['status']).toUpperCase();
    final posts = _int(source['totalPosts']);
    final comments = _int(source['totalComments']);
    final reason = _text(source['failureReason']);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: _statusVisual(status).soft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Text(
              _sourceName(source).isEmpty ? '?' : _sourceName(source).substring(0, 1).toUpperCase(),
              style: TextStyle(
                color: _statusVisual(status).foreground,
                fontSize: 12,
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
                  _sourceName(source),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  reason.isNotEmpty
                      ? reason
                      : '${_duration(source['startedAt'], source['completedAt'], status)} · $posts posts · $comments comments',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.6,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          _RunStatusPill(status: status),
        ],
      ),
    );
  }
}

class _ToolbarFilterButton extends StatelessWidget {
  const _ToolbarFilterButton({required this.onTap, required this.active});

  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 58,
        height: 58,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? AppColors.primarySoft : AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: active ? AppColors.primary.withValues(alpha: .34) : AppColors.border.withValues(alpha: .75),
          ),
        ),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            const Center(
              child: Icon(Icons.tune_rounded, size: 22, color: AppColors.primaryDark),
            ),
            if (active)
              Positioned(
                right: -7,
                top: -7,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _HeaderAction extends StatelessWidget {
  const _HeaderAction({required this.icon, required this.onTap, this.busy = false});

  final IconData icon;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 43,
        height: 43,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.primarySoft,
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: AppColors.border),
        ),
        child: busy
            ? const SizedBox(
                width: 17,
                height: 17,
                child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primaryDark),
              )
            : Icon(icon, size: 20, color: AppColors.primaryDark),
      ),
    );
  }
}

class _PaginationBar extends StatelessWidget {
  const _PaginationBar({
    required this.page,
    required this.totalPages,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onPrevious,
            icon: const Icon(Icons.chevron_left_rounded),
            color: AppColors.primaryDark,
          ),
          Expanded(
            child: Text(
              'Page $page of $totalPages',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          IconButton(
            onPressed: onNext,
            icon: const Icon(Icons.chevron_right_rounded),
            color: AppColors.primaryDark,
          ),
        ],
      ),
    );
  }
}

class _LoadingCards extends StatelessWidget {
  const _LoadingCards();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        4,
        (index) => Container(
          height: 128,
          margin: const EdgeInsets.only(bottom: 11),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.border),
          ),
          child: const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary),
            ),
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
    return _StateCard(
      icon: Icons.cloud_off_outlined,
      title: 'Could not load collection runs',
      message: message,
      action: TextButton(onPressed: onRetry, child: const Text('Try again')),
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Icon(icon, size: 30, color: AppColors.primaryDark),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 10,
              height: 1.4,
            ),
          ),
          if (action != null) ...[const SizedBox(height: 8), action!],
        ],
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  const _SheetLabel(this.value);

  final String value;

  @override
  Widget build(BuildContext context) {
    return Text(
      value.toUpperCase(),
      style: const TextStyle(
        color: AppColors.primaryDark,
        fontSize: 8.8,
        fontWeight: FontWeight.w900,
        letterSpacing: 1,
      ),
    );
  }
}

class _SheetChoice extends StatelessWidget {
  const _SheetChoice({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: selected ? AppColors.primarySoft : AppColors.background,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? AppColors.primaryDeep : AppColors.textSecondary,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }
}

class _RadioRow extends StatelessWidget {
  const _RadioRow({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.only(bottom: 7),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: selected ? AppColors.primarySoft : AppColors.background.withValues(alpha: .65),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: selected ? AppColors.primary.withValues(alpha: .35) : AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: selected ? AppColors.primaryDeep : AppColors.textSecondary,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            Icon(
              selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
              size: 18,
              color: selected ? AppColors.primaryDark : AppColors.sage,
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderChoice extends StatelessWidget {
  const _OrderChoice({
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
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.primarySoft : AppColors.background,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 16, color: selected ? AppColors.primaryDark : AppColors.textMuted),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: selected ? AppColors.primaryDeep : AppColors.textSecondary,
                fontSize: 9.7,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CollectionSortOption {
  const _CollectionSortOption(this.key, this.label);

  final String key;
  final String label;
}

class _CollectionFilterSelection {
  const _CollectionFilterSelection({
    required this.status,
    required this.source,
    required this.sortBy,
    required this.sortOrder,
  });

  final String status;
  final String source;
  final String sortBy;
  final String sortOrder;
}

class _StatusVisual {
  const _StatusVisual(this.label, this.foreground, this.soft);

  final String label;
  final Color foreground;
  final Color soft;
}

_StatusVisual _statusVisual(String status) {
  return switch (status.toUpperCase()) {
    'RUNNING' => const _StatusVisual('Running', AppColors.primaryDark, AppColors.primarySoft),
    'COMPLETED' => const _StatusVisual('Completed', AppColors.success, Color(0xFFE5F6EF)),
    'FAILED' => const _StatusVisual('Failed', AppColors.danger, AppColors.surfaceRose),
    'STOPPED' => const _StatusVisual('Stopped', AppColors.pinkDeep, AppColors.surfaceRose),
    'PENDING' => const _StatusVisual('Pending', AppColors.textSecondary, AppColors.surfaceMuted),
    _ => _StatusVisual(_readable(status.isEmpty ? 'UNKNOWN' : status), AppColors.textSecondary, AppColors.surfaceMuted),
  };
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _collectionSources(Map<String, dynamic> run) {
  final value = run['sources'];
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .toList();
}

String _sourceName(Map<String, dynamic> source) {
  final dataSource = _map(source['dataSource']);
  final displayName = _text(dataSource['displayName']);
  if (displayName.isNotEmpty) return displayName;
  final key = _text(dataSource['key']);
  if (key.isNotEmpty) return key;
  return 'Source';
}

String _sourceKey(Map<String, dynamic> source) => _text(_map(source['dataSource'])['key']);

String _sourceLabel(String key, List<Map<String, dynamic>> sources) {
  for (final source in sources) {
    if (_text(source['key']) == key) {
      return _text(source['displayName']).isEmpty ? key : _text(source['displayName']);
    }
  }
  return key;
}

String _text(dynamic value) => value?.toString().trim() ?? '';

int _int(dynamic value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(_text(value)) ?? fallback;
}

num _number(dynamic value) {
  if (value is num) return value;
  return num.tryParse(_text(value)) ?? 0;
}

List<String> _keywords(dynamic value) {
  if (value is List) {
    return value.map(_text).where((item) => item.isNotEmpty).toList();
  }
  if (value is String && value.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(value);
      if (decoded is List) {
        return decoded.map(_text).where((item) => item.isNotEmpty).toList();
      }
    } catch (_) {}
  }
  return const [];
}

String _readable(String value) {
  return value
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _shortId(dynamic value) {
  final text = _text(value);
  if (text.isEmpty) return '—';
  return text.length <= 10 ? text : '${text.substring(0, 8)}…';
}

String _location(Map<String, dynamic> run) {
  return [run['city'], run['region'], run['country']]
      .map(_text)
      .where((part) => part.isNotEmpty)
      .join(', ');
}

DateTime? _parsedDate(dynamic value) {
  final raw = _text(value);
  if (raw.isEmpty) return null;
  return DateTime.tryParse(raw)?.toLocal();
}

String _shortDate(dynamic value) {
  final date = _parsedDate(value);
  if (date == null) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${months[date.month - 1]} ${date.day}, ${date.year}';
}

String _date(dynamic value) {
  final date = _parsedDate(value);
  if (date == null) return '—';
  final minute = date.minute.toString().padLeft(2, '0');
  return '${_shortDate(date.toIso8601String())} · ${date.hour.toString().padLeft(2, '0')}:$minute';
}

String _duration(dynamic startedAt, dynamic completedAt, String status) {
  final start = _parsedDate(startedAt);
  if (start == null) return 'Not started';
  final end = _parsedDate(completedAt) ?? (status.toUpperCase() == 'RUNNING' ? DateTime.now() : start);
  if (end.isBefore(start)) return '—';
  final seconds = end.difference(start).inSeconds;
  if (seconds < 60) return '${seconds}s';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '${minutes}m ${seconds % 60}s';
  final hours = minutes ~/ 60;
  return '${hours}h ${minutes % 60}m';
}
