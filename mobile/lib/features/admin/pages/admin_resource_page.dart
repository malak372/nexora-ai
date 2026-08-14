import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../models/admin_resource.dart';
import '../widgets/admin_ui.dart';
import '../widgets/admin_user_management_sheet.dart';

/// Displays a generic administrative resource workspace.
///
/// The page is driven by an [AdminResourceDefinition], allowing the
/// same interface to support multiple administrative resources such as
/// users, ideas, domains, AI models, payments, alerts, and audit data.
///
/// It supports:
/// - Paginated list retrieval.
/// - Resource summaries.
/// - Debounced searching.
/// - Resource-specific status filtering.
/// - Pull-to-refresh and manual refresh.
/// - Generic detail sheets.
/// - Active/inactive state management for supported resources.
/// - Embedded and standalone presentation modes.
/// - Loading, empty, and error states.
///
/// Resource-specific API paths, sorting behavior, statuses, and
/// additional query parameters are provided through [resource].
///
/// @author Eman
class AdminResourcePage extends StatefulWidget {
  /// Creates a generic administrative resource page.
  ///
  /// When [embedded] is `true`, only the main page content is returned
  /// so the workspace can be displayed inside another administrative
  /// shell.
  const AdminResourcePage({
    super.key,
    required this.resource,
    this.embedded = false,
  });

  /// Defines the resource metadata and backend configuration used
  /// by this page.
  final AdminResourceDefinition resource;

  /// Determines whether this page is rendered inside another admin page.
  ///
  /// Embedded pages do not display their own scaffold or back button.
  final bool embedded;

  @override
  State<AdminResourcePage> createState() => _AdminResourcePageState();
}

/// Manages resource loading, searching, filtering, pagination,
/// detail navigation, and status changes for [AdminResourcePage].
///
/// @author Eman
class _AdminResourcePageState extends State<AdminResourcePage> {
  /// Shared administrative API service.
  final _api = AdminApi.instance;

  /// Controller for the generic resource search field.
  final _searchController = TextEditingController();

  /// Timer used to debounce search requests.
  Timer? _searchDebounce;

  /// Resource records displayed on the current page.
  List<Map<String, dynamic>> _items = const [];

  /// Latest summary information returned for the resource.
  Map<String, dynamic> _summary = const {};

  /// Current pagination page.
  int _page = 1;

  /// Total number of matching records.
  int _total = 0;

  /// Total number of available pages.
  int _totalPages = 1;

  /// Current normalized search query.
  String _search = '';

  /// Current resource status filter.
  ///
  /// An empty value means no status filter is active.
  String _status = '';

  /// Active sorting configuration. Users can change this from the mobile
  /// toolbar; other generic resources keep their configured defaults.
  late String _sortBy;
  late String _sortOrder;

  bool _exporting = false;

  /// Indicates whether the primary resource list is loading.
  bool _loading = true;

  /// Indicates whether existing resource data is being refreshed.
  bool _refreshing = false;

  /// Latest resource-loading error message.
  String _error = '';

  /// Guards the UI from older list requests finishing after a newer search,
  /// filter or page request.
  int _loadRequestId = 0;

  /// Loads the initial resource data.
  @override
  void initState() {
    super.initState();
    _sortBy = widget.resource.sortBy;
    _sortOrder = widget.resource.sortOrder;
    _load();
  }

  /// Cancels the active search debounce and releases the search
  /// controller when the page is disposed.
  @override
  void dispose() {
    _searchDebounce?.cancel();

    _searchController.dispose();

    super.dispose();
  }

