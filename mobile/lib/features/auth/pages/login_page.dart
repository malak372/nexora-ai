// Voxidence mobile login screen.
//
// Connected directly to POST /auth/login and the authenticated
// mobile user workspace.
//
// Includes:
// - Email and password validation.
// - Valid email-format feedback.
// - Remember-me support.
// - Temporary account-lock countdown.
// - Password visibility toggle.
// - Forgot-password navigation.
// - Direct authenticated-user workspace navigation.
//
// @author Eman

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../user/pages/user_shell.dart';
import '../api/auth_api.dart';
import '../validation/auth_validators.dart';
import '../widgets/auth_shell.dart';
import 'forgot_password_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.initialEmail});

  final String? initialEmail;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();

  final _emailFieldKey = GlobalKey<FormFieldState<String>>();

  final _passwordFieldKey = GlobalKey<FormFieldState<String>>();

  late final TextEditingController _email;

  final _password = TextEditingController();

  bool _emailTouched = false;
  bool _passwordTouched = false;

  bool _rememberMe = false;
  bool _obscure = true;
  bool _submitting = false;

  String? _error;
  String? _errorTitle;

  String _errorType = 'error';

  int? _remainingLockSeconds;

  DateTime? _lockDeadline;

  Timer? _lockTimer;
  Timer? _lockDurationMessageTimer;

  bool _showInitialLockDuration = false;

  int? _lockDurationMinutes;

  bool get _locked => (_remainingLockSeconds ?? 0) > 0;

  bool get _emailFormatValid =>
      _emailTouched && AuthValidators.loginEmail(_email.text) == null;

  @override
  void initState() {
    super.initState();

    _email = TextEditingController(text: widget.initialEmail ?? '');
  }

  @override
  void dispose() {
    _lockTimer?.cancel();
    _lockDurationMessageTimer?.cancel();

    _email.dispose();
    _password.dispose();

    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (_submitting || _locked) {
      return;
    }

    setState(() {
      _emailTouched = true;
      _passwordTouched = true;
    });

    final emailValid = _emailFieldKey.currentState?.validate() ?? false;

    final passwordValid = _passwordFieldKey.currentState?.validate() ?? false;

    if (!emailValid || !passwordValid) {
      return;
    }

    setState(() {
      _submitting = true;

      _error = null;
      _errorTitle = null;
      _errorType = 'error';
    });

    try {
      final result = await AuthApi.instance.login(
        email: _email.text,
        password: _password.text,
        rememberMe: _rememberMe,
      );

      if (!mounted) {
        return;
      }

      final rawUser = result['user'];

      final user = rawUser is Map
          ? Map<String, dynamic>.from(rawUser)
          : <String, dynamic>{};

      final role = user['role']?.toString().trim().toUpperCase() ?? '';

      if (role == 'ADMIN') {
        await AuthApi.instance.logout();

        if (!mounted) {
          return;
        }

        setState(() {
          _error =
              'Admin accounts should use the web administration workspace.';
          _errorTitle = 'Admin account';
          _errorType = 'warning';
        });

        return;
      }

      Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
        MaterialPageRoute<void>(builder: (_) => const UserShell()),
        (route) => false,
      );
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = error.message;
        _errorTitle = error.title;
        _errorType = error.type;
      });

      if (error.isLocked) {
        _lockDurationMinutes = error.lockDurationMinutes;

        _showInitialLockDuration = error.justLocked;

        _startLockCountdown(error);

        _lockDurationMessageTimer?.cancel();

        if (error.justLocked) {
          _lockDurationMessageTimer = Timer(
            const Duration(milliseconds: 4500),
            () {
              if (!mounted) {
                return;
              }

              setState(() {
                _showInitialLockDuration = false;
              });
            },
          );
        }
      }
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error =
            'Sign in succeeded partially, but the app could not open your workspace. Please try again.';
        _errorTitle = 'Unable to continue';
        _errorType = 'error';
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  void _clearLocalAccountLock() {
    _lockTimer?.cancel();
    _lockDurationMessageTimer?.cancel();

    _remainingLockSeconds = 0;
    _lockDeadline = null;

    _showInitialLockDuration = false;
    _lockDurationMinutes = null;

    _error = null;
    _errorTitle = null;
    _errorType = 'error';
  }

  void _startLockCountdown(AuthException error) {
    _lockTimer?.cancel();

    final parsedDeadline = error.lockedUntil == null
        ? null
        : DateTime.tryParse(error.lockedUntil!)?.toLocal();

    final seconds = error.remainingSeconds;

    _lockDeadline =
        parsedDeadline ??
        (seconds != null && seconds > 0
            ? DateTime.now().add(Duration(seconds: seconds))
            : null);

    if (_lockDeadline == null) {
      return;
    }

    void update() {
      if (!mounted || _lockDeadline == null) {
        return;
      }

      final remaining = _lockDeadline!.difference(DateTime.now()).inSeconds + 1;

      if (remaining <= 0) {
        _lockTimer?.cancel();

        setState(() {
          _remainingLockSeconds = 0;

          _error = null;
          _errorTitle = null;

          _lockDeadline = null;

          _showInitialLockDuration = false;
          _lockDurationMinutes = null;
        });

        return;
      }

      setState(() {
        _remainingLockSeconds = remaining;
      });
    }

    update();

    _lockTimer = Timer.periodic(const Duration(seconds: 1), (_) => update());
  }

  String _formatCountdown(int totalSeconds) {
    final safe = totalSeconds < 0 ? 0 : totalSeconds;

    final hours = safe ~/ 3600;
    final minutes = (safe % 3600) ~/ 60;
    final seconds = safe % 60;

    String two(int value) {
      return value.toString().padLeft(2, '0');
    }

    return '${two(hours)}:${two(minutes)}:${two(seconds)}';
  }

  String _formatLockDuration(int? totalMinutes) {
    final value = totalMinutes ?? 1;

    final safeMinutes = value < 1 ? 1 : value;

    if (safeMinutes < 60) {
      return '$safeMinutes '
          '${safeMinutes == 1 ? 'minute' : 'minutes'}';
    }

    final hours = safeMinutes ~/ 60;

    final remainingMinutes = safeMinutes % 60;

    final hoursText = '$hours ${hours == 1 ? 'hour' : 'hours'}';

    if (remainingMinutes == 0) {
      return hoursText;
    }

    return '$hoursText and '
        '$remainingMinutes '
        '${remainingMinutes == 1 ? 'minute' : 'minutes'}';
  }

  void _openForgotPassword() {
    if (_submitting || _locked) {
      return;
    }

    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => ForgotPasswordPage(initialEmail: _email.text.trim()),
      ),
    );
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

                  const SizedBox(height: 20),

                  AuthField(
                    formFieldKey: _emailFieldKey,
                    controller: _email,
                    label: 'Email address',
                    hint: 'name@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [
                      AutofillHints.username,
                      AutofillHints.email,
                    ],

                    // Keep the email field active even when the
                    // previous account is temporarily locked.
                    enabled: !_submitting,

                    validState: _emailFormatValid,
                    validLabel: 'Valid format',
                    onFocusChanged: (hasFocus) {
                      if (!hasFocus && !_emailTouched) {
                        setState(() {
                          _emailTouched = true;
                        });

                        _emailFieldKey.currentState?.validate();
                      }
                    },
                    onChanged: (_) {
                      // Account lock belongs to the previous email.
                      // As soon as the user changes the email,
                      // allow signing in with another account.
                      if (_locked) {
                        setState(_clearLocalAccountLock);
                      }

                      if (_emailTouched) {
                        _emailFieldKey.currentState?.validate();
                      }

                      if (_error != null) {
                        setState(() {
                          _error = null;
                          _errorTitle = null;
                        });
                      } else if (_emailTouched) {
                        setState(() {});
                      }
                    },
                    validator: AuthValidators.loginEmail,
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

                      InkWell(
                        onTap: _submitting || _locked
                            ? null
                            : _openForgotPassword,
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

                  Focus(
                    onFocusChange: (hasFocus) {
                      if (!hasFocus && !_passwordTouched) {
                        setState(() {
                          _passwordTouched = true;
                        });

                        _passwordFieldKey.currentState?.validate();
                      }
                    },
                    child: TextFormField(
                      key: _passwordFieldKey,
                      controller: _password,
                      enabled: !_submitting && !_locked,
                      obscureText: _obscure,
                      textInputAction: TextInputAction.done,
                      autofillHints: const [AutofillHints.password],
                      onChanged: (_) {
                        if (_passwordTouched) {
                          _passwordFieldKey.currentState?.validate();
                        }

                        if (_error != null && !_locked) {
                          setState(() {
                            _error = null;
                            _errorTitle = null;
                          });
                        }
                      },
                      onFieldSubmitted: (_) {
                        if (!_submitting && !_locked) {
                          _submit();
                        }
                      },
                      validator: AuthValidators.loginPassword,
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
                          onPressed: _submitting || _locked
                              ? null
                              : () {
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
                  ),

                  const SizedBox(height: 12),

                  Row(
                    children: [
                      SizedBox(
                        width: 23,
                        height: 23,
                        child: Checkbox(
                          value: _rememberMe,
                          activeColor: AppColors.primary,
                          side: const BorderSide(color: AppColors.borderStrong),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(5),
                          ),
                          onChanged: _submitting || _locked
                              ? null
                              : (value) {
                                  setState(() {
                                    _rememberMe = value ?? false;
                                  });
                                },
                        ),
                      ),

                      const SizedBox(width: 7),

                      const Expanded(
                        child: Text(
                          'Keep me signed in',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 10.5,
                          ),
                        ),
                      ),

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
                          fontSize: 9.3,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 11),
                    _LoginFeedback(
                      title: _errorTitle,
                      message: _locked
                          ? _showInitialLockDuration
                                ? 'Your account has been locked for '
                                      '${_formatLockDuration(_lockDurationMinutes)}. '
                                      'Unlocks in '
                                      '${_formatCountdown(_remainingLockSeconds ?? 0)}.'
                                : 'Unlocks in '
                                      '${_formatCountdown(_remainingLockSeconds ?? 0)}.'
                          : _error!,
                      type: _errorType,
                    ),
                  ],

                  const SizedBox(height: 15),

                  AuthPrimaryButton(
                    label: _locked
                        ? 'Locked · '
                              '${_formatCountdown(_remainingLockSeconds ?? 0)}'
                        : 'Sign in to Voxidence',
                    loading: _submitting,
                    onPressed: _submitting || _locked ? null : _submit,
                  ),

                  const SizedBox(height: 15),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text(
                        'New to Voxidence? ',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 10.8,
                        ),
                      ),
                      InkWell(
                        onTap: _submitting
                            ? null
                            : () {
                                Navigator.pushNamed(context, '/register');
                              },
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
                      Icon(
                        Icons.shield_outlined,
                        size: 13,
                        color: AppColors.pink,
                      ),
                      SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'Protected credentials · Private ideas · Secure workspace',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.2,
                          ),
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

class _LoginFeedback extends StatelessWidget {
  const _LoginFeedback({required this.message, required this.type, this.title});

  final String message;
  final String type;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final warning = type == 'warning';
    final locked = type == 'locked';

    final background = warning
        ? const Color(0xFFFFF8E8)
        : locked
        ? const Color(0xFFFFF2F5)
        : AppColors.pinkSoft;

    final foreground = warning
        ? const Color(0xFF8B6822)
        : const Color(0xFF9F4F61);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: foreground.withValues(alpha: 0.22)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            locked
                ? Icons.lock_clock_outlined
                : warning
                ? Icons.warning_amber_rounded
                : Icons.error_outline_rounded,
            size: 16,
            color: foreground,
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null && title!.trim().isNotEmpty) ...[
                  Text(
                    title!,
                    style: TextStyle(
                      color: foreground,
                      fontSize: 10.2,
                      fontWeight: FontWeight.w900,
                    ),
                  ),

                  const SizedBox(height: 3),
                ],

                Text(
                  message,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 9.8,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
