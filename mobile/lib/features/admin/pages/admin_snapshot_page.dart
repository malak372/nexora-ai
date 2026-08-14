import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Displays a generic administrative snapshot page for summary
/// and analytics data.
///
/// The page retrieves summary information from a configurable backend
/// [path] and converts scalar response values into visual metrics.
///
/// It supports:
/// - Loading and refresh states.
/// - API error handling.
/// - Pull-to-refresh behavior.
/// - Metric extraction from nested response objects.
/// - Responsive two-column metric cards.
/// - Additional signal display when more metrics are available.
/// - Context-aware icons and visual status tones.
///
/// The widget is intentionally generic so it can be reused for
/// different administrative analytics and monitoring workspaces.
///
/// @author Eman
class AdminSnapshotPage extends StatefulWidget {
  /// Creates a generic administrative snapshot page.
  ///
  /// The supplied metadata controls the page header, while [path]
  /// identifies the backend endpoint used to retrieve summary data.
  const AdminSnapshotPage({
    super.key,
    required this.title,
    required this.subtitle,
    required this.eyebrow,
    required this.icon,
    required this.path,
  });

  /// Main page title.
  final String title;

  /// Supporting description displayed below the title.
  final String subtitle;

  /// Small contextual label displayed above the title.
  final String eyebrow;

  /// Icon representing the current snapshot workspace.
  final IconData icon;

  /// Backend API endpoint used to retrieve summary information.
  final String path;

  @override
  State<AdminSnapshotPage> createState() => _AdminSnapshotPageState();
}

/// Manages data retrieval, formatting, and rendering for
/// [AdminSnapshotPage].
///
/// @author Eman
class _AdminSnapshotPageState extends State<AdminSnapshotPage> {
  /// Latest summary response returned by the backend.
  Map<String, dynamic>? _data;

  /// Indicates whether summary information is currently being loaded.
  bool _loading = true;

  /// Stores the latest API error message.
  ///
  /// An empty value indicates that no active error exists.
  String _error = '';

  /// Loads the initial snapshot data when the page is created.
  @override
  void initState() {
    super.initState();

    _load();
  }

