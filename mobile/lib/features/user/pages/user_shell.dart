// Modern authenticated mobile shell shared by Normal and Premium accounts.
// The center generation action intentionally matches the compact floating
// bulb used by the Voxidence mobile reference instead of a large FAB.
//
// @author Eman

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/api/auth_api.dart';
import '../../home/widgets/common.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import '../widgets/workspace_navigation.dart';
import 'account_page.dart';
import 'dashboard_page.dart';
import 'discover_page.dart';
import 'generate_idea_page.dart';
import 'library_page.dart';

class UserShell extends StatefulWidget {
  const UserShell({
    super.key,
    this.initialIndex = 0,
    this.initialLibraryTab = 0,
    this.initialGenerateProblem,
  });

  final int initialIndex;
  final int initialLibraryTab;
  final String? initialGenerateProblem;

  @override
  State<UserShell> createState() => _UserShellState();
}

class _UserShellState extends State<UserShell> {
  late int _index;
  final _controller = UserSessionController.instance;

  bool _premiumCelebrationCheckRunning = false;
  bool _signingOut = false;

  final List<Widget?> _pages = List<Widget?>.filled(5, null);

  Widget _createPage(int index) {
    return switch (index) {
      0 => DashboardPage(
          onOpenGenerate: () => _setIndex(2),
          onOpenLibrary: () => _setIndex(3),
          onOpenDiscover: () => _setIndex(1),
        ),
      1 => const DiscoverPage(),
      2 => GenerateIdeaPage(
          initialProblem: widget.initialGenerateProblem,
          onGenerationStarted: _handleGenerationStarted,
          onExit: () => _setIndex(0),
        ),
      3 => LibraryPage(initialTab: widget.initialLibraryTab),
      4 => const AccountPage(),
      _ => const SizedBox.shrink(),
    };
  }

  void _ensurePage(int index) {
    if (index < 0 || index >= _pages.length || _pages[index] != null) return;
    _pages[index] = _createPage(index);
  }

