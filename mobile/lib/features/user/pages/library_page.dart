// Voxidence mobile idea library.
//
// Mobile-first parity for the authenticated web library:
// - All / Free / Unlocked / Published / Accepted / Favorites
// - Search
// - Inclusive date-range filtering
// - Pagination
// - Favorite and owned-idea actions
//
// The interface intentionally avoids desktop-style filter rows and the large
// Material date dialog. Filters are touch-first and the date range is edited
// inside a compact Voxidence bottom sheet.
//
// @author  Malak

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'accepted_idea_workspace_page.dart';
import 'idea_workspace_page.dart';
import 'publication_page.dart';

class LibraryPage extends StatefulWidget {
  const LibraryPage({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  State<LibraryPage> createState() => _LibraryPageState();
}

class _LibraryPageState extends State<LibraryPage> {
  static const int _pageSize = 18;
  static const _filters = <_LibraryFilter>[
    _LibraryFilter(label: 'All', icon: Icons.grid_view_rounded),
    _LibraryFilter(label: 'Free', icon: Icons.eco_outlined),
    _LibraryFilter(label: 'Unlocked', icon: Icons.lock_open_rounded),
    _LibraryFilter(label: 'Published', icon: Icons.public_rounded),
    _LibraryFilter(label: 'Accepted', icon: Icons.handshake_outlined),
    _LibraryFilter(label: 'Favorites', icon: Icons.favorite_border_rounded),
  ];

  final TextEditingController _search = TextEditingController();

  Timer? _debounce;

  int _tab = 0;
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;

  DateTime? _from;
  DateTime? _to;

  bool _loading = true;
  Object? _error;

  List<IdeaSummary> _items = const [];

  @override
  void initState() {
    super.initState();

    _tab = widget.initialTab.clamp(0, _filters.length - 1).toInt();

    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final query = _search.text.trim();
      PagedResult<IdeaSummary> result;

      if (_tab <= 2) {
        result = await UserApi.instance.getMyIdeas(
          page: _page,
          limit: _pageSize,
          search: query,
          isUnlocked: _tab == 1
              ? false
              : _tab == 2
              ? true
              : null,
          fromDate: _from,
          toDate: _to,
          force: force,
        );
      } else if (_tab == 3) {
        final raw = await UserApi.instance.getPublishedRaw(
          page: _page,
          limit: _pageSize,
          search: query,
          fromDate: _from,
          toDate: _to,
          force: force,
        );

        result = PagedResult<IdeaSummary>(
          items: raw.items.map(IdeaSummary.fromJson).toList(),
          total: raw.total,
          totalPages: raw.totalPages,
        );
      } else if (_tab == 4) {
        result = await UserApi.instance.getAccepted(
          page: _page,
          limit: _pageSize,
          search: query,
          fromDate: _from,
          toDate: _to,
          force: force,
        );
      } else {
        final all = await UserApi.instance.getFavorites(force: force);

        final filtered = all.where((item) {
          final searchMatch =
              query.isEmpty ||
              item.title.toLowerCase().contains(query.toLowerCase()) ||
              item.abstractText.toLowerCase().contains(query.toLowerCase()) ||
              item.domainName.toLowerCase().contains(query.toLowerCase());

          final date = item.createdAt?.toLocal();

          final fromMatch =
              _from == null ||
              date == null ||
              !date.isBefore(DateTime(_from!.year, _from!.month, _from!.day));

          final toEnd = _to == null
              ? null
              : DateTime(_to!.year, _to!.month, _to!.day, 23, 59, 59, 999);

          final toMatch = toEnd == null || date == null || !date.isAfter(toEnd);

          return searchMatch && fromMatch && toMatch;
        }).toList();

        final start = ((_page - 1) * _pageSize)
            .clamp(0, filtered.length)
            .toInt();

        final end = (start + _pageSize).clamp(0, filtered.length).toInt();

        result = PagedResult<IdeaSummary>(
          items: filtered.sublist(start, end),
          total: filtered.length,
          totalPages: ((filtered.length + _pageSize - 1) ~/ _pageSize)
              .clamp(1, 99999)
              .toInt(),
        );
      }

      if (!mounted) return;

      var resolvedTotal = result.total;
      var resolvedTotalPages = result.totalPages;

      // The account summary is a safe fallback for the unfiltered owned-ideas
      // view. It prevents a malformed/missing pagination envelope from making
      // an account with hundreds of ideas look as if it only owns one page.
      if (_tab == 0 && query.isEmpty && _from == null && _to == null) {
        final summaryTotal =
            UserSessionController.instance.summary?.ideasCount ?? 0;
        if (summaryTotal > resolvedTotal) {
          resolvedTotal = summaryTotal;
          final pagesFromSummary =
              ((summaryTotal + _pageSize - 1) ~/ _pageSize)
                  .clamp(1, 999999)
                  .toInt();
          if (pagesFromSummary > resolvedTotalPages) {
            resolvedTotalPages = pagesFromSummary;
          }
        }
      }

      setState(() {
        _items = result.items;
        _total = resolvedTotal;
        _totalPages = resolvedTotalPages < 1 ? 1 : resolvedTotalPages;
        if (_page > _totalPages) _page = _totalPages;
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

  void _onSearch(String _) {
    setState(() {});

    _debounce?.cancel();

    _debounce = Timer(const Duration(milliseconds: 350), () {
      _page = 1;
      _load(force: true);
    });
  }

  void _selectTab(int value) {
    if (_tab == value) return;

    setState(() {
      _tab = value;
      _page = 1;
      _items = const [];
    });

    _load();
  }

  Future<void> _openFilterPicker() async {
    final selected = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _LibraryFilterSheet(filters: _filters, selected: _tab),
    );

    if (selected == null || !mounted) return;
    _selectTab(selected);
  }

  Future<void> _openDateRange() async {
    final result = await showModalBottomSheet<_DateRangeResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DateRangeSheet(initialFrom: _from, initialTo: _to),
    );

    if (result == null || !mounted) return;

    setState(() {
      _from = result.from;
      _to = result.to;
      _page = 1;
    });

    await _load(force: true);
  }

  void _clearDates() {
    if (_from == null && _to == null) return;

    setState(() {
      _from = null;
      _to = null;
      _page = 1;
    });

    _load(force: true);
  }

  Future<void> _toggleFavorite(IdeaSummary idea) async {
    try {
      if (idea.isFavorite || _tab == 5) {
        await UserApi.instance.removeFavorite(idea.id);
      } else {
        await UserApi.instance.addFavorite(idea.id);
      }

      await _load(force: true);
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    }
  }

  Future<void> _deleteIdea(IdeaSummary idea) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _DeleteIdeaSheet(title: idea.title),
    );

    if (confirmed != true) return;

    try {
      await UserApi.instance.deleteIdea(idea.id);

      await _load(force: true);

      if (mounted) {
        showAppSnackBar(context, 'Idea deleted.');
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    }
  }

  Future<void> _open(IdeaSummary idea) async {
    Widget page;

    if (_tab == 4 && idea.publicationId != null) {
      page = idea.isUnlocked
          ? AcceptedIdeaWorkspacePage(publicationId: idea.publicationId!)
          : PublicationPage(publicationId: idea.publicationId!);
    } else {
      page = IdeaWorkspacePage(ideaId: idea.id);
    }

    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));

    if (mounted) {
      await _load(force: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeFilter = _filters[_tab];

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(15, 11, 15, 118),
              children: [
                _LibraryHero(total: _total, filter: activeFilter.label),

                const SizedBox(height: 9),

                _LibrarySearch(
                  controller: _search,
                  onChanged: _onSearch,
                  onClear: _search.text.isEmpty
                      ? null
                      : () {
                          _search.clear();
                          _onSearch('');
                        },
                ),

                const SizedBox(height: 8),

                _LibraryControlBar(
                  filter: activeFilter,
                  from: _from,
                  to: _to,
                  onFilterTap: _openFilterPicker,
                  onDateTap: _openDateRange,
                  onClearDates: _from == null && _to == null
                      ? null
                      : _clearDates,
                ),

                const SizedBox(height: 12),

                _ResultsHeading(
                  label: activeFilter.label,
                  total: _total,
                  loading: _loading,
                ),

                const SizedBox(height: 9),

                if (_loading && _items.isEmpty)
                  const LoadingList(count: 5)
                else if (_error != null && _items.isEmpty)
                  EmptyState(
                    icon: Icons.cloud_off_rounded,
                    title: 'Could not load ${activeFilter.label.toLowerCase()}',
                    message: _error.toString(),
                    action: FilledButton.icon(
                      onPressed: () => _load(force: true),
                      icon: const Icon(Icons.refresh_rounded, size: 15),
                      label: const Text('Retry'),
                    ),
                  )
                else if (_items.isEmpty)
                  EmptyState(
                    icon: activeFilter.icon,
                    title: 'Nothing here yet',
                    message: _emptyMessage(),
                  )
                else ...[
                  for (var index = 0; index < _items.length; index++) ...[
                    _LibraryIdeaCard(
                      idea: _items[index],
                      tab: _tab,
                      index: ((_page - 1) * _pageSize) + index + 1,
                      onTap: () => _open(_items[index]),
                      onFavorite: _tab == 3 || _tab == 4
                          ? null
                          : () => _toggleFavorite(_items[index]),
                      onDelete: _tab <= 2
                          ? () => _deleteIdea(_items[index])
                          : null,
                    ),
                    if (index != _items.length - 1) const SizedBox(height: 9),
                  ],

                  if (_totalPages > 1) ...[
                    const SizedBox(height: 12),
                    _Pagination(
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
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _emptyMessage() {
    return switch (_tab) {
      1 => 'Free core ideas appear here before advanced access is unlocked.',
      2 =>
        'Ideas with advanced outputs appear here after a credit or direct unlock.',
      3 => 'Publish one of your private ideas to share a safe public snapshot.',
      4 => 'Ideas you accept from Discover appear here.',
      5 => 'Tap the heart on an owned idea to save it for quick access.',
      _ => 'Generate your first evidence-backed software direction.',
    };
  }
}

class _LibraryFilter {
  const _LibraryFilter({required this.label, required this.icon});

  final String label;
  final IconData icon;
}

class _LibraryHero extends StatelessWidget {
  const _LibraryHero({required this.total, required this.filter});

  final int total;
  final String filter;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 150),
      padding: const EdgeInsets.fromLTRB(15, 14, 14, 13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, Color(0xFFF0F8F5), Color(0xFFF7FBF9)],
          stops: [0, .58, 1],
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .055),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned(right: -7, top: -5, child: _LibraryHeroVisual()),
          Padding(
            padding: const EdgeInsets.only(right: 96),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(
                      Icons.auto_awesome_rounded,
                      size: 10,
                      color: AppColors.primaryDark,
                    ),
                    SizedBox(width: 5),
                    Text(
                      'IDEA LIBRARY',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 6.1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .74,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                const Text(
                  'My ideas',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 23,
                    height: 1,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.5,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Everything you own, unlock, publish, accept or save — arranged as one focused workspace.',
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.1,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _LibraryHeroPill(
                      icon: Icons.layers_outlined,
                      value: '$total',
                      label: total == 1 ? 'idea' : 'ideas',
                    ),
                    const SizedBox(width: 6),
                    _LibraryHeroPill(
                      icon: Icons.tune_rounded,
                      value: filter,
                      label: 'view',
                      soft: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LibraryHeroVisual extends StatelessWidget {
  const _LibraryHeroVisual();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 92,
            height: 92,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.primary.withValues(alpha: .10),
              ),
            ),
          ),
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.primaryDark.withValues(alpha: .08),
              ),
            ),
          ),
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF6BC5BF), Color(0xFF4EA8A3)],
              ),
              borderRadius: BorderRadius.circular(15),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: .14),
                  blurRadius: 12,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: const Icon(
              Icons.lightbulb_outline_rounded,
              size: 20,
              color: Colors.white,
            ),
          ),
          Positioned(
            right: 12,
            top: 17,
            child: _LibraryHeroDot(size: 7, color: AppColors.primary),
          ),
          Positioned(
            left: 5,
            bottom: 24,
            child: _LibraryHeroDot(size: 6, color: AppColors.sage),
          ),
          Positioned(
            right: 10,
            bottom: 12,
            child: _LibraryHeroDot(size: 5, color: AppColors.primaryDark),
          ),
        ],
      ),
    );
  }
}

