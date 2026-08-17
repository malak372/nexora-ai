import 'package:flutter/material.dart';

/// Small-screen navigation metadata for the administrative workspace.
///
/// The groups intentionally mirror the web administration sidebar so admins
/// see the same information architecture on web and mobile, while the mobile
/// UI is free to render the groups as cards or bottom-sheet sections.
///
/// @author Eman
class AdminNavigationGroup {
  const AdminNavigationGroup({required this.label, required this.items});

  final String label;
  final List<AdminNavigationDestination> items;
}

class AdminNavigationDestination {
  const AdminNavigationDestination({
    required this.id,
    required this.label,
    required this.subtitle,
    required this.icon,
  });

  final String id;
  final String label;
  final String subtitle;
  final IconData icon;
}

abstract final class AdminNavigation {
  static const groups = <AdminNavigationGroup>[
    AdminNavigationGroup(
      label: 'Overview',
      items: [
        AdminNavigationDestination(
          id: 'overview',
          label: 'Command center',
          subtitle: 'Live platform overview and core numbers',
          icon: Icons.space_dashboard_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'People & access',
      items: [
        AdminNavigationDestination(
          id: 'administrators',
          label: 'Administrators',
          subtitle: 'Protected administrator access workspace',
          icon: Icons.admin_panel_settings_outlined,
        ),
        AdminNavigationDestination(
          id: 'team-chat',
          label: 'Team chat',
          subtitle: 'Private administrator conversations',
          icon: Icons.forum_outlined,
        ),
        AdminNavigationDestination(
          id: 'users',
          label: 'Users',
          subtitle: 'Customer accounts, access and usage',
          icon: Icons.groups_2_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'Community & support',
      items: [
        AdminNavigationDestination(
          id: 'ideas',
          label: 'Ideas',
          subtitle: 'Generated and published idea records',
          icon: Icons.lightbulb_outline_rounded,
        ),
        AdminNavigationDestination(
          id: 'reports',
          label: 'Publication reports',
          subtitle: 'Trust and safety moderation queue',
          icon: Icons.flag_outlined,
        ),
        AdminNavigationDestination(
          id: 'complaints',
          label: 'Complaints',
          subtitle: 'User support and resolution cases',
          icon: Icons.support_agent_rounded,
        ),
        AdminNavigationDestination(
          id: 'contact',
          label: 'Contact inbox',
          subtitle: 'Guest and registered-user messages',
          icon: Icons.mark_email_unread_outlined,
        ),
        AdminNavigationDestination(
          id: 'alerts',
          label: 'Alerts',
          subtitle: 'Platform alerts and admin notifications',
          icon: Icons.notifications_active_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'Data & evidence',
      items: [
        AdminNavigationDestination(
          id: 'evidence',
          label: 'Evidence Library',
          subtitle: 'Collected community evidence',
          icon: Icons.dataset_outlined,
        ),
        AdminNavigationDestination(
          id: 'data-sources',
          label: 'Data sources',
          subtitle: 'Collection providers and availability',
          icon: Icons.hub_outlined,
        ),
        AdminNavigationDestination(
          id: 'collection',
          label: 'Data collection',
          subtitle: 'Collection jobs and execution',
          icon: Icons.account_tree_outlined,
        ),
        AdminNavigationDestination(
          id: 'domains',
          label: 'Domains',
          subtitle: 'Generation domain catalog',
          icon: Icons.layers_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'Intelligence',
      items: [
        AdminNavigationDestination(
          id: 'ai-monitoring',
          label: 'AI monitoring',
          subtitle: 'Calls, latency and model results',
          icon: Icons.monitor_heart_outlined,
        ),
        AdminNavigationDestination(
          id: 'ai-analytics',
          label: 'AI analytics',
          subtitle: 'Aggregated model performance signals',
          icon: Icons.insights_outlined,
        ),
        AdminNavigationDestination(
          id: 'ai-models',
          label: 'AI models',
          subtitle: 'Configured models and providers',
          icon: Icons.psychology_alt_outlined,
        ),
        AdminNavigationDestination(
          id: 'prompts',
          label: 'Prompt control',
          subtitle: 'Prompt-template history',
          icon: Icons.auto_awesome_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'Finance',
      items: [
        AdminNavigationDestination(
          id: 'payments',
          label: 'Payments',
          subtitle: 'Transactions and captured revenue',
          icon: Icons.payments_outlined,
        ),
        AdminNavigationDestination(
          id: 'credits',
          label: 'Credits',
          subtitle: 'Credit transactions and balances',
          icon: Icons.toll_outlined,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'Security & system',
      items: [
        AdminNavigationDestination(
          id: 'auth-audit',
          label: 'Auth security',
          subtitle: 'Authentication events and failures',
          icon: Icons.security_outlined,
        ),
        AdminNavigationDestination(
          id: 'audit-logs',
          label: 'Audit trail',
          subtitle: 'Administrative action history',
          icon: Icons.manage_history_rounded,
        ),
        AdminNavigationDestination(
          id: 'settings',
          label: 'System settings',
          subtitle: 'Protected platform configuration',
          icon: Icons.tune_rounded,
        ),
      ],
    ),
    AdminNavigationGroup(
      label: 'My account',
      items: [
        AdminNavigationDestination(
          id: 'account',
          label: 'Profile & security',
          subtitle: 'Your administrator profile and password',
          icon: Icons.person_outline_rounded,
        ),
      ],
    ),
  ];
}
