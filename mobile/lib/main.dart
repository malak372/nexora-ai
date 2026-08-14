import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/navigation/app_navigator.dart';
import 'core/storage/session_store.dart';
import 'core/theme/app_theme.dart';

import 'features/auth/pages/forgot_password_page.dart';
import 'features/auth/pages/legal_page.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/auth/pages/reset_password_page.dart';
import 'features/auth/pages/verify_email_page.dart';

import 'features/guest_idea/pages/guest_generate_idea_page.dart';

import 'features/home/pages/home_page.dart';
import 'features/home/pages/public_publication_details_page.dart';
import 'features/splash/pages/app_launch_experience.dart';

import 'features/user/pages/accepted_idea_workspace_page.dart';
import 'features/user/pages/billing_page.dart';
import 'features/user/pages/business_model_page.dart';
import 'features/user/pages/compliance_page.dart';
import 'features/user/pages/credits_page.dart';
import 'features/user/pages/direct_unlock_page.dart';
import 'features/user/pages/generation_progress_page.dart';
import 'features/user/pages/idea_workspace_page.dart';
import 'features/user/pages/notifications_page.dart';
import 'features/user/pages/payment_result_page.dart';
import 'features/user/pages/preferences_page.dart';
import 'features/user/pages/premium_chat_page.dart';
import 'features/user/pages/profile_settings_page.dart';
import 'features/user/pages/publication_page.dart';
import 'features/user/pages/publish_idea_page.dart';
import 'features/user/pages/published_page.dart';
import 'features/user/pages/user_shell.dart';
import 'features/user/widgets/workspace_navigation.dart';

Future<void> _appEnvironmentReady = Future<void>.value();
bool _environmentLoadStarted = false;

Future<void> _loadAppEnvironment() async {
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // Development builds remain usable when .env is not bundled.
    // ApiConfig provides platform-safe development defaults.
  }
}

Future<void> _ensureAppEnvironmentLoaded() {
  if (!_environmentLoadStarted) {
    _environmentLoadStarted = true;
    _appEnvironmentReady = _loadAppEnvironment();
  }
  return _appEnvironmentReady;
}

/// Application entry point.
///
/// Initializes Flutter bindings, loads environment variables,
/// restores the application environment, and starts Voxidence.
///
/// The application bootstrap later determines whether the user
/// already has an authenticated mobile session.
///
/// @author Eman
void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Do not touch plugins, secure storage, .env, deep links, or platform
  // channels before runApp(). On slower Android devices those calls can delay
  // Flutter's very first frame and leave the Android starting window visible.
  runApp(const VoxidenceApp());
}

/// Root widget of the Voxidence mobile application.
///
/// Configures:
/// - Global navigation.
/// - Application theme.
/// - Authentication routes.
/// - Normal-user routes.
/// - Dynamic workspace routes.
/// - Password-reset deep links.
/// - Public publication routes.
///
/// @author Eman
class VoxidenceApp extends StatefulWidget {
  const VoxidenceApp({super.key});

  @override
  State<VoxidenceApp> createState() => _VoxidenceAppState();
}

/// State controller for [VoxidenceApp].
///
/// Listens for incoming application links and forwards them
/// to the correct mobile route.
///
/// @author Eman
class _VoxidenceAppState extends State<VoxidenceApp> {
  final AppLinks _appLinks = AppLinks();

  StreamSubscription<Uri>? _linkSubscription;

  @override
  void initState() {
    super.initState();

    // Let the startup loader paint first. Only after Flutter has produced the
    // first frame do we perform platform-channel work such as app_links and
    // system UI updates.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      SystemChrome.setSystemUIOverlayStyle(
        const SystemUiOverlayStyle(
          statusBarColor: Color(0xFFEDF7F3),
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
          systemNavigationBarColor: Color(0xFFEDF7F3),
          systemNavigationBarIconBrightness: Brightness.dark,
          systemNavigationBarDividerColor: Color(0xFFEDF7F3),
          systemStatusBarContrastEnforced: false,
          systemNavigationBarContrastEnforced: false,
        ),
      );

