// Mobile published-ideas workspace with owner moderation controls.
// Mirrors the main web actions while keeping the layout compact for phones.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';
import 'idea_workspace_page.dart';
import 'publish_idea_page.dart';

class PublishedPage extends StatefulWidget {
  const PublishedPage({super.key});

  @override
  State<PublishedPage> createState() => _PublishedPageState();
}

class _PublishedPageState extends State<PublishedPage> {
  final _searchInput = TextEditingController();

  bool _loading = true;
  String? _error;
  String _filter = 'ALL';
  String _search = '';
  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  List<Map<String, dynamic>> _items = const [];
  String? _busyIdeaId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchInput.dispose();
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
      final result = await UserApi.instance.getPublishedRaw(
        page: _page,
        limit: 9,
        search: _search,
        status: _filter == 'ALL' ? null : _filter,
        force: force,
      );
      if (!mounted) return;
      setState(() {
        _items = result.items;
        _total = result.total;
        _totalPages = result.totalPages < 1 ? 1 : result.totalPages;
        if (_page > _totalPages) _page = _totalPages;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _submitSearch() {
    final next = _searchInput.text.trim();
    if (_search == next && _page == 1) return;
    setState(() {
      _search = next;
      _page = 1;
    });
    _load();
  }

  void _changeFilter(String value) {
    if (_filter == value) return;
    setState(() {
      _filter = value;
      _page = 1;
    });
    _load();
  }

  void _changePage(int next) {
    if (next < 1 || next > _totalPages || next == _page) return;
    setState(() => _page = next);
    _load();
  }

  Future<void> _runOwnerAction(Map<String, dynamic> item, String action) async {
    final ideaId = _ideaId(item);
    if (ideaId.isEmpty || _busyIdeaId != null) return;
    setState(() => _busyIdeaId = ideaId);
    try {
      if (action == 'archive') {
        await UserApi.instance.archivePublication(ideaId);
      } else if (action == 'repost') {
        await UserApi.instance.repostPublication(ideaId);
      } else if (action == 'adoption') {
        await UserApi.instance.updatePublicationAcceptanceSetting(
          ideaId,
          !_allowAdoption(item),
        );
      }
      await _load(force: true);
      if (mounted) showAppSnackBar(context, 'Publication updated.');
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busyIdeaId = null);
    }
  }

  Future<void> _showFeedback(Map<String, dynamic> item) async {
    final publicationId = _publicationId(item);
    if (publicationId.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) =>
          _FeedbackSheet(publicationId: publicationId, publication: item),
    );
  }