  /// Warms only the two most frequently opened list screens after the first
  /// frame. Requests are sequential and cached, so this does not flood the
  /// backend like broad eager-prefetching, while Discover/My Ideas usually
  /// open from memory when the user taps them.
  Future<void> _warmCommonScreens() async {
    await Future<void>.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;

    if (_index != 3) {
      try {
        await UserApi.instance.getMyIdeas(page: 1, limit: 18);
      } catch (_) {
        // Prefetch is opportunistic and must never surface as a UI error.
      }
    }

    await Future<void>.delayed(const Duration(milliseconds: 180));
    if (!mounted) return;

    if (_index != 1) {
      try {
        await UserApi.instance.getDiscoveries(page: 1, limit: 12);
      } catch (_) {
        // The screen will retry normally if the user opens it later.
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex.clamp(0, 4).toInt();
    _ensurePage(_index);

    _controller.addListener(_handleSessionChanged);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_controller.summary == null) {
        _controller.load();
      } else {
        _handleSessionChanged();
      }

      unawaited(_warmCommonScreens());
    });
  }

  @override
  void dispose() {
    _controller.removeListener(_handleSessionChanged);
    super.dispose();
  }

  /// Watches the hydrated/fresh account summary and triggers the Premium
  /// welcome once per authenticated session.
  ///
  /// The session controller resets this flag on logout, so Premium users get
  /// the celebration again on their next sign-in, matching the web behavior.
  void _handleSessionChanged() {
    final summary = _controller.summary;
    if (!mounted ||
        summary == null ||
        !summary.isPremium ||
        summary.id.isEmpty) {
      return;
    }

    if (_premiumCelebrationCheckRunning || !_controller.canShowPremiumWelcome) {
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _maybeShowPremiumCelebration();
    });
  }

  Future<void> _maybeShowPremiumCelebration() async {
    if (!mounted || _premiumCelebrationCheckRunning) return;

    final summary = _controller.summary;
    if (summary == null || !summary.isPremium || summary.id.isEmpty) {
      return;
    }

    // consumePremiumWelcome() guarantees exactly one celebration per login
    // session and is reset by UserSessionController.reset() on logout.
    if (!_controller.consumePremiumWelcome()) return;

    _premiumCelebrationCheckRunning = true;

    try {
      await showGeneralDialog<void>(
        context: context,
        barrierDismissible: true,
        barrierLabel: 'Premium welcome',
        barrierColor: Colors.transparent,
        transitionDuration: const Duration(milliseconds: 260),
        pageBuilder: (context, animation, secondaryAnimation) {
          return _PremiumCelebration(fullName: summary.fullName);
        },
        transitionBuilder: (context, animation, secondaryAnimation, child) {
          final curved = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );

          return FadeTransition(
            opacity: animation,
            child: ScaleTransition(
              scale: Tween<double>(begin: .992, end: 1).animate(curved),
              child: child,
            ),
          );
        },
      );
    } finally {
      _premiumCelebrationCheckRunning = false;
    }
  }

  void _setIndex(int value) {
    if (value == 2) {
      // Generation entitlement changes after free runs, credit purchases,
      // upgrades, and unlock flows. Always refresh it when Generate opens.
      unawaited(_controller.load(force: true));
    }

    _ensurePage(value);
    if (_index == value) return;
    setState(() => _index = value);
  }

  void _handleGenerationStarted() {
    _controller.load(force: true);
  }

  String get _currentReturnTitle {
    return switch (_index) {
      0 => 'Home',
      1 => 'Discover',
      2 => 'Generate',
      3 => 'My ideas',
      4 => 'Profile',
      _ => 'Home',
    };
  }

  String get _currentReturnRoute {
    return switch (_index) {
      0 => '/normal/dashboard',
      1 => '/normal/discover',
      2 => '/normal/generate',
      3 => '/normal/ideas',
      4 => '/normal/profile',
      _ => '/normal/dashboard',
    };
  }

  Future<void> _pushWorkspaceRoute(String routeName) async {
    await Navigator.of(context).pushNamed(
      routeName,
      arguments: <String, String>{
        'returnTitle': _currentReturnTitle,
        'returnRoute': _currentReturnRoute,
      },
    );
    if (mounted) _controller.load(force: true);
  }

  Future<void> _signOutFromWorkspace() async {
    if (_signingOut) return;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => const _WorkspaceSignOutSheet(),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _signingOut = true);

    try {
      try {
        await AuthApi.instance.logout();
      } catch (_) {
        await SessionStore.instance.clear();
      }

      ApiClient.instance.clearCache();
      UserSessionController.instance.reset();

      if (!mounted) return;

      Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  Future<void> _openMenu() async {
    final summary = _controller.summary;

    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      useSafeArea: true,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .16),
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: .76,
          minChildSize: .52,
          maxChildSize: .88,
          expand: false,
          builder: (context, scrollController) {
            return Container(
              margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
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
                controller: scrollController,
                physics: const BouncingScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(15, 9, 15, 22),
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.silver.withValues(alpha: .85),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.fromLTRB(12, 11, 11, 11),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.primarySoft.withValues(alpha: .58),
                          Colors.white.withValues(alpha: .88),
                          AppColors.surfaceRose.withValues(alpha: .42),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: AppColors.border.withValues(alpha: .86),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .86),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: AppColors.primary.withValues(alpha: .10),
                            ),
                          ),
                          child: const Icon(
                            Icons.grid_view_rounded,
                            size: 19,
                            color: AppColors.primaryDark,
                          ),
                        ),
                        const SizedBox(width: 10),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Workspace menu',
                                style: TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 15.4,
                                  height: 1.05,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: -.25,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Quick access to account tools',
                                style: TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 8.6,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        AccountTierBadge(
                          isPremium: summary?.isPremium == true,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 15),
                  const Padding(
                    padding: EdgeInsets.only(left: 2, bottom: 8),
                    child: Text(
                      'ACCOUNT TOOLS',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.05,
                      ),
                    ),
                  ),
                  _MenuGrid(
                    unread: summary?.unreadNotificationsCount ?? 0,
                    onTap: (value) => Navigator.pop(sheetContext, value),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft.withValues(alpha: .56),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: .09),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .76),
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: Icon(
                            summary?.isPremium == true
                                ? Icons.bolt_rounded
                                : Icons.eco_outlined,
                            color: AppColors.primaryDark,
                            size: 16,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            summary?.isPremium == true
                                ? '${summary?.creditBalance ?? 0} Premium credits available'
                                : '${summary?.remainingFreeGenerations ?? 0} free idea generations remaining',
                            style: const TextStyle(
                              color: AppColors.primaryDeep,
                              fontSize: 9.2,
                              height: 1.25,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    if (!mounted || action == null) return;
    switch (action) {
      case 'home':
        _setIndex(0);
        break;
      case 'discover':
        _setIndex(1);
        break;
      case 'generate':
        _setIndex(2);
        break;
      case 'ideas':
        _setIndex(3);
        break;
      case 'profile':
        _setIndex(4);
        break;
      case 'notifications':
        await _pushWorkspaceRoute('/normal/notifications');
        break;
      case 'published':
        await _pushWorkspaceRoute('/normal/published');
        break;
      case 'credits':
        await _pushWorkspaceRoute('/normal/credits');
        break;
      case 'billing':
        await _pushWorkspaceRoute('/normal/billing');
        break;
      case 'preferences':
        await _pushWorkspaceRoute('/normal/preferences');
        break;
      case 'compliance':
        await _pushWorkspaceRoute('/normal/compliance');
        break;
      case 'security':
        await _pushWorkspaceRoute('/normal/settings/profile');
        break;
      case 'signout':
        await _signOutFromWorkspace();
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final summary = _controller.summary;
        return Scaffold(
          extendBody: true,
          backgroundColor: AppColors.background,
          body: WorkspaceBackground(
            child: SafeArea(
              bottom: false,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 9, 18, 7),
                    child: Row(
                      children: [
                        const BrandMark(size: 40),
                        const SizedBox(width: 9),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Voxidence',
                                style: TextStyle(
                                  color: AppColors.primaryDeep,
                                  fontSize: 17.2,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: -.45,
                                ),
                              ),
                              SizedBox(height: 1),
                              Text(
                                'Real voices. Better ideas.',
                                style: TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 8.4,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        AccountTierBadge(isPremium: summary?.isPremium == true),
                        const SizedBox(width: 7),
                        Material(
                          color: Colors.white.withValues(alpha: .78),
                          borderRadius: BorderRadius.circular(14),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: _openMenu,
                            child: Container(
                              width: 40,
                              height: 40,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Badge(
                                isLabelVisible:
                                    (summary?.unreadNotificationsCount ?? 0) >
                                    0,
                                backgroundColor: AppColors.pink,
                                smallSize: 7,
                                child: const Icon(
                                  Icons.menu_rounded,
                                  color: AppColors.primaryDeep,
                                  size: 20,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
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
          bottomNavigationBar: PersistentWorkspaceBottomNav(
            selected: switch (_index) {
              0 => WorkspaceSection.home,
              1 => WorkspaceSection.discover,
              2 => WorkspaceSection.generate,
              3 => WorkspaceSection.ideas,
              4 => WorkspaceSection.profile,
              _ => null,
            },
            onSelected: (section) {
              final nextIndex = switch (section) {
                WorkspaceSection.home => 0,
                WorkspaceSection.discover => 1,
                WorkspaceSection.generate => 2,
                WorkspaceSection.ideas => 3,
                WorkspaceSection.profile => 4,
              };
              _setIndex(nextIndex);
            },
          ),
        );
      },
    );
  }
}

/// One-time Premium welcome overlay.
///
/// The seen flag is persisted per user, so this appears when a user first
/// enters a Premium workspace without interrupting every later visit.

class _PremiumCelebration extends StatefulWidget {
  const _PremiumCelebration({required this.fullName});

  final String fullName;

  @override
  State<_PremiumCelebration> createState() => _PremiumCelebrationState();
}

class _PremiumCelebrationState extends State<_PremiumCelebration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 4000),
  )..forward();

  @override
  void initState() {
    super.initState();

    Future<void>.delayed(const Duration(milliseconds: 4000), () {
      if (mounted) {
        Navigator.of(context).maybePop();
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double _interval(double begin, double end) {
    final value = _controller.value;
    if (value <= begin) return 0;
    if (value >= end) return 1;
    return Curves.easeOutCubic.transform(
      ((value - begin) / (end - begin)).clamp(0.0, 1.0),
    );
  }

  @override
  Widget build(BuildContext context) {
    final displayName = widget.fullName.trim();
    final size = MediaQuery.sizeOf(context);
    final cardHeight = math.min(420.0, size.height - 64);

    return Material(
      color: Colors.transparent,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => Navigator.of(context).maybePop(),
              child: BackdropFilter(
                filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                child: Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        const Color(0xFFF2DDE2).withValues(alpha: .22),
                        const Color(0xFFDCEBE6).withValues(alpha: .24),
                        const Color(0xFFD9E1DE).withValues(alpha: .34),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) => CustomPaint(
                  painter: _PremiumOuterConfettiPainter(
                    progress: _controller.value,
                  ),
                ),
              ),
            ),
          ),

          SafeArea(
            child: Center(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) {
                  final enter = _interval(0.0, .12);
                  return Opacity(
                    opacity: enter,
                    child: Transform.translate(
                      offset: Offset(0, 20 * (1 - enter)),
                      child: Transform.scale(
                        scale: .975 + (.025 * enter),
                        child: GestureDetector(
                          onTap: () {},
                          child: Container(
                            width: math.min(size.width - 34, 410),
                            height: cardHeight,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(25),
                              color: const Color(0xFFFFFDFA),
                              border: Border.all(
                                color: const Color(0xFFD6D9D6),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(
                                    0xFF4D5D58,
                                  ).withValues(alpha: .14),
                                  blurRadius: 48,
                                  offset: const Offset(0, 22),
                                ),
                              ],
                            ),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(25),
                              child: Stack(
                                alignment: Alignment.center,
                                children: [
                                  Positioned(
                                    left: -90,
                                    bottom: -100,
                                    child: _PremiumGlow(
                                      size: 205,
                                      color: const Color(
                                        0xFFF3D6DC,
                                      ).withValues(alpha: .54),
                                    ),
                                  ),
                                  Positioned(
                                    right: -88,
                                    bottom: -98,
                                    child: _PremiumGlow(
                                      size: 205,
                                      color: const Color(
                                        0xFFD8EAE2,
                                      ).withValues(alpha: .58),
                                    ),
                                  ),
                                  Positioned.fill(
                                    child: Padding(
                                      padding: const EdgeInsets.all(9),
                                      child: DecoratedBox(
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(
                                            19,
                                          ),
                                          border: Border.all(
                                            color: const Color(0xFFDDE0DC),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  Positioned.fill(
                                    child: IgnorePointer(
                                      child: CustomPaint(
                                        painter: _PremiumInnerSparklePainter(
                                          progress: _controller.value,
                                        ),
                                      ),
                                    ),
                                  ),
                                  Positioned(
                                    top: 14,
                                    right: 14,
                                    child: Material(
                                      color: Colors.transparent,
                                      child: InkWell(
                                        borderRadius: BorderRadius.circular(
                                          999,
                                        ),
                                        onTap: () =>
                                            Navigator.of(context).maybePop(),
                                        child: Container(
                                          width: 38,
                                          height: 38,
                                          alignment: Alignment.center,
                                          decoration: BoxDecoration(
                                            shape: BoxShape.circle,
                                            gradient: const LinearGradient(
                                              begin: Alignment.topLeft,
                                              end: Alignment.bottomRight,
                                              colors: [
                                                Color(0xFFF8FDFC),
                                                Color(0xFFE7F5F2),
                                              ],
                                            ),
                                            border: Border.all(
                                              color: AppColors.primary
                                                  .withValues(alpha: .34),
                                            ),
                                            boxShadow: [
                                              BoxShadow(
                                                color: AppColors.primary
                                                    .withValues(alpha: .08),
                                                blurRadius: 15,
                                                offset: const Offset(0, 5),
                                              ),
                                            ],
                                          ),
                                          child: const Icon(
                                            Icons.close_rounded,
                                            size: 17,
                                            color: AppColors.primaryDark,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      20,
                                      50,
                                      20,
                                      34,
                                    ),
                                    child: Column(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Opacity(
                                          opacity: _interval(.03, .12),
                                          child: Transform.translate(
                                            offset: Offset(
                                              0,
                                              10 * (1 - _interval(.03, .12)),
                                            ),
                                            child: Container(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 14,
                                                    vertical: 8,
                                                  ),
                                              decoration: BoxDecoration(
                                                borderRadius:
                                                    BorderRadius.circular(999),
                                                gradient: const LinearGradient(
                                                  begin: Alignment.topLeft,
                                                  end: Alignment.bottomRight,
                                                  colors: [
                                                    Color(0xFFF6FCFB),
                                                    Color(0xFFE0F2EF),
                                                  ],
                                                ),
                                                border: Border.all(
                                                  color: AppColors.primary
                                                      .withValues(alpha: .42),
                                                ),
                                                boxShadow: [
                                                  BoxShadow(
                                                    color: AppColors.primary
                                                        .withValues(alpha: .10),
                                                    blurRadius: 18,
                                                    offset: const Offset(0, 6),
                                                  ),
                                                ],
                                              ),
                                              child: const Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Icon(
                                                    Icons
                                                        .workspace_premium_outlined,
                                                    size: 14,
                                                    color:
                                                        AppColors.primaryDark,
                                                  ),
                                                  SizedBox(width: 8),
                                                  Text(
                                                    'PREMIUM WORKSPACE',
                                                    style: TextStyle(
                                                      color:
                                                          AppColors.primaryDark,
                                                      fontSize: 8.3,
                                                      fontWeight:
                                                          FontWeight.w900,
                                                      letterSpacing: 1.2,
                                                    ),
                                                  ),
                                                  SizedBox(width: 8),
                                                  Icon(
                                                    Icons.auto_awesome_rounded,
                                                    size: 13,
                                                    color:
                                                        AppColors.primaryDark,
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 14),
                                        _PremiumWelcomeTitle(
                                          progress: _controller.value,
                                        ),
                                        const SizedBox(height: 16),
                                        Opacity(
                                          opacity: _interval(.17, .26),
                                          child: _PremiumDivider(
                                            progress: _interval(.17, .26),
                                          ),
                                        ),
                                        const SizedBox(height: 16),
                                        Opacity(
                                          opacity: _interval(.20, .29),
                                          child: Transform.translate(
                                            offset: Offset(
                                              0,
                                              10 * (1 - _interval(.20, .29)),
                                            ),
                                            child: const Text(
                                              'Your premium workspace is ready.',
                                              textAlign: TextAlign.center,
                                              style: TextStyle(
                                                color: AppColors.primaryDark,
                                                fontSize: 13.2,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                        ),
                                        if (displayName.isNotEmpty) ...[
                                          const SizedBox(height: 19),
                                          Opacity(
                                            opacity: _interval(.22, .31),
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                const Text(
                                                  '✦',
                                                  style: TextStyle(
                                                    color: AppColors.pinkDeep,
                                                    fontSize: 11,
                                                  ),
                                                ),
                                                const SizedBox(width: 9),
                                                Flexible(
                                                  child: Text(
                                                    displayName.toUpperCase(),
                                                    maxLines: 1,
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                    textAlign: TextAlign.center,
                                                    style: const TextStyle(
                                                      color: AppColors.pinkDeep,
                                                      fontSize: 11.2,
                                                      fontWeight:
                                                          FontWeight.w900,
                                                      letterSpacing: 1.7,
                                                    ),
                                                  ),
                                                ),
                                                const SizedBox(width: 9),
                                                const Text(
                                                  '✦',
                                                  style: TextStyle(
                                                    color: AppColors.pinkDeep,
                                                    fontSize: 11,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PremiumWelcomeTitle extends StatelessWidget {
  const _PremiumWelcomeTitle({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    const text = 'Welcome Back';

    return Wrap(
      alignment: WrapAlignment.center,
      spacing: 0,
      runSpacing: 0,
      children: List<Widget>.generate(text.length, (index) {
        final start = .07 + (index * .011);
        final end = start + .10;
        final local = progress <= start
            ? 0.0
            : progress >= end
            ? 1.0
            : Curves.easeOutCubic.transform(
                ((progress - start) / (end - start)).clamp(0.0, 1.0),
              );

        final character = text[index];

        return ClipRect(
          child: Transform.translate(
            offset: Offset(0, 43 * (1 - local)),
            child: Opacity(
              opacity: local,
              child: Text(
                character == ' ' ? '\u00A0' : character,
                style: const TextStyle(
                  color: AppColors.primary,
                  fontFamily: 'Georgia',
                  fontSize: 35,
                  height: .98,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -1.15,
                  shadows: [
                    Shadow(
                      color: Color(0x2462BAB5),
                      blurRadius: 16,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}

class _PremiumDivider extends StatelessWidget {
  const _PremiumDivider({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 178 * progress,
      height: 12,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.transparent,
                  AppColors.primary.withValues(alpha: .75),
                  Colors.transparent,
                ],
              ),
            ),
          ),
          Transform.rotate(
            angle: math.pi / 4,
            child: Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                color: const Color(0xFF8FBEB5),
                borderRadius: BorderRadius.circular(2),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: .16),
                    blurRadius: 8,
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

class _PremiumGlow extends StatelessWidget {
  const _PremiumGlow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

class _PremiumOuterConfettiPainter extends CustomPainter {
  const _PremiumOuterConfettiPainter({required this.progress});

  final double progress;

  static const _palette = <Color>[
    Color(0xFF79ADA5),
    Color(0xFFEFBDC8),
    Color(0xFFB8D2C7),
    Color(0xFFFFFDF8),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < 42; i++) {
      final delay = .09 + ((i % 10) * .012);
      final duration = .44 + ((i % 6) * .028);
      final local = ((progress - delay) / duration).clamp(0.0, 1.0);

      if (local <= 0 || local >= 1) continue;

      final baseX = ((i * 17 + 4) % 100) / 100;
      final drift = ((i % 9) - 4) * 5.0;
      final sway = math.sin((local * math.pi * 4) + i) * (7 + (i % 5));
      final x = (baseX * size.width) + (drift * local) + sway;
      final y = (-28.0) + ((size.height + 60) * local);

      final fadeIn = (local / .07).clamp(0.0, 1.0);
      final fadeOut = ((1 - local) / .12).clamp(0.0, 1.0);
      final opacity = math.min(fadeIn, fadeOut);
      final color = _palette[i % _palette.length].withValues(
        alpha: opacity * .95,
      );

      final pieceSize = 4.5 + ((i % 5) * 1.15);
      final shape = i % 3;

      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(((i * 53) % 360) * math.pi / 180 + local * math.pi * 4);

      final paint = Paint()..color = color;

      if (shape == 1) {
        canvas.drawCircle(Offset.zero, pieceSize * .55, paint);
      } else if (shape == 2) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: Offset.zero,
              width: pieceSize * .42,
              height: pieceSize * 2.2,
            ),
            const Radius.circular(99),
          ),
          paint,
        );
      } else {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: Offset.zero,
              width: pieceSize,
              height: pieceSize * 1.55,
            ),
            const Radius.circular(2.5),
          ),
          paint,
        );
      }

      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _PremiumOuterConfettiPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _PremiumInnerSparklePainter extends CustomPainter {
  const _PremiumInnerSparklePainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final pulse = (math.sin(progress * math.pi * 8) + 1) / 2;

    final points = <({double x, double y, Color color, double radius})>[
      (x: .14, y: .22, color: Color(0xFF8EB6AD), radius: 4),
      (x: .23, y: .31, color: Color(0xFFB8D2C7), radius: 3),
      (x: .12, y: .50, color: Color(0xFFEFC7CF), radius: 5),
      (x: .18, y: .72, color: Color(0xFF8EB6AD), radius: 3),
      (x: .83, y: .20, color: Color(0xFFB8D2C7), radius: 4),
      (x: .89, y: .34, color: Color(0xFF8EB6AD), radius: 5),
      (x: .86, y: .58, color: Color(0xFFEFC7CF), radius: 3),
      (x: .79, y: .74, color: Color(0xFFB8D2C7), radius: 4),
    ];

    for (var i = 0; i < points.length; i++) {
      final point = points[i];
      final localPulse = (pulse + ((i % 3) * .12)).clamp(0.0, 1.0).toDouble();
      final center = Offset(size.width * point.x, size.height * point.y);
      final paint = Paint()
        ..color = point.color.withValues(alpha: .42 + localPulse * .42);

      if (i == 0 || i == 5) {
        canvas.drawRect(
          Rect.fromCenter(
            center: center,
            width: 1.6,
            height: 26 + localPulse * 8,
          ),
          paint,
        );
        canvas.drawRect(
          Rect.fromCenter(
            center: center,
            width: 26 + localPulse * 8,
            height: 1.6,
          ),
          paint,
        );
      } else {
        canvas.drawCircle(center, point.radius + (localPulse * 1.2), paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _PremiumInnerSparklePainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _MenuGrid extends StatelessWidget {
  const _MenuGrid({required this.unread, required this.onTap});

  final int unread;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final items = <_MenuEntry>[
      const _MenuEntry(
        'notifications',
        'Notifications',
        'Updates & messages',
        Icons.notifications_none_rounded,
        rose: true,
      ),
      const _MenuEntry(
        'published',
        'Published',
        'Your public ideas',
        Icons.public_rounded,
      ),
      const _MenuEntry(
        'credits',
        'Credits',
        'Premium balance',
        Icons.bolt_rounded,
      ),
      const _MenuEntry(
        'billing',
        'Billing',
        'Payments & invoices',
        Icons.receipt_long_outlined,
      ),
      const _MenuEntry(
        'preferences',
        'Preferences',
        'Personalize workspace',
        Icons.tune_rounded,
      ),
      const _MenuEntry(
        'compliance',
        'Compliance',
        'Privacy & support',
        Icons.shield_outlined,
      ),
      const _MenuEntry(
        'security',
        'Security',
        'Password & sessions',
        Icons.security_rounded,
      ),
      const _MenuEntry(
        'signout',
        'Sign out',
        'Leave this account',
        Icons.logout_rounded,
        danger: true,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 9,
        mainAxisSpacing: 9,
        mainAxisExtent: 94,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        final showUnread = item.key == 'notifications' && unread > 0;

        final baseColor = item.danger
            ? AppColors.pinkSoft.withValues(alpha: .72)
            : item.rose
            ? AppColors.surfaceRose.withValues(alpha: .68)
            : AppColors.primarySoft.withValues(alpha: .44);

        final accent = item.danger
            ? AppColors.danger
            : item.rose
            ? AppColors.pinkDeep
            : AppColors.primaryDark;

        return Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(19),
            onTap: () => onTap(item.key),
            child: Ink(
              padding: const EdgeInsets.fromLTRB(10, 9, 9, 9),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    baseColor,
                    Colors.white.withValues(alpha: .91),
                  ],
                ),
                borderRadius: BorderRadius.circular(19),
                border: Border.all(
                  color: item.danger
                      ? AppColors.pink.withValues(alpha: .17)
                      : AppColors.border.withValues(alpha: .86),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: .028),
                    blurRadius: 13,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .82),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: item.danger
                            ? AppColors.pink.withValues(alpha: .14)
                            : AppColors.primary.withValues(alpha: .09),
                      ),
                    ),
                    child: Icon(
                      item.icon,
                      size: 17,
                      color: accent,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: item.danger
                                      ? AppColors.danger
                                      : AppColors.textPrimary,
                                  fontSize: 10.4,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: -.08,
                                ),
                              ),
                            ),
                            if (showUnread)
                              Container(
                                constraints: const BoxConstraints(minWidth: 20),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 5,
                                  vertical: 3,
                                ),
                                decoration: BoxDecoration(
                                  color: AppColors.pink,
                                  borderRadius: BorderRadius.circular(99),
                                ),
                                child: Text(
                                  unread > 99 ? '99+' : '$unread',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 7,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              )
                            else
                              Icon(
                                Icons.north_east_rounded,
                                size: 11.5,
                                color: accent.withValues(alpha: .45),
                              ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          item.subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 7.25,
                            height: 1.2,
                            fontWeight: FontWeight.w600,
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
      },
    );
  }
}

class _MenuEntry {
  const _MenuEntry(
    this.key,
    this.label,
    this.subtitle,
    this.icon, {
    this.rose = false,
    this.danger = false,
  });

  final String key;
  final String label;
  final String subtitle;
  final IconData icon;
  final bool rose;
  final bool danger;
}

class _WorkspaceSignOutSheet extends StatelessWidget {
  const _WorkspaceSignOutSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .13),
              blurRadius: 34,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.silver,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 18),
            Container(
              width: 56,
              height: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pinkSoft,
                border: Border.all(
                  color: AppColors.pink.withValues(alpha: .20),
                ),
              ),
              child: const Icon(
                Icons.logout_rounded,
                color: AppColors.danger,
                size: 24,
              ),
            ),
            const SizedBox(height: 13),
            const Text(
              'Sign out of Voxidence?',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w900,
                letterSpacing: -.25,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Your saved ideas and unlocked work stay safely attached to your account.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10,
                height: 1.45,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Stay signed in'),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(true),
                    icon: const Icon(Icons.logout_rounded, size: 16),
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