  /// Retrieves snapshot summary data from the backend.
  ///
  /// When [force] is `true`, cached API data is bypassed so the latest
  /// server response is retrieved.
  ///
  /// Loading and error states are updated automatically.
  Future<void> _load({bool force = false}) async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final data = await AdminApi.instance.getSummary(
        widget.path,
        force: force,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _data = data;
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
          _loading = false;
        });
      }
    }
  }

  /// Builds the administrative snapshot interface.
  ///
  /// The method normalizes the backend response, extracts scalar values,
  /// and renders them as metric cards.
  ///
  /// The first ten metrics are displayed in a responsive grid, while
  /// remaining metrics are displayed under the `More signals` section.
  @override
  Widget build(BuildContext context) {
    /// Normalized summary data.
    ///
    /// Some endpoints return their payload under `data`, while others
    /// return the summary object directly.
    final data = _data?['data'] is Map
        ? Map<String, dynamic>.from(_data!['data'] as Map)
        : _data ?? const <String, dynamic>{};

    /// Flat collection of scalar metrics extracted from the response.
    final metrics = _flattenScalars(data);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 80),
              children: [
                AdminPageHeader(
                  title: widget.title,
                  subtitle: widget.subtitle,
                  eyebrow: widget.eyebrow,
                  icon: widget.icon,
                  onBack: () {
                    Navigator.maybePop(context);
                  },
                  trailing: IconButton.filledTonal(
                    onPressed: _loading
                        ? null
                        : () {
                            _load(force: true);
                          },
                    icon: const Icon(Icons.refresh_rounded, size: 19),
                  ),
                ),
                const SizedBox(height: 18),

                /// Displays skeleton placeholders while initial data
                /// is loading.
                if (_loading && data.isEmpty)
                  const AdminLoadingList(count: 5)
                /// Displays an error state when loading fails and no
                /// previously retrieved data is available.
                else if (_error.isNotEmpty && data.isEmpty)
                  AdminEmptyState(
                    title: 'Could not load this workspace',
                    message: _error,
                    icon: widget.icon,
                    onRetry: () {
                      _load(force: true);
                    },
                  )
                /// Displays the available snapshot metrics.
                else ...[
                  LayoutBuilder(
                    builder: (context, constraints) {
                      /// Width allocated to each metric card.
                      ///
                      /// Two cards are displayed per row with a small
                      /// horizontal gap.
                      final width = (constraints.maxWidth - 10) / 2;

                      return Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: metrics.take(10).map((entry) {
                          return SizedBox(
                            width: width,
                            child: AdminMetricCard(
                              label: _prettyKey(entry.key),
                              value: _display(entry.value),
                              icon: _iconFor(entry.key),
                              tone:
                                  entry.key.toLowerCase().contains('error') ||
                                      entry.key.toLowerCase().contains('fail')
                                  ? AppColors.pinkSoft
                                  : AppColors.primarySoft,
                              iconColor:
                                  entry.key.toLowerCase().contains('error') ||
                                      entry.key.toLowerCase().contains('fail')
                                  ? AppColors.danger
                                  : AppColors.primaryDark,
                            ),
                          );
                        }).toList(),
                      );
                    },
                  ),

                  /// Displays additional metrics that do not fit inside
                  /// the primary metric-card section.
                  if (metrics.length > 10) ...[
                    const SizedBox(height: 18),
                    Text(
                      'More signals',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 9),
                    AdminGlassCard(
                      child: Column(
                        children: metrics.skip(10).take(30).map((entry) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 7),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    _prettyKey(entry.key),
                                    style: const TextStyle(
                                      color: AppColors.textSecondary,
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Text(
                                  _display(entry.value),
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 10.8,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
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

  /// Extracts scalar values from a potentially nested summary response.
  ///
  /// Numeric, boolean, and string values are added to the resulting
  /// metric collection.
  ///
  /// Nested maps are traversed recursively until the output reaches
  /// approximately sixty scalar values.
  ///
  /// Parent property names are combined with nested keys so that the
  /// resulting labels preserve their original context.
  List<MapEntry<String, dynamic>> _flattenScalars(Map<String, dynamic> data) {
    final output = <MapEntry<String, dynamic>>[];

    /// Recursively traverses a response map and collects supported
    /// scalar values.
    void visit(Map<String, dynamic> map, [String prefix = '']) {
      for (final entry in map.entries) {
        final key = prefix.isEmpty ? entry.key : '$prefix ${entry.key}';

        final value = entry.value;

        if (value is num || value is bool || value is String) {
          if (value.toString().trim().isNotEmpty) {
            output.add(MapEntry(key, value));
          }
        } else if (value is Map && output.length < 60) {
          visit(Map<String, dynamic>.from(value), key);
        }
      }
    }

    visit(data);

    return output;
  }

  /// Converts a backend property name into a human-readable label.
  ///
  /// The formatter supports:
  /// - camelCase values.
  /// - snake_case values.
  /// - Nested key labels.
  ///
  /// Example:
  /// `averageResponseTime` becomes `Average Response Time`.
  String _prettyKey(String key) {
    return key
        .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }

  /// Converts a raw metric value into a readable display value.
  ///
  /// Double values are limited to two decimal places when necessary,
  /// while boolean values are converted to `Yes` or `No`.
  ///
  /// All other values are converted using [Object.toString].
  String _display(dynamic value) {
    if (value is double) {
      return value.toStringAsFixed(value % 1 == 0 ? 0 : 2);
    }

    if (value is bool) {
      return value ? 'Yes' : 'No';
    }

    return value.toString();
  }

  /// Selects a contextual icon according to the supplied metric [key].
  ///
  /// Known categories include:
  /// - Cost and revenue.
  /// - Latency and timing.
  /// - Successful executions.
  /// - Errors and failures.
  /// - Requests.
  /// - Token usage.
  ///
  /// When no specific category matches, the page's primary icon
  /// is returned.
  IconData _iconFor(String key) {
    final value = key.toLowerCase();

    if (value.contains('cost') || value.contains('revenue')) {
      return Icons.payments_outlined;
    }

    if (value.contains('latency') || value.contains('time')) {
      return Icons.speed_rounded;
    }

    if (value.contains('success')) {
      return Icons.check_circle_outline_rounded;
    }

    if (value.contains('error') || value.contains('fail')) {
      return Icons.warning_amber_rounded;
    }

    if (value.contains('request')) {
      return Icons.sync_alt_rounded;
    }

    if (value.contains('token')) {
      return Icons.data_usage_rounded;
    }

    return widget.icon;
  }
}
