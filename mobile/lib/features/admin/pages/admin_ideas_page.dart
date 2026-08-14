import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Mobile Ideas administration workspace with feature parity to the web page.
///
/// It keeps the same backend behavior as the web Ideas directory while using
/// a compact card-based layout that is easier to scan and operate on phones.
///
/// @author Eman
class AdminIdeasPage extends StatefulWidget {
  const AdminIdeasPage({super.key, this.embedded = false});

  final bool embedded;

  @override
  State<AdminIdeasPage> createState() => _AdminIdeasPageState();
}

class _AdminIdeasPageState extends State<AdminIdeasPage> {
  static const _pageSize = 20;

  static const _filters = <_IdeasFilter>[
    _IdeasFilter('all', 'All ideas', Icons.auto_awesome_rounded),
    _IdeasFilter('published', 'Published', Icons.public_rounded),
    _IdeasFilter('locked', 'Locked', Icons.lock_outline_rounded),
    _IdeasFilter('unlocked', 'Unlocked', Icons.lock_open_rounded),
  ];

  static const _sorts = <_SortOption>[
    _SortOption('createdAt', 'Created date', Icons.calendar_month_outlined),
    _SortOption('title', 'Idea title', Icons.lightbulb_outline_rounded),
    _SortOption('owner', 'Owner', Icons.person_outline_rounded),
    _SortOption('domain', 'Domain', Icons.layers_outlined),
    _SortOption(
      'generationType',
      'Generation type',
      Icons.auto_awesome_outlined,
    ),
    _SortOption('isUnlocked', 'Access', Icons.lock_open_outlined),
    _SortOption('publication', 'Publication', Icons.public_outlined),
  ];

  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _searchDebounce;
  int _requestId = 0;

  List<Map<String, dynamic>> _items = const [];
  Map<String, dynamic> _summary = const {};

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  String _search = '';
  String _filter = 'all';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';

  bool _loading = true;
  bool _refreshing = false;
  bool _summaryLoading = true;
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

    setState(() => _summaryLoading = true);

    final summaryFuture = _api.getSummary('/admin/ideas/summary', force: force);

    unawaited(
      summaryFuture
          .then((value) {
            if (!mounted || requestId != _requestId) return;
            setState(() => _summary = _unwrapMap(value));
          })
          .catchError((_) {
            // Summary failure should never hide a usable directory list.
          })
          .whenComplete(() {
            if (!mounted || requestId != _requestId) return;
            setState(() => _summaryLoading = false);
          }),
    );

    try {
      final publishedOnly = _filter == 'published';
      final extra = <String, dynamic>{};

      if (_filter == 'locked') extra['isUnlocked'] = 'false';
      if (_filter == 'unlocked') extra['isUnlocked'] = 'true';

      final payload = await _api.getList(
        publishedOnly ? '/admin/ideas/published' : '/admin/ideas',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: extra,
      );

      if (!mounted || requestId != _requestId) return;

      final rows = (payload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
      final meta = _asMap(payload['meta']);

      setState(() {
        _items = rows;
        _total = _asInt(meta['total'] ?? rows.length);
        _page = _asInt(meta['page'] ?? _page).clamp(1, 999999).toInt();
        _totalPages = _asInt(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() => _error = 'Could not load ideas.');
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
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      final next = value.trim();
      if (next == _search) return;
      setState(() {
        _search = next;
        _page = 1;
      });
      _load();
    });
  }

  void _chooseFilter(String value) {
    if (_filter == value) return;
    setState(() {
      _filter = value;
      _page = 1;
    });
    _load();
  }

  Future<void> _openSortPicker() async {
    final result = await showModalBottomSheet<_SortSelection>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _IdeasSortSheet(
        options: _sorts,
        selected: _sortBy,
        order: _sortOrder,
      ),
    );

    if (!mounted || result == null) return;
    if (result.field == _sortBy && result.order == _sortOrder) return;

    setState(() {
      _sortBy = result.field;
      _sortOrder = result.order;
      _page = 1;
    });
    _load();
  }

