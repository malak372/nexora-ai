// Voxidence mobile Discover — web content parity with a mobile-first layout.
//
// The information architecture mirrors the authenticated web Discover page:
// - Community-intelligence hero.
// - Available-now stat.
// - Search + sorting.
// - Featured opportunity.
// - Community gallery.
// - Publisher, rating, voting, feedback, and acceptance metrics.
// - Compact pagination for mobile.
//
// Visual decisions intentionally follow the Voxidence mobile palette instead
// of shrinking the desktop layout literally.
//
// @author  Malak

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'publication_page.dart';

class DiscoverPage extends StatefulWidget {
  const DiscoverPage({super.key});

  @override
  State<DiscoverPage> createState() => _DiscoverPageState();
}

class _DiscoverPageState extends State<DiscoverPage> {
  final TextEditingController _search = TextEditingController();

  Timer? _debounce;
  bool _loading = true;
  Object? _error;

  int _page = 1;
  int _totalPages = 1;
  int _total = 0;

  String _sort = 'newest';
  List<DiscoveryItem> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  ({String by, String order}) get _sortQuery => switch (_sort) {
    'rating' => (by: 'ratingAverage', order: 'desc'),
    'upvotes' => (by: 'upvotesCount', order: 'desc'),
    _ => (by: 'publishedAt', order: 'desc'),
  };

  String get _sortLabel => switch (_sort) {
    'rating' => 'Highest rated',
    'upvotes' => 'Most upvoted',
    _ => 'Newest',
  };

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final sort = _sortQuery;

      final result = await UserApi.instance.getDiscoveries(
        page: _page,
        limit: 12,
        search: _search.text.trim(),
        sortBy: sort.by,
        sortOrder: sort.order,
        force: force,
      );

      if (!mounted) return;

      final currentUserId =
          UserSessionController.instance.summary?.id.trim() ?? '';

      final visibleItems = currentUserId.isEmpty
          ? result.items
          : result.items
              .where(
                (item) =>
                    item.publisherId.isEmpty ||
                    item.publisherId != currentUserId,
              )
              .toList(growable: false);

      setState(() {
        _items = visibleItems;
        _total = result.total;
        _totalPages = result.totalPages;
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _onSearchChanged(String _) {
    setState(() {});

    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 360), () {
      if (!mounted) return;

      _page = 1;
      _load(force: true);
    });
  }

  Future<void> _open(DiscoveryItem item) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: RouteSettings(name: '/normal/discover/${item.id}'),
        builder: (_) => PublicationPage(publicationId: item.id),
      ),
    );

    if (mounted) {
      // Reuse the two-minute discovery cache on return. The list remains
      // visible immediately and a later pull-to-refresh can force the server.
      unawaited(_load());
    }
  }

  Future<void> _chooseSort() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: false,
      builder: (_) => _SortSheet(current: _sort),
    );

    if (!mounted || selected == null || selected == _sort) return;

    setState(() {
      _sort = selected;
      _page = 1;
    });

    await _load(force: true);
  }

  void _clearSearch() {
    _search.clear();
    setState(() {});
    _onSearchChanged('');
  }

  Future<void> _movePage(int page) async {
    if (page < 1 || page > _totalPages || page == _page) return;

    setState(() => _page = page);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final featured = _items.isEmpty ? null : _items.first;
    final remaining = featured == null
        ? const <DiscoveryItem>[]
        : _items.skip(1).toList(growable: false);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: AppColors.background,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: WorkspaceBackground(
          child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 118),
              children: [
                _Reveal(
                  delay: 0,
                  child: _DiscoverHero(
                    total: _total,
                    loading: _loading && _items.isEmpty,
                  ),
                ),

                const SizedBox(height: 13),

                _Reveal(
                  delay: 55,
                  child: _Controls(
                    controller: _search,
                    sortLabel: _sortLabel,
                    onChanged: _onSearchChanged,
                    onClear: _clearSearch,
                    onSort: _chooseSort,
                  ),
                ),

                const SizedBox(height: 15),

                if (_loading && _items.isEmpty)
                  const _DiscoverSkeletons()
                else if (_error != null && _items.isEmpty)
                  _DiscoverError(
                    error: _error,
                    onRetry: () => _load(force: true),
                  )
                else if (_items.isEmpty)
                  const _NoDiscoveries()
                else ...[
                  if (featured != null) ...[
                    _Reveal(
                      delay: 100,
                      child: _FeaturedOpportunity(
                        item: featured,
                        onTap: () => _open(featured),
                      ),
                    ),
                    const SizedBox(height: 17),
                  ],

                  _Reveal(
                    delay: 145,
                    child: _GalleryHeading(
                      count: remaining.length,
                      page: _page,
                    ),
                  ),

                  const SizedBox(height: 10),

                  if (remaining.isEmpty && _page == 1)
                    const _GalleryCompleteState()
                  else ...[
                    for (var i = 0; i < remaining.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 11),
                        child: _Reveal(
                          delay: 175 + (i.clamp(0, 4) * 35),
                          child: _DiscoveryStoryCard(
                            item: remaining[i],
                            index: ((_page - 1) * 12) + i,
                            onTap: () => _open(remaining[i]),
                          ),
                        ),
                      ),
                  ],

                  if (_totalPages > 1) ...[
                    const SizedBox(height: 3),
                    _CompactPagination(
                      page: _page,
                      totalPages: _totalPages,
                      onPage: _movePage,
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
      ),
    );
  }
}

