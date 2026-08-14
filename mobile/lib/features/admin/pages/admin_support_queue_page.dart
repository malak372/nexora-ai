import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Defines the supported administrative support queue types.
///
/// The admin support workspace can operate in one of two modes:
/// - [complaints] for user complaints and resolution cases.
/// - [contact] for contact-inbox messages.
///
/// The selected type controls the API endpoints, available statuses,
/// labels, icons, and case-editing behavior used by
/// [AdminSupportQueuePage].
///
/// @author Eman
enum AdminSupportQueueType {
  /// Administrative queue containing user complaints.
  complaints,

  /// Administrative queue containing contact messages.
  contact,
}

/// Displays an administrative support-management queue.
///
/// The page can operate as either a complaints workspace or a contact
/// inbox according to the supplied [type].
///
/// It supports:
/// - Paginated queue retrieval.
/// - Summary statistics.
/// - Debounced searching.
/// - Status filtering.
/// - Pull-to-refresh.
/// - Manual refresh.
/// - Loading, empty, and error states.
/// - Case detail bottom sheets.
/// - Complaint status and priority updates.
/// - Contact-message responses.
/// - Embedded or standalone page presentation.
///
/// @author Eman
class AdminSupportQueuePage extends StatefulWidget {
  /// Creates an administrative support queue.
  ///
  /// When [embedded] is `true`, the page returns only its scrollable
  /// content so it can be displayed inside another administrative shell.
  const AdminSupportQueuePage({
    super.key,
    required this.type,
    this.embedded = false,
  });

  /// Determines whether the page displays complaints or contact messages.
  final AdminSupportQueueType type;

  /// Determines whether this page is rendered inside another page shell.
  ///
  /// Embedded pages do not display their own scaffold or back button.
  final bool embedded;

  @override
  State<AdminSupportQueuePage> createState() => _AdminSupportQueuePageState();
}

/// Manages support queue retrieval, filtering, searching, pagination,
/// and case navigation for [AdminSupportQueuePage].
///
/// @author Eman
class _AdminSupportQueuePageState extends State<AdminSupportQueuePage> {
  /// Shared administrative API service.
  final _api = AdminApi.instance;

  /// Controller for the support queue search input.
  final _searchController = TextEditingController();

  /// Timer used to debounce search requests.
  Timer? _debounce;

  /// Current page of support records.
  List<Map<String, dynamic>> _rows = const [];

  /// Summary information associated with the active support queue.
  Map<String, dynamic> _summary = const {};

  /// Current normalized search query.
  String _search = '';

  /// Currently selected status filter.
  ///
  /// An empty value means all statuses are included.
  String _status = '';

  /// Backend field currently used to sort complaint records.
  String _sortBy = 'createdAt';

  /// Current sort direction.
  String _sortOrder = 'desc';

  /// Indicates whether a CSV export is currently being prepared.
  bool _exporting = false;

  /// Monotonically increasing request id used to ignore stale responses.
  int _loadGeneration = 0;

  /// Current pagination page.
  int _page = 1;

  /// Total number of pages returned by the backend.
  int _totalPages = 1;

  /// Total number of matching queue records.
  int _total = 0;

  /// Indicates whether the main queue content is loading.
  bool _loading = true;

  /// Indicates whether existing queue data is being refreshed.
  bool _refreshing = false;

  /// Latest API error message.
  String _error = '';

  /// Returns `true` when the page is displaying complaint records.
  bool get _isComplaint => widget.type == AdminSupportQueueType.complaints;

  /// Returns the API endpoint associated with the selected queue type.
  String get _listPath =>
      _isComplaint ? '/admin/complaints' : '/admin/contact-messages';

  /// Returns the summary endpoint associated with the selected queue.
  String get _summaryPath => '$_listPath/summary';

  /// Loads the initial support queue data.
  @override
  void initState() {
    super.initState();

    _load();
  }

  /// Releases the search controller and active debounce timer.
  @override
  void dispose() {
    _debounce?.cancel();

    _searchController.dispose();

    super.dispose();
  }

  /// Retrieves the current support queue and summary information.
  ///
  /// The list is treated as the critical request and is retried automatically
  /// for temporary network/server failures. The summary is loaded separately,
  /// so a delayed summary can never prevent complaint rows from appearing.
  ///
  /// Parameters:
  /// - [force]: Bypasses cached API responses when `true`.
  /// - [quiet]: Uses the refresh state instead of the full loading state.
  Future<void> _load({bool force = false, bool quiet = false}) async {
    final generation = ++_loadGeneration;

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

    final listFuture = _loadListWithRetry(force: force);

    final summaryFuture = _loadSummaryWithRetry(
      force: force,
    ).then<Map<String, dynamic>?>((value) => value, onError: (_, _) => null);

    Map<String, dynamic>? list;

    ApiException? listError;

    try {
      list = await listFuture;
    } on ApiException catch (error) {
      listError = error;
    }

    if (!mounted || generation != _loadGeneration) {
      return;
    }

    if (list != null) {
      final items = (list['items'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

      final meta = list['meta'] is Map
          ? Map<String, dynamic>.from(list['meta'] as Map)
          : const <String, dynamic>{};

      setState(() {
        _rows = items;

        _total = _int(meta['total'] ?? items.length);

        _totalPages = _int(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();

        _error = '';

        _loading = false;
      });
    } else {
      setState(() {
        _error = listError?.message ?? 'Unable to load this queue.';

        _loading = false;
      });
    }

    final summary = await summaryFuture;

    if (!mounted || generation != _loadGeneration) {
      return;
    }

    if (summary != null) {
      setState(() {
        _summary = summary;
      });
    }

    if (mounted && generation == _loadGeneration) {
      setState(() {
        _loading = false;
        _refreshing = false;
      });
    }
  }

  /// Loads the current queue list with a small automatic retry for temporary
  /// failures. This removes the need for the user to manually press Retry
  /// when the first request races with session/network initialization.
  Future<Map<String, dynamic>> _loadListWithRetry({required bool force}) async {
    ApiException? lastError;

    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        return await _api.getList(
          _listPath,
          page: _page,
          limit: 20,
          search: _search,
          status: _status,
          sortBy: _sortBy,
          sortOrder: _sortOrder,
          force: force || attempt > 0,
        );
      } on ApiException catch (error) {
        lastError = error;

        if (!_isRetryable(error) || attempt == 2) {
          rethrow;
        }

        await Future<void>.delayed(
          Duration(milliseconds: attempt == 0 ? 420 : 850),
        );
      }
    }

    throw lastError ?? const ApiException('Unable to load this queue.');
  }

  /// Loads the queue summary independently from the main list.
  Future<Map<String, dynamic>> _loadSummaryWithRetry({
    required bool force,
  }) async {
    ApiException? lastError;

    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        return await _api.getSummary(
          _summaryPath,
          force: force || attempt > 0,
          query: {if (_search.isNotEmpty) 'search': _search},
        );
      } on ApiException catch (error) {
        lastError = error;

        if (!_isRetryable(error) || attempt == 1) {
          rethrow;
        }

        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
    }

    throw lastError ?? const ApiException('Unable to load queue summary.');
  }

