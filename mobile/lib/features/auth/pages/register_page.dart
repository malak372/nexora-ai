// Voxidence mobile registration screen.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
import '../validation/auth_validators.dart';
import '../widgets/auth_shell.dart';
import 'verify_email_page.dart';

class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();

  final _name = TextEditingController();

  final _email = TextEditingController();

  final _password = TextEditingController();

  final _confirmPassword = TextEditingController();

  String _userType = 'STUDENT';

  bool _obscurePassword = true;

  bool _obscureConfirmPassword = true;

  bool _acceptedTerms = false;

  bool _submitting = false;

  bool _attemptedSubmit = false;

  String? _error;

  String? _termsError;

  static const _roles = [
    _RoleData(value: 'STUDENT', label: 'Student', icon: Icons.school_outlined),
    _RoleData(value: 'DEVELOPER', label: 'Developer', icon: Icons.code_rounded),
    _RoleData(
      value: 'RESEARCHER',
      label: 'Researcher',
      icon: Icons.manage_search_rounded,
    ),
    _RoleData(
      value: 'COMPANY',
      label: 'Company',
      icon: Icons.business_center_outlined,
    ),
    _RoleData(value: 'OTHER', label: 'Other', icon: Icons.more_horiz_rounded),
  ];

  @override
  void dispose() {
    _name.dispose();

    _email.dispose();

    _password.dispose();

    _confirmPassword.dispose();

    super.dispose();
  }

  bool _accountWasCreatedButVerificationFailed(String message) {
    final normalized = message.toLowerCase();

    return normalized.contains('account was created') &&
        normalized.contains('verification email');
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    setState(() {
      _attemptedSubmit = true;
    });

    final formValid = _formKey.currentState!.validate();

    final termsValid = _acceptedTerms;

    setState(() {
      _termsError = termsValid
          ? null
          : 'You must accept the Terms, Privacy Policy, and Security Policy.';
    });

    if (!formValid || !termsValid) {
      setState(() {
        _error = null;
      });

      return;
    }

    setState(() {
      _submitting = true;

      _error = null;

      _termsError = null;
    });

    final normalizedEmail = _email.text.trim().toLowerCase();

    try {
      final result = await AuthApi.instance.register(
        fullName: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        userType: _userType,
      );

      if (!mounted) {
        return;
      }

      final responseMessage = result['message']?.toString().trim();

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => VerifyEmailPage(
            email: normalizedEmail,
            initialMessage: responseMessage == null || responseMessage.isEmpty
                ? 'Your account was created. Check your inbox for the six-digit verification code.'
                : responseMessage,
          ),
        ),
      );
    } on AuthException catch (error) {
      if (!mounted) {
        return;
      }

      if (_accountWasCreatedButVerificationFailed(error.message)) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => VerifyEmailPage(
              email: normalizedEmail,
              emailDeliveryFailed: true,
              initialMessage: error.message,
            ),
          ),
        );

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
    final password = _password.text;

    final hasLength = password.length >= 6;

    final hasLetter = RegExp(r'[A-Za-z]').hasMatch(password);

    final hasNumber = RegExp(r'\d').hasMatch(password);

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
                  const AuthEyebrow(
                    label: 'CREATE YOUR WORKSPACE',
                    icon: Icons.person_add_alt_1_rounded,
                  ),

                  const SizedBox(height: 14),

                  const AuthTitle(
                    title: 'Start with a real need.',
                    highlight: 'Build from evidence.',
                    description:
                        'Create your Voxidence account and turn community signals into focused software opportunities.',
                  ),

                  const SizedBox(height: 20),

                  AuthField(
                    controller: _name,
                    label: 'Full name',
                    autovalidateMode: _attemptedSubmit
                        ? AutovalidateMode.onUserInteraction
                        : AutovalidateMode.disabled,
                    hint: 'Your full name',
                    icon: Icons.person_outline_rounded,
                    textInputAction: TextInputAction.next,
                    maxLength: 120,
                    validator: AuthValidators.registerFullName,
                  ),

                  const SizedBox(height: 13),

                  AuthField(
                    controller: _email,
                    label: 'Email address',
                    autovalidateMode: _attemptedSubmit
                        ? AutovalidateMode.onUserInteraction
                        : AutovalidateMode.disabled,
                    hint: 'name@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    validator: AuthValidators.registerEmail,
                  ),

                  const SizedBox(height: 15),

                  const Text(
                    'I am joining as',
                    style: TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 11.1,
                      fontWeight: FontWeight.w900,
                    ),
                  ),

                  const SizedBox(height: 8),

                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: _roles.map((role) {
                      final selected = _userType == role.value;

                      return _RoleChip(
                        role: role,
                        selected: selected,
                        onPressed: () {
                          setState(() {
                            _userType = role.value;
                          });
                        },
                      );
                    }).toList(),
                  ),

                  const SizedBox(height: 15),

                  AuthField(
                    controller: _password,
                    label: 'Password',
                    autovalidateMode: _attemptedSubmit
                        ? AutovalidateMode.onUserInteraction
                        : AutovalidateMode.disabled,
                    hint: 'Create a password',
                    icon: Icons.lock_outline_rounded,
                    obscureText: _obscurePassword,
                    textInputAction: TextInputAction.next,
                    onChanged: (_) {
                      setState(() {});
                    },
                    suffixIcon: IconButton(
                      tooltip: _obscurePassword
                          ? 'Show password'
                          : 'Hide password',
                      onPressed: () {
                        setState(() {
                          _obscurePassword = !_obscurePassword;
                        });
                      },
                      icon: Icon(
                        _obscurePassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    validator: AuthValidators.registerPassword,
                  ),

                  const SizedBox(height: 9),

                  _PasswordRules(
                    hasLength: hasLength,
                    hasLetter: hasLetter,
                    hasNumber: hasNumber,
                  ),

                  const SizedBox(height: 13),

                  AuthField(
                    controller: _confirmPassword,
                    label: 'Confirm password',
                    autovalidateMode: _attemptedSubmit
                        ? AutovalidateMode.onUserInteraction
                        : AutovalidateMode.disabled,
                    hint: 'Repeat your password',
                    icon: Icons.verified_user_outlined,
                    obscureText: _obscureConfirmPassword,
                    textInputAction: TextInputAction.done,
                    suffixIcon: IconButton(
                      tooltip: _obscureConfirmPassword
                          ? 'Show password'
                          : 'Hide password',
                      onPressed: () {
                        setState(() {
                          _obscureConfirmPassword = !_obscureConfirmPassword;
                        });
                      },
                      icon: Icon(
                        _obscureConfirmPassword
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    validator: (value) =>
                        AuthValidators.confirmRegistrationPassword(
                          value: value,
                          password: _password.text,
                        ),
                  ),

                  const SizedBox(height: 12),

                  _TermsRow(
                    accepted: _acceptedTerms,
                    onChanged: (value) {
                      setState(() {
                        _acceptedTerms = value;

                        if (value) {
                          _termsError = null;
                        }
                      });
                    },
                  ),

                  if (_termsError != null) ...[
                    const SizedBox(height: 6),

                    Text(
                      _termsError!,
                      style: const TextStyle(
                        color: AppColors.pink,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],

                  if (_error != null) ...[
                    const SizedBox(height: 11),

                    AuthErrorBox(message: _error!),
                  ],

                  const SizedBox(height: 16),

                  AuthPrimaryButton(
                    label: 'Create my account',
                    onPressed: _submit,
                    loading: _submitting,
                  ),

                  const SizedBox(height: 12),

                  AuthSwitchPrompt(
                    text: 'Already have an account?',
                    action: 'Sign in',
                    onPressed: () {
                      Navigator.pushReplacementNamed(context, '/login');
                    },
                  ),

                  const SizedBox(height: 15),

                  Container(height: 1, color: AppColors.border),

                  const SizedBox(height: 13),

                  const AuthSecurityLine(
                    text:
                        'Your account protects your ideas, evidence, and workspace.',
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

class _RoleData {
  const _RoleData({
    required this.value,
    required this.label,
    required this.icon,
  });

  final String value;

  final String label;

  final IconData icon;
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({
    required this.role,
    required this.selected,
    required this.onPressed,
  });

  final _RoleData role;

  final bool selected;

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? const Color(0xFFFFF8FA) : Colors.white,
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(13),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                role.icon,
                size: 15,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.textSecondary,
              ),

              const SizedBox(width: 6),

              Text(
                role.label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDark
                      : AppColors.textSecondary,
                  fontSize: 10.1,
                  fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PasswordRules extends StatelessWidget {
  const _PasswordRules({
    required this.hasLength,
    required this.hasLetter,
    required this.hasNumber,
  });

  final bool hasLength;

  final bool hasLetter;

  final bool hasNumber;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 7,
      runSpacing: 6,
      children: [
        _RulePill(label: '6+ characters', valid: hasLength),
        _RulePill(label: '1 letter', valid: hasLetter),
        _RulePill(label: '1 number', valid: hasNumber),
      ],
    );
  }
}

class _RulePill extends StatelessWidget {
  const _RulePill({required this.label, required this.valid});

  final String label;

  final bool valid;

  @override
  Widget build(BuildContext context) {
    final color = valid ? const Color(0xFF13835B) : AppColors.pink;

    final background = valid ? const Color(0xFFEAF7F1) : AppColors.pinkSoft;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            valid ? Icons.check_rounded : Icons.circle_outlined,
            size: 11,
            color: color,
          ),

          const SizedBox(width: 4),

          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 8.9,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _TermsRow extends StatelessWidget {
  const _TermsRow({required this.accepted, required this.onChanged});

  final bool accepted;

  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 20,
          height: 20,
          child: Checkbox(
            value: accepted,
            activeColor: AppColors.primary,
            side: const BorderSide(color: AppColors.borderStrong),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(5),
            ),
            onChanged: (value) {
              onChanged(value ?? false);
            },
          ),
        ),

        const SizedBox(width: 8),

        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 3,
              runSpacing: 2,
              children: [
                const Text('I agree to the', style: _termsTextStyle),

                _LegalLink(
                  label: 'Terms of Service',
                  onTap: () {
                    Navigator.pushNamed(context, '/terms');
                  },
                ),

                const Text(',', style: _termsTextStyle),

                _LegalLink(
                  label: 'Privacy Policy',
                  onTap: () {
                    Navigator.pushNamed(context, '/privacy');
                  },
                ),

                const Text('and', style: _termsTextStyle),

                _LegalLink(
                  label: 'Security Policy',
                  onTap: () {
                    Navigator.pushNamed(context, '/security');
                  },
                ),

                const Text('.', style: _termsTextStyle),
              ],
            ),
          ),
        ),
      ],
    );
  }

  static const _termsTextStyle = TextStyle(
    color: AppColors.textSecondary,
    fontSize: 9.7,
    height: 1.42,
  );
}

class _LegalLink extends StatelessWidget {
  const _LegalLink({required this.label, required this.onTap});

  final String label;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(5),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 1, vertical: 1),
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.primary,
              fontSize: 9.7,
              height: 1.42,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }
}
