import 'package:flutter/material.dart';

import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../widgets/admin_ui.dart';

/// Displays the extended administrative navigation page.
///
/// This page groups secondary administrative features into organized
/// sections so they remain easy to access on smaller screens.
///
/// The page includes:
/// - Administrator identity information.
/// - Community and support management.
/// - Data and evidence tools.
/// - AI and intelligence tools.
/// - Finance management.
/// - Security and system administration.
/// - Administrator account settings.
/// - Sign-out functionality.
///
/// Navigation is delegated through [onOpen], while authentication
/// termination is handled through [onSignOut].
///
/// @author Eman
class AdminMorePage extends StatefulWidget {
  /// Creates the extended administrative navigation page.
  const AdminMorePage({
    super.key,
    required this.onOpen,
    required this.onSignOut,
  });

  /// Callback used to open an administrative destination.
  ///
  /// The selected menu item's identifier is passed to the parent
  /// administrative shell for navigation handling.
  final ValueChanged<String> onOpen;

  /// Callback responsible for signing the current administrator out.
  final Future<void> Function() onSignOut;

  @override
  State<AdminMorePage> createState() => _AdminMorePageState();
}

/// Manages administrator profile information and sign-out state
/// for [AdminMorePage].
///
/// @author Eman
class _AdminMorePageState extends State<AdminMorePage> {
  /// Cached information about the currently authenticated administrator.
  Map<String, dynamic> _user = const {};

  /// Indicates whether a sign-out operation is currently running.
  ///
  /// This prevents duplicate logout requests and controls the loading
  /// indicator displayed inside the sign-out button.
  bool _signingOut = false;

  /// Loads the stored administrator information when the page
  /// is initialized.
  @override
  void initState() {
    super.initState();

    _loadUser();
  }

  /// Retrieves the currently authenticated user from [SessionStore].
  ///
  /// The stored information is used to display the administrator's
  /// name, email address, and generated initials.
  Future<void> _loadUser() async {
    final user = await SessionStore.instance.readUser();

    if (!mounted || user == null) {
      return;
    }

    setState(() {
      _user = user;
    });
  }

  /// Performs the administrator sign-out operation.
  ///
  /// Duplicate requests are prevented while an existing sign-out
  /// operation is still active.
  ///
  /// The actual authentication logout behavior is delegated to
  /// [AdminMorePage.onSignOut].
  Future<void> _signOut() async {
    if (_signingOut) {
      return;
    }

    setState(() {
      _signingOut = true;
    });

    await widget.onSignOut();

    if (mounted) {
      setState(() {
        _signingOut = false;
      });
    }
  }

