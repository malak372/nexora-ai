import 'package:flutter/material.dart';

/// Defines the configuration required to represent a generic
/// administrative resource inside the admin dashboard.
///
/// Each resource contains its display information, API endpoints,
/// supported statuses, sorting configuration, and optional query
/// parameters used when retrieving its data.
///
/// This model allows admin pages to share the same generic UI and
/// networking structure while keeping resource-specific configuration
/// centralized in one place.
///
/// @author Eman
class AdminResourceDefinition {
  /// Creates an immutable admin resource configuration.
  const AdminResourceDefinition({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.eyebrow,
    required this.icon,
    required this.listPath,
    this.summaryPath,
    this.detailPathBuilder,
    this.sortBy = 'createdAt',
    this.sortOrder = 'desc',
    this.statuses = const [],
    this.extraQuery = const {},
  });

  /// Unique identifier used internally to reference the resource.
  ///
  /// This value is also used by [AdminResources.byId] when resolving
  /// a resource dynamically.
  final String id;

  /// Main display title of the admin resource.
  final String title;

  /// Short description explaining the purpose of the resource.
  final String subtitle;

  /// Small contextual label used to indicate the resource category.
  final String eyebrow;

  /// Icon displayed alongside the resource in the admin interface.
  final IconData icon;

  /// API endpoint used to retrieve the paginated resource list.
  final String listPath;

  /// Optional API endpoint used to retrieve summary information
  /// or statistics related to the resource.
  final String? summaryPath;

  /// Optional callback used to construct the API path for retrieving
  /// the details of a specific resource item.
  final String Function(String id)? detailPathBuilder;

  /// Field used as the default sorting key when loading resource data.
  final String sortBy;

  /// Default sort direction.
  ///
  /// Common values are `asc` and `desc`.
  final String sortOrder;

  /// Available status values that can be used for resource filtering.
  final List<String> statuses;

  /// Additional query parameters that should always be included when
  /// requesting data for this resource.
  final Map<String, dynamic> extraQuery;
}

/// Central registry containing the generic resources available
/// in the administrative dashboard.
///
/// Each resource is represented by an [AdminResourceDefinition]
/// containing its UI metadata and backend API configuration.
///
/// Keeping resource definitions centralized prevents duplicated
/// configuration across admin pages and makes it easier to build
/// reusable listing, filtering, summary, and navigation components.
///
/// @author Eman
abstract final class AdminResources {
  /// User account management resource.
  ///
  /// Provides access to platform users, their plans, account state,
  /// and general access information.
  static const users = AdminResourceDefinition(
    id: 'users',
    title: 'Users',
    subtitle: 'Review accounts, plans and access state.',
    eyebrow: 'People & access',
    icon: Icons.groups_2_outlined,
    listPath: '/admin/users',
    summaryPath: '/admin/users/summary',
    statuses: ['ACTIVE', 'INACTIVE'],
  );

  /// Generated ideas administration resource.
  ///
  /// Allows administrators to inspect ideas and their publication state.
  static const ideas = AdminResourceDefinition(
    id: 'ideas',
    title: 'Ideas',
    subtitle: 'Explore generated ideas and publication state.',
    eyebrow: 'Community',
    icon: Icons.lightbulb_outline_rounded,
    listPath: '/admin/ideas',
    summaryPath: '/admin/ideas/summary',
  );

  /// Community evidence library resource.
  ///
  /// Provides access to collected evidence, comments, source context,
  /// and related collection metadata.
  static const evidence = AdminResourceDefinition(
    id: 'evidence',
    title: 'Evidence Library',
    subtitle: 'Inspect collected community evidence and source context.',
    eyebrow: 'Data & evidence',
    icon: Icons.dataset_outlined,
    listPath: '/admin/comments',
    summaryPath: '/admin/comments/summary',
    sortBy: 'collectedAt',
  );

  /// Data-source configuration resource.
  ///
  /// Displays collection providers and their operational state.
  static const dataSources = AdminResourceDefinition(
    id: 'data-sources',
    title: 'Data sources',
    subtitle: 'See collection providers and operational availability.',
    eyebrow: 'Data & evidence',
    icon: Icons.hub_outlined,
    listPath: '/admin/data-sources',
    summaryPath: '/admin/data-sources/summary',
    sortBy: 'name',
    sortOrder: 'asc',
    statuses: ['ACTIVE', 'INACTIVE'],
  );

  /// Data collection jobs resource.
  ///
  /// Used to monitor collection executions and their current state.
  static const collection = AdminResourceDefinition(
    id: 'collection',
    title: 'Data collection',
    subtitle: 'Track collection jobs and source execution state.',
    eyebrow: 'Data & evidence',
    icon: Icons.account_tree_outlined,
    listPath: '/data-collection/jobs',
    sortBy: 'createdAt',
    statuses: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED'],
  );

  /// Domain catalog administration resource.
  ///
  /// Provides access to the domains used during idea generation.
  static const domains = AdminResourceDefinition(
    id: 'domains',
    title: 'Domains',
    subtitle: 'Manage the domain catalog used by generation.',
    eyebrow: 'Data & evidence',
    icon: Icons.layers_outlined,
    listPath: '/admin/domains',
    summaryPath: '/admin/domains/summary',
    sortBy: 'name',
    sortOrder: 'asc',
    statuses: ['ACTIVE', 'INACTIVE'],
  );

