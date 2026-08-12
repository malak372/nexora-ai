import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/pages/forgot_password_page.dart';
import 'features/auth/pages/legal_page.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/auth/pages/reset_password_page.dart';
import 'features/auth/pages/session_landing_page.dart';
import 'features/auth/session/auth_session_store.dart';
import 'features/guest_idea/pages/guest_generate_idea_page.dart';
import 'features/home/pages/home_page.dart';
import 'features/home/pages/public_publication_details_page.dart';

/// Application entry point.
///
/// Initializes Flutter bindings, loads environment variables,
/// restores the authentication session, determines the correct
/// initial route, and starts the Voxidence application.
///
/// @author Eman
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await dotenv.load(fileName: '.env');

  await AuthSessionStore.instance.prepareForLaunch();

  var initialRoute = '/';

  if (await AuthSessionStore.instance.hasSession()) {
    final user = await AuthSessionStore.instance.getUser();

    final role = user?['role']?.toString().trim().toUpperCase() ?? '';

    initialRoute = role == 'ADMIN' ? '/admin/dashboard' : '/normal/dashboard';
  }

  runApp(VoxidenceApp(initialRoute: initialRoute));
}

/// Root widget of the Voxidence mobile application.
///
/// Configures application routing, theme, navigation, and incoming
/// deep-link handling.
///
/// The [initialRoute] is resolved during application startup based
/// on the current authentication session.
///
/// @author Eman
class VoxidenceApp extends StatefulWidget {
  const VoxidenceApp({super.key, this.initialRoute = '/'});

  final String initialRoute;

  @override
  State<VoxidenceApp> createState() => _VoxidenceAppState();
}

/// State controller for [VoxidenceApp].
///
/// Manages the global navigator and listens for incoming application
/// links, including password-reset deep links.
///
/// @author Eman
class _VoxidenceAppState extends State<VoxidenceApp> {
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  final AppLinks _appLinks = AppLinks();

  StreamSubscription<Uri>? _linkSubscription;

  @override
  void initState() {
    super.initState();

    _configureDeepLinks();
  }

  /// Initializes password-reset deep links for both cold and warm app starts.
  Future<void> _configureDeepLinks() async {
    try {
      final initialUri = await _appLinks.getInitialLink();

      if (initialUri != null) {
        _handleIncomingLink(initialUri);
      }
    } catch (_) {
      // The app can continue normally when no initial link is available.
    }

    _linkSubscription = _appLinks.uriLinkStream.listen(
      _handleIncomingLink,
      onError: (_) {
        // Invalid external links must not interrupt normal navigation.
      },
    );
  }

  @override
  void dispose() {
    _linkSubscription?.cancel();

    super.dispose();
  }

  /// Handles incoming application links.
  ///
  /// Password-reset links are detected using either the URI path
  /// or host. When a reset link is received, its token is extracted
  /// and forwarded to the password-reset route.
  void _handleIncomingLink(Uri uri) {
    final isResetLink =
        uri.path == '/reset-password' || uri.host == 'reset-password';

    if (!isResetLink) {
      return;
    }

    final token = uri.queryParameters['token']?.trim() ?? '';

    final encodedToken = Uri.encodeQueryComponent(token);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _navigatorKey.currentState?.pushNamedAndRemoveUntil(
        '/reset-password?token=$encodedToken',
        (_) => false,
      );
    });
  }

  /// Generates routes that require custom URL parsing.
  ///
  /// Used for:
  /// - Password reset routes with query tokens.
  /// - Public publication details routes with a publication ID.
  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    final uri = Uri.tryParse(settings.name ?? '');

    if (uri == null) {
      return null;
    }

    // Password reset route:
    // /reset-password?token=...
    if (uri.path == '/reset-password') {
      return MaterialPageRoute(
        settings: settings,
        builder: (_) =>
            ResetPasswordPage(token: uri.queryParameters['token'] ?? ''),
      );
    }

    // Public publication route:
    // /publications/:publicationId
    if (uri.pathSegments.length == 2 &&
        uri.pathSegments.first == 'publications') {
      final publicationId = uri.pathSegments[1].trim();

      if (publicationId.isNotEmpty) {
        return MaterialPageRoute(
          settings: settings,
          builder: (_) =>
              PublicPublicationDetailsPage(publicationId: publicationId),
        );
      }
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigatorKey,
      title: 'Voxidence',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      initialRoute: widget.initialRoute,
      onGenerateRoute: _onGenerateRoute,
      routes: {
        '/': (_) => const HomePage(),

        '/login': (_) => const LoginPage(),

        '/register': (_) => const RegisterPage(),

        '/terms': (_) => const LegalPage.terms(),

        '/privacy': (_) => const LegalPage.privacy(),

        '/security': (_) => const LegalPage.security(),

        '/forgot-password': (_) => const ForgotPasswordPage(),

        '/reset-password': (_) => const ResetPasswordPage(token: ''),

        '/generate': (_) => const GuestGenerateIdeaPage(),

        '/normal/dashboard': (_) => const SessionLandingPage(admin: false),

        '/admin/dashboard': (_) => const SessionLandingPage(admin: true),
      },
    );
  }
}
