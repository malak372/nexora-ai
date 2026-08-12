// Voxidence mobile email-verification screen.
//
// Mirrors the web verification flow:
// - Six numeric digits only.
// - Verification and resend loading states.
// - Registration email-delivery failure recovery.
// - Clear success and error feedback.
// - Returns to sign in with the verified email prefilled.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../validation/auth_validators.dart';
import '../widgets/auth_shell.dart';
import 'login_page.dart';

class VerifyEmailPage extends StatefulWidget {
  const VerifyEmailPage({
    super.key,
    required this.email,
    this.initialMessage,
    this.emailDeliveryFailed = false,
  });

  final String email;
  final String? initialMessage;
  final bool emailDeliveryFailed;

  @override
  State<VerifyEmailPage> createState() => _VerifyEmailPageState();
}

class _VerifyEmailPageState extends State<VerifyEmailPage> {
  final _code = TextEditingController();

  bool _verifying = false;
  bool _resending = false;

  late bool _emailDeliveryFailed;

  String? _message;
  String? _verificationError;
  String? _resendMessage;
  String? _resendError;

  bool get _codeIsComplete =>
      AuthValidators.isSixDigitVerificationCode(_code.text);

  @override
  void initState() {
    super.initState();

    _emailDeliveryFailed = widget.emailDeliveryFailed;
    _message = widget.initialMessage;
  }

  @override
  void dispose() {
    _code.dispose();

    super.dispose();
  }

  Future<void> _verify() async {
    FocusScope.of(context).unfocus();

    if (_verifying) {
      return;
    }

    if (!_codeIsComplete) {
      setState(() {
        _verificationError =
            'Enter the complete six-digit verification code.';
      });

      return;
    }

    setState(() {
      _verifying = true;

      _verificationError = null;
      _resendMessage = null;
      _resendError = null;
    });

    try {
      final result = await AuthApi.instance.verifyEmail(
        email: widget.email,
        code: _code.text,
      );

      if (!mounted) {
        return;
      }

      final serverMessage =
          result['message']?.toString().trim();

      final successMessage =
          serverMessage == null || serverMessage.isEmpty
              ? 'Your email was verified successfully. You can now sign in.'
              : serverMessage;

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(successMessage),
          ),
        );