  void _backToProfile() {
    returnFromWorkspacePage(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _PublishedRouteHeader(
            onBack: _backToProfile,
          ),
          Expanded(
            child: WorkspaceBackground(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () => _load(force: true),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(15, 13, 15, 42),
                  children: [
                    _PublishedHero(
                      total: _total,
                      filter: _filter,
                    ),
                    const SizedBox(height: 13),
                    Container(
                      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .76),
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(
                          color: AppColors.border.withValues(alpha: .72),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDeep.withValues(alpha: .035),
                            blurRadius: 20,
                            offset: const Offset(0, 7),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.fromLTRB(4, 1, 4, 8),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.tune_rounded,
                                  size: 13,
                                  color: AppColors.primaryDark,
                                ),
                                SizedBox(width: 6),
                                Text(
                                  'SEARCH & FILTER',
                                  style: TextStyle(
                                    color: AppColors.primaryDark,
                                    fontSize: 7.1,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: .9,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _PublishedSearch(
                            controller: _searchInput,
                            onSubmitted: (_) => _submitSearch(),
                            onSearch: _submitSearch,
                          ),
                          const SizedBox(height: 8),
                          _FilterBar(
                            value: _filter,
                            onChanged: _changeFilter,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    _PublishedResultsHeading(
                      filter: _filter,
                      total: _total,
                      loading: _loading,
                    ),
                    const SizedBox(height: 9),
                    if (_error != null)
                      InlineNotice(
                        icon: Icons.cloud_off_rounded,
                        title: 'Could not load publications',
                        message: _error!,
                        actionLabel: 'Retry',
                        onAction: () => _load(force: true),
                      ),
                    if (_loading && _items.isEmpty) ...[
                      const LoadingList(count: 4),
                    ] else if (!_loading && _items.isEmpty) ...[
                      EmptyState(
                        icon: Icons.public_off_outlined,
                        title: _filter == 'ARCHIVED'
                            ? 'No archived publications'
                            : _filter == 'PUBLISHED'
                                ? 'No live publications'
                                : 'No publications yet',
                        message: _filter == 'ARCHIVED'
                            ? 'Stopped publications stay here with their engagement history.'
                            : 'Publish a completed idea to start receiving community activity.',
                      ),
                    ] else
                      ..._items.asMap().entries.map(
                        (entry) {
                          final item = entry.value;

                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: _PublicationCard(
                              index: entry.key,
                              item: item,
                              busy: _busyIdeaId == _ideaId(item),
                            onOpenWorkspace: () {
                              final ideaId = _ideaId(item);
                              if (ideaId.isEmpty) return;

                              Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => IdeaWorkspacePage(
                                    ideaId: ideaId,
                                    returnTitle: 'Published ideas',
                                  ),
                                ),
                              );
                            },
                            onFeedback: () => _showFeedback(item),
                            onEdit: () {
                              final ideaId = _ideaId(item);
                              if (ideaId.isEmpty) return;

                              Navigator.of(context)
                                  .push(
                                    MaterialPageRoute<void>(
                                      builder: (_) => PublishIdeaPage(
                                        ideaId: ideaId,
                                        returnTitle: 'Published ideas',
                                        initialIdea: _publicationStudioSeed(item),
                                      ),
                                    ),
                                  )
                                  .then((_) => _load(force: true));
                            },
                            onArchive: () =>
                                _runOwnerAction(item, 'archive'),
                            onRepost: () =>
                                _runOwnerAction(item, 'repost'),
                              onToggleAdoption: () =>
                                  _runOwnerAction(item, 'adoption'),
                            ),
                          );
                        },
                      ),
                    if (!_loading &&
                        _items.isNotEmpty &&
                        _totalPages > 1) ...[
                      const SizedBox(height: 3),
                      _PublishedPagination(
                        page: _page,
                        totalPages: _totalPages,
                        onPrevious: _page > 1
                            ? () => _changePage(_page - 1)
                            : null,
                        onNext: _page < _totalPages
                            ? () => _changePage(_page + 1)
                            : null,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PublishedRouteHeader extends StatelessWidget {
  const _PublishedRouteHeader({
    required this.onBack,
  });

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final returnTitle = workspaceReturnTarget(context).title;

    return Material(
      color: AppColors.surface.withValues(alpha: .985),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 6, 18, 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.border.withValues(alpha: .62),
              ),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .025),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onBack,
                  borderRadius: BorderRadius.circular(14),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons.arrow_back_rounded,
                        size: 26,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 18.5,
                          height: 1.08,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.28,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Published ideas',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.6,
                          height: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
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

class _PublishedHero extends StatelessWidget {
  const _PublishedHero({
    required this.total,
    required this.filter,
  });

  final int total;
  final String filter;

  @override
  Widget build(BuildContext context) {
    final statLabel = switch (filter) {
      'PUBLISHED' => 'currently live',
      'ARCHIVED' => 'stopped',
      _ => 'matching records',
    };

    final statIcon = filter == 'ARCHIVED'
        ? Icons.inventory_2_outlined
        : Icons.bar_chart_rounded;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        border: Border.all(
          color: AppColors.primaryDeep.withValues(alpha: .075),
        ),
        color: const Color(0xFFFFFEFD),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 30,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Colors.white,
                    AppColors.primarySoft.withValues(alpha: .28),
                    AppColors.surfaceRose.withValues(alpha: .42),
                  ],
                  stops: const [0, .64, 1],
                ),
              ),
            ),
          ),
          Positioned(
            right: -58,
            top: -62,
            child: Container(
              width: 168,
              height: 168,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: .085),
                ),
              ),
            ),
          ),
          Positioned(
            right: 18,
            bottom: -40,
            child: Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .045),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(17, 17, 17, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .78),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: .12),
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.send_rounded,
                        size: 12,
                        color: AppColors.primaryDark,
                      ),
                      SizedBox(width: 6),
                      Text(
                        'CREATOR PUBLISHING DESK',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 6.8,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .95,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 13),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Publication history,',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 22.2,
                              height: 1.02,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -.58,
                            ),
                          ),
                          SizedBox(height: 3),
                          Text(
                            'community signals.',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 22.2,
                              height: 1.02,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.62,
                            ),
                          ),
                          SizedBox(height: 10),
                          Text(
                            'Manage live and stopped publications without losing ratings, votes, feedback, accepted-user access, or owner-only insights.',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 8.8,
                              height: 1.45,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 11),
                    Container(
                      width: 88,
                      padding: const EdgeInsets.fromLTRB(9, 10, 9, 9),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .84),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: .95),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDeep.withValues(alpha: .06),
                            blurRadius: 17,
                            offset: const Offset(0, 7),
                          ),
                        ],
                      ),
                      child: Column(
                        children: [
                          Container(
                            width: 31,
                            height: 31,
                            decoration: BoxDecoration(
                              color: AppColors.primarySoft,
                              borderRadius: BorderRadius.circular(11),
                            ),
                            child: Icon(
                              statIcon,
                              size: 16,
                              color: AppColors.primaryDark,
                            ),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            '$total',
                            style: const TextStyle(
                              color: AppColors.primaryDeep,
                              fontSize: 20,
                              height: 1,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            statLabel,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 6.2,
                              height: 1.18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 13),
                const Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    _PublishedHeroChip(
                      icon: Icons.trending_up_rounded,
                      label: 'Persistent engagement history',
                    ),
                    _PublishedHeroChip(
                      icon: Icons.auto_awesome_rounded,
                      label: 'Re-publish anytime',
                      rose: true,
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

class _PublishedHeroChip extends StatelessWidget {
  const _PublishedHeroChip({
    required this.icon,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final foreground = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.surfaceRose.withValues(alpha: .72)
            : AppColors.primarySoft.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: foreground.withValues(alpha: .08),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: foreground),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 6.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublishedSearch extends StatelessWidget {
  const _PublishedSearch({
    required this.controller,
    required this.onSubmitted,
    required this.onSearch,
  });

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(5, 4, 5, 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .70),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.primary.withValues(alpha: .10)),
      ),
      child: TextField(
        controller: controller,
        textInputAction: TextInputAction.search,
        onSubmitted: onSubmitted,
        decoration: InputDecoration(
          hintText: 'Search your publication history…',
          prefixIcon: const Icon(
            Icons.search_rounded,
            size: 18,
            color: AppColors.primaryDark,
          ),
          suffixIcon: IconButton(
            tooltip: 'Search',
            onPressed: onSearch,
            icon: const Icon(
              Icons.arrow_forward_rounded,
              size: 17,
              color: AppColors.primaryDark,
            ),
          ),
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 11),
        ),
      ),
    );
  }
}

class _PublishedResultsHeading extends StatelessWidget {
  const _PublishedResultsHeading({
    required this.filter,
    required this.total,
    required this.loading,
  });

  final String filter;
  final int total;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final label = switch (filter) {
      'PUBLISHED' => 'LIVE PUBLICATIONS',
      'ARCHIVED' => 'ARCHIVED PUBLICATIONS',
      _ => 'PUBLICATION HISTORY',
    };
    return Row(
      children: [
        const Icon(
          Icons.auto_awesome_rounded,
          size: 10,
          color: AppColors.primaryDark,
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: const TextStyle(
            color: AppColors.primaryDark,
            fontSize: 6.1,
            fontWeight: FontWeight.w900,
            letterSpacing: .68,
          ),
        ),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 13,
            height: 13,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: AppColors.primary,
            ),
          )
        else
          Text(
            '$total ${total == 1 ? 'publication' : 'publications'}',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7,
              fontWeight: FontWeight.w800,
            ),
          ),
      ],
    );
  }
}

