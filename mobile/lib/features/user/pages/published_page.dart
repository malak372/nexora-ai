// Mobile published-ideas workspace with owner moderation controls.
// Mirrors the main web actions while keeping the layout compact for phones.
//
// @author  Malak

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';
import 'idea_workspace_page.dart';
import 'publication_page.dart';
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
    _load(force: true);
  }

  void _changeFilter(String value) {
    if (_filter == value) return;
    setState(() {
      _filter = value;
      _page = 1;
    });
    _load(force: true);
  }

  void _changePage(int next) {
    if (next < 1 || next > _totalPages || next == _page) return;
    setState(() => _page = next);
    _load(force: true);
  }

  Future<void> _runOwnerAction(
    Map<String, dynamic> item,
    String action,
  ) async {
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
      builder: (_) => _FeedbackSheet(publicationId: publicationId, publication: item),
    );
  }

@override
  Widget build(BuildContext context) {
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
              padding: const EdgeInsets.fromLTRB(15, 11, 15, 36),
              children: [
                _PublishedHero(
                  total: _total,
                  filter: _filter,
                ),
                const SizedBox(height: 11),
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
                const SizedBox(height: 13),
                _PublishedResultsHeading(
                  filter: _filter,
                  total: _total,
                  loading: _loading,
                ),
                const SizedBox(height: 8),
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
                  ..._items.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _PublicationCard(
                        item: item,
                        busy: _busyIdeaId == _ideaId(item),
                        onOpen: () {
                          final publicationId = _publicationId(item);
                          if (publicationId.isEmpty) return;
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PublicationPage(
                                publicationId: publicationId,
                              ),
                            ),
                          );
                        },
                        onOpenWorkspace: () {
                          final ideaId = _ideaId(item);
                          if (ideaId.isEmpty) return;
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => IdeaWorkspacePage(
                                ideaId: ideaId,
                                returnTitle: 'Published',
                              ),
                            ),
                          );
                        },
                        onFeedback: () => _showFeedback(item),
                        onEdit: () {
                          final ideaId = _ideaId(item);
                          if (ideaId.isEmpty) return;
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PublishIdeaPage(
                                ideaId: ideaId,
                                returnTitle: 'Published',
                              ),
                            ),
                          ).then((_) => _load(force: true));
                        },
                        onArchive: () => _runOwnerAction(item, 'archive'),
                        onRepost: () => _runOwnerAction(item, 'repost'),
                        onToggleAdoption: () => _runOwnerAction(item, 'adoption'),
                      ),
                    ),
                  ),
                if (!_loading && _items.isNotEmpty && _totalPages > 1) ...[
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
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 13, 13, 13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            Color(0xFFF1F9F7),
          ],
        ),
        borderRadius: BorderRadius.circular(21),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .055),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 41,
            height: 41,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Icon(
              Icons.public_rounded,
              size: 19,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'PUBLICATION STUDIO',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 6.2,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .7,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  'Published ideas',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 20.5,
                    height: 1,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.3,
                  ),
                ),
                const SizedBox(height: 5),
                const Text(
                  'Manage live and archived publications while keeping community signals and accepted-user access intact.',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.1,
                    height: 1.37,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .76),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                Text(
                  '$total',
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  filter == 'ALL' ? 'TOTAL' : filter,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 5.3,
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
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .10),
        ),
      ),
      child: TextField(
        controller: controller,
        textInputAction: TextInputAction.search,
        onSubmitted: onSubmitted,
        decoration: InputDecoration(
          hintText: 'Search published ideas…',
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

class _PublicationTinyBadge extends StatelessWidget {
  const _PublicationTinyBadge({
    required this.icon,
    required this.label,
  });
  final IconData icon;
  final String label;
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(right: 3),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF8F2),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 9.5, color: AppColors.success),
          const SizedBox(width: 3),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.success,
              fontSize: 5.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublishedIconAction extends StatelessWidget {
  const _PublishedIconAction({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.busy = false,
  });
  final String tooltip;
  final IconData icon;
  final VoidCallback? onTap;
  final bool busy;
  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Ink(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: busy
                ? const Padding(
                    padding: EdgeInsets.all(11),
                    child: CircularProgressIndicator(
                      strokeWidth: 1.7,
                      color: AppColors.primaryDark,
                    ),
                  )
                : Icon(icon, size: 16, color: AppColors.primaryDark),
          ),
        ),
      ),
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
  const _FilterBar({
    required this.value,
    required this.onChanged,
  });

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
    required this.item,
    required this.busy,
    required this.onOpen,
    required this.onOpenWorkspace,
    required this.onFeedback,
    required this.onEdit,
    required this.onArchive,
    required this.onRepost,
    required this.onToggleAdoption,
  });

  final Map<String, dynamic> item;
  final bool busy;
  final VoidCallback onOpen;
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

    return Container(
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
          children: [
            Container(
              height: 3,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: archived
                      ? const [
                          Color(0xFFD5AAA9),
                          Color(0xFFBCCAC5),
                        ]
                      : const [
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
                      Container(
                        height: 28,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        decoration: BoxDecoration(
                          color: archived
                              ? AppColors.pinkSoft
                              : AppColors.primarySoft,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              archived
                                  ? Icons.inventory_2_outlined
                                  : Icons.public_rounded,
                              size: 10.5,
                              color: archived
                                  ? AppColors.pinkDeep
                                  : AppColors.primaryDark,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              _prettyStatus(status),
                              style: TextStyle(
                                color: archived
                                    ? AppColors.pinkDeep
                                    : AppColors.primaryDark,
                                fontSize: 6.7,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      if (_allowAdoption(item))
                        const _PublicationTinyBadge(
                          icon: Icons.handshake_outlined,
                          label: 'Acceptance on',
                        ),
                      PopupMenuButton<String>(
                        enabled: !busy,
                        tooltip: 'Publication actions',
                        icon: const Icon(
                          Icons.more_horiz_rounded,
                          color: AppColors.textMuted,
                        ),
                        onSelected: (value) {
                          if (value == 'edit') onEdit();
                          if (value == 'archive') onArchive();
                          if (value == 'repost') onRepost();
                          if (value == 'adoption') onToggleAdoption();
                        },
                        itemBuilder: (_) => [
                          if (!archived)
                            const PopupMenuItem(
                              value: 'edit',
                              child: Row(
                                children: [
                                  Icon(Icons.edit_outlined, size: 18),
                                  SizedBox(width: 9),
                                  Text('Edit publication'),
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
                          PopupMenuItem(
                            value: archived ? 'repost' : 'archive',
                            child: Row(
                              children: [
                                Icon(
                                  archived
                                      ? Icons.restore_rounded
                                      : Icons.inventory_2_outlined,
                                  size: 18,
                                ),
                                const SizedBox(width: 9),
                                Text(archived ? 'Republish' : 'Archive'),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Row(
                    children: [
                      Icon(
                        Icons.auto_awesome_rounded,
                        size: 11,
                        color: AppColors.primaryDark,
                      ),
                      SizedBox(width: 5),
                      Text(
                        'PUBLIC COMMUNITY IDEA',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 5.8,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .58,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 7),
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 14.7,
                      height: 1.16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (abstract.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    Text(
                      abstract,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        height: 1.47,
                        fontSize: 8.8,
                      ),
                    ),
                  ],
                  const SizedBox(height: 11),
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 7),
                    decoration: BoxDecoration(
                      color: Color(0xFFF4FAF8),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: _MiniMetric(
                            icon: Icons.thumb_up_alt_outlined,
                            value: '${_number(item, ['upvotesCount', 'upvoteCount', 'upvotes'])}',
                            label: 'Upvotes',
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 27,
                          color: AppColors.primaryDark.withValues(alpha: .06),
                        ),
                        Expanded(
                          child: _MiniMetric(
                            icon: Icons.star_outline_rounded,
                            value: _rating(item),
                            label: 'Rating',
                          ),
                        ),
                        Container(
                          width: 1,
                          height: 27,
                          color: AppColors.primaryDark.withValues(alpha: .06),
                        ),
                        Expanded(
                          child: _MiniMetric(
                            icon: Icons.handshake_outlined,
                            value: '${_number(item, ['acceptanceCount', 'acceptedCount'])}',
                            label: 'Accepted',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: busy ? null : onOpen,
                          icon: const Icon(Icons.north_east_rounded, size: 13),
                          label: const Text('View publication'),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(40),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            textStyle: const TextStyle(
                              fontSize: 8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      _PublishedIconAction(
                        tooltip: 'Community feedback',
                        icon: Icons.chat_bubble_outline_rounded,
                        onTap: busy ? null : onFeedback,
                      ),
                      const SizedBox(width: 5),
                      _PublishedIconAction(
                        tooltip: 'Idea workspace',
                        icon: Icons.dashboard_customize_outlined,
                        busy: busy,
                        onTap: busy ? null : onOpenWorkspace,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}



class _MiniMetric extends StatelessWidget {
  const _MiniMetric({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 11.5, color: AppColors.primaryDark),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                value,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w900,
                  fontSize: 9.4,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 6.3,
          ),
        ),
      ],
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
        _responses = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
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
      initialChildSize: .88,
      minChildSize: .55,
      maxChildSize: .96,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 32),
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
            const SizedBox(height: 17),
            WorkspacePageHeader(
              eyebrow: 'AUDIENCE RESPONSE LEDGER',
              title: '${_summary['publicTitle'] ?? _title(widget.publication)}',
              subtitle:
                  'Every person appears once with their rating, vote, feedback, and latest interaction.',
              icon: Icons.insights_outlined,
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _InsightMetric(
                  icon: Icons.star_rounded,
                  value: _metricRating(_summary),
                  label: '${_number(_summary, const ['ratingsCount'])} ratings',
                ),
                _InsightMetric(
                  icon: Icons.thumb_up_alt_outlined,
                  value: '${_number(_summary, const ['upvotesCount', 'upvoteCount'])}',
                  label: 'upvotes',
                ),
                _InsightMetric(
                  icon: Icons.thumb_down_alt_outlined,
                  value: '${_number(_summary, const ['downvotesCount', 'downvoteCount'])}',
                  label: 'downvotes',
                  rose: true,
                ),
                _InsightMetric(
                  icon: Icons.chat_bubble_outline_rounded,
                  value: '${_number(_summary, const ['feedbackCount'])}',
                  label: 'written reviews',
                ),
                _InsightMetric(
                  icon: Icons.handshake_outlined,
                  value: '$acceptanceCount',
                  label: 'accepted this idea',
                ),
              ],
            ),
            const SizedBox(height: 14),
            VoxCard(
              tint: AppColors.primarySoft.withValues(alpha: .52),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const SoftIconBadge(
                        icon: Icons.group_outlined,
                        size: 38,
                      ),
                      const SizedBox(width: 9),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'People who accepted this idea',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w900,
                                fontSize: 11.5,
                              ),
                            ),
                            Text(
                              'Visible only to the publication owner.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        '$acceptanceCount',
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 11),
                  if (acceptedBy.isEmpty)
                    const Text(
                      'No one has accepted this idea yet.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.2,
                      ),
                    )
                  else
                    ...acceptedBy.take(8).map((entry) {
                      final person = Map<String, dynamic>.from(entry as Map);
                      final name = '${person['fullName'] ?? 'Voxidence user'}';
                      final userType = '${person['userType'] ?? 'MEMBER'}';
                      final advanced = person['hasAdvancedAccess'] == true;
                      return Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Row(
                          children: [
                            CircleAvatar(
                              radius: 17,
                              backgroundColor: Colors.white,
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
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  Text(
                                    '$userType · Accepted ${_friendlyActivityDate(person['acceptedAt'])}',
                                    style: const TextStyle(
                                      color: AppColors.textMuted,
                                      fontSize: 8.2,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            StatusChip(
                              label: advanced ? 'ADVANCED' : 'BASIC',
                              positive: advanced,
                            ),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Expanded(
                  child: SectionHeading(
                    title: 'Individual community signals',
                    subtitle: 'Visible only to the publication owner.',
                  ),
                ),
                const SizedBox(width: 8),
                StatusChip(
                  label: '$_total PEOPLE',
                  icon: Icons.people_outline_rounded,
                ),
              ],
            ),
            const SizedBox(height: 12),
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
              ..._responses.map((item) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _AudienceResponseCard(item: item),
                  )),
            if (!_loading && _error == null && _totalPages > 1) ...[
              const SizedBox(height: 4),
              VoxCard(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                child: Row(
                  children: [
                    IconButton.filledTonal(
                      onPressed: _page <= 1 ? null : () => _changePage(_page - 1),
                      tooltip: 'Previous response page',
                      icon: const Icon(Icons.arrow_back_rounded, size: 17),
                    ),
                    Expanded(
                      child: Text(
                        '$_page / $_totalPages',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    IconButton.filledTonal(
                      onPressed: _page >= _totalPages ? null : () => _changePage(_page + 1),
                      tooltip: 'Next response page',
                      icon: const Icon(Icons.arrow_forward_rounded, size: 17),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
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
    this.rose = false,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 104,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
      decoration: BoxDecoration(
        color: rose ? AppColors.pinkSoft : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 16,
            color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
          ),
          const SizedBox(height: 7),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 7.8),
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

    return VoxCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: AppColors.primarySoft,
            child: Text(
              _initials(name),
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
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
                              fontWeight: FontWeight.w900,
                              fontSize: 11.3,
                            ),
                          ),
                          Text(
                            userType,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.3,
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
                        fontSize: 7.8,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusChip(
                      label: rating == null ? 'No rating' : '$rating/5',
                      icon: Icons.star_outline_rounded,
                      positive: rating != null,
                    ),
                    StatusChip(
                      label: vote == 'UP'
                          ? 'Upvoted'
                          : vote == 'DOWN'
                              ? 'Downvoted'
                              : 'No vote',
                      icon: vote == 'DOWN'
                          ? Icons.thumb_down_alt_outlined
                          : Icons.thumb_up_alt_outlined,
                      rose: vote == 'DOWN',
                      positive: vote == 'UP',
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceMuted.withValues(alpha: .58),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(
                    comment.isEmpty
                        ? 'No written feedback from this person.'
                        : comment,
                    style: TextStyle(
                      color: comment.isEmpty
                          ? AppColors.textMuted
                          : AppColors.textSecondary,
                      fontSize: 9.7,
                      height: 1.42,
                      fontStyle: comment.isEmpty ? FontStyle.italic : FontStyle.normal,
                    ),
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

String _metricRating(Map<String, dynamic> raw) {
  final value = raw['averageRating'];
  final number = value is num ? value.toDouble() : double.tryParse('${value ?? ''}');
  return (number ?? 0).toStringAsFixed(1);
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
  if (parts.isEmpty) return 'VX';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

String _friendlyActivityDate(dynamic value) {
  final date = DateTime.tryParse('${value ?? ''}')?.toLocal();
  if (date == null) return 'Recently';
  return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
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
  return '${raw['publicAbstract'] ?? raw['abstract'] ?? idea['abstract'] ?? idea['problem'] ?? ''}'.trim();
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
  final value = raw['averageRating'] ?? raw['ratingAverage'] ?? raw['avgRating'];
  final number = value is num ? value.toDouble() : double.tryParse('${value ?? ''}');
  if (number == null || number <= 0) return '—';
  return number.toStringAsFixed(1);
}

String _prettyStatus(String status) {
  final lower = status.replaceAll('_', ' ').toLowerCase();
  if (lower.isEmpty) return 'Published';
  return '${lower[0].toUpperCase()}${lower.substring(1)}';
}