class _LibraryHeroDot extends StatelessWidget {
  const _LibraryHeroDot({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withValues(alpha: .74),
        border: Border.all(color: Colors.white, width: 1.3),
      ),
    );
  }
}

class _LibraryHeroPill extends StatelessWidget {
  const _LibraryHeroPill({
    required this.icon,
    required this.value,
    required this.label,
    this.soft = false,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool soft;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 31,
      constraints: const BoxConstraints(maxWidth: 104),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: soft
            ? Colors.white.withValues(alpha: .68)
            : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .045),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10.5, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 3),
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 4.9,
              fontWeight: FontWeight.w900,
              letterSpacing: .35,
            ),
          ),
        ],
      ),
    );
  }
}

class _LibrarySearch extends StatelessWidget {
  const _LibrarySearch({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 55,
      padding: const EdgeInsets.fromLTRB(6, 5, 6, 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .055),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        style: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: 10.2,
          fontWeight: FontWeight.w700,
        ),
        decoration: InputDecoration(
          hintText: 'Search your ideas…',
          hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 9.8),
          prefixIcon: const Padding(
            padding: EdgeInsets.only(left: 3, right: 2),
            child: Icon(
              Icons.search_rounded,
              size: 18,
              color: AppColors.primaryDark,
            ),
          ),
          prefixIconConstraints: const BoxConstraints(minWidth: 38),
          suffixIcon: onClear == null
              ? null
              : IconButton(
                  tooltip: 'Clear search',
                  onPressed: onClear,
                  icon: const Icon(Icons.close_rounded, size: 16),
                ),
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 11),
        ),
      ),
    );
  }
}

