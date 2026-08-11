// Voxidence mobile login screen.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../widgets/auth_shell.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();

  final _email = TextEditingController();

  final _password = TextEditingController();

  bool _rememberMe = false;
  bool _obscure = true;
  bool _submitting = false;

  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final session = await AuthApi.instance.login(
        email: _email.text.trim(),
        password: _password.text,
        rememberMe: _rememberMe,
      );

      if (!mounted) return;

      final user = session['user'];

      final role = user is Map
          ? (user['role']?.toString().toUpperCase() ?? '')
          : '';

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            backgroundColor: AppColors.primaryDeep,
            content: Text(
              role == 'ADMIN'
                  ? 'Signed in as administrator.'
                  : 'Signed in successfully.',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        );
    } on AuthException catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error.message;
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  void _forgotPassword() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text('Password recovery routing can be connected here.'),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return AuthShell(
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
                  const SizedBox(height: 20),

                  AuthField(
                    controller: _email,
                    label: 'Email address',
                    hint: 'you@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    validator: (value) {
                      final text = value?.trim() ?? '';

                      final valid = RegExp(
                        r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                      ).hasMatch(text);

                      return valid ? null : 'Enter a valid email address.';
                    },
                  ),

                  const SizedBox(height: 13),

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
                      InkWell(
                        onTap: _forgotPassword,
                        borderRadius: BorderRadius.circular(8),
                        child: const Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: 3,
                            vertical: 2,
                          ),
                          child: Text(
                            'Forgot password?',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 6),

                  TextFormField(
                    controller: _password,
                    obscureText: _obscure,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) {
                      if (!_submitting) {
                        _submit();
                      }
                    },
                    validator: (value) {
                      if ((value ?? '').isEmpty) {
                        return 'Enter your password.';
                      }

                      return null;
                    },
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                    decoration: InputDecoration(
                      hintText: 'Enter your password',
                      prefixIcon: const Icon(
                        Icons.lock_outline_rounded,
                        size: 18,
                      ),
                      suffixIcon: IconButton(
                        tooltip: _obscure ? 'Show password' : 'Hide password',
                        onPressed: () {
                          setState(() {
                            _obscure = !_obscure;
                          });
                        },
                        icon: Icon(
                          _obscure
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                          size: 18,
                          color: AppColors.primaryDark,
                        ),
                      ),
                      isDense: true,
                    ),
                  ),

                  const SizedBox(height: 11),

                  Row(
                    children: [
                      SizedBox(
                        width: 20,
                        height: 20,
                        child: Checkbox(
                          value: _rememberMe,
                          activeColor: AppColors.primary,
                          side: const BorderSide(color: AppColors.borderStrong),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(5),
                          ),
                          onChanged: (value) {
                            setState(() {
                              _rememberMe = value ?? false;
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: 7),
                      const Text(
                        'Keep me signed in',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.5,
                        ),
                      ),
                      const Spacer(),
                      const Icon(
                        Icons.lock_rounded,
                        size: 12,
                        color: AppColors.pink,
                      ),
                      const SizedBox(width: 4),
                      const Text(
                        'Secure session',
                        style: TextStyle(
                          color: AppColors.pink,
                          fontSize: 9.2,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 11),
                    AuthErrorBox(message: _error!),
                  ],

                  const SizedBox(height: 16),

                  AuthPrimaryButton(
                    label: 'Sign in to Voxidence',
                    onPressed: _submit,
                    loading: _submitting,
                  ),

                  const SizedBox(height: 12),

                  AuthSwitchPrompt(
                    text: 'New to Voxidence?',
                    action: 'Create an account',
                    onPressed: () {
                      Navigator.pushReplacementNamed(context, '/register');
                    },
                  ),

                  const SizedBox(height: 15),

                  Container(height: 1, color: AppColors.border),

                  const SizedBox(height: 13),

                  const AuthSecurityLine(
                    text:
                        'Protected credentials. Private ideas. Secure workspace.',
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