class _DiscoverHero extends StatefulWidget {
  const _DiscoverHero({required this.total, required this.loading});

  final int total;
  final bool loading;

  @override
  State<_DiscoverHero> createState() => _DiscoverHeroState();
}

class _DiscoverHeroState extends State<_DiscoverHero>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 14),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(29),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFFFF7F9), Color(0xFFF0FAF8)],
          stops: [0, .55, 1],
        ),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .07),
            blurRadius: 30,
            offset: const Offset(0, 13),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(29),
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final phase = _controller.value * math.pi * 2;

            return Stack(
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: _HeroGridPainter(progress: _controller.value),
                  ),
                ),
                Positioned(
                  right: -78 + math.cos(phase * .7) * 10,
                  top: -92 + math.sin(phase * .65) * 9,
                  child: _HeroGlow(
                    size: 230,
                    color: AppColors.primary.withValues(alpha: .12),
                  ),
                ),
                Positioned(
                  left: -105 + math.sin(phase * .55) * 11,
                  bottom: -120 + math.cos(phase * .6) * 9,
                  child: _HeroGlow(
                    size: 250,
                    color: AppColors.pinkLight.withValues(alpha: .18),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _HeroEyebrow(),
                      const SizedBox(height: 14),
                      RichText(
                        text: TextSpan(
                          style: Theme.of(context).textTheme.headlineMedium
                              ?.copyWith(
                                color: AppColors.textPrimary,
                                fontSize: 27,
                                height: 1.03,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -.95,
                              ),
                          children: const [
                            TextSpan(text: 'Discover ideas shaped by\n'),
                            TextSpan(
                              text: 'real community ',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            TextSpan(
                              text: 'needs.',
                              style: TextStyle(
                                color: AppColors.pinkDeep,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        "Explore public opportunities created through Voxidence's evidence-driven generation workflow and shared by creators across the community.",
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.1,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 13),
                      const Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _HeroChip(
                            icon: Icons.trending_up_rounded,
                            text: 'Evidence driven',
                          ),
                          _HeroChip(
                            icon: Icons.star_outline_rounded,
                            text: 'Community rated',
                          ),
                          _HeroChip(
                            icon: Icons.thumb_up_alt_outlined,
                            text: 'Open for feedback',
                          ),
                        ],
                      ),
                      const SizedBox(height: 15),
                      _AvailableStat(
                        count: widget.total,
                        loading: widget.loading,
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _HeroEyebrow extends StatelessWidget {
  const _HeroEyebrow();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.auto_awesome_rounded,
            size: 12,
            color: AppColors.primaryDark,
          ),
          SizedBox(width: 6),
          Text(
            'COMMUNITY INTELLIGENCE',
            style: TextStyle(
              color: AppColors.primaryDark,
              fontSize: 7.3,
              fontWeight: FontWeight.w900,
              letterSpacing: .9,
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 29,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .07)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11.5, color: AppColors.primaryDark),
          const SizedBox(width: 4),
          Text(
            text,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 7.4,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _AvailableStat extends StatelessWidget {
  const _AvailableStat({required this.count, required this.loading});

  final int count;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 9, 12, 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 37,
            height: 37,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF69C5BF), Color(0xFF4DAAA5)],
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.auto_awesome_rounded,
              color: Colors.white,
              size: 17,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'AVAILABLE NOW',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .75,
                  ),
                ),
                const SizedBox(height: 1),
                if (loading)
                  const SizedBox(
                    width: 34,
                    height: 15,
                    child: LinearProgressIndicator(
                      minHeight: 3,
                      color: AppColors.primary,
                    ),
                  )
                else
                  Text(
                    '$count',
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 19,
                      height: 1,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                const SizedBox(height: 2),
                const Text(
                  'discoveries loaded',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 7.2),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.north_east_rounded,
            size: 15,
            color: AppColors.pinkDeep,
          ),
        ],
      ),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.controller,
    required this.sortLabel,
    required this.onChanged,
    required this.onClear,
    required this.onSort,
  });

  final TextEditingController controller;
  final String sortLabel;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;
  final VoidCallback onSort;

  @override
  Widget build(BuildContext context) {
    final hasSearch = controller.text.trim().isNotEmpty;

    return Column(
      children: [
        Container(
          height: 54,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .86),
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: hasSearch
                  ? AppColors.primary.withValues(alpha: .40)
                  : AppColors.primaryDark.withValues(alpha: .08),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .05),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: TextField(
            controller: controller,
            onChanged: onChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search titles, problems, creators...',
              prefixIcon: const Icon(Icons.search_rounded, size: 20),
              suffixIcon: hasSearch
                  ? IconButton(
                      onPressed: onClear,
                      icon: const Icon(Icons.close_rounded, size: 18),
                      tooltip: 'Clear',
                    )
                  : Container(
                      margin: const EdgeInsets.all(7),
                      padding: const EdgeInsets.symmetric(horizontal: 13),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.centerLeft,
                          end: Alignment.centerRight,
                          colors: [Color(0xFF58BDB8), Color(0xFF59C2BE)],
                        ),
                        borderRadius: BorderRadius.circular(11),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDark.withValues(alpha: .08),
                            blurRadius: 9,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: const Text(
                        'Search',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 8.3,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              filled: false,
              contentPadding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ),

        const SizedBox(height: 8),

        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onSort,
            borderRadius: BorderRadius.circular(16),
            child: Ink(
              height: 50,
              padding: const EdgeInsets.symmetric(horizontal: 13),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .82),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: AppColors.primaryDark.withValues(alpha: .08),
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
                    child: const Icon(
                      Icons.tune_rounded,
                      size: 16,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'SORT DISCOVERIES',
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 7.1,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .65,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    sortLabel,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 9.4,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(width: 5),
                  const Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 18,
                    color: AppColors.primaryDark,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _SortSheet extends StatelessWidget {
  const _SortSheet({required this.current});

  final String current;

  @override
  Widget build(BuildContext context) {
    const options = [
      ('newest', 'Newest', Icons.schedule_rounded),
      ('rating', 'Highest rated', Icons.star_outline_rounded),
      ('upvotes', 'Most upvoted', Icons.thumb_up_alt_outlined),
    ];

    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.fromLTRB(15, 10, 15, 15),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .12),
              blurRadius: 34,
              offset: const Offset(0, 15),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver.withValues(alpha: .70),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'Sort discoveries',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Choose how the community gallery is ordered.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 9.2),
            ),
            const SizedBox(height: 12),
            for (final option in options)
              Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: _SortOption(
                  value: option.$1,
                  label: option.$2,
                  icon: option.$3,
                  selected: current == option.$1,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SortOption extends StatelessWidget {
  const _SortOption({
    required this.value,
    required this.label,
    required this.icon,
    required this.selected,
  });

  final String value;
  final String label;
  final IconData icon;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => Navigator.of(context).pop(value),
        borderRadius: BorderRadius.circular(15),
        child: Ink(
          height: 49,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            gradient: selected
                ? const LinearGradient(
                    colors: [Color(0xFF5CBDB9), Color(0xFF4DAAA5)],
                  )
                : null,
            color: selected
                ? null
                : AppColors.primarySoft.withValues(alpha: .42),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? Colors.transparent
                  : AppColors.primaryDark.withValues(alpha: .06),
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 17,
                color: selected ? Colors.white : AppColors.primaryDark,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: selected ? Colors.white : AppColors.textPrimary,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (selected)
                const Icon(Icons.check_rounded, color: Colors.white, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

/// Compact mobile version of the web featured discovery.
///
/// The web page gives the newest discovery stronger visual priority. On a
/// phone, a second full-width hero wastes vertical space, so this card keeps
/// the same hierarchy using a small animated signal tile beside the content.
///
/// @author  Malak
class _FeaturedOpportunity extends StatefulWidget {
  const _FeaturedOpportunity({required this.item, required this.onTap});

  final DiscoveryItem item;
  final VoidCallback onTap;

  @override
  State<_FeaturedOpportunity> createState() => _FeaturedOpportunityState();
}

class _FeaturedOpportunityState extends State<_FeaturedOpportunity>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 10),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onTap,
        borderRadius: BorderRadius.circular(24),
        child: Ink(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                AppColors.surfaceRose,
                Color(0xFFF0F8F5),
              ],
              stops: [0, .55, 1],
            ),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .075),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .055),
                blurRadius: 22,
                offset: const Offset(0, 9),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 66,
                    height: 76,
                    child: AnimatedBuilder(
                      animation: _controller,
                      builder: (context, _) {
                        return CustomPaint(
                          painter: _FeaturedVisualPainter(
                            progress: _controller.value,
                          ),
                          child: Center(
                            child: Transform.translate(
                              offset: Offset(
                                0,
                                math.sin(_controller.value * math.pi * 2) * 1.6,
                              ),
                              child: Container(
                                width: 23,
                                height: 23,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: .76),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: Colors.white),
                                  boxShadow: [
                                    BoxShadow(
                                      color: AppColors.primaryDark.withValues(
                                        alpha: .05,
                                      ),
                                      blurRadius: 7,
                                      offset: const Offset(0, 3),
                                    ),
                                  ],
                                ),
                                child: const Icon(
                                  Icons.auto_awesome_rounded,
                                  color: AppColors.primaryDark,
                                  size: 10,
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),

                  const SizedBox(width: 9),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.pinkSoft,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: AppColors.pink.withValues(alpha: .14),
                            ),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.bolt_rounded,
                                size: 10,
                                color: AppColors.pinkDeep,
                              ),
                              SizedBox(width: 4),
                              Text(
                                'NEWEST OPPORTUNITY',
                                style: TextStyle(
                                  color: AppColors.pinkDeep,
                                  fontSize: 6.7,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: .6,
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 7),

                        Text(
                          item.title,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(
                                fontSize: 15.5,
                                height: 1.15,
                                letterSpacing: -.16,
                              ),
                        ),

                        const SizedBox(height: 5),

                        Row(
                          children: [
                            const Icon(
                              Icons.person_outline_rounded,
                              size: 10.5,
                              color: AppColors.textMuted,
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                item.publisherName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 7.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              if (item.description.trim().isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  item.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.9,
                    height: 1.42,
                  ),
                ),
              ],

              const SizedBox(height: 10),

              Wrap(
                spacing: 5,
                runSpacing: 5,
                children: [
                  _MetricPill(
                    icon: Icons.star_rounded,
                    text: item.ratingAverage <= 0
                        ? '0.0 rating'
                        : '${item.ratingAverage.toStringAsFixed(1)} rating',
                  ),
                  _MetricPill(
                    icon: Icons.thumb_up_alt_outlined,
                    text: '${item.upvotesCount} upvotes',
                  ),
                  _MetricPill(
                    icon: Icons.groups_2_outlined,
                    text: '${item.acceptanceCount} accepted',
                    positive: true,
                  ),
                ],
              ),

              const SizedBox(height: 10),

              SizedBox(
                width: double.infinity,
                height: 41,
                child: FilledButton(
                  onPressed: widget.onTap,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(13),
                    ),
                    textStyle: const TextStyle(
                      fontSize: 9.4,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.travel_explore_rounded, size: 14),
                      SizedBox(width: 7),
                      Text('Explore opportunity'),
                      SizedBox(width: 7),
                      Icon(Icons.arrow_forward_rounded, size: 14),
                    ],
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

/// Small brand-colored visual used only by the newest discovery card.
class _FeaturedVisualPainter extends CustomPainter {
  const _FeaturedVisualPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, const Radius.circular(19)),
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primarySoft, AppColors.mint, Color(0xFFF7E9ED)],
          stops: [0, .62, 1],
        ).createShader(rect),
    );

    final center = size.center(Offset.zero);

    for (final radius in [16.0, 24.0]) {
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color = AppColors.primaryDark.withValues(alpha: .13)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .8,
      );
    }

    final angle = progress * math.pi * 2;

    final outer = Offset(
      center.dx + math.cos(angle) * 24,
      center.dy + math.sin(angle) * 24,
    );

    final inner = Offset(
      center.dx + math.cos(-angle * 1.35) * 16,
      center.dy + math.sin(-angle * 1.35) * 16,
    );

    canvas.drawCircle(outer, 2.8, Paint()..color = AppColors.pink);

    canvas.drawCircle(inner, 2.4, Paint()..color = AppColors.primary);

    final shimmerX = -18 + ((size.width + 36) * progress);

    final shimmer = Path()
      ..moveTo(shimmerX - 15, size.height)
      ..lineTo(shimmerX + 7, 0)
      ..lineTo(shimmerX + 20, 0)
      ..lineTo(shimmerX - 2, size.height)
      ..close();

    canvas.drawPath(
      shimmer,
      Paint()..color = Colors.white.withValues(alpha: .18),
    );
  }

  @override
  bool shouldRepaint(covariant _FeaturedVisualPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _GalleryHeading extends StatelessWidget {
  const _GalleryHeading({required this.count, required this.page});

  final int count;
  final int page;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 39,
          height: 39,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFFF3F6), Color(0xFFEAF6F3)],
            ),
            borderRadius: BorderRadius.circular(13),
          ),
          child: const Icon(
            Icons.auto_awesome_rounded,
            size: 17,
            color: AppColors.primaryDark,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'COMMUNITY GALLERY',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 7,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .85,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                page == 1 ? 'More discoveries' : 'Discoveries',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Ideas shared by Voxidence creators.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 8.4),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.primarySoft.withValues(alpha: .62),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '$count results',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.8,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }
}

