import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';
import '../widgets/admin_selection_field.dart';

class AdminPromptControlPage extends StatefulWidget {
  const AdminPromptControlPage({super.key});

  @override
  State<AdminPromptControlPage> createState() => _AdminPromptControlPageState();
}

class _AdminPromptControlPageState extends State<AdminPromptControlPage> {
  static const int _pageSize = 12;
  static const int _minTemplateLength = 100;
  static const int _maxTemplateLength = 15000;

  static const List<String> _requiredPlaceholders = [
    'domain',
    'country',
    'city',
    'region',
    'platforms',
    'commentsCount',
    'sentimentStats',
    'keywords',
    'topics',
    'recurringProblems',
    'extractedNeeds',
    'featureRequests',
    'opportunities',
    'insights',
    'dataQuality',
    'samplePosts',
    'sampleComments',
    'existingIdea',
    'requestedOutputFormat',
  ];

  static const List<_PromptOption> _promptTypes = [
    _PromptOption('', 'All prompt types'),
    _PromptOption('IDEA_GENERATION', 'Idea generation'),
    _PromptOption('IDEA_UNLOCK', 'Idea unlock'),
    _PromptOption('CHAT_RESPONSE', 'Chat response'),
    _PromptOption('NLP_ANALYSIS', 'NLP analysis'),
    _PromptOption('ABSTRACT_GENERATION', 'Abstract generation'),
    _PromptOption('IDEA_EVALUATION', 'Idea evaluation'),
  ];

  static const List<_PromptOption> _sortOptions = [
    _PromptOption('createdAt', 'Newest activity'),
    _PromptOption('promptType', 'Prompt type'),
    _PromptOption('estimatedInputTokens', 'Estimated tokens'),
  ];

  final AdminApi _adminApi = AdminApi.instance;
  final ApiClient _api = ApiClient.instance;
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _templateController = TextEditingController();

  Timer? _searchDebounce;
  List<Map<String, dynamic>> _history = const [];
  String _savedTemplate = '';
  int _page = 1;
  int _total = 0;
  int _totalPages = 1;
  String _search = '';
  String _promptType = '';
  String _sortBy = 'createdAt';
  String _sortOrder = 'desc';
  DateTime? _fromDate;
  DateTime? _toDate;
  bool _loadingTemplate = true;
  bool _loadingHistory = true;
  bool _refreshing = false;
  bool _saving = false;
  String _error = '';
  String _notice = '';

  @override
  void initState() {
    super.initState();
    _templateController.addListener(_onTemplateChanged);
    unawaited(_loadAll());
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    _templateController
      ..removeListener(_onTemplateChanged)
      ..dispose();
    super.dispose();
  }

  void _onTemplateChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _loadAll({bool force = false, bool quiet = false}) async {
    if (quiet && mounted) {
      setState(() {
        _refreshing = true;
        _error = '';
      });
    }

    await Future.wait([
      _loadTemplate(force: force),
      _loadHistory(force: force),
    ]);

    if (mounted && quiet) {
      setState(() => _refreshing = false);
    }
  }