  /// Builds the extended administrative navigation interface.
  ///
  /// Administrative destinations are organized into logical groups
  /// and rendered using reusable glass cards and menu rows.
  @override
  Widget build(BuildContext context) {
    /// Logical groups used to organize administrative destinations.
    final groups = <_AdminMenuGroup>[
      const _AdminMenuGroup(
        title: 'Community & support',
        items: [
          _AdminMenuItem(
            'ideas',
            'Ideas',
            'Generated and published idea records',
            Icons.lightbulb_outline_rounded,
          ),
          _AdminMenuItem(
            'reports',
            'Publication reports',
            'Trust and safety moderation queue',
            Icons.flag_outlined,
          ),
          _AdminMenuItem(
            'complaints',
            'Complaints',
            'User support and resolution cases',
            Icons.support_agent_rounded,
          ),
          _AdminMenuItem(
            'contact',
            'Contact inbox',
            'Guest and registered-user messages',
            Icons.mark_email_unread_outlined,
          ),
          _AdminMenuItem(
            'alerts',
            'Alerts',
            'Platform alerts and admin notifications',
            Icons.notifications_active_outlined,
          ),
        ],
      ),
      const _AdminMenuGroup(
        title: 'Data & evidence',
        items: [
          _AdminMenuItem(
            'evidence',
            'Evidence Library',
            'Collected community evidence',
            Icons.dataset_outlined,
          ),
          _AdminMenuItem(
            'data-sources',
            'Data sources',
            'Collection providers and availability',
            Icons.hub_outlined,
          ),
          _AdminMenuItem(
            'collection',
            'Data collection',
            'Collection jobs and execution',
            Icons.account_tree_outlined,
          ),
          _AdminMenuItem(
            'domains',
            'Domains',
            'Generation domain catalog',
            Icons.layers_outlined,
          ),
        ],
      ),
      const _AdminMenuGroup(
        title: 'Intelligence',
        items: [
          _AdminMenuItem(
            'ai-monitoring',
            'AI monitoring',
            'Calls, latency and model results',
            Icons.monitor_heart_outlined,
          ),
          _AdminMenuItem(
            'ai-analytics',
            'AI analytics',
            'Aggregated model performance signals',
            Icons.insights_outlined,
          ),
          _AdminMenuItem(
            'ai-models',
            'AI models',
            'Configured models and providers',
            Icons.psychology_alt_outlined,
          ),
          _AdminMenuItem(
            'prompts',
            'Prompt control',
            'Prompt-template history',
            Icons.auto_awesome_outlined,
          ),
        ],
      ),
      const _AdminMenuGroup(
        title: 'Finance',
        items: [
          _AdminMenuItem(
            'payments',
            'Payments',
            'Transactions and captured revenue',
            Icons.payments_outlined,
          ),
          _AdminMenuItem(
            'credits',
            'Credits',
            'Credit transactions and balances',
            Icons.toll_outlined,
          ),
        ],
      ),
      const _AdminMenuGroup(
        title: 'Security & system',
        items: [
          _AdminMenuItem(
            'auth-audit',
            'Auth security',
            'Authentication events and failures',
            Icons.security_outlined,
          ),
          _AdminMenuItem(
            'audit-logs',
            'Audit trail',
            'Administrative action history',
            Icons.manage_history_rounded,
          ),
          _AdminMenuItem(
            'administrators',
            'Administrators',
            'Protected admin access workspace',
            Icons.admin_panel_settings_outlined,
          ),
          _AdminMenuItem(
            'settings',
            'System settings',
            'Protected platform configuration',
            Icons.tune_rounded,
          ),
        ],
      ),
      const _AdminMenuGroup(
        title: 'My account',
        items: [
          _AdminMenuItem(
            'account',
            'Profile & security',
            'Your administrator profile and password',
            Icons.person_outline_rounded,
          ),
        ],
      ),
    ];

    /// Administrator display name used by the account summary card.
    final fullName = _user['fullName']?.toString().trim() ?? 'Administrator';

    /// Administrator email address.
    final email = _user['email']?.toString().trim() ?? '';

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 120),
      children: [
        const AdminPageHeader(
          title: 'Admin workspace',
          subtitle: 'Every administrative area, arranged for a small screen.',
          eyebrow: 'More',
          icon: Icons.apps_rounded,
        ),
        const SizedBox(height: 16),

        /// Administrator identity summary.
        AdminGlassCard(
          tint: AppColors.primarySoft.withValues(alpha: .72),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryDark],
                  ),
                ),
                child: Text(
                  _initials(fullName),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      fullName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (email.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.7,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .9),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: const Text(
                  'ADMIN',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .8,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),

        /// Builds every administrative menu section.
        ...groups.expand(
          (group) => [
            Padding(
              padding: const EdgeInsets.fromLTRB(3, 0, 3, 8),
              child: Text(
                group.title.toUpperCase(),
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.7,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1,
                ),
              ),
            ),
            AdminGlassCard(
              padding: const EdgeInsets.all(6),
              child: Column(
                children: group.items
                    .map(
                      (item) => _MenuRow(
                        item: item,
                        onTap: () {
                          widget.onOpen(item.id);
                        },
                      ),
                    )
                    .toList(),
              ),
            ),
            const SizedBox(height: 15),
          ],
        ),

        /// Administrator sign-out action.
        OutlinedButton.icon(
          onPressed: _signingOut ? null : _signOut,
          icon: _signingOut
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.logout_rounded, size: 18),
          label: Text(_signingOut ? 'Signing out…' : 'Sign out'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.danger,
            side: BorderSide(color: AppColors.pinkLight.withValues(alpha: .9)),
          ),
        ),
      ],
    );
  }

  /// Generates up to two initials from the supplied administrator name.
  ///
  /// For example:
  /// - `Eman Alabd` becomes `EA`.
  /// - `Eman` becomes `E`.
  ///
  /// If the provided value does not contain a valid name,
  /// `A` is returned as a fallback.
  static String _initials(String value) {
    final parts = value
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();

    if (parts.isEmpty) {
      return 'A';
    }

    return parts.take(2).map((part) => part[0].toUpperCase()).join();
  }
}

/// Displays a single interactive destination inside an admin menu group.
///
/// Each row contains:
/// - A contextual icon.
/// - Destination title.
/// - Short description.
/// - Forward navigation indicator.
///
/// @author Eman
class _MenuRow extends StatelessWidget {
  /// Creates an administrative menu row.
  const _MenuRow({required this.item, required this.onTap});

  /// Menu destination represented by this row.
  final _AdminMenuItem item;

  /// Callback invoked when the row is selected.
  final VoidCallback onTap;

  /// Builds the interactive administrative menu row.
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 9),
          child: Row(
            children: [
              AdminIconBadge(icon: item.icon, size: 38),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.7,
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
                        fontSize: 9.1,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 13,
                color: AppColors.sage,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Represents a logical section of administrative menu destinations.
///
/// A group contains a section [title] and the list of administrative
/// [items] displayed within that section.
///
/// @author Eman
class _AdminMenuGroup {
  /// Creates an administrative menu group.
  const _AdminMenuGroup({required this.title, required this.items});

  /// Human-readable title displayed above the group.
  final String title;

  /// Administrative menu destinations contained in the group.
  final List<_AdminMenuItem> items;
}

/// Represents the information required for a single administrative
/// menu destination.
///
/// The item stores the identifier used for navigation together with
/// its visible title, description, and icon.
///
/// @author Eman
class _AdminMenuItem {
  /// Creates an administrative menu destination.
  const _AdminMenuItem(this.id, this.title, this.subtitle, this.icon);

  /// Unique identifier passed to the navigation callback.
  final String id;

  /// Visible title of the destination.
  final String title;

  /// Short description of the destination.
  final String subtitle;

  /// Icon representing the administrative destination.
  final IconData icon;
}