      unawaited(_ensureAppEnvironmentLoaded());
      unawaited(_configureDeepLinks());
    });
  }

  /// Configures deep links for both:
  /// - Cold application launches.
  /// - Links received while the app is already running.
  Future<void> _configureDeepLinks() async {
    /*
     * Listen first so a link received while the app is finishing its cold
     * startup cannot fall into the gap between getInitialLink() and stream
     * subscription.
     */
    _linkSubscription = _appLinks.uriLinkStream.listen(
      _handleIncomingLink,
      onError: (_) {
        // Invalid external links must not interrupt app navigation.
      },
    );

    try {
      final initialUri = await _appLinks.getInitialLink();

      if (initialUri != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _handleIncomingLink(initialUri);
        });
      }
    } catch (_) {
      // The app can continue normally when no initial link exists.
    }
  }

  @override
  void dispose() {
    _linkSubscription?.cancel();

    super.dispose();
  }

  /// Handles external links received by the application.
  ///
  /// Password-reset links may arrive as:
  ///
  /// voxidence://reset-password?token=...
  ///
  /// or using a path containing `/reset-password`.
  void _handleIncomingLink(Uri uri) {
    final isPaymentSuccess =
        uri.path == '/mobile/payments/success' ||
        (uri.host == 'payment' && uri.path == '/success') ||
        uri.host == 'payment-success';

    if (isPaymentSuccess) {
      final paymentId = uri.queryParameters['paymentId']?.trim() ?? '';
      if (paymentId.isEmpty) return;

      final target = Uri(
        path: '/normal/payments/success',
        queryParameters: <String, String>{
          'paymentId': paymentId,
          if ((uri.queryParameters['ideaId']?.trim() ?? '').isNotEmpty)
            'ideaId': uri.queryParameters['ideaId']!.trim(),
          if ((uri.queryParameters['publicationId']?.trim() ?? '').isNotEmpty)
            'publicationId': uri.queryParameters['publicationId']!.trim(),
        },
      );

      _runWhenNavigatorReady(
        () => AppNavigator.navigatorKey.currentState!.pushNamed(
          target.toString(),
        ),
      );
      return;
    }

    final isResetLink =
        uri.path == '/reset-password' || uri.host == 'reset-password';

    if (!isResetLink) return;

    final token = uri.queryParameters['token']?.trim() ?? '';
    if (token.isEmpty) return;

    final encodedToken = Uri.encodeQueryComponent(token);

    _runWhenNavigatorReady(
      () => AppNavigator.navigatorKey.currentState!.pushNamedAndRemoveUntil(
        '/reset-password?token=$encodedToken',
        (_) => false,
      ),
    );
  }

  /// Runs navigation after MaterialApp has attached the global navigator.
  ///
  /// Cold-start custom-scheme links may arrive before the first frame. A small
  /// bounded retry avoids silently losing password-reset/payment links.
  void _runWhenNavigatorReady(
    VoidCallback navigation, {
    int attempt = 0,
    bool environmentReady = false,
  }) {
    if (!mounted) return;

    if (!environmentReady) {
      unawaited(
        _ensureAppEnvironmentLoaded().whenComplete(() {
          if (!mounted) return;
          _runWhenNavigatorReady(
            navigation,
            attempt: attempt,
            environmentReady: true,
          );
        }),
      );
      return;
    }

    if (AppNavigator.navigatorKey.currentState != null) {
      navigation();
      return;
    }

    if (attempt >= 100) return;

    Future<void>.delayed(const Duration(milliseconds: 50), () {
      if (!mounted) return;
      _runWhenNavigatorReady(
        navigation,
        attempt: attempt + 1,
        environmentReady: true,
      );
    });
  }

  /// Resolves the persistent mobile workspace tab for a standalone route.
  WorkspaceSection? _workspaceSectionFor(Uri uri) {
    final segments = uri.pathSegments;
    if (segments.length < 2 || segments.first != 'normal') return null;

    if (segments[1] == 'payments') {
      final hasIdeaContext =
          (uri.queryParameters['ideaId']?.trim() ?? '').isNotEmpty;
      final hasPublicationContext =
          (uri.queryParameters['publicationId']?.trim() ?? '').isNotEmpty;

      return hasIdeaContext || hasPublicationContext
          ? WorkspaceSection.ideas
          : WorkspaceSection.profile;
    }

    return switch (segments[1]) {
      'discover' => WorkspaceSection.discover,
      'generation' => WorkspaceSection.generate,
      'ideas' || 'accepted' || 'published' => WorkspaceSection.ideas,
      'profile' ||
      'settings' ||
      'preferences' ||
      'notifications' ||
      'billing' ||
      'credits' ||
      'compliance' ||
      'support' => WorkspaceSection.profile,
      _ => null,
    };
  }

  bool _shouldWrapWorkspaceRoute(Uri uri, Widget page) {
    return uri.pathSegments.isNotEmpty &&
        uri.pathSegments.first == 'normal' &&
        page is! UserShell;
  }

  /// Generates dynamic routes containing query parameters and resource IDs.
  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    final rawName = settings.name;

    if (rawName == null || rawName.trim().isEmpty) {
      return null;
    }

    final uri = Uri.tryParse(rawName);

    if (uri == null) {
      return null;
    }

    final segments = uri.pathSegments;

    Widget? page;

    // Password reset
    // /reset-password?token=...

    if (uri.path == '/reset-password') {
      page = ResetPasswordPage(token: uri.queryParameters['token'] ?? '');
    }

    
    // Email verification
    // /verify-email?email=...
    

    if (page == null && segments.length == 1 && segments[0] == 'verify-email') {
      page = VerifyEmailPage(email: uri.queryParameters['email'] ?? '');
    }

    
    // Public publication
    // /publications/:publicationId
    

    if (page == null && segments.length == 2 && segments[0] == 'publications') {
      final publicationId = segments[1].trim();

      if (publicationId.isNotEmpty) {
        page = PublicPublicationDetailsPage(publicationId: publicationId);
      }
    }

    
    // Normal-user static routes with optional query parameters.
    

    if (page == null && segments.length == 2 && segments[0] == 'normal') {
      switch (segments[1]) {
        case 'dashboard':
          page = const UserShell(initialIndex: 0);
          break;

        case 'discover':
          page = const UserShell(initialIndex: 1);
          break;

        case 'profile':
          page = const UserShell(initialIndex: 4);
          break;

        case 'generate':
          page = UserShell(
            initialIndex: 2,
            initialGenerateProblem: uri.queryParameters['problem'],
          );
          break;

        case 'ideas':
          final view = uri.queryParameters['view']?.toLowerCase();

          page = UserShell(
            initialIndex: 3,
            initialLibraryTab: view == 'accepted'
                ? 4
                : view == 'favorites'
                ? 5
                : 0,
          );
          break;

        case 'accepted':
          page = const UserShell(initialIndex: 3, initialLibraryTab: 4);
          break;

        case 'favorites':
          page = const UserShell(initialIndex: 3, initialLibraryTab: 5);
          break;

        case 'published':
          page = const PublishedPage();
          break;

        case 'compliance':
        case 'support':
          page = const CompliancePage();
          break;

        case 'notifications':
          page = const NotificationsPage();
          break;

        case 'billing':
          page = const BillingPage();
          break;

        case 'preferences':
          page = const PreferencesPage();
          break;

        case 'credits':
          page = const CreditsPage();
          break;
      }
    }

    
    // Profile settings
    // /normal/settings/profile
    

    if (page == null &&
        segments.length == 3 &&
        segments[0] == 'normal' &&
        segments[1] == 'settings' &&
        segments[2] == 'profile') {
      page = const ProfileSettingsPage();
    }

    
    // Generation progress
    // /normal/generation/:runId
    

    if (page == null &&
        segments.length == 3 &&
        segments[0] == 'normal' &&
        segments[1] == 'generation') {
      page = GenerationProgressPage(runId: segments[2]);
    }

    
    // Idea workspace
    // /normal/ideas/:ideaId
    

    if (page == null &&
        segments.length == 3 &&
        segments[0] == 'normal' &&
        segments[1] == 'ideas') {
      page = IdeaWorkspacePage(ideaId: segments[2]);
    }

    
    // Business model
    // /normal/ideas/:ideaId/business-model
    

    if (page == null &&
        segments.length == 4 &&
        segments[0] == 'normal' &&
        segments[1] == 'ideas' &&
        segments[3] == 'business-model') {
      page = BusinessModelPage(ideaId: segments[2]);
    }

    
    // Premium AI chat
    // /normal/ideas/:ideaId/chat
    

    if (page == null &&
        segments.length == 4 &&
        segments[0] == 'normal' &&
        segments[1] == 'ideas' &&
        segments[3] == 'chat') {
      page = PremiumChatPage(ideaId: segments[2]);
    }

    
    // Direct idea unlock
    // /normal/ideas/:ideaId/unlock
    

    if (page == null &&
        segments.length == 4 &&
        segments[0] == 'normal' &&
        segments[1] == 'ideas' &&
        segments[3] == 'unlock') {
      page = DirectUnlockPage(ideaId: segments[2]);
    }

    
    // Publish idea
    // /normal/ideas/:ideaId/publish
    

    if (page == null &&
        segments.length == 4 &&
        segments[0] == 'normal' &&
        segments[1] == 'ideas' &&
        segments[3] == 'publish') {
      final routeArgs = settings.arguments is Map
          ? Map<String, dynamic>.from(settings.arguments as Map)
          : const <String, dynamic>{};
      final returnTitle = routeArgs['returnTitle']?.toString().trim();

      page = PublishIdeaPage(
        ideaId: segments[2],
        returnTitle: returnTitle == null || returnTitle.isEmpty
            ? 'My ideas'
            : returnTitle,
      );
    }

    
    // Discover publication
    // /normal/discover/:publicationId
    

    if (page == null &&
        segments.length == 3 &&
        segments[0] == 'normal' &&
        segments[1] == 'discover') {
      page = PublicationPage(publicationId: segments[2]);
    }

    
    // Accepted publication workspace
    // /normal/accepted/:publicationId/workspace
    

    if (page == null &&
        segments.length == 4 &&
        segments[0] == 'normal' &&
        segments[1] == 'accepted' &&
        segments[3] == 'workspace') {
      page = AcceptedIdeaWorkspacePage(publicationId: segments[2]);
    }

    
    // Payment result
    // /normal/payments/success
    

    if (page == null &&
        segments.length == 3 &&
        segments[0] == 'normal' &&
        segments[1] == 'payments' &&
        segments[2] == 'success') {
      page = PaymentResultPage(
        paymentId: uri.queryParameters['paymentId'],
        ideaId: uri.queryParameters['ideaId'],
        publicationId: uri.queryParameters['publicationId'],
      );
    }

    if (page == null) {
      return null;
    }

    if (_shouldWrapWorkspaceRoute(uri, page)) {
      page = WorkspaceRouteFrame(
        selected: _workspaceSectionFor(uri),
        child: page,
      );
    }

    return MaterialPageRoute<dynamic>(
      settings: settings,
      builder: (_) => page!,
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: AppNavigator.navigatorKey,
      title: 'Voxidence',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,

      routes: {
        '/': (_) => const _AppBootstrap(),

        '/home': (_) => const HomePage(),

        '/login': (_) => const LoginPage(),

        '/register': (_) => const RegisterPage(),

        '/forgot-password': (_) => const ForgotPasswordPage(),

        '/terms': (_) => const LegalPage.terms(),

        '/privacy': (_) => const LegalPage.privacy(),

        '/security': (_) => const LegalPage.security(),

        '/generate': (_) => const GuestGenerateIdeaPage(),

        '/workspace': (_) => const UserShell(),

        '/normal': (_) => const UserShell(initialIndex: 0),

        '/normal/dashboard': (_) => const UserShell(initialIndex: 0),

        '/normal/discover': (_) => const UserShell(initialIndex: 1),

        '/normal/generate': (_) => const UserShell(initialIndex: 2),

        '/normal/ideas': (_) => const UserShell(initialIndex: 3),

        '/normal/profile': (_) => const UserShell(initialIndex: 4),

        '/normal/accepted': (_) =>
            const UserShell(initialIndex: 3, initialLibraryTab: 4),

        '/normal/favorites': (_) =>
            const UserShell(initialIndex: 3, initialLibraryTab: 5),

        '/normal/settings/profile': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: ProfileSettingsPage(),
        ),

        '/normal/preferences': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: PreferencesPage(),
        ),

        '/normal/notifications': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: NotificationsPage(),
        ),

        '/normal/billing': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: BillingPage(),
        ),

        '/normal/credits': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: CreditsPage(),
        ),

        '/normal/compliance': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: CompliancePage(),
        ),

        '/normal/support': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: CompliancePage(),
        ),

        '/normal/published': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.ideas,
          child: PublishedPage(),
        ),

        '/premium/dashboard': (_) => const UserShell(initialIndex: 0),

        '/premium/credits': (_) => const WorkspaceRouteFrame(
          selected: WorkspaceSection.profile,
          child: CreditsPage(),
        ),
      },

      onGenerateRoute: _onGenerateRoute,

      onUnknownRoute: (settings) => MaterialPageRoute<void>(
        settings: settings,
        builder: (_) => const HomePage(),
      ),
    );
  }
}

