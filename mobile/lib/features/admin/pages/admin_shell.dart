import 'package:flutter/material.dart';

import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/api/auth_api.dart';
import '../../user/pages/profile_settings_page.dart';
import '../../user/pages/user_shell.dart';
import '../models/admin_resource.dart';
import '../widgets/admin_ui.dart';
import 'admin_ai_models_page.dart';
import 'admin_ai_monitoring_page.dart';
import 'admin_alerts_page.dart';
import 'admin_dashboard_page.dart';
import 'admin_more_page.dart';
import 'admin_publication_reports_page.dart';
import 'admin_resource_page.dart';
import 'admin_sensitive_workspace_page.dart';
import 'admin_snapshot_page.dart';
import 'admin_support_queue_page.dart';

/// Provides the main navigation shell for the administrative workspace.
///
/// @author Eman
class AdminShell extends StatefulWidget {
  const AdminShell({super.key, this.initialIndex = 0});

  final int initialIndex;

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  late int _index;
  late int _previousIndex;

  bool _checkingRole = true;

  @override
  void initState() {
    super.initState();

    _index = widget.initialIndex.clamp(0, 3).toInt();
    _previousIndex = _index == 2 ? 0 : _index;

    _verifyRole();
  }

  Future<void> _verifyRole() async {
    final user = await SessionStore.instance.readUser();

    final role = user?['role']?.toString().trim().toUpperCase() ?? '';

    if (!mounted) {
      return;
    }

    if (role != 'ADMIN') {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const UserShell()),
        (route) => false,
      );

      return;
    }

    setState(() {
      _checkingRole = false;
    });
  }

  Future<void> _signOut() async {
    await AuthApi.instance.logout();

    if (!mounted) {
      return;
    }

    Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
  }

  Future<void> _open(String id) async {
    if (id == 'users') {
      setState(() {
        _index = 1;
      });

      return;
    }

    if (id == 'reports') {
      setState(() {
        if (_index != 2) {
          _previousIndex = _index;
        }

        _index = 2;
      });

      return;
    }

    Widget? page;

    if (id == 'complaints') {
      page = const AdminSupportQueuePage(
        type: AdminSupportQueueType.complaints,
      );
    } else if (id == 'alerts') {
      page = const AdminAlertsPage();
    } else if (id == 'ai-monitoring') {
      page = const AdminAiMonitoringPage();
    } else if (id == 'ai-models') {
      page = const AdminAiModelsPage();
    } else if (id == 'contact') {
      page = const AdminSupportQueuePage(type: AdminSupportQueueType.contact);
    } else if (id == 'ai-analytics') {
      page = const AdminSnapshotPage(
        title: 'AI analytics',
        subtitle:
            'Model performance, quality and usage signals in one compact view.',
        eyebrow: 'Intelligence',
        icon: Icons.insights_outlined,
        path: '/admin/ai/analytics/summary',
      );
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
      page = const AdminSensitiveWorkspacePage(
        scope: 'SYSTEM_SETTINGS',
        title: 'System settings',
        subtitle:
            'Inspect protected platform configuration after identity confirmation.',
        icon: Icons.tune_rounded,
        path: '/admin/settings',
      );
    } else if (id == 'account') {
      page = const ProfileSettingsPage();
    } else {
      final resource = AdminResources.byId(id);

      if (resource != null) {
        page = AdminResourcePage(resource: resource);
      }
    }

    if (page == null || !mounted) {
      return;
    }

    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page!));
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

    final pages = <Widget>[
      AdminDashboardPage(onOpen: _open),
      const AdminResourcePage(resource: AdminResources.users, embedded: true),
      AdminPublicationReportsPage(embedded: true, onBack: _backFromReports),
      AdminMorePage(onOpen: _open, onSignOut: _signOut),
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      extendBody: true,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          bottom: false,
          child: IndexedStack(index: _index, children: pages),
        ),
      ),
      bottomNavigationBar: _FloatingAdminNavigation(
        index: _index,
        onSelected: _selectTab,
      ),
    );
  }

  void _backFromReports() {
    setState(() {
      _index = _previousIndex == 2 ? 0 : _previousIndex;
    });
  }

  void _selectTab(int index) {
    if (_index == index) {
      return;
    }

    setState(() {
      if (index == 2) {
        _previousIndex = _index;
      }

      _index = index;
    });
  }
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
                onTap: () {
                  onSelected(0);
                },
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.groups_2_outlined,
                selectedIcon: Icons.groups_2_rounded,
                label: 'Users',
                selected: index == 1,
                onTap: () {
                  onSelected(1);
                },
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.flag_outlined,
                selectedIcon: Icons.flag_rounded,
                label: 'Reports',
                selected: index == 2,
                onTap: () {
                  onSelected(2);
                },
              ),
            ),
            Expanded(
              child: _AdminNavigationItem(
                icon: Icons.apps_outlined,
                selectedIcon: Icons.apps_rounded,
                label: 'More',
                selected: index == 3,
                onTap: () {
                  onSelected(3);
                },
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