  /// AI execution monitoring resource.
  ///
  /// Provides visibility into model calls, latency, execution results,
  /// and failures.
  static const aiMonitoring = AdminResourceDefinition(
    id: 'ai-monitoring',
    title: 'AI monitoring',
    subtitle: 'Inspect model calls, latency and execution results.',
    eyebrow: 'Intelligence',
    icon: Icons.monitor_heart_outlined,
    listPath: '/admin/ai-monitoring/logs',
    summaryPath: '/admin/ai-monitoring/summary',
    statuses: ['SUCCESS', 'FAILED'],
  );

  /// AI model configuration resource.
  ///
  /// Allows administrators to review configured AI models,
  /// providers, priority, and activation state.
  static const aiModels = AdminResourceDefinition(
    id: 'ai-models',
    title: 'AI models',
    subtitle: 'Review configured models, providers and activation state.',
    eyebrow: 'Intelligence',
    icon: Icons.psychology_alt_outlined,
    listPath: '/ai-models',
    summaryPath: '/ai-models/summary',
    sortBy: 'priority',
    statuses: ['ACTIVE', 'INACTIVE'],
  );

  /// Platform payment activity resource.
  ///
  /// Used to monitor payment transactions, captured revenue,
  /// and payment processing states.
  static const payments = AdminResourceDefinition(
    id: 'payments',
    title: 'Payments',
    subtitle: 'Monitor payment activity, statuses and captured revenue.',
    eyebrow: 'Finance',
    icon: Icons.payments_outlined,
    listPath: '/admin/payments',
    summaryPath: '/admin/payments/summary',
    statuses: ['SUCCEEDED', 'PENDING', 'FAILED', 'REFUNDED'],
  );

  /// Credit transaction management resource.
  ///
  /// Displays user credit transactions and resulting balance changes.
  static const credits = AdminResourceDefinition(
    id: 'credits',
    title: 'Credits',
    subtitle: 'Review credit transactions and balance changes.',
    eyebrow: 'Finance',
    icon: Icons.toll_outlined,
    listPath: '/admin/credits/history',
    summaryPath: '/admin/credits/summary',
  );

  /// Administrative alerts resource.
  ///
  /// Provides access to platform alerts and admin notifications.
  static const alerts = AdminResourceDefinition(
    id: 'alerts',
    title: 'Alerts',
    subtitle: 'Review platform alerts and admin notifications.',
    eyebrow: 'Community & support',
    icon: Icons.notifications_active_outlined,
    listPath: '/admin/alerts',
    summaryPath: '/admin/alerts/summary',
    statuses: ['UNREAD', 'READ'],
  );

  /// Administrative audit trail resource.
  ///
  /// Used to trace administrative and platform-level actions.
  static const auditLogs = AdminResourceDefinition(
    id: 'audit-logs',
    title: 'Audit trail',
    subtitle: 'Trace administrative and platform-level actions.',
    eyebrow: 'Security & system',
    icon: Icons.manage_history_rounded,
    listPath: '/audit-logs',
    summaryPath: '/audit-logs/summary',
  );

  /// Authentication security audit resource.
  ///
  /// Displays authentication events, failures, successful attempts,
  /// and potentially suspicious activity.
  static const authAudit = AdminResourceDefinition(
    id: 'auth-audit',
    title: 'Auth security',
    subtitle: 'Review authentication events and suspicious activity.',
    eyebrow: 'Security & system',
    icon: Icons.security_outlined,
    listPath: '/admin/auth-audit-logs',
    summaryPath: '/admin/auth-audit-logs/summary',
    statuses: ['SUCCESS', 'FAILED'],
  );

  /// Prompt revision and history resource.
  ///
  /// Provides access to prompt-template changes and historical revisions.
  static const promptHistory = AdminResourceDefinition(
    id: 'prompts',
    title: 'Prompt control',
    subtitle: 'Review prompt-template revisions and change history.',
    eyebrow: 'Intelligence',
    icon: Icons.auto_awesome_outlined,
    listPath: '/prompts/history',
  );

  /// Collection of all resources supported by the generic
  /// administrative resource system.
  ///
  /// This list is used for dynamic resource lookup and can also be used
  /// when constructing generic admin navigation or resource pages.
  static const allGeneric = <AdminResourceDefinition>[
    users,
    ideas,
    evidence,
    dataSources,
    collection,
    domains,
    aiMonitoring,
    aiModels,
    payments,
    credits,
    alerts,
    auditLogs,
    authAudit,
    promptHistory,
  ];

  /// Finds an admin resource by its unique [id].
  ///
  /// Returns the matching [AdminResourceDefinition] when a resource
  /// exists, otherwise returns `null`.
  ///
  /// Example:
  /// ```dart
  /// final resource = AdminResources.byId('users');
  /// ```
  static AdminResourceDefinition? byId(String id) {
    for (final resource in allGeneric) {
      if (resource.id == id) {
        return resource;
      }
    }

    return null;
  }
}
