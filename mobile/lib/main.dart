import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
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

/// Application entry point.
///
/// Initializes Flutter bindings, loads environment variables,
/// restores the application environment, and starts Voxidence.
///
/// The application bootstrap later determines whether the user
/// already has an authenticated mobile session.
///
/// @author Eman
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await dotenv.load(
      fileName: '.env',
    );
  } catch (_) {
    // Keep development builds usable when .env is not bundled.
    // ApiConfig provides safe development defaults.
  }

  runApp(
    const VoxidenceApp(),
  );
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
  const VoxidenceApp({
    super.key,
  });

  @override
  State<VoxidenceApp> createState() =>
      _VoxidenceAppState();
}

/// State controller for [VoxidenceApp].
///
/// Listens for incoming application links and forwards them
/// to the correct mobile route.
///
/// @author Eman
class _VoxidenceAppState
    extends State<VoxidenceApp> {
  final AppLinks _appLinks =
      AppLinks();

  StreamSubscription<Uri>?
      _linkSubscription;

  @override
  void initState() {
    super.initState();

    _configureDeepLinks();
  }

  /// Configures deep links for both:
  /// - Cold application launches.
  /// - Links received while the app is already running.
  Future<void> _configureDeepLinks() async {
    try {
      final initialUri =
          await _appLinks.getInitialLink();

      if (initialUri != null) {
        _handleIncomingLink(
          initialUri,
        );
      }
    } catch (_) {
      // The app can continue normally when no initial link exists.
    }

    _linkSubscription =
        _appLinks.uriLinkStream.listen(
      _handleIncomingLink,
      onError: (_) {
        // Invalid external links must not interrupt app navigation.
      },
    );
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
  void _handleIncomingLink(
    Uri uri,
  ) {
    final isResetLink =
        uri.path ==
            '/reset-password' ||
        uri.host ==
            'reset-password';

    if (!isResetLink) {
      return;
    }

    final token =
        uri.queryParameters['token']
                ?.trim() ??
            '';

    if (token.isEmpty) {
      return;
    }

    final encodedToken =
        Uri.encodeQueryComponent(
      token,
    );

    WidgetsBinding.instance
        .addPostFrameCallback(
      (_) {
        AppNavigator.navigatorKey
            .currentState
            ?.pushNamedAndRemoveUntil(
          '/reset-password?token=$encodedToken',
          (_) => false,
        );
      },
    );
  }

  /// Generates dynamic routes.
  ///
  /// Handles routes that contain:
  /// - Query parameters.
  /// - Idea IDs.
  /// - Publication IDs.
  /// - Generation run IDs.
  /// - Password-reset tokens.
  Route<dynamic>? _onGenerateRoute(
    RouteSettings settings,
  ) {
    final rawName =
        settings.name;

    if (rawName == null ||
        rawName.trim().isEmpty) {
      return null;
    }

    final uri =
        Uri.tryParse(
      rawName,
    );

    if (uri == null) {
      return null;
    }

    final segments =
        uri.pathSegments;

    Widget? page;

    // ------------------------------------------------------------
    // Password reset
    // /reset-password?token=...
    // ------------------------------------------------------------

    if (uri.path ==
        '/reset-password') {
      page = ResetPasswordPage(
        token:
            uri.queryParameters[
                    'token'] ??
                '',
      );
    }

    // ------------------------------------------------------------
    // Email verification
    // /verify-email?email=...
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 1 &&
        segments[0] ==
            'verify-email') {
      page = VerifyEmailPage(
        email:
            uri.queryParameters[
                    'email'] ??
                '',
      );
    }

    // ------------------------------------------------------------
    // Public publication
    // /publications/:publicationId
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 2 &&
        segments[0] ==
            'publications') {
      final publicationId =
          segments[1].trim();

      if (publicationId.isNotEmpty) {
        page =
            PublicPublicationDetailsPage(
          publicationId:
              publicationId,
        );
      }
    }

    // ------------------------------------------------------------
    // Normal-user static routes with optional query parameters.
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 2 &&
        segments[0] ==
            'normal') {
      switch (segments[1]) {
        case 'dashboard':
          page =
              const UserShell(
            initialIndex: 0,
          );
          break;

        case 'discover':
          page =
              const UserShell(
            initialIndex: 1,
          );
          break;

        case 'generate':
          page = UserShell(
            initialIndex: 2,
            initialGenerateProblem:
                uri.queryParameters[
                    'problem'],
          );
          break;

        case 'ideas':
          final view =
              uri.queryParameters[
                      'view']
                  ?.toLowerCase();

          page = UserShell(
            initialIndex: 3,
            initialLibraryTab:
                view == 'accepted'
                    ? 4
                    : view ==
                            'favorites'
                        ? 5
                        : 0,
          );
          break;

        case 'accepted':
          page =
              const UserShell(
            initialIndex: 3,
            initialLibraryTab: 4,
          );
          break;

        case 'favorites':
          page =
              const UserShell(
            initialIndex: 3,
            initialLibraryTab: 5,
          );
          break;

        case 'published':
          page =
              const PublishedPage();
          break;

        case 'compliance':
        case 'support':
          page =
              const CompliancePage();
          break;

        case 'notifications':
          page =
              const NotificationsPage();
          break;

        case 'billing':
          page =
              const BillingPage();
          break;

        case 'preferences':
          page =
              const PreferencesPage();
          break;

        case 'credits':
          page =
              const CreditsPage();
          break;
      }
    }

    // ------------------------------------------------------------
    // Profile settings
    // /normal/settings/profile
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 3 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'settings' &&
        segments[2] ==
            'profile') {
      page =
          const ProfileSettingsPage();
    }

    // ------------------------------------------------------------
    // Generation progress
    // /normal/generation/:runId
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 3 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'generation') {
      page =
          GenerationProgressPage(
        runId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Idea workspace
    // /normal/ideas/:ideaId
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 3 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'ideas') {
      page =
          IdeaWorkspacePage(
        ideaId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Business model
    // /normal/ideas/:ideaId/business-model
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 4 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'ideas' &&
        segments[3] ==
            'business-model') {
      page =
          BusinessModelPage(
        ideaId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Premium AI chat
    // /normal/ideas/:ideaId/chat
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 4 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'ideas' &&
        segments[3] ==
            'chat') {
      page =
          PremiumChatPage(
        ideaId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Direct idea unlock
    // /normal/ideas/:ideaId/unlock
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 4 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'ideas' &&
        segments[3] ==
            'unlock') {
      page =
          DirectUnlockPage(
        ideaId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Publish idea
    // /normal/ideas/:ideaId/publish
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 4 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'ideas' &&
        segments[3] ==
            'publish') {
      page =
          PublishIdeaPage(
        ideaId: segments[2],
      );
    }

    // ------------------------------------------------------------
    // Discover publication
    // /normal/discover/:publicationId
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 3 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'discover') {
      page =
          PublicationPage(
        publicationId:
            segments[2],
      );
    }

    // ------------------------------------------------------------
    // Accepted publication workspace
    // /normal/accepted/:publicationId/workspace
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 4 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'accepted' &&
        segments[3] ==
            'workspace') {
      page =
          AcceptedIdeaWorkspacePage(
        publicationId:
            segments[2],
      );
    }

    // ------------------------------------------------------------
    // Payment result
    // /normal/payments/success
    // ------------------------------------------------------------

    if (page == null &&
        segments.length == 3 &&
        segments[0] ==
            'normal' &&
        segments[1] ==
            'payments' &&
        segments[2] ==
            'success') {
      page =
          PaymentResultPage(
        paymentId:
            uri.queryParameters[
                'paymentId'],
        ideaId:
            uri.queryParameters[
                'ideaId'],
        publicationId:
            uri.queryParameters[
                'publicationId'],
      );
    }

    if (page == null) {
      return null;
    }

    return MaterialPageRoute<dynamic>(
      settings: settings,
      builder: (_) => page!,
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return MaterialApp(
      navigatorKey:
          AppNavigator.navigatorKey,
      title: 'Voxidence',
      debugShowCheckedModeBanner:
          false,
      theme: AppTheme.light,

      routes: {
        '/': (_) =>
            const _AppBootstrap(),

        '/home': (_) =>
            const HomePage(),

        '/login': (_) =>
            const LoginPage(),

        '/register': (_) =>
            const RegisterPage(),

        '/forgot-password': (_) =>
            const ForgotPasswordPage(),

        '/terms': (_) =>
            const LegalPage.terms(),

        '/privacy': (_) =>
            const LegalPage.privacy(),

        '/security': (_) =>
            const LegalPage.security(),

        '/generate': (_) =>
            const GuestGenerateIdeaPage(),

        '/workspace': (_) =>
            const UserShell(),

        '/normal': (_) =>
            const UserShell(
          initialIndex: 0,
        ),

        '/normal/dashboard': (_) =>
            const UserShell(
          initialIndex: 0,
        ),

        '/normal/discover': (_) =>
            const UserShell(
          initialIndex: 1,
        ),

        '/normal/generate': (_) =>
            const UserShell(
          initialIndex: 2,
        ),

        '/normal/ideas': (_) =>
            const UserShell(
          initialIndex: 3,
        ),

        '/normal/accepted': (_) =>
            const UserShell(
          initialIndex: 3,
          initialLibraryTab: 4,
        ),

        '/normal/favorites': (_) =>
            const UserShell(
          initialIndex: 3,
          initialLibraryTab: 5,
        ),

        '/normal/settings/profile': (_) =>
            const ProfileSettingsPage(),

        '/normal/preferences': (_) =>
            const PreferencesPage(),

        '/normal/notifications': (_) =>
            const NotificationsPage(),

        '/normal/billing': (_) =>
            const BillingPage(),

        '/normal/credits': (_) =>
            const CreditsPage(),

        '/normal/compliance': (_) =>
            const CompliancePage(),

        '/normal/support': (_) =>
            const CompliancePage(),

        '/normal/published': (_) =>
            const PublishedPage(),

        '/premium/dashboard': (_) =>
            const UserShell(
          initialIndex: 0,
        ),

        '/premium/credits': (_) =>
            const CreditsPage(),
      },

      onGenerateRoute:
          _onGenerateRoute,

      onUnknownRoute:
          (settings) =>
              MaterialPageRoute<void>(
        settings: settings,
        builder: (_) =>
            const HomePage(),
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
class _AppBootstrap
    extends StatefulWidget {
  const _AppBootstrap();

  @override
  State<_AppBootstrap> createState() =>
      _AppBootstrapState();
}

class _AppBootstrapState
    extends State<_AppBootstrap> {
  late final Future<bool>
      _hasSession =
      SessionStore.instance
          .hasAccessToken();

  @override
  Widget build(
    BuildContext context,
  ) {
    return FutureBuilder<bool>(
      future: _hasSession,
      builder:
          (
        context,
        snapshot,
      ) {
        if (!snapshot.hasData) {
          return const Scaffold(
            backgroundColor:
                AppColors.background,
            body: Center(
              child:
                  CircularProgressIndicator(
                color:
                    AppColors.primary,
              ),
            ),
          );
        }

        if (snapshot.data == true) {
          return const UserShell();
        }

        return const HomePage();
      },
    );
  }
}