class _LibraryControlBar extends StatelessWidget {
  const _LibraryControlBar({
    required this.filter,
    required this.from,
    required this.to,
    required this.onFilterTap,
    required this.onDateTap,
    required this.onClearDates,
  });

  final _LibraryFilter filter;
  final DateTime? from;
  final DateTime? to;
  final VoidCallback onFilterTap;
  final VoidCallback onDateTap;
  final VoidCallback? onClearDates;

  @override
  Widget build(BuildContext context) {
    final hasDates = from != null || to != null;

    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF4FAF8), AppColors.surface],
        ),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .045),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: _LibraryControlButton(
              icon: filter.icon,
              eyebrow: 'VIEW',
              value: filter.label,
              onTap: onFilterTap,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            flex: 2,
            child: _LibraryControlButton(
              icon: Icons.calendar_month_outlined,
              eyebrow: 'DATE RANGE',
              value: hasDates
                  ? '${_formatShortDate(from, fallback: 'Any')} → ${_formatShortDate(to, fallback: 'Today')}'
                  : 'Any date → Today',
              onTap: onDateTap,
              trailing: hasDates && onClearDates != null
                  ? InkWell(
                      onTap: onClearDates,
                      borderRadius: BorderRadius.circular(999),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(
                          Icons.close_rounded,
                          size: 12.5,
                          color: AppColors.textMuted,
                        ),
                      ),
                    )
                  : const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      size: 16,
                      color: AppColors.primaryDark,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LibraryControlButton extends StatelessWidget {
  const _LibraryControlButton({
    required this.icon,
    required this.eyebrow,
    required this.value,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String eyebrow;
  final String value;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .70),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .045),
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
                child: Icon(icon, size: 14, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 5.3,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .46,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 7.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 4), trailing!],
            ],
          ),
        ),
      ),
    );
  }
}