class _DiscoveryStoryCard extends StatefulWidget {
  const _DiscoveryStoryCard({
    required this.item,
    required this.index,
    required this.onTap,
  });

  final DiscoveryItem item;
  final int index;
  final VoidCallback onTap;

  @override
  State<_DiscoveryStoryCard> createState() => _DiscoveryStoryCardState();
}

class _DiscoveryStoryCardState extends State<_DiscoveryStoryCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: Duration(seconds: 8 + (widget.index % 4)),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final initials = _initials(item.publisherName);
    final titleInitials = _initials(item.title);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: widget.onTap,
        borderRadius: BorderRadius.circular(23),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .96),
            borderRadius: BorderRadius.circular(23),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .07),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .045),
                blurRadius: 19,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(23),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 78,
                  width: double.infinity,
                  child: AnimatedBuilder(
                    animation: _controller,
                    builder: (context, _) => CustomPaint(
                      painter: _StoryArtPainter(
                        progress: _controller.value,
                        variant: widget.index % 4,
                      ),
                      child: Stack(
                        children: [
                          Positioned(
                            left: 13,
                            bottom: 11,
                            child: Container(
                              width: 38,
                              height: 38,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .13),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: .32),
                                ),
                              ),
                              child: Text(
                                titleInitials,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ),
                          Positioned(
                            right: 13,
                            bottom: 11,
                            child: Text(
                              '#${(widget.index + 1).toString().padLeft(2, '0')}',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: .72),
                                fontSize: 7.4,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(13, 12, 13, 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [Color(0xFFFFF3F6), Color(0xFFEAF6F3)],
                              ),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              initials,
                              style: const TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 7.8,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item.publisherName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 8.7,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(height: 1),
                                const Row(
                                  children: [
                                    Icon(
                                      Icons.person_outline_rounded,
                                      size: 9.5,
                                      color: AppColors.textMuted,
                                    ),
                                    SizedBox(width: 3),
                                    Text(
                                      'Published in Voxidence',
                                      style: TextStyle(
                                        color: AppColors.textMuted,
                                        fontSize: 6.9,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      _StoryLabel(accepted: item.isAccepted),
                      const SizedBox(height: 7),
                      Text(
                        item.title,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(
                              fontSize: 14,
                              height: 1.2,
                              letterSpacing: -.14,
                            ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        item.description.trim().isEmpty
                            ? 'A software opportunity shared with the Voxidence community for discovery and collaboration.'
                            : item.description,
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 8.8,
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 5,
                        runSpacing: 5,
                        children: [
                          _TinyMetric(
                            icon: Icons.star_outline_rounded,
                            value: item.ratingAverage.toStringAsFixed(1),
                          ),
                          _TinyMetric(
                            icon: Icons.thumb_up_alt_outlined,
                            value: '${item.upvotesCount}',
                          ),
                          _TinyMetric(
                            icon: Icons.thumb_down_alt_outlined,
                            value: '${item.downvotesCount}',
                          ),
                          _TinyMetric(
                            icon: Icons.chat_bubble_outline_rounded,
                            value: '${item.feedbackCount}',
                          ),
                          _TinyMetric(
                            icon: Icons.groups_2_outlined,
                            value: '${item.acceptanceCount}',
                            suffix: 'accepted',
                            positive: true,
                          ),
                        ],
                      ),
                      const SizedBox(height: 11),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: widget.onTap,
                          iconAlignment: IconAlignment.end,
                          icon: const Icon(Icons.north_east_rounded, size: 13),
                          label: const Text('Explore the idea'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(40),
                            backgroundColor: AppColors.primarySoft.withValues(
                              alpha: .42,
                            ),
                            side: BorderSide(
                              color: AppColors.primary.withValues(alpha: .12),
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            textStyle: const TextStyle(
                              fontSize: 9.1,
                              fontWeight: FontWeight.w900,
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
        ),
      ),
    );
  }
}

/// Decorative header for community discovery cards.
///
/// All variants stay inside the Voxidence palette:
/// teal, sage, mint, porcelain, and soft rose. Purple and gold variants are
/// intentionally avoided so the Discover gallery stays consistent with the
/// rest of the application.
///
/// @author  Malak
class _StoryArtPainter extends CustomPainter {
  const _StoryArtPainter({required this.progress, required this.variant});

  final double progress;
  final int variant;

  @override
  void paint(Canvas canvas, Size size) {
    final colors = switch (variant) {
      1 => const [Color(0xFF4C817A), AppColors.sage],
      2 => const [Color(0xFFB97787), AppColors.pink],
      3 => const [Color(0xFF5D8D84), Color(0xFF9EC8BD)],
      _ => const [AppColors.primaryDark, AppColors.primary],
    };

    final rect = Offset.zero & size;

    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ).createShader(rect),
    );

    // Subtle mint/porcelain wash makes every variant feel related.
    canvas.drawRect(
      rect,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.bottomLeft,
          end: Alignment.topRight,
          colors: [
            AppColors.mint.withValues(alpha: .08),
            Colors.transparent,
            AppColors.surface.withValues(alpha: .07),
          ],
        ).createShader(rect),
    );

    final dots = Paint()..color = Colors.white.withValues(alpha: .11);

    for (double x = 9; x < size.width; x += 18) {
      for (double y = 9; y < size.height; y += 18) {
        canvas.drawCircle(Offset(x, y), .6, dots);
      }
    }

    final ringCenter = Offset(size.width - 30, 23);

    for (final radius in [23.0, 42.0]) {
      canvas.drawCircle(
        ringCenter,
        radius,
        Paint()
          ..color = Colors.white.withValues(alpha: .16)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .8,
      );
    }

    final angle = progress * math.pi * 2;

    canvas.drawCircle(
      Offset(
        ringCenter.dx + math.cos(angle) * 42,
        ringCenter.dy + math.sin(angle) * 42,
      ),
      3.1,
      Paint()
        ..color = variant == 2 ? const Color(0xFFE9F5F1) : AppColors.pinkLight,
    );

    final secondAngle = -angle * 1.25;

    canvas.drawCircle(
      Offset(
        ringCenter.dx + math.cos(secondAngle) * 23,
        ringCenter.dy + math.sin(secondAngle) * 23,
      ),
      2.5,
      Paint()..color = Colors.white.withValues(alpha: .90),
    );

    final beam = math.sin(progress * math.pi * 2) * 22;

    final path = Path()
      ..moveTo(-42 + beam, size.height * .82)
      ..lineTo(size.width + 52 + beam, size.height * .22)
      ..lineTo(size.width + 52 + beam, size.height * .40)
      ..lineTo(-42 + beam, size.height)
      ..close();

    canvas.drawPath(
      path,
      Paint()
        ..shader = LinearGradient(
          colors: [
            Colors.transparent,
            Colors.white.withValues(alpha: .075),
            Colors.transparent,
          ],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _StoryArtPainter oldDelegate) {
    return oldDelegate.progress != progress || oldDelegate.variant != variant;
  }
}

class _StoryLabel extends StatelessWidget {
  const _StoryLabel({required this.accepted});

  final bool accepted;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          accepted
              ? Icons.check_circle_outline_rounded
              : Icons.auto_awesome_rounded,
          size: 12,
          color: accepted ? AppColors.success : AppColors.primaryDark,
        ),
        const SizedBox(width: 4),
        Text(
          accepted ? 'Accepted opportunity' : 'Community discovery',
          style: TextStyle(
            color: accepted ? AppColors.success : AppColors.primaryDark,
            fontSize: 7.7,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

// ignore: unused_element
class _DomainPill extends StatelessWidget {
  const _DomainPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 135),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .58),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: AppColors.primaryDark,
          fontSize: 7.2,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

// ignore: unused_element
class _RatingBadge extends StatelessWidget {
  const _RatingBadge({required this.value});

  final double value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft.withValues(alpha: .74),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.star_rounded, size: 12, color: AppColors.pinkDeep),
          const SizedBox(width: 3),
          Text(
            value <= 0 ? 'New' : value.toStringAsFixed(1),
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 7.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _TinyMetric extends StatelessWidget {
  const _TinyMetric({
    required this.icon,
    required this.value,
    this.suffix,
    this.positive = false,
  });

  final IconData icon;
  final String value;
  final String? suffix;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 27,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        color: positive ? const Color(0xFFF0F9F5) : const Color(0xFFF7F8F7),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(
          color: positive
              ? AppColors.success.withValues(alpha: .08)
              : AppColors.primaryDark.withValues(alpha: .05),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 11,
            color: positive ? AppColors.success : AppColors.textMuted,
          ),
          const SizedBox(width: 4),
          Text(
            value,
            style: TextStyle(
              color: positive ? AppColors.success : AppColors.textSecondary,
              fontSize: 7.3,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (suffix != null) ...[
            const SizedBox(width: 3),
            Text(
              suffix!,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 6.6),
            ),
          ],
        ],
      ),
    );
  }
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({
    required this.icon,
    required this.text,
    this.positive = false,
  });

  final IconData icon;
  final String text;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: positive
              ? const [Color(0xFFF0FAF6), Color(0xFFE8F5F0)]
              : const [Color(0xFFFFF4F7), Color(0xFFF0F8F6)],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .05)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 12,
            color: positive ? AppColors.success : AppColors.primaryDark,
          ),
          const SizedBox(width: 5),
          Text(
            text,
            style: TextStyle(
              color: positive ? AppColors.success : AppColors.textPrimary,
              fontSize: 7.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

// ignore: unused_element
class _SectionEyebrow extends StatelessWidget {
  const _SectionEyebrow({required this.icon, required this.label})
    : rose = false;

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final color = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Row(
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            label.toUpperCase(),
            style: TextStyle(
              color: color,
              fontSize: 7.2,
              fontWeight: FontWeight.w900,
              letterSpacing: .72,
            ),
          ),
        ),
      ],
    );
  }
}

class _CompactPagination extends StatelessWidget {
  const _CompactPagination({
    required this.page,
    required this.totalPages,
    required this.onPage,
  });

  final int page;
  final int totalPages;
  final ValueChanged<int> onPage;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 49,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .07)),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: page <= 1 ? null : () => onPage(page - 1),
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          Expanded(
            child: Text(
              'Page $page of $totalPages',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          IconButton(
            onPressed: page >= totalPages ? null : () => onPage(page + 1),
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }
}

class _DiscoverSkeletons extends StatelessWidget {
  const _DiscoverSkeletons();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        4,
        (index) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Container(
            height: index == 0 ? 255 : 260,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .74),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: AppColors.primaryDark.withValues(alpha: .05),
              ),
            ),
            child: const Center(
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.primary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DiscoverError extends StatelessWidget {
  const _DiscoverError({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.auto_awesome_rounded,
      title: 'We could not load Discover',
      message: error is ApiException
          ? (error as ApiException).message
          : '$error',
      action: FilledButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh_rounded, size: 16),
        label: const Text('Retry'),
      ),
    );
  }
}