/// Determines the correct first screen after application startup.
///
/// Users with an existing authenticated mobile session are sent directly
/// to the normal-user workspace. Guests are sent to the public home page.
///
/// @author Eman
class _AppBootstrap extends StatefulWidget {
  const _AppBootstrap();

  @override
  State<_AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends State<_AppBootstrap> {
  final Completer<bool> _bootstrapCompleter = Completer<bool>();
  bool _bootstrapStarted = false;

  @override
  void initState() {
    super.initState();

    // Critical startup rule: paint AppLaunchExperience once before any plugin
    // call. Secure storage and asset/plugin work starts only after that frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _startBootstrap();
    });
  }

  void _startBootstrap() {
    if (_bootstrapStarted) return;
    _bootstrapStarted = true;

    unawaited(() async {
      try {
        final authenticated = await _resolveBootstrap();
        if (!_bootstrapCompleter.isCompleted) {
          _bootstrapCompleter.complete(authenticated);
        }
      } catch (_) {
        if (!_bootstrapCompleter.isCompleted) {
          _bootstrapCompleter.complete(false);
        }
      }
    }());
  }

  Future<bool> _resolveBootstrap() async {
    // These two jobs run in parallel, but only after the first Flutter frame.
    final results = await Future.wait<dynamic>([
      _ensureAppEnvironmentLoaded(),
      SessionStore.instance.hasAccessToken(),
    ]);

    return results[1] == true;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _bootstrapCompleter.future,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const AppLaunchExperience();
        }

        return snapshot.data == true
            ? const UserShell(key: ValueKey('authenticated-workspace'))
            : const HomePage(key: ValueKey('guest-home'));
      },
    );
  }
}