  Future<void> _openIdea(Map<String, dynamic> idea) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _IdeaDetailSheet(initialIdea: idea),
    );

    if (changed == true && mounted) {
      await _load(force: true, quiet: true);
    }
  }

  Future<void> _openInsights(Map<String, dynamic> idea) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PublicationInsightsSheet(initialIdea: idea),
    );

    if (changed == true && mounted) {
      await _load(force: true, quiet: true);
    }
  }

  Future<void> _exportCsv() async {
    if (_exporting) return;

    setState(() => _exporting = true);

    try {
      final unlocked = switch (_filter) {
        'locked' => false,
        'unlocked' => true,
        _ => null,
      };

      final bytes = await _api.exportIdeasCsv(
        publishedOnly: _filter == 'published',
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        isUnlocked: unlocked,
      );

      if (bytes.isEmpty) {
        throw const ApiException('The CSV export was empty.');
      }

      if (!mounted) return;

      final box = context.findRenderObject() as RenderBox?;
      final shareOrigin = box == null
          ? null
          : box.localToGlobal(Offset.zero) & box.size;

      await SharePlus.instance.share(
        ShareParams(
          subject: 'Voxidence ideas export',
          text: 'Ideas administration export',
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: _filter == 'published'
                  ? 'admin-published-ideas.csv'
                  : 'admin-ideas.csv',
            ),
          ],
          sharePositionOrigin: shareOrigin,
        ),
      );
    } on ApiException catch (error) {
      if (mounted) _showSnack(error.message, error: true);
    } catch (_) {
      if (mounted) _showSnack('CSV export failed.', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  void _showSnack(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.danger : AppColors.primaryDeep,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final metrics = _summaryMetrics();
    final sort = _sorts.firstWhere(
      (item) => item.key == _sortBy,
      orElse: () => _sorts.first,
    );

    final content = RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: () => _load(force: true, quiet: true),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        slivers: [
          SliverPadding(
            padding: EdgeInsets.fromLTRB(
              14,
              widget.embedded ? 16 : 12,
              14,
              120,
            ),
            sliver: SliverList.list(
              children: [
                AdminPageHeader(
                  title: 'Ideas',
                  subtitle: 'Explore generated ideas and publication state.',
                  eyebrow: 'Community',
                  icon: Icons.lightbulb_outline_rounded,
                  onBack: widget.embedded
                      ? null
                      : () => Navigator.maybePop(context),
                  trailing: _HeaderRefreshButton(
                    loading: _refreshing,
                    onTap: () => _load(force: true, quiet: true),
                  ),
                ),
                const SizedBox(height: 14),
                _IdeasHero(
                  total: metrics.total,
                  published: metrics.published,
                  matching: _total,
                  onExport: _exporting ? null : _exportCsv,
                  exporting: _exporting,
                ),
                const SizedBox(height: 12),
                _IdeasMetricsGrid(
                  total: metrics.total,
                  published: metrics.published,
                  locked: metrics.locked,
                  unlocked: metrics.unlocked,
                  loading: _summaryLoading,
                ),
                const SizedBox(height: 14),
                _DirectoryPanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _DirectoryHeading(),
                      const SizedBox(height: 12),
                      AdminSearchField(
                        controller: _searchController,
                        hint: 'Search title or problem…',
                        onChanged: _onSearchChanged,
                        onSubmitted: (_) {},
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        height: 38,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: _filters.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 7),
                          itemBuilder: (_, index) {
                            final item = _filters[index];
                            return _FilterPill(
                              filter: item,
                              selected: item.key == _filter,
                              onTap: () => _chooseFilter(item.key),
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: _SortButton(
                              label: sort.label,
                              order: _sortOrder,
                              onTap: _openSortPicker,
                            ),
                          ),
                          const SizedBox(width: 8),
                          _CompactActionButton(
                            icon: Icons.file_download_outlined,
                            tooltip: 'Export CSV',
                            loading: _exporting,
                            onTap: _exporting ? null : _exportCsv,
                          ),
                        ],
                      ),
                      const SizedBox(height: 13),
                      _ResultsMeta(
                        total: _total,
                        page: _page,
                        totalPages: _totalPages,
                        loading: _loading || _refreshing,
                      ),
                      const SizedBox(height: 10),
                      if (_error.isNotEmpty && _items.isEmpty)
                        AdminEmptyState(
                          title: 'Could not load ideas',
                          message: _error,
                          icon: Icons.cloud_off_outlined,
                          onRetry: () => _load(force: true),
                        )
                      else if (_loading && _items.isEmpty)
                        const AdminLoadingList()
                      else if (_items.isEmpty)
                        const _IdeasEmptyState()
                      else ...[
                        if (_error.isNotEmpty)
                          _InlineError(
                            message: _error,
                            onRetry: () => _load(force: true, quiet: true),
                          ),
                        for (var index = 0; index < _items.length; index++) ...[
                          _IdeaDirectoryCard(
                            idea: _items[index],
                            onOpen: () => _openIdea(_items[index]),
                            onInsights: _isPublished(_items[index])
                                ? () => _openInsights(_items[index])
                                : null,
                          ),
                          if (index != _items.length - 1)
                            const SizedBox(height: 9),
                        ],
                        if (_totalPages > 1) ...[
                          const SizedBox(height: 13),
                          _IdeasPagination(
                            page: _page,
                            totalPages: _totalPages,
                            total: _total,
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
                        ],
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );

    if (widget.embedded) return content;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(child: SafeArea(child: content)),
    );
  }

  _IdeasMetrics _summaryMetrics() {
    final source = _unwrapMap(_summary);
    final publications = _asMap(source['publications']);
    final access = _asMap(source['access']);

    return _IdeasMetrics(
      total: _asInt(source['totalIdeas'] ?? _total),
      published: _asInt(publications['publishedIdeas']),
      locked: _asInt(access['lockedIdeas']),
      unlocked: _asInt(access['unlockedIdeas']),
    );
  }
}

class _HeaderRefreshButton extends StatelessWidget {
  const _HeaderRefreshButton({required this.loading, required this.onTap});

  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: loading ? null : onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: AppColors.primary.withValues(alpha: .12)),
          ),
          child: loading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primaryDark,
                  ),
                )
              : const Icon(
                  Icons.refresh_rounded,
                  size: 21,
                  color: AppColors.primaryDeep,
                ),
        ),
      ),
    );
  }
}

class _IdeasHero extends StatelessWidget {
  const _IdeasHero({
    required this.total,
    required this.published,
    required this.matching,
    required this.onExport,
    required this.exporting,
  });

  final int total;
  final int published;
  final int matching;
  final VoidCallback? onExport;
  final bool exporting;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 14, 15),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFF0F8F5), Color(0xFFFFF5F8)],
        ),
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: Colors.white.withValues(alpha: .95)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 26,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -22,
            top: -34,
            child: Container(
              width: 128,
              height: 128,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  width: 20,
                  color: AppColors.primary.withValues(alpha: .055),
                ),
              ),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          size: 13,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'IDEA INTELLIGENCE',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.4,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.05,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Ideas, without the\nspreadsheet feeling.',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 22,
                        height: 1.08,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.55,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Filter access states, find published work, inspect ownership and open every idea in one focused admin view.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 9.4,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _HeroChip(
                          icon: Icons.circle,
                          label: 'Live directory',
                          live: true,
                        ),
                        _HeroChip(
                          icon: Icons.lightbulb_outline_rounded,
                          label: '$matching records',
                        ),
                        _HeroChip(
                          icon: Icons.public_rounded,
                          label: '$published published',
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: onExport,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primaryDeep,
                        side: BorderSide(
                          color: AppColors.primary.withValues(alpha: .18),
                        ),
                        backgroundColor: Colors.white.withValues(alpha: .7),
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                      ),
                      icon: exporting
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 1.8,
                                color: AppColors.primaryDark,
                              ),
                            )
                          : const Icon(Icons.file_download_outlined, size: 16),
                      label: Text(exporting ? 'Preparing…' : 'Export CSV'),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              _HeroOrbit(total: total),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.icon, required this.label, this.live = false});

  final IconData icon;
  final String label;
  final bool live;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .07)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (live)
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: .2),
                    blurRadius: 0,
                    spreadRadius: 4,
                  ),
                ],
              ),
            )
          else
            Icon(icon, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Text(
            label,
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

class _HeroOrbit extends StatelessWidget {
  const _HeroOrbit({required this.total});

  final int total;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 92,
      height: 128,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.primaryDark.withValues(alpha: .12),
                style: BorderStyle.solid,
              ),
            ),
          ),
          Container(
            width: 66,
            height: 66,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.primary.withValues(alpha: .1),
              ),
            ),
          ),
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFFFFFFF), Color(0xFFE9F6F2)],
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .10),
                  blurRadius: 18,
                  offset: const Offset(0, 7),
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.lightbulb_outline_rounded,
                  size: 18,
                  color: AppColors.primaryDark,
                ),
                const SizedBox(height: 3),
                Text(
                  _compactNumber(total),
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'IDEAS',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 5.8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .7,
                  ),
                ),
              ],
            ),
          ),
          const Positioned(
            right: 4,
            top: 25,
            child: _OrbitDot(color: AppColors.primary),
          ),
          const Positioned(
            left: 2,
            bottom: 25,
            child: _OrbitDot(color: AppColors.pink),
          ),
        ],
      ),
    );
  }
}

class _OrbitDot extends StatelessWidget {
  const _OrbitDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
      ),
    );
  }
}

