import 'package:flutter/material.dart';

import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../widgets/admin_ui.dart';

/// Compact administrator profile tab.
///
/// The full administration directory lives in the top-right menu, while this
/// primary tab is intentionally dedicated to the signed-in administrator,
/// account/security access and session actions.
///
/// @author Eman
class AdminMorePage extends StatefulWidget {
  const AdminMorePage({
    super.key,
    required this.onOpen,
    required this.onOpenMenu,
    required this.onSignOut,
  });

  final ValueChanged<String> onOpen;
  final VoidCallback onOpenMenu;
  final Future<void> Function() onSignOut;

  @override
  State<AdminMorePage> createState() => _AdminMorePageState();
}

class _AdminMorePageState extends State<AdminMorePage> {
  Map<String, dynamic> _user = const {};
  bool _signingOut = false;

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    final user = await SessionStore.instance.readUser();
    if (!mounted || user == null) return;
    setState(() => _user = Map<String, dynamic>.from(user));
  }

  Future<void> _signOut() async {
    if (_signingOut) return;
    setState(() => _signingOut = true);
    try {
      await widget.onSignOut();
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fullName = _text(
      _user['fullName'] ?? _user['name'],
      fallback: 'Administrator',
    );
    final email = _text(_user['email']);
    final avatarUrl = _text(
      _user['avatarUrl'] ??
          _user['profileImageUrl'] ??
          _user['profileImage'] ??
          _user['avatar'],
    );

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _loadUser,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 120),
        children: [
          const AdminPageHeader(
            title: 'Admin profile',
            subtitle: 'Your account, security and administration access.',
            eyebrow: 'Profile',
            icon: Icons.person_rounded,
          ),
          const SizedBox(height: 16),
          _ProfileHero(
            fullName: fullName,
            email: email,
            avatarUrl: avatarUrl,
          ),
          const SizedBox(height: 18),
          const _SectionLabel(label: 'ACCOUNT'),
          const SizedBox(height: 8),
          AdminGlassCard(
            padding: const EdgeInsets.all(6),
            child: Column(
              children: [
                _ProfileActionRow(
                  icon: Icons.manage_accounts_outlined,
                  title: 'Profile & security',
                  subtitle: 'Personal details, password and account settings',
                  onTap: () => widget.onOpen('account'),
                ),
                _Divider(),
                _ProfileActionRow(
                  icon: Icons.admin_panel_settings_outlined,
                  title: 'Administration menu',
                  subtitle: 'Open every admin workspace and system area',
                  onTap: widget.onOpenMenu,
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          const _SectionLabel(label: 'WORKSPACE'),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _QuickTile(
                  icon: Icons.groups_2_outlined,
                  label: 'Users',
                  onTap: () => widget.onOpen('users'),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: _QuickTile(
                  icon: Icons.flag_outlined,
                  label: 'Reports',
                  onTap: () => widget.onOpen('reports'),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: _QuickTile(
                  icon: Icons.space_dashboard_outlined,
                  label: 'Overview',
                  onTap: () => widget.onOpen('overview'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
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
              minimumSize: const Size.fromHeight(48),
              foregroundColor: AppColors.danger,
              backgroundColor: AppColors.surface.withValues(alpha: .9),
              side: BorderSide(
                color: AppColors.pinkLight.withValues(alpha: .85),
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _text(dynamic value, {String fallback = ''}) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }
}

class _ProfileHero extends StatelessWidget {
  const _ProfileHero({
    required this.fullName,
    required this.email,
    required this.avatarUrl,
  });

  final String fullName;
  final String email;
  final String avatarUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 19, 18, 18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primarySoft.withValues(alpha: .95),
            AppColors.surface,
          ],
        ),
        borderRadius: BorderRadius.circular(27),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              AdminAvatar(
                name: fullName,
                avatarUrl: avatarUrl,
                size: 66,
              ),
              const SizedBox(width: 14),
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
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.35,
                      ),
                    ),
                    if (email.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.1,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .85),
                        borderRadius: BorderRadius.circular(99),
                        border: Border.all(
                          color: AppColors.border.withValues(alpha: .8),
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.verified_user_outlined,
                            size: 12,
                            color: AppColors.primaryDark,
                          ),
                          SizedBox(width: 5),
                          Text(
                            'ADMINISTRATOR',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 8,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .8,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .62),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: AppColors.border.withValues(alpha: .75),
              ),
            ),
            child: const Row(
              children: [
                Icon(
                  Icons.shield_outlined,
                  size: 16,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Administrative access is active for this session.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 9.4,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Icon(
                  Icons.check_circle_rounded,
                  size: 16,
                  color: AppColors.primary,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Row(
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 7),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.7,
              fontWeight: FontWeight.w900,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileActionRow extends StatelessWidget {
  const _ProfileActionRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Row(
            children: [
              AdminIconBadge(icon: icon, size: 40),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
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
                size: 12,
                color: AppColors.sage,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      child: Divider(
        height: 1,
        color: AppColors.border.withValues(alpha: .55),
      ),
    );
  }
}

class _QuickTile extends StatelessWidget {
  const _QuickTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface.withValues(alpha: .92),
      borderRadius: BorderRadius.circular(19),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(19),
        child: Container(
          height: 91,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(19),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AdminIconBadge(icon: icon, size: 37),
              const SizedBox(height: 7),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.4,
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
