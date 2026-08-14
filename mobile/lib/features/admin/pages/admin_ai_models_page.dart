import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/ai_models_api.dart';
import '../widgets/admin_ui.dart';

/// Full mobile administration workspace for the AI-model registry.
///
/// The page mirrors the important web capabilities while adapting them to a
/// touch-first layout.
///
/// @author Eman
class AdminAiModelsPage extends StatefulWidget {
  const AdminAiModelsPage({super.key});

  @override
  State<AdminAiModelsPage> createState() => _AdminAiModelsPageState();
}

class _AdminAiModelsPageState extends State<AdminAiModelsPage> {
  static const int _pageSize = 20;

  final AiModelsApi _api = AiModelsApi.instance;

  final TextEditingController _searchController = TextEditingController();

  Timer? _searchDebounce;

  List<Map<String, dynamic>> _models = const [];
  List<Map<String, dynamic>> _providers = const [];

  Map<String, dynamic> _summary = const {};

  bool _loading = true;
  bool _refreshing = false;

  String _error = '';

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  String _search = '';
  String _status = 'all';
  String _provider = '';
  String _health = '';

  String _sortBy = 'priority';
  String _sortOrder = 'desc';

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

    try {
      bool? isActive;
      bool? isDefault;

      if (_status == 'active') {
        isActive = true;
      }

      if (_status == 'inactive') {
        isActive = false;
      }

      if (_status == 'default') {
        isDefault = true;
      }

      final result = await Future.wait<dynamic>([
        _api.list(
          page: _page,
          limit: _pageSize,
          search: _search,
          providerKey: _provider,
          healthStatus: _health,
          isActive: isActive,
          isDefault: isDefault,
          sortBy: _sortBy,
          sortOrder: _sortOrder,
          force: force,
        ),
        _api.summary(force: force),
        _api.providers(force: force),
      ]);

      final list = result[0] as Map<String, dynamic>;

      final summary = result[1] as Map<String, dynamic>;

      final providers = result[2] as List<Map<String, dynamic>>;

      final rows = (list['items'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

      final meta = list['meta'] is Map
          ? Map<String, dynamic>.from(list['meta'] as Map)
          : <String, dynamic>{};

      if (!mounted) {
        return;
      }

      setState(() {
        _models = rows;
        _summary = summary;
        _providers = providers;

        _total = _asInt(meta['total']);

        _page = _asInt(meta['page']).clamp(1, 999999).toInt();

        _totalPages = _asInt(meta['totalPages']).clamp(1, 999999).toInt();

        _loading = false;
        _refreshing = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = error.message;
        _loading = false;
        _refreshing = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = 'Could not load AI models. Please try again.';

        _loading = false;
        _refreshing = false;
      });
    }
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();

    _searchDebounce = Timer(const Duration(milliseconds: 420), () {
      final normalized = value.trim();

      if (normalized == _search || !mounted) {
        return;
      }

      setState(() {
        _search = normalized;
        _page = 1;
      });

      _load(quiet: true);
    });
  }

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<_AiModelFilterValue>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _AiModelFiltersSheet(
          current: _AiModelFilterValue(
            status: _status,
            provider: _provider,
            health: _health,
            sortBy: _sortBy,
            sortOrder: _sortOrder,
          ),
          providers: _providers,
        );
      },
    );

    if (result == null || !mounted) {
      return;
    }

    setState(() {
      _status = result.status;
      _provider = result.provider;
      _health = result.health;
      _sortBy = result.sortBy;
      _sortOrder = result.sortOrder;
      _page = 1;
    });

    await _load(quiet: true);
  }

  Future<void> _openCreate() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _AiModelEditorSheet(
          providers: _providers,
          onCreate: _api.create,
        );
      },
    );

    if (changed == true && mounted) {
      _showMessage('Model added successfully.');

      await _load(force: true, quiet: true);
    }
  }

  Future<void> _openModel(Map<String, dynamic> model) async {
    final id = _asString(model['id']);

    if (id.isEmpty) {
      return;
    }

    Map<String, dynamic> detail = model;

    try {
      detail = await _api.detail(id);
    } catch (_) {
      detail = model;
    }

    if (!mounted) {
      return;
    }

    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _AiModelManageSheet(
          model: detail,
          providers: _providers,
          api: _api,
        );
      },
    );

    if (changed == true && mounted) {
      await _load(force: true, quiet: true);
    }
  }

  void _showMessage(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  int get _activeFilterCount {
    var count = 0;

    if (_status != 'all') {
      count++;
    }

    if (_provider.isNotEmpty) {
      count++;
    }

    if (_health.isNotEmpty) {
      count++;
    }

    if (_sortBy != 'priority' || _sortOrder != 'desc') {
      count++;
    }

    return count;
  }

  void _clearFilters() {
    _searchController.clear();

    setState(() {
      _search = '';
      _status = 'all';
      _provider = '';
      _health = '';
      _sortBy = 'priority';
      _sortOrder = 'desc';
      _page = 1;
    });

    _load(quiet: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () {
              return _load(force: true, quiet: true);
            },
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 100),
                  sliver: SliverList.list(
                    children: [
                      AdminPageHeader(
                        title: 'AI models',
                        subtitle:
                            'Manage providers, routing, health and model capabilities.',
                        eyebrow: 'Intelligence',
                        icon: Icons.psychology_alt_outlined,
                        onBack: () {
                          Navigator.maybePop(context);
                        },
                        trailing: _HeaderActions(
                          refreshing: _refreshing,
                          onRefresh: () {
                            _load(force: true, quiet: true);
                          },
                          onAdd: _openCreate,
                        ),
                      ),
                      const SizedBox(height: 18),
                      _SummaryStrip(summary: _summary),
                      const SizedBox(height: 16),
                      _SearchAndFilter(
                        controller: _searchController,
                        onChanged: _onSearchChanged,
                        onFilter: _openFilters,
                        activeFilterCount: _activeFilterCount,
                      ),
                      const SizedBox(height: 12),
                      _ListMeta(
                        total: _total,
                        page: _page,
                        totalPages: _totalPages,
                        sortLabel: _sortLabel(_sortBy),
                        sortOrder: _sortOrder,
                      ),
                      const SizedBox(height: 10),
                      if (_loading)
                        const _LoadingModels()
                      else if (_error.isNotEmpty)
                        _ErrorState(
                          message: _error,
                          onRetry: () {
                            _load(force: true);
                          },
                        )
                      else if (_models.isEmpty)
                        _EmptyState(
                          hasFilters:
                              _activeFilterCount > 0 || _search.isNotEmpty,
                          onClear: _clearFilters,
                          onAdd: _openCreate,
                        )
                      else ...[
                        for (
                          var index = 0;
                          index < _models.length;
                          index++
                        ) ...[
                          _AiModelCard(
                            model: _models[index],
                            onTap: () {
                              _openModel(_models[index]);
                            },
                          ),
                          if (index != _models.length - 1)
                            const SizedBox(height: 10),
                        ],
                        if (_totalPages > 1) ...[
                          const SizedBox(height: 14),
                          _PaginationBar(
                            page: _page,
                            totalPages: _totalPages,
                            onPrevious: _page > 1
                                ? () {
                                    setState(() {
                                      _page--;
                                    });

                                    _load(quiet: true);
                                  }
                                : null,
                            onNext: _page < _totalPages
                                ? () {
                                    setState(() {
                                      _page++;
                                    });

                                    _load(quiet: true);
                                  }
                                : null,
                          ),
                        ],
                      ],
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

class _HeaderActions extends StatelessWidget {
  const _HeaderActions({
    required this.refreshing,
    required this.onRefresh,
    required this.onAdd,
  });

  final bool refreshing;
  final VoidCallback onRefresh;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _RoundAction(
          icon: refreshing ? null : Icons.refresh_rounded,
          onTap: refreshing ? null : onRefresh,
          tooltip: 'Refresh models',
          child: refreshing
              ? const SizedBox(
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primaryDark,
                  ),
                )
              : null,
        ),
        const SizedBox(width: 7),
        _RoundAction(
          icon: Icons.add_rounded,
          onTap: onAdd,
          tooltip: 'Add model',
          filled: true,
        ),
      ],
    );
  }
}