class _LibraryFilterSheet extends StatelessWidget {
  const _LibraryFilterSheet({required this.filters, required this.selected});

  final List<_LibraryFilter> filters;
  final int selected;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        padding: const EdgeInsets.fromLTRB(13, 9, 13, 14),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.surface, Color(0xFFF2F9F7)],
          ),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .14),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 13),
            const Text(
              'LIBRARY VIEW',
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 6.1,
                fontWeight: FontWeight.w900,
                letterSpacing: .7,
              ),
            ),
            const SizedBox(height: 3),
            const Text(
              'What do you want to see?',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 10),
            for (var index = 0; index < filters.length; index++) ...[
              _LibraryFilterOption(
                item: filters[index],
                selected: index == selected,
                onTap: () => Navigator.of(context).pop(index),
              ),
              if (index != filters.length - 1) const SizedBox(height: 6),
            ],
          ],
        ),
      ),
    );
  }
}

class _LibraryFilterOption extends StatelessWidget {
  const _LibraryFilterOption({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final _LibraryFilter item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 170),
          height: 50,
          padding: const EdgeInsets.symmetric(horizontal: 9),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft
                : Colors.white.withValues(alpha: .66),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .22)
                  : AppColors.primaryDark.withValues(alpha: .045),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 31,
                height: 31,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? AppColors.primary : Color(0xFFF1F8F6),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  item.icon,
                  size: 14,
                  color: selected ? Colors.white : AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.label,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (selected)
                const Icon(
                  Icons.check_circle_rounded,
                  size: 17,
                  color: AppColors.primary,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultsHeading extends StatelessWidget {
  const _ResultsHeading({
    required this.label,
    required this.total,
    required this.loading,
  });

  final String label;
  final int total;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 27,
          height: 27,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(9),
          ),
          child: const Icon(
            Icons.auto_awesome_rounded,
            size: 11,
            color: AppColors.primaryDark,
          ),
        ),
        const SizedBox(width: 7),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'CURRENT VIEW',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 5.2,
                fontWeight: FontWeight.w900,
                letterSpacing: .5,
              ),
            ),
            const SizedBox(height: 1),
            Text(
              label,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 8,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 13,
            height: 13,
            child: CircularProgressIndicator(
              strokeWidth: 1.6,
              color: AppColors.primary,
            ),
          )
        else
          Container(
            height: 27,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .66),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: AppColors.primaryDark.withValues(alpha: .045),
              ),
            ),
            child: Text(
              '$total ${total == 1 ? 'idea' : 'ideas'}',
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 6.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
      ],
    );
  }
}

class _LibraryIdeaCard extends StatelessWidget {
  const _LibraryIdeaCard({
    required this.idea,
    required this.tab,
    required this.index,
    required this.onTap,
    required this.onFavorite,
    required this.onDelete,
  });

