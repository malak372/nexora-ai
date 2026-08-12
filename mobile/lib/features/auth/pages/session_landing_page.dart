import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../session/auth_session_store.dart';

/// Lightweight authenticated landing page.
///
/// This page is temporary until the final user/admin shells
/// are merged into the mobile application.
///
/// @author Eman
class SessionLandingPage extends StatefulWidget {
  const SessionLandingPage({super.key, required this.admin});

  final bool admin;

  @override
  State<SessionLandingPage> createState() => _SessionLandingPageState();
}

class _SessionLandingPageState extends State<SessionLandingPage> {
  Map<String, dynamic>? _user;

  bool _loading = true;

  bool _loggingOut = false;

  @override
  void initState() {
    super.initState();

    _loadUser();
  }

  Future<void> _loadUser() async {
    final user = await AuthSessionStore.instance.getUser();

    if (!mounted) {
      return;
    }

    setState(() {
      _user = user;
      _loading = false;
    });
  }

  Future<void> _logout() async {
    if (_loggingOut) {
      return;
    }

    setState(() {
      _loggingOut = true;
    });

    await AuthApi.instance.logout();

    if (!mounted) {
      return;
    }

    Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final name = _user?['fullName']?.toString().trim();

    final email = _user?['email']?.toString().trim();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.admin ? 'Admin workspace' : 'Your workspace'),
        actions: [
          TextButton.icon(
            onPressed: _loggingOut ? null : _logout,
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: Text(_loggingOut ? 'Signing out...' : 'Sign out'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Icon(
                        widget.admin
                            ? Icons.admin_panel_settings_rounded
                            : Icons.verified_user_rounded,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      name == null || name.isEmpty
                          ? 'Signed in successfully'
                          : 'Welcome, $name',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      email == null || email.isEmpty
                          ? 'Your authenticated mobile session is connected to the Voxidence backend.'
                          : '$email is authenticated and connected to the Voxidence backend.',
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'This lightweight landing page is only a bridge for the current branch. Replace it with the final user/admin shell when that feature is merged.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 12.5,
                        height: 1.5,
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
  }
}
