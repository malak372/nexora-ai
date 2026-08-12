import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../widgets/auth_shell.dart';

/// Password reset screen for Voxidence users.
///
/// This page allows users to choose a new password using a valid
/// password-reset token received through the account-recovery flow.
///
/// The page validates password requirements, confirms that both password
/// fields match, submits the new password to the backend, and displays
/// a success state when the reset is completed.
///
/// @author Eman
class ResetPasswordPage extends StatefulWidget {
  const ResetPasswordPage({super.key, required this.token});

  /// Password-reset token received from the recovery link.
  final String token;

  @override
  State<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

/// State controller for [ResetPasswordPage].
///
/// Handles password validation, visibility controls, request state,
/// error messages, and the successful reset state.
///
/// @author Eman
class _ResetPasswordPageState extends State<ResetPasswordPage> {
  /// Form key used to validate the password fields.
  final _formKey = GlobalKey<FormState>();

  /// Controller for the new password.
  final _password = TextEditingController();

  /// Controller for the password confirmation field.
  final _confirmPassword = TextEditingController();

  /// Controls whether the new password is visible.
  bool _showPassword = false;

  /// Controls whether the confirmation password is visible.
  bool _showConfirmPassword = false;

  /// Indicates whether the reset request is currently being submitted.
  bool _submitting = false;

  /// Indicates whether the password reset completed successfully.
  bool _complete = false;

  /// Stores a user-facing error message.
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  /// Returns `true` when the password contains at least eight characters.
  bool get _hasLength => _password.text.length >= 8;

  /// Returns `true` when the password contains at least one letter.
  bool get _hasLetter => RegExp(r'[A-Za-z]').hasMatch(_password.text);

  /// Returns `true` when the password contains at least one number.
  bool get _hasNumber => RegExp(r'\d').hasMatch(_password.text);

  /// Returns `true` when all password requirements are satisfied.
  bool get _passwordValid => _hasLength && _hasLetter && _hasNumber;

