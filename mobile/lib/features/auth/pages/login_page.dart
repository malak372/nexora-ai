// Voxidence mobile login screen.
// Connected directly to POST /auth/login and the authenticated workspace.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../../user/pages/user_shell.dart';
import '../api/auth_api.dart';
import '../widgets/auth_shell.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.initialEmail});

  final String? initialEmail;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _email;
  final _password = TextEditingController();

  bool _rememberMe = false;
  bool _obscure = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: widget.initialEmail ?? '');
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_submitting || !(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final result = await AuthApi.instance.login(
        email: _email.text,
        password: _password.text,
        rememberMe: _rememberMe,
      );

      if (!mounted) return;

      final rawUser = result['user'];
      final user = rawUser is Map
          ? Map<String, dynamic>.from(rawUser)
          : <String, dynamic>{};
      final role = user['role']?.toString().toUpperCase() ?? '';

      if (role == 'ADMIN') {
        await SessionStore.instance.clear();
        if (!mounted) return;
        setState(() {
          _error = 'Admin accounts should use the web administration workspace.';
        });
        return;
      }

      // Push the authenticated shell directly instead of relying on a named
      // route left underneath the auth screen. This guarantees that a
      // successful backend login actually opens the user workspace.
      Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const UserShell()),
        (route) => false,
      );
    } on AuthException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Sign in succeeded partially, but the app could not open your workspace. Please try again.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _forgotPassword() async {
    final controller = TextEditingController(text: _email.text.trim());
    final email = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Reset password'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(
            labelText: 'Email address',
            prefixIcon: Icon(Icons.mail_outline_rounded),
          ),
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Send link'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (email == null || email.isEmpty || !mounted) return;

    try {
      await AuthApi.instance.forgotPassword(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            behavior: SnackBarBehavior.floating,
            content: Text('If this email exists, password reset instructions were sent.'),
          ),
        );
    } on AuthException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthShell(
      maxWidth: 500,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AuthBrandBar(),
          const SizedBox(height: 18),
          AuthCard(
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const AuthEyebrow(label: 'WELCOME BACK'),
                  const SizedBox(height: 14),
                  const AuthTitle(
                    title: 'Continue where your',
                    highlight: 'ideas left off.',
                    description:
                        'Sign in to return to your evidence-backed ideas, discoveries, and workspace.',
                  ),
                  const SizedBox(height: 22),
                  AuthField(
                    controller: _email,
                    label: 'Email address',
                    hint: 'name@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    validator: (value) {
                      final email = value?.trim() ?? '';
                      return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)
                          ? null
                          : 'Enter a valid email address.';
                    },
                  ),
                  const SizedBox(height: 15),
                  Row(
                    children: [
                      const Text(
                        'Password',
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 11.1,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: _submitting ? null : _forgotPassword,
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(0, 28),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: const Text(
                          'Forgot password?',
                          style: TextStyle(fontSize: 10.8, fontWeight: FontWeight.w800),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  TextFormField(
                    controller: _password,
                    obscureText: _obscure,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _submit(),
                    autofillHints: const [AutofillHints.password],
                    validator: (value) => (value?.isEmpty ?? true) ? 'Enter your password.' : null,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w700,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Your password',
                      prefixIcon: const Icon(Icons.lock_outline_rounded, size: 19),
                      suffixIcon: IconButton(
                        tooltip: _obscure ? 'Show password' : 'Hide password',
                        onPressed: () => setState(() => _obscure = !_obscure),
                        icon: Icon(
                          _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                          size: 19,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      SizedBox(
                        width: 23,
                        height: 23,
                        child: Checkbox(
                          value: _rememberMe,
                          onChanged: _submitting
                              ? null
                              : (value) => setState(() => _rememberMe = value ?? false),
                        ),
                      ),
                      const SizedBox(width: 7),
                      const Expanded(
                        child: Text(
                          'Keep me signed in',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 10.8),
                        ),
                      ),
                      const Icon(Icons.lock_rounded, size: 12, color: AppColors.pink),
                      const SizedBox(width: 4),
                      const Text(
                        'Secure session',
                        style: TextStyle(
                          color: AppColors.pink,
                          fontSize: 9.3,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: .07),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.danger.withValues(alpha: .20)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.error_outline_rounded, color: AppColors.danger, size: 17),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _error!,
                              style: const TextStyle(
                                color: AppColors.danger,
                                fontSize: 10.7,
                                height: 1.35,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 15),
                  AuthPrimaryButton(
                    label: 'Sign in to Voxidence',
                    loading: _submitting,
                    onPressed: _submitting ? null : _submit,
                  ),
                  const SizedBox(height: 15),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text(
                        'New to Voxidence? ',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 10.8),
                      ),
                      InkWell(
                        onTap: _submitting ? null : () => Navigator.pushNamed(context, '/register'),
                        child: const Text(
                          'Create an account',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 10.8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Container(height: 1, color: AppColors.border),
                  const SizedBox(height: 14),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.shield_outlined, size: 13, color: AppColors.pink),
                      SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'Protected credentials · Private ideas · Secure workspace',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 9.2),
                        ),
                      ),
                    ],
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
