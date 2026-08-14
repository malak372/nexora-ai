import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/api/auth_api.dart';
import '../../home/widgets/common.dart';
import '../../user/pages/profile_settings_page.dart';
import '../../user/pages/user_shell.dart';
import '../api/admin_api.dart';
import '../models/admin_navigation.dart';
import '../models/admin_resource.dart';
import '../widgets/admin_ui.dart';
import 'admin_ai_analytics_page.dart';
import 'admin_ai_models_page.dart';
import 'admin_ai_monitoring_page.dart';
import 'admin_auth_security_page.dart';
import 'admin_audit_trail_page.dart';
import 'admin_alerts_page.dart';
import 'admin_dashboard_page.dart';
import 'admin_credits_page.dart';
import 'admin_data_sources_page.dart';
import 'admin_data_collection_page.dart';
import 'admin_domains_page.dart';
import 'admin_evidence_library_page.dart';
import 'admin_ideas_page.dart';
import 'admin_more_page.dart';
import 'admin_payments_page.dart';
import 'admin_prompt_control_page.dart';
import 'admin_publication_reports_page.dart';
import 'admin_resource_page.dart';
import 'admin_sensitive_workspace_page.dart';
import 'admin_support_queue_page.dart';
import 'admin_system_settings_page.dart';

class AdminShell extends StatefulWidget {
  const AdminShell({super.key, this.initialIndex = 0});

  final int initialIndex;

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  final _api = AdminApi.instance;
  final List<Widget?> _pages = List<Widget?>.filled(4, null);

  late int _index;