class _IdeasMetricsGrid extends StatelessWidget {
  const _IdeasMetricsGrid({
    required this.total,
    required this.published,
    required this.locked,
    required this.unlocked,
    required this.loading,
  });

  final int total;
  final int published;
  final int locked;
  final int unlocked;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final items = [
      _MetricData(
        'All ideas',
        total,
        'platform total',
        Icons.auto_awesome_rounded,
        AppColors.primarySoft,
        AppColors.primaryDark,
      ),
      _MetricData(
        'Published',
        published,
        'visible to community',
        Icons.public_rounded,
        const Color(0xFFE8F8F6),
        AppColors.primaryDark,
      ),
      _MetricData(
        'Locked',
        locked,
        'advanced access closed',
        Icons.lock_outline_rounded,
        AppColors.pinkSoft,
        AppColors.pinkDeep,
      ),
      _MetricData(
        'Unlocked',
        unlocked,
        'advanced access available',
        Icons.lock_open_rounded,
        const Color(0xFFF0F4E9),
        const Color(0xFF67765B),
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 9,
        mainAxisSpacing: 9,
        childAspectRatio: 1.74,
      ),
      itemCount: items.length,
      itemBuilder: (_, index) {
        final item = items[index];
        return Container(
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .94),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .065),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .03),
                blurRadius: 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 39,
                height: 39,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: item.tone,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(item.icon, size: 18, color: item.iconColor),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.8,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    loading
                        ? Container(
                            width: 36,
                            height: 13,
                            decoration: BoxDecoration(
                              color: AppColors.surfaceMuted,
                              borderRadius: BorderRadius.circular(99),
                            ),
                          )
                        : Text(
                            _compactNumber(item.value),
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 17,
                              height: 1,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                    const SizedBox(height: 3),
                    Text(
                      item.hint,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.4,
                      ),
                    ),
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

class _DirectoryPanel extends StatelessWidget {
  const _DirectoryPanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(11, 13, 11, 12),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .92),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .075),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .04),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _DirectoryHeading extends StatelessWidget {
  const _DirectoryHeading();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 35,
          height: 35,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(
            Icons.view_agenda_outlined,
            size: 17,
            color: AppColors.primaryDark,
          ),
        ),
        const SizedBox(width: 9),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'IDEA DIRECTORY',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 7.2,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .9,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Explore platform ideas',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13,
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

class _FilterPill extends StatelessWidget {
  const _FilterPill({
    required this.filter,
    required this.selected,
    required this.onTap,
  });

  final _IdeasFilter filter;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .18)
                  : AppColors.primaryDark.withValues(alpha: .055),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                filter.icon,
                size: 14,
                color: selected ? AppColors.primaryDeep : AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Text(
                filter.label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDeep
                      : AppColors.textSecondary,
                  fontSize: 9,
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

class _SortButton extends StatelessWidget {
  const _SortButton({
    required this.label,
    required this.order,
    required this.onTap,
  });

  final String label;
  final String order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.background.withValues(alpha: .72),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .06),
            ),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.tune_rounded,
                size: 17,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SORT IDEAS',
                      style: TextStyle(
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
                        fontSize: 9.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                order == 'asc'
                    ? Icons.arrow_upward_rounded
                    : Icons.arrow_downward_rounded,
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

class _CompactActionButton extends StatelessWidget {
  const _CompactActionButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.loading = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: AppColors.primary.withValues(alpha: .13),
              ),
            ),
            child: loading
                ? const SizedBox(
                    width: 17,
                    height: 17,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.primaryDark,
                    ),
                  )
                : Icon(icon, size: 19, color: AppColors.primaryDeep),
          ),
        ),
      ),
    );
  }
}

class _ResultsMeta extends StatelessWidget {
  const _ResultsMeta({
    required this.total,
    required this.page,
    required this.totalPages,
    required this.loading,
  });

  final int total;
  final int page;
  final int totalPages;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: const BoxDecoration(
            color: AppColors.pink,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 7),
        Text(
          '$total records',
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 9.4,
            fontWeight: FontWeight.w800,
          ),
        ),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 1.8,
              color: AppColors.primary,
            ),
          )
        else if (totalPages > 1)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.surfaceRose,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.pink.withValues(alpha: .10)),
            ),
            child: Text(
              'Page $page of $totalPages',
              style: const TextStyle(
                color: AppColors.primaryDeep,
                fontSize: 8.2,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
      ],
    );
  }
}

class _IdeaDirectoryCard extends StatelessWidget {
  const _IdeaDirectoryCard({
    required this.idea,
    required this.onOpen,
    required this.onInsights,
  });

  final Map<String, dynamic> idea;
  final VoidCallback onOpen;
  final VoidCallback? onInsights;

