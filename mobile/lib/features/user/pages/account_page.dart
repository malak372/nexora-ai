// Voxidence mobile account hub.
//
// A compact, premium-feeling mobile control center for Normal and Premium
// users. The page is intentionally lighter than a desktop settings screen:
// identity, membership, live workspace metrics and the most useful account
// destinations are visible without visual clutter.
//
// @author  Malak

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_config.dart';
import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/api/auth_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'billing_page.dart';
import 'compliance_page.dart';
import 'credits_page.dart';
import 'notifications_page.dart';
import 'preferences_page.dart';
import 'published_page.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({super.key});

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  Future<void> _open(Widget page) async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => page));

    if (!mounted) {
      return;
    }

    // Child settings pages already update the shared session snapshot.
    // A forced profile round-trip here made returning to Profile feel slow.
    // The user can still pull to refresh when a fresh server read is wanted.
  }

  Future<void> _openProfileSettings() async {
    await Navigator.of(context).pushNamed(
      '/normal/settings/profile',
      arguments: const <String, String>{
        'returnTitle': 'Profile',
        'returnRoute': '/normal/profile',
      },
    );

    if (!mounted) {
      return;
    }
  }

  Future<void> _logout() async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => const _SignOutSheet(),
    );

    if (confirmed != true) {
      return;
    }

    try {
      await AuthApi.instance.logout();
    } catch (_) {
      await SessionStore.instance.clear();
    }

    ApiClient.instance.clearCache();
    UserSessionController.instance.reset();

    if (!mounted) {
      return;
    }

    Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);

    final session = UserSessionController.instance;

    return AnimatedBuilder(
      animation: session,
      builder: (context, _) {
        final summary = session.summary;

        final name = (summary?.fullName ?? 'Voxidence User').trim();

        final email = (summary?.email ?? '').trim();

        final premium = summary?.isPremium == true;

        final avatarUrl = _mediaUrl(summary?.avatarUrl ?? '');

        final membershipLabel = premium ? 'Premium' : 'Normal';

        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async {
            await session.load(force: true);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 122),
            children: [
              const _ProfilePageIntro(),

              const SizedBox(height: 11),

              _IdentityHero(
                name: name.isEmpty ? 'Voxidence User' : name,
                email: email,
                avatarUrl: avatarUrl,
                premium: premium,
                loading: summary == null,
                onEdit: _openProfileSettings,
              ),

              if (summary != null) ...[
                const SizedBox(height: 10),

                _MembershipStrip(
                  premium: premium,
                  label: membershipLabel,
                  value: premium
                      ? '${summary.creditBalance} credits available'
                      : '${summary.remainingFreeGenerations} free ideas remaining',
                  onTap: () => _open(const CreditsPage()),
                ),

                const SizedBox(height: 10),

                _ProfileMetricGrid(
                  premium: premium,
                  primaryValue: premium
                      ? summary.creditBalance
                      : summary.remainingFreeGenerations,
                  ideas: summary.ideasCount,
                  published: summary.publishedIdeasCount,
                  favorites: summary.favoriteIdeasCount,
                ),
              ],

              const SizedBox(height: 17),

              const _AccountSectionHeading(
                eyebrow: 'ACCOUNT',
                title: 'Your control center',
                subtitle:
                    'Identity, security and access — without desktop-style clutter.',
                icon: Icons.manage_accounts_outlined,
              ),

              const SizedBox(height: 8),

              _ActionGrid(
                children: [
                  _ProfileActionCard(
                    icon: Icons.manage_accounts_outlined,
                    eyebrow: 'IDENTITY',
                    title: 'Profile & security',
                    subtitle: 'Name, email, password and sessions',
                    onTap: _openProfileSettings,
                  ),
                  _ProfileActionCard(
                    icon: Icons.bolt_rounded,
                    eyebrow: premium ? 'PREMIUM' : 'ACCESS',
                    title: premium ? 'Credits' : 'Upgrade & credits',
                    subtitle: premium
                        ? 'Top up and review access'
                        : 'Explore Premium options',
                    rose: true,
                    onTap: () => _open(const CreditsPage()),
                  ),
                  _ProfileActionCard(
                    icon: Icons.receipt_long_outlined,
                    eyebrow: 'PAYMENTS',
                    title: 'Billing',
                    subtitle: 'Invoices and payment history',
                    onTap: () => _open(const BillingPage()),
                  ),
                  _ProfileActionCard(
                    icon: Icons.tune_rounded,
                    eyebrow: 'DISCOVERY',
                    title: 'Preferences',
                    subtitle: 'Interests, language and region',
                    rose: true,
                    onTap: () => _open(const PreferencesPage()),
                  ),
                ],
              ),

              const SizedBox(height: 17),

              const _AccountSectionHeading(
                eyebrow: 'WORKSPACE',
                title: 'Activity & community',
                subtitle:
                    'Jump into the parts of Voxidence that need your attention.',
                icon: Icons.space_dashboard_outlined,
              ),

              const SizedBox(height: 8),

              _ActivityPanel(
                unread: summary?.unreadNotificationsCount ?? 0,
                published: summary?.publishedIdeasCount ?? 0,
                onPublished: () => _open(const PublishedPage()),
                onNotifications: () => _open(const NotificationsPage()),
                onCompliance: () => _open(const CompliancePage()),
              ),

              const SizedBox(height: 17),

              _SignOutTile(onTap: _logout),
            ],
          ),
        );
      },
    );
  }
}