  /// Retrieves the current resource list and optional summary.
  ///
  /// Resource-specific status filters are converted to the backend
  /// query format expected by each endpoint.
  ///
  /// For example:
  /// - Users, data sources, domains, and AI models use `isActive`.
  /// - AI monitoring and authentication audit use `isSuccess`.
  /// - Alerts use `isRead`.
  ///
  /// Parameters:
  /// - [force]: Bypasses cached API responses when `true`.
  /// - [quiet]: Uses the refresh state instead of the full loading state.
  Future<void> _load({bool force = false, bool quiet = false}) async {
    final requestId = ++_loadRequestId;

    if (!quiet) {
      setState(() {
        _loading = true;
        _error = '';
      });
    } else {
      setState(() {
        _refreshing = true;
        _error = '';
      });
    }

    String? serverStatus = _status.isEmpty ? null : _status;
    final extraQuery = <String, dynamic>{...widget.resource.extraQuery};

    if (_status.isNotEmpty) {
      switch (widget.resource.id) {
        case 'users':
          if (_status == 'DELETED') {
            extraQuery['deletedOnly'] = 'true';
          } else {
            extraQuery['isActive'] = _status == 'ACTIVE' ? 'true' : 'false';
          }
          serverStatus = null;
          break;
        case 'data-sources':
        case 'domains':
        case 'ai-models':
          extraQuery['isActive'] = _status == 'ACTIVE' ? 'true' : 'false';
          serverStatus = null;
          break;
        case 'ai-monitoring':
        case 'auth-audit':
          extraQuery['isSuccess'] = _status == 'SUCCESS' ? 'true' : 'false';
          serverStatus = null;
          break;
        case 'alerts':
          extraQuery['isRead'] = _status == 'READ' ? 'true' : 'false';
          serverStatus = null;
          break;
      }
    }

    // Paint the list as soon as it arrives. Summary cards hydrate separately
    // so a slower aggregate endpoint never blocks the directory itself.
    if (widget.resource.summaryPath != null) {
      unawaited(
        _api
            .getSummary(
              widget.resource.summaryPath!,
              force: force,
              query: widget.resource.id == 'users'
                  ? {if (_search.isNotEmpty) 'search': _search, ...extraQuery}
                  : const {},
            )
            .then((summary) {
              if (!mounted || requestId != _loadRequestId) return;
              setState(() => _summary = summary);
            })
            .catchError((_) {
              // The resource list stays usable even when summary hydration fails.
            }),
      );
    }

    try {
      final listPayload = await _api.getList(
        widget.resource.listPath,
        page: _page,
        limit: 20,
        search: _search,
        status: serverStatus,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: extraQuery,
      );

      final rows = (listPayload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

      final meta = listPayload['meta'] is Map
          ? Map<String, dynamic>.from(listPayload['meta'] as Map)
          : <String, dynamic>{};

      if (!mounted || requestId != _loadRequestId) return;

      setState(() {
        _items = rows;
        _total = _int(meta['total'] ?? rows.length);
        _totalPages = _int(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted || requestId != _loadRequestId) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted || requestId != _loadRequestId) return;
      setState(() {
        _error = 'Could not load ${widget.resource.title.toLowerCase()}.';
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

  /// Handles changes to the resource search field.
  ///
  /// Search requests are delayed by 320 milliseconds to reduce
  /// unnecessary backend requests while the administrator is typing.
  ///
  /// Changing the search query resets pagination to the first page.
  void _onSearchChanged(String value) {
    setState(() {});

    _searchDebounce?.cancel();

    _searchDebounce = Timer(const Duration(milliseconds: 320), () {
      final next = value.trim();

      if (next == _search) {
        return;
      }

      setState(() {
        _search = next;
        _page = 1;
      });

      _load();
    });
  }

  Future<void> _openUserSort() async {
    if (widget.resource.id != 'users') return;

    const options = <(String, String, IconData)>[
      ('createdAt', 'Joined date', Icons.calendar_month_outlined),
      ('fullName', 'Name', Icons.badge_outlined),
      ('email', 'Email', Icons.alternate_email_rounded),
      ('accountStatus', 'Plan', Icons.workspace_premium_outlined),
      ('userType', 'User type', Icons.person_outline_rounded),
      ('creditBalance', 'Credits', Icons.toll_outlined),
      ('freeGenerationsUsed', 'Free usage', Icons.auto_awesome_outlined),
      ('isActive', 'Active status', Icons.power_settings_new_rounded),
      ('isVerified', 'Verification', Icons.verified_outlined),
    ];

    final selected = await showModalBottomSheet<(String, String)>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _UserSortSheet(
        options: options,
        selected: _sortBy,
        order: _sortOrder,
      ),
    );

    if (!mounted || selected == null) return;
    if (selected.$1 == _sortBy && selected.$2 == _sortOrder) return;

    setState(() {
      _sortBy = selected.$1;
      _sortOrder = selected.$2;
      _page = 1;
    });
    _load();
  }

  Future<void> _exportUsersCsv() async {
    if (_exporting || widget.resource.id != 'users') return;

    final renderObject = context.findRenderObject();
    final box = renderObject is RenderBox ? renderObject : null;

    setState(() => _exporting = true);
    try {
      final bytes = await _api.exportUsersCsv(
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        isActive: _status == 'ACTIVE'
            ? true
            : _status == 'INACTIVE'
                ? false
                : null,
        deletedOnly: _status == 'DELETED',
      );

      if (!mounted) return;
      if (bytes.isEmpty) {
        throw const ApiException('The Users CSV export was empty.');
      }

      await SharePlus.instance.share(
        ShareParams(
          files: [
            XFile.fromData(
              Uint8List.fromList(bytes),
              mimeType: 'text/csv',
              name: 'admin-users.csv',
            ),
          ],
          fileNameOverrides: const ['admin-users.csv'],
          subject: 'Voxidence users export',
          sharePositionOrigin:
              box == null ? null : box.localToGlobal(Offset.zero) & box.size,
          downloadFallbackEnabled: true,
        ),
      );
    } on ApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  /// Opens the resource status-filter bottom sheet.
  ///
  /// Available filter options are defined by
  /// [AdminResourceDefinition.statuses].
  ///
  /// Selecting a new status resets pagination and reloads the resource.
  Future<void> _openFilters() async {
    String draftStatus = _status;

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final options = <String>['', ...widget.resource.statuses];

            return Container(
              margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(30),
                border: Border.all(color: Colors.white),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: .14),
                    blurRadius: 34,
                    offset: const Offset(0, 14),
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
                  Row(
                    children: [
                      const AdminIconBadge(
                        icon: Icons.filter_alt_outlined,
                        size: 43,
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Filter ${widget.resource.title.toLowerCase()}',
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 18.5,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.35,
                              ),
                            ),
                            const SizedBox(height: 3),
                            const Text(
                              'Choose one status, then apply when ready.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.8,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Material(
                        color: AppColors.surfaceMuted,
                        borderRadius: BorderRadius.circular(13),
                        child: InkWell(
                          onTap: () => Navigator.pop(sheetContext),
                          borderRadius: BorderRadius.circular(13),
                          child: const SizedBox(
                            width: 38,
                            height: 38,
                            child: Icon(
                              Icons.close_rounded,
                              size: 20,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted.withValues(alpha: .72),
                      borderRadius: BorderRadius.circular(22),
                      border: Border.all(
                        color: AppColors.border.withValues(alpha: .8),
                      ),
                    ),
                    child: Column(
                      children: [
                        for (var index = 0; index < options.length; index++) ...[
                          _StatusFilterTile(
                            label: options[index].isEmpty
                                ? 'All ${widget.resource.title.toLowerCase()}'
                                : _readable(options[index]),
                            subtitle: _statusFilterSubtitle(options[index]),
                            icon: _statusFilterIcon(options[index]),
                            selected: draftStatus == options[index],
                            onTap: () {
                              setSheetState(() {
                                draftStatus = options[index];
                              });
                            },
                          ),
                          if (index != options.length - 1)
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 9),
                              child: Divider(
                                height: 1,
                                color: AppColors.border.withValues(alpha: .48),
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () {
                            setSheetState(() => draftStatus = '');
                          },
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(46),
                            foregroundColor: AppColors.textSecondary,
                            side: BorderSide(color: AppColors.border),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(15),
                            ),
                          ),
                          child: const Text('Reset'),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        flex: 2,
                        child: FilledButton.icon(
                          onPressed: () {
                            Navigator.pop(sheetContext, draftStatus);
                          },
                          icon: const Icon(Icons.check_rounded, size: 18),
                          label: const Text('Apply filter'),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(46),
                            backgroundColor: AppColors.surface,
                            foregroundColor: AppColors.primaryDeep,
                            disabledBackgroundColor: AppColors.surface,
                            disabledForegroundColor: AppColors.textMuted,
                            side: BorderSide(
                              color: AppColors.primary.withValues(alpha: .34),
                            ),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(15),
                            ),
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

    if (!mounted || selected == null || selected == _status) {
      return;
    }

    setState(() {
      _status = selected;
      _page = 1;
    });

    _load();
  }

  IconData _statusFilterIcon(String status) {
    return switch (status.toUpperCase()) {
      '' => Icons.view_list_rounded,
      'ACTIVE' => Icons.check_circle_outline_rounded,
      'INACTIVE' => Icons.pause_circle_outline_rounded,
      'DELETED' => Icons.inventory_2_outlined,
      'SUCCESS' => Icons.task_alt_rounded,
      'FAILED' => Icons.error_outline_rounded,
      'READ' => Icons.mark_email_read_outlined,
      'UNREAD' => Icons.mark_email_unread_outlined,
      'PENDING' => Icons.schedule_rounded,
      'REVIEWING' => Icons.manage_search_rounded,
      'RESOLVED' => Icons.verified_outlined,
      'DISMISSED' => Icons.block_outlined,
      _ => Icons.label_outline_rounded,
    };
  }

  String _statusFilterSubtitle(String status) {
    return switch (status.toUpperCase()) {
      '' => 'No status restriction',
      'ACTIVE' => 'Accounts currently allowed to use the platform',
      'INACTIVE' => 'Accounts whose access is currently disabled',
      'DELETED' => 'Soft-deleted accounts retained for audit and history',
      'SUCCESS' => 'Successful records only',
      'FAILED' => 'Failed records only',
      'READ' => 'Items already reviewed or opened',
      'UNREAD' => 'Items still waiting to be reviewed',
      'PENDING' => 'Items waiting for action',
      'REVIEWING' => 'Items currently under review',
      'RESOLVED' => 'Items with a completed decision',
      'DISMISSED' => 'Items closed without further action',
      _ => 'Show only ${_readable(status).toLowerCase()} records',
    };
  }

  /// Opens the detail sheet for a selected resource record.
  ///
  /// If the resource provides a [AdminResourceDefinition.detailPathBuilder],
  /// an additional backend request is attempted to retrieve the full
  /// resource details.
  ///
  /// If detail retrieval fails, the existing list record is used as
  /// a fallback.
  Future<void> _openItem(Map<String, dynamic> item) async {
    final id = _string(item['id'] ?? item['userId']);

    // Users open immediately from the already-loaded row snapshot. The sheet
    // refreshes full details in the background so tapping a user never waits
    // on an extra HTTP round trip before showing feedback.
    if (widget.resource.id == 'users') {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
        builder: (context) => AdminUserManagementSheet(
          user: item,
          onChanged: () => _load(force: true, quiet: true),
        ),
      );
      return;
    }

    var detail = item;
    String? detailPath;

    if (id.isNotEmpty && widget.resource.detailPathBuilder != null) {
      detailPath = widget.resource.detailPathBuilder!(id);
    }

    if (detailPath != null) {
      try {
        final loaded = await _api.getDetail(detailPath);
        if (loaded.isNotEmpty) {
          detail = {...item, ...loaded};
        }
      } catch (_) {
        detail = item;
      }
    }

    if (!mounted) {
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _ResourceDetailSheet(
        resource: widget.resource,
        item: detail,
        onStatusToggle:
            _supportsStatusToggle(widget.resource.id) && id.isNotEmpty
            ? (value) async {
                await _toggleStatus(item, value);

                if (context.mounted) {
                  Navigator.pop(context);
                }
              }
            : null,
      ),
    );
  }

  /// Returns whether a resource supports direct active/inactive
  /// state changes from its detail sheet.
  bool _supportsStatusToggle(String id) {
    return id == 'users' ||
        id == 'data-sources' ||
        id == 'domains' ||
        id == 'ai-models';
  }

  /// Activates or deactivates a supported administrative resource.
  ///
  /// The correct backend operation is selected according to the current
  /// resource identifier.
  ///
  /// A success or error snackbar is displayed after the operation.
  /// Successful changes trigger a quiet forced refresh of the resource.
  Future<void> _toggleStatus(Map<String, dynamic> item, bool active) async {
    final id = _string(item['id']);

    if (id.isEmpty) {
      return;
    }

    try {
      switch (widget.resource.id) {
        case 'users':
          await _api.setUserStatus(id, active);
          break;

        case 'data-sources':
          await _api.setDataSourceStatus(id, active);
          break;

        case 'domains':
          await _api.setDomainStatus(id, active);
          break;

        case 'ai-models':
          await _api.setAiModelStatus(id, active);
          break;
      }

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            active ? 'Activated successfully.' : 'Deactivated successfully.',
          ),
        ),
      );

      await _load(force: true, quiet: true);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  String _userSortLabel(String value) {
    return switch (value) {
      'createdAt' => 'Joined date',
      'fullName' => 'Name',
      'email' => 'Email',
      'accountStatus' => 'Plan',
      'userType' => 'User type',
      'creditBalance' => 'Credits',
      'freeGenerationsUsed' => 'Free usage',
      'isActive' => 'Active status',
      'isVerified' => 'Verification',
      _ => _readable(value),
    };
  }

  /// Builds the generic administrative resource interface.
  ///
  /// The Ideas workspace receives a dedicated visual treatment using
  /// the project's warm surfaces, eucalyptus green, turquoise and
  /// restrained rose accents.
  ///
  /// @author Eman
  @override
  Widget build(BuildContext context) {
    final isIdeas = widget.resource.id == 'ideas';

    final content = RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: () {
        return _load(force: true, quiet: true);
      },
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
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
                  title: widget.resource.title,
                  subtitle: widget.resource.subtitle,
                  eyebrow: widget.resource.eyebrow,
                  icon: widget.resource.icon,
                  onBack: widget.embedded
                      ? null
                      : () {
                          Navigator.maybePop(context);
                        },
                  trailing: _refreshing
                      ? const SizedBox(
                          width: 44,
                          height: 44,
                          child: Center(
                            child: SizedBox(
                              width: 19,
                              height: 19,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.primaryDark,
                              ),
                            ),
                          ),
                        )
                      : IconButton(
                          onPressed: () {
                            _load(force: true, quiet: true);
                          },
                          style: IconButton.styleFrom(
                            backgroundColor: isIdeas
                                ? AppColors.primarySoft
                                : AppColors.surfaceMuted,
                            foregroundColor: AppColors.primaryDeep,
                            fixedSize: const Size(44, 44),
                            side: BorderSide(
                              color: isIdeas
                                  ? AppColors.primary.withValues(alpha: .14)
                                  : AppColors.border,
                            ),
                          ),
                          icon: const Icon(Icons.refresh_rounded, size: 20),
                        ),
                ),

                const SizedBox(height: 18),

                // ========================================================
                // IDEAS SUMMARY
                // ========================================================
                if (isIdeas) ...[
                  _IdeasSummaryCard(total: _total),
                  const SizedBox(height: 16),
                ] else if (_summary.isNotEmpty) ...[
                  if (widget.resource.id == 'users')
                    _UserSummaryOverview(summary: _summary, total: _total)
                  else
                    _SummaryStrip(summary: _summary, total: _total),

                  const SizedBox(height: 14),
                ],

                // ========================================================
                // SEARCH + FILTER
                // ========================================================
                Row(
                  children: [
                    Expanded(
                      child: AdminSearchField(
                        controller: _searchController,
                        hint: 'Search ${widget.resource.title.toLowerCase()}…',
                        onChanged: _onSearchChanged,
                        onSubmitted: (_) {},
                      ),
                    ),

                    if (widget.resource.statuses.isNotEmpty) ...[
                      const SizedBox(width: 8),

                      SizedBox(
                        width: 48,
                        height: 48,
                        child: FilledButton.tonal(
                          onPressed: _openFilters,
                          style: FilledButton.styleFrom(
                            backgroundColor: _status.isNotEmpty
                                ? AppColors.pinkSoft
                                : AppColors.primarySoft,
                            foregroundColor: _status.isNotEmpty
                                ? AppColors.pinkDeep
                                : AppColors.primaryDark,
                            padding: EdgeInsets.zero,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(15),
                            ),
                          ),
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              const Icon(Icons.tune_rounded, size: 20),
                              if (_status.isNotEmpty)
                                Positioned(
                                  right: -4,
                                  top: -5,
                                  child: Container(
                                    width: 8,
                                    height: 8,
                                    decoration: const BoxDecoration(
                                      color: AppColors.pink,
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),

                const SizedBox(height: 10),

                if (widget.resource.id == 'users') ...[
                  Row(
                    children: [
                      Expanded(
                        child: Material(
                          color: AppColors.background.withValues(alpha: .72),
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            onTap: _openUserSort,
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              height: 46,
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
                                          'SORT USERS',
                                          style: TextStyle(
                                            color: AppColors.textMuted,
                                            fontSize: 5.9,
                                            fontWeight: FontWeight.w900,
                                            letterSpacing: .65,
                                          ),
                                        ),
                                        const SizedBox(height: 1),
                                        Text(
                                          _userSortLabel(_sortBy),
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
                                    _sortOrder == 'asc'
                                        ? Icons.arrow_upward_rounded
                                        : Icons.arrow_downward_rounded,
                                    size: 15,
                                    color: AppColors.primaryDark,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        height: 46,
                        child: OutlinedButton.icon(
                          onPressed: _exporting ? null : _exportUsersCsv,
                          icon: _exporting
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.download_rounded, size: 17),
                          label: Text(_exporting ? 'Preparing…' : 'CSV'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                ] else
                  const SizedBox(height: 4),

                if (_status.isNotEmpty) ...[
                  Align(
                    alignment: Alignment.centerLeft,
                    child: InputChip(
                      backgroundColor: AppColors.surfaceRose,
                      side: BorderSide(
                        color: AppColors.pink.withValues(alpha: .18),
                      ),
                      label: Text(
                        _readable(_status),
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      onDeleted: () {
                        setState(() {
                          _status = '';
                          _page = 1;
                        });

                        _load();
                      },
                      deleteIcon: const Icon(Icons.close_rounded, size: 15),
                    ),
                  ),

                  const SizedBox(height: 8),
                ],

                // ========================================================
                // BODY
                // ========================================================
                if (_loading)
                  const AdminLoadingList()
                else if (_error.isNotEmpty && _items.isEmpty)
                  AdminEmptyState(
                    title: 'Could not load this workspace',
                    message: _error,
                    icon: Icons.cloud_off_outlined,
                    onRetry: () {
                      _load(force: true);
                    },
                  )
                else if (_items.isEmpty)
                  AdminEmptyState(
                    title: 'Nothing to review here',
                    message: _search.isNotEmpty || _status.isNotEmpty
                        ? 'Try changing the search or filter.'
                        : 'No records are currently available.',
                    icon: widget.resource.icon,
                  )
                else ...[
                  // ======================================================
                  // RESULTS META
                  // ======================================================
                  Row(
                    children: [
                      if (isIdeas) ...[
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: AppColors.pink,
                            shape: BoxShape.circle,
                          ),
                        ),

                        const SizedBox(width: 7),
                      ],

                      Text(
                        '$_total records',
                        style: TextStyle(
                          color: isIdeas
                              ? AppColors.textSecondary
                              : AppColors.textMuted,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),

                      const Spacer(),

                      if (_totalPages > 1)
                        Container(
                          padding: isIdeas
                              ? const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 6,
                                )
                              : EdgeInsets.zero,
                          decoration: isIdeas
                              ? BoxDecoration(
                                  color: AppColors.surfaceRose,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: AppColors.pink.withValues(
                                      alpha: .10,
                                    ),
                                  ),
                                )
                              : null,
                          child: Text(
                            'Page $_page of $_totalPages',
                            style: TextStyle(
                              color: isIdeas
                                  ? AppColors.primaryDeep
                                  : AppColors.textMuted,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                    ],
                  ),

                  const SizedBox(height: 10),

                  // ======================================================
                  // RECORD CARDS
                  // ======================================================
                  ..._items.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: 11),
                      child: _ResourceCard(
                        resource: widget.resource,
                        item: item,
                        onTap: () {
                          _openItem(item);
                        },
                      ),
                    ),
                  ),

                  // ======================================================
                  // PAGINATION
                  // ======================================================
                  if (_totalPages > 1) ...[
                    const SizedBox(height: 4),

                    _PaginationBar(
                      page: _page,
                      totalPages: _totalPages,
                      onPrevious: _page <= 1
                          ? null
                          : () {
                              setState(() {
                                _page -= 1;
                              });

                              _load();
                            },
                      onNext: _page >= _totalPages
                          ? null
                          : () {
                              setState(() {
                                _page += 1;
                              });

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
    );

    if (widget.embedded) {
      return content;
    }

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(child: SafeArea(child: content)),
    );
  }

  /// Safely converts an arbitrary value into an integer.
  int _int(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  /// Safely converts an arbitrary value into a trimmed string.
  String _string(dynamic value) => value?.toString().trim() ?? '';

  /// Converts a backend enum-style value into a readable title.
  String _readable(String value) {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }
}

/// Displays the Users overview in a single structured panel.
///
/// The mobile version deliberately does not use four disconnected cards.
/// All account counters live inside one clean 2×2 panel.
///
/// @author Eman
class _UserSummaryOverview extends StatelessWidget {
  const _UserSummaryOverview({required this.summary, required this.total});

  /// Summary response returned by `/admin/users/summary`.
  final Map<String, dynamic> summary;

  /// Current list total used as a safe fallback.
  final int total;

  @override
  Widget build(BuildContext context) {
    final raw = summary['data'] is Map
        ? Map<String, dynamic>.from(summary['data'] as Map)
        : summary;

    final metrics = <_UserSummaryMetric>[
      _UserSummaryMetric(
        label: 'Total users',
        value: _readCount(raw, const ['totalUsers', 'total'], fallback: total),
        icon: Icons.groups_2_rounded,
        tone: AppColors.primary,
      ),
      _UserSummaryMetric(
        label: 'Active users',
        value: _readCount(raw, const ['activeUsers', 'active']),
        icon: Icons.person_rounded,
        tone: AppColors.primaryDark,
      ),
      _UserSummaryMetric(
        label: 'Inactive users',
        value: _readCount(raw, const ['inactiveUsers', 'inactive']),
        icon: Icons.person_off_rounded,
        tone: AppColors.pinkDeep,
      ),
      _UserSummaryMetric(
        label: 'Verified users',
        value: _readCount(raw, const [
          'verifiedUsers',
          'verified',
          'emailVerifiedUsers',
        ]),
        icon: Icons.verified_rounded,
        tone: AppColors.primary,
      ),
    ];

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.sage.withValues(alpha: .28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(15, 13, 15, 10),
            child: Row(
              children: [
                Icon(
                  Icons.insights_rounded,
                  size: 16,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 7),
                Text(
                  'User snapshot',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Spacer(),
                Text(
                  'Live overview',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Divider(
            height: 1,
            thickness: 1,
            color: AppColors.sage.withValues(alpha: .18),
          ),
          IntrinsicHeight(
            child: Row(
              children: [
                Expanded(child: _UserSummaryCell(metric: metrics[0])),
                VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: AppColors.sage.withValues(alpha: .18),
                ),
                Expanded(child: _UserSummaryCell(metric: metrics[1])),
              ],
            ),
          ),
          Divider(
            height: 1,
            thickness: 1,
            color: AppColors.sage.withValues(alpha: .18),
          ),
          IntrinsicHeight(
            child: Row(
              children: [
                Expanded(child: _UserSummaryCell(metric: metrics[2])),
                VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: AppColors.sage.withValues(alpha: .18),
                ),
                Expanded(child: _UserSummaryCell(metric: metrics[3])),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Reads a numeric summary value from any supported backend key.
  int _readCount(
    Map<String, dynamic> source,
    List<String> keys, {
    int fallback = 0,
  }) {
    for (final key in keys) {
      final value = source[key];

      if (value is int) {
        return value;
      }

      if (value is num) {
        return value.toInt();
      }

      final parsed = int.tryParse(value?.toString() ?? '');

      if (parsed != null) {
        return parsed;
      }
    }

    return fallback;
  }
}

/// Visual model for one Users summary metric.
///
/// @author Eman
class _UserSummaryMetric {
  const _UserSummaryMetric({
    required this.label,
    required this.value,
    required this.icon,
    required this.tone,
  });

  final String label;

  final int value;

  final IconData icon;

  final Color tone;
}

/// One metric inside the shared Users snapshot.
///
/// @author Eman
class _UserSummaryCell extends StatelessWidget {
  const _UserSummaryCell({required this.metric});

  final _UserSummaryMetric metric;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 13, 12, 14),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: metric.tone.withValues(alpha: .10),
              shape: BoxShape.circle,
            ),
            child: Icon(metric.icon, size: 17, color: metric.tone),
          ),

          const SizedBox(width: 10),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _formatCount(metric.value),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    height: 1,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.35,
                  ),
                ),

                const SizedBox(height: 5),

                Text(
                  metric.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.5,
                    height: 1.15,
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

  String _formatCount(int value) {
    final digits = value.toString();

    final output = StringBuffer();

    for (var index = 0; index < digits.length; index++) {
      if (index > 0 && (digits.length - index) % 3 == 0) {
        output.write(',');
      }

      output.write(digits[index]);
    }

    return output.toString();
  }
}

/// Displays the Ideas total using the project palette.
///
/// The design uses the project's warm surface, eucalyptus green,
/// turquoise accent and a tiny soft-rose detail.
///
/// No leaves or unrelated decorative artwork are used.
///
/// @author Eman
class _IdeasSummaryCard extends StatelessWidget {
  const _IdeasSummaryCard({required this.total});

  /// Total number of generated ideas.
  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 86,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            AppColors.surfaceRose.withValues(alpha: .72),
            AppColors.primarySoft.withValues(alpha: .96),
          ],
          stops: const [0, .48, 1],
        ),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .82),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 20,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: Stack(
          children: [
            // Subtle project-related bulb watermark.
            Positioned(
              right: -6,
              top: -18,
              child: Icon(
                Icons.lightbulb_outline_rounded,
                size: 112,
                color: AppColors.primary.withValues(alpha: .055),
              ),
            ),

            // Very small rose accent from the project palette.
            Positioned(
              right: 23,
              bottom: 14,
              child: Container(
                width: 6,
                height: 6,
                decoration: const BoxDecoration(
                  color: AppColors.pink,
                  shape: BoxShape.circle,
                ),
              ),
            ),

            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surface.withValues(alpha: .90),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: .12),
                      ),
                    ),
                    child: const Icon(
                      Icons.lightbulb_outline_rounded,
                      size: 24,
                      color: AppColors.primaryDark,
                    ),
                  ),

                  const SizedBox(width: 13),

                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _formatCount(total),
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 24,
                          height: 1,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.7,
                        ),
                      ),

                      const SizedBox(height: 5),

                      const Text(
                        'Total ideas',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                        ),
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

  /// Formats large values using thousands separators.
  String _formatCount(int value) {
    final digits = value.toString();

    final output = StringBuffer();

    for (var index = 0; index < digits.length; index++) {
      if (index > 0 && (digits.length - index) % 3 == 0) {
        output.write(',');
      }

      output.write(digits[index]);
    }

    return output.toString();
  }
}

/// Displays a compact horizontal summary of non-Users resources.
///
/// @author Eman
class _SummaryStrip extends StatelessWidget {
  const _SummaryStrip({required this.summary, required this.total});

  final Map<String, dynamic> summary;

  final int total;

  @override
  Widget build(BuildContext context) {
    final raw = summary['data'] is Map
        ? Map<String, dynamic>.from(summary['data'] as Map)
        : summary;

    final metrics = <MapEntry<String, dynamic>>[];

    for (final entry in raw.entries) {
      if (entry.value is num && !entry.key.toLowerCase().contains('id')) {
        metrics.add(entry);
      }

      if (metrics.length == 3) {
        break;
      }
    }

    if (metrics.isEmpty) {
      metrics.add(MapEntry('total', total));
    }

    return SizedBox(
      height: 86,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: metrics.length,
        separatorBuilder: (_, _) => const SizedBox(width: 9),
        itemBuilder: (context, index) {
          final metric = metrics[index];

          return Container(
            width: 130,
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: index == 1 ? AppColors.pinkSoft : AppColors.primarySoft,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _formatNumber(metric.value),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 3),

                Text(
                  _label(metric.key),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  String _formatNumber(dynamic value) {
    if (value is num) {
      if (value is double && value % 1 != 0) {
        return value.toStringAsFixed(1);
      }

      return value.toInt().toString();
    }

    return value?.toString() ?? '0';
  }

  String _label(String key) {
    return key
        .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }
}

/// Purpose-built Users directory card.
///
/// It includes the important information exposed by the web Users table:
/// - Name.
/// - Email.
/// - Plan.
/// - Credit balance.
/// - Free generation usage.
/// - Active/inactive state.
/// - Verified/unverified state.
/// - User type.
/// - Joined date.
///
/// @author Eman
class _UserDirectoryCard extends StatelessWidget {
  const _UserDirectoryCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = _string(
      item['fullName'] ?? item['name'] ?? item['displayName'],
      fallback: 'Unnamed user',
    );

    final email = _string(item['email'], fallback: 'No email');

    final accountStatus = _string(
      item['accountStatus'] ?? item['plan'] ?? item['tier'],
      fallback: 'NORMAL',
    ).toUpperCase();

    final userType = _readable(
      _string(item['userType'] ?? item['type'], fallback: 'OTHER'),
    );

    final isDeleted = _string(item['deletedAt']).isNotEmpty;

    final isActive = !isDeleted && item['isActive'] != false;

    final isVerified =
        item['isVerified'] == true || item['emailVerified'] == true;

    final credits = _int(item['creditBalance'] ?? item['credits']);

    final freeUsed = _int(item['freeGenerationsUsed']);

    final freeLimit = _int(item['freeGenerationLimit'], fallback: 3);

    final joined = _formatDate(item['createdAt']);

    final isPremium = accountStatus == 'PREMIUM';

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminAvatar(
                name: name,
                avatarUrl: _string(
                  item['avatarUrl'] ??
                      item['profileImageUrl'] ??
                      item['profileImage'] ??
                      item['avatar'],
                ),
                size: 42,
              ),

              const SizedBox(width: 11),

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
                        fontSize: 13.4,
                        height: 1.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    const SizedBox(height: 4),

                    Text(
                      email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.1,
                        height: 1.3,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(width: 8),

              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: isPremium ? AppColors.pinkSoft : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isPremium
                          ? Icons.workspace_premium_rounded
                          : Icons.person_outline_rounded,
                      size: 12,
                      color: isPremium
                          ? AppColors.pinkDeep
                          : AppColors.primaryDark,
                    ),

                    const SizedBox(width: 4),

                    Text(
                      _readable(accountStatus),
                      style: TextStyle(
                        color: isPremium
                            ? AppColors.pinkDeep
                            : AppColors.primaryDark,
                        fontSize: 8.7,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted.withValues(alpha: .58),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _UserUsageValue(
                    icon: Icons.toll_rounded,
                    value: _formatNumber(credits),
                    label: 'Credits',
                  ),
                ),

                Container(
                  width: 1,
                  height: 30,
                  color: AppColors.sage.withValues(alpha: .22),
                ),

                Expanded(
                  child: _UserUsageValue(
                    icon: Icons.auto_awesome_rounded,
                    value: '$freeUsed / $freeLimit',
                    label: 'Free used',
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 10),

          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _UserInfoPill(
                icon: isDeleted
                    ? Icons.inventory_2_outlined
                    : isActive
                        ? Icons.check_circle_rounded
                        : Icons.pause_circle_rounded,
                label: isDeleted ? 'Deleted' : isActive ? 'Active' : 'Inactive',
                tone: isDeleted
                    ? AppColors.textMuted
                    : isActive
                        ? AppColors.primaryDark
                        : AppColors.pinkDeep,
              ),

              _UserInfoPill(
                icon: isVerified
                    ? Icons.verified_rounded
                    : Icons.unpublished_rounded,
                label: isVerified ? 'Verified' : 'Unverified',
                tone: isVerified ? AppColors.primaryDark : AppColors.textMuted,
              ),

              _UserInfoPill(
                icon: Icons.badge_outlined,
                label: userType,
                tone: AppColors.textSecondary,
              ),
            ],
          ),

          const SizedBox(height: 10),

          Row(
            children: [
              const Icon(
                Icons.calendar_today_rounded,
                size: 12,
                color: AppColors.textMuted,
              ),

              const SizedBox(width: 5),

              Expanded(
                child: Text(
                  joined.isEmpty ? 'Joined date unavailable' : 'Joined $joined',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),

              const SizedBox(width: 8),

              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 12,
                color: AppColors.sage,
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _string(dynamic value, {String fallback = ''}) {
    final normalized = value?.toString().trim() ?? '';

    return normalized.isEmpty ? fallback : normalized;
  }

  int _int(dynamic value, {int fallback = 0}) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? fallback;
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

  String _formatNumber(int value) {
    final digits = value.toString();

    final output = StringBuffer();

    for (var index = 0; index < digits.length; index++) {
      if (index > 0 && (digits.length - index) % 3 == 0) {
        output.write(',');
      }

      output.write(digits[index]);
    }

    return output.toString();
  }

  String _formatDate(dynamic value) {
    final text = value?.toString().trim() ?? '';

    if (text.isEmpty) {
      return '';
    }

    final parsed = DateTime.tryParse(text)?.toLocal();

    if (parsed == null) {
      return text;
    }

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

    return '${months[parsed.month - 1]} '
        '${parsed.day}, '
        '${parsed.year}';
  }
}

/// Compact value used inside the Users usage strip.
///
/// @author Eman
class _UserUsageValue extends StatelessWidget {
  const _UserUsageValue({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;

  final String value;

  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 14, color: AppColors.primaryDark),

        const SizedBox(width: 7),

        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 11.6,
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
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Small status/type pill used by a Users directory record.
///
/// @author Eman
class _UserInfoPill extends StatelessWidget {
  const _UserInfoPill({
    required this.icon,
    required this.label,
    required this.tone,
  });

  final IconData icon;

  final String label;

  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: .07),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: tone.withValues(alpha: .13)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11.5, color: tone),

          const SizedBox(width: 4),

          Text(
            label,
            style: TextStyle(
              color: tone,
              fontSize: 8.7,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// Purpose-built Ideas directory card.
///
/// The Ideas cards use the same project palette as the rest of the app:
/// warm surfaces, eucalyptus text, turquoise accents and a very small
/// rose accent.
///
/// No leaf graphics or unrelated decorative elements are used.
///
/// @author Eman
class _IdeaDirectoryCard extends StatelessWidget {
  const _IdeaDirectoryCard({required this.item, required this.onTap});

  /// Raw idea data returned by the admin API.
  final Map<String, dynamic> item;

  /// Called when the administrator opens this idea.
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = _title(item);

    final date = _date(item);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .98),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: AppColors.borderStrong.withValues(alpha: .82),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .035),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Stack(
              children: [
                // Project green accent.
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
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

                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 13, 14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              AppColors.primarySoft,
                              AppColors.surfaceRose.withValues(alpha: .78),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(15),
                          border: Border.all(
                            color: AppColors.primary.withValues(alpha: .11),
                          ),
                        ),
                        child: const Icon(
                          Icons.lightbulb_outline_rounded,
                          size: 23,
                          color: AppColors.primaryDark,
                        ),
                      ),

                      const SizedBox(width: 12),

                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 13.3,
                                height: 1.24,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.15,
                              ),
                            ),

                            const SizedBox(height: 7),

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
                                    date.isEmpty ? 'Date unavailable' : date,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: AppColors.textMuted,
                                      fontSize: 9.6,
                                      height: 1.2,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),

                                // Tiny rose accent from the project palette.
                                Container(
                                  width: 5,
                                  height: 5,
                                  decoration: const BoxDecoration(
                                    color: AppColors.pink,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(width: 9),

                      Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.primarySoft,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: AppColors.primary.withValues(alpha: .12),
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
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Resolves the best title available for an idea.
  String _title(Map<String, dynamic> data) {
    for (final key in const ['title', 'name', 'subject', 'description']) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isNotEmpty) {
        return value;
      }
    }

    return 'Idea record';
  }

  /// Resolves and formats the idea creation date.
  String _date(Map<String, dynamic> data) {
    for (final key in const ['createdAt', 'updatedAt', 'publishedAt']) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isEmpty) {
        continue;
      }

      final parsed = DateTime.tryParse(value)?.toLocal();

      if (parsed == null) {
        return value;
      }

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

      final hour = parsed.hour.toString().padLeft(2, '0');

      final minute = parsed.minute.toString().padLeft(2, '0');

      return '${months[parsed.month - 1]} '
          '${parsed.day}, '
          '${parsed.year} · '
          '$hour:$minute';
    }

    return '';
  }
}

/// Displays a single generic administrative resource record.
///
/// Users and Ideas use their dedicated layouts. All other resources
/// continue to use the generic card.
///
/// @author Eman
class _ResourceCard extends StatelessWidget {
  const _ResourceCard({
    required this.resource,
    required this.item,
    required this.onTap,
  });

  final AdminResourceDefinition resource;

  final Map<String, dynamic> item;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (resource.id == 'users') {
      return _UserDirectoryCard(item: item, onTap: onTap);
    }

    if (resource.id == 'ideas') {
      return _IdeaDirectoryCard(item: item, onTap: onTap);
    }

    final title = _title(item);

    final subtitle = _subtitle(item);

    final status = _status(item);

    final date = _date(item);

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AdminIconBadge(
            icon: resource.icon,
            size: 42,
            tone: resource.id == 'payments' || resource.id == 'credits'
                ? AppColors.pinkSoft
                : AppColors.primarySoft,
            iconColor: resource.id == 'payments' || resource.id == 'credits'
                ? AppColors.pinkDeep
                : AppColors.primaryDark,
          ),

          const SizedBox(width: 11),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13.2,
                          height: 1.25,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),

                    if (status.isNotEmpty) ...[
                      const SizedBox(width: 7),
                      AdminStatusChip(status),
                    ],
                  ],
                ),

                if (subtitle.isNotEmpty) ...[
                  const SizedBox(height: 5),

                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 10.5,
                      height: 1.4,
                    ),
                  ),
                ],

                if (date.isNotEmpty) ...[
                  const SizedBox(height: 7),

                  Row(
                    children: [
                      const Icon(
                        Icons.schedule_rounded,
                        size: 13,
                        color: AppColors.textMuted,
                      ),

                      const SizedBox(width: 4),

                      Expanded(
                        child: Text(
                          date,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9.4,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(width: 4),

          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Icon(
              Icons.arrow_forward_ios_rounded,
              size: 13,
              color: AppColors.sage,
            ),
          ),
        ],
      ),
    );
  }

  String _title(Map<String, dynamic> data) {
    for (final key in const [
      'title',
      'fullName',
      'name',
      'subject',
      'modelName',
      'providerName',
      'action',
      'type',
      'externalId',
      'email',
    ]) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isNotEmpty) {
        return value;
      }
    }

    final user = data['user'];

    if (user is Map) {
      final value = user['fullName']?.toString().trim() ?? '';

      if (value.isNotEmpty) {
        return value;
      }
    }

    return '${resource.title} record';
  }

  String _subtitle(Map<String, dynamic> data) {
    for (final key in const [
      'email',
      'description',
      'message',
      'sourceName',
      'provider',
      'domainName',
      'reason',
      'operation',
      'eventType',
    ]) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isNotEmpty && value != _title(data)) {
        return value;
      }
    }

    return '';
  }

  String _status(Map<String, dynamic> data) {
    for (final key in const ['status', 'state', 'paymentStatus']) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isNotEmpty) {
        return value;
      }
    }

    if (data['isActive'] is bool) {
      return data['isActive'] == true ? 'ACTIVE' : 'INACTIVE';
    }

    if (data['success'] is bool) {
      return data['success'] == true ? 'SUCCESS' : 'FAILED';
    }

    return '';
  }

  String _date(Map<String, dynamic> data) {
    for (final key in const [
      'createdAt',
      'updatedAt',
      'collectedAt',
      'publishedAt',
      'occurredAt',
      'startedAt',
    ]) {
      final value = data[key]?.toString().trim() ?? '';

      if (value.isEmpty) {
        continue;
      }

      final parsed = DateTime.tryParse(value)?.toLocal();

      if (parsed == null) {
        return value;
      }

      return '${_month(parsed.month)} '
          '${parsed.day}, '
          '${parsed.year} · '
          '${parsed.hour.toString().padLeft(2, '0')}:'
          '${parsed.minute.toString().padLeft(2, '0')}';
    }

    return '';
  }

  String _month(int month) => const [
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
  ][month - 1];
}

/// Displays the detailed information of a generic resource record.
///
/// @author Eman
class _ResourceDetailSheet extends StatefulWidget {
  const _ResourceDetailSheet({
    required this.resource,
    required this.item,
    required this.onStatusToggle,
  });

  final AdminResourceDefinition resource;

  final Map<String, dynamic> item;

  final Future<void> Function(bool value)? onStatusToggle;

  @override
  State<_ResourceDetailSheet> createState() => _ResourceDetailSheetState();
}

/// Manages mutable state for the administrative resource details.
///
/// @author Eman
class _ResourceDetailSheetState extends State<_ResourceDetailSheet> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final isActive =
        widget.item['isActive'] == true ||
        widget.item['active'] == true ||
        widget.item['status']?.toString().toUpperCase() == 'ACTIVE';

    final entries = _visibleEntries(widget.item);

    return DraggableScrollableSheet(
      initialChildSize: .78,
      minChildSize: .48,
      maxChildSize: .94,
      builder: (context, controller) => Container(
        margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: Colors.white),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
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

            Row(
              children: [
                AdminIconBadge(icon: widget.resource.icon, size: 44),

                const SizedBox(width: 11),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.resource.title,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .7,
                        ),
                      ),

                      const SizedBox(height: 3),

                      Text(
                        _bestTitle(widget.item),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  ),
                ),

                IconButton(
                  onPressed: () {
                    Navigator.pop(context);
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),

            if (widget.onStatusToggle != null) ...[
              const SizedBox(height: 16),

              AdminGlassCard(
                tint: AppColors.primarySoft.withValues(alpha: .72),
                child: Row(
                  children: [
                    const AdminIconBadge(
                      icon: Icons.power_settings_new_rounded,
                      size: 38,
                    ),

                    const SizedBox(width: 10),

                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Access state',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Enable or disable this record.',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.8,
                            ),
                          ),
                        ],
                      ),
                    ),

                    Switch.adaptive(
                      value: isActive,
                      onChanged: _busy
                          ? null
                          : (value) async {
                              setState(() {
                                _busy = true;
                              });

                              try {
                                await widget.onStatusToggle!(value);
                              } finally {
                                if (mounted) {
                                  setState(() {
                                    _busy = false;
                                  });
                                }
                              }
                            },
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 16),

            Text('Details', style: Theme.of(context).textTheme.titleMedium),

            const SizedBox(height: 9),

            ...entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.background.withValues(alpha: .72),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _prettyKey(entry.key),
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .35,
                        ),
                      ),

                      const SizedBox(height: 4),

                      SelectableText(
                        _displayValue(entry.value),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 11.2,
                          height: 1.4,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<MapEntry<String, dynamic>> _visibleEntries(Map<String, dynamic> item) {
    return item.entries
        .where((entry) {
          final value = entry.value;

          if (value == null) {
            return false;
          }

          if (value is Map || value is List) {
            return false;
          }

          if (value.toString().trim().isEmpty) {
            return false;
          }

          return true;
        })
        .take(24)
        .toList();
  }

  String _bestTitle(Map<String, dynamic> item) {
    for (final key in const [
      'title',
      'fullName',
      'name',
      'subject',
      'email',
      'type',
    ]) {
      final value = item[key]?.toString().trim() ?? '';

      if (value.isNotEmpty) {
        return value;
      }
    }

    return 'Record details';
  }

  String _prettyKey(String key) {
    return key
        .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
        .replaceAll('_', ' ')
        .toUpperCase();
  }

  String _displayValue(dynamic value) {
    if (value is bool) {
      return value ? 'Yes' : 'No';
    }

    return value.toString();
  }
}

/// Reusable filter option.
///
/// @author Eman
class _UserSortSheet extends StatefulWidget {
  const _UserSortSheet({
    required this.options,
    required this.selected,
    required this.order,
  });

  final List<(String, String, IconData)> options;
  final String selected;
  final String order;

  @override
  State<_UserSortSheet> createState() => _UserSortSheetState();
}

class _UserSortSheetState extends State<_UserSortSheet> {
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
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .86,
        ),
        padding: const EdgeInsets.fromLTRB(15, 10, 15, 16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .06),
              blurRadius: 24,
              offset: const Offset(0, 10),
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
            const SizedBox(height: 15),
            const Text(
              'Sort users',
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
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                physics: const BouncingScrollPhysics(),
                itemCount: widget.options.length,
                separatorBuilder: (_, _) => const SizedBox(height: 6),
                itemBuilder: (context, index) {
                  final option = widget.options[index];
                  final selected = option.$1 == _field;
                  return Material(
                    color: Colors.transparent,
                    borderRadius: BorderRadius.circular(14),
                    clipBehavior: Clip.antiAlias,
                    child: ListTile(
                      onTap: () => setState(() => _field = option.$1),
                    dense: true,
                    visualDensity: const VisualDensity(vertical: -2),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                      side: BorderSide(
                        color: selected
                            ? AppColors.primary.withValues(alpha: .18)
                            : AppColors.primaryDark.withValues(alpha: .05),
                      ),
                    ),
                    tileColor: selected
                        ? AppColors.primarySoft
                        : AppColors.background.withValues(alpha: .55),
                    leading: Icon(
                      option.$3,
                      color: selected
                          ? AppColors.primaryDeep
                          : AppColors.textMuted,
                      size: 18,
                    ),
                    title: Text(
                      option.$2,
                      style: TextStyle(
                        color: selected
                            ? AppColors.primaryDeep
                            : AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                      trailing: selected
                          ? const Icon(
                              Icons.check_circle_rounded,
                              size: 18,
                              color: AppColors.primaryDark,
                            )
                          : null,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _UserSortDirectionChoice(
                      label: 'Ascending',
                      icon: Icons.arrow_upward_rounded,
                      selected: _order == 'asc',
                      onTap: () => setState(() => _order = 'asc'),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _UserSortDirectionChoice(
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
                onPressed: () => Navigator.pop(context, (_field, _order)),
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

class _UserSortDirectionChoice extends StatelessWidget {
  const _UserSortDirectionChoice({
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
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected
                        ? AppColors.primaryDeep
                        : AppColors.textMuted,
                    fontSize: 8.7,
                    fontWeight: FontWeight.w800,
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

class _StatusFilterTile extends StatelessWidget {
  const _StatusFilterTile({
    required this.label,
    required this.subtitle,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? AppColors.primarySoft.withValues(alpha: .9)
          : Colors.transparent,
      borderRadius: BorderRadius.circular(17),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .32)
                  : Colors.transparent,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? Colors.white.withValues(alpha: .82)
                      : AppColors.surface,
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(
                    color: AppColors.border.withValues(alpha: .78),
                  ),
                ),
                child: Icon(
                  icon,
                  size: 18,
                  color: selected
                      ? AppColors.primaryDark
                      : AppColors.textSecondary,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: selected
                            ? AppColors.primaryDeep
                            : AppColors.textPrimary,
                        fontSize: 11.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.8,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? AppColors.primary : AppColors.surface,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? AppColors.primary : AppColors.border,
                  ),
                ),
                child: selected
                    ? const Icon(
                        Icons.check_rounded,
                        size: 15,
                        color: Colors.white,
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Pagination controls.
///
/// @author Eman
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
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: onPrevious,
            icon: const Icon(Icons.arrow_back_rounded, size: 17),
            label: const Text('Previous'),
          ),
        ),

        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            '$page / $totalPages',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),

        Expanded(
          child: FilledButton.tonalIcon(
            onPressed: onNext,
            icon: const Icon(Icons.arrow_forward_rounded, size: 17),
            label: const Text('Next'),
          ),
        ),
      ],
    );
  }
}