      Navigator.of(
        context,
        rootNavigator: true,
      ).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => LoginPage(
            initialEmail: widget.email,
          ),
        ),
        (route) => false,
      );
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _verificationError =
            error.message.trim().isEmpty
                ? 'The verification code is invalid or has expired.'
                : error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _verificationError =
            'Email verification could not be completed. Please try again.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _verifying = false;
        });
      }
    }
  }

  Future<void> _resend() async {
    if (_resending ||
        _verifying ||
        widget.email.trim().isEmpty) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _resending = true;

      _resendMessage = null;
      _resendError = null;
      _verificationError = null;
    });

    try {
      final result =
          await AuthApi.instance.resendVerification(
        widget.email,
      );

      if (!mounted) {
        return;
      }

      final serverMessage =
          result['message']?.toString().trim();

      final successMessage =
          serverMessage == null || serverMessage.isEmpty
              ? 'A new verification code was sent successfully.'
              : serverMessage;

      _code.clear();

      setState(() {
        _emailDeliveryFailed = false;
        _message = successMessage;
        _resendMessage = successMessage;
      });
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _resendError =
            error.message.trim().isEmpty
                ? 'The verification code could not be sent. Please try again.'
                : error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _resendError =
            'The verification code could not be sent. Please try again.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _resending = false;
        });
      }
    }
  }

  void _backToLogin() {
    if (_verifying || _resending) {
      return;
    }

    Navigator.of(
      context,
      rootNavigator: true,
    ).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => LoginPage(
          initialEmail: widget.email,
        ),
      ),
      (route) => false,
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AuthEyebrow(
                  label: 'SECURE EMAIL VERIFICATION',
                  icon: Icons.mark_email_read_outlined,
                ),

                const SizedBox(height: 14),

                const AuthTitle(
                  title: 'Verify your email.',
                  highlight: 'Enter your code.',
                  description:
                      'Use the six-digit verification code sent to your email address.',
                ),

                const SizedBox(height: 18),

                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: AppColors.borderStrong,
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.alternate_email_rounded,
                        size: 17,
                        color: AppColors.primaryDark,
                      ),

                      const SizedBox(width: 8),

                      Expanded(
                        child: Text(
                          widget.email
                              .trim()
                              .toLowerCase(),
                          style: const TextStyle(
                            color: AppColors.primaryDeep,
                            fontSize: 11.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                if (_message != null &&
                    _message!.trim().isNotEmpty) ...[
                  const SizedBox(height: 11),

                  _VerificationNotice(
                    message: _message!,
                    warning: _emailDeliveryFailed,
                  ),
                ],

                const SizedBox(height: 16),

                const Text(
                  'Verification code',
                  style: TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 11.1,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 6),

                TextField(
                  controller: _code,
                  enabled: !_verifying && !_resending,
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [
                    AutofillHints.oneTimeCode,
                  ],
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  onChanged: (_) {
                    setState(() {
                      _verificationError = null;
                      _resendMessage = null;
                      _resendError = null;
                    });
                  },
                  onSubmitted: (_) {
                    if (_codeIsComplete &&
                        !_verifying &&
                        !_resending) {
                      _verify();
                    }
                  },
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 6,
                  ),
                  decoration: InputDecoration(
                    hintText: '000000',
                    counterText: '',
                    errorText: _verificationError,
                    prefixIcon: const Icon(
                      Icons.pin_outlined,
                      size: 18,
                    ),
                    suffixIcon: _codeIsComplete
                        ? const Icon(
                            Icons.check_circle_rounded,
                            color: Color(0xFF13835B),
                            size: 18,
                          )
                        : null,
                  ),
                ),

                if (_resendMessage != null &&
                    _resendMessage!.trim().isNotEmpty) ...[
                  const SizedBox(height: 9),

                  Text(
                    _resendMessage!,
                    style: const TextStyle(
                      color: Color(0xFF13835B),
                      fontSize: 10.2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],

                if (_resendError != null &&
                    _resendError!.trim().isNotEmpty) ...[
                  const SizedBox(height: 9),

                  Text(
                    _resendError!,
                    style: const TextStyle(
                      color: AppColors.pink,
                      fontSize: 10.2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],

                const SizedBox(height: 16),

                AuthPrimaryButton(
                  label: 'Verify email',
                  onPressed:
                      _codeIsComplete &&
                              !_verifying &&
                              !_resending
                          ? _verify
                          : null,
                  loading: _verifying,
                ),

                const SizedBox(height: 10),

                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: OutlinedButton.icon(
                    onPressed:
                        _resending || _verifying
                            ? null
                            : _resend,
                    icon: _resending
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(
                            Icons.refresh_rounded,
                            size: 17,
                          ),
                    label: Text(
                      _resending
                          ? 'Requesting code...'
                          : 'Resend verification code',
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 13),

                AuthSwitchPrompt(
                  text: 'Already verified?',
                  action: 'Back to sign in',
                  onPressed: _backToLogin,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VerificationNotice extends StatelessWidget {
  const _VerificationNotice({
    required this.message,
    required this.warning,
  });

  final String message;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final color =
        warning
            ? AppColors.pink
            : const Color(0xFF13835B);

    final background =
        warning
            ? AppColors.pinkSoft
            : const Color(0xFFEAF7F1);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: color.withValues(alpha: 0.24),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            warning
                ? Icons.warning_amber_rounded
                : Icons.info_outline_rounded,
            size: 17,
            color: color,
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: color,
                fontSize: 10.2,
                height: 1.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}