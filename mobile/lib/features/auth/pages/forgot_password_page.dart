import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../validation/auth_validators.dart';
import '../widgets/auth_shell.dart';

/// Password-recovery screen for Voxidence users.
///
/// This page allows users to request a secure password-reset link using
/// the email address connected to their account.
///
/// After a successful request, the interface switches to a confirmation
/// state informing the user that the recovery email has been sent.
///
/// @author Eman
class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key, this.initialEmail = ''});

  final String initialEmail;

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

/// State controller for [ForgotPasswordPage].
///
/// Handles form validation, password-reset requests, loading state,
/// error messages, and the successful-email-sent state.
///
/// @author Eman
class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  /// Form key used to validate the recovery email field.
  final _formKey = GlobalKey<FormState>();

  /// Controller for the user's email input.
  final _email = TextEditingController();

  /// Indicates whether the password-reset request is currently running.
  bool _submitting = false;

  /// Indicates whether the reset email request completed successfully.
  bool _sent = false;

  /// Stores a user-facing error message when the request fails.
  String? _error;

  @override
  void initState() {
    super.initState();

    _email.text = widget.initialEmail.trim();
  }

  @override
  void dispose() {
    _email.dispose();

    super.dispose();
  }

  /// Validates the form and requests a password-reset email.
  ///
  /// If the request succeeds, the page switches to the success state.
  /// Authentication-related errors are displayed through [AuthErrorBox].
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
      await AuthApi.instance.requestPasswordReset(_email.text);

      if (!mounted) {
        return;
      }

      setState(() {
        _sent = true;
      });
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

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

  @override
  Widget build(BuildContext context) {
    return AuthShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AuthBrandBar(),

          const SizedBox(height: 18),

          AuthCard(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 260),
              child: _sent ? _buildSuccess() : _buildForm(),
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the password-recovery form.
  ///
  /// The form validates the email format before sending the reset request.
  /// Existing errors are cleared when the user edits the email field.
  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        key: const ValueKey('forgot-form'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AuthEyebrow(
            label: 'ACCOUNT RECOVERY',
            icon: Icons.mark_email_read_outlined,
          ),

          const SizedBox(height: 14),

          const AuthTitle(
            title: 'Forgot your password?',
            highlight: 'Recover it securely.',
            description:
                'Enter the email connected to your Voxidence account and we will send a secure reset link.',
          ),

          const SizedBox(height: 20),

          AuthField(
            controller: _email,
            label: 'Email address',
            hint: 'name@example.com',
            icon: Icons.mail_outline_rounded,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            onChanged: (_) {
              if (_error != null) {
                setState(() {
                  _error = null;
                });
              }
            },
            validator: AuthValidators.recoveryEmail,
          ),

          if (_error != null) ...[
            const SizedBox(height: 11),

            AuthErrorBox(message: _error!),
          ],

          const SizedBox(height: 16),

          AuthPrimaryButton(
            label: 'Send reset link',
            onPressed: _submit,
            loading: _submitting,
          ),

          const SizedBox(height: 13),

          AuthSwitchPrompt(
            text: 'Remembered your password?',
            action: 'Back to sign in',
            onPressed: () {
              Navigator.pushReplacementNamed(context, '/login');
            },
          ),

          const SizedBox(height: 15),

          Container(height: 1, color: AppColors.border),

          const SizedBox(height: 13),

          const AuthSecurityLine(
            text:
                'Private response. Secure reset token. 15-minute recovery link.',
          ),
        ],
      ),
    );
  }

  /// Builds the confirmation state shown after a successful reset request.
  ///
  /// The user's normalized email is displayed together with recovery
  /// instructions and the reset-link validity period.
  Widget _buildSuccess() {
    final normalizedEmail = _email.text.trim().toLowerCase();

    return Column(
      key: const ValueKey('forgot-success'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Icon(
            Icons.mark_email_read_rounded,
            color: AppColors.primaryDark,
            size: 24,
          ),
        ),

        const SizedBox(height: 14),

        const AuthEyebrow(
          label: 'EMAIL SENT',
          icon: Icons.check_circle_outline_rounded,
        ),

        const SizedBox(height: 14),

        const Text(
          'Check your inbox',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 27,
            height: 1.05,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.8,
          ),
        ),

        const SizedBox(height: 10),

        Text.rich(
          TextSpan(
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11.7,
              height: 1.5,
            ),
            children: [
              const TextSpan(
                text: 'If an active Voxidence account is connected to ',
              ),

              TextSpan(
                text: normalizedEmail,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const TextSpan(text: ', a password reset link has been sent.'),
            ],
          ),
        ),

        const SizedBox(height: 14),

        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.borderStrong),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.schedule_rounded,
                size: 17,
                color: AppColors.primaryDark,
              ),

              SizedBox(width: 8),

              Expanded(
                child: Text(
                  'The link is valid for 15 minutes. Check your spam folder if it does not appear shortly.',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.3,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),

        SizedBox(
          width: double.infinity,
          height: 46,
          child: OutlinedButton.icon(
            onPressed: () {
              setState(() {
                _sent = false;

                _error = null;
              });
            },
            icon: const Icon(Icons.alternate_email_rounded, size: 17),
            label: const Text(
              'Use another email',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
        ),

        const SizedBox(height: 10),

        AuthSwitchPrompt(
          text: 'Ready to continue?',
          action: 'Back to sign in',
          onPressed: () {
            Navigator.pushReplacementNamed(context, '/login');
          },
        ),
      ],
    );
  }
}