  final IdeaSummary idea;
  final int tab;
  final int index;
  final VoidCallback onTap;
  final VoidCallback? onFavorite;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final appearance = _appearance();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .055),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .035),
                blurRadius: 15,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 3,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Color(0xFFD894A8),
                        Color(0xFF5FB9B3),
                        Color(0xFFA9D2C7),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(13, 11, 11, 11),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          _IdeaStatusBadge(
                            icon: appearance.icon,
                            label: appearance.label,
                            accent: appearance.accent,
                            tint: appearance.tint,
                          ),
                          const Spacer(),
                          if (onFavorite != null)
                            _CardIconAction(
                              tooltip: idea.isFavorite
                                  ? 'Remove favorite'
                                  : 'Add favorite',
                              icon: idea.isFavorite
                                  ? Icons.favorite_rounded
                                  : Icons.favorite_border_rounded,
                              color: idea.isFavorite
                                  ? AppColors.pinkDeep
                                  : AppColors.textMuted,
                              onTap: onFavorite!,
                            )
                          else if (idea.isFavorite)
                            const _CardStaticIcon(
                              icon: Icons.favorite_rounded,
                              color: AppColors.pinkDeep,
                            ),
                          if (onDelete != null) ...[
                            const SizedBox(width: 3),
                            PopupMenuButton<String>(
                              tooltip: 'Idea actions',
                              padding: EdgeInsets.zero,
                              iconSize: 17,
                              icon: const Icon(
                                Icons.more_horiz_rounded,
                                color: AppColors.textMuted,
                              ),
                              onSelected: (value) {
                                if (value == 'delete') onDelete!();
                              },
                              itemBuilder: (_) => const [
                                PopupMenuItem(
                                  value: 'delete',
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.delete_outline_rounded,
                                        size: 16,
                                        color: AppColors.danger,
                                      ),
                                      SizedBox(width: 8),
                                      Text('Delete idea'),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 9),
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
                              Icons.auto_awesome_rounded,
                              size: 14,
                              color: AppColors.primaryDark,
                            ),
                          ),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(
                              idea.domainName.isEmpty
                                  ? 'General'
                                  : idea.domainName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 8.2,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        idea.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 15,
                          height: 1.16,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.12,
                        ),
                      ),
                      if (idea.abstractText.trim().isNotEmpty) ...[
                        const SizedBox(height: 7),
                        Text(
                          idea.abstractText,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.9,
                            height: 1.48,
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.fromLTRB(9, 7, 6, 7),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            begin: Alignment.centerLeft,
                            end: Alignment.centerRight,
                            colors: [Color(0xFFFFF3F6), Color(0xFFF2F9F7)],
                          ),
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.calendar_today_outlined,
                              size: 11.5,
                              color: idea.createdAt == null
                                  ? AppColors.textMuted
                                  : AppColors.pinkDeep,
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: Text(
                                idea.createdAt == null
                                    ? 'Saved in your library'
                                    : _formatCardDate(idea.createdAt!),
                                style: const TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 7.3,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: onTap,
                                borderRadius: BorderRadius.circular(9),
                                child: const Padding(
                                  padding: EdgeInsets.symmetric(
                                    horizontal: 7,
                                    vertical: 6,
                                  ),
                                  child: Row(
                                    children: [
                                      Text(
                                        'Open idea',
                                        style: TextStyle(
                                          color: AppColors.primaryDark,
                                          fontSize: 8,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      SizedBox(width: 4),
                                      Icon(
                                        Icons.north_east_rounded,
                                        size: 12,
                                        color: AppColors.primaryDark,
                                      ),
                                    ],
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
              ],
            ),
          ),
        ),
      ),
    );
  }

  _IdeaAppearance _appearance() {
    if (tab == 3) {
      return const _IdeaAppearance(
        label: 'Published',
        icon: Icons.public_rounded,
        accent: AppColors.primaryDark,
        tint: AppColors.primarySoft,
      );
    }
    if (tab == 4) {
      return const _IdeaAppearance(
        label: 'Accepted',
        icon: Icons.handshake_outlined,
        accent: AppColors.success,
        tint: Color(0xFFEAF8F2),
      );
    }
    if (tab == 5) {
      return const _IdeaAppearance(
        label: 'Favorite',
        icon: Icons.favorite_rounded,
        accent: AppColors.pinkDeep,
        tint: AppColors.pinkSoft,
      );
    }
    if (idea.isUnlocked) {
      return const _IdeaAppearance(
        label: 'Unlocked',
        icon: Icons.lock_open_rounded,
        accent: AppColors.primaryDark,
        tint: AppColors.primarySoft,
      );
    }
    if (idea.isPremiumGenerated) {
      return const _IdeaAppearance(
        label: 'Premium idea',
        icon: Icons.auto_awesome_rounded,
        accent: AppColors.primaryDark,
        tint: AppColors.primarySoft,
      );
    }
    return const _IdeaAppearance(
      label: 'Free idea',
      icon: Icons.eco_outlined,
      accent: AppColors.primaryDark,
      tint: AppColors.primarySoft,
    );
  }
}