  /// Returns whether an API error is likely to be temporary and worth retrying.
  bool _isRetryable(ApiException error) {
    final code = error.statusCode;

    return code == null ||
        code == 408 ||
        code == 429 ||
        (code >= 500 && code <= 599);
  }

  /// Handles search-field changes using a short debounce period.
  ///
  /// The visible search field can update immediately while the backend
  /// request is delayed by 300 milliseconds to avoid unnecessary
  /// requests during continuous typing.
  ///
  /// A new search automatically resets pagination to the first page.
  void _onSearch(String value) {
    setState(() {});

    _debounce?.cancel();

    _debounce = Timer(const Duration(milliseconds: 300), () {
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

  /// Opens a support record inside a modal case workspace.
  ///
  /// When the case is modified, the queue is refreshed and a clear success
  /// confirmation is displayed, matching the web behavior.
  Future<void> _openCase(Map<String, dynamic> item) async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _SupportCaseSheet(type: widget.type, item: item),
    );

    if (result != null && mounted) {
      final emailSent = result['emailSent'] == true;
      final emailRecipient = result['emailRecipient']?.toString().trim() ?? '';
      final backendMessage = result['message']?.toString().trim() ?? '';

      final notice = _isComplaint
          ? (backendMessage.isNotEmpty
                ? backendMessage
                : 'Complaint updated successfully.')
          : emailSent
          ? 'Reply saved and email sent${emailRecipient.isEmpty ? '' : ' to $emailRecipient'}.'
          : backendMessage.isNotEmpty
          ? backendMessage
          : 'Contact message updated successfully.';

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            content: Row(
              children: [
                const Icon(
                  Icons.check_circle_rounded,
                  color: Colors.white,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    notice,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        );

      await _load(force: true, quiet: true);
    }
  }

  /// Opens the status-filter selector for the active support queue.
  ///
  /// Complaint and contact queues use different status sets.
  ///
  /// Selecting a new status resets pagination to page one and reloads
  /// the queue.
  Future<void> _chooseStatus() async {
    final options = _isComplaint
        ? const <(String, String, String, IconData, Color)>[
            (
              '',
              'All cases',
              'Show every active complaint in the queue',
              Icons.view_list_rounded,
              AppColors.primaryDark,
            ),
            (
              'OPEN',
              'Open',
              'Waiting for administrator review',
              Icons.inbox_outlined,
              AppColors.primaryDark,
            ),
            (
              'IN_PROGRESS',
              'In progress',
              'Cases currently being handled',
              Icons.schedule_rounded,
              AppColors.warning,
            ),
            (
              'RESOLVED',
              'Resolved',
              'Completed complaint resolutions',
              Icons.check_circle_outline_rounded,
              AppColors.success,
            ),
            (
              'REJECTED',
              'Rejected',
              'Cases closed without further action',
              Icons.cancel_outlined,
              AppColors.danger,
            ),
          ]
        : const <(String, String, String, IconData, Color)>[
            (
              '',
              'All messages',
              'Show every active inbox message',
              Icons.view_list_rounded,
              AppColors.primaryDark,
            ),
            (
              'NEW',
              'New',
              'Messages waiting for review',
              Icons.mark_email_unread_outlined,
              AppColors.primaryDark,
            ),
            (
              'IN_PROGRESS',
              'In progress',
              'Messages currently being handled',
              Icons.schedule_rounded,
              AppColors.warning,
            ),
            (
              'REPLIED',
              'Replied',
              'Messages that received a response',
              Icons.mark_email_read_outlined,
              AppColors.success,
            ),
            (
              'CLOSED',
              'Closed',
              'Completed inbox conversations',
              Icons.task_alt_rounded,
              AppColors.textMuted,
            ),
          ];

    var draftStatus = _status;

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Container(
            margin: const EdgeInsets.all(10),
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
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .80,
              ),
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
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
                    Text(
                      _isComplaint ? 'Filter complaints' : 'Filter messages',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _isComplaint
                          ? 'Choose one case state, then apply it to the directory.'
                          : 'Choose one inbox state, then apply it to the directory.',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.3,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceMuted.withValues(alpha: .58),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: AppColors.border.withValues(alpha: .76),
                        ),
                      ),
                      child: Column(
                        children: [
                          for (var index = 0;
                              index < options.length;
                              index++) ...[
                            Material(
                              color: draftStatus == options[index].$1
                                  ? AppColors.primarySoft
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(14),
                              child: InkWell(
                                onTap: () {
                                  setSheetState(() {
                                    draftStatus = options[index].$1;
                                  });
                                },
                                borderRadius: BorderRadius.circular(14),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 10,
                                  ),
                                  child: Row(
                                    children: [
                                      Container(
                                        width: 35,
                                        height: 35,
                                        alignment: Alignment.center,
                                        decoration: BoxDecoration(
                                          color: AppColors.surface,
                                          borderRadius:
                                              BorderRadius.circular(12),
                                          border: Border.all(
                                            color: AppColors.border.withValues(
                                              alpha: .78,
                                            ),
                                          ),
                                        ),
                                        child: Icon(
                                          options[index].$4,
                                          size: 17,
                                          color: options[index].$5,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              options[index].$2,
                                              style: TextStyle(
                                                color: draftStatus ==
                                                        options[index].$1
                                                    ? AppColors.primaryDeep
                                                    : AppColors.textPrimary,
                                                fontSize: 10.6,
                                                fontWeight: FontWeight.w900,
                                              ),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              options[index].$3,
                                              style: const TextStyle(
                                                color: AppColors.textMuted,
                                                fontSize: 8.6,
                                                height: 1.35,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      AnimatedContainer(
                                        duration:
                                            const Duration(milliseconds: 160),
                                        width: 24,
                                        height: 24,
                                        alignment: Alignment.center,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          color: draftStatus ==
                                                  options[index].$1
                                              ? AppColors.primary
                                              : AppColors.surface,
                                          border: Border.all(
                                            color: draftStatus ==
                                                    options[index].$1
                                                ? AppColors.primary
                                                : AppColors.borderStrong,
                                          ),
                                        ),
                                        child: draftStatus == options[index].$1
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
                            ),
                            if (index != options.length - 1)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 9),
                                child: Divider(
                                  height: 1,
                                  color: AppColors.border.withValues(alpha: .4),
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 13),
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
                              side: const BorderSide(color: AppColors.border),
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
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(46),
                              backgroundColor: AppColors.surface,
                              foregroundColor: AppColors.primaryDeep,
                              elevation: 0,
                              side: BorderSide(
                                color:
                                    AppColors.primary.withValues(alpha: .34),
                              ),
                            ),
                            icon: const Icon(Icons.check_rounded, size: 17),
                            label: const Text('Apply filter'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
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

  /// Opens the sort selector for the active support queue.
  ///
  /// Contact inbox sorting mirrors the web workspace with received date,
  /// last activity and status. Complaint sorting keeps its additional
  /// priority and resolution-date options.
  Future<void> _chooseSort() async {
    final options = _isComplaint
        ? const <(String, String, IconData)>[
            ('createdAt', 'Submitted date', Icons.calendar_month_outlined),
            ('updatedAt', 'Last activity', Icons.schedule_rounded),
            ('status', 'Status', Icons.fact_check_outlined),
            ('priority', 'Priority', Icons.flag_outlined),
            ('resolvedAt', 'Resolution date', Icons.task_alt_rounded),
          ]
        : const <(String, String, IconData)>[
            ('createdAt', 'Received date', Icons.calendar_month_outlined),
            ('updatedAt', 'Last activity', Icons.schedule_rounded),
            ('status', 'Status', Icons.fact_check_outlined),
          ];

    var draftField = _sortBy;
    var draftOrder = _sortOrder;

    final selected = await showModalBottomSheet<(String, String)>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Container(
            margin: const EdgeInsets.all(10),
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
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * .82,
              ),
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
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
                    Text(
                      _isComplaint ? 'Sort complaints' : 'Sort messages',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Sorting is applied by the server before pagination.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.3,
                      ),
                    ),
                    const SizedBox(height: 12),
                    ...options.map(
                      (option) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Material(
                          color: Colors.transparent,
                          borderRadius: BorderRadius.circular(14),
                          clipBehavior: Clip.antiAlias,
                          child: ListTile(
                            onTap: () {
                            setSheetState(() => draftField = option.$1);
                          },
                          dense: true,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                            side: BorderSide(
                              color: option.$1 == draftField
                                  ? AppColors.primary.withValues(alpha: .18)
                                  : AppColors.primaryDark.withValues(alpha: .05),
                            ),
                          ),
                          tileColor: option.$1 == draftField
                              ? AppColors.primarySoft
                              : AppColors.background.withValues(alpha: .55),
                          leading: Icon(
                            option.$3,
                            color: option.$1 == draftField
                                ? AppColors.primaryDeep
                                : AppColors.textMuted,
                            size: 18,
                          ),
                          title: Text(
                            option.$2,
                            style: TextStyle(
                              color: option.$1 == draftField
                                  ? AppColors.primaryDeep
                                  : AppColors.textPrimary,
                              fontSize: 10.2,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                            trailing: option.$1 == draftField
                                ? const Icon(
                                    Icons.check_circle_rounded,
                                    size: 18,
                                    color: AppColors.primaryDark,
                                  )
                                : null,
                          ),
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
                            child: _SupportSortDirectionChoice(
                              label: 'Ascending',
                              icon: Icons.arrow_upward_rounded,
                              selected: draftOrder == 'asc',
                              onTap: () {
                                setSheetState(() => draftOrder = 'asc');
                              },
                            ),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: _SupportSortDirectionChoice(
                              label: 'Descending',
                              icon: Icons.arrow_downward_rounded,
                              selected: draftOrder == 'desc',
                              onTap: () {
                                setSheetState(() => draftOrder = 'desc');
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.pop(
                            sheetContext,
                            (draftField, draftOrder),
                          );
                        },
                        icon: const Icon(Icons.check_rounded, size: 17),
                        label: const Text('Apply sorting'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
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

  /// Downloads the same CSV export exposed by the web complaint workspace and
  /// hands it to the native share/save sheet.
  Future<void> _exportCsv(BuildContext shareContext) async {
    if (_exporting) {
      return;
    }

    // Capture the render box BEFORE awaiting the HTTP request.
    //
    // This avoids using BuildContext across an async gap and also
    // gives the share sheet a valid position anchor.
    final renderObject = shareContext.findRenderObject();

    final box = renderObject is RenderBox ? renderObject : null;

    setState(() {
      _exporting = true;
      _error = '';
    });

    try {
      final bytes = _isComplaint
          ? await _api.exportComplaintsCsv(
              search: _search,
              status: _status,
              sortBy: _sortBy,
              sortOrder: _sortOrder,
            )
          : await _api.exportContactMessagesCsv(
              search: _search,
              status: _status,
              sortBy: _sortBy,
              sortOrder: _sortOrder,
            );

      if (!mounted) {
        return;
      }

      if (bytes.isEmpty) {
        throw const ApiException('The exported CSV file is empty.');
      }

      // XFile.fromData expects Uint8List, while the API client returns
      // List<int>, therefore convert it before creating the XFile.
      final csvBytes = Uint8List.fromList(bytes);

      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(csvBytes, mimeType: 'text/csv')],
          fileNameOverrides: [
            _isComplaint
                ? 'admin-complaints.csv'
                : 'admin-contact-messages.csv',
          ],
          subject: _isComplaint
              ? 'Voxidence complaints export'
              : 'Voxidence contact messages export',
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
          downloadFallbackEnabled: true,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = 'Unable to export this queue right now.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _exporting = false;
        });
      }
    }
  }

  /// Returns the readable title of the active sort field.
  String get _sortLabel {
    switch (_sortBy) {
      case 'updatedAt':
        return 'Last activity';

      case 'status':
        return 'Status';

      case 'priority':
        return 'Priority';

      case 'resolvedAt':
        return 'Resolution date';

      case 'createdAt':
      default:
        return _isComplaint ? 'Submitted date' : 'Received date';
    }
  }

  /// Builds the administrative support queue interface.
  ///
  /// The page dynamically adjusts its labels, icons, statuses, and
  /// descriptions according to [AdminSupportQueueType].
  ///
  /// When [AdminSupportQueuePage.embedded] is `true`, only the content
  /// is returned. Otherwise, the content is wrapped in the standard
  /// administrative workspace background and scaffold.
  @override
  Widget build(BuildContext context) {
    final summary = _summary['data'] is Map
        ? Map<String, dynamic>.from(_summary['data'] as Map)
        : _summary;

    final primaryCount = _firstInt(
      summary,
      _isComplaint
          ? const ['open', 'openComplaints', 'totalOpen']
          : const ['new', 'newMessages', 'totalNew'],
    );

    final totalComplaints = _firstInt(summary, const [
      'totalComplaints',
      'total',
      'totalCases',
    ]);

    final inProgressComplaints = _firstInt(summary, const [
      'inProgressComplaints',
      'inProgress',
      'totalInProgress',
    ]);

    final resolvedComplaints = _firstInt(summary, const [
      'resolvedComplaints',
      'resolved',
      'totalResolved',
    ]);

    final highPriorityComplaints = _firstInt(summary, const [
      'highPriorityComplaints',
      'highPriority',
      'totalHighPriority',
    ]);

    final totalMessages = _firstInt(summary, const ['totalMessages', 'total']);

    final newMessages = _firstInt(summary, const [
      'newMessages',
      'new',
      'totalNew',
    ]);

    final inProgressMessages = _firstInt(summary, const [
      'inProgressMessages',
      'inProgress',
      'totalInProgress',
    ]);

    final repliedMessages = _firstInt(summary, const [
      'repliedMessages',
      'replied',
      'totalReplied',
    ]);

    final title = _isComplaint ? 'Complaints' : 'Contact inbox';

    final subtitle = _isComplaint
        ? 'Prioritize cases, reply clearly and keep resolution state visible.'
        : 'Handle guest and registered-user messages from one support queue, reply by email and keep each conversation state organized.';

    final icon = _isComplaint
        ? Icons.support_agent_rounded
        : Icons.mark_email_unread_outlined;

    final content = RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () {
        return _load(force: true, quiet: true);
      },
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 120),
            sliver: SliverList.list(
              children: [
                AdminPageHeader(
                  title: title,
                  subtitle: subtitle,
                  eyebrow: 'Community & support',
                  icon: icon,
                  onBack: widget.embedded
                      ? null
                      : () {
                          Navigator.maybePop(context);
                        },
                  trailing: _refreshing
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : IconButton.filledTonal(
                          onPressed: () {
                            _load(force: true, quiet: true);
                          },
                          icon: const Icon(Icons.refresh_rounded, size: 19),
                        ),
                ),

                const SizedBox(height: 16),

                _SupportHero(
                  title: _isComplaint
                      ? 'Resolution workspace'
                      : 'Inbox workspace',
                  count: primaryCount,
                  label: _isComplaint ? 'open cases' : 'new messages',
                  icon: icon,
                ),

                if (_isComplaint) ...[
                  const SizedBox(height: 10),

                  _ComplaintSummaryStrip(
                    total: totalComplaints == 0 && _total > 0
                        ? _total
                        : totalComplaints,
                    open: primaryCount,
                    inProgress: inProgressComplaints,
                    resolved: resolvedComplaints,
                    highPriority: highPriorityComplaints,
                  ),
                ] else ...[
                  const SizedBox(height: 10),

                  _ContactSummaryStrip(
                    total: totalMessages == 0 && _total > 0
                        ? _total
                        : totalMessages,
                    newMessages: newMessages,
                    inProgress: inProgressMessages,
                    replied: repliedMessages,
                  ),
                ],

                const SizedBox(height: 13),

                Row(
                  children: [
                    Expanded(
                      child: AdminSearchField(
                        controller: _searchController,
                        hint: _isComplaint
                            ? 'Search subject, user, idea or reply…'
                            : 'Search sender, email, subject or reply…',
                        onChanged: _onSearch,
                      ),
                    ),

                    const SizedBox(width: 8),

                    SizedBox(
                      width: 48,
                      height: 48,
                      child: FilledButton.tonal(
                        onPressed: _chooseStatus,
                        style: FilledButton.styleFrom(
                          padding: EdgeInsets.zero,
                          backgroundColor: _status.isEmpty
                              ? AppColors.primarySoft
                              : AppColors.surfaceRose,
                          foregroundColor: _status.isEmpty
                              ? AppColors.primaryDark
                              : AppColors.pinkDeep,
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
                ),

                const SizedBox(height: 9),

                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _chooseSort,
                        icon: Icon(
                          _sortOrder == 'asc'
                              ? Icons.arrow_upward_rounded
                              : Icons.arrow_downward_rounded,
                          size: 16,
                        ),
                        label: Text(
                          'Sort · $_sortLabel',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 46),
                          padding: const EdgeInsets.symmetric(horizontal: 11),
                          backgroundColor:
                              AppColors.surface.withValues(alpha: .74),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Builder(
                      builder: (shareContext) => SizedBox(
                        height: 46,
                        child: OutlinedButton.icon(
                          onPressed: _exporting
                              ? null
                              : () {
                                  _exportCsv(shareContext);
                                },
                          style: OutlinedButton.styleFrom(
                            backgroundColor:
                                AppColors.surface.withValues(alpha: .74),
                            padding: const EdgeInsets.symmetric(horizontal: 11),
                          ),
                          icon: _exporting
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: AppColors.primaryDark,
                                  ),
                                )
                              : const Icon(
                                  Icons.file_download_outlined,
                                  size: 17,
                                ),
                          label: Text(
                            _exporting ? 'Preparing…' : 'Export CSV',
                            maxLines: 1,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 13),

                if (_error.isNotEmpty && _rows.isNotEmpty) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 9,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.pinkSoft.withValues(alpha: .62),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          size: 16,
                          color: AppColors.danger,
                        ),

                        const SizedBox(width: 7),

                        Expanded(
                          child: Text(
                            _error,
                            style: const TextStyle(
                              color: AppColors.danger,
                              fontSize: 9.7,
                              height: 1.35,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 10),
                ],

                if (_loading)
                  const AdminLoadingList()
                else if (_error.isNotEmpty && _rows.isEmpty)
                  AdminEmptyState(
                    title: 'Could not load this queue',
                    message: _error,
                    icon: icon,
                    onRetry: () {
                      _load(force: true);
                    },
                  )
                else if (_rows.isEmpty)
                  AdminEmptyState(
                    title: 'Queue is clear',
                    message:
                        'There are no matching ${_isComplaint ? 'complaints' : 'messages'} right now.',
                    icon: Icons.done_all_rounded,
                  )
                else ...[
                  Text(
                    '$_total ${_isComplaint ? 'cases' : 'messages'}',
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),

                  const SizedBox(height: 9),

                  ..._rows.map(
                    (item) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _SupportCard(
                        type: widget.type,
                        item: item,
                        onTap: () {
                          _openCase(item);
                        },
                      ),
                    ),
                  ),

                  if (_totalPages > 1) ...[
                    const SizedBox(height: 2),

                    Center(
                      child: Text(
                        'Page $_page of $_totalPages',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.6,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

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

                        const SizedBox(width: 10),

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
                            iconAlignment: IconAlignment.end,
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

  /// Returns the first available integer value associated with [keys].
  static int _firstInt(Map<String, dynamic> data, List<String> keys) {
    for (final key in keys) {
      if (data.containsKey(key)) {
        return _int(data[key]);
      }
    }

    return 0;
  }

  /// Safely converts a dynamic value into an integer.
  static int _int(dynamic value) {
    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

}

class _SupportSortDirectionChoice extends StatelessWidget {
  const _SupportSortDirectionChoice({
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

/// Displays the visual overview card at the top of a support queue.
///
/// @author Eman
class _SupportHero extends StatelessWidget {
  const _SupportHero({
    required this.title,
    required this.count,
    required this.label,
    required this.icon,
  });

  final String title;

  final int count;

  final String label;

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFEAF7F4), Color(0xFFFFF4F7)],
        ),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white),
      ),
      child: Row(
        children: [
          AdminIconBadge(icon: icon, size: 48, tone: Colors.white),

          const SizedBox(width: 12),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 3),

                const Text(
                  'Open a case to review context and respond without leaving the queue.',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.7,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(width: 8),

          Column(
            children: [
              Text(
                '$count',
                style: TextStyle(
                  color: count > 0 ? AppColors.danger : AppColors.success,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.5,
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

/// Displays contact-inbox summary metrics.
///
/// Mirrors the four summary cards shown by the web contact inbox while
/// keeping the layout horizontally scrollable for smaller mobile screens.
///
/// @author Eman
class _ContactSummaryStrip extends StatelessWidget {
  const _ContactSummaryStrip({
    required this.total,
    required this.newMessages,
    required this.inProgress,
    required this.replied,
  });

  final int total;

  final int newMessages;

  final int inProgress;

  final int replied;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _ComplaintMetric(
            icon: Icons.inbox_outlined,
            label: 'Total',
            value: total,
            tone: AppColors.primarySoft,
            iconColor: AppColors.primaryDark,
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.mark_email_unread_outlined,
            label: 'New',
            value: newMessages,
            tone: AppColors.pinkSoft.withValues(alpha: .48),
            iconColor: AppColors.danger,
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.schedule_rounded,
            label: 'In progress',
            value: inProgress,
            tone: const Color(0xFFFFF5E8),
            iconColor: const Color(0xFFB87934),
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.mark_email_read_outlined,
            label: 'Replied',
            value: replied,
            tone: const Color(0xFFEAF7F1),
            iconColor: AppColors.success,
          ),
        ],
      ),
    );
  }
}

/// Displays complaint summary metrics.
///
/// @author Eman
class _ComplaintSummaryStrip extends StatelessWidget {
  const _ComplaintSummaryStrip({
    required this.total,
    required this.open,
    required this.inProgress,
    required this.resolved,
    required this.highPriority,
  });

  final int total;

  final int open;

  final int inProgress;

  final int resolved;

  final int highPriority;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _ComplaintMetric(
            icon: Icons.inbox_outlined,
            label: 'Total',
            value: total,
            tone: AppColors.primarySoft,
            iconColor: AppColors.primaryDark,
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.error_outline_rounded,
            label: 'Open',
            value: open,
            tone: AppColors.pinkSoft.withValues(alpha: .48),
            iconColor: AppColors.danger,
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.schedule_rounded,
            label: 'In progress',
            value: inProgress,
            tone: const Color(0xFFFFF5E8),
            iconColor: const Color(0xFFB87934),
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.check_circle_outline_rounded,
            label: 'Resolved',
            value: resolved,
            tone: const Color(0xFFEAF7F1),
            iconColor: AppColors.success,
          ),

          const SizedBox(width: 7),

          _ComplaintMetric(
            icon: Icons.flag_outlined,
            label: 'High priority',
            value: highPriority,
            tone: const Color(0xFFFFEEF2),
            iconColor: AppColors.danger,
          ),
        ],
      ),
    );
  }
}

/// Compact complaint metric tile.
///
/// @author Eman
class _ComplaintMetric extends StatelessWidget {
  const _ComplaintMetric({
    required this.icon,
    required this.label,
    required this.value,
    required this.tone,
    required this.iconColor,
  });

  final IconData icon;

  final String label;

  final int value;

  final Color tone;

  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 105,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: tone,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 15, color: iconColor),
          ),

          const SizedBox(width: 7),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$value',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.5,
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
                    fontSize: 7.8,
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

/// Displays a complaint priority as a compact pill.
///
/// @author Eman
class _ComplaintPriorityChip extends StatelessWidget {
  const _ComplaintPriorityChip({required this.priority});

  final String priority;

  @override
  Widget build(BuildContext context) {
    final normalized = priority.toUpperCase();

    late final Color background;

    late final Color foreground;

    switch (normalized) {
      case 'HIGH':
        background = const Color(0xFFFFE8EE);

        foreground = AppColors.danger;

        break;

      case 'LOW':
        background = const Color(0xFFEAF7F4);

        foreground = AppColors.primaryDark;

        break;

      default:
        background = const Color(0xFFFFF3E4);

        foreground = const Color(0xFFB87934);

        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.flag_rounded, size: 11, color: foreground),

          const SizedBox(width: 4),

          Text(
            '${_readablePriority(normalized)} priority',
            style: TextStyle(
              color: foreground,
              fontSize: 8.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  static String _readablePriority(String value) {
    if (value.isEmpty) {
      return 'Medium';
    }

    return '${value[0]}${value.substring(1).toLowerCase()}';
  }
}

/// Small metadata pill.
///
/// @author Eman
class _SupportMetaChip extends StatelessWidget {
  const _SupportMetaChip({required this.icon, required this.label});

  final IconData icon;

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 170),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .42),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primaryDark),

          const SizedBox(width: 4),

          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.4,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays one activity timeline row.
///
/// @author Eman
class _SupportTimelineRow extends StatelessWidget {
  const _SupportTimelineRow({
    required this.icon,
    required this.label,
    required this.value,
    this.positive = false,
  });

  final IconData icon;

  final String label;

  final String value;

  final bool positive;

  @override
  Widget build(BuildContext context) {
    final tone = positive
        ? const Color(0xFFE8F7F0)
        : AppColors.primarySoft.withValues(alpha: .74);

    final foreground = positive ? AppColors.success : AppColors.primaryDark;

    return Row(
      children: [
        Container(
          width: 27,
          height: 27,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: tone,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(icon, size: 14, color: foreground),
        ),

        const SizedBox(width: 8),

        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.2,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),

        const SizedBox(width: 8),

        Flexible(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

/// Selectable status card.
///
/// @author Eman
class _SupportStatusChoice extends StatelessWidget {
  const _SupportStatusChoice({
    required this.value,
    required this.selected,
    required this.onTap,
  });

  final String value;

  final bool selected;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final normalized = value.trim().toUpperCase();

    final (tone, foreground, icon) = switch (normalized) {
      'RESOLVED' || 'REPLIED' => (
        const Color(0xFFE8F7F0),
        AppColors.success,
        Icons.check_rounded,
      ),

      'REJECTED' ||
      'CLOSED' => (AppColors.pinkSoft, AppColors.danger, Icons.close_rounded),

      'IN_PROGRESS' => (
        const Color(0xFFFFF5E8),
        AppColors.warning,
        Icons.timelapse_rounded,
      ),

      _ => (
        AppColors.primarySoft,
        AppColors.primaryDark,
        Icons.circle_outlined,
      ),
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 170),
          curve: Curves.easeOut,
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            color: selected ? tone : AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected
                  ? foreground.withValues(alpha: .36)
                  : AppColors.border,
              width: selected ? 1.35 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: foreground.withValues(alpha: .06),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : const [],
          ),
          child: Row(
            children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.surface.withValues(alpha: .74)
                      : tone.withValues(alpha: .74),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  selected ? Icons.check_rounded : icon,
                  size: 14,
                  color: foreground,
                ),
              ),

              const SizedBox(width: 7),

              Expanded(
                child: Text(
                  _readableSupportValue(normalized),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: selected ? foreground : AppColors.textSecondary,
                    fontSize: 10.2,
                    fontWeight: selected ? FontWeight.w900 : FontWeight.w800,
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

/// Compact complaint priority selector.
///
/// @author Eman
class _SupportPriorityChoice extends StatelessWidget {
  const _SupportPriorityChoice({
    required this.value,
    required this.selected,
    required this.onTap,
  });

  final String value;

  final bool selected;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final normalized = value.trim().toUpperCase();

    final (tone, foreground, icon) = switch (normalized) {
      'HIGH' => (
        AppColors.pinkSoft,
        AppColors.danger,
        Icons.priority_high_rounded,
      ),

      'MEDIUM' => (
        const Color(0xFFFFF5E8),
        AppColors.warning,
        Icons.remove_rounded,
      ),

      _ => (
        AppColors.primarySoft,
        AppColors.primaryDark,
        Icons.arrow_downward_rounded,
      ),
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 170),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? tone : AppColors.surface,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? foreground.withValues(alpha: .34)
                  : AppColors.border,
              width: selected ? 1.3 : 1,
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: foreground),

              const SizedBox(height: 4),

              Text(
                _readableSupportValue(normalized),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? foreground : AppColors.textSecondary,
                  fontSize: 9.3,
                  fontWeight: selected ? FontWeight.w900 : FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Converts enum-style values into readable labels.
String _readableSupportValue(String value) {
  return value
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

/// Displays a single support record.
///
/// @author Eman
class _SupportCard extends StatelessWidget {
  const _SupportCard({
    required this.type,
    required this.item,
    required this.onTap,
  });

  final AdminSupportQueueType type;

  final Map<String, dynamic> item;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = item['user'] is Map
        ? Map<String, dynamic>.from(item['user'] as Map)
        : const <String, dynamic>{};

    final registered = (user['id']?.toString().trim() ?? '').isNotEmpty;

    final email = registered
        ? user['email']?.toString().trim() ?? ''
        : item['email']?.toString().trim() ?? '';

    final subject =
        item['subject']?.toString().trim() ??
        (type == AdminSupportQueueType.complaints
            ? 'Complaint'
            : 'Contact message');

    final message = item['message']?.toString().trim() ?? '';

    final status =
        item['status']?.toString().trim() ??
        (type == AdminSupportQueueType.complaints ? 'OPEN' : 'NEW');

    final priority =
        item['priority']?.toString().trim().toUpperCase() ?? 'MEDIUM';

    final idea = item['idea'] is Map
        ? Map<String, dynamic>.from(item['idea'] as Map)
        : const <String, dynamic>{};

    final ideaTitle = idea['title']?.toString().trim() ?? '';

    final lastActivity =
        item['updatedAt']?.toString().trim() ??
        item['createdAt']?.toString().trim() ??
        '';

    final sender =
        user['fullName']?.toString().trim() ??
        item['fullName']?.toString().trim() ??
        item['email']?.toString().trim() ??
        'User';

    return AdminGlassCard(
      onTap: onTap,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AdminIconBadge(
                icon: type == AdminSupportQueueType.complaints
                    ? Icons.support_agent_rounded
                    : Icons.mail_outline_rounded,
                size: 38,
                tone: type == AdminSupportQueueType.complaints
                    ? AppColors.pinkSoft
                    : AppColors.primarySoft,
                iconColor: type == AdminSupportQueueType.complaints
                    ? AppColors.danger
                    : AppColors.primaryDark,
              ),

              const SizedBox(width: 9),

              Expanded(
                child: Text(
                  subject,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),

              const SizedBox(width: 7),

              AdminStatusChip(status),
            ],
          ),

          if (message.isNotEmpty) ...[
            const SizedBox(height: 10),

            Text(
              message,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10.4,
                height: 1.4,
              ),
            ),
          ],

          if (type == AdminSupportQueueType.complaints) ...[
            const SizedBox(height: 10),

            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _ComplaintPriorityChip(priority: priority),

                if (ideaTitle.isNotEmpty)
                  _SupportMetaChip(
                    icon: Icons.lightbulb_outline_rounded,
                    label: ideaTitle,
                  )
                else
                  const _SupportMetaChip(
                    icon: Icons.layers_outlined,
                    label: 'General',
                  ),

                if (lastActivity.isNotEmpty)
                  _SupportMetaChip(
                    icon: Icons.schedule_rounded,
                    label: _supportDate(lastActivity),
                  ),
              ],
            ),
          ] else ...[
            const SizedBox(height: 10),

            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _SupportMetaChip(
                  icon: registered
                      ? Icons.verified_user_outlined
                      : Icons.person_outline_rounded,
                  label: registered ? 'Registered' : 'Guest',
                ),
                if (email.isNotEmpty)
                  _SupportMetaChip(
                    icon: Icons.alternate_email_rounded,
                    label: email,
                  ),
                if (lastActivity.isNotEmpty)
                  _SupportMetaChip(
                    icon: Icons.schedule_rounded,
                    label: _supportDate(lastActivity),
                  ),
              ],
            ),
          ],

          const SizedBox(height: 9),

          Row(
            children: [
              const Icon(
                Icons.person_outline_rounded,
                size: 14,
                color: AppColors.textMuted,
              ),

              const SizedBox(width: 4),

              Expanded(
                child: Text(
                  sender,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.4,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),

              const Text(
                'Open case',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 9.6,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(width: 4),

              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 12,
                color: AppColors.primaryDark,
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _supportDate(String value) {
    final date = DateTime.tryParse(value)?.toLocal();

    if (date == null) {
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

    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }
}

/// Displays the detailed editing workspace for a support case.
///
/// @author Eman
class _SupportCaseSheet extends StatefulWidget {
  const _SupportCaseSheet({required this.type, required this.item});

  final AdminSupportQueueType type;

  final Map<String, dynamic> item;

  @override
  State<_SupportCaseSheet> createState() => _SupportCaseSheetState();
}

/// Manages support-case editing.
///
/// @author Eman
class _SupportCaseSheetState extends State<_SupportCaseSheet> {
  final _api = AdminApi.instance;

  late String _status;

  late String _priority;

  late final TextEditingController _reply;

  /// Reply that was already persisted when the case was opened.
  late final String _originalReply;

  bool _busy = false;

  String _error = '';

  bool get _isComplaint => widget.type == AdminSupportQueueType.complaints;

  @override
  void initState() {
    super.initState();

    _status =
        widget.item['status']?.toString().toUpperCase() ??
        (_isComplaint ? 'OPEN' : 'NEW');

    _priority = widget.item['priority']?.toString().toUpperCase() ?? 'MEDIUM';

    _originalReply = widget.item['adminReply']?.toString().trim() ?? '';

    _reply = TextEditingController(text: _originalReply);
  }

  @override
  void dispose() {
    _reply.dispose();

    super.dispose();
  }

  /// Validates and saves case changes.
  Future<void> _save() async {
    if (_busy) {
      return;
    }

    final id = widget.item['id']?.toString().trim() ?? '';

    if (id.isEmpty) {
      return;
    }

    if (_reply.text.trim().isNotEmpty && _reply.text.trim().length < 5) {
      setState(() {
        _error = 'Write at least 5 characters in the response.';
      });

      return;
    }

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      Map<String, dynamic> result;

      if (_isComplaint) {
        final reply = _reply.text.trim();

        result = await _api.updateComplaint(
          id,
          status: _status,
          priority: _priority,
          // Match the web workspace exactly: an empty response is omitted
          // instead of overwriting an already saved administrator reply.
          adminReply: reply.isEmpty ? null : reply,
        );
      } else {
        final reply = _reply.text.trim();

        result = await _api.updateContactMessage(
          id,
          status: _status,
          // Match the web contact inbox: an empty field means a status-only
          // update, so omit adminReply instead of sending an invalid empty
          // string or erasing the previously saved response.
          adminReply: reply.isEmpty ? null : reply,
        );
      }

      if (!mounted) {
        return;
      }

      Navigator.pop(context, result);
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
    final user = widget.item['user'] is Map
        ? Map<String, dynamic>.from(widget.item['user'] as Map)
        : const <String, dynamic>{};

    final registered = (user['id']?.toString().trim() ?? '').isNotEmpty;

    final name =
        user['fullName']?.toString().trim() ??
        widget.item['fullName']?.toString().trim() ??
        'User';

    final email =
        user['email']?.toString().trim() ??
        widget.item['email']?.toString().trim() ??
        '';

    final subject =
        widget.item['subject']?.toString().trim() ??
        (_isComplaint ? 'Complaint' : 'Contact message');

    final message =
        widget.item['message']?.toString().trim() ?? 'No message provided.';

    final idea = widget.item['idea'] is Map
        ? Map<String, dynamic>.from(widget.item['idea'] as Map)
        : const <String, dynamic>{};

    final ideaTitle = idea['title']?.toString().trim() ?? '';

    final ideaId = idea['id']?.toString().trim() ?? '';

    final ideaDisplayId = ideaId.isEmpty
        ? ''
        : (ideaId.length <= 8 ? ideaId : ideaId.substring(0, 8)).toUpperCase();

    final createdAt = widget.item['createdAt']?.toString().trim() ?? '';

    final updatedAt = widget.item['updatedAt']?.toString().trim() ?? '';

    final resolvedAt = widget.item['resolvedAt']?.toString().trim() ?? '';

    final statuses = _isComplaint
        ? ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']
        : ['NEW', 'IN_PROGRESS', 'REPLIED', 'CLOSED'];

    final trimmedReply = _reply.text.trim();
    final replyChanged =
        trimmedReply.isNotEmpty && trimmedReply != _originalReply;

    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return DraggableScrollableSheet(
      initialChildSize: .92,
      minChildSize: .64,
      maxChildSize: .97,
      builder: (context, controller) => Container(
        margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: AppColors.border.withValues(alpha: .86)),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .12),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: ListView(
          controller: controller,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: EdgeInsets.fromLTRB(14, 10, 14, 26 + bottomInset),
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),

            const SizedBox(height: 13),

            Container(
              padding: const EdgeInsets.fromLTRB(14, 14, 10, 14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(23),
                border: Border.all(
                  color: AppColors.border.withValues(alpha: .82),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDark.withValues(alpha: .04),
                    blurRadius: 18,
                    offset: const Offset(0, 7),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.primarySoft,
                          borderRadius: BorderRadius.circular(17),
                          border: Border.all(
                            color: AppColors.borderStrong.withValues(
                              alpha: .74,
                            ),
                          ),
                        ),
                        child: Icon(
                          _isComplaint
                              ? Icons.support_agent_rounded
                              : Icons.mark_email_read_outlined,
                          size: 23,
                          color: AppColors.primaryDark,
                        ),
                      ),

                      const SizedBox(width: 11),

                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _isComplaint
                                  ? 'SUPPORT CASE'
                                  : 'CONTACT RESPONSE',
                              style: const TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 8.8,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1,
                              ),
                            ),

                            const SizedBox(height: 3),

                            Text(
                              subject,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 20,
                                height: 1.12,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.35,
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(width: 7),

                      Material(
                        color: AppColors.primarySoft.withValues(alpha: .62),
                        borderRadius: BorderRadius.circular(13),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(13),
                          onTap: _busy
                              ? null
                              : () {
                                  Navigator.pop(context);
                                },
                          child: const SizedBox(
                            width: 39,
                            height: 39,
                            child: Icon(
                              Icons.close_rounded,
                              size: 21,
                              color: AppColors.primaryDeep,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 12),

                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      AdminStatusChip(_status),
                      if (_isComplaint)
                        _ComplaintPriorityChip(priority: _priority)
                      else
                        _SupportMetaChip(
                          icon: registered
                              ? Icons.verified_user_outlined
                              : Icons.person_outline_rounded,
                          label: registered ? 'Registered' : 'Guest',
                        ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 10),

            Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: AppColors.primarySoft.withValues(alpha: .64),
                borderRadius: BorderRadius.circular(21),
                border: Border.all(
                  color: AppColors.borderStrong.withValues(alpha: .78),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surface.withValues(alpha: .92),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Icon(
                      registered
                          ? Icons.verified_user_outlined
                          : Icons.person_outline_rounded,
                      size: 19,
                      color: AppColors.primaryDark,
                    ),
                  ),

                  const SizedBox(width: 10),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isComplaint
                              ? 'Submitted by'
                              : registered
                              ? 'Registered account'
                              : 'Guest sender',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),

                        const SizedBox(height: 2),

                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 12.6,
                            fontWeight: FontWeight.w900,
                          ),
                        ),

                        if (email.isNotEmpty) ...[
                          const SizedBox(height: 1),

                          Text(
                            email,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.3,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),

            if (!_isComplaint) ...[
              const SizedBox(height: 10),

              Container(
                padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(19),
                  border: Border.all(
                    color: AppColors.border.withValues(alpha: .88),
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
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
                        Icons.outgoing_mail,
                        size: 16,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Email reply destination',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            registered
                                ? 'Replies use the user account’s current email address.'
                                : 'Replies use the email stored with this guest submission.',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.1,
                              height: 1.4,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 10),

            Container(
              padding: const EdgeInsets.all(15),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: AppColors.border.withValues(alpha: .88),
                ),
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
                          color: AppColors.surfaceRose,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(
                          Icons.chat_bubble_outline_rounded,
                          size: 15,
                          color: AppColors.pinkDeep,
                        ),
                      ),

                      const SizedBox(width: 8),

                      Text(
                        _isComplaint
                            ? 'Original complaint'
                            : 'Original message',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 10),

                  Text(
                    message,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11.2,
                      height: 1.58,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            if (_isComplaint && ideaTitle.isNotEmpty) ...[
              const SizedBox(height: 10),

              Container(
                padding: const EdgeInsets.all(13),
                decoration: BoxDecoration(
                  color: AppColors.surfaceRose.withValues(alpha: .78),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: AppColors.pinkLight.withValues(alpha: .56),
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 35,
                      height: 35,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.surface.withValues(alpha: .84),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.lightbulb_outline_rounded,
                        size: 18,
                        color: AppColors.pinkDeep,
                      ),
                    ),

                    const SizedBox(width: 9),

                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Related idea',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.6,
                              fontWeight: FontWeight.w800,
                            ),
                          ),

                          const SizedBox(height: 2),

                          Text(
                            ideaTitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 10.8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),

                          if (ideaDisplayId.isNotEmpty) ...[
                            const SizedBox(height: 3),

                            Text(
                              'Idea #$ideaDisplayId',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.7,
                                fontWeight: FontWeight.w800,
                                letterSpacing: .2,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],

            if (createdAt.isNotEmpty ||
                updatedAt.isNotEmpty ||
                (_isComplaint && resolvedAt.isNotEmpty)) ...[
              const SizedBox(height: 10),

              Container(
                padding: const EdgeInsets.fromLTRB(13, 12, 13, 11),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(
                    color: AppColors.border.withValues(alpha: .88),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Activity',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    const SizedBox(height: 9),

                    if (createdAt.isNotEmpty)
                      _SupportTimelineRow(
                        icon: _isComplaint
                            ? Icons.add_rounded
                            : Icons.inbox_outlined,
                        label: _isComplaint ? 'Submitted' : 'Received',
                        value: _formatCaseDate(createdAt),
                      ),

                    if (createdAt.isNotEmpty && updatedAt.isNotEmpty)
                      const SizedBox(height: 7),

                    if (updatedAt.isNotEmpty)
                      _SupportTimelineRow(
                        icon: Icons.schedule_rounded,
                        label: 'Last activity',
                        value: _formatCaseDate(updatedAt),
                      ),

                    if (_isComplaint && resolvedAt.isNotEmpty) ...[
                      const SizedBox(height: 7),

                      _SupportTimelineRow(
                        icon: Icons.check_rounded,
                        label: 'Resolved',
                        value: _formatCaseDate(resolvedAt),
                        positive: true,
                      ),
                    ],
                  ],
                ),
              ),
            ],

            const SizedBox(height: 18),

            Row(
              children: [
                Container(
                  width: 31,
                  height: 31,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: const Icon(
                    Icons.tune_rounded,
                    size: 16,
                    color: AppColors.primaryDark,
                  ),
                ),

                const SizedBox(width: 8),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _isComplaint ? 'Manage case' : 'Support response',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 15.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),

                      const SizedBox(height: 1),

                      Text(
                        _isComplaint
                            ? 'Update status, priority and reply. User-visible changes are delivered in-app.'
                            : 'Reply by email and manage the inbox state.',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.3,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 11),

            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: statuses.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 2.55,
              ),
              itemBuilder: (context, index) {
                final value = statuses[index];

                return _SupportStatusChoice(
                  value: value,
                  selected: _status == value,
                  onTap: _busy
                      ? null
                      : () {
                          setState(() {
                            _status = value;
                          });
                        },
                );
              },
            ),

            if (_isComplaint) ...[
              const SizedBox(height: 16),

              const Text(
                'Priority',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 7),

              Row(
                children: [
                  Expanded(
                    child: _SupportPriorityChoice(
                      value: 'LOW',
                      selected: _priority == 'LOW',
                      onTap: _busy
                          ? null
                          : () {
                              setState(() {
                                _priority = 'LOW';
                              });
                            },
                    ),
                  ),

                  const SizedBox(width: 7),

                  Expanded(
                    child: _SupportPriorityChoice(
                      value: 'MEDIUM',
                      selected: _priority == 'MEDIUM',
                      onTap: _busy
                          ? null
                          : () {
                              setState(() {
                                _priority = 'MEDIUM';
                              });
                            },
                    ),
                  ),

                  const SizedBox(width: 7),

                  Expanded(
                    child: _SupportPriorityChoice(
                      value: 'HIGH',
                      selected: _priority == 'HIGH',
                      onTap: _busy
                          ? null
                          : () {
                              setState(() {
                                _priority = 'HIGH';
                              });
                            },
                    ),
                  ),
                ],
              ),
            ],

            const SizedBox(height: 16),

            Container(
              padding: const EdgeInsets.fromLTRB(13, 12, 13, 13),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: AppColors.border.withValues(alpha: .9),
                ),
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
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(
                          Icons.edit_note_rounded,
                          size: 16,
                          color: AppColors.primaryDark,
                        ),
                      ),

                      const SizedBox(width: 8),

                      Expanded(
                        child: Text(
                          _isComplaint ? 'Response to user' : 'Email response',
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 10.8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),

                  if (!_isComplaint) ...[
                    const SizedBox(height: 7),
                    const Text(
                      'A changed reply is emailed after the database update succeeds. Status-only changes do not send another email.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],

                  const SizedBox(height: 9),

                  TextField(
                    controller: _reply,
                    maxLines: 6,
                    maxLength: 1000,
                    onChanged: (_) {
                      setState(() {});
                    },
                    decoration: InputDecoration(
                      labelText: null,
                      hintText: _isComplaint
                          ? 'Explain what was reviewed, what action was taken, and what happens next…'
                          : 'Write the support response that should be delivered to the sender…',
                      filled: true,
                      fillColor: AppColors.background.withValues(alpha: .72),
                      contentPadding: const EdgeInsets.all(13),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: BorderSide(
                          color: AppColors.border.withValues(alpha: .9),
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: const BorderSide(
                          color: AppColors.primary,
                          width: 1.4,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            if (!_isComplaint) ...[
              const SizedBox(height: 9),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(13, 11, 13, 12),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .42),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: AppColors.borderStrong.withValues(alpha: .62),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.mail_outline_rounded,
                          size: 15,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Delivery preview',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 9.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      email.isEmpty ? 'No email available' : email,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Subject: Voxidence Support - $subject',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      replyChanged
                          ? 'Saving will update the case and send this response by email.'
                          : 'Saving now updates the inbox state only; no new email is sent.',
                      style: TextStyle(
                        color: replyChanged
                            ? AppColors.primaryDark
                            : AppColors.textMuted,
                        fontSize: 8.9,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            if (_originalReply.isNotEmpty) ...[
              const SizedBox(height: 9),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(13, 11, 13, 12),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .48),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: AppColors.borderStrong.withValues(alpha: .66),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.history_rounded,
                          size: 15,
                          color: AppColors.primaryDark,
                        ),

                        SizedBox(width: 6),

                        Text(
                          'Current saved response',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 9.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 6),

                    Text(
                      _originalReply,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10,
                        height: 1.45,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            if (_error.isNotEmpty) ...[
              const SizedBox(height: 8),

              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 11,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: AppColors.pinkSoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      size: 15,
                      color: AppColors.danger,
                    ),

                    const SizedBox(width: 7),

                    Expanded(
                      child: Text(
                        _error,
                        style: const TextStyle(
                          color: AppColors.danger,
                          fontSize: 9.8,
                          height: 1.35,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 14),

            SizedBox(
              height: 49,
              child: FilledButton.icon(
                onPressed: _busy ? null : _save,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.surface,
                  foregroundColor: AppColors.primaryDeep,
                  elevation: 0,
                  side: BorderSide(
                    color: AppColors.primary.withValues(alpha: .34),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(17),
                  ),
                ),
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.primaryDark,
                        ),
                      )
                    : Icon(
                        _isComplaint
                            ? Icons.check_circle_outline_rounded
                            : replyChanged
                            ? Icons.send_rounded
                            : Icons.check_circle_outline_rounded,
                        size: 18,
                      ),
                label: Text(
                  _busy
                      ? 'Saving…'
                      : _isComplaint
                      ? 'Save case update'
                      : replyChanged
                      ? 'Save & send email'
                      : 'Save status',
                  style: const TextStyle(
                    fontSize: 12.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Formats a case timestamp into a compact readable date.
  static String _formatCaseDate(String value) {
    final date = DateTime.tryParse(value)?.toLocal();

    if (date == null) {
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

    final hour = date.hour % 12 == 0 ? 12 : date.hour % 12;

    final minute = date.minute.toString().padLeft(2, '0');

    final suffix = date.hour >= 12 ? 'PM' : 'AM';

    return '${months[date.month - 1]} ${date.day}, ${date.year} · $hour:$minute $suffix';
  }
}