  @override
  Widget build(BuildContext context) {
    final title = _text(idea['title'], fallback: 'Untitled idea');
    final owner = _ideaOwner(idea);
    final ownerMeta = _ideaOwnerMeta(idea);
    final domain = _ideaDomain(idea);
    final generation = _titleCase(idea['generationType']);
    final run = _asMap(idea['generationRun']);
    final runStatus = _titleCase(run['status'], fallback: 'Idea record');
    final unlocked = idea['isUnlocked'] == true;
    final published = _isPublished(idea);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(19),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(19),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .07),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .03),
                blurRadius: 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(19),
            child: Stack(
              children: [
                Positioned.fill(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 4,
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [AppColors.primary, AppColors.primaryDark],
                        ),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(13, 12, 11, 11),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppColors.primarySoft,
                              borderRadius: BorderRadius.circular(13),
                            ),
                            child: const Icon(
                              Icons.lightbulb_outline_rounded,
                              size: 19,
                              color: AppColors.primaryDark,
                            ),
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 13.1,
                                    height: 1.18,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: -.2,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Row(
                                  children: [
                                    _StatusDot(status: _text(run['status'])),
                                    const SizedBox(width: 5),
                                    Flexible(
                                      child: Text(
                                        runStatus,
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
                          const SizedBox(width: 6),
                          Container(
                            width: 34,
                            height: 34,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppColors.primarySoft,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: AppColors.primary.withValues(alpha: .11),
                              ),
                            ),
                            child: const Icon(
                              Icons.chevron_right_rounded,
                              size: 20,
                              color: AppColors.primaryDeep,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          _OwnerAvatar(name: owner),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  owner,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 9,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  ownerMeta,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 7.2,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          _TinyChip(
                            icon: Icons.layers_outlined,
                            label: domain,
                            tint: AppColors.primarySoft,
                            color: AppColors.primaryDark,
                          ),
                        ],
                      ),
                      const SizedBox(height: 9),
                      Wrap(
                        spacing: 5,
                        runSpacing: 5,
                        children: [
                          _TinyChip(
                            icon: Icons.auto_awesome_outlined,
                            label: generation,
                            tint: AppColors.surfaceMuted,
                            color: AppColors.textSecondary,
                          ),
                          _TinyChip(
                            icon: unlocked
                                ? Icons.lock_open_rounded
                                : Icons.lock_outline_rounded,
                            label: unlocked ? 'Unlocked' : 'Locked',
                            tint: unlocked
                                ? const Color(0xFFEAF5F2)
                                : AppColors.surfaceRose,
                            color: unlocked
                                ? AppColors.primaryDark
                                : AppColors.pinkDeep,
                          ),
                          _TinyChip(
                            icon: published
                                ? Icons.public_rounded
                                : Icons.description_outlined,
                            label: published ? 'Published' : 'Not published',
                            tint: published
                                ? const Color(0xFFE8F8F6)
                                : AppColors.surfaceMuted,
                            color: published
                                ? AppColors.primaryDark
                                : AppColors.textMuted,
                          ),
                        ],
                      ),
                      const SizedBox(height: 9),
                      Row(
                        children: [
                          const Icon(
                            Icons.calendar_today_outlined,
                            size: 12,
                            color: AppColors.textMuted,
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              _formatDate(idea['createdAt']),
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          if (onInsights != null) ...[
                            TextButton.icon(
                              onPressed: onInsights,
                              style: TextButton.styleFrom(
                                foregroundColor: AppColors.primaryDeep,
                                backgroundColor: AppColors.primarySoft,
                                visualDensity: VisualDensity.compact,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 9,
                                  vertical: 5,
                                ),
                              ),
                              icon: const Icon(
                                Icons.insights_rounded,
                                size: 14,
                              ),
                              label: const Text(
                                'Insights',
                                style: TextStyle(fontSize: 8.4),
                              ),
                            ),
                          ],
                        ],
                      ),
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

class _OwnerAvatar extends StatelessWidget {
  const _OwnerAvatar({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final initial = name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase();
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFE8F7F4), Color(0xFFFFF0F4)],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .05)),
      ),
      child: Text(
        initial,
        style: const TextStyle(
          color: AppColors.primaryDeep,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _TinyChip extends StatelessWidget {
  const _TinyChip({
    required this.icon,
    required this.label,
    required this.tint,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color tint;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 150),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: .08)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: color),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 7.1,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final normalized = status.toUpperCase();
    final color = switch (normalized) {
      'COMPLETED' ||
      'PUBLISHED' ||
      'ACTIVE' ||
      'SUCCEEDED' => AppColors.primary,
      'FAILED' || 'CANCELLED' || 'REJECTED' => AppColors.danger,
      'RUNNING' ||
      'PREPARING' ||
      'PENDING' ||
      'QUEUED' => const Color(0xFFC19A55),
      _ => AppColors.sage,
    };

    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _IdeasPagination extends StatelessWidget {
  const _IdeasPagination({
    required this.page,
    required this.totalPages,
    required this.total,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final int total;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .055),
        ),
      ),
      child: Row(
        children: [
          _PageButton(
            icon: Icons.chevron_left_rounded,
            enabled: onPrevious != null,
            onTap: onPrevious,
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  'Page $page of $totalPages',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  '$total records',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.7,
                  ),
                ),
              ],
            ),
          ),
          _PageButton(
            icon: Icons.chevron_right_rounded,
            enabled: onNext != null,
            onTap: onNext,
          ),
        ],
      ),
    );
  }
}

class _PageButton extends StatelessWidget {
  const _PageButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: enabled ? AppColors.primarySoft : AppColors.surfaceMuted,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(
            icon,
            color: enabled ? AppColors.primaryDeep : AppColors.silver,
          ),
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceRose,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.pink.withValues(alpha: .13)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 16,
            color: AppColors.pinkDeep,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.4,
              ),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _IdeasEmptyState extends StatelessWidget {
  const _IdeasEmptyState();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 30),
      child: Column(
        children: [
          Icon(Icons.search_off_rounded, size: 32, color: AppColors.sage),
          SizedBox(height: 9),
          Text(
            'No ideas match this view',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'Try another filter or search phrase.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textMuted, fontSize: 9),
          ),
        ],
      ),
    );
  }
}

class _IdeasSortSheet extends StatefulWidget {
  const _IdeasSortSheet({
    required this.options,
    required this.selected,
    required this.order,
  });

  final List<_SortOption> options;
  final String selected;
  final String order;

  @override
  State<_IdeasSortSheet> createState() => _IdeasSortSheetState();
}

class _IdeasSortSheetState extends State<_IdeasSortSheet> {
  late String _field;
  late String _order;