class _PublishedPagination extends StatelessWidget {
  const _PublishedPagination({
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
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .68),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .045),
        ),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onPrevious,
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          Expanded(
            child: Text(
              'Page $page of $totalPages',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          IconButton(
            onPressed: onNext,
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    const items = <(String value, String label, IconData icon)>[
      ('ALL', 'All', Icons.grid_view_rounded),
      ('PUBLISHED', 'Live', Icons.public_rounded),
      ('ARCHIVED', 'Archived', Icons.inventory_2_outlined),
    ];

    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .68),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .045),
        ),
      ),
      child: Row(
        children: items.map((item) {
          final active = value == item.$1;
          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: item.$1 == 'ARCHIVED' ? 0 : 5),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => onChanged(item.$1),
                  borderRadius: BorderRadius.circular(12),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 170),
                    height: 41,
                    decoration: BoxDecoration(
                      color: active
                          ? AppColors.primarySoft
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: active
                            ? AppColors.primary.withValues(alpha: .16)
                            : Colors.transparent,
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          item.$3,
                          size: 13,
                          color: active
                              ? AppColors.primaryDark
                              : AppColors.textMuted,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          item.$2,
                          style: TextStyle(
                            color: active
                                ? AppColors.primaryDark
                                : AppColors.textSecondary,
                            fontSize: 7.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
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

class _PublicationCard extends StatelessWidget {
  const _PublicationCard({
    required this.index,
    required this.item,
    required this.busy,
    required this.onOpenWorkspace,
    required this.onFeedback,
    required this.onEdit,
    required this.onArchive,
    required this.onRepost,
    required this.onToggleAdoption,
  });

  final int index;
  final Map<String, dynamic> item;
  final bool busy;
  final VoidCallback onOpenWorkspace;
  final VoidCallback onFeedback;
  final VoidCallback onEdit;
  final VoidCallback onArchive;
  final VoidCallback onRepost;
  final VoidCallback onToggleAdoption;

  @override
  Widget build(BuildContext context) {
    final status = _status(item);
    final archived = status == 'ARCHIVED';
    final title = _title(item);
    final abstract = _abstract(item);

    final palette = _publicationPalette(
      index,
      archived: archived,
    );

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            const Color(0xFFFFFEFD),
            palette.soft,
            const Color(0xFFFFFBFC),
          ],
          stops: const [0, .72, 1],
        ),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(
          color: palette.a.withValues(alpha: .12),
        ),
        boxShadow: [
          BoxShadow(
            color: palette.a.withValues(alpha: .075),
            blurRadius: 25,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Stack(
            children: [
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: 94,
                child: _PublicationSignalRail(
                  archived: archived,
                  palette: palette,
                  date: _friendlyActivityDate(
                    archived ? item['archivedAt'] : item['publishedAt'],
                  ),
                ),
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 194),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(109, 13, 12, 13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Wrap(
                              spacing: 5,
                              runSpacing: 5,
                              children: [
                                _PublicationSignalChip(
                                  icon: Icons.visibility_outlined,
                                  label: _visibility(item),
                                ),
                                _PublicationSignalChip(
                                  icon: archived
                                      ? Icons.inventory_2_outlined
                                      : Icons.bar_chart_rounded,
                                  label: archived ? 'Stopped' : 'Published',
                                  positive: !archived,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 4),
                          SizedBox(
                            width: 30,
                            height: 30,
                            child: PopupMenuButton<String>(
                              enabled: !busy,
                              tooltip: 'Publication actions',
                              padding: EdgeInsets.zero,
                              iconSize: 19,
                              icon: const Icon(
                                Icons.more_horiz_rounded,
                                color: AppColors.textMuted,
                              ),
                              onSelected: (value) {
                                if (value == 'workspace') {
                                  onOpenWorkspace();
                                }
                                if (value == 'adoption') {
                                  onToggleAdoption();
                                }
                              },
                              itemBuilder: (_) => [
                                const PopupMenuItem(
                                  value: 'workspace',
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.dashboard_customize_outlined,
                                        size: 18,
                                      ),
                                      SizedBox(width: 9),
                                      Text('Idea workspace'),
                                    ],
                                  ),
                                ),
                                PopupMenuItem(
                                  value: 'adoption',
                                  child: Row(
                                    children: [
                                      Icon(
                                        _allowAdoption(item)
                                            ? Icons.lock_outline_rounded
                                            : Icons.volunteer_activism_outlined,
                                        size: 18,
                                      ),
                                      const SizedBox(width: 9),
                                      Text(
                                        _allowAdoption(item)
                                            ? 'Disable acceptance'
                                            : 'Allow acceptance',
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (_allowAdoption(item)) ...[
                        const SizedBox(height: 6),
                        const _PublicationSignalChip(
                          icon: Icons.handshake_outlined,
                          label: 'Acceptance on',
                          positive: true,
                        ),
                      ],
                      const SizedBox(height: 12),
                      const Row(
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 9.5,
                            color: AppColors.primaryDark,
                          ),
                          SizedBox(width: 4),
                          Text(
                            'PUBLIC COMMUNITY IDEA',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 5.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .64,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        title,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13.4,
                          height: 1.10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.24,
                        ),
                      ),
                      if (abstract.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          abstract,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            height: 1.38,
                            fontSize: 7.8,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _PublicationMetricPill(
                  icon: Icons.star_outline_rounded,
                  value: _rating(item),
                  suffix: '${_number(item, const ['ratingsCount'])} ratings',
                  tone: _MetricTone.rating,
                ),
                _PublicationMetricPill(
                  icon: Icons.thumb_up_alt_outlined,
                  value:
                      '${_number(item, const ['upvotesCount', 'upvoteCount', 'upvotes'])}',
                  suffix: 'up',
                  tone: _MetricTone.positive,
                ),
                _PublicationMetricPill(
                  icon: Icons.thumb_down_alt_outlined,
                  value:
                      '${_number(item, const ['downvotesCount', 'downvoteCount', 'downvotes'])}',
                  suffix: 'down',
                  tone: _MetricTone.neutral,
                ),
                _PublicationMetricPill(
                  icon: Icons.chat_bubble_outline_rounded,
                  value: '${_number(item, const ['feedbackCount'])}',
                  suffix: 'reviews',
                  tone: _MetricTone.neutral,
                ),
                _PublicationMetricPill(
                  icon: Icons.group_outlined,
                  value:
                      '${_number(item, const ['acceptanceCount', 'acceptedCount'])}',
                  suffix: 'accepted',
                  tone: _MetricTone.positive,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
            child: Row(
              children: [
                Expanded(
                  flex: archived ? 1 : 11,
                  child: _PublicationActionButton(
                    label: 'Audience',
                    icon: Icons.insights_outlined,
                    onTap: busy ? null : onFeedback,
                    filled: true,
                    busy: busy,
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  flex: archived ? 1 : 10,
                  child: _PublicationActionButton(
                    label: archived ? 'Re-publish' : 'Edit',
                    icon: archived
                        ? Icons.refresh_rounded
                        : Icons.edit_outlined,
                    onTap: busy
                        ? null
                        : archived
                            ? onRepost
                            : onEdit,
                  ),
                ),
                if (!archived) ...[
                  const SizedBox(width: 7),
                  Expanded(
                    flex: 10,
                    child: _PublicationActionButton(
                      label: 'Stop',
                      icon: Icons.pause_circle_outline_rounded,
                      onTap: busy ? null : onArchive,
                      danger: true,
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

class _PublicationPalette {
  const _PublicationPalette({
    required this.a,
    required this.b,
    required this.soft,
  });

  final Color a;
  final Color b;
  final Color soft;
}

_PublicationPalette _publicationPalette(
  int index, {
  required bool archived,
}) {
  if (archived) {
    return const _PublicationPalette(
      a: Color(0xFF62746E),
      b: Color(0xFF98AAA3),
      soft: Color(0xFFF4F7F5),
    );
  }

  return switch (index % 4) {
    1 => const _PublicationPalette(
        a: Color(0xFF527D70),
        b: Color(0xFF86B6A2),
        soft: Color(0xFFF4FAF7),
      ),
    2 => const _PublicationPalette(
        a: Color(0xFF577970),
        b: Color(0xFF91B2A7),
        soft: Color(0xFFF3F8F6),
      ),
    3 => const _PublicationPalette(
        a: Color(0xFF617B74),
        b: Color(0xFFA1B9B0),
        soft: Color(0xFFF5F9F7),
      ),
    _ => const _PublicationPalette(
        a: Color(0xFF2F7774),
        b: Color(0xFF62B9B1),
        soft: Color(0xFFF2FAF8),
      ),
  };
}

class _PublicationSignalRail extends StatelessWidget {
  const _PublicationSignalRail({
    required this.archived,
    required this.palette,
    required this.date,
  });

  final bool archived;
  final _PublicationPalette palette;
  final String date;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [palette.a, palette.b],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            left: -34,
            top: 48,
            child: Transform.rotate(
              angle: -.21,
              child: Container(
                width: 160,
                height: 38,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.white.withValues(alpha: .02),
                      Colors.white.withValues(alpha: .13),
                      Colors.white.withValues(alpha: .02),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            right: -37,
            top: -35,
            child: Container(
              width: 108,
              height: 108,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: .14),
                ),
              ),
            ),
          ),
          Positioned(
            left: 14,
            top: 16,
            child: Container(
              width: 43,
              height: 43,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .13),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: Colors.white.withValues(alpha: .21),
                ),
              ),
              child: Icon(
                archived
                    ? Icons.inventory_2_outlined
                    : Icons.bar_chart_rounded,
                color: Colors.white,
                size: 20,
              ),
            ),
          ),
          Positioned(
            left: 13,
            right: 9,
            bottom: 14,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  archived ? 'STOPPED' : 'LIVE',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .98),
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .7,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  archived ? 'PUBLICATION' : 'SIGNAL',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .74),
                    fontSize: 5.9,
                    fontWeight: FontWeight.w800,
                    letterSpacing: .7,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      Icons.calendar_today_outlined,
                      size: 8.2,
                      color: Colors.white.withValues(alpha: .72),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        date,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: .76),
                          fontSize: 5.7,
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
    );
  }
}

enum _MetricTone { neutral, rating, positive, rose }

class _PublicationMetricPill extends StatelessWidget {
  const _PublicationMetricPill({
    required this.icon,
    required this.value,
    required this.suffix,
    required this.tone,
  });

  final IconData icon;
  final String value;
  final String suffix;
  final _MetricTone tone;

  @override
  Widget build(BuildContext context) {
    final foreground = switch (tone) {
      _MetricTone.rating => const Color(0xFF64756F),
      _MetricTone.positive => const Color(0xFF2A7B68),
      _MetricTone.rose => const Color(0xFF687A74),
      _MetricTone.neutral => AppColors.primaryDark,
    };

    final background = switch (tone) {
      _MetricTone.rating => const Color(0xFFF1F6F4),
      _MetricTone.positive => const Color(0xFFEAF7F1),
      _MetricTone.rose => const Color(0xFFF1F5F3),
      _MetricTone.neutral => const Color(0xFFF2F6F4),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: foreground.withValues(alpha: .08),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10.5, color: foreground),
          const SizedBox(width: 4),
          Text(
            value,
            style: TextStyle(
              color: foreground,
              fontSize: 7.9,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            suffix,
            style: TextStyle(
              color: foreground.withValues(alpha: .76),
              fontSize: 5.8,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublicationActionButton extends StatelessWidget {
  const _PublicationActionButton({
    required this.label,
    required this.icon,
    required this.onTap,
    this.filled = false,
    this.danger = false,
    this.busy = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool filled;
  final bool danger;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final foreground = danger
        ? const Color(0xFF7F7376)
        : filled
            ? Colors.white
            : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          height: 42,
          decoration: BoxDecoration(
            gradient: filled
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF65C4BD),
                      Color(0xFF4DA9A4),
                      Color(0xFF418E8A),
                    ],
                  )
                : null,
            color: filled
                ? null
                : danger
                    ? const Color(0xFFF7F9F8)
                    : Colors.white.withValues(alpha: .82),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: danger
                  ? AppColors.sage.withValues(alpha: .28)
                  : filled
                      ? AppColors.primary.withValues(alpha: .12)
                      : AppColors.primary.withValues(alpha: .14),
            ),
            boxShadow: filled
                ? [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: .12),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (busy && filled)
                SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: foreground,
                  ),
                )
              else
                Icon(icon, size: 13, color: foreground),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 7.2,
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

class _PublicationSignalChip extends StatelessWidget {
  const _PublicationSignalChip({
    required this.icon,
    required this.label,
    this.positive = false,
  }) : rose = false;

  final IconData icon;
  final String label;
  final bool rose;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    final foreground = rose
        ? AppColors.textMuted
        : positive
            ? AppColors.success
            : AppColors.primaryDark;

    final background = rose
        ? const Color(0xFFF1F5F3)
        : positive
            ? const Color(0xFFE9F8F0)
            : AppColors.primarySoft.withValues(alpha: .68);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: foreground.withValues(alpha: .08),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 9.5, color: foreground),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 6,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedbackSheet extends StatefulWidget {
  const _FeedbackSheet({
    required this.publicationId,
    required this.publication,
  });

  final String publicationId;
  final Map<String, dynamic> publication;

  @override
  State<_FeedbackSheet> createState() => _FeedbackSheetState();
}

class _FeedbackSheetState extends State<_FeedbackSheet> {
  bool _loading = true;
  String? _error;
  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  Map<String, dynamic> _summary = const {};
  List<Map<String, dynamic>> _responses = const [];

  @override
  void initState() {
    super.initState();
    _summary = widget.publication;
    _load();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final result = await UserApi.instance.getReceivedFeedbackDetails(
        widget.publicationId,
        page: _page,
        limit: 8,
        force: force,
      );

      if (!mounted) return;

      final publication = result['publication'] is Map
          ? Map<String, dynamic>.from(result['publication'] as Map)
          : const <String, dynamic>{};

      final rows = result['data'] is List
          ? result['data'] as List
          : result['responses'] is List
              ? result['responses'] as List
              : result['items'] is List
                  ? result['items'] as List
                  : const <dynamic>[];

      final meta = result['meta'] is Map
          ? Map<String, dynamic>.from(result['meta'] as Map)
          : result['pagination'] is Map
              ? Map<String, dynamic>.from(result['pagination'] as Map)
              : const <String, dynamic>{};

      setState(() {
        _summary = {...widget.publication, ...publication};
        _responses = rows
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
        _total = _toInt(meta['total'] ?? rows.length);
        _totalPages = _toInt(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _changePage(int next) async {
    if (next < 1 || next > _totalPages || next == _page || _loading) return;
    setState(() => _page = next);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final acceptedBy = _summary['acceptedBy'] is List
        ? _summary['acceptedBy'] as List
        : const <dynamic>[];
    final acceptanceCount = _number(
      _summary,
      const ['acceptanceCount', 'acceptedCount'],
    );

    return DraggableScrollableSheet(
      initialChildSize: .92,
      minChildSize: .58,
      maxChildSize: .97,
      expand: false,
      builder: (context, controller) {
        return Container(
          clipBehavior: Clip.antiAlias,
          decoration: const BoxDecoration(
            color: Color(0xFFFFFEFD),
            borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
          ),
          child: Stack(
            children: [
              Positioned(
                right: -62,
                top: -76,
                child: Container(
                  width: 190,
                  height: 190,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.primary.withValues(alpha: .05),
                  ),
                ),
              ),
              Positioned(
                left: -72,
                top: 215,
                child: Container(
                  width: 160,
                  height: 160,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.pink.withValues(alpha: .035),
                  ),
                ),
              ),
              ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 32),
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.silver.withValues(alpha: .78),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Color(0xFF6AC8C0),
                              Color(0xFF3E918D),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: const Icon(
                          Icons.insights_rounded,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 11),
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
                                color: AppColors.primarySoft.withValues(alpha: .72),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Text(
                                'AUDIENCE RESPONSE LEDGER',
                                style: TextStyle(
                                  color: AppColors.primaryDark,
                                  fontSize: 6.2,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: .72,
                                ),
                              ),
                            ),
                            const SizedBox(height: 7),
                            Text(
                              '${_summary['publicTitle'] ?? _title(widget.publication)}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 16.4,
                                height: 1.08,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.28,
                              ),
                            ),
                            const SizedBox(height: 5),
                            const Text(
                              'One owner-only view of ratings, votes, feedback, accepted members, and latest activity.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.4,
                                height: 1.4,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Material(
                        color: AppColors.primarySoft.withValues(alpha: .56),
                        borderRadius: BorderRadius.circular(11),
                        child: InkWell(
                          onTap: () => Navigator.of(context).pop(),
                          borderRadius: BorderRadius.circular(11),
                          child: const SizedBox(
                            width: 34,
                            height: 34,
                            child: Icon(
                              Icons.close_rounded,
                              size: 17,
                              color: AppColors.primaryDark,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 94,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(),
                      children: [
                        _InsightMetric(
                          icon: Icons.star_rounded,
                          value: _metricRating(_summary),
                          label: '${_number(_summary, const ['ratingsCount'])} ratings',
                          tone: _MetricTone.rating,
                        ),
                        const SizedBox(width: 8),
                        _InsightMetric(
                          icon: Icons.thumb_up_alt_outlined,
                          value:
                              '${_number(_summary, const ['upvotesCount', 'upvoteCount'])}',
                          label: 'upvotes',
                          tone: _MetricTone.positive,
                        ),
                        const SizedBox(width: 8),
                        _InsightMetric(
                          icon: Icons.thumb_down_alt_outlined,
                          value:
                              '${_number(_summary, const ['downvotesCount', 'downvoteCount'])}',
                          label: 'downvotes',
                          tone: _MetricTone.neutral,
                        ),
                        const SizedBox(width: 8),
                        _InsightMetric(
                          icon: Icons.chat_bubble_outline_rounded,
                          value: '${_number(_summary, const ['feedbackCount'])}',
                          label: 'written reviews',
                          tone: _MetricTone.neutral,
                        ),
                        const SizedBox(width: 8),
                        _InsightMetric(
                          icon: Icons.group_outlined,
                          value: '$acceptanceCount',
                          label: 'accepted',
                          tone: _MetricTone.positive,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.fromLTRB(13, 12, 13, 12),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft.withValues(alpha: .42),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: .10),
                      ),
                    ),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 37,
                              height: 37,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .82),
                                borderRadius: BorderRadius.circular(13),
                              ),
                              child: const Icon(
                                Icons.group_outlined,
                                size: 18,
                                color: AppColors.primaryDark,
                              ),
                            ),
                            const SizedBox(width: 10),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'People who accepted this idea',
                                    style: TextStyle(
                                      color: AppColors.textPrimary,
                                      fontSize: 11.1,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  SizedBox(height: 2),
                                  Text(
                                    'Visible only to the publication owner.',
                                    style: TextStyle(
                                      color: AppColors.textMuted,
                                      fontSize: 7.8,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              constraints: const BoxConstraints(minWidth: 34),
                              height: 34,
                              padding: const EdgeInsets.symmetric(horizontal: 9),
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .82),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                '$acceptanceCount',
                                style: const TextStyle(
                                  color: AppColors.primaryDeep,
                                  fontSize: 14,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        if (acceptedBy.isEmpty)
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 11,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: .66),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: const Text(
                              'No one has accepted this idea yet.',
                              style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 8.8,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          )
                        else
                          ...acceptedBy.take(8).whereType<Map>().map(
                                (entry) => Padding(
                                  padding: const EdgeInsets.only(top: 7),
                                  child: _AcceptedAudiencePerson(
                                    person: Map<String, dynamic>.from(entry),
                                  ),
                                ),
                              ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),
                  Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceRose.withValues(alpha: .58),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(
                          Icons.person_search_outlined,
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
                              'Individual community signals',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 12.2,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Each member appears once with their latest signal.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 7.8,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.primarySoft,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '$_total people',
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 6.9,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 11),
                  if (_loading && _responses.isEmpty)
                    const LoadingList(count: 3)
                  else if (_error != null && _responses.isEmpty)
                    InlineNotice(
                      icon: Icons.error_outline_rounded,
                      title: 'Audience responses unavailable',
                      message: _error!,
                      error: true,
                      actionLabel: 'Try again',
                      onAction: () => _load(force: true),
                    )
                  else if (_responses.isEmpty)
                    const EmptyState(
                      icon: Icons.chat_bubble_outline_rounded,
                      title: 'No audience activity yet',
                      message:
                          'Ratings, votes, and written feedback will appear here per person.',
                    )
                  else
                    ..._responses.map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: _AudienceResponseCard(item: item),
                      ),
                    ),
                  if (!_loading && _error == null && _totalPages > 1) ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .72),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: AppColors.border.withValues(alpha: .72),
                        ),
                      ),
                      child: Row(
                        children: [
                          IconButton.filledTonal(
                            onPressed: _page <= 1
                                ? null
                                : () => _changePage(_page - 1),
                            tooltip: 'Previous response page',
                            icon: const Icon(Icons.arrow_back_rounded, size: 17),
                          ),
                          Expanded(
                            child: Text(
                              'Page $_page of $_totalPages',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 8.8,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          IconButton.filledTonal(
                            onPressed: _page >= _totalPages
                                ? null
                                : () => _changePage(_page + 1),
                            tooltip: 'Next response page',
                            icon:
                                const Icon(Icons.arrow_forward_rounded, size: 17),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  int _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse('${value ?? ''}') ?? 0;
  }
}

class _InsightMetric extends StatelessWidget {
  const _InsightMetric({
    required this.icon,
    required this.value,
    required this.label,
    required this.tone,
  });

  final IconData icon;
  final String value;
  final String label;
  final _MetricTone tone;

  @override
  Widget build(BuildContext context) {
    final foreground = switch (tone) {
      _MetricTone.rating => const Color(0xFF64756F),
      _MetricTone.positive => AppColors.success,
      _MetricTone.rose => AppColors.pinkDeep,
      _MetricTone.neutral => AppColors.primaryDark,
    };

    final background = switch (tone) {
      _MetricTone.rating => const Color(0xFFF1F6F4),
      _MetricTone.positive => const Color(0xFFECF8F3),
      _MetricTone.rose => const Color(0xFFFFF0F3),
      _MetricTone.neutral => AppColors.primarySoft.withValues(alpha: .60),
    };

    return Container(
      width: 106,
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: foreground.withValues(alpha: .08),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .70),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 14, color: foreground),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: foreground,
              fontSize: 15.3,
              height: 1,
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
              fontSize: 6.6,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _AcceptedAudiencePerson extends StatelessWidget {
  const _AcceptedAudiencePerson({required this.person});

  final Map<String, dynamic> person;

  @override
  Widget build(BuildContext context) {
    final name = '${person['fullName'] ?? 'Voxidence user'}';
    final userType = '${person['userType'] ?? 'MEMBER'}';
    final advanced = person['hasAdvancedAccess'] == true;

    return Container(
      padding: const EdgeInsets.fromLTRB(9, 8, 9, 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: AppColors.primarySoft,
            child: Text(
              _initials(name),
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 8.5,
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
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$userType · ${_friendlyActivityDate(person['acceptedAt'])}',
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
          ),
          const SizedBox(width: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
            decoration: BoxDecoration(
              color: advanced
                  ? AppColors.primarySoft
                  : AppColors.surfaceRose.withValues(alpha: .72),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              advanced ? 'ADVANCED' : 'BASIC',
              style: TextStyle(
                color: advanced ? AppColors.primaryDark : AppColors.pinkDeep,
                fontSize: 5.7,
                fontWeight: FontWeight.w900,
                letterSpacing: .42,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AudienceResponseCard extends StatelessWidget {
  const _AudienceResponseCard({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final user = item['user'] is Map
        ? Map<String, dynamic>.from(item['user'] as Map)
        : const <String, dynamic>{};
    final feedback = item['feedback'] is Map
        ? Map<String, dynamic>.from(item['feedback'] as Map)
        : const <String, dynamic>{};
    final name = '${user['fullName'] ?? 'Voxidence user'}';
    final userType = '${user['userType'] ?? 'MEMBER'}';
    final rating = item['rating'];
    final vote = '${item['vote'] ?? ''}'.toUpperCase();
    final comment = '${feedback['comment'] ?? ''}'.trim();

    return Container(
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .72),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .025),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppColors.primarySoft,
                child: Text(
                  _initials(name),
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 9,
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
                      name,
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
                      userType,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.3,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                _friendlyActivityDate(item['lastActivityAt']),
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.8,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              _AudienceSignalPill(
                icon: Icons.star_rounded,
                label: rating == null ? 'No rating' : '$rating / 5',
                tone: _MetricTone.rating,
              ),
              const SizedBox(width: 6),
              _AudienceSignalPill(
                icon: vote == 'DOWN'
                    ? Icons.thumb_down_alt_outlined
                    : Icons.thumb_up_alt_outlined,
                label: vote == 'UP'
                    ? 'Upvoted'
                    : vote == 'DOWN'
                        ? 'Downvoted'
                        : 'No vote',
                tone: vote == 'UP'
                    ? _MetricTone.positive
                    : vote == 'DOWN'
                        ? _MetricTone.rose
                        : _MetricTone.neutral,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted.withValues(alpha: .46),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Text(
              comment.isEmpty
                  ? 'No written feedback from this person.'
                  : comment,
              style: TextStyle(
                color: comment.isEmpty
                    ? AppColors.textMuted
                    : AppColors.textSecondary,
                fontSize: 8.5,
                height: 1.42,
                fontStyle: comment.isEmpty ? FontStyle.italic : FontStyle.normal,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AudienceSignalPill extends StatelessWidget {
  const _AudienceSignalPill({
    required this.icon,
    required this.label,
    required this.tone,
  });

  final IconData icon;
  final String label;
  final _MetricTone tone;

  @override
  Widget build(BuildContext context) {
    final foreground = switch (tone) {
      _MetricTone.rating => const Color(0xFF64756F),
      _MetricTone.positive => AppColors.success,
      _MetricTone.rose => AppColors.pinkDeep,
      _MetricTone.neutral => AppColors.primaryDark,
    };

    final background = switch (tone) {
      _MetricTone.rating => const Color(0xFFF1F6F4),
      _MetricTone.positive => const Color(0xFFECF8F3),
      _MetricTone.rose => const Color(0xFFFFF0F3),
      _MetricTone.neutral => AppColors.primarySoft.withValues(alpha: .56),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: foreground),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 6.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

String _metricRating(Map<String, dynamic> raw) {
  final value = raw['averageRating'];
  final number = value is num
      ? value.toDouble()
      : double.tryParse('${value ?? ''}');
  return (number ?? 0).toStringAsFixed(1);
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'VX';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

String _friendlyActivityDate(dynamic value) {
  final date = DateTime.tryParse('${value ?? ''}')?.toLocal();
  if (date == null) return 'Recently';
  return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

Map<String, dynamic> _publicationStudioSeed(Map<String, dynamic> raw) {
  final nestedIdea = raw['idea'] is Map
      ? Map<String, dynamic>.from(raw['idea'] as Map)
      : <String, dynamic>{};

  final nestedPublication = raw['publication'] is Map
      ? Map<String, dynamic>.from(raw['publication'] as Map)
      : <String, dynamic>{};

  final publication = <String, dynamic>{
    ...raw,
    ...nestedPublication,
    'id': _publicationId(raw),
    'ideaId': _ideaId(raw),
    'publicTitle': _title(raw),
    'publicAbstract': _abstract(raw),
    'visibility': _visibility(raw),
    'status': _status(raw),
    'allowAdoption': _allowAdoption(raw),
  };

  return <String, dynamic>{
    ...nestedIdea,
    'id': _ideaId(raw),
    'title': nestedIdea['title'] ?? raw['ideaTitle'] ?? _title(raw),
    'publication': publication,
  };
}

String _publicationId(Map<String, dynamic> raw) {
  final nested = raw['publication'] is Map
      ? Map<String, dynamic>.from(raw['publication'] as Map)
      : const <String, dynamic>{};
  return '${raw['publicationId'] ?? raw['id'] ?? nested['id'] ?? ''}';
}

String _ideaId(Map<String, dynamic> raw) {
  final idea = raw['idea'] is Map
      ? Map<String, dynamic>.from(raw['idea'] as Map)
      : const <String, dynamic>{};
  return '${raw['ideaId'] ?? idea['id'] ?? ''}';
}

String _title(Map<String, dynamic> raw) {
  final idea = raw['idea'] is Map
      ? Map<String, dynamic>.from(raw['idea'] as Map)
      : const <String, dynamic>{};
  final value = raw['publicTitle'] ?? raw['title'] ?? idea['title'];
  final title = '${value ?? ''}'.trim();
  return title.isEmpty ? 'Published idea' : title;
}

String _abstract(Map<String, dynamic> raw) {
  final idea = raw['idea'] is Map
      ? Map<String, dynamic>.from(raw['idea'] as Map)
      : const <String, dynamic>{};
  return '${raw['publicAbstract'] ?? raw['abstract'] ?? idea['abstract'] ?? idea['problem'] ?? ''}'
      .trim();
}

String _visibility(Map<String, dynamic> raw) {
  final value =
      '${raw['visibility'] ?? 'PUBLIC'}'.trim().toUpperCase();

  return switch (value) {
    'REGISTERED_USERS' => 'REGISTERED',
    'SELECTED_AUDIENCE' => 'SELECTED',
    _ => value.isEmpty ? 'PUBLIC' : value,
  };
}

String _status(Map<String, dynamic> raw) =>
    '${raw['status'] ?? raw['publicationStatus'] ?? 'PUBLISHED'}'.toUpperCase();

bool _allowAdoption(Map<String, dynamic> raw) =>
    raw['allowAdoption'] == true || raw['acceptanceEnabled'] == true;

int _number(Map<String, dynamic> raw, List<String> keys) {
  for (final key in keys) {
    final value = raw[key];
    if (value is num) return value.toInt();
    final parsed = int.tryParse('${value ?? ''}');
    if (parsed != null) return parsed;
  }
  return 0;
}

String _rating(Map<String, dynamic> raw) {
  final value =
      raw['averageRating'] ?? raw['ratingAverage'] ?? raw['avgRating'];
  final number = value is num
      ? value.toDouble()
      : double.tryParse('${value ?? ''}');
  if (number == null || number <= 0) return '—';
  return number.toStringAsFixed(1);
}