class _IdeaAppearance {
  const _IdeaAppearance({
    required this.label,
    required this.icon,
    required this.accent,
    required this.tint,
  });

  final String label;
  final IconData icon;
  final Color accent;
  final Color tint;
}

class _IdeaStatusBadge extends StatelessWidget {
  const _IdeaStatusBadge({
    required this.icon,
    required this.label,
    required this.accent,
    required this.tint,
  });

  final IconData icon;
  final String label;
  final Color accent;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: accent.withValues(alpha: .075)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10.5, color: accent),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: accent,
              fontSize: 6.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _CardIconAction extends StatelessWidget {
  const _CardIconAction({
    required this.tooltip,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Ink(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .70),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 15, color: color),
          ),
        ),
      ),
    );
  }
}

class _CardStaticIcon extends StatelessWidget {
  const _CardStaticIcon({required this.icon, required this.color});

  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 31,
      height: 31,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .70),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(icon, size: 15, color: color),
    );
  }
}

class _Pagination extends StatelessWidget {
  const _Pagination({
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
      height: 51,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFF4FAF8), AppColors.surfaceRose],
        ),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .055),
        ),
      ),
      child: Row(
        children: [
          _PaginationButton(
            icon: Icons.chevron_left_rounded,
            onTap: onPrevious,
          ),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'LIBRARY PAGE',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 5.4,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .54,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$page of $totalPages',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.6,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          _PaginationButton(icon: Icons.chevron_right_rounded, onTap: onNext),
        ],
      ),
    );
  }
}

class _PaginationButton extends StatelessWidget {
  const _PaginationButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(11),
        child: Ink(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: onTap == null
                ? AppColors.primarySoft.withValues(alpha: .50)
                : AppColors.primary,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(
            icon,
            size: 19,
            color: onTap == null ? AppColors.silver : Colors.white,
          ),
        ),
      ),
    );
  }
}

class _DeleteIdeaSheet extends StatelessWidget {
  const _DeleteIdeaSheet({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(9, 0, 9, 9),
        padding: const EdgeInsets.fromLTRB(15, 10, 15, 15),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.surface, AppColors.surfaceRose],
          ),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .14),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.silver,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(height: 14),
            Container(
              width: 47,
              height: 47,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pinkSoft,
              ),
              child: const Icon(
                Icons.delete_outline_rounded,
                size: 21,
                color: AppColors.danger,
              ),
            ),
            const SizedBox(height: 9),
            const Text(
              'Delete this idea?',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              '“$title” and its private workspace will be permanently removed.',
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 8.4,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 13),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Keep idea'),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(true),
                    icon: const Icon(Icons.delete_outline_rounded, size: 14),
                    label: const Text('Delete'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.danger,
                    ),
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

class _DateRangeResult {
  const _DateRangeResult({required this.from, required this.to});

  final DateTime? from;
  final DateTime? to;
}

class _DateRangeSheet extends StatefulWidget {
  const _DateRangeSheet({required this.initialFrom, required this.initialTo});

  final DateTime? initialFrom;
  final DateTime? initialTo;

  @override
  State<_DateRangeSheet> createState() => _DateRangeSheetState();
}

class _DateRangeSheetState extends State<_DateRangeSheet> {
  DateTime? _from;
  DateTime? _to;
  late DateTime _month;

  bool _selectingFrom = true;

  DateTime get _today => _dateOnly(DateTime.now())!;

  DateTime get _latest => _today.add(const Duration(days: 1));

  DateTime get _firstAllowed => DateTime(2020, 1, 1);

  @override
  void initState() {
    super.initState();

    _from = _dateOnly(widget.initialFrom);
    _to = _dateOnly(widget.initialTo);

    final anchor = _from ?? _to ?? DateTime.now();
    _month = DateTime(anchor.year, anchor.month);

    _selectingFrom = _from == null || _to != null;
  }

  void _selectDate(DateTime date) {
    if (date.isBefore(_firstAllowed) || date.isAfter(_latest)) {
      return;
    }

    setState(() {
      if (_selectingFrom) {
        _from = date;

        if (_to != null && _to!.isBefore(date)) {
          _to = null;
        }

        _selectingFrom = false;
      } else {
        if (_from == null) {
          _from = date;
          _selectingFrom = false;
        } else if (date.isBefore(_from!)) {
          _from = date;
          _to = null;
          _selectingFrom = false;
        } else {
          _to = date;
          _selectingFrom = true;
        }
      }
    });
  }