  @override
  void initState() {
    super.initState();
    _field = widget.selected;
    _order = widget.order;
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.all(10),
        padding: const EdgeInsets.fromLTRB(15, 10, 15, 16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: Colors.white),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
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
            const SizedBox(height: 15),
            const Text(
              'Sort ideas',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Sorting is applied by the server before pagination.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 9.3),
            ),
            const SizedBox(height: 12),
            ...widget.options.map(
              (option) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: ListTile(
                  onTap: () => setState(() => _field = option.key),
                  dense: true,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: BorderSide(
                      color: option.key == _field
                          ? AppColors.primary.withValues(alpha: .18)
                          : AppColors.primaryDark.withValues(alpha: .05),
                    ),
                  ),
                  tileColor: option.key == _field
                      ? AppColors.primarySoft
                      : AppColors.background.withValues(alpha: .55),
                  leading: Icon(
                    option.icon,
                    color: option.key == _field
                        ? AppColors.primaryDeep
                        : AppColors.textMuted,
                    size: 18,
                  ),
                  title: Text(
                    option.label,
                    style: TextStyle(
                      color: option.key == _field
                          ? AppColors.primaryDeep
                          : AppColors.textPrimary,
                      fontSize: 10.2,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  trailing: option.key == _field
                      ? const Icon(
                          Icons.check_circle_rounded,
                          size: 18,
                          color: AppColors.primaryDark,
                        )
                      : null,
                ),
              ),
            ),
            const SizedBox(height: 5),
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _DirectionChoice(
                      label: 'Ascending',
                      icon: Icons.arrow_upward_rounded,
                      selected: _order == 'asc',
                      onTap: () => setState(() => _order = 'asc'),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _DirectionChoice(
                      label: 'Descending',
                      icon: Icons.arrow_downward_rounded,
                      selected: _order == 'desc',
                      onTap: () => setState(() => _order = 'desc'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () =>
                    Navigator.pop(context, _SortSelection(_field, _order)),
                icon: const Icon(Icons.check_rounded, size: 17),
                label: const Text('Apply sorting'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DirectionChoice extends StatelessWidget {
  const _DirectionChoice({
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
      color: selected ? AppColors.surface : Colors.transparent,
      borderRadius: BorderRadius.circular(11),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(11),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 15,
                color: selected ? AppColors.primaryDeep : AppColors.textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  color: selected ? AppColors.primaryDeep : AppColors.textMuted,
                  fontSize: 8.4,
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

class _IdeaDetailSheet extends StatefulWidget {
  const _IdeaDetailSheet({required this.initialIdea});

  final Map<String, dynamic> initialIdea;

  @override
  State<_IdeaDetailSheet> createState() => _IdeaDetailSheetState();
}

class _IdeaDetailSheetState extends State<_IdeaDetailSheet> {
  final _api = AdminApi.instance;

  late Map<String, dynamic> _idea;
  bool _loading = true;
  String _error = '';
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _idea = Map<String, dynamic>.from(widget.initialIdea);
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    final id = _text(_idea['id']);
    if (id.isEmpty) {
      setState(() => _loading = false);
      return;
    }

    try {
      final detail = await _api.getDetail(
        '/admin/ideas/$id/quick-detail',
        force: true,
      );
      if (!mounted) return;
      setState(() {
        _idea = {..._idea, ..._unwrapMap(detail)};
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not refresh idea details.';
        _loading = false;
      });
    }
  }

  Future<void> _showInsights() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PublicationInsightsSheet(initialIdea: _idea),
    );

    if (changed == true && mounted) {
      _changed = true;
      await _loadDetail();
    }
  }

  Future<void> _unpublish() async {
    final success = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _UnpublishSheet(idea: _idea),
    );

    if (success == true && mounted) {
      _changed = true;
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final publication = _asMap(_idea['publication']);
    final run = _asMap(_idea['generationRun']);
    final counts = _asMap(_idea['_count']);
    final published = _isPublished(_idea);

    return Container(
      height: MediaQuery.sizeOf(context).height * .92,
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(27)),
      ),
      child: Column(
        children: [
          _SheetHeader(
            eyebrow: 'IDEA DETAILS',
            title: _text(_idea['title'], fallback: 'Untitled idea'),
            subtitle: '${_ideaOwner(_idea)} · ${_ideaDomain(_idea)}',
            icon: Icons.lightbulb_outline_rounded,
            onClose: () => Navigator.pop(context, _changed),
          ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(14, 13, 14, 28),
              children: [
                if (_error.isNotEmpty)
                  _InlineError(message: _error, onRetry: _loadDetail),
                _IdeaIdentityCard(idea: _idea),
                const SizedBox(height: 10),
                _DetailMetricGrid(
                  items: [
                    _DetailMetric(
                      'Pipeline',
                      _titleCase(run['status'], fallback: 'Unknown'),
                      Icons.verified_outlined,
                    ),
                    _DetailMetric(
                      'Created',
                      _formatDate(_idea['createdAt'], withTime: true),
                      Icons.schedule_rounded,
                    ),
                    _DetailMetric(
                      'Unlock method',
                      _titleCase(_idea['unlockMethod'], fallback: 'None'),
                      Icons.payments_outlined,
                    ),
                    _DetailMetric(
                      'Region',
                      _text(
                        _idea['selectedRegion'] ??
                            _asMap(_idea['collectionJob'])['region'],
                        fallback: 'Any region',
                      ),
                      Icons.public_outlined,
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailSection(
                  icon: Icons.warning_amber_rounded,
                  title: 'Problem statement',
                  child: Text(
                    _text(
                      _idea['problemStatement'],
                      fallback:
                          'No problem statement is available for this record.',
                    ),
                    style: _detailBodyStyle,
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.description_outlined,
                  title: 'Abstract',
                  child: Text(
                    _text(
                      _idea['fullAbstract'] ??
                          _idea['partialAbstract'] ??
                          _idea['limitedAbstract'],
                      fallback: 'No abstract is available for this record.',
                    ),
                    style: _detailBodyStyle,
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.flag_outlined,
                  title: 'Objectives',
                  child: _ListOrText(
                    value: _idea['objectives'],
                    fallback: 'No objectives available.',
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.groups_2_outlined,
                  title: 'Target users',
                  child: _TagsOrText(
                    value: _idea['targetUsers'],
                    fallback: 'No target-user information available.',
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.timeline_rounded,
                  title: 'Generation run',
                  child: _KeyValueGrid(
                    values: [
                      ('Stage', _titleCase(run['currentStageKey'])),
                      ('Progress', '${_asInt(run['progressPercent'])}%'),
                      (
                        'Started',
                        _formatDate(run['startedAt'], withTime: true),
                      ),
                      (
                        'Completed',
                        _formatDate(run['completedAt'], withTime: true),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.public_rounded,
                  title: 'Publication',
                  child: _KeyValueGrid(
                    values: [
                      (
                        'Status',
                        _titleCase(
                          publication['status'],
                          fallback: 'Not published',
                        ),
                      ),
                      ('Visibility', _titleCase(publication['visibility'])),
                      (
                        'Published',
                        _formatDate(publication['publishedAt'], withTime: true),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.memory_rounded,
                  title: 'System record',
                  child: _KeyValueGrid(
                    values: [
                      ('Idea ID', _text(_idea['id'], fallback: '—')),
                      ('Outputs', '${_asInt(counts['generatedOutputs'])}'),
                      ('Payments', '${_asInt(counts['payments'])}'),
                    ],
                  ),
                ),
                if (published && _text(publication['id']).isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.tonalIcon(
                          onPressed: _showInsights,
                          icon: const Icon(Icons.insights_rounded, size: 17),
                          label: const Text('Publication insights'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _unpublish,
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.pinkDeep,
                            side: BorderSide(
                              color: AppColors.pink.withValues(alpha: .24),
                            ),
                          ),
                          icon: const Icon(Icons.shield_outlined, size: 17),
                          label: const Text('Unpublish'),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IdeaIdentityCard extends StatelessWidget {
  const _IdeaIdentityCard({required this.idea});

  final Map<String, dynamic> idea;

  @override
  Widget build(BuildContext context) {
    final published = _isPublished(idea);
    final unlocked = idea['isUnlocked'] == true;

    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFF1F8F6)],
        ),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .07)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _OwnerAvatar(name: _ideaOwner(idea)),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'OWNER',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.2,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .65,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _ideaOwner(idea),
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      _ideaOwnerMeta(idea),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.6,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _TinyChip(
                icon: unlocked
                    ? Icons.lock_open_rounded
                    : Icons.lock_outline_rounded,
                label: unlocked ? 'Unlocked' : 'Locked',
                tint: unlocked ? AppColors.primarySoft : AppColors.surfaceRose,
                color: unlocked ? AppColors.primaryDeep : AppColors.pinkDeep,
              ),
              _TinyChip(
                icon: Icons.public_rounded,
                label: published ? 'Published' : 'Not published',
                tint: published
                    ? const Color(0xFFE8F8F6)
                    : AppColors.surfaceMuted,
                color: published ? AppColors.primaryDeep : AppColors.textMuted,
              ),
              _TinyChip(
                icon: Icons.auto_awesome_outlined,
                label: _titleCase(idea['generationType']),
                tint: AppColors.surfaceMuted,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PublicationInsightsSheet extends StatefulWidget {
  const _PublicationInsightsSheet({required this.initialIdea});

  final Map<String, dynamic> initialIdea;

  @override
  State<_PublicationInsightsSheet> createState() =>
      _PublicationInsightsSheetState();
}

class _PublicationInsightsSheetState extends State<_PublicationInsightsSheet> {
  final _api = AdminApi.instance;

  late Map<String, dynamic> _idea;
  List<Map<String, dynamic>> _reports = const [];
  final Map<String, TextEditingController> _replyControllers = {};

  bool _loading = true;
  bool _changed = false;
  String _error = '';
  String _busyReportId = '';

  @override
  void initState() {
    super.initState();
    _idea = Map<String, dynamic>.from(widget.initialIdea);
    _load();
  }

  @override
  void dispose() {
    for (final controller in _replyControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final ideaId = _text(_idea['id']);
    final publicationId = _text(_asMap(_idea['publication'])['id']);

    if (ideaId.isEmpty || publicationId.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'Publication information is not available for this idea.';
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = '';
    });

    final insightFuture = _api.getDetail(
      '/admin/ideas/$ideaId/publication-insights',
      force: true,
    );
    final reportsFuture = _api.getList(
      '/admin/publication-reports/publication/$publicationId',
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      force: true,
    );

    final results = await Future.wait<(bool, dynamic)>([
      _settle(insightFuture),
      _settle(reportsFuture),
    ]);

    if (!mounted) return;

    final insightResult = results[0];
    final reportsResult = results[1];

    if (insightResult.$1) {
      _idea = {..._idea, ..._unwrapMap(insightResult.$2)};
    }

    if (reportsResult.$1) {
      final payload = _asMap(reportsResult.$2);
      _reports = (payload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      _syncControllers();
    }

    if (!insightResult.$1 && !reportsResult.$1) {
      _error = 'Publication insights could not be loaded.';
    } else if (!insightResult.$1) {
      _error =
          'The publication snapshot could not be refreshed. Reports are still available.';
    } else if (!reportsResult.$1) {
      _error =
          'Reports could not be refreshed. Publication insights are still available.';
    }

    setState(() => _loading = false);
  }

  void _syncControllers() {
    final live = <String>{};
    for (final report in _reports) {
      final id = _text(report['id']);
      if (id.isEmpty) continue;
      live.add(id);
      _replyControllers.putIfAbsent(id, TextEditingController.new);
    }

    final stale = _replyControllers.keys
        .where((key) => !live.contains(key))
        .toList();
    for (final key in stale) {
      _replyControllers.remove(key)?.dispose();
    }
  }

  Future<void> _reviewReport(Map<String, dynamic> report, String status) async {
    final id = _text(report['id']);
    final reply = _replyControllers[id]?.text.trim() ?? '';

    if (reply.length < 3) {
      setState(
        () => _error = 'Write a short response before reviewing the report.',
      );
      return;
    }

    setState(() {
      _busyReportId = id;
      _error = '';
    });

    try {
      await _api.reviewPublicationReport(
        id,
        status: status,
        moderationAction: 'NONE',
        adminNote: reply,
        reporterMessage: reply,
        notifyReporter: true,
      );

      _changed = true;
      _replyControllers[id]?.clear();
      await _load();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Report ${status.toLowerCase()} and reporter notified.',
            ),
            backgroundColor: AppColors.primaryDeep,
          ),
        );
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busyReportId = '');
    }
  }

  Future<void> _unpublish() async {
    final success = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _UnpublishSheet(idea: _idea),
    );

    if (success == true && mounted) {
      _changed = true;
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final publication = _asMap(_idea['publication']);
    final feedback = _asListOfMaps(publication['feedback']);
    final visibleFeedback = feedback.take(6).toList();

    final averageRating = _asDouble(publication['averageRating']);
    final ratings = _asInt(publication['ratingsCount']);
    final upvotes = _asInt(publication['upvotesCount']);
    final downvotes = _asInt(publication['downvotesCount']);
    final feedbackCount = _asInt(publication['feedbackCount']);

    return Container(
      height: MediaQuery.sizeOf(context).height * .94,
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(27)),
      ),
      child: Column(
        children: [
          _SheetHeader(
            eyebrow: 'PUBLISHED IDEA',
            title: _text(
              publication['publicTitle'] ?? _idea['title'],
              fallback: 'Publication insights',
            ),
            subtitle: '${_ideaOwner(_idea)} · ${_ideaDomain(_idea)}',
            icon: Icons.public_rounded,
            onClose: () => Navigator.pop(context, _changed),
          ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(14, 13, 14, 28),
              children: [
                if (_error.isNotEmpty)
                  _InlineError(message: _error, onRetry: _load),
                _SignalGrid(
                  items: [
                    _Signal(
                      'Rating',
                      averageRating.toStringAsFixed(1),
                      '$ratings ratings',
                      Icons.star_outline_rounded,
                    ),
                    _Signal(
                      'Upvotes',
                      '$upvotes',
                      'community votes',
                      Icons.thumb_up_alt_outlined,
                    ),
                    _Signal(
                      'Downvotes',
                      '$downvotes',
                      'community votes',
                      Icons.thumb_down_alt_outlined,
                    ),
                    _Signal(
                      'Feedback',
                      '$feedbackCount',
                      'written responses',
                      Icons.chat_bubble_outline_rounded,
                    ),
                    _Signal(
                      'Reports',
                      '${_reports.length}',
                      'moderation reports',
                      Icons.flag_outlined,
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _DetailSection(
                  icon: Icons.description_outlined,
                  title: 'Publication snapshot',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _KeyValueGrid(
                        values: [
                          ('Status', _titleCase(publication['status'])),
                          ('Visibility', _titleCase(publication['visibility'])),
                          (
                            'Published',
                            _formatDate(
                              publication['publishedAt'],
                              withTime: true,
                            ),
                          ),
                          (
                            'Voting',
                            publication['allowVoting'] == true
                                ? 'Enabled'
                                : 'Disabled',
                          ),
                          (
                            'Ratings',
                            publication['allowRatings'] == true
                                ? 'Enabled'
                                : 'Disabled',
                          ),
                          (
                            'Feedback',
                            publication['allowFeedback'] == true
                                ? 'Enabled'
                                : 'Disabled',
                          ),
                        ],
                      ),
                      if (_text(publication['publicAbstract']).isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text(
                          _text(publication['publicAbstract']),
                          style: _detailBodyStyle,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: 'Recent community feedback',
                  trailing: '${feedback.length}',
                  child: feedback.isEmpty
                      ? const Text(
                          'No written feedback yet.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9,
                          ),
                        )
                      : Column(
                          children: [
                            for (
                              var index = 0;
                              index < visibleFeedback.length;
                              index++
                            ) ...[
                              _FeedbackTile(item: visibleFeedback[index]),
                              if (index != visibleFeedback.length - 1)
                                const SizedBox(height: 7),
                            ],
                          ],
                        ),
                ),
                const SizedBox(height: 9),
                _DetailSection(
                  icon: Icons.flag_outlined,
                  title: 'Reports on this publication',
                  trailing: '${_reports.length}',
                  child: _reports.isEmpty
                      ? const Text(
                          'No reports were submitted for this publication.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9,
                          ),
                        )
                      : Column(
                          children: [
                            for (
                              var index = 0;
                              index < _reports.length;
                              index++
                            ) ...[
                              _ReportReviewCard(
                                report: _reports[index],
                                controller:
                                    _replyControllers[_text(
                                      _reports[index]['id'],
                                    )],
                                busy:
                                    _busyReportId ==
                                    _text(_reports[index]['id']),
                                onDismiss: () =>
                                    _reviewReport(_reports[index], 'DISMISSED'),
                                onResolve: () =>
                                    _reviewReport(_reports[index], 'RESOLVED'),
                              ),
                              if (index != _reports.length - 1)
                                const SizedBox(height: 8),
                            ],
                          ],
                        ),
                ),
                if (_isPublished(_idea) &&
                    _text(publication['id']).isNotEmpty) ...[
                  const SizedBox(height: 11),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceRose,
                      borderRadius: BorderRadius.circular(17),
                      border: Border.all(
                        color: AppColors.pink.withValues(alpha: .14),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(
                              Icons.shield_outlined,
                              size: 17,
                              color: AppColors.pinkDeep,
                            ),
                            SizedBox(width: 7),
                            Text(
                              'Publication moderation',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 10.2,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 5),
                        const Text(
                          'Remove this idea from community discovery and notify the publisher with your reason.',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.2,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 9),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: _unpublish,
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.pinkDeep,
                              side: BorderSide(
                                color: AppColors.pink.withValues(alpha: .25),
                              ),
                            ),
                            icon: const Icon(Icons.shield_outlined, size: 16),
                            label: const Text('Unpublish idea'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UnpublishSheet extends StatefulWidget {
  const _UnpublishSheet({required this.idea});

  final Map<String, dynamic> idea;

  @override
  State<_UnpublishSheet> createState() => _UnpublishSheetState();
}

class _UnpublishSheetState extends State<_UnpublishSheet> {
  final _api = AdminApi.instance;
  final _reason = TextEditingController();

  bool _loading = false;
  String _error = '';

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reason.text.trim();
    final publicationId = _text(_asMap(widget.idea['publication'])['id']);

    if (reason.length < 3) {
      setState(
        () => _error = 'Please enter a clear reason of at least 3 characters.',
      );
      return;
    }
    if (publicationId.isEmpty) return;

    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      await _api.unpublishPublication(publicationId, reason);
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Container(
          margin: const EdgeInsets.all(10),
          padding: const EdgeInsets.fromLTRB(15, 10, 15, 16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: Colors.white),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
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
              const SizedBox(height: 15),
              const Row(
                children: [
                  Icon(Icons.shield_outlined, color: AppColors.pinkDeep),
                  SizedBox(width: 8),
                  Text(
                    'Unpublish this idea?',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'It will be removed from community discovery. The publisher receives your reason automatically.',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.2,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _reason,
                minLines: 3,
                maxLines: 5,
                maxLength: 1000,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Reason for unpublishing',
                  hintText: 'Explain why this publication is being removed…',
                  alignLabelWithHint: true,
                ),
              ),
              if (_error.isNotEmpty) ...[
                const SizedBox(height: 5),
                Text(
                  _error,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _loading
                          ? null
                          : () => Navigator.pop(context, false),
                      child: const Text('Keep published'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _loading ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.pinkDeep,
                      ),
                      icon: _loading
                          ? const SizedBox(
                              width: 15,
                              height: 15,
                              child: CircularProgressIndicator(
                                strokeWidth: 1.8,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(
                              Icons.notifications_active_outlined,
                              size: 16,
                            ),
                      label: Text(
                        _loading ? 'Unpublishing…' : 'Unpublish & notify',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onClose,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 10, 11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(27)),
        border: Border(
          bottom: BorderSide(
            color: AppColors.primaryDark.withValues(alpha: .07),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: AppColors.primaryDark, size: 19),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  eyebrow,
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 6.6,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .75,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.6,
                    height: 1.16,
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
          IconButton(
            onPressed: onClose,
            icon: const Icon(Icons.close_rounded),
            color: AppColors.textMuted,
          ),
        ],
      ),
    );
  }
}

class _DetailMetricGrid extends StatelessWidget {
  const _DetailMetricGrid({required this.items});

  final List<_DetailMetric> items;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 2.25,
      ),
      itemCount: items.length,
      itemBuilder: (_, index) {
        final item = items[index];
        return Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .06),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 31,
                height: 31,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(item.icon, size: 15, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      item.value,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 8.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
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

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.icon,
    required this.title,
    required this.child,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final Widget child;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .065),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 15, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (trailing != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    trailing!,
                    style: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 7.2,
                      fontWeight: FontWeight.w900,
                    ),
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

class _KeyValueGrid extends StatelessWidget {
  const _KeyValueGrid({required this.values});

  final List<(String, String)> values;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: values.map((entry) {
        return SizedBox(
          width: (MediaQuery.sizeOf(context).width - 72) / 2,
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.background.withValues(alpha: .65),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.$1,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.4,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                SelectableText(
                  entry.$2,
                  maxLines: 3,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.1,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _ListOrText extends StatelessWidget {
  const _ListOrText({required this.value, required this.fallback});

  final dynamic value;
  final String fallback;

  @override
  Widget build(BuildContext context) {
    if (value is List && value.isNotEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final item in value)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Icon(
                      Icons.circle,
                      size: 5,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 7),
                  Expanded(child: Text(_text(item), style: _detailBodyStyle)),
                ],
              ),
            ),
        ],
      );
    }

    return Text(_text(value, fallback: fallback), style: _detailBodyStyle);
  }
}

class _TagsOrText extends StatelessWidget {
  const _TagsOrText({required this.value, required this.fallback});

  final dynamic value;
  final String fallback;

  @override
  Widget build(BuildContext context) {
    if (value is List && value.isNotEmpty) {
      return Wrap(
        spacing: 6,
        runSpacing: 6,
        children: value
            .map(
              (item) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _text(item),
                  style: const TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 7.6,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            )
            .toList(),
      );
    }

    return Text(_text(value, fallback: fallback), style: _detailBodyStyle);
  }
}

class _SignalGrid extends StatelessWidget {
  const _SignalGrid({required this.items});

  final List<_Signal> items;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 2.15,
      ),
      itemCount: items.length,
      itemBuilder: (_, index) {
        final item = items[index];
        return Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .06),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: index == 4
                      ? AppColors.surfaceRose
                      : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  item.icon,
                  size: 15,
                  color: index == 4
                      ? AppColors.pinkDeep
                      : AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      item.value,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13,
                        height: 1.1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      item.hint,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 5.9,
                      ),
                    ),
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

class _FeedbackTile extends StatelessWidget {
  const _FeedbackTile({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final user = _asMap(item['user']);
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .66),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _text(user['fullName'], fallback: 'Community member'),
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                _formatDate(
                  item['updatedAt'] ?? item['createdAt'],
                  withTime: true,
                ),
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            _text(item['comment']),
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.2,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReportReviewCard extends StatelessWidget {
  const _ReportReviewCard({
    required this.report,
    required this.controller,
    required this.busy,
    required this.onDismiss,
    required this.onResolve,
  });

  final Map<String, dynamic> report;
  final TextEditingController? controller;
  final bool busy;
  final VoidCallback onDismiss;
  final VoidCallback onResolve;

  @override
  Widget build(BuildContext context) {
    final reporter = _asMap(report['reporter']);
    final status = _text(report['status']).toUpperCase();
    final pending = status == 'PENDING' || status == 'REVIEWING';

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: pending
            ? AppColors.background.withValues(alpha: .7)
            : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: pending
              ? AppColors.primaryDark.withValues(alpha: .06)
              : AppColors.primary.withValues(alpha: .1),
        ),
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
                    _TinyChip(
                      icon: Icons.flag_outlined,
                      label: _titleCase(status),
                      tint: pending ? AppColors.surfaceRose : AppColors.surface,
                      color: pending
                          ? AppColors.pinkDeep
                          : AppColors.primaryDeep,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _titleCase(report['reason'], fallback: 'Report'),
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_text(reporter['fullName'] ?? reporter['email'], fallback: 'Reporter')} · ${_formatDate(report['createdAt'], withTime: true)}',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.8,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (_text(report['details']).isNotEmpty) ...[
            const SizedBox(height: 7),
            Text(
              _text(report['details']),
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.1,
                height: 1.4,
              ),
            ),
          ],
          const SizedBox(height: 8),
          if (pending && controller != null) ...[
            TextField(
              controller: controller,
              minLines: 2,
              maxLines: 4,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Response to reporter',
                hintText: 'Write the moderation response…',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: busy ? null : onDismiss,
                    child: const Text('Dismiss'),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: busy ? null : onResolve,
                    icon: busy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 1.8,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.send_rounded, size: 14),
                    label: const Text('Resolve & reply'),
                  ),
                ),
              ],
            ),
          ] else ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.verified_outlined,
                  size: 15,
                  color: AppColors.primaryDark,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _text(
                      report['adminNote'],
                      fallback: 'Reviewed by administration.',
                    ),
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 8,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

const _detailBodyStyle = TextStyle(
  color: AppColors.textSecondary,
  fontSize: 9,
  height: 1.5,
);

class _IdeasFilter {
  const _IdeasFilter(this.key, this.label, this.icon);

  final String key;
  final String label;
  final IconData icon;
}

class _SortOption {
  const _SortOption(this.key, this.label, this.icon);

  final String key;
  final String label;
  final IconData icon;
}

class _SortSelection {
  const _SortSelection(this.field, this.order);

  final String field;
  final String order;
}

class _IdeasMetrics {
  const _IdeasMetrics({
    required this.total,
    required this.published,
    required this.locked,
    required this.unlocked,
  });

  final int total;
  final int published;
  final int locked;
  final int unlocked;
}

class _MetricData {
  const _MetricData(
    this.label,
    this.value,
    this.hint,
    this.icon,
    this.tone,
    this.iconColor,
  );

  final String label;
  final int value;
  final String hint;
  final IconData icon;
  final Color tone;
  final Color iconColor;
}

class _DetailMetric {
  const _DetailMetric(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;
}

class _Signal {
  const _Signal(this.label, this.value, this.hint, this.icon);

  final String label;
  final String value;
  final String hint;
  final IconData icon;
}

Future<(bool, dynamic)> _settle(Future<dynamic> future) async {
  try {
    return (true, await future);
  } catch (error) {
    return (false, error);
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const <String, dynamic>{};
}

Map<String, dynamic> _unwrapMap(dynamic value) {
  final map = _asMap(value);
  final data = map['data'];
  return data is Map ? _asMap(data) : map;
}

List<Map<String, dynamic>> _asListOfMaps(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<Map>().map(_asMap).toList();
}

String _text(dynamic value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

int _asInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _asDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

String _ideaOwner(Map<String, dynamic> idea) {
  final user = _asMap(idea['user']);
  return _text(
    user['fullName'] ?? user['email'] ?? idea['userEmail'],
    fallback: idea['guestSession'] != null ? 'Guest session' : 'Unknown owner',
  );
}

String _ideaOwnerMeta(Map<String, dynamic> idea) {
  final user = _asMap(idea['user']);
  return _text(
    user['email'],
    fallback: idea['guestSession'] != null ? 'Guest idea' : 'No email',
  );
}

String _ideaDomain(Map<String, dynamic> idea) {
  final domain = idea['domain'];
  if (domain is Map) return _text(domain['name'], fallback: 'Unassigned');
  return _text(domain, fallback: 'Unassigned');
}

bool _isPublished(Map<String, dynamic> idea) {
  return _text(_asMap(idea['publication'])['status']).toUpperCase() ==
      'PUBLISHED';
}

String _titleCase(dynamic value, {String fallback = '—'}) {
  final text = _text(value);
  if (text.isEmpty) return fallback;
  return text
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _formatDate(dynamic value, {bool withTime = false}) {
  final parsed = DateTime.tryParse(_text(value))?.toLocal();
  if (parsed == null) return '—';

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  final date = '${months[parsed.month - 1]} ${parsed.day}, ${parsed.year}';
  if (!withTime) return date;

  final hour = parsed.hour.toString().padLeft(2, '0');
  final minute = parsed.minute.toString().padLeft(2, '0');
  return '$date · $hour:$minute';
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
