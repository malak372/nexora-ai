import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Mobile publication-report moderation center.
///
/// Provides a mobile-friendly moderation workspace with:
/// - Report statistics
/// - Search and filtering
/// - Sorting
/// - Reporter and publisher information
/// - Moderation history
/// - Publisher/reporter notifications
/// - Idea details
/// - Publication insights
///
/// @author Eman
class AdminPublicationReportsPage extends StatefulWidget {
  const AdminPublicationReportsPage({
    super.key,
    this.embedded = false,
    this.isActive = true,
    this.onBack,
  });

  final bool embedded;
  final bool isActive;
  final VoidCallback? onBack;

  @override
  State<AdminPublicationReportsPage> createState() =>
      _AdminPublicationReportsPageState();
}

class _AdminPublicationReportsPageState
    extends State<AdminPublicationReportsPage> {
  final _api = AdminApi.instance;
  final _searchController = TextEditingController();

  Timer? _debounce;

  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _summary = const {};

  String _search = '';
  String _status = '';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';

  int _page = 1;
  int _totalPages = 1;
  int _total = 0;

  bool _loading = true;
  bool _refreshing = false;
  bool _hasLoaded = false;

  int _loadRequestId = 0;

  String _error = '';

  @override
  void initState() {
    super.initState();

    if (widget.isActive) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _load(force: true);
        }
      });
    }
  }

  @override
  void didUpdateWidget(covariant AdminPublicationReportsPage oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (!oldWidget.isActive && widget.isActive) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _load(force: true, quiet: _hasLoaded);
        }
      });
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false, bool quiet = false}) async {
    final requestId = ++_loadRequestId;

    final useQuietRefresh = quiet && _hasLoaded;

    if (mounted) {
      setState(() {
        if (useQuietRefresh) {
          _refreshing = true;
        } else {
          _loading = true;
        }

        _error = '';
      });
    }

    try {
      final result = await Future.wait([
        _api.getList(
          '/admin/publication-reports',
          page: _page,
          limit: 20,
          search: _search,
          status: _status,
          sortBy: _sortBy,
          sortOrder: _sortOrder,
          force: force,
        ),
        _api.getSummary('/admin/publication-reports/summary', force: force),
      ]);

      final list = result[0];

      final items = (list['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

      final meta = _map(list['meta']);

      if (!mounted || requestId != _loadRequestId) {
        return;
      }

      setState(() {
        _rows = items;
        _summary = result[1];

        _total = _asInt(meta['total'] ?? items.length);

        _totalPages = _asInt(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();

        _hasLoaded = true;
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _loadRequestId) {
        return;
      }

      setState(() {
        _error = error.message;
      });
    } finally {
      if (mounted && requestId == _loadRequestId) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  void _searchChanged(String value) {
    setState(() {});

    _debounce?.cancel();

    _debounce = Timer(const Duration(milliseconds: 250), () {
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

  void _setStatus(String status) {
    if (_status == status) {
      return;
    }

    setState(() {
      _status = status;
      _page = 1;
    });

    _load();
  }

  void _setSort(String value) {
    if (_sortBy == value) {
      return;
    }

    setState(() {
      _sortBy = value;

      _sortOrder = value == 'createdAt' || value == 'reviewedAt'
          ? 'desc'
          : 'asc';

      _page = 1;
    });

    _load();
  }

  void _toggleSortOrder() {
    setState(() {
      _sortOrder = _sortOrder == 'asc' ? 'desc' : 'asc';

      _page = 1;
    });

    _load();
  }

  Future<void> _openSortSheet() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return SafeArea(
          child: Container(
            margin: const EdgeInsets.all(10),
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: Colors.white),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .08),
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
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.silver,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Row(
                  children: [
                    AdminIconBadge(
                      icon: Icons.swap_vert_rounded,
                      size: 40,
                      tone: AppColors.primarySoft,
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Sort reports',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Choose how the moderation queue is ordered.',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.6,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                ..._reportSortOptions.map(
                  (option) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Material(
                      color: option.key == _sortBy
                          ? AppColors.primarySoft
                          : const Color(0xFFFCFEFD),
                      borderRadius: BorderRadius.circular(15),
                      child: InkWell(
                        onTap: () {
                          Navigator.pop(context, option.key);
                        },
                        borderRadius: BorderRadius.circular(15),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 13,
                            vertical: 12,
                          ),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(15),
                            border: Border.all(
                              color: option.key == _sortBy
                                  ? AppColors.borderStrong
                                  : AppColors.border,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                option.icon,
                                size: 18,
                                color: AppColors.primaryDark,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  option.label,
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 11.2,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                              if (option.key == _sortBy)
                                const Icon(
                                  Icons.check_circle_rounded,
                                  color: AppColors.primaryDark,
                                  size: 18,
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );

    if (selected != null && mounted) {
      _setSort(selected);
    }
  }

  Future<void> _openReport(
    Map<String, dynamic> report, {
    _ReportDrawerTab initialTab = _ReportDrawerTab.review,
  }) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _ReportReviewSheet(
          report: report,
          initialTab: initialTab,
          onChanged: (updated) async {
            if (!mounted) {
              return;
            }

            final id = _string(updated['id']);

            setState(() {
              _rows = _rows
                  .map((row) => _string(row['id']) == id ? updated : row)
                  .toList();
            });

            await _load(force: true, quiet: true);
          },
        );
      },
    );

    if (changed == true && mounted) {
      await _load(force: true, quiet: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = _summary['data'] is Map
        ? Map<String, dynamic>.from(_summary['data'] as Map)
        : _summary;

    final pending = _asInt(summary['pendingReports']);

    final reviewing = _asInt(summary['reviewingReports']);

    final resolved = _asInt(summary['resolvedReports']);

    final dismissed = _asInt(summary['dismissedReports']);

    final affected = _asInt(summary['affectedPublications']);

    final totalReports = _asInt(summary['totalReports'] ?? _total);

    final content = RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _load(force: true, quiet: true),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 120),
            sliver: SliverList.list(
              children: [
                _ReportsPageHeader(
                  onBack:
                      widget.onBack ??
                      (widget.embedded
                          ? null
                          : () => Navigator.maybePop(context)),
                  refreshing: _refreshing,
                  onRefresh: () => _load(force: true, quiet: true),
                ),
                const SizedBox(height: 15),
                _ReportsHero(
                  total: totalReports,
                  pending: pending,
                  reviewing: reviewing,
                  resolved: resolved,
                  dismissed: dismissed,
                  affected: affected,
                ),
                const SizedBox(height: 14),
                _QueueToolbar(
                  searchController: _searchController,
                  searchChanged: _searchChanged,
                  status: _status,
                  onStatusChanged: _setStatus,
                  sortLabel: _sortLabel(_sortBy),
                  sortOrder: _sortOrder,
                  onOpenSort: _openSortSheet,
                  onToggleSort: _toggleSortOrder,
                ),
                const SizedBox(height: 13),
                Row(
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'MODERATION QUEUE',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .9,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$_total matching ${_total == 1 ? 'report' : 'reports'}',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 10.4,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    const Spacer(),
                    if (_totalPages > 1)
                      Text(
                        'Page $_page of $_totalPages',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.7,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_loading)
                  const AdminLoadingList()
                else if (_error.isNotEmpty && _rows.isEmpty)
                  AdminEmptyState(
                    title: 'Could not load reports',
                    message: _error,
                    icon: Icons.flag_outlined,
                    onRetry: () => _load(force: true),
                  )
                else if (_rows.isEmpty)
                  const AdminEmptyState(
                    title: 'No matching reports',
                    message: 'The moderation queue is clear for this view.',
                    icon: Icons.verified_outlined,
                  )
                else ...[
                  ..._rows.map(
                    (report) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _ReportCard(
                        report: report,
                        onReview: () {
                          _openReport(report);
                        },
                        onDetails: () {
                          _openReport(
                            report,
                            initialTab: _ReportDrawerTab.details,
                          );
                        },
                        onInsights: () {
                          _openReport(
                            report,
                            initialTab: _ReportDrawerTab.insights,
                          );
                        },
                      ),
                    ),
                  ),
                  if (_totalPages > 1) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _page <= 1
                                ? null
                                : () {
                                    setState(() {
                                      _page--;
                                    });

                                    _load();
                                  },
                            icon: const Icon(
                              Icons.chevron_left_rounded,
                              size: 18,
                            ),
                            label: const Text('Previous'),
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: FilledButton.tonalIcon(
                            onPressed: _page >= _totalPages
                                ? null
                                : () {
                                    setState(() {
                                      _page++;
                                    });

                                    _load();
                                  },
                            icon: const Icon(
                              Icons.chevron_right_rounded,
                              size: 18,
                            ),
                            label: const Text('Next'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ],
            ),
          ),
        ],
      ),
    );

    if (widget.embedded) {
      return content;
    }

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(child: SafeArea(child: content)),
    );
  }
}

class _ReportsPageHeader extends StatelessWidget {
  const _ReportsPageHeader({
    required this.onBack,
    required this.refreshing,
    required this.onRefresh,
  });

  final VoidCallback? onBack;
  final bool refreshing;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onBack != null) ...[
          Material(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(13),
            child: InkWell(
              onTap: onBack,
              borderRadius: BorderRadius.circular(13),
              child: Container(
                width: 39,
                height: 39,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.arrow_back_ios_new_rounded,
                  size: 15,
                  color: AppColors.primaryDeep,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
        const AdminIconBadge(
          icon: Icons.flag_outlined,
          size: 42,
          tone: AppColors.primarySoft,
          iconColor: AppColors.primaryDark,
        ),
        const SizedBox(width: 10),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'TRUST & SAFETY',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 8.1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.15,
                ),
              ),
              SizedBox(height: 3),
              Text(
                'Publication reports',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20.5,
                  height: 1.05,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.4,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Review reports, decisions and publication context.',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.5,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 7),
        if (refreshing)
          const SizedBox(
            width: 39,
            height: 39,
            child: Padding(
              padding: EdgeInsets.all(10),
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          )
        else
          Material(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(13),
            child: InkWell(
              onTap: onRefresh,
              borderRadius: BorderRadius.circular(13),
              child: Container(
                width: 39,
                height: 39,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: AppColors.borderStrong),
                ),
                child: const Icon(
                  Icons.refresh_rounded,
                  size: 18,
                  color: AppColors.primaryDark,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _ReportsHero extends StatelessWidget {
  const _ReportsHero({
    required this.total,
    required this.pending,
    required this.reviewing,
    required this.resolved,
    required this.dismissed,
    required this.affected,
  });

  final int total;
  final int pending;
  final int reviewing;
  final int resolved;
  final int dismissed;
  final int affected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(15, 15, 15, 13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFFDFC), Color(0xFFF2FAF8), Color(0xFFFFF6F8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: AppColors.border.withValues(alpha: .88)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 24,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .9),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: AppColors.border.withValues(alpha: .82),
                  ),
                ),
                child: const Icon(
                  Icons.shield_outlined,
                  size: 22,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 11),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Moderation workspace',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 14.6,
                        height: 1.12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Review each report with its publication and moderation context.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.5,
                        height: 1.38,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 9),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: pending > 0
                      ? AppColors.pinkSoft
                      : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Text(
                      '$pending',
                      style: TextStyle(
                        color: pending > 0
                            ? AppColors.danger
                            : AppColors.primaryDark,
                        fontSize: 18,
                        height: 1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    const Text(
                      'need review',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.7,
                        fontWeight: FontWeight.w800,
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
                child: _HeroStatTile(
                  label: 'Total reports',
                  value: total,
                  icon: Icons.flag_outlined,
                  tone: AppColors.primarySoft,
                  iconColor: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: _HeroStatTile(
                  label: 'Pending',
                  value: pending,
                  icon: Icons.schedule_rounded,
                  tone: AppColors.pinkSoft,
                  iconColor: AppColors.danger,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Row(
            children: [
              Expanded(
                child: _HeroStatTile(
                  label: 'Reviewing',
                  value: reviewing,
                  icon: Icons.manage_search_rounded,
                  tone: const Color(0xFFEFF7F5),
                  iconColor: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: _HeroStatTile(
                  label: 'Resolved',
                  value: resolved,
                  icon: Icons.verified_outlined,
                  tone: const Color(0xFFEAF7F0),
                  iconColor: AppColors.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .72),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _HeroFooterItem(
                    icon: Icons.do_not_disturb_alt_rounded,
                    label: 'Dismissed',
                    value: dismissed,
                  ),
                ),
                Container(width: 1, height: 24, color: AppColors.border),
                Expanded(
                  child: _HeroFooterItem(
                    icon: Icons.public_rounded,
                    label: 'Publications',
                    value: affected,
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

class _HeroStatTile extends StatelessWidget {
  const _HeroStatTile({
    required this.label,
    required this.value,
    required this.icon,
    required this.tone,
    required this.iconColor,
  });

  final String label;
  final int value;
  final IconData icon;
  final Color tone;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border.withValues(alpha: .74)),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 16, color: iconColor),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$value',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 17,
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
                    fontSize: 8.3,
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

class _HeroFooterItem extends StatelessWidget {
  const _HeroFooterItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 14, color: AppColors.textMuted),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            '$value $label',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.8,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

class _QueueToolbar extends StatelessWidget {
  const _QueueToolbar({
    required this.searchController,
    required this.searchChanged,
    required this.status,
    required this.onStatusChanged,
    required this.sortLabel,
    required this.sortOrder,
    required this.onOpenSort,
    required this.onToggleSort,
  });

  final TextEditingController searchController;

  final ValueChanged<String> searchChanged;

  final String status;

  final ValueChanged<String> onStatusChanged;

  final String sortLabel;
  final String sortOrder;

  final VoidCallback onOpenSort;
  final VoidCallback onToggleSort;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .97),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          AdminSearchField(
            controller: searchController,
            hint: 'Search publication, reporter or details…',
            onChanged: searchChanged,
          ),
          const SizedBox(height: 9),
          SizedBox(
            height: 35,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _reportStatusFilters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (context, index) {
                final item = _reportStatusFilters[index];

                final selected = status == item.key;

                return Material(
                  color: selected
                      ? AppColors.primarySoft
                      : const Color(0xFFFAFCFB),
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    onTap: () => onStatusChanged(item.key),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 11),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: selected
                              ? AppColors.borderStrong
                              : AppColors.border,
                        ),
                      ),
                      child: Text(
                        item.label,
                        style: TextStyle(
                          color: selected
                              ? AppColors.primaryDark
                              : AppColors.textMuted,
                          fontSize: 9,
                          fontWeight: selected
                              ? FontWeight.w900
                              : FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Material(
                  color: const Color(0xFFFAFCFB),
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    onTap: onOpenSort,
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(horizontal: 11),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.tune_rounded,
                            size: 16,
                            color: AppColors.primaryDark,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              sortLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 9.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          const Icon(
                            Icons.keyboard_arrow_down_rounded,
                            size: 18,
                            color: AppColors.textMuted,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 7),
              Material(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  onTap: onToggleSort,
                  borderRadius: BorderRadius.circular(14),
                  child: SizedBox(
                    width: 44,
                    height: 44,
                    child: Icon(
                      sortOrder == 'asc'
                          ? Icons.arrow_upward_rounded
                          : Icons.arrow_downward_rounded,
                      size: 18,
                      color: AppColors.primaryDark,
                    ),
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

class _ReportCard extends StatelessWidget {
  const _ReportCard({
    required this.report,
    required this.onReview,
    required this.onDetails,
    required this.onInsights,
  });

  final Map<String, dynamic> report;
  final VoidCallback onReview;
  final VoidCallback onDetails;
  final VoidCallback onInsights;

  @override
  Widget build(BuildContext context) {
    final publication = _map(report['publication']);

    final reporter = _map(report['reporter']);

    final publisher = _map(publication['publisher']);

    final title = _firstText([
      publication['publicTitle'],
      publication['title'],
      report['publicationTitle'],
    ], fallback: 'Untitled publication');

    final publisherName = _firstText([
      publisher['fullName'],
      publisher['email'],
    ], fallback: 'Publisher');

    final reporterName = _firstText([
      reporter['fullName'],
      reporter['email'],
    ], fallback: 'Community member');

    final reporterEmail = _string(
      reporter['email'],
      fallback: 'No email available',
    );

    final reason = _readable(_string(report['reason'], fallback: 'REPORT'));

    final details = _string(
      report['details'],
      fallback: 'No additional details were provided.',
    );

    final status = _string(report['status'], fallback: 'PENDING');

    final decision = _reportActionLabel(report);

    return AdminGlassCard(
      padding: EdgeInsets.zero,
      radius: 22,
      child: InkWell(
        onTap: onReview,
        borderRadius: BorderRadius.circular(22),
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const AdminIconBadge(
                    icon: Icons.flag_outlined,
                    size: 40,
                    tone: AppColors.pinkSoft,
                    iconColor: AppColors.danger,
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
                            fontSize: 12.7,
                            height: 1.28,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'Published by $publisherName',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.8,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 7),
                  AdminStatusChip(status),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(
                    Icons.schedule_rounded,
                    size: 13,
                    color: AppColors.textMuted,
                  ),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      'Submitted ${_formatDate(report['createdAt'])}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.4,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: AppColors.background.withValues(alpha: .68),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      reason.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8.2,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .45,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      details,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 9.7,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 9),
              Row(
                children: [
                  Expanded(
                    child: _MiniContext(
                      icon: Icons.person_outline_rounded,
                      label: 'REPORTER',
                      value: reporterName,
                      subvalue: reporterEmail,
                    ),
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: _MiniContext(
                      icon: Icons.shield_outlined,
                      label: 'LATEST DECISION',
                      value: decision,
                      subvalue: report['reviewedAt'] == null
                          ? 'Awaiting moderation'
                          : 'Reviewed ${_formatDate(report['reviewedAt'], short: true)}',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              Row(
                children: [
                  Expanded(
                    flex: 4,
                    child: _ReportActionButton(
                      label: 'Review',
                      icon: Icons.flag_outlined,
                      primary: true,
                      onTap: onReview,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    flex: 3,
                    child: _ReportActionButton(
                      label: 'Idea',
                      icon: Icons.visibility_outlined,
                      onTap: onDetails,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    flex: 3,
                    child: _ReportActionButton(
                      label: 'Insights',
                      icon: Icons.auto_awesome_outlined,
                      onTap: onInsights,
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

class _MiniContext extends StatelessWidget {
  const _MiniContext({
    required this.icon,
    required this.label,
    required this.value,
    required this.subvalue,
  });

  final IconData icon;
  final String label;
  final String value;
  final String subvalue;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFEFD),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border.withValues(alpha: .75)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 14, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.9,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .35,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  subvalue,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.3,
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

class _ReportActionButton extends StatelessWidget {
  const _ReportActionButton({
    required this.label,
    required this.icon,
    required this.onTap,
    this.primary = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: primary ? AppColors.primarySoft : const Color(0xFFFCFEFD),
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          height: 38,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: primary ? AppColors.borderStrong : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: AppColors.primaryDark),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 8.8,
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

enum _ReportDrawerTab { review, details, insights }

class _ReportReviewSheet extends StatefulWidget {
  const _ReportReviewSheet({
    required this.report,
    required this.initialTab,
    required this.onChanged,
  });

  final Map<String, dynamic> report;
  final _ReportDrawerTab initialTab;

  final Future<void> Function(Map<String, dynamic> updated) onChanged;

  @override
  State<_ReportReviewSheet> createState() => _ReportReviewSheetState();
}

class _ReportReviewSheetState extends State<_ReportReviewSheet> {
  final _api = AdminApi.instance;

  late Map<String, dynamic> _report;
  late _ReportDrawerTab _tab;
  late String _status;

  String _action = 'NONE';

  late final TextEditingController _adminNote;

  final _publisherMessage = TextEditingController();

  final _reporterMessage = TextEditingController();

  bool _notifyReporter = true;
  bool _busy = false;
  bool _changed = false;

  Map<String, dynamic>? _ideaDetail;
  Map<String, dynamic>? _ideaInsight;

  bool _contextLoading = false;

  String _contextError = '';
  String _error = '';
  String _notice = '';

  @override
  void initState() {
    super.initState();

    _report = Map<String, dynamic>.from(widget.report);

    _tab = widget.initialTab;

    _status = _string(_report['status'], fallback: 'REVIEWING').toUpperCase();

    _adminNote = TextEditingController(text: _string(_report['adminNote']));

    if (_tab != _ReportDrawerTab.review) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _loadContext(_tab);
        }
      });
    }
  }

  @override
  void dispose() {
    _adminNote.dispose();
    _publisherMessage.dispose();
    _reporterMessage.dispose();
    super.dispose();
  }

  void _close() {
    if (_busy) {
      return;
    }

    Navigator.pop(context, _changed);
  }

  Future<void> _selectTab(_ReportDrawerTab tab) async {
    if (_tab == tab) {
      return;
    }

    setState(() {
      _tab = tab;
      _contextError = '';
    });

    await _loadContext(tab);
  }

  Future<void> _loadContext(_ReportDrawerTab tab) async {
    if (tab == _ReportDrawerTab.review) {
      return;
    }

    final publication = _map(_report['publication']);

    final ideaId = _string(publication['ideaId']);

    if (ideaId.isEmpty) {
      if (mounted) {
        setState(() {
          _contextError = 'This report is not linked to an idea record.';
        });
      }

      return;
    }

    if (tab == _ReportDrawerTab.details && _ideaDetail != null) {
      return;
    }

    if (tab == _ReportDrawerTab.insights && _ideaInsight != null) {
      return;
    }

    setState(() {
      _contextLoading = true;
      _contextError = '';
    });

    try {
      final payload = await _api.getDetail(
        tab == _ReportDrawerTab.details
            ? '/admin/ideas/$ideaId/quick-detail'
            : '/admin/ideas/$ideaId/publication-insights',
      );

      final value = payload['data'] is Map ? _map(payload['data']) : payload;

      if (!mounted) {
        return;
      }

      setState(() {
        if (tab == _ReportDrawerTab.details) {
          _ideaDetail = value;
        } else {
          _ideaInsight = value;
        }
      });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _contextError = error.message;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _contextLoading = false;
        });
      }
    }
  }

  Future<void> _save() async {
    final id = _string(_report['id']);

    if (id.isEmpty || _busy) {
      return;
    }

    if (_action == 'WARN_PUBLISHER' &&
        _publisherMessage.text.trim().length < 5) {
      setState(() {
        _error = 'Write the notification that should be sent to the publisher.';
      });

      return;
    }

    setState(() {
      _busy = true;
      _error = '';
      _notice = '';
    });

    try {
      final result = await _api.reviewPublicationReport(
        id,
        status: _status,
        moderationAction: _action,
        adminNote: _adminNote.text,
        publisherMessage: _publisherMessage.text,
        notifyReporter: _notifyReporter,
        reporterMessage: _reporterMessage.text,
      );

      final resultData = result['data'] is Map ? _map(result['data']) : result;

      final updated = _map(resultData['report']);

      final currentPublication = _map(_report['publication']);

      final currentReporter = _map(_report['reporter']);

      final currentReviewedBy = _map(_report['reviewedBy']);

      final publisherNotified = _asBool(
        resultData['publisherNotifiedThisReview'] ??
            resultData['publisherNotified'] ??
            updated['publisherNotified'],
      );

      final reporterNotified = _asBool(
        resultData['reporterNotifiedThisReview'] ??
            resultData['reporterNotified'] ??
            updated['reporterNotified'],
      );

      final publisherMessage = _publisherMessage.text.trim();
      final reporterMessage = _reporterMessage.text.trim();

      final merged = <String, dynamic>{
        ..._report,
        if (updated.isNotEmpty) ...updated,
        'publication': currentPublication,
        'reporter': currentReporter,
        'reviewedBy': updated['reviewedBy'] ?? currentReviewedBy,
        'publisherNotified': updated['publisherNotified'] ?? publisherNotified,
        'reporterNotified': updated['reporterNotified'] ?? reporterNotified,
        if (publisherMessage.isNotEmpty &&
            _string(updated['publisherMessage']).isEmpty)
          'publisherMessage': publisherMessage,
        if (reporterMessage.isNotEmpty &&
            _string(updated['reporterMessage']).isEmpty)
          'reporterMessage': reporterMessage,
      };

      final noticeParts = <String>[
        '${_readable(_status)} · ${_moderationActionLabel(_action)}',
        if (publisherNotified) 'publisher notified',
        if (reporterNotified) 'reporter notified',
      ];

      if (!mounted) {
        return;
      }

      setState(() {
        _report = merged;

        _status = _string(merged['status'], fallback: _status).toUpperCase();

        _action = 'NONE';

        _publisherMessage.clear();
        _reporterMessage.clear();

        _changed = true;
        _notice = noticeParts.join(' · ');
      });

      await widget.onChanged(merged);

      if (!mounted) {
        return;
      }

      Future.delayed(const Duration(seconds: 4), () {
        if (mounted) {
          setState(() {
            _notice = '';
          });
        }
      });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final publication = _map(_report['publication']);

    final title = _firstText([
      publication['publicTitle'],
      publication['title'],
    ], fallback: 'Publication report');

    return DraggableScrollableSheet(
      initialChildSize: .95,
      minChildSize: .68,
      maxChildSize: .985,
      builder: (context, controller) {
        return Container(
          margin: const EdgeInsets.fromLTRB(7, 2, 7, 7),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(30),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .12),
                blurRadius: 38,
                offset: const Offset(0, 18),
              ),
            ],
          ),
          child: Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 8, 7),
                child: Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.pinkSoft,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: const Icon(
                        Icons.gavel_rounded,
                        size: 18,
                        color: AppColors.danger,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'REPORT REVIEW',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 7.4,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .8,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 13.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${_readable(_string(_report['reason']))} · ${_formatDate(_report['createdAt'])}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 7.7,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: _busy ? null : _close,
                      icon: const Icon(Icons.close_rounded, size: 20),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 13),
                child: _DrawerTabs(selected: _tab, onSelected: _selectTab),
              ),
              const SizedBox(height: 5),
              Expanded(child: _buildTabBody(controller)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTabBody(ScrollController controller) {
    if (_contextLoading && _tab != _ReportDrawerTab.review) {
      return ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(15, 22, 15, 32),
        children: const [_ContextLoading()],
      );
    }

    if (_contextError.isNotEmpty && _tab != _ReportDrawerTab.review) {
      return ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(15, 22, 15, 32),
        children: [
          _InlineError(message: _contextError),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () {
              _loadContext(_tab);
            },
            icon: const Icon(Icons.refresh_rounded, size: 17),
            label: const Text('Try again'),
          ),
        ],
      );
    }

    return switch (_tab) {
      _ReportDrawerTab.review => _buildReview(controller),
      _ReportDrawerTab.details => _buildIdeaDetails(controller),
      _ReportDrawerTab.insights => _buildInsights(controller),
    };
  }

  Widget _buildReview(ScrollController controller) {
    final publication = _map(_report['publication']);

    final reporter = _map(_report['reporter']);

    final publisher = _map(publication['publisher']);

    final reviewedBy = _map(_report['reviewedBy']);

    final hasHistory =
        _report['reviewedAt'] != null ||
        _string(_report['moderationAction']).isNotEmpty ||
        _string(_report['publisherMessage']).isNotEmpty ||
        _string(_report['reporterMessage']).isNotEmpty;

    return ListView(
      controller: controller,
      padding: EdgeInsets.fromLTRB(
        14,
        8,
        14,
        MediaQuery.viewInsetsOf(context).bottom + 26,
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF8FA),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(
                  Icons.flag_outlined,
                  size: 16,
                  color: AppColors.danger,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'REPORTED FOR',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .55,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _readable(_string(_report['reason'], fallback: 'REPORT')),
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _string(
                        _report['details'],
                        fallback: 'No additional details were provided.',
                      ),
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.8,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 8),

        Row(
          children: [
            Expanded(
              child: _PersonCard(
                label: 'Reporter',
                name: _firstText([
                  reporter['fullName'],
                  reporter['email'],
                ], fallback: 'Member'),
                email: _string(reporter['email'], fallback: '—'),
                icon: Icons.person_outline_rounded,
              ),
            ),
            const SizedBox(width: 7),
            Expanded(
              child: _PersonCard(
                label: 'Publisher',
                name: _firstText([
                  publisher['fullName'],
                  publisher['email'],
                ], fallback: 'Publisher'),
                email: _string(publisher['email'], fallback: '—'),
                icon: Icons.campaign_outlined,
              ),
            ),
          ],
        ),

        if (hasHistory) ...[
          const SizedBox(height: 9),
          _ModerationHistory(report: _report, reviewedBy: reviewedBy),
        ],

        const SizedBox(height: 15),

        const _StepHeader(
          step: '1',
          icon: Icons.auto_awesome_outlined,
          title: 'Publication action',
          subtitle: 'Choose what should happen to this publication.',
        ),

        const SizedBox(height: 9),

        ..._moderationActions.map(
          (action) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: _ModerationActionTile(
              data: action,
              selected: _action == action.key,
              onTap: _busy
                  ? null
                  : () {
                      setState(() {
                        _action = action.key;
                      });
                    },
            ),
          ),
        ),

        const SizedBox(height: 10),

        const _StepHeader(
          step: '2',
          icon: Icons.notifications_none_rounded,
          title: 'Notifications',
          subtitle: 'Send clear updates to the people involved.',
        ),

        const SizedBox(height: 8),

        _EditorCard(
          label: 'Message to publisher',
          hint: _action == 'WARN_PUBLISHER'
              ? 'Write the warning the publisher will receive…'
              : 'Optional message for the publisher…',
          controller: _publisherMessage,
          icon: Icons.campaign_outlined,
        ),

        const SizedBox(height: 8),

        _ReporterNotificationCard(
          enabled: _notifyReporter,
          disabled: _busy,
          controller: _reporterMessage,
          onChanged: (value) {
            setState(() {
              _notifyReporter = value;
            });
          },
        ),

        const SizedBox(height: 15),

        const _StepHeader(
          step: '3',
          icon: Icons.shield_outlined,
          title: 'Report workflow',
          subtitle: 'Update the report status and leave an internal note.',
        ),

        const SizedBox(height: 9),

        _ReportStatusSelector(
          value: _status,
          disabled: _busy,
          onChanged: (value) {
            setState(() {
              _status = value;
            });
          },
        ),

        const SizedBox(height: 8),

        _EditorCard(
          label: 'Internal moderation note',
          hint: 'Optional note for audit and future reviewers…',
          controller: _adminNote,
          icon: Icons.edit_note_rounded,
        ),

        if (_error.isNotEmpty) ...[
          const SizedBox(height: 9),
          _InlineError(message: _error),
        ],

        if (_notice.isNotEmpty) ...[
          const SizedBox(height: 9),
          _SuccessNotice(message: _notice),
        ],

        const SizedBox(height: 13),

        // ------------------------------------------------
        // NEW APPLY DECISION SECTION
        // ------------------------------------------------
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFF5FAF8),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0xFFD8E9E3)),
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
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFDCEBE6)),
                    ),
                    child: const Icon(
                      Icons.fact_check_outlined,
                      size: 17,
                      color: AppColors.primaryDark,
                    ),
                  ),

                  const SizedBox(width: 9),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'CURRENT DECISION',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 6.8,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .65,
                          ),
                        ),

                        const SizedBox(height: 3),

                        Text(
                          '${_readable(_status)} · ${_moderationActionLabel(_action)}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 9.6,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 11),

              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton(
                  onPressed: _busy ? null : _save,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primaryDark,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: AppColors.primaryDark.withValues(
                      alpha: .48,
                    ),
                    disabledForegroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        width: 30,
                        height: 30,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .15),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: _busy
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(
                                Icons.check_rounded,
                                size: 18,
                                color: Colors.white,
                              ),
                      ),

                      const SizedBox(width: 9),

                      Text(
                        _busy ? 'Applying decision…' : 'Apply decision',
                        style: const TextStyle(
                          fontSize: 11.2,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .05,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 7),

              const Center(
                child: Text(
                  'Save the selected moderation status and notification settings.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.8,
                    height: 1.3,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildIdeaDetails(ScrollController controller) {
    final idea = _ideaDetail ?? const <String, dynamic>{};

    final domain = _map(idea['domain']);

    final run = _map(idea['generationRun']);

    final publication = _map(_report['publication']);

    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(15, 8, 15, 30),
      children: [
        Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFFEAF6F3), Color(0xFFFFF7F9)],
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            children: [
              const AdminIconBadge(
                icon: Icons.auto_awesome_outlined,
                size: 40,
                tone: Colors.white,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'IDEA RECORD',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .75,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _firstText([
                        idea['title'],
                        publication['publicTitle'],
                      ], fallback: 'Idea'),
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_string(domain['name'], fallback: 'Unassigned domain')} · ${_readable(_string(idea['generationType']))}',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.6,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 9),
        _MetaStrip(
          items: [
            _MetaItem(
              label: 'Access',
              value: _asBool(idea['isUnlocked']) ? 'Unlocked' : 'Locked',
            ),
            _MetaItem(
              label: 'Pipeline',
              value: _readable(_string(run['status'], fallback: '—')),
            ),
            _MetaItem(
              label: 'Created',
              value: _formatDate(idea['createdAt'], short: true),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _TextSection(
          title: 'Problem statement',
          value: _string(
            idea['problemStatement'],
            fallback: 'No problem statement is available.',
          ),
        ),
        const SizedBox(height: 8),
        _TextSection(
          title: 'Abstract',
          value: _firstText([
            idea['fullAbstract'],
            idea['partialAbstract'],
            idea['limitedAbstract'],
            publication['publicAbstract'],
          ], fallback: 'No abstract is available.'),
        ),
        const SizedBox(height: 8),
        _TextSection(
          title: 'Objectives',
          value: _displayList(
            idea['objectives'],
            fallback: 'No objectives are available.',
          ),
        ),
        const SizedBox(height: 8),
        _TextSection(
          title: 'Target users',
          value: _displayList(
            idea['targetUsers'],
            fallback: 'No target-user information is available.',
          ),
        ),
      ],
    );
  }

  Widget _buildInsights(ScrollController controller) {
    final idea = _ideaInsight ?? const <String, dynamic>{};

    final publication = _map(idea['publication']);

    final count = _map(publication['_count']);

    final feedback = _list(publication['feedback']);

    final reportPublication = _map(_report['publication']);

    return ListView(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(15, 8, 15, 30),
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final gap = 7.0;

            final width = (constraints.maxWidth - gap) / 2;

            final metrics = [
              _InsightMetric(
                icon: Icons.star_outline_rounded,
                value: _asDouble(
                  publication['averageRating'],
                ).toStringAsFixed(1),
                label: 'rating',
              ),
              _InsightMetric(
                icon: Icons.thumb_up_alt_outlined,
                value: '${_asInt(publication['upvotesCount'])}',
                label: 'upvotes',
              ),
              _InsightMetric(
                icon: Icons.thumb_down_alt_outlined,
                value: '${_asInt(publication['downvotesCount'])}',
                label: 'downvotes',
              ),
              _InsightMetric(
                icon: Icons.chat_bubble_outline_rounded,
                value: '${_asInt(publication['feedbackCount'])}',
                label: 'feedback',
              ),
            ];

            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: metrics
                  .map(
                    (item) => SizedBox(
                      width: width,
                      child: _InsightMetricCard(data: item),
                    ),
                  )
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFCFEFD),
            borderRadius: BorderRadius.circular(19),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(
                    Icons.public_rounded,
                    size: 17,
                    color: AppColors.primaryDark,
                  ),
                  SizedBox(width: 7),
                  Text(
                    'Publication snapshot',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 11.3,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _SnapshotRow(
                label: 'Status',
                value: _readable(_string(publication['status'], fallback: '—')),
              ),
              _SnapshotRow(
                label: 'Visibility',
                value: _readable(
                  _string(publication['visibility'], fallback: '—'),
                ),
              ),
              _SnapshotRow(
                label: 'Published',
                value: _formatDate(publication['publishedAt']),
              ),
              _SnapshotRow(
                label: 'Reports',
                value:
                    '${_asInt(publication['reportsCount'] ?? count['reports'])}',
              ),
              const Divider(height: 18),
              Text(
                _firstText([
                  publication['publicAbstract'],
                  reportPublication['publicAbstract'],
                ], fallback: 'No public abstract is available.'),
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.4,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(12),
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
                    Icons.chat_bubble_outline_rounded,
                    size: 16,
                    color: AppColors.primaryDark,
                  ),
                  SizedBox(width: 7),
                  Text(
                    'Recent feedback',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 11.2,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              if (feedback.isEmpty)
                const Text(
                  'No written feedback yet.',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 9.3),
                )
              else
                ...feedback.take(5).map((item) {
                  final row = _map(item);

                  final user = _map(row['user']);

                  return Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 7),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.background.withValues(alpha: .62),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _string(
                            user['fullName'],
                            fallback: 'Community member',
                          ),
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 9.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _string(row['comment'], fallback: '—'),
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  );
                }),
            ],
          ),
        ),
      ],
    );
  }
}

class _DrawerTabs extends StatelessWidget {
  const _DrawerTabs({required this.selected, required this.onSelected});

  final _ReportDrawerTab selected;

  final ValueChanged<_ReportDrawerTab> onSelected;

  @override
  Widget build(BuildContext context) {
    final items = const [
      (_ReportDrawerTab.review, 'Review', Icons.flag_outlined),
      (_ReportDrawerTab.details, 'Idea details', Icons.visibility_outlined),
      (_ReportDrawerTab.insights, 'Insights', Icons.auto_awesome_outlined),
    ];

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F8F6),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: items.map((item) {
          final active = selected == item.$1;

          return Expanded(
            child: Material(
              color: active ? Colors.white : Colors.transparent,
              borderRadius: BorderRadius.circular(11),
              child: InkWell(
                onTap: () {
                  onSelected(item.$1);
                },
                borderRadius: BorderRadius.circular(11),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(11),
                    boxShadow: active
                        ? [
                            BoxShadow(
                              color: AppColors.primaryDeep.withValues(
                                alpha: .05,
                              ),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ]
                        : null,
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
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          item.$2,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: active
                                ? AppColors.primaryDark
                                : AppColors.textMuted,
                            fontSize: 8.2,
                            fontWeight: active
                                ? FontWeight.w900
                                : FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
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

class _ReportStatusSelector extends StatelessWidget {
  const _ReportStatusSelector({
    required this.value,
    required this.onChanged,
    required this.disabled,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    const statuses = [
      ('PENDING', 'Pending', Color(0xFFD89B59)),
      ('REVIEWING', 'Reviewing', AppColors.primaryDark),
      ('RESOLVED', 'Resolved', Color(0xFF3FA678)),
      ('DISMISSED', 'Dismissed', Color(0xFFC96B85)),
    ];

    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F8F6),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: statuses.map((item) {
          final selected = value == item.$1;

          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Material(
                color: selected ? Colors.white : Colors.transparent,
                borderRadius: BorderRadius.circular(13),
                child: InkWell(
                  onTap: disabled ? null : () => onChanged(item.$1),
                  borderRadius: BorderRadius.circular(13),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    height: 50,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 3,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(13),
                      border: selected
                          ? Border.all(color: item.$3.withValues(alpha: .24))
                          : null,
                      boxShadow: selected
                          ? [
                              BoxShadow(
                                color: AppColors.primaryDeep.withValues(
                                  alpha: .045,
                                ),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              ),
                            ]
                          : null,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              width: 6,
                              height: 6,
                              decoration: BoxDecoration(
                                color: item.$3,
                                shape: BoxShape.circle,
                              ),
                            ),
                            if (selected) ...[
                              const SizedBox(width: 4),
                              Icon(
                                Icons.check_rounded,
                                size: 11,
                                color: item.$3,
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 5),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            item.$2,
                            maxLines: 1,
                            style: TextStyle(
                              color: selected
                                  ? AppColors.textPrimary
                                  : AppColors.textMuted,
                              fontSize: 8,
                              fontWeight: selected
                                  ? FontWeight.w900
                                  : FontWeight.w700,
                            ),
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

class _ReporterNotificationCard extends StatelessWidget {
  const _ReporterNotificationCard({
    required this.enabled,
    required this.onChanged,
    required this.controller,
    required this.disabled,
  });

  final bool enabled;
  final ValueChanged<bool> onChanged;
  final TextEditingController controller;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: enabled ? const Color(0xFFF1F8F6) : const Color(0xFFFBFCFC),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: enabled
              ? const Color(0xFFD5E8E1)
              : AppColors.border.withValues(alpha: .65),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: enabled
                      ? AppColors.primarySoft
                      : const Color(0xFFF0F3F2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  Icons.notifications_none_rounded,
                  size: 16,
                  color: enabled ? AppColors.primaryDark : AppColors.textMuted,
                ),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Notify reporter',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 1),
                    Text(
                      'Send an update about this moderation result.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.6,
                      ),
                    ),
                  ],
                ),
              ),
              Transform.scale(
                scale: .88,
                child: Switch.adaptive(
                  value: enabled,
                  onChanged: disabled ? null : onChanged,
                  activeTrackColor: AppColors.primary,
                ),
              ),
            ],
          ),
          if (enabled) ...[
            const SizedBox(height: 7),
            TextField(
              controller: controller,
              minLines: 2,
              maxLines: 3,
              maxLength: 1000,
              decoration: const InputDecoration(
                hintText: 'Optional message for the reporter…',
                counterText: '',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PersonCard extends StatelessWidget {
  const _PersonCard({
    required this.label,
    required this.name,
    required this.email,
    required this.icon,
  });

  final String label;
  final String name;
  final String email;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: const Color(0xFFFAFCFB),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
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
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .4,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.7,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.1,
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

class _ModerationHistory extends StatelessWidget {
  const _ModerationHistory({required this.report, required this.reviewedBy});

  final Map<String, dynamic> report;
  final Map<String, dynamic> reviewedBy;

  @override
  Widget build(BuildContext context) {
    final publisherNotified = _asBool(report['publisherNotified']);
    final reporterNotified = _asBool(report['reporterNotified']);

    final publisherMessage = _string(
      report['publisherMessage'],
      fallback: 'No message has been sent to the publisher yet.',
    );

    final reporterMessage = _string(
      report['reporterMessage'],
      fallback: 'No resolution message has been sent to the reporter yet.',
    );

    final adminNote = _string(
      report['adminNote'],
      fallback: 'No internal moderation note.',
    );

    final reviewerName = _string(reviewedBy['fullName']);

    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F8F6),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border.withValues(alpha: .7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.history_rounded,
                  size: 16,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'LAST ADMIN ACTION & COMMUNICATIONS',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 6.6,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .55,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _reportActionLabel(report),
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Reviewed ${_formatDate(report['reviewedAt'])}'
                      '${reviewerName.isNotEmpty ? ' by $reviewerName' : ''}',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.4,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              AdminStatusChip(_string(report['status'], fallback: 'PENDING')),
            ],
          ),
          const SizedBox(height: 9),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _HistoryBadge(
                label: publisherNotified
                    ? 'Publisher notified'
                    : 'Publisher not notified',
                sent: publisherNotified,
              ),
              _HistoryBadge(
                label: reporterNotified
                    ? 'Reporter notified'
                    : 'Reporter not notified',
                sent: reporterNotified,
              ),
            ],
          ),
          const SizedBox(height: 9),
          _HistoryMessageCard(
            label: 'Message sent to publisher',
            sent: publisherNotified,
            message: publisherMessage,
            icon: Icons.campaign_outlined,
          ),
          const SizedBox(height: 7),
          _HistoryMessageCard(
            label: 'Message sent to reporter',
            sent: reporterNotified,
            message: reporterMessage,
            icon: Icons.mark_email_read_outlined,
          ),
          const SizedBox(height: 7),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .84),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(
                      Icons.lock_outline_rounded,
                      size: 13,
                      color: AppColors.textMuted,
                    ),
                    SizedBox(width: 5),
                    Text(
                      'INTERNAL NOTE',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .45,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  adminNote,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.3,
                    height: 1.4,
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

class _HistoryBadge extends StatelessWidget {
  const _HistoryBadge({required this.label, required this.sent});

  final String label;
  final bool sent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: sent ? const Color(0xFFEAF7F0) : const Color(0xFFF2F4F3),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(
          color: sent
              ? AppColors.success.withValues(alpha: .16)
              : AppColors.border,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            sent ? Icons.check_circle_rounded : Icons.remove_circle_outline,
            size: 11,
            color: sent ? AppColors.success : AppColors.textMuted,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: sent ? AppColors.success : AppColors.textMuted,
              fontSize: 6.8,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryMessageCard extends StatelessWidget {
  const _HistoryMessageCard({
    required this.label,
    required this.sent,
    required this.message,
    required this.icon,
  });

  final String label;
  final bool sent;
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .84),
        borderRadius: BorderRadius.circular(13),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: AppColors.primaryDark),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .42,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(
                  color: sent
                      ? const Color(0xFFEAF7F0)
                      : const Color(0xFFF1F3F2),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  sent ? 'Sent' : 'Not sent',
                  style: TextStyle(
                    color: sent ? AppColors.success : AppColors.textMuted,
                    fontSize: 6.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            message,
            style: TextStyle(
              color: sent ? AppColors.textSecondary : AppColors.textMuted,
              fontSize: 8.2,
              height: 1.4,
              fontStyle: sent ? FontStyle.normal : FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({
    required this.step,
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final String step;
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 35,
              height: 35,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.primarySoft,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, size: 16, color: AppColors.primaryDark),
            ),
            Positioned(
              right: -4,
              top: -5,
              child: Container(
                width: 15,
                height: 15,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppColors.primaryDark,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  step,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 7,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
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
                  fontSize: 10.8,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.8,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ModerationActionTile extends StatelessWidget {
  const _ModerationActionTile({
    required this.data,
    required this.selected,
    required this.onTap,
  });

  final _ModerationActionData data;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? data.tone.withValues(alpha: .58)
          : const Color(0xFFFBFCFC),
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 170),
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: selected
                ? Border.all(color: data.accent.withValues(alpha: .28))
                : null,
          ),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: data.tone,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(data.icon, size: 15, color: data.accent),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      data.label,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.3,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      data.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.5,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 5),
              Icon(
                selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                size: 17,
                color: selected ? data.accent : AppColors.silver,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EditorCard extends StatelessWidget {
  const _EditorCard({
    required this.label,
    required this.hint,
    required this.controller,
    required this.icon,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFBFCFC),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border.withValues(alpha: .7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: AppColors.primaryDark),
              const SizedBox(width: 5),
              Text(
                label.toUpperCase(),
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .4,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          TextField(
            controller: controller,
            minLines: 2,
            maxLines: 3,
            maxLength: 1000,
            decoration: InputDecoration(hintText: hint, counterText: ''),
          ),
        ],
      ),
    );
  }
}

class _MetaStrip extends StatelessWidget {
  const _MetaStrip({required this.items});

  final List<_MetaItem> items;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < items.length; i++) ...[
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
              decoration: BoxDecoration(
                color: const Color(0xFFFCFEFD),
                borderRadius: BorderRadius.circular(15),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    items[i].label.toUpperCase(),
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 6.7,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    items[i].value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 8.7,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (i != items.length - 1) const SizedBox(width: 6),
        ],
      ],
    );
  }
}

class _TextSection extends StatelessWidget {
  const _TextSection({required this.title, required this.value});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFEFD),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10.4,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.2,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _InsightMetricCard extends StatelessWidget {
  const _InsightMetricCard({required this.data});

  final _InsightMetric data;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFEFD),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(data.icon, size: 16, color: AppColors.primaryDark),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                data.value,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                data.label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.8,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SnapshotRow extends StatelessWidget {
  const _SnapshotRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
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

class _ContextLoading extends StatelessWidget {
  const _ContextLoading();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 17,
            height: 17,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 9),
          Text(
            'Loading idea context…',
            style: TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9.5,
              fontWeight: FontWeight.w900,
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
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 16,
            color: AppColors.danger,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.danger,
                fontSize: 8.9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SuccessNotice extends StatelessWidget {
  const _SuccessNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF7F0),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.verified_rounded,
            size: 16,
            color: AppColors.success,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              'Moderation updated · $message',
              style: const TextStyle(
                color: AppColors.success,
                fontSize: 8.7,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SortOption {
  const _SortOption(this.key, this.label, this.icon);

  final String key;
  final String label;
  final IconData icon;
}

class _StatusFilter {
  const _StatusFilter(this.key, this.label);

  final String key;
  final String label;
}

class _ModerationActionData {
  const _ModerationActionData({
    required this.key,
    required this.label,
    required this.description,
    required this.icon,
    required this.tone,
    required this.accent,
  });

  final String key;
  final String label;
  final String description;
  final IconData icon;
  final Color tone;
  final Color accent;
}

class _MetaItem {
  const _MetaItem({required this.label, required this.value});

  final String label;
  final String value;
}

class _InsightMetric {
  const _InsightMetric({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;
}

const _reportStatusFilters = [
  _StatusFilter('', 'All reports'),
  _StatusFilter('PENDING', 'Pending'),
  _StatusFilter('REVIEWING', 'Reviewing'),
  _StatusFilter('RESOLVED', 'Resolved'),
  _StatusFilter('DISMISSED', 'Dismissed'),
];

const _reportSortOptions = [
  _SortOption('createdAt', 'Submitted date', Icons.schedule_rounded),
  _SortOption('status', 'Status', Icons.shield_outlined),
  _SortOption('reason', 'Reason', Icons.flag_outlined),
  _SortOption('publication', 'Publication title', Icons.article_outlined),
  _SortOption('reporter', 'Reporter', Icons.person_outline_rounded),
  _SortOption('reviewedAt', 'Reviewed date', Icons.verified_outlined),
];

const _moderationActions = [
  _ModerationActionData(
    key: 'NONE',
    label: 'No publication action',
    description: 'Only update the report workflow state.',
    icon: Icons.check_circle_outline_rounded,
    tone: Color(0xFFF1F5F3),
    accent: AppColors.textSecondary,
  ),
  _ModerationActionData(
    key: 'WARN_PUBLISHER',
    label: 'Notify publisher',
    description: 'Keep it live and send an administrator notice.',
    icon: Icons.notifications_active_outlined,
    tone: AppColors.primarySoft,
    accent: AppColors.primaryDark,
  ),
  _ModerationActionData(
    key: 'HIDE_PUBLICATION',
    label: 'Hide temporarily',
    description:
        'Remove it from discovery while keeping the publication record.',
    icon: Icons.visibility_off_outlined,
    tone: Color(0xFFFFF5E8),
    accent: AppColors.warning,
  ),
  _ModerationActionData(
    key: 'ARCHIVE_PUBLICATION',
    label: 'Unpublish',
    description: 'Archive it and remove it from community discovery.',
    icon: Icons.archive_outlined,
    tone: AppColors.pinkSoft,
    accent: AppColors.danger,
  ),
  _ModerationActionData(
    key: 'RESTORE_PUBLICATION',
    label: 'Restore / republish',
    description: 'Return a hidden or archived publication to the community.',
    icon: Icons.unarchive_outlined,
    tone: Color(0xFFEAF7F0),
    accent: AppColors.success,
  ),
];

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }

  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }

  return <String, dynamic>{};
}

List<dynamic> _list(dynamic value) {
  return value is List ? value : const [];
}

int _asInt(dynamic value) {
  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _asDouble(dynamic value) {
  if (value is num) {
    return value.toDouble();
  }

  return double.tryParse(value?.toString() ?? '') ?? 0;
}

bool _asBool(dynamic value) {
  if (value is bool) {
    return value;
  }

  final normalized = value?.toString().trim().toLowerCase();

  return normalized == 'true' || normalized == '1';
}

String _string(dynamic value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';

  return text.isEmpty ? fallback : text;
}

String _firstText(List<dynamic> values, {String fallback = ''}) {
  for (final value in values) {
    final text = _string(value);

    if (text.isNotEmpty) {
      return text;
    }
  }

  return fallback;
}

String _readable(String value) {
  final normalized = value.trim();

  if (normalized.isEmpty || normalized == '—') {
    return '—';
  }

  return normalized
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _formatDate(dynamic value, {bool short = false}) {
  if (value == null) {
    return '—';
  }

  final date = DateTime.tryParse(value.toString());

  if (date == null) {
    return '—';
  }

  final local = date.toLocal();

  return DateFormat(
    short ? 'MMM d, yyyy' : 'MMM d, yyyy · h:mm a',
  ).format(local);
}

String _displayList(dynamic value, {required String fallback}) {
  if (value is List) {
    final items = value
        .map((item) => _string(item))
        .where((item) => item.isNotEmpty)
        .toList();

    if (items.isNotEmpty) {
      return items.join(' • ');
    }
  }

  return _string(value, fallback: fallback);
}

String _sortLabel(String key) {
  for (final option in _reportSortOptions) {
    if (option.key == key) {
      return option.label;
    }
  }

  return _reportSortOptions.first.label;
}

String _moderationActionLabel(String key) {
  for (final action in _moderationActions) {
    if (action.key == key) {
      return action.label;
    }
  }

  return _readable(key);
}

String _reportActionLabel(Map<String, dynamic> report) {
  final stored = _string(report['moderationAction']);

  if (stored.isNotEmpty) {
    return _moderationActionLabel(stored);
  }

  final publication = _map(report['publication']);

  if (_string(publication['status']).toUpperCase() == 'ARCHIVED') {
    return 'Unpublish';
  }

  if (_asBool(publication['isHidden'])) {
    return 'Hide temporarily';
  }

  return report['reviewedAt'] != null
      ? 'No publication action'
      : 'Not reviewed';
}