  void _presetLast7Days() {
    final to = _today;

    setState(() {
      _to = to;
      _from = to.subtract(const Duration(days: 6));
      _month = DateTime(to.year, to.month);
      _selectingFrom = true;
    });
  }

  void _presetLast30Days() {
    final to = _today;

    setState(() {
      _to = to;
      _from = to.subtract(const Duration(days: 29));
      _month = DateTime(to.year, to.month);
      _selectingFrom = true;
    });
  }

  void _presetThisMonth() {
    final now = _today;

    setState(() {
      _from = DateTime(now.year, now.month, 1);
      _to = now;
      _month = DateTime(now.year, now.month);
      _selectingFrom = true;
    });
  }

  void _previousMonth() {
    final previous = DateTime(_month.year, _month.month - 1);

    if (previous.isBefore(DateTime(_firstAllowed.year, _firstAllowed.month))) {
      return;
    }

    setState(() => _month = previous);
  }

  void _nextMonth() {
    final next = DateTime(_month.year, _month.month + 1);

    final latestMonth = DateTime(_latest.year, _latest.month);

    if (next.isAfter(latestMonth)) return;

    setState(() => _month = next);
  }

  bool _sameDay(DateTime? a, DateTime? b) {
    if (a == null || b == null) return false;

    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  bool _insideRange(DateTime day) {
    if (_from == null || _to == null) {
      return false;
    }

    return day.isAfter(_from!) && day.isBefore(_to!);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SafeArea(
        top: false,
        child: Container(
          margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .88,
          ),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                Color(0xFFF2F9F7),
                AppColors.surfaceRose,
              ],
            ),
            borderRadius: BorderRadius.circular(25),
            border: Border.all(color: Colors.white),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .15),
                blurRadius: 34,
                offset: const Offset(0, 13),
              ),
            ],
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.silver,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),

                const SizedBox(height: 13),

                const Row(
                  children: [
                    SoftIconBadge(icon: Icons.date_range_outlined, size: 39),
                    SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'DATE RANGE',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 6.2,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .68,
                            ),
                          ),
                          SizedBox(height: 3),
                          Text(
                            'Filter your idea library',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Choose a start and end date without leaving the library.',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 7.6,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 13),

                Row(
                  children: [
                    Expanded(
                      child: _DateSelectionTile(
                        label: 'FROM',
                        value: _formatCompactDate(
                          _from,
                          fallback: 'Choose date',
                        ),
                        selected: _selectingFrom,
                        rose: false,
                        onTap: () => setState(() => _selectingFrom = true),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: _DateSelectionTile(
                        label: 'TO',
                        value: _formatCompactDate(_to, fallback: 'Choose date'),
                        selected: !_selectingFrom,
                        rose: true,
                        onTap: () => setState(() => _selectingFrom = false),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 10),

                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _PresetChip(
                        label: 'Last 7 days',
                        onTap: _presetLast7Days,
                      ),
                      const SizedBox(width: 6),
                      _PresetChip(
                        label: 'Last 30 days',
                        onTap: _presetLast30Days,
                      ),
                      const SizedBox(width: 6),
                      _PresetChip(label: 'This month', onTap: _presetThisMonth),
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                Container(
                  padding: const EdgeInsets.fromLTRB(10, 10, 10, 11),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .68),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: AppColors.primaryDark.withValues(alpha: .05),
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _CalendarArrow(
                            icon: Icons.chevron_left_rounded,
                            onTap: _previousMonth,
                          ),
                          Expanded(
                            child: Column(
                              children: [
                                Text(
                                  _monthTitle(_month),
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _selectingFrom
                                      ? 'Choose start date'
                                      : 'Choose end date',
                                  style: TextStyle(
                                    color: _selectingFrom
                                        ? AppColors.primaryDark
                                        : AppColors.pinkDeep,
                                    fontSize: 6.4,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _CalendarArrow(
                            icon: Icons.chevron_right_rounded,
                            onTap: _nextMonth,
                          ),
                        ],
                      ),

                      const SizedBox(height: 10),

                      const Row(
                        children: [
                          _WeekLabel('S'),
                          _WeekLabel('M'),
                          _WeekLabel('T'),
                          _WeekLabel('W'),
                          _WeekLabel('T'),
                          _WeekLabel('F'),
                          _WeekLabel('S'),
                        ],
                      ),

                      const SizedBox(height: 4),

                      _CalendarGrid(
                        month: _month,
                        firstAllowed: _firstAllowed,
                        latest: _latest,
                        from: _from,
                        to: _to,
                        onTap: _selectDate,
                        sameDay: _sameDay,
                        insideRange: _insideRange,
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 11),

                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () {
                          setState(() {
                            _from = null;
                            _to = null;
                            _selectingFrom = true;
                          });
                        },
                        child: const Text('Clear'),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      flex: 2,
                      child: FilledButton.icon(
                        onPressed: () => Navigator.of(
                          context,
                        ).pop(_DateRangeResult(from: _from, to: _to)),
                        icon: const Icon(Icons.check_rounded, size: 14),
                        label: const Text('Apply date range'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(43),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
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

class _DateSelectionTile extends StatelessWidget {
  const _DateSelectionTile({
    required this.label,
    required this.value,
    required this.selected,
    required this.rose,
    required this.onTap,
  });

  final String label;
  final String value;
  final bool selected;
  final bool rose;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          height: 58,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: selected
                ? (rose ? AppColors.pinkSoft : AppColors.primarySoft)
                : Colors.white.withValues(alpha: .65),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? accent.withValues(alpha: .24)
                  : AppColors.primaryDark.withValues(alpha: .045),
              width: selected ? 1.2 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                rose
                    ? Icons.event_available_outlined
                    : Icons.calendar_month_outlined,
                size: 15,
                color: accent,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: accent,
                        fontSize: 5.7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .56,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      value,
                      maxLines: 1,
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
              if (selected) Icon(Icons.circle, size: 6, color: accent),
            ],
          ),
        ),
      ),
    );
  }
}

class _PresetChip extends StatelessWidget {
  const _PresetChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Ink(
          height: 31,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: AppColors.primarySoft.withValues(alpha: .68),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .045),
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 6.7,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CalendarArrow extends StatelessWidget {
  const _CalendarArrow({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Ink(
          width: 33,
          height: 33,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 18, color: AppColors.primaryDark),
        ),
      ),
    );
  }
}

class _WeekLabel extends StatelessWidget {
  const _WeekLabel(this.value);

  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Text(
        value,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: AppColors.textMuted,
          fontSize: 6.6,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _CalendarGrid extends StatelessWidget {
  const _CalendarGrid({
    required this.month,
    required this.firstAllowed,
    required this.latest,
    required this.from,
    required this.to,
    required this.onTap,
    required this.sameDay,
    required this.insideRange,
  });

  final DateTime month;
  final DateTime firstAllowed;
  final DateTime latest;
  final DateTime? from;
  final DateTime? to;
  final ValueChanged<DateTime> onTap;
  final bool Function(DateTime?, DateTime?) sameDay;
  final bool Function(DateTime) insideRange;

  @override
  Widget build(BuildContext context) {
    final first = DateTime(month.year, month.month, 1);

    final leading = first.weekday % 7;

    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;

    final cells = ((leading + daysInMonth + 6) ~/ 7) * 7;

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cells,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 7,
        mainAxisExtent: 36,
      ),
      itemBuilder: (context, index) {
        final dayNumber = index - leading + 1;

        if (dayNumber < 1 || dayNumber > daysInMonth) {
          return const SizedBox.shrink();
        }

        final day = DateTime(month.year, month.month, dayNumber);

        final disabled = day.isBefore(firstAllowed) || day.isAfter(latest);

        final isFrom = sameDay(day, from);
        final isTo = sameDay(day, to);
        final inRange = insideRange(day);
        final edge = isFrom || isTo;

        return Center(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: disabled ? null : () => onTap(day),
              borderRadius: BorderRadius.circular(11),
              child: Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: edge
                      ? LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: isTo
                              ? const [AppColors.pink, AppColors.pinkDeep]
                              : const [AppColors.primary, Color(0xFF4FA9A4)],
                        )
                      : null,
                  color: edge
                      ? null
                      : inRange
                      ? AppColors.primarySoft
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Text(
                  '$dayNumber',
                  style: TextStyle(
                    color: disabled
                        ? AppColors.silver
                        : edge
                        ? Colors.white
                        : inRange
                        ? AppColors.primaryDark
                        : AppColors.textSecondary,
                    fontSize: 7.4,
                    fontWeight: edge || inRange
                        ? FontWeight.w900
                        : FontWeight.w700,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

DateTime? _dateOnly(DateTime? value) {
  if (value == null) return null;

  return DateTime(value.year, value.month, value.day);
}

String _monthTitle(DateTime value) {
  const months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return '${months[value.month - 1]} ${value.year}';
}

String _formatShortDate(DateTime? value, {required String fallback}) {
  if (value == null) return fallback;
  const months = <String>[
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
  return '${months[value.month - 1]} ${value.day}';
}

String _formatCompactDate(DateTime? value, {required String fallback}) {
  if (value == null) return fallback;

  const months = <String>[
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

  return '${months[value.month - 1]} ${value.day}, ${value.year}';
}

String _formatCardDate(DateTime value) {
  const months = <String>[
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

  final local = value.toLocal();

  return '${months[local.month - 1]} ${local.day}, ${local.year}';
}