  bool _checkingRole = true;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, 3).toInt();
    _verifyRole();
  }

  Widget _createPage(int index) {
    return switch (index) {
      0 => AdminDashboardPage(onOpen: _open),
      1 => const AdminResourcePage(
          resource: AdminResources.users,
          embedded: true,
        ),
      2 => const AdminPublicationReportsPage(embedded: true),
      3 => AdminMorePage(
          onOpen: _open,
          onOpenMenu: _openAdminMenu,
          onSignOut: _signOut,
        ),
      _ => const SizedBox.shrink(),
    };
  }

  void _ensurePage(int index) {
    if (index < 0 || index >= _pages.length || _pages[index] != null) return;
    _pages[index] = _createPage(index);
  }

  Future<void> _verifyRole() async {
    final user = await SessionStore.instance.readUser();
    final role = user?['role']?.toString().trim().toUpperCase() ?? '';

    if (!mounted) return;

    if (role != 'ADMIN') {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const UserShell()),
        (route) => false,
      );
      return;
    }

    _ensurePage(_index);

    setState(() => _checkingRole = false);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_warmPrimaryAdminTabs());
    });
  }

  Future<void> _warmPrimaryAdminTabs() async {
    await Future<void>.delayed(
      Duration(milliseconds: _index == 0 ? 15000 : 900),
    );
    if (!mounted) return;

    await _warmCoreAdminTabs();

    await Future<void>.delayed(const Duration(milliseconds: 550));
    if (!mounted) return;

    unawaited(
      _api
          .getSummary('/admin/users/summary')
          .then<void>((_) {})
          .catchError((_) {}),
    );
    unawaited(
      _api
          .getSummary('/admin/publication-reports/summary')
          .then<void>((_) {})
          .catchError((_) {}),
    );

    if (_index != 0) {
      unawaited(_api.getDashboard().then<void>((_) {}).catchError((_) {}));
    }
  }

  Future<void> _warmCoreAdminTabs() async {
    final futures = <Future<dynamic>>[
      _api.getList(
        '/admin/users',
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      ),
      _api.getList(
        '/admin/publication-reports',
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      ),
    ];

    await Future.wait(
      futures.map((future) async {
        try {
          await future;
        } catch (_) {}
      }),
    );
  }

  Future<void> _warmIdeasWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/ideas',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/ideas/summary'),
      ]);
    } catch (_) {
    }
  }

  Future<void> _warmComplaintsWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/complaints',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/complaints/summary'),
      ]);
    } catch (_) {
    }
  }

  Future<void> _warmEvidenceWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/comments',
          page: 1,
          limit: 20,
          sortBy: 'collectedAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/comments/summary'),
        _api.getSummary('/admin/comments/charts'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmDataSourcesWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/data-sources',
          page: 1,
          limit: 20,
          sortBy: 'displayName',
          sortOrder: 'asc',
        ),
        _api.getSummary('/admin/data-sources/summary'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmCollectionWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/data-collection/jobs',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/data-collection/status'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmDomainsWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/domains',
          page: 1,
          limit: 20,
          sortBy: 'name',
          sortOrder: 'asc',
        ),
        _api.getSummary('/admin/domains/summary'),
      ]);
    } catch (_) {}
  }


  Future<void> _warmAiMonitoringWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/ai-monitoring/logs',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/ai-monitoring/summary'),
        _api.getSummary('/admin/ai-monitoring/charts'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmAiModelsWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/ai-models',
          page: 1,
          limit: 20,
          sortBy: 'priority',
          sortOrder: 'desc',
        ),
        _api.getSummary('/ai-models/summary'),
        _api.getSummary('/ai-models/providers'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmAiAnalyticsWorkspace() async {
    try {
      await _api.getSummary('/admin/ai/analytics/summary');
    } catch (_) {}
  }

  Future<void> _warmPromptControlWorkspace() async {
    try {
      await Future.wait([
        _api.getDetail('/prompts/template'),
        _api.getList(
          '/prompts/history',
          page: 1,
          limit: 12,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
      ]);
    } catch (_) {}
  }

  Future<void> _warmPaymentsWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/payments',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/payments/summary'),
        _api.getSummary('/admin/payments/charts'),
      ]);
    } catch (_) {}
  }

  Future<void> _warmCreditsWorkspace() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/credits/history',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/credits/summary'),
        _api.getSummary('/admin/credits/charts'),
      ]);
    } catch (_) {}
  }

  Future<void> _signOut() async {
    await AuthApi.instance.logout();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
  }

  Future<void> _open(String id) async {
    if (id == 'overview') {
      _selectTab(0);
      return;
    }

    if (id == 'users') {
      _selectTab(1);
      return;
    }

    if (id == 'reports') {
      _selectTab(2);
      return;
    }

    Widget? page;

    if (id == 'complaints') {
      unawaited(_warmComplaintsWorkspace());
      page = const AdminSupportQueuePage(
        type: AdminSupportQueueType.complaints,
      );
    } else if (id == 'alerts') {
      page = const AdminAlertsPage();
    } else if (id == 'evidence') {
      unawaited(_warmEvidenceWorkspace());
      page = const AdminEvidenceLibraryPage();
    } else if (id == 'data-sources') {
      unawaited(_warmDataSourcesWorkspace());
      page = const AdminDataSourcesPage();
    } else if (id == 'collection') {
      unawaited(_warmCollectionWorkspace());
      page = const AdminDataCollectionPage();
    } else if (id == 'domains') {
      unawaited(_warmDomainsWorkspace());
      page = const AdminDomainsPage();
    } else if (id == 'ai-monitoring') {
      unawaited(_warmAiMonitoringWorkspace());
      page = const AdminAiMonitoringPage();
    } else if (id == 'ai-models') {
      unawaited(_warmAiModelsWorkspace());
      page = const AdminAiModelsPage();
    } else if (id == 'contact') {
      page = const AdminSupportQueuePage(type: AdminSupportQueueType.contact);
    } else if (id == 'ideas') {
      unawaited(_warmIdeasWorkspace());
      page = const AdminIdeasPage();
    } else if (id == 'ai-analytics') {
      unawaited(_warmAiAnalyticsWorkspace());
      page = const AdminAiAnalyticsPage();
    } else if (id == 'prompts') {
      unawaited(_warmPromptControlWorkspace());
      page = const AdminPromptControlPage();
    } else if (id == 'payments') {
      unawaited(_warmPaymentsWorkspace());
      page = const AdminPaymentsPage();
    } else if (id == 'credits') {
      unawaited(_warmCreditsWorkspace());
      page = const AdminCreditsPage();
    } else if (id == 'auth-audit') {
      unawaited(_warmSecurityReadOnlyWorkspaces());
      page = const AdminAuthSecurityPage();
    } else if (id == 'audit-logs') {
      unawaited(_warmSecurityReadOnlyWorkspaces());
      page = const AdminAuditTrailPage();
    } else if (id == 'administrators') {
      page = const AdminSensitiveWorkspacePage(
        scope: 'ADMINISTRATORS',
        title: 'Administrators',
        subtitle:
            'Review the protected administrator workspace after identity confirmation.',
        icon: Icons.admin_panel_settings_outlined,
        path: '/admin/administrators/workspace',
      );
    } else if (id == 'settings') {
      page = const AdminSystemSettingsPage();
    } else if (id == 'account') {
      page = const ProfileSettingsPage();
    } else {
      final resource = AdminResources.byId(id);
      if (resource != null) {
        unawaited(_warmGenericResource(resource));
        page = AdminResourcePage(resource: resource);
      }
    }

    if (page == null || !mounted) return;

    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => page!),
    );

    if (id == 'account' && mounted) {
      setState(() {
        _pages[3] = _createPage(3);
      });
    }
  }

  Future<void> _warmGenericResource(AdminResourceDefinition resource) async {
    try {
      await Future.wait([
        _api.getList(
          resource.listPath,
          page: 1,
          limit: 20,
          sortBy: resource.sortBy,
          sortOrder: resource.sortOrder,
          extra: resource.extraQuery,
        ),
        if (resource.summaryPath != null)
          _api.getSummary(resource.summaryPath!),
      ]);
    } catch (_) {
    }
  }

  Future<void> _warmSecurityReadOnlyWorkspaces() async {
    try {
      await Future.wait([
        _api.getList(
          '/admin/auth-audit-logs',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/admin/auth-audit-logs/summary'),
        _api.getList(
          '/audit-logs',
          page: 1,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        ),
        _api.getSummary('/audit-logs/summary'),
      ]);
    } catch (_) {}
  }

  Future<void> _openAdminMenu() async {
    unawaited(
      Future<void>.delayed(const Duration(milliseconds: 250)).then((_) {
        return _warmSecurityReadOnlyWorkspaces();
      }),
    );

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .17),
      builder: (sheetContext) => const _AdminDirectorySheet(),
    );

    if (!mounted || selected == null) return;

    if (selected == '__sign_out__') {
      await _signOut();
      return;
    }

    await _open(selected);
  }

  @override
  Widget build(BuildContext context) {
    if (_checkingRole) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      extendBody: true,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _AdminTopBar(onMenu: _openAdminMenu),
              Expanded(
                child: IndexedStack(
                  index: _index,
                  children: List<Widget>.generate(
                    _pages.length,
                    (index) => _pages[index] ?? const SizedBox.shrink(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _FloatingAdminNavigation(
        index: _index,
        onSelected: _selectTab,
      ),
    );
  }

  void _selectTab(int index) {
    if (_index == index) return;

    _ensurePage(index);
    setState(() {
      _index = index;
    });
  }

}

class _AdminTopBar extends StatelessWidget {
  const _AdminTopBar({required this.onMenu});

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 6),
      child: Row(
        children: [
          const BrandMark(size: 39),
          const SizedBox(width: 9),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Voxidence',
                  style: TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.4,
                  ),
                ),
                SizedBox(height: 1),
                Text(
                  'Administration',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Material(
            color: Colors.white.withValues(alpha: .8),
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: onMenu,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: .035),
                      blurRadius: 12,
                      offset: const Offset(0, 5),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.menu_rounded,
                  color: AppColors.primaryDeep,
                  size: 21,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AdminDirectorySheet extends StatelessWidget {
  const _AdminDirectorySheet();

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .82,
      minChildSize: .55,
      maxChildSize: .94,
      expand: false,
      builder: (context, controller) => Container(
        margin: const EdgeInsets.fromLTRB(7, 0, 7, 7),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(29),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .13),
              blurRadius: 38,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: ListView(
          controller: controller,
          physics: const BouncingScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(14, 9, 14, 24),
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                const AdminIconBadge(
                  icon: Icons.dashboard_customize_outlined,
                  size: 42,
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Admin menu',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Same categories as the web sidebar.',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.8,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Material(
                  color: AppColors.surfaceRose.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(13),
                  child: InkWell(
                    onTap: () => Navigator.of(context).pop('__sign_out__'),
                    borderRadius: BorderRadius.circular(13),
                    child: Container(
                      height: 38,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(13),
                        border: Border.all(
                          color: AppColors.pink.withValues(alpha: .18),
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.logout_rounded,
                            size: 15,
                            color: AppColors.pinkDeep,
                          ),
                          SizedBox(width: 5),
                          Text(
                            'Sign out',
                            style: TextStyle(
                              color: AppColors.pinkDeep,
                              fontSize: 9.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 15),
            ...AdminNavigation.groups.map((group) {
              final visual = _directoryGroupVisual(group.label);
              return Padding(
                padding: const EdgeInsets.only(bottom: 9),
                child: Theme(
                  data: Theme.of(context).copyWith(
                    dividerColor: Colors.transparent,
                    splashColor: visual.accent.withValues(alpha: .06),
                    highlightColor: visual.accent.withValues(alpha: .04),
                  ),
                  child: Container(
                    decoration: BoxDecoration(
                      color: visual.tone,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: visual.accent.withValues(alpha: .16),
                      ),
                    ),
                    child: ExpansionTile(
                      initiallyExpanded: group.label == 'People & access' ||
                          group.label == 'Community & support',
                      tilePadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 2,
                      ),
                      childrenPadding: const EdgeInsets.fromLTRB(7, 0, 7, 8),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                      collapsedShape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                      backgroundColor: Colors.transparent,
                      collapsedBackgroundColor: Colors.transparent,
                      iconColor: visual.accent,
                      collapsedIconColor: visual.accent,
                      leading: Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: AppColors.surface.withValues(alpha: .82),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: visual.accent.withValues(alpha: .14),
                          ),
                        ),
                        child: Icon(
                          visual.icon,
                          size: 17,
                          color: visual.accent,
                        ),
                      ),
                      title: Text(
                        group.label,
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 11.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      children: group.items
                          .map(
                            (item) => Padding(
                              padding: const EdgeInsets.only(top: 5),
                              child: Material(
                                color: AppColors.surface.withValues(alpha: .82),
                                borderRadius: BorderRadius.circular(16),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(16),
                                  onTap: () =>
                                      Navigator.of(context).pop(item.id),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 9,
                                      vertical: 9,
                                    ),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(
                                        color: visual.accent.withValues(
                                          alpha: .10,
                                        ),
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        AdminIconBadge(
                                          icon: item.icon,
                                          size: 34,
                                          tone: visual.tone,
                                          iconColor: visual.accent,
                                        ),
                                        const SizedBox(width: 9),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                item.label,
                                                style: const TextStyle(
                                                  color: AppColors.textPrimary,
                                                  fontSize: 10.8,
                                                  fontWeight: FontWeight.w900,
                                                ),
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                item.subtitle,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                  color: AppColors.textMuted,
                                                  fontSize: 8.7,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        Icon(
                                          Icons.arrow_forward_ios_rounded,
                                          size: 11,
                                          color: visual.accent.withValues(
                                            alpha: .72,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _DirectoryGroupVisual {
  const _DirectoryGroupVisual({
    required this.icon,
    required this.accent,
    required this.tone,
  });

  final IconData icon;
  final Color accent;
  final Color tone;
}

_DirectoryGroupVisual _directoryGroupVisual(String label) {
  return switch (label) {
    'People & access' => const _DirectoryGroupVisual(
        icon: Icons.groups_2_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFECF8F5),
      ),
    'Community & support' => const _DirectoryGroupVisual(
        icon: Icons.forum_outlined,
        accent: AppColors.pinkDeep,
        tone: Color(0xFFFFF3F6),
      ),
    'Data & evidence' => const _DirectoryGroupVisual(
        icon: Icons.dataset_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFEAF7F4),
      ),
    'Intelligence' => const _DirectoryGroupVisual(
        icon: Icons.psychology_alt_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFE8F7F5),
      ),
    'Finance' => const _DirectoryGroupVisual(
        icon: Icons.account_balance_wallet_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFF0F8F3),
      ),
    'Security & system' => const _DirectoryGroupVisual(
        icon: Icons.security_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFEAF7F4),
      ),
    'My account' => const _DirectoryGroupVisual(
        icon: Icons.person_outline_rounded,
        accent: AppColors.primary,
        tone: Color(0xFFEEF8F6),
      ),
    _ => const _DirectoryGroupVisual(
        icon: Icons.space_dashboard_outlined,
        accent: AppColors.primary,
        tone: Color(0xFFEEF8F6),
      ),
  };
}

class _FloatingAdminNavigation extends StatelessWidget {
  const _FloatingAdminNavigation({
    required this.index,
    required this.onSelected,
  });

  final int index;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: Container(
        height: 76,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: .985),
          borderRadius: BorderRadius.circular(25),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.graphite.withValues(alpha: .12),
              blurRadius: 28,
              offset: const Offset(0, 12),
            ),
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: .035),
              blurRadius: 12,
              offset: const Offset(0, -3),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.space_dashboard_outlined,
                selectedIcon: Icons.space_dashboard_rounded,
                label: 'Overview',
                selected: index == 0,
                onTap: () => onSelected(0),
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.groups_2_outlined,
                selectedIcon: Icons.groups_2_rounded,
                label: 'Users',
                selected: index == 1,
                onTap: () => onSelected(1),
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.flag_outlined,
                selectedIcon: Icons.flag_rounded,
                label: 'Reports',
                selected: index == 2,
                onTap: () => onSelected(2),
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.person_outline_rounded,
                selectedIcon: Icons.person_rounded,
                label: 'Profile',
                selected: index == 3,
                onTap: () => onSelected(3),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdminNavigationItem extends StatelessWidget {
  const _AdminNavigationItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? AppColors.primaryDark : AppColors.textMuted;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            height: 60,
            decoration: BoxDecoration(
              color: selected ? AppColors.primarySoft : Colors.transparent,
              borderRadius: BorderRadius.circular(18),
              boxShadow: selected
                  ? [
                      BoxShadow(
                        color: AppColors.primaryDark.withValues(alpha: .07),
                        blurRadius: 14,
                        offset: const Offset(0, 6),
                      ),
                    ]
                  : null,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AnimatedScale(
                  scale: selected ? 1.06 : 1,
                  duration: const Duration(milliseconds: 220),
                  child: Icon(
                    selected ? selectedIcon : icon,
                    size: selected ? 23 : 21,
                    color: foreground,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 9.2,
                    fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
                    letterSpacing: selected ? -.1 : 0,
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