  Future<void> _loadTemplate({bool force = false}) async {
    if (mounted && !_refreshing) {
      setState(() {
        _loadingTemplate = true;
        _error = '';
      });
    }

    try {
      final payload = await _adminApi.getDetail(
        '/prompts/template',
        force: force,
      );
      final template = _first(
        payload,
        const ['ideaPromptTemplate', 'template', 'content', 'prompt'],
      );

      if (!mounted) return;
      final syncEditor =
          _templateController.text.isEmpty || _templateController.text == _savedTemplate;
      setState(() => _savedTemplate = template);
      if (syncEditor && _templateController.text != template) {
        _templateController.text = template;
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load the active prompt template.');
    } finally {
      if (mounted) setState(() => _loadingTemplate = false);
    }
  }

  Future<void> _loadHistory({bool force = false}) async {
    if (mounted && !_refreshing) {
      setState(() {
        _loadingHistory = true;
        _error = '';
      });
    }

    try {
      final payload = await _adminApi.getList(
        '/prompts/history',
        page: _page,
        limit: _pageSize,
        search: _search,
        sortBy: _sortBy,
        sortOrder: _sortOrder,
        force: force,
        extra: {
          if (_promptType.isNotEmpty) 'promptType': _promptType,
          if (_fromDate != null) 'fromDate': _startOfDayIso(_fromDate!),
          if (_toDate != null) 'toDate': _endOfDayIso(_toDate!),
        },
      );

      final rows = (payload['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
      final meta = _map(payload['meta']);

      if (!mounted) return;
      setState(() {
        _history = rows;
        _total = _int(meta['total'] ?? rows.length);
        _totalPages = _int(meta['totalPages'] ?? 1).clamp(1, 999999).toInt();
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load prompt execution history.');
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      final next = value.trim();
      if (!mounted || next == _search) return;
      setState(() {
        _search = next;
        _page = 1;
      });
      unawaited(_loadHistory());
    });
  }

  Future<void> _saveTemplate() async {
    final validation = _validate(_templateController.text);
    if (_saving || !_dirty || !validation.valid) return;

    setState(() {
      _saving = true;
      _error = '';
      _notice = '';
    });

    try {
      final raw = await _api.patch(
        '/prompts/template',
        data: {'ideaPromptTemplate': _templateController.text.trim()},
      );
      final payload = _map(raw);
      final saved = _first(
        payload,
        const ['ideaPromptTemplate', 'template', 'content', 'prompt'],
        fallback: _templateController.text.trim(),
      );
      _api.invalidate('/prompts');
      _api.invalidate('/admin/dashboard');

      if (!mounted) return;
      setState(() {
        _savedTemplate = saved;
        _notice = 'Production prompt template updated successfully.';
      });
      if (_templateController.text != saved) {
        _templateController.text = saved;
      }
      unawaited(_loadHistory(force: true));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not update the prompt template.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _discardTemplateChanges() {
    _templateController.text = _savedTemplate;
    setState(() => _notice = '');
  }

  Future<void> _openFilters() async {
    var promptType = _promptType;
    var sortBy = _sortBy;
    var sortOrder = _sortOrder;
    var fromDate = _fromDate;
    var toDate = _toDate;

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primary.withValues(alpha: .18),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> pickDate({required bool from}) async {
              final initial = from
                  ? fromDate ?? toDate ?? DateTime.now()
                  : toDate ?? fromDate ?? DateTime.now();
              final selected = await showDatePicker(
                context: context,
                initialDate: initial,
                firstDate: DateTime(2020),
                lastDate: DateTime.now().add(const Duration(days: 1)),
              );
              if (selected == null) return;
              setSheetState(() {
                if (from) {
                  fromDate = selected;
                  if (toDate != null && selected.isAfter(toDate!)) {
                    toDate = selected;
                  }
                } else {
                  toDate = selected;
                  if (fromDate != null && selected.isBefore(fromDate!)) {
                    fromDate = selected;
                  }
                }
              });
            }

            return Align(
              alignment: Alignment.bottomCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * .88,
                ),
                child: Material(
                  color: AppColors.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(28),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _PromptSheetHandle(),
                        const SizedBox(height: 14),
                        const Text(
                          'Filter prompt history',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.35,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Filter rendered prompts before pagination, then choose the history order.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9.2,
                            height: 1.35,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _PromptDropdown(
                          label: 'Prompt type',
                          icon: Icons.layers_outlined,
                          value: promptType,
                          options: _promptTypes,
                          onChanged: (value) {
                            setSheetState(() => promptType = value);
                          },
                        ),
                        const SizedBox(height: 11),
                        Row(
                          children: [
                            Expanded(
                              child: _PromptDateButton(
                                label: 'From',
                                value: fromDate,
                                onTap: () => pickDate(from: true),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _PromptDateButton(
                                label: 'To',
                                value: toDate,
                                onTap: () => pickDate(from: false),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 11),
                        _PromptDropdown(
                          label: 'Sort history',
                          icon: Icons.sort_rounded,
                          value: sortBy,
                          options: _sortOptions,
                          onChanged: (value) {
                            setSheetState(() => sortBy = value);
                          },
                        ),
                        const SizedBox(height: 11),
                        _PromptDirectionPicker(
                          value: sortOrder,
                          onChanged: (value) {
                            setSheetState(() => sortOrder = value);
                          },
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () {
                                  setSheetState(() {
                                    promptType = '';
                                    sortBy = 'createdAt';
                                    sortOrder = 'desc';
                                    fromDate = null;
                                    toDate = null;
                                  });
                                },
                                style: OutlinedButton.styleFrom(
                                  minimumSize: const Size(0, 48),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(15),
                                  ),
                                ),
                                child: const Text('Reset'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              flex: 2,
                              child: FilledButton.icon(
                                onPressed: () => Navigator.pop(sheetContext, true),
                                style: FilledButton.styleFrom(
                                  minimumSize: const Size(0, 48),
                                  backgroundColor: AppColors.primary,
                                  foregroundColor: Colors.white,
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(15),
                                  ),
                                ),
                                icon: const Icon(Icons.check_rounded, size: 18),
                                label: const Text(
                                  'Apply filters',
                                  style: TextStyle(fontWeight: FontWeight.w900),
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
          },
        );
      },
    );

    if (!mounted || applied != true) return;
    setState(() {
      _promptType = promptType;
      _sortBy = sortBy;
      _sortOrder = sortOrder;
      _fromDate = fromDate;
      _toDate = toDate;
      _page = 1;
    });
    unawaited(_loadHistory(force: true));
  }

  Future<void> _inspect(Map<String, dynamic> row) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primary.withValues(alpha: .20),
      builder: (_) => _PromptInspector(row: row),
    );
  }

  bool get _dirty => _templateController.text != _savedTemplate;

  int get _tokensOnPage => _history.fold<int>(
        0,
        (sum, row) => sum + _int(row['estimatedInputTokens']),
      );

  int get _activeFilterCount {
    var count = 0;
    if (_promptType.isNotEmpty) count++;
    if (_fromDate != null || _toDate != null) count++;
    if (_sortBy != 'createdAt' || _sortOrder != 'desc') count++;
    return count;
  }

  @override
  Widget build(BuildContext context) {
    final validation = _validate(_templateController.text);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _loadAll(force: true, quiet: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 84),
              children: [
                AdminPageHeader(
                  accentColor: AppColors.primary,
                  title: 'Prompt control',
                  subtitle:
                      'Manage the production idea-generation template and inspect rendered AI prompts.',
                  eyebrow: 'Intelligence',
                  icon: Icons.auto_awesome_outlined,
                  onBack: () => Navigator.maybePop(context),
                  trailing: IconButton(
                    onPressed: _refreshing
                        ? null
                        : () => _loadAll(force: true, quiet: true),
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.primarySoft,
                      foregroundColor: AppColors.primary,
                      fixedSize: const Size(46, 46),
                      side: const BorderSide(color: AppColors.border),
                    ),
                    icon: _refreshing
                        ? const SizedBox(
                            width: 17,
                            height: 17,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.primary,
                            ),
                          )
                        : const Icon(Icons.refresh_rounded, size: 20),
                  ),
                ),
                if (_error.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _PromptNotice(
                    icon: Icons.error_outline_rounded,
                    text: _error,
                    color: AppColors.danger,
                  ),
                ],
                if (_notice.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _PromptNotice(
                    icon: Icons.check_circle_outline_rounded,
                    text: _notice,
                    color: AppColors.success,
                  ),
                ],
                const SizedBox(height: 14),
                _PromptMetricGrid(
                  templateSize: _templateController.text.length,
                  placeholderCount: validation.uniqueCount,
                  totalPlaceholders: _requiredPlaceholders.length,
                  executions: _total,
                  tokensOnPage: _tokensOnPage,
                  valid: validation.valid,
                ),
                const SizedBox(height: 14),
                _PromptTemplateCard(
                  controller: _templateController,
                  loading: _loadingTemplate,
                  saving: _saving,
                  dirty: _dirty,
                  validation: validation,
                  requiredPlaceholders: _requiredPlaceholders,
                  onSave: _saveTemplate,
                  onDiscard: _discardTemplateChanges,
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'AI TRACEABILITY',
                            style: TextStyle(
                              color: AppColors.primary,
                              fontSize: 8.4,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Prompt execution history',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.shield_outlined,
                            size: 12,
                            color: AppColors.primary,
                          ),
                          SizedBox(width: 5),
                          Text(
                            'Read-only history',
                            style: TextStyle(
                              color: AppColors.primary,
                              fontSize: 8.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: AdminSearchField(
                        controller: _searchController,
                        hint: 'Search rendered prompt text...',
                        onChanged: _onSearchChanged,
                        onSubmitted: (_) {},
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 52,
                      height: 52,
                      child: FilledButton.tonal(
                        onPressed: _openFilters,
                        style: FilledButton.styleFrom(
                          backgroundColor: _activeFilterCount > 0
                              ? AppColors.pinkSoft
                              : AppColors.primarySoft,
                          foregroundColor: _activeFilterCount > 0
                              ? AppColors.pinkDeep
                              : AppColors.primary,
                          padding: EdgeInsets.zero,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: Stack(
                          clipBehavior: Clip.none,
                          children: [
                            const Icon(Icons.tune_rounded, size: 20),
                            if (_activeFilterCount > 0)
                              Positioned(
                                right: -8,
                                top: -8,
                                child: Container(
                                  constraints: const BoxConstraints(
                                    minWidth: 18,
                                    minHeight: 18,
                                  ),
                                  alignment: Alignment.center,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 4,
                                  ),
                                  decoration: const BoxDecoration(
                                    color: AppColors.pink,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Text(
                                    '$_activeFilterCount',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 8,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Text(
                      '${_formatNumber(_total)} records',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      'Page $_page of $_totalPages',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.8,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                if (_loadingHistory)
                  const AdminLoadingList(count: 5)
                else if (_history.isEmpty)
                  AdminEmptyState(
                    title: 'No prompt executions match',
                    message:
                        'Try another prompt type, date range, sort option or search phrase.',
                    icon: Icons.file_copy_outlined,
                    onRetry: _error.isEmpty
                        ? null
                        : () => _loadHistory(force: true),
                  )
                else ...[
                  ..._history.map(
                    (row) => Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _PromptHistoryCard(
                        row: row,
                        onTap: () => _inspect(row),
                      ),
                    ),
                  ),
                  if (_totalPages > 1) ...[
                    const SizedBox(height: 4),
                    _PromptPagination(
                      page: _page,
                      totalPages: _totalPages,
                      total: _total,
                      count: _history.length,
                      pageSize: _pageSize,
                      onPrevious: _page <= 1
                          ? null
                          : () {
                              setState(() => _page -= 1);
                              unawaited(_loadHistory());
                            },
                      onNext: _page >= _totalPages
                          ? null
                          : () {
                              setState(() => _page += 1);
                              unawaited(_loadHistory());
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

  _PromptValidation _validate(String text) {
    final matches = RegExp(r'{{([a-zA-Z0-9_]+)}}').allMatches(text).toList();
    final placeholders = matches.map((match) => match.group(1) ?? '').toList();
    final counts = <String, int>{};
    for (final placeholder in placeholders) {
      counts[placeholder] = (counts[placeholder] ?? 0) + 1;
    }
    final missing = _requiredPlaceholders
        .where((key) => !counts.containsKey(key))
        .toList();
    final duplicated = counts.entries
        .where((entry) => entry.value > 1)
        .map((entry) => entry.key)
        .toList();
    final unsupported = counts.keys
        .where((key) => !_requiredPlaceholders.contains(key))
        .toSet()
        .toList();
    final normalizedLength = text.trim().length;
    final lengthValid = normalizedLength >= _minTemplateLength &&
        normalizedLength <= _maxTemplateLength;

    return _PromptValidation(
      placeholders: placeholders,
      missing: missing,
      duplicated: duplicated,
      unsupported: unsupported,
      lengthValid: lengthValid,
    );
  }
}

class _PromptMetricGrid extends StatelessWidget {
  const _PromptMetricGrid({
    required this.templateSize,
    required this.placeholderCount,
    required this.totalPlaceholders,
    required this.executions,
    required this.tokensOnPage,
    required this.valid,
  });

  final int templateSize;
  final int placeholderCount;
  final int totalPlaceholders;
  final int executions;
  final int tokensOnPage;
  final bool valid;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 8) / 2;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            SizedBox(
              width: width,
              child: _PromptMetricCard(
                icon: Icons.text_snippet_outlined,
                label: 'Template size',
                value: _formatNumber(templateSize),
                hint: 'characters in editor',
                tint: AppColors.primarySoft,
              ),
            ),
            SizedBox(
              width: width,
              child: _PromptMetricCard(
                icon: Icons.data_object_rounded,
                label: 'Placeholders',
                value: '$placeholderCount/$totalPlaceholders',
                hint: valid ? 'structure valid' : 'needs attention',
                tint: valid ? const Color(0xFFE8F7F0) : AppColors.pinkSoft,
              ),
            ),
            SizedBox(
              width: width,
              child: _PromptMetricCard(
                icon: Icons.history_rounded,
                label: 'Executions',
                value: _formatNumber(executions),
                hint: 'matching history',
                tint: const Color(0xFFF0F7F3),
              ),
            ),
            SizedBox(
              width: width,
              child: _PromptMetricCard(
                icon: Icons.toll_outlined,
                label: 'Tokens on page',
                value: _compactNumber(tokensOnPage),
                hint: 'estimated input',
                tint: const Color(0xFFFFF7EC),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _PromptMetricCard extends StatelessWidget {
  const _PromptMetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
    required this.tint,
  });

  final IconData icon;
  final String label;
  final String value;
  final String hint;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(11),
      tint: tint.withValues(alpha: .64),
      radius: 18,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AdminIconBadge(icon: icon, size: 32, tone: AppColors.surface),
          const SizedBox(height: 9),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 17,
              fontWeight: FontWeight.w900,
              letterSpacing: -.35,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.2,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            hint,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.7,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptTemplateCard extends StatelessWidget {
  const _PromptTemplateCard({
    required this.controller,
    required this.loading,
    required this.saving,
    required this.dirty,
    required this.validation,
    required this.requiredPlaceholders,
    required this.onSave,
    required this.onDiscard,
  });

  final TextEditingController controller;
  final bool loading;
  final bool saving;
  final bool dirty;
  final _PromptValidation validation;
  final List<String> requiredPlaceholders;
  final VoidCallback onSave;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(13),
      radius: 21,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminIconBadge(
                icon: Icons.code_rounded,
                size: 37,
                tone: AppColors.primarySoft,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'PRODUCTION TEMPLATE',
                      style: TextStyle(
                        color: AppColors.primary,
                        fontSize: 8.1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .9,
                      ),
                    ),
                    const SizedBox(height: 3),
                    const Text(
                      'Active idea-generation prompt',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Changes apply to future generation runs. Existing history stays immutable.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.4,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                decoration: BoxDecoration(
                  color: validation.valid
                      ? const Color(0xFFE8F7F0)
                      : AppColors.pinkSoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  validation.valid ? 'Valid' : 'Fix template',
                  style: TextStyle(
                    color: validation.valid
                        ? AppColors.success
                        : AppColors.danger,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (loading)
            const SizedBox(
              height: 180,
              child: Center(
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.primary,
                ),
              ),
            )
          else
            TextField(
              controller: controller,
              minLines: 11,
              maxLines: 18,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10.3,
                height: 1.48,
                fontFamily: 'monospace',
              ),
              decoration: InputDecoration(
                filled: true,
                fillColor: AppColors.background.withValues(alpha: .72),
                hintText: 'Prompt template',
                contentPadding: const EdgeInsets.all(13),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: const BorderSide(
                    color: AppColors.primary,
                    width: 1.5,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              Text(
                '${controller.text.length} characters',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const Spacer(),
              if (dirty)
                const Text(
                  'Unsaved changes',
                  style: TextStyle(
                    color: AppColors.pinkDeep,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 11),
          const Text(
            'Required placeholders',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 7),
          Wrap(
            spacing: 5,
            runSpacing: 5,
            children: requiredPlaceholders.map((key) {
              final count = validation.placeholders.where((item) => item == key).length;
              final valid = count == 1;
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 5),
                decoration: BoxDecoration(
                  color: valid
                      ? AppColors.primarySoft.withValues(alpha: .7)
                      : AppColors.pinkSoft,
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(
                    color: valid ? AppColors.border : AppColors.pink,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '{{$key}}',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 7.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      valid ? Icons.check_rounded : Icons.error_outline_rounded,
                      size: 10,
                      color: valid ? AppColors.primary : AppColors.danger,
                    ),
                  ],
                ),
              );
            }).toList(),
          ),
          if (!validation.valid) ...[
            const SizedBox(height: 10),
            _PromptValidationBox(validation: validation),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: dirty && !saving ? onDiscard : null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  icon: const Icon(Icons.undo_rounded, size: 17),
                  label: const Text('Discard'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  onPressed: dirty && validation.valid && !saving ? onSave : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  icon: saving
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_outlined, size: 18),
                  label: const Text(
                    'Save production prompt',
                    style: TextStyle(fontWeight: FontWeight.w900),
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

class _PromptValidationBox extends StatelessWidget {
  const _PromptValidationBox({required this.validation});

  final _PromptValidation validation;

  @override
  Widget build(BuildContext context) {
    final messages = <String>[];
    if (!validation.lengthValid) {
      messages.add('Template length must be between 100 and 15,000 characters.');
    }
    if (validation.missing.isNotEmpty) {
      messages.add('Missing: ${validation.missing.join(', ')}');
    }
    if (validation.duplicated.isNotEmpty) {
      messages.add('Duplicated: ${validation.duplicated.join(', ')}');
    }
    if (validation.unsupported.isNotEmpty) {
      messages.add('Unsupported: ${validation.unsupported.join(', ')}');
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.pink.withValues(alpha: .45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: messages
            .map(
              (message) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontSize: 8.2,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _PromptHistoryCard extends StatelessWidget {
  const _PromptHistoryCard({required this.row, required this.onTap});

  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = _map(row['user']);
    final guest = _map(row['guestSession']);
    final idea = _map(row['idea']);
    final collection = _map(row['collectionJob']);
    final domain = _map(collection['domain']);
    final requester = _first(
      user,
      const ['fullName', 'email'],
      fallback: guest.isNotEmpty ? 'Guest session' : 'Internal operation',
    );
    final contextLabel = _first(
      idea,
      const ['title'],
      fallback: _first(domain, const ['name'], fallback: 'No linked context'),
    );
    final promptText = _first(row, const ['promptText']);

    return AdminGlassCard(
      padding: EdgeInsets.zero,
      radius: 19,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AdminIconBadge(
                  icon: Icons.code_rounded,
                  size: 38,
                  tone: AppColors.primarySoft,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _titleCase(_first(row, const ['promptType'], fallback: 'Prompt')),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 12.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        promptText.replaceAll(RegExp(r'\s+'), ' '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 8.8,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 7),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.sage,
                  size: 20,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _PromptMiniChip(
                  icon: Icons.person_outline_rounded,
                  text: requester,
                ),
                _PromptMiniChip(
                  icon: Icons.layers_outlined,
                  text: contextLabel,
                ),
                _PromptMiniChip(
                  icon: Icons.toll_outlined,
                  text: '${_compactNumber(_int(row['estimatedInputTokens']))} tokens',
                ),
              ],
            ),
            const SizedBox(height: 9),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _hashPreview(_first(row, const ['templateHash'])),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _formatDate(row['createdAt']),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.2,
                    fontWeight: FontWeight.w800,
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

class _PromptMiniChip extends StatelessWidget {
  const _PromptMiniChip({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 190),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.border.withValues(alpha: .8)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primary),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 7.9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptInspector extends StatelessWidget {
  const _PromptInspector({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final user = _map(row['user']);
    final guest = _map(row['guestSession']);
    final idea = _map(row['idea']);
    final collection = _map(row['collectionJob']);
    final domain = _map(collection['domain']);
    final sources = (collection['sources'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    final requester = _first(
      user,
      const ['fullName', 'email'],
      fallback: guest.isNotEmpty ? 'Guest session' : 'Internal operation',
    );
    final contextLabel = _first(
      idea,
      const ['title'],
      fallback: _first(domain, const ['name'], fallback: 'No linked context'),
    );
    final promptText = _first(row, const ['promptText']);

    return DraggableScrollableSheet(
      initialChildSize: .88,
      minChildSize: .56,
      maxChildSize: .96,
      expand: false,
      builder: (context, scrollController) {
        return Material(
          color: AppColors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 22),
            children: [
              const _PromptSheetHandle(),
              const SizedBox(height: 14),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AdminIconBadge(
                    icon: Icons.code_rounded,
                    size: 41,
                    tone: AppColors.primarySoft,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'RENDERED PROMPT RECORD',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontSize: 8,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .9,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _titleCase(_first(row, const ['promptType'], fallback: 'Prompt')),
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${_formatDateTime(row['createdAt'])} · $requester',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.8,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 13),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  _PromptDetailChip(
                    label: 'Requester',
                    value: requester,
                    icon: Icons.person_outline_rounded,
                  ),
                  _PromptDetailChip(
                    label: 'Context',
                    value: contextLabel,
                    icon: Icons.layers_outlined,
                  ),
                  _PromptDetailChip(
                    label: 'Estimated input',
                    value: '${_compactNumber(_int(row['estimatedInputTokens']))} tokens',
                    icon: Icons.toll_outlined,
                  ),
                ],
              ),
              const SizedBox(height: 13),
              AdminGlassCard(
                padding: const EdgeInsets.all(12),
                radius: 17,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Full rendered prompt',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: () async {
                            await Clipboard.setData(ClipboardData(text: promptText));
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Prompt copied.')),
                            );
                          },
                          icon: const Icon(Icons.copy_rounded, size: 14),
                          label: const Text(
                            'Copy',
                            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 7),
                    Container(
                      width: double.infinity,
                      constraints: const BoxConstraints(minHeight: 130),
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: AppColors.background.withValues(alpha: .72),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: SelectableText(
                        promptText.isEmpty ? 'No prompt text was returned.' : promptText,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 9.2,
                          height: 1.45,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              _PromptIdCard(row: row),
              if (collection.isNotEmpty) ...[
                const SizedBox(height: 10),
                AdminGlassCard(
                  padding: const EdgeInsets.all(12),
                  radius: 17,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Evidence context',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        _first(domain, const ['name'], fallback: 'Collection context'),
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 8.7,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _PromptMiniChip(
                            icon: Icons.article_outlined,
                            text: '${_int(collection['totalPosts'])} posts',
                          ),
                          _PromptMiniChip(
                            icon: Icons.chat_bubble_outline_rounded,
                            text: '${_int(collection['totalComments'])} comments',
                          ),
                          _PromptMiniChip(
                            icon: Icons.translate_rounded,
                            text: _first(collection, const ['language'], fallback: 'ANY'),
                          ),
                          _PromptMiniChip(
                            icon: Icons.location_on_outlined,
                            text: _locationLabel(collection),
                          ),
                        ],
                      ),
                      if (sources.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 5,
                          runSpacing: 5,
                          children: sources.map((source) {
                            final dataSource = _map(source['dataSource']);
                            return _PromptMiniChip(
                              icon: Icons.hub_outlined,
                              text: _first(
                                dataSource,
                                const ['displayName', 'key'],
                                fallback: 'Source',
                              ),
                            );
                          }).toList(),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _PromptIdCard extends StatelessWidget {
  const _PromptIdCard({required this.row});

  final Map<String, dynamic> row;

  @override
  Widget build(BuildContext context) {
    final entries = <MapEntry<String, String>>[
      MapEntry('Prompt ID', _first(row, const ['id'], fallback: '—')),
      MapEntry('Template hash', _first(row, const ['templateHash'], fallback: '—')),
      MapEntry('Generation run', _first(row, const ['generationRunId'], fallback: '—')),
      MapEntry(
        'Collection job',
        _first(
          row,
          const ['collectionJobId'],
          fallback: _first(_map(row['collectionJob']), const ['id'], fallback: '—'),
        ),
      ),
    ];

    return AdminGlassCard(
      padding: const EdgeInsets.all(12),
      radius: 17,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Technical references',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 9),
          ...entries.map(
            (entry) => Padding(
              padding: const EdgeInsets.only(bottom: 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 94,
                    child: Text(
                      entry.key,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Expanded(
                    child: SelectableText(
                      entry.value,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.5,
                        height: 1.35,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptDetailChip extends StatelessWidget {
  const _PromptDetailChip({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 108, maxWidth: 210),
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.primary),
          const SizedBox(width: 6),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.4,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  value,
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
        ],
      ),
    );
  }
}

class _PromptPagination extends StatelessWidget {
  const _PromptPagination({
    required this.page,
    required this.totalPages,
    required this.total,
    required this.count,
    required this.pageSize,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final int total;
  final int count;
  final int pageSize;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final first = count == 0 ? 0 : ((page - 1) * pageSize) + 1;
    final last = count == 0 ? 0 : first + count - 1;
    return AdminGlassCard(
      padding: const EdgeInsets.all(10),
      radius: 16,
      child: Column(
        children: [
          Text(
            'Showing $first–$last of $total',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.8,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onPrevious,
                  icon: const Icon(Icons.chevron_left_rounded, size: 18),
                  label: const Text('Previous'),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Text(
                  '$page / $totalPages',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onNext,
                  icon: const Icon(Icons.chevron_right_rounded, size: 18),
                  label: const Text('Next'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PromptDropdown extends StatelessWidget {
  const _PromptDropdown({
    required this.label,
    required this.icon,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final IconData icon;
  final String value;
  final List<_PromptOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return AdminSelectionField(
      key: ValueKey('$label-$value'),
      label: label,
      icon: icon,
      value: value,
      options: options
          .map(
            (option) => AdminSelectionOption(
              value: option.key,
              label: option.label,
              icon: icon,
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _PromptDateButton extends StatelessWidget {
  const _PromptDateButton({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.background.withValues(alpha: .68),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.calendar_month_outlined,
                size: 17,
                color: AppColors.primary,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.7,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      value == null ? 'Any date' : DateFormat('MMM d, yyyy').format(value!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.2,
                        fontWeight: FontWeight.w900,
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

class _PromptDirectionPicker extends StatelessWidget {
  const _PromptDirectionPicker({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Expanded(
            child: _PromptDirectionOption(
              label: 'Ascending',
              icon: Icons.arrow_upward_rounded,
              selected: value == 'asc',
              onTap: () => onChanged('asc'),
            ),
          ),
          const SizedBox(width: 5),
          Expanded(
            child: _PromptDirectionOption(
              label: 'Descending',
              icon: Icons.arrow_downward_rounded,
              selected: value == 'desc',
              onTap: () => onChanged('desc'),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptDirectionOption extends StatelessWidget {
  const _PromptDirectionOption({
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
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(11),
        child: Ink(
          height: 42,
          decoration: BoxDecoration(
            color: selected ? AppColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.textPrimary
                      : AppColors.textSecondary,
                  fontSize: 8.4,
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

class _PromptNotice extends StatelessWidget {
  const _PromptNotice({
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: color.withValues(alpha: .18)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: color,
                fontSize: 9,
                height: 1.35,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromptSheetHandle extends StatelessWidget {
  const _PromptSheetHandle();

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

class _PromptOption {
  const _PromptOption(this.key, this.label);

  final String key;
  final String label;
}

class _PromptValidation {
  const _PromptValidation({
    required this.placeholders,
    required this.missing,
    required this.duplicated,
    required this.unsupported,
    required this.lengthValid,
  });

  final List<String> placeholders;
  final List<String> missing;
  final List<String> duplicated;
  final List<String> unsupported;
  final bool lengthValid;

  int get uniqueCount => placeholders.toSet().length;

  bool get valid =>
      lengthValid &&
      missing.isEmpty &&
      duplicated.isEmpty &&
      unsupported.isEmpty;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

String _first(
  Map<String, dynamic> map,
  List<String> keys, {
  String fallback = '',
}) {
  for (final key in keys) {
    final value = map[key]?.toString().trim() ?? '';
    if (value.isNotEmpty && value.toLowerCase() != 'null') return value;
  }
  return fallback;
}

int _int(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

String _titleCase(String value) {
  return value
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _hashPreview(String value) {
  if (value.isEmpty) return 'No template hash';
  return value.length > 14
      ? '${value.substring(0, 8)}…${value.substring(value.length - 5)}'
      : value;
}

String _formatNumber(num value) => NumberFormat.decimalPattern().format(value);

String _compactNumber(num value) {
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(value % 1000000 == 0 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(value % 1000 == 0 ? 0 : 1)}K';
  }
  return value.toStringAsFixed(0);
}

String _formatDate(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy · HH:mm').format(date);
}

String _formatDateTime(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return '—';
  return DateFormat('MMM d, yyyy · h:mm a').format(date);
}

String _startOfDayIso(DateTime value) {
  return DateTime(value.year, value.month, value.day).toUtc().toIso8601String();
}

String _endOfDayIso(DateTime value) {
  return DateTime(
    value.year,
    value.month,
    value.day,
    23,
    59,
    59,
    999,
  ).toUtc().toIso8601String();
}

String _locationLabel(Map<String, dynamic> collection) {
  final values = [
    _first(collection, const ['city']),
    _first(collection, const ['region']),
    _first(collection, const ['country']),
  ].where((value) => value.isNotEmpty).toList();
  return values.isEmpty ? 'Any location' : values.join(', ');
}