  /// Validates and submits the new password.
  ///
  /// The request is rejected locally when:
  /// - The reset token is missing.
  /// - The form contains invalid or empty fields.
  /// - The password requirements are not satisfied.
  /// - The password confirmation does not match.
  ///
  /// When the backend reset succeeds, the page switches to the
  /// password-updated confirmation state.
  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (widget.token.trim().isEmpty) {
      setState(() {
        _error = 'This reset link is missing or invalid. Request a new one.';
      });
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    if (!_passwordValid) {
      setState(() {
        _error = 'Your password must meet all requirements.';
      });
      return;
    }

    if (_password.text != _confirmPassword.text) {
      setState(() {
        _error = 'Passwords do not match.';
      });
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await AuthApi.instance.resetPassword(
        token: widget.token,
        newPassword: _password.text,
      );

      if (!mounted) {
        return;
      }

      setState(() => _complete = true);
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() => _error = error.message);
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
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
              child: _complete ? _buildComplete() : _buildForm(),
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the password-reset form.
  ///
  /// The form contains the new-password field, password requirement
  /// indicators, confirmation field, error state, and submission button.
  Widget _buildForm() {
    return Form(
      key: _formKey,
      child: Column(
        key: const ValueKey('reset-form'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const AuthEyebrow(
            label: 'FINAL RECOVERY STEP',
            icon: Icons.lock_reset_rounded,
          ),

          const SizedBox(height: 14),

          const AuthTitle(
            title: 'Set a new password.',
            highlight: 'Protect your workspace.',
            description:
                'Choose a fresh password for your Voxidence account. Active refresh sessions are revoked after a successful reset.',
          ),

          const SizedBox(height: 20),

          AuthField(
            controller: _password,
            label: 'New password',
            hint: 'Enter a new password',
            icon: Icons.lock_outline_rounded,
            textInputAction: TextInputAction.next,
            obscureText: !_showPassword,
            onChanged: (_) {
              setState(() => _error = null);
            },
            suffixIcon: IconButton(
              tooltip: _showPassword ? 'Hide password' : 'Show password',
              onPressed: () {
                setState(() => _showPassword = !_showPassword);
              },
              icon: Icon(
                _showPassword
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 18,
                color: AppColors.primaryDark,
              ),
            ),
            validator: (value) {
              if ((value ?? '').isEmpty) {
                return 'Enter a new password.';
              }

              return null;
            },
          ),

          const SizedBox(height: 10),

          _PasswordRules(
            hasLength: _hasLength,
            hasLetter: _hasLetter,
            hasNumber: _hasNumber,
          ),

          const SizedBox(height: 14),

          AuthField(
            controller: _confirmPassword,
            label: 'Confirm password',
            hint: 'Repeat your new password',
            icon: Icons.verified_user_outlined,
            textInputAction: TextInputAction.done,
            obscureText: !_showConfirmPassword,
            onChanged: (_) {
              if (_error != null) {
                setState(() => _error = null);
              }
            },
            suffixIcon: IconButton(
              tooltip: _showConfirmPassword ? 'Hide password' : 'Show password',
              onPressed: () {
                setState(() => _showConfirmPassword = !_showConfirmPassword);
              },
              icon: Icon(
                _showConfirmPassword
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 18,
                color: AppColors.primaryDark,
              ),
            ),
            validator: (value) {
              if ((value ?? '').isEmpty) {
                return 'Confirm your new password.';
              }

              return null;
            },
          ),

          if (_error != null) ...[
            const SizedBox(height: 11),
            AuthErrorBox(message: _error!),
          ],

          const SizedBox(height: 16),

          AuthPrimaryButton(
            label: 'Update password',
            onPressed: _submit,
            loading: _submitting,
          ),

          const SizedBox(height: 12),

          AuthSwitchPrompt(
            text: 'Need a fresh link?',
            action: 'Request another',
            onPressed: () {
              Navigator.pushReplacementNamed(context, '/forgot-password');
            },
          ),
        ],
      ),
    );
  }

  /// Builds the confirmation state displayed after a successful reset.
  ///
  /// The user is informed that the password was updated and can navigate
  /// directly to the sign-in page using the new password.
  Widget _buildComplete() {
    return Column(
      key: const ValueKey('reset-complete'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(17),
          ),
          child: const Icon(
            Icons.verified_rounded,
            size: 25,
            color: AppColors.primaryDark,
          ),
        ),

        const SizedBox(height: 15),

        const AuthEyebrow(
          label: 'PASSWORD UPDATED',
          icon: Icons.check_circle_outline_rounded,
        ),

        const SizedBox(height: 14),

        const Text(
          'Your password is ready.',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 27,
            height: 1.05,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.8,
          ),
        ),

        const SizedBox(height: 9),

        const Text(
          'Your password was changed successfully. For security, previous refresh sessions are no longer valid.',
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 11.7,
            height: 1.5,
          ),
        ),

        const SizedBox(height: 18),

        AuthPrimaryButton(
          label: 'Sign in with new password',
          onPressed: () {
            Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);
          },
          loading: false,
        ),
      ],
    );
  }
}

/// Displays the password requirements used by the reset form.
///
/// Each requirement is represented by a [_RulePill] that visually indicates
/// whether the current password satisfies that rule.
///
/// @author Eman
class _PasswordRules extends StatelessWidget {
  const _PasswordRules({
    required this.hasLength,
    required this.hasLetter,
    required this.hasNumber,
  });

  /// Indicates whether the password meets the minimum length requirement.
  final bool hasLength;

  /// Indicates whether the password contains at least one letter.
  final bool hasLetter;

  /// Indicates whether the password contains at least one number.
  final bool hasNumber;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        _RulePill(valid: hasLength, label: '8+ characters'),
        _RulePill(valid: hasLetter, label: 'A letter'),
        _RulePill(valid: hasNumber, label: 'A number'),
      ],
    );
  }
}

/// Visual indicator for a single password requirement.
///
/// The appearance changes automatically depending on whether [valid]
/// is `true` or `false`.
///
/// @author Eman
class _RulePill extends StatelessWidget {
  const _RulePill({required this.valid, required this.label});

  /// Indicates whether the password requirement is currently satisfied.
  final bool valid;

  /// Text displayed for the password requirement.
  final String label;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: valid ? AppColors.primarySoft : AppColors.warm,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(
          color: valid ? AppColors.borderStrong : AppColors.border,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            valid ? Icons.check_rounded : Icons.circle_outlined,
            size: 13,
            color: valid ? AppColors.primaryDark : AppColors.textMuted,
          ),

          const SizedBox(width: 4),

          Text(
            label,
            style: TextStyle(
              color: valid ? AppColors.primaryDeep : AppColors.textMuted,
              fontSize: 9.4,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