class _ProfilePageIntro extends StatelessWidget {
  const _ProfilePageIntro();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.auto_awesome_rounded,
                size: 10,
                color: AppColors.primaryDark,
              ),
              SizedBox(width: 5),
              Text(
                'YOUR SPACE',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 6.3,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .72,
                ),
              ),
            ],
          ),
          SizedBox(height: 4),
          Text(
            'Profile',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 24,
              height: 1,
              fontWeight: FontWeight.w900,
              letterSpacing: -.55,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Your account, membership and workspace — organized for mobile.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.6,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _IdentityHero extends StatelessWidget {
  const _IdentityHero({
    required this.name,
    required this.email,
    required this.avatarUrl,
    required this.premium,
    required this.loading,
    required this.onEdit,
  });

  final String name;
  final String email;
  final String avatarUrl;
  final bool premium;
  final bool loading;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Container(
        height: 150,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [
              AppColors.surface,
              Color(0xFFF0F8F5),
              AppColors.surfaceRose,
            ],
          ),
          borderRadius: BorderRadius.circular(23),
          border: Border.all(color: AppColors.border),
        ),
        child: const Center(
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: AppColors.primary,
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(13, 13, 12, 13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, Color(0xFFEAF6F3), AppColors.surfaceRose],
          stops: [0, .63, 1],
        ),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .065),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .04),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -26,
            child: Container(
              width: 118,
              height: 118,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: .07),
                ),
              ),
            ),
          ),
          Positioned(
            right: 2,
            top: -4,
            child: Container(
              width: 70,
              height: 70,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.pink.withValues(alpha: .07),
                ),
              ),
            ),
          ),
          Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  _ProfileAvatarMark(
                    name: name,
                    avatarUrl: avatarUrl,
                    premium: premium,
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 17,
                            height: 1.05,
                            fontWeight: FontWeight.w900,
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
                              fontSize: 8.1,
                            ),
                          ),
                        ],
                        const SizedBox(height: 7),
                        Row(
                          children: [
                            AccountTierBadge(isPremium: premium),
                            const SizedBox(width: 6),
                            Container(
                              height: 27,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .64),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: const Row(
                                children: [
                                  Icon(
                                    Icons.verified_user_outlined,
                                    size: 10,
                                    color: AppColors.success,
                                  ),
                                  SizedBox(width: 4),
                                  Text(
                                    'SECURE',
                                    style: TextStyle(
                                      color: AppColors.success,
                                      fontSize: 5.6,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: .45,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 11),
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onEdit,
                  borderRadius: BorderRadius.circular(13),
                  child: Ink(
                    height: 43,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .62),
                      borderRadius: BorderRadius.circular(13),
                      border: Border.all(
                        color: AppColors.primaryDark.withValues(alpha: .05),
                      ),
                    ),
                    child: const Row(
                      children: [
                        Icon(
                          Icons.edit_outlined,
                          size: 14,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            'Edit profile & security',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 8.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        Icon(
                          Icons.arrow_forward_rounded,
                          size: 13,
                          color: AppColors.primaryDark,
                        ),
                      ],
                    ),
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

class _ProfileAvatarMark extends StatelessWidget {
  const _ProfileAvatarMark({
    required this.name,
    required this.avatarUrl,
    required this.premium,
  });

  final String name;
  final String avatarUrl;
  final bool premium;

  @override
  Widget build(BuildContext context) {
    final hasPhoto = avatarUrl.trim().isNotEmpty;

    return SizedBox(
      width: 74,
      height: 74,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 74,
            height: 74,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white.withValues(alpha: .78),
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .08),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
          ),
          Container(
            width: 64,
            height: 64,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: premium
                    ? const [Color(0xFF69C6C0), Color(0xFF3F8E8A)]
                    : const [Color(0xFF78C9C2), AppColors.primaryDark],
              ),
            ),
            child: hasPhoto
                ? Image.network(
                    avatarUrl,
                    width: 64,
                    height: 64,
                    fit: BoxFit.cover,
                    filterQuality: FilterQuality.medium,
                    errorBuilder: (_, _, _) => _AvatarInitials(name: name),
                  )
                : _AvatarInitials(name: name),
          ),
          Positioned(
            right: 2,
            bottom: 4,
            child: Container(
              width: 19,
              height: 19,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: hasPhoto
                    ? Colors.white
                    : premium
                    ? AppColors.pink
                    : AppColors.success,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: .10),
                    blurRadius: 5,
                  ),
                ],
              ),
              child: Icon(
                hasPhoto
                    ? Icons.photo_camera_outlined
                    : premium
                    ? Icons.auto_awesome_rounded
                    : Icons.check_rounded,
                size: 9,
                color: hasPhoto ? AppColors.primaryDark : Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AvatarInitials extends StatelessWidget {
  const _AvatarInitials({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Text(
      _initials(name),
      style: const TextStyle(
        color: Colors.white,
        fontSize: 18,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

class _MembershipStrip extends StatelessWidget {
  const _MembershipStrip({
    required this.premium,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final bool premium;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(10, 9, 9, 9),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: premium
                  ? const [Color(0xFFE5F5F1), AppColors.surfaceRose]
                  : const [Color(0xFFF0F8F5), AppColors.surface],
            ),
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: AppColors.primary.withValues(alpha: .10)),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: premium ? AppColors.primary : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  premium
                      ? Icons.workspace_premium_outlined
                      : Icons.explore_outlined,
                  size: 16,
                  color: premium ? Colors.white : AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$label WORKSPACE'.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 5.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .58,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.arrow_forward_rounded,
                size: 14,
                color: AppColors.primaryDark,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileMetricGrid extends StatelessWidget {
  const _ProfileMetricGrid({
    required this.premium,
    required this.primaryValue,
    required this.ideas,
    required this.published,
    required this.favorites,
  });

  final bool premium;
  final int primaryValue;
  final int ideas;
  final int published;
  final int favorites;

  @override
  Widget build(BuildContext context) {
    final items = <_ProfileMetricData>[
      _ProfileMetricData(
        icon: premium ? Icons.bolt_rounded : Icons.eco_outlined,
        value: '$primaryValue',
        label: premium ? 'Credits' : 'Free ideas',
      ),
      _ProfileMetricData(
        icon: Icons.lightbulb_outline_rounded,
        value: '$ideas',
        label: 'Ideas',
      ),
      _ProfileMetricData(
        icon: Icons.public_rounded,
        value: '$published',
        label: 'Published',
      ),
      _ProfileMetricData(
        icon: Icons.favorite_border_rounded,
        value: '$favorites',
        label: 'Favorites',
        rose: true,
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 7.0;

        final width = (constraints.maxWidth - gap) / 2;

        return Wrap(
          spacing: gap,
          runSpacing: 7,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: _ProfileMetricCard(data: item),
              ),
          ],
        );
      },
    );
  }
}

class _ProfileMetricData {
  const _ProfileMetricData({
    required this.icon,
    required this.value,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool rose;
}

class _ProfileMetricCard extends StatelessWidget {
  const _ProfileMetricCard({required this.data});

  final _ProfileMetricData data;

  @override
  Widget build(BuildContext context) {
    final accent = data.rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      height: 72,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .66),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: .055)),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: data.rose ? AppColors.pinkSoft : AppColors.primarySoft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(data.icon, size: 15, color: accent),
          ),
          const SizedBox(width: 8),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                data.value,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  height: 1,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                data.label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AccountSectionHeading extends StatelessWidget {
  const _AccountSectionHeading({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, size: 16, color: AppColors.primaryDark),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 5.8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .62,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.3,
                  height: 1.32,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ActionGrid extends StatelessWidget {
  const _ActionGrid({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 7.0;

        final width = (constraints.maxWidth - gap) / 2;

        return Wrap(
          spacing: gap,
          runSpacing: 7,
          children: [
            for (final child in children) SizedBox(width: width, child: child),
          ],
        );
      },
    );
  }
}

class _ProfileActionCard extends StatelessWidget {
  const _ProfileActionCard({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.rose = false,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          height: 113,
          padding: const EdgeInsets.fromLTRB(10, 10, 9, 9),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: rose
                  ? const [AppColors.surface, AppColors.surfaceRose]
                  : const [AppColors.surface, Color(0xFFF0F8F5)],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: accent.withValues(alpha: .065)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .025),
                blurRadius: 11,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: rose ? AppColors.pinkSoft : AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(icon, size: 14.5, color: accent),
                  ),
                  const Spacer(),
                  Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .68),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.arrow_outward_rounded,
                      size: 11,
                      color: accent,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Text(
                eyebrow,
                style: TextStyle(
                  color: accent,
                  fontSize: 5.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .52,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.6,
                  height: 1.23,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivityPanel extends StatelessWidget {
  const _ActivityPanel({
    required this.unread,
    required this.published,
    required this.onPublished,
    required this.onNotifications,
    required this.onCompliance,
  });

  final int unread;
  final int published;
  final VoidCallback onPublished;
  final VoidCallback onNotifications;
  final VoidCallback onCompliance;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .66),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .05)),
      ),
      child: Column(
        children: [
          _ActivityRow(
            icon: Icons.public_rounded,
            title: 'Published ideas',
            subtitle: '$published live or managed publications',
            onTap: onPublished,
          ),
          _ActivityDivider(),
          _ActivityRow(
            icon: Icons.notifications_none_rounded,
            title: 'Notifications',
            subtitle: '$unread unread workspace messages',
            badge: unread > 0 ? '$unread' : null,
            rose: true,
            onTap: onNotifications,
          ),
          _ActivityDivider(),
          _ActivityRow(
            icon: Icons.shield_outlined,
            title: 'Compliance & complaints',
            subtitle: 'Cases, reports and admin responses',
            onTap: onCompliance,
          ),
        ],
      ),
    );
  }
}

class _ActivityDivider extends StatelessWidget {
  const _ActivityDivider();

  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      indent: 48,
      color: AppColors.border.withValues(alpha: .72),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.badge,
    this.rose = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final String? badge;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(7, 9, 6, 9),
          child: Row(
            children: [
              Container(
                width: 35,
                height: 35,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: rose ? AppColors.pinkSoft : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 15, color: accent),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.1,
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
                        fontSize: 6.8,
                      ),
                    ),
                  ],
                ),
              ),
              if (badge != null) ...[
                Container(
                  height: 23,
                  constraints: const BoxConstraints(minWidth: 23),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.pinkSoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    badge!,
                    style: const TextStyle(
                      color: AppColors.pinkDeep,
                      fontSize: 6.4,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 5),
              ],
              const Icon(
                Icons.chevron_right_rounded,
                size: 17,
                color: AppColors.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignOutTile extends StatelessWidget {
  const _SignOutTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          height: 53,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: AppColors.surfaceRose,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.pink.withValues(alpha: .13)),
          ),
          child: const Row(
            children: [
              Icon(Icons.logout_rounded, size: 16, color: AppColors.danger),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Sign out',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                'END SESSION',
                style: TextStyle(
                  color: AppColors.pinkDeep,
                  fontSize: 5.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .48,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignOutSheet extends StatelessWidget {
  const _SignOutSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        padding: const EdgeInsets.fromLTRB(15, 10, 15, 15),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.surface,
              AppColors.surfaceRose,
              Color(0xFFF0F8F5),
            ],
          ),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .14),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.silver,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(height: 14),
            Container(
              width: 48,
              height: 48,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pinkSoft,
              ),
              child: const Icon(
                Icons.logout_rounded,
                size: 20,
                color: AppColors.danger,
              ),
            ),
            const SizedBox(height: 9),
            const Text(
              'Sign out of Voxidence?',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Your local session will be removed from this device.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 8,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(true),
                    icon: const Icon(Icons.logout_rounded, size: 14),
                    label: const Text('Sign out'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.danger,
                    ),
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

String _mediaUrl(String value) {
  final trimmed = value.trim();

  if (trimmed.isEmpty) {
    return '';
  }

  final uri = Uri.tryParse(trimmed);

  if (uri != null && uri.hasScheme) {
    return trimmed;
  }

  return '${ApiConfig.baseUrl}'
      '${trimmed.startsWith('/') ? '' : '/'}'
      '$trimmed';
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();

  if (parts.isEmpty) {
    return 'V';
  }

  if (parts.length == 1) {
    return parts.first.substring(0, 1).toUpperCase();
  }

  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}