class _NoDiscoveries extends StatelessWidget {
  const _NoDiscoveries();

  @override
  Widget build(BuildContext context) {
    return const EmptyState(
      icon: Icons.auto_awesome_rounded,
      title: 'No discoveries found',
      message: 'Try another search or return after new ideas are published.',
    );
  }
}

class _GalleryCompleteState extends StatelessWidget {
  const _GalleryCompleteState();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .42),
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Row(
        children: [
          Icon(
            Icons.auto_awesome_rounded,
            color: AppColors.primaryDark,
            size: 18,
          ),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'This featured opportunity is the only result in the current view.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Reveal extends StatelessWidget {
  const _Reveal({required this.child, required this.delay});

  final Widget child;
  final int delay;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 520 + delay),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        final normalized = ((value * (520 + delay) - delay) / 520).clamp(
          0.0,
          1.0,
        );

        return Opacity(
          opacity: normalized,
          child: Transform.translate(
            offset: Offset(0, 18 * (1 - normalized)),
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}

class _HeroGlow extends StatelessWidget {
  const _HeroGlow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

class _HeroGridPainter extends CustomPainter {
  const _HeroGridPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: .025)
      ..strokeWidth = .65;

    const step = 29.0;

    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), line);
    }

    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }

    final pulse = (math.sin(progress * math.pi * 2) + 1) / 2;

    final points = [
      Offset(size.width * .82, size.height * .20),
      Offset(size.width * .72, size.height * .68),
      Offset(size.width * .91, size.height * .48),
    ];

    for (var i = 0; i < points.length; i++) {
      canvas.drawCircle(
        points[i],
        2.5 + (pulse * .6),
        Paint()
          ..color = i.isEven
              ? AppColors.pink.withValues(alpha: .26)
              : AppColors.primary.withValues(alpha: .25),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _HeroGridPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .take(2)
      .toList();

  if (parts.isEmpty) return 'VX';

  return parts.map((part) => part[0]).join().toUpperCase();
}