class _RoundAction extends StatelessWidget {
  const _RoundAction({
    this.icon,
    this.child,
    required this.onTap,
    required this.tooltip,
    this.filled = false,
  });

  final IconData? icon;
  final Widget? child;
  final VoidCallback? onTap;
  final String tooltip;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: filled ? AppColors.primaryDark : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(15),
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(15),
              border: Border.all(
                color: filled ? AppColors.primaryDark : AppColors.border,
              ),
            ),
            child:
                child ??
                Icon(
                  icon,
                  size: 20,
                  color: filled ? Colors.white : AppColors.primaryDark,
                ),
          ),
        ),
      ),
    );
  }
}

class _SummaryStrip extends StatelessWidget {
  const _SummaryStrip({required this.summary});

  final Map<String, dynamic> summary;

  @override
  Widget build(BuildContext context) {
    final degraded = _asInt(summary['degradedModels']);

    final unavailable = _asInt(summary['unavailableModels']);

    final metrics = <_MetricData>[
      _MetricData(
        label: 'Total',
        value: _asInt(summary['totalModels']),
        icon: Icons.psychology_alt_outlined,
        tone: AppColors.primarySoft,
        iconColor: AppColors.primaryDark,
      ),
      _MetricData(
        label: 'Active',
        value: _asInt(summary['activeModels']),
        icon: Icons.check_circle_outline_rounded,
        tone: const Color(0xFFE8F7F0),
        iconColor: AppColors.success,
      ),
      _MetricData(
        label: 'Inactive',
        value: _asInt(summary['inactiveModels']),
        icon: Icons.pause_circle_outline_rounded,
        tone: AppColors.pinkSoft,
        iconColor: AppColors.pinkDeep,
      ),
      _MetricData(
        label: 'Default',
        value: _asInt(summary['defaultModels']),
        icon: Icons.star_outline_rounded,
        tone: const Color(0xFFFFF5E8),
        iconColor: AppColors.warning,
      ),
      _MetricData(
        label: 'Healthy',
        value: _asInt(summary['healthyModels']),
        icon: Icons.favorite_border_rounded,
        tone: const Color(0xFFE8F7F0),
        iconColor: AppColors.success,
      ),
      _MetricData(
        label: 'Attention',
        value: degraded + unavailable,
        icon: Icons.warning_amber_rounded,
        tone: AppColors.pinkSoft,
        iconColor: AppColors.danger,
      ),
    ];

    return SizedBox(
      height: 94,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: metrics.length,
        separatorBuilder: (_, _) {
          return const SizedBox(width: 9);
        },
        itemBuilder: (context, index) {
          final metric = metrics[index];

          return Container(
            width: 118,
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(19),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDark.withValues(alpha: .035),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 33,
                  height: 33,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: metric.tone,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(metric.icon, size: 17, color: metric.iconColor),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${metric.value}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          height: 1,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        metric.label,
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
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MetricData {
  const _MetricData({
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
}

class _SearchAndFilter extends StatelessWidget {
  const _SearchAndFilter({
    required this.controller,
    required this.onChanged,
    required this.onFilter,
    required this.activeFilterCount,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onFilter;
  final int activeFilterCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: controller,
            onChanged: onChanged,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              hintText: 'Search AI models...',
              prefixIcon: Icon(Icons.search_rounded),
            ),
          ),
        ),
        const SizedBox(width: 9),
        Material(
          color: activeFilterCount > 0
              ? AppColors.primaryDark
              : AppColors.primarySoft,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            onTap: onFilter,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              width: 54,
              height: 54,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: activeFilterCount > 0
                      ? AppColors.primaryDark
                      : AppColors.border,
                ),
              ),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(
                    Icons.tune_rounded,
                    color: activeFilterCount > 0
                        ? Colors.white
                        : AppColors.primaryDark,
                    size: 21,
                  ),
                  if (activeFilterCount > 0)
                    Positioned(
                      right: -10,
                      top: -10,
                      child: Container(
                        width: 20,
                        height: 20,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.pink,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: AppColors.surface,
                            width: 2,
                          ),
                        ),
                        child: Text(
                          '$activeFilterCount',
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
        ),
      ],
    );
  }
}

class _ListMeta extends StatelessWidget {
  const _ListMeta({
    required this.total,
    required this.page,
    required this.totalPages,
    required this.sortLabel,
    required this.sortOrder,
  });

  final int total;
  final int page;
  final int totalPages;

  final String sortLabel;
  final String sortOrder;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          '$total records',
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
        const Spacer(),
        Icon(
          sortOrder == 'asc'
              ? Icons.arrow_upward_rounded
              : Icons.arrow_downward_rounded,
          size: 12,
          color: AppColors.textMuted,
        ),
        const SizedBox(width: 3),
        Text(
          '$sortLabel · Page $page of $totalPages',
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _AiModelCard extends StatelessWidget {
  const _AiModelCard({required this.model, required this.onTap});

  final Map<String, dynamic> model;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = _displayName(model);

    final provider = _asString(model['providerKey']);

    final description = _asString(model['description']);

    final active = _asBool(model['isActive']);

    final isDefault = _asBool(model['isDefault']);

    final health = _asString(model['healthStatus']).toUpperCase();

    final failures = _asInt(model['consecutiveFailures']);

    return AdminGlassCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      radius: 21,
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ProviderBadge(provider: provider),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          if (isDefault) ...[
                            const SizedBox(width: 6),
                            const Icon(
                              Icons.star_rounded,
                              size: 16,
                              color: AppColors.warning,
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${_providerLabel(provider)} · ${_asString(model['apiModelId'])}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.8,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.sage,
                  size: 20,
                ),
              ],
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: 11),
              Text(
                description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10.6,
                  height: 1.45,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _TinyPill(
                  label: active ? 'Active' : 'Inactive',
                  icon: active
                      ? Icons.check_circle_outline_rounded
                      : Icons.pause_circle_outline_rounded,
                  background: active
                      ? const Color(0xFFE8F7F0)
                      : AppColors.pinkSoft,
                  foreground: active ? AppColors.success : AppColors.pinkDeep,
                ),
                _HealthPill(health: health),
                if (isDefault)
                  const _TinyPill(
                    label: 'Default',
                    icon: Icons.star_outline_rounded,
                    background: Color(0xFFFFF5E8),
                    foreground: AppColors.warning,
                  ),
                _TinyPill(
                  label: 'P${_asInt(model['priority'])}',
                  icon: Icons.low_priority_rounded,
                ),
                _TinyPill(
                  label: 'W${_asInt(model['weight'])}',
                  icon: Icons.balance_rounded,
                ),
                if (failures > 0)
                  _TinyPill(
                    label: '$failures failures',
                    icon: Icons.warning_amber_rounded,
                    background: AppColors.pinkSoft,
                    foreground: AppColors.danger,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _CapabilityIcon(
                  active: _asBool(model['supportsJsonOutput']),
                  icon: Icons.data_object_rounded,
                  label: 'JSON',
                ),
                const SizedBox(width: 8),
                _CapabilityIcon(
                  active: _asBool(model['supportsTools']),
                  icon: Icons.build_outlined,
                  label: 'Tools',
                ),
                const SizedBox(width: 8),
                _CapabilityIcon(
                  active: _asBool(model['supportsVision']),
                  icon: Icons.visibility_outlined,
                  label: 'Vision',
                ),
                const Spacer(),
                const Icon(
                  Icons.schedule_rounded,
                  size: 12,
                  color: AppColors.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  _formatDate(model['updatedAt']),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
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

class _ProviderBadge extends StatelessWidget {
  const _ProviderBadge({required this.provider});

  final String provider;

  @override
  Widget build(BuildContext context) {
    final label = provider.isEmpty
        ? 'AI'
        : provider.substring(0, 1).toUpperCase();

    return Container(
      width: 48,
      height: 48,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.primaryDark,
          fontSize: 17,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _CapabilityIcon extends StatelessWidget {
  const _CapabilityIcon({
    required this.active,
    required this.icon,
    required this.label,
  });

  final bool active;
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 13,
          color: active ? AppColors.primaryDark : AppColors.silver,
        ),
        const SizedBox(width: 3),
        Text(
          label,
          style: TextStyle(
            color: active ? AppColors.textSecondary : AppColors.textMuted,
            fontSize: 8.8,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _TinyPill extends StatelessWidget {
  const _TinyPill({
    required this.label,
    required this.icon,
    this.background = AppColors.primarySoft,
    this.foreground = AppColors.primaryDark,
  });

  final String label;
  final IconData icon;

  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: foreground),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 8.8,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _HealthPill extends StatelessWidget {
  const _HealthPill({required this.health});

  final String health;

  @override
  Widget build(BuildContext context) {
    Color background;
    Color foreground;
    IconData icon;

    switch (health) {
      case 'HEALTHY':
        background = const Color(0xFFE8F7F0);

        foreground = AppColors.success;

        icon = Icons.favorite_outline_rounded;

        break;

      case 'DEGRADED':
        background = const Color(0xFFFFF5E8);

        foreground = AppColors.warning;

        icon = Icons.monitor_heart_outlined;

        break;

      case 'UNAVAILABLE':
        background = AppColors.pinkSoft;

        foreground = AppColors.danger;

        icon = Icons.cloud_off_outlined;

        break;

      default:
        background = AppColors.primarySoft;

        foreground = AppColors.textMuted;

        icon = Icons.help_outline_rounded;
    }

    return _TinyPill(
      label: _titleCase(health.isEmpty ? 'UNKNOWN' : health),
      icon: icon,
      background: background,
      foreground: foreground,
    );
  }
}

class _LoadingModels extends StatelessWidget {
  const _LoadingModels();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(4, (index) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Container(
            height: 168,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(21),
              border: Border.all(color: AppColors.border),
            ),
            child: const Center(
              child: CircularProgressIndicator(
                strokeWidth: 2.3,
                color: AppColors.primary,
              ),
            ),
          ),
        );
      }),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      child: Column(
        children: [
          const AdminIconBadge(
            icon: Icons.error_outline_rounded,
            tone: AppColors.pinkSoft,
            iconColor: AppColors.danger,
          ),
          const SizedBox(height: 12),
          const Text(
            'Could not load models',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 17),
            label: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.hasFilters,
    required this.onClear,
    required this.onAdd,
  });

  final bool hasFilters;

  final VoidCallback onClear;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      child: Column(
        children: [
          const AdminIconBadge(icon: Icons.psychology_alt_outlined),
          const SizedBox(height: 12),
          Text(
            hasFilters ? 'No matching models' : 'No AI models yet',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            hasFilters
                ? 'Clear the active filters or try another search.'
                : 'Register the first model to make it available for AI routing.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 10.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 14),
          if (hasFilters)
            OutlinedButton.icon(
              onPressed: onClear,
              icon: const Icon(Icons.filter_alt_off_rounded, size: 17),
              label: const Text('Clear filters'),
            )
          else
            FilledButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add_rounded, size: 17),
              label: const Text('Add model'),
            ),
        ],
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
    return AdminGlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
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
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
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

class _AiModelFilterValue {
  const _AiModelFilterValue({
    required this.status,
    required this.provider,
    required this.health,
    required this.sortBy,
    required this.sortOrder,
  });

  final String status;
  final String provider;
  final String health;
  final String sortBy;
  final String sortOrder;
}

class _AiModelFiltersSheet extends StatefulWidget {
  const _AiModelFiltersSheet({required this.current, required this.providers});

  final _AiModelFilterValue current;

  final List<Map<String, dynamic>> providers;

  @override
  State<_AiModelFiltersSheet> createState() {
    return _AiModelFiltersSheetState();
  }
}

class _AiModelFiltersSheetState extends State<_AiModelFiltersSheet> {
  late String _status;
  late String _provider;
  late String _health;
  late String _sortBy;
  late String _sortOrder;

  @override
  void initState() {
    super.initState();

    _status = widget.current.status;

    _provider = widget.current.provider;

    _health = widget.current.health;

    _sortBy = widget.current.sortBy;

    _sortOrder = widget.current.sortOrder;
  }

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      initialChildSize: .78,
      minChildSize: .55,
      maxChildSize: .94,
      builder: (context, scrollController) {
        return Column(
          children: [
            _SheetHeader(
              icon: Icons.tune_rounded,
              eyebrow: 'MODEL DISCOVERY',
              title: 'Filter & sort',
              subtitle:
                  'Narrow the registry without losing mobile readability.',
              onClose: () {
                Navigator.pop(context);
              },
            ),
            Expanded(
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(18, 6, 18, 24),
                children: [
                  _ChoiceSection(
                    title: 'Model state',
                    child: Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        _ChoiceChip('All', 'all', _status, (value) {
                          setState(() {
                            _status = value;
                          });
                        }),
                        _ChoiceChip('Active', 'active', _status, (value) {
                          setState(() {
                            _status = value;
                          });
                        }),
                        _ChoiceChip('Inactive', 'inactive', _status, (value) {
                          setState(() {
                            _status = value;
                          });
                        }),
                        _ChoiceChip('Default', 'default', _status, (value) {
                          setState(() {
                            _status = value;
                          });
                        }),
                      ],
                    ),
                  ),
                  _ChoiceSection(
                    title: 'Health',
                    child: Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        _ChoiceChip('All health', '', _health, (value) {
                          setState(() {
                            _health = value;
                          });
                        }),
                        _ChoiceChip('Healthy', 'HEALTHY', _health, (value) {
                          setState(() {
                            _health = value;
                          });
                        }),
                        _ChoiceChip('Degraded', 'DEGRADED', _health, (value) {
                          setState(() {
                            _health = value;
                          });
                        }),
                        _ChoiceChip('Unknown', 'UNKNOWN', _health, (value) {
                          setState(() {
                            _health = value;
                          });
                        }),
                        _ChoiceChip('Unavailable', 'UNAVAILABLE', _health, (
                          value,
                        ) {
                          setState(() {
                            _health = value;
                          });
                        }),
                      ],
                    ),
                  ),
                  _ChoiceSection(
                    title: 'Provider',
                    child: DropdownButtonFormField<String>(
                      initialValue: _provider,
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.hub_outlined),
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text('All providers'),
                        ),
                        ...widget.providers.map((provider) {
                          final key = _asString(provider['key']);

                          final displayName = _asString(
                            provider['displayName'],
                          );

                          return DropdownMenuItem(
                            value: key,
                            child: Text(
                              displayName.isNotEmpty
                                  ? displayName
                                  : _providerLabel(key),
                            ),
                          );
                        }),
                      ],
                      onChanged: (value) {
                        setState(() {
                          _provider = value ?? '';
                        });
                      },
                    ),
                  ),
                  _ChoiceSection(
                    title: 'Sort by',
                    child: DropdownButtonFormField<String>(
                      initialValue: _sortBy,
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.sort_rounded),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'priority',
                          child: Text('Priority'),
                        ),
                        DropdownMenuItem(
                          value: 'modelName',
                          child: Text('Model name'),
                        ),
                        DropdownMenuItem(
                          value: 'providerKey',
                          child: Text('Provider'),
                        ),
                        DropdownMenuItem(
                          value: 'healthStatus',
                          child: Text('Health status'),
                        ),
                        DropdownMenuItem(
                          value: 'updatedAt',
                          child: Text('Last updated'),
                        ),
                        DropdownMenuItem(
                          value: 'createdAt',
                          child: Text('Created date'),
                        ),
                      ],
                      onChanged: (value) {
                        setState(() {
                          _sortBy = value ?? 'priority';
                        });
                      },
                    ),
                  ),
                  _ChoiceSection(
                    title: 'Direction',
                    child: Row(
                      children: [
                        Expanded(
                          child: _DirectionCard(
                            selected: _sortOrder == 'asc',
                            icon: Icons.arrow_upward_rounded,
                            title: 'Ascending',
                            onTap: () {
                              setState(() {
                                _sortOrder = 'asc';
                              });
                            },
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: _DirectionCard(
                            selected: _sortOrder == 'desc',
                            icon: Icons.arrow_downward_rounded,
                            title: 'Descending',
                            onTap: () {
                              setState(() {
                                _sortOrder = 'desc';
                              });
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () {
                            setState(() {
                              _status = 'all';

                              _provider = '';

                              _health = '';

                              _sortBy = 'priority';

                              _sortOrder = 'desc';
                            });
                          },
                          child: const Text('Reset'),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        flex: 2,
                        child: FilledButton.icon(
                          onPressed: () {
                            Navigator.pop(
                              context,
                              _AiModelFilterValue(
                                status: _status,
                                provider: _provider,
                                health: _health,
                                sortBy: _sortBy,
                                sortOrder: _sortOrder,
                              ),
                            );
                          },
                          icon: const Icon(Icons.check_rounded, size: 17),
                          label: const Text('Apply filters'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ChoiceSection extends StatelessWidget {
  const _ChoiceSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.5,
              letterSpacing: .8,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

class _ChoiceChip extends StatelessWidget {
  const _ChoiceChip(this.label, this.value, this.selectedValue, this.onChanged);

  final String label;
  final String value;
  final String selectedValue;

  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final selected = value == selectedValue;

    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) {
        onChanged(value);
      },
      showCheckmark: false,
      labelStyle: TextStyle(
        color: selected ? Colors.white : AppColors.textSecondary,
        fontSize: 10,
        fontWeight: FontWeight.w800,
      ),
      selectedColor: AppColors.primaryDark,
      backgroundColor: AppColors.surface,
      side: BorderSide(
        color: selected ? AppColors.primaryDark : AppColors.border,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    );
  }
}

class _DirectionCard extends StatelessWidget {
  const _DirectionCard({
    required this.selected,
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : AppColors.surface,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 6),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
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

class _AiModelManageSheet extends StatefulWidget {
  const _AiModelManageSheet({
    required this.model,
    required this.providers,
    required this.api,
  });

  final Map<String, dynamic> model;

  final List<Map<String, dynamic>> providers;

  final AiModelsApi api;

  @override
  State<_AiModelManageSheet> createState() {
    return _AiModelManageSheetState();
  }
}

class _AiModelManageSheetState extends State<_AiModelManageSheet> {
  late Map<String, dynamic> _model;

  bool _busy = false;

  @override
  void initState() {
    super.initState();

    _model = Map<String, dynamic>.from(widget.model);
  }

  Future<void> _edit() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _AiModelEditorSheet(
          model: _model,
          providers: widget.providers,
          onUpdate: (body) {
            return widget.api.update(_asString(_model['id']), body);
          },
        );
      },
    );

    if (changed != true || !mounted) {
      return;
    }

    try {
      final fresh = await widget.api.detail(
        _asString(_model['id']),
        force: true,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _model = fresh;
      });

      _message('Model updated successfully.');
    } on ApiException catch (error) {
      _message(error.message);
    }
  }

  Future<void> _toggleActive() async {
    if (_busy) {
      return;
    }

    final current = _asBool(_model['isActive']);

    final next = !current;

    if (!next && _asBool(_model['isDefault'])) {
      _message('Choose another default model before deactivating this one.');

      return;
    }

    setState(() {
      _busy = true;
    });

    try {
      final value = await widget.api.setActive(_asString(_model['id']), next);

      if (!mounted) {
        return;
      }

      setState(() {
        _model = value;

        _busy = false;
      });

      _message(next ? 'Model activated.' : 'Model deactivated.');
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _busy = false;
      });

      _message(error.message);
    }
  }

  Future<void> _setDefault() async {
    if (_busy || _asBool(_model['isDefault'])) {
      return;
    }

    if (!_asBool(_model['isActive'])) {
      _message('Activate this model before setting it as default.');

      return;
    }

    setState(() {
      _busy = true;
    });

    try {
      final value = await widget.api.setDefault(_asString(_model['id']));

      if (!mounted) {
        return;
      }

      setState(() {
        _model = value;

        _busy = false;
      });

      _message('Default model updated.');
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _busy = false;
      });

      _message(error.message);
    }
  }

  Future<void> _delete() async {
    if (_busy) {
      return;
    }

    if (_asBool(_model['isDefault'])) {
      _message(
        'The default model cannot be deleted. Choose another default first.',
      );

      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: AppColors.surface,
          title: const Text('Delete AI model?'),
          content: Text(
            'This permanently removes ${_displayName(_model)} from the routing registry. Historical execution logs stay available.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(context, false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () {
                Navigator.pop(context, true);
              },
              child: const Text('Delete model'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() {
      _busy = true;
    });

    try {
      await widget.api.remove(_asString(_model['id']));

      if (!mounted) {
        return;
      }

      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _busy = false;
      });

      _message(error.message);
    }
  }

  void _message(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final active = _asBool(_model['isActive']);

    final isDefault = _asBool(_model['isDefault']);

    final health = _asString(_model['healthStatus']).toUpperCase();

    return _SheetShell(
      initialChildSize: .92,
      minChildSize: .68,
      maxChildSize: .97,
      builder: (context, scrollController) {
        return Column(
          children: [
            _SheetHeader(
              icon: Icons.psychology_alt_outlined,
              eyebrow: 'MODEL OPERATIONS',
              title: _displayName(_model),
              subtitle:
                  '${_providerLabel(_asString(_model['providerKey']))} · ${_asString(_model['apiModelId'])}',
              onClose: () {
                Navigator.pop(context, false);
              },
            ),
            Expanded(
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(18, 4, 18, 30),
                children: [
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      _TinyPill(
                        label: active ? 'Active' : 'Inactive',
                        icon: active
                            ? Icons.check_circle_outline_rounded
                            : Icons.pause_circle_outline_rounded,
                        background: active
                            ? const Color(0xFFE8F7F0)
                            : AppColors.pinkSoft,
                        foreground: active
                            ? AppColors.success
                            : AppColors.pinkDeep,
                      ),
                      _HealthPill(health: health),
                      if (isDefault)
                        const _TinyPill(
                          label: 'Default model',
                          icon: Icons.star_rounded,
                          background: Color(0xFFFFF5E8),
                          foreground: AppColors.warning,
                        ),
                    ],
                  ),
                  if (_asString(_model['description']).isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Text(
                      _asString(_model['description']),
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11,
                        height: 1.5,
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  _DetailSection(
                    icon: Icons.route_outlined,
                    title: 'Routing configuration',
                    children: [
                      _DetailTile('Priority', '${_asInt(_model['priority'])}'),
                      _DetailTile('Weight', '${_asInt(_model['weight'])}'),
                      _DetailTile(
                        'Provider',
                        _providerLabel(_asString(_model['providerKey'])),
                      ),
                      _DetailTile(
                        'API model ID',
                        _asString(_model['apiModelId']),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    icon: Icons.memory_rounded,
                    title: 'Capacity & capabilities',
                    children: [
                      _DetailTile(
                        'Max output tokens',
                        _compactNumber(_asInt(_model['maxOutputTokens'])),
                      ),
                      _DetailTile(
                        'Context window',
                        _model['contextWindow'] == null
                            ? 'Not specified'
                            : _compactNumber(_asInt(_model['contextWindow'])),
                      ),
                      _DetailTile(
                        'JSON output',
                        _yesNo(_asBool(_model['supportsJsonOutput'])),
                      ),
                      _DetailTile(
                        'Tools',
                        _yesNo(_asBool(_model['supportsTools'])),
                      ),
                      _DetailTile(
                        'Vision',
                        _yesNo(_asBool(_model['supportsVision'])),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    icon: Icons.payments_outlined,
                    title: 'Cost metadata',
                    children: [
                      _DetailTile(
                        'Input / 1M tokens',
                        '\$${_decimal(_model['inputCostPerMillion'])}',
                      ),
                      _DetailTile(
                        'Output / 1M tokens',
                        '\$${_decimal(_model['outputCostPerMillion'])}',
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    icon: Icons.monitor_heart_outlined,
                    title: 'Operational health',
                    children: [
                      _DetailTile(
                        'Health',
                        _titleCase(health.isEmpty ? 'UNKNOWN' : health),
                      ),
                      _DetailTile(
                        'Consecutive failures',
                        '${_asInt(_model['consecutiveFailures'])}',
                      ),
                      _DetailTile(
                        'Last health check',
                        _formatDateTime(_model['lastHealthCheckAt']),
                      ),
                      _DetailTile(
                        'Last failure',
                        _formatDateTime(_model['lastFailureAt']),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _DetailSection(
                    icon: Icons.history_rounded,
                    title: 'Registry metadata',
                    children: [
                      _DetailTile(
                        'Created',
                        _formatDateTime(_model['createdAt']),
                      ),
                      _DetailTile(
                        'Last updated',
                        _formatDateTime(_model['updatedAt']),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy ? null : _edit,
                          icon: const Icon(Icons.edit_outlined, size: 17),
                          label: const Text('Edit model'),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _busy || isDefault || !active
                              ? null
                              : _setDefault,
                          icon: const Icon(
                            Icons.star_outline_rounded,
                            size: 17,
                          ),
                          label: Text(isDefault ? 'Default' : 'Set default'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy || (active && isDefault)
                              ? null
                              : _toggleActive,
                          icon: Icon(
                            active
                                ? Icons.pause_circle_outline_rounded
                                : Icons.play_circle_outline_rounded,
                            size: 17,
                          ),
                          label: Text(active ? 'Deactivate' : 'Activate'),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.danger,
                            side: const BorderSide(color: Color(0xFFF0CFD6)),
                          ),
                          onPressed: _busy || isDefault ? null : _delete,
                          icon: const Icon(
                            Icons.delete_outline_rounded,
                            size: 17,
                          ),
                          label: const Text('Delete'),
                        ),
                      ),
                    ],
                  ),
                  if (_busy) ...[
                    const SizedBox(height: 14),
                    const LinearProgressIndicator(
                      minHeight: 3,
                      color: AppColors.primary,
                      backgroundColor: AppColors.primarySoft,
                      borderRadius: BorderRadius.all(Radius.circular(999)),
                    ),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.icon,
    required this.title,
    required this.children,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 9),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _DetailTile extends StatelessWidget {
  const _DetailTile(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? '—' : value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.8,
                fontWeight: FontWeight.w800,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AiModelEditorSheet extends StatefulWidget {
  const _AiModelEditorSheet({
    this.model,
    required this.providers,
    this.onCreate,
    this.onUpdate,
  });

  final Map<String, dynamic>? model;

  final List<Map<String, dynamic>> providers;

  final Future<Map<String, dynamic>> Function(Map<String, dynamic> body)?
  onCreate;

  final Future<Map<String, dynamic>> Function(Map<String, dynamic> body)?
  onUpdate;

  @override
  State<_AiModelEditorSheet> createState() {
    return _AiModelEditorSheetState();
  }
}

class _AiModelEditorSheetState extends State<_AiModelEditorSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  late final TextEditingController _modelName;

  late final TextEditingController _apiModelId;

  late final TextEditingController _displayName;

  late final TextEditingController _description;

  late final TextEditingController _priority;

  late final TextEditingController _weight;

  late final TextEditingController _maxOutputTokens;

  late final TextEditingController _contextWindow;

  late final TextEditingController _inputCost;

  late final TextEditingController _outputCost;

  late String _provider;

  late bool _supportsJson;
  late bool _supportsTools;
  late bool _supportsVision;
  late bool _isActive;

  bool _saving = false;

  String _error = '';

  bool get _creating => widget.model == null;

  @override
  void initState() {
    super.initState();

    final model = widget.model ?? const <String, dynamic>{};

    _provider = _asString(model['providerKey']);

    if (_provider.isEmpty && widget.providers.isNotEmpty) {
      _provider = _asString(widget.providers.first['key']);
    }

    _modelName = TextEditingController(text: _asString(model['modelName']));

    _apiModelId = TextEditingController(text: _asString(model['apiModelId']));

    _displayName = TextEditingController(text: _asString(model['displayName']));

    _description = TextEditingController(text: _asString(model['description']));

    _priority = TextEditingController(text: '${_asInt(model['priority'])}');

    _weight = TextEditingController(
      text: '${_asInt(model['weight'], fallback: 1)}',
    );

    _maxOutputTokens = TextEditingController(
      text: '${_asInt(model['maxOutputTokens'], fallback: 2048)}',
    );

    _contextWindow = TextEditingController(
      text: model['contextWindow'] == null
          ? ''
          : '${_asInt(model['contextWindow'])}',
    );

    _inputCost = TextEditingController(
      text: _decimal(model['inputCostPerMillion']),
    );

    _outputCost = TextEditingController(
      text: _decimal(model['outputCostPerMillion']),
    );

    _supportsJson = model.isEmpty ? true : _asBool(model['supportsJsonOutput']);

    _supportsTools = _asBool(model['supportsTools']);

    _supportsVision = _asBool(model['supportsVision']);

    _isActive = model.isEmpty ? true : _asBool(model['isActive']);
  }

  @override
  void dispose() {
    _modelName.dispose();
    _apiModelId.dispose();
    _displayName.dispose();
    _description.dispose();
    _priority.dispose();
    _weight.dispose();
    _maxOutputTokens.dispose();
    _contextWindow.dispose();
    _inputCost.dispose();
    _outputCost.dispose();

    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (!_formKey.currentState!.validate()) {
      return;
    }

    if (_provider.isEmpty) {
      setState(() {
        _error = 'Choose a supported provider.';
      });

      return;
    }

    final body = <String, dynamic>{
      'providerKey': _provider.trim(),

      'modelName': _modelName.text.trim(),

      'apiModelId': _apiModelId.text.trim(),

      if (_displayName.text.trim().isNotEmpty)
        'displayName': _displayName.text.trim(),

      if (_description.text.trim().isNotEmpty)
        'description': _description.text.trim(),

      'priority': int.parse(_priority.text.trim()),

      'weight': int.parse(_weight.text.trim()),

      'maxOutputTokens': int.parse(_maxOutputTokens.text.trim()),

      if (_contextWindow.text.trim().isNotEmpty)
        'contextWindow': int.parse(_contextWindow.text.trim()),

      'inputCostPerMillion': double.parse(_inputCost.text.trim()),

      'outputCostPerMillion': double.parse(_outputCost.text.trim()),

      'supportsJsonOutput': _supportsJson,

      'supportsTools': _supportsTools,

      'supportsVision': _supportsVision,

      if (_creating) 'isActive': _isActive,
    };

    setState(() {
      _saving = true;

      _error = '';
    });

    try {
      if (_creating) {
        await widget.onCreate!(body);
      } else {
        await widget.onUpdate!(body);
      }

      if (!mounted) {
        return;
      }

      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _saving = false;

        _error = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _saving = false;

        _error = 'Could not save this model. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return _SheetShell(
      initialChildSize: .94,
      minChildSize: .72,
      maxChildSize: .98,
      builder: (context, scrollController) {
        return Column(
          children: [
            _SheetHeader(
              icon: _creating
                  ? Icons.add_circle_outline_rounded
                  : Icons.edit_outlined,
              eyebrow: _creating ? 'MODEL REGISTRATION' : 'MODEL CONFIGURATION',
              title: _creating ? 'Add AI model' : 'Edit AI model',
              subtitle: _creating
                  ? 'Register a provider model for Voxidence routing.'
                  : 'Update routing, capacity, capabilities and cost metadata.',
              onClose: () {
                Navigator.pop(context, false);
              },
            ),
            Expanded(
              child: Form(
                key: _formKey,
                child: ListView(
                  controller: scrollController,
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(18, 4, 18, 30),
                  children: [
                    _FormSection(
                      icon: Icons.hub_outlined,
                      title: 'Identity & provider',
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue: _provider.isEmpty ? null : _provider,
                          decoration: const InputDecoration(
                            labelText: 'Provider',
                          ),
                          items: widget.providers.map((provider) {
                            final key = _asString(provider['key']);

                            final display = _asString(provider['displayName']);

                            return DropdownMenuItem<String>(
                              value: key,
                              child: Text(
                                display.isNotEmpty
                                    ? display
                                    : _providerLabel(key),
                              ),
                            );
                          }).toList(),
                          onChanged: _saving
                              ? null
                              : (value) {
                                  setState(() {
                                    _provider = value ?? '';
                                  });
                                },
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Provider is required.';
                            }

                            return null;
                          },
                        ),
                        const _FieldGap(),
                        TextFormField(
                          controller: _modelName,
                          enabled: !_saving,
                          maxLength: 100,
                          decoration: const InputDecoration(
                            labelText: 'Internal model name',
                            hintText: 'Gemini 3.6 Flash',
                            counterText: '',
                          ),
                          validator: (value) {
                            return _required(value, 'Model name');
                          },
                        ),
                        const _FieldGap(),
                        TextFormField(
                          controller: _apiModelId,
                          enabled: !_saving,
                          maxLength: 200,
                          decoration: const InputDecoration(
                            labelText: 'API model ID',
                            hintText: 'google/gemini-3.6-flash',
                            counterText: '',
                          ),
                          validator: (value) {
                            return _required(value, 'API model ID');
                          },
                        ),
                        const _FieldGap(),
                        TextFormField(
                          controller: _displayName,
                          enabled: !_saving,
                          maxLength: 100,
                          decoration: const InputDecoration(
                            labelText: 'Display name (optional)',
                            counterText: '',
                          ),
                        ),
                        const _FieldGap(),
                        TextFormField(
                          controller: _description,
                          enabled: !_saving,
                          minLines: 2,
                          maxLines: 4,
                          maxLength: 500,
                          decoration: const InputDecoration(
                            labelText: 'Description (optional)',
                            hintText: 'What this model is best used for',
                            counterText: '',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _FormSection(
                      icon: Icons.route_outlined,
                      title: 'Routing & limits',
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _NumberField(
                                controller: _priority,
                                label: 'Priority',
                                min: 0,
                                max: 10000,
                              ),
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              child: _NumberField(
                                controller: _weight,
                                label: 'Weight',
                                min: 1,
                                max: 10000,
                              ),
                            ),
                          ],
                        ),
                        const _FieldGap(),
                        _NumberField(
                          controller: _maxOutputTokens,
                          label: 'Max output tokens',
                          min: 1,
                          max: 1000000,
                        ),
                        const _FieldGap(),
                        _NumberField(
                          controller: _contextWindow,
                          label: 'Context window (optional)',
                          min: 1,
                          max: 10000000,
                          optional: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _FormSection(
                      icon: Icons.auto_awesome_outlined,
                      title: 'Capabilities',
                      children: [
                        _SwitchTile(
                          title: 'JSON output',
                          subtitle:
                              'Provider-native structured JSON generation.',
                          icon: Icons.data_object_rounded,
                          value: _supportsJson,
                          onChanged: _saving
                              ? null
                              : (value) {
                                  setState(() {
                                    _supportsJson = value;
                                  });
                                },
                        ),
                        const SizedBox(height: 8),
                        _SwitchTile(
                          title: 'Tools',
                          subtitle: 'Function or provider tool calls.',
                          icon: Icons.build_outlined,
                          value: _supportsTools,
                          onChanged: _saving
                              ? null
                              : (value) {
                                  setState(() {
                                    _supportsTools = value;
                                  });
                                },
                        ),
                        const SizedBox(height: 8),
                        _SwitchTile(
                          title: 'Vision',
                          subtitle: 'Image or visual inputs.',
                          icon: Icons.visibility_outlined,
                          value: _supportsVision,
                          onChanged: _saving
                              ? null
                              : (value) {
                                  setState(() {
                                    _supportsVision = value;
                                  });
                                },
                        ),
                        if (_creating) ...[
                          const SizedBox(height: 8),
                          _SwitchTile(
                            title: 'Create as active',
                            subtitle:
                                'Allow the model to participate in routing immediately.',
                            icon: Icons.play_circle_outline_rounded,
                            value: _isActive,
                            onChanged: _saving
                                ? null
                                : (value) {
                                    setState(() {
                                      _isActive = value;
                                    });
                                  },
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 12),
                    _FormSection(
                      icon: Icons.payments_outlined,
                      title: 'Provider cost metadata',
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: _DecimalField(
                                controller: _inputCost,
                                label: 'Input / 1M',
                              ),
                            ),
                            const SizedBox(width: 9),
                            Expanded(
                              child: _DecimalField(
                                controller: _outputCost,
                                label: 'Output / 1M',
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.pinkSoft,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFF0CFD6)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.error_outline_rounded,
                              size: 17,
                              color: AppColors.danger,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _error,
                                style: const TextStyle(
                                  color: AppColors.danger,
                                  fontSize: 10,
                                  height: 1.4,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _saving ? null : _submit,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined, size: 17),
                      label: Text(
                        _saving
                            ? 'Saving...'
                            : _creating
                            ? 'Add model'
                            : 'Save changes',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _FormSection extends StatelessWidget {
  const _FormSection({
    required this.icon,
    required this.title,
    required this.children,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                child: Icon(icon, size: 16, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 9),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

class _FieldGap extends StatelessWidget {
  const _FieldGap();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(height: 10);
  }
}

class _NumberField extends StatelessWidget {
  const _NumberField({
    required this.controller,
    required this.label,
    required this.min,
    required this.max,
    this.optional = false,
  });

  final TextEditingController controller;

  final String label;

  final int min;
  final int max;

  final bool optional;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(labelText: label),
      validator: (value) {
        final text = value?.trim() ?? '';

        if (text.isEmpty && optional) {
          return null;
        }

        final parsed = int.tryParse(text);

        if (parsed == null) {
          return 'Enter a number.';
        }

        if (parsed < min || parsed > max) {
          return '$min - $max';
        }

        return null;
      },
    );
  }
}

class _DecimalField extends StatelessWidget {
  const _DecimalField({required this.controller, required this.label});

  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,6}')),
      ],
      decoration: InputDecoration(labelText: label, prefixText: '\$ '),
      validator: (value) {
        final parsed = double.tryParse(value?.trim() ?? '');

        if (parsed == null) {
          return 'Enter a cost.';
        }

        if (parsed < 0) {
          return 'Must be 0 or more.';
        }

        return null;
      },
    );
  }
}

class _SwitchTile extends StatelessWidget {
  const _SwitchTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String subtitle;

  final IconData icon;

  final bool value;

  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(11, 8, 7, 8),
      decoration: BoxDecoration(
        color: value ? AppColors.primarySoft : const Color(0xFFFCFEFD),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: value ? AppColors.borderStrong : AppColors.border,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: value ? AppColors.surface : AppColors.primarySoft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 17, color: AppColors.primaryDark),
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
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.7,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: AppColors.primaryDark,
            activeTrackColor: AppColors.primary.withValues(alpha: .35),
          ),
        ],
      ),
    );
  }
}

class _SheetShell extends StatelessWidget {
  const _SheetShell({
    required this.builder,
    required this.initialChildSize,
    required this.minChildSize,
    required this.maxChildSize,
  });

  final Widget Function(BuildContext context, ScrollController controller)
  builder;

  final double initialChildSize;
  final double minChildSize;
  final double maxChildSize;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: initialChildSize,
      minChildSize: minChildSize,
      maxChildSize: maxChildSize,
      expand: false,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: builder(context, controller),
        );
      },
    );
  }
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.onClose,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 10, 12, 14),
      child: Column(
        children: [
          Container(
            width: 42,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.silver.withValues(alpha: .7),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AdminIconBadge(icon: icon, size: 43),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.05,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 19,
                        height: 1.1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.5,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: onClose,
                icon: const Icon(Icons.close_rounded, size: 20),
                color: AppColors.textMuted,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String? _required(String? value, String field) {
  if (value == null || value.trim().isEmpty) {
    return '$field is required.';
  }

  return null;
}

String _displayName(Map<String, dynamic> model) {
  final display = _asString(model['displayName']);

  if (display.isNotEmpty) {
    return display;
  }

  final name = _asString(model['modelName']);

  if (name.isEmpty) {
    return 'AI model';
  }

  return name;
}

String _providerLabel(String provider) {
  switch (provider.trim().toLowerCase()) {
    case 'google':
      return 'Google AI';

    case 'openrouter':
      return 'OpenRouter';

    case 'ollama':
      return 'Ollama';

    default:
      if (provider.isEmpty) {
        return 'Unknown provider';
      }

      return _titleCase(provider);
  }
}

String _sortLabel(String value) {
  switch (value) {
    case 'modelName':
      return 'Model';

    case 'providerKey':
      return 'Provider';

    case 'healthStatus':
      return 'Health';

    case 'updatedAt':
      return 'Updated';

    case 'createdAt':
      return 'Created';

    default:
      return 'Priority';
  }
}

String _asString(dynamic value) {
  return value?.toString().trim() ?? '';
}

int _asInt(dynamic value, {int fallback = 0}) {
  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  return int.tryParse(value?.toString() ?? '') ?? fallback;
}

bool _asBool(dynamic value) {
  if (value is bool) {
    return value;
  }

  return value?.toString().toLowerCase() == 'true';
}

String _titleCase(String value) {
  final clean = value.trim().replaceAll('_', ' ').toLowerCase();

  if (clean.isEmpty) {
    return '';
  }

  return clean
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _formatDate(dynamic value) {
  final date = DateTime.tryParse(_asString(value))?.toLocal();

  if (date == null) {
    return '—';
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

String _formatDateTime(dynamic value) {
  final date = DateTime.tryParse(_asString(value))?.toLocal();

  if (date == null) {
    return '—';
  }

  final hour = date.hour == 0
      ? 12
      : date.hour > 12
      ? date.hour - 12
      : date.hour;

  final minute = date.minute.toString().padLeft(2, '0');

  final period = date.hour >= 12 ? 'PM' : 'AM';

  return '${_formatDate(date.toIso8601String())} · $hour:$minute $period';
}

String _compactNumber(int value) {
  if (value >= 1000000) {
    final number = value / 1000000;

    final text = number == number.roundToDouble()
        ? number.toStringAsFixed(0)
        : number.toStringAsFixed(1);

    return '${text}M';
  }

  if (value >= 1000) {
    final number = value / 1000;

    final text = number == number.roundToDouble()
        ? number.toStringAsFixed(0)
        : number.toStringAsFixed(1);

    return '${text}K';
  }

  return '$value';
}

String _decimal(dynamic value) {
  if (value == null || _asString(value).isEmpty) {
    return '0';
  }

  final parsed = double.tryParse(_asString(value)) ?? 0;

  var text = parsed.toStringAsFixed(6);

  text = text.replaceFirst(RegExp(r'0+$'), '');

  text = text.replaceFirst(RegExp(r'\.$'), '');

  if (text.isEmpty) {
    return '0';
  }

  return text;
}

String _yesNo(bool value) {
  return value ? 'Supported' : 'Not supported';
}
