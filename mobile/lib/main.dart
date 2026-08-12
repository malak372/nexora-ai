// Voxidence Flutter application entry point.
//
// Authenticated mobile routes intentionally mirror the normal-user web paths,
// so the same concepts (ideas, billing, preferences, compliance, payments,
// published work, etc.) have a mobile destination too.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/navigation/app_navigator.dart';
import 'core/storage/session_store.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/pages/login_page.dart';
import 'features/auth/pages/register_page.dart';
import 'features/auth/pages/verify_email_page.dart';
import 'features/guest_idea/pages/guest_generate_idea_page.dart';
import 'features/home/pages/home_page.dart';
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

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // Keep development/web builds usable even when .env was not bundled.
    // ApiConfig provides safe localhost/emulator defaults.
  }
  runApp(const VoxidenceApp());
}

class VoxidenceApp extends StatelessWidget {
  const VoxidenceApp({super.key});

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
        '/generate': (_) => const GuestGenerateIdeaPage(),
        '/workspace': (_) => const UserShell(),
        '/normal': (_) => const UserShell(initialIndex: 0),
        '/normal/dashboard': (_) => const UserShell(initialIndex: 0),
        '/normal/discover': (_) => const UserShell(initialIndex: 1),
        '/normal/generate': (_) => const UserShell(initialIndex: 2),
        '/normal/ideas': (_) => const UserShell(initialIndex: 3),
        '/normal/accepted': (_) => const UserShell(initialIndex: 3, initialLibraryTab: 4),
        '/normal/favorites': (_) => const UserShell(initialIndex: 3, initialLibraryTab: 5),
        '/normal/settings/profile': (_) => const ProfileSettingsPage(),
        '/normal/preferences': (_) => const PreferencesPage(),
        '/normal/notifications': (_) => const NotificationsPage(),
        '/normal/billing': (_) => const BillingPage(),
        '/normal/credits': (_) => const CreditsPage(),
        '/normal/compliance': (_) => const CompliancePage(),
        '/normal/support': (_) => const CompliancePage(),
        '/normal/published': (_) => const PublishedPage(),
        '/premium/dashboard': (_) => const UserShell(initialIndex: 0),
        '/premium/credits': (_) => const CreditsPage(),
      },
      onGenerateRoute: _normalUserDynamicRoute,
      onUnknownRoute: (settings) => MaterialPageRoute<void>(
        settings: settings,
        builder: (_) => const HomePage(),
      ),
    );
  }
}

Route<dynamic>? _normalUserDynamicRoute(RouteSettings settings) {
  final rawName = settings.name;
  if (rawName == null || rawName.trim().isEmpty) return null;

  final uri = Uri.tryParse(rawName);
  if (uri == null) return null;
  final segments = uri.pathSegments;

  Widget? page;

  if (segments.length == 1 && segments[0] == 'verify-email') {
    page = VerifyEmailPage(
      email: uri.queryParameters['email'] ?? '',
    );
  }

  // Static workspace paths with query parameters (for example
  // /normal/credits?payment=cancelled) also arrive through onGenerateRoute.
  if (page == null && segments.length == 2 && segments[0] == 'normal') {
    switch (segments[1]) {
      case 'dashboard':
        page = const UserShell(initialIndex: 0);
        break;
      case 'discover':
        page = const UserShell(initialIndex: 1);
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

  if (page == null &&
      segments.length == 3 &&
      segments[0] == 'normal' &&
      segments[1] == 'settings' &&
      segments[2] == 'profile') {
    page = const ProfileSettingsPage();
  } else if (page == null && segments.length == 3 &&
      segments[0] == 'normal' &&
      segments[1] == 'generation') {
    page = GenerationProgressPage(runId: segments[2]);
  } else if (segments.length == 3 &&
      segments[0] == 'normal' &&
      segments[1] == 'ideas') {
    page = IdeaWorkspacePage(ideaId: segments[2]);
  } else if (segments.length == 4 &&
      segments[0] == 'normal' &&
      segments[1] == 'ideas' &&
      segments[3] == 'business-model') {
    page = BusinessModelPage(ideaId: segments[2]);
  } else if (segments.length == 4 &&
      segments[0] == 'normal' &&
      segments[1] == 'ideas' &&
      segments[3] == 'chat') {
    page = PremiumChatPage(ideaId: segments[2]);
  } else if (segments.length == 4 &&
      segments[0] == 'normal' &&
      segments[1] == 'ideas' &&
      segments[3] == 'unlock') {
    page = DirectUnlockPage(ideaId: segments[2]);
  } else if (segments.length == 4 &&
      segments[0] == 'normal' &&
      segments[1] == 'ideas' &&
      segments[3] == 'publish') {
    page = PublishIdeaPage(ideaId: segments[2]);
  } else if (segments.length == 3 &&
      segments[0] == 'normal' &&
      segments[1] == 'discover') {
    page = PublicationPage(publicationId: segments[2]);
  } else if (segments.length == 4 &&
      segments[0] == 'normal' &&
      segments[1] == 'accepted' &&
      segments[3] == 'workspace') {
    page = AcceptedIdeaWorkspacePage(publicationId: segments[2]);
  } else if (segments.length == 3 &&
      segments[0] == 'normal' &&
      segments[1] == 'payments' &&
      segments[2] == 'success') {
    page = PaymentResultPage(
      paymentId: uri.queryParameters['paymentId'],
      ideaId: uri.queryParameters['ideaId'],
      publicationId: uri.queryParameters['publicationId'],
    );
  }

  if (page == null) return null;
  return MaterialPageRoute<dynamic>(settings: settings, builder: (_) => page!);
}

class _AppBootstrap extends StatefulWidget {
  const _AppBootstrap();

  @override
  State<_AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends State<_AppBootstrap> {
  late final Future<bool> _hasSession = SessionStore.instance.hasAccessToken();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _hasSession,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(
            backgroundColor: AppColors.background,
            body: Center(
              child: CircularProgressIndicator(color: AppColors.primary),
            ),
          );
        }
        return snapshot.data == true ? const UserShell() : const HomePage();
      },
    );
  }
}
