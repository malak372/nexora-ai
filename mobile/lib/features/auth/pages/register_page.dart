// Author: Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/auth_api.dart';
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

  String? _error;

  static const roles = [
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

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (!_formKey.currentState!.validate()) {
      return;
    }

    if (!_acceptedTerms) {
      setState(() {
        _error = 'You must accept the Terms of Service and Privacy Policy.';
      });
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await AuthApi.instance.register(
        fullName: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        userType: _userType,
      );

      if (!mounted) {
        return;
      }

      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) =>
              VerifyEmailPage(email: _email.text.trim().toLowerCase()),
        ),
      );
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
    final screenWidth = MediaQuery.sizeOf(context).width;
    final compact = screenWidth < 380;

    final password = _password.text;

    final hasLength = password.length >= 6;
    final hasLetter = RegExp(r'[A-Za-z]').hasMatch(password);
    final hasNumber = RegExp(r'\d').hasMatch(password);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const Positioned.fill(child: _RegisterBackground()),
          SafeArea(
            child: SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: EdgeInsets.fromLTRB(
                compact ? 10 : 14,
                compact ? 10 : 14,
                compact ? 10 : 14,
                26,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 555),
                  child: Container(
                    width: double.infinity,
                    padding: EdgeInsets.fromLTRB(
                      compact ? 15 : 20,
                      compact ? 17 : 22,
                      compact ? 15 : 20,
                      compact ? 16 : 20,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.94),
                      borderRadius: BorderRadius.circular(30),
                      border: Border.all(color: Colors.white),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primaryDeep.withValues(alpha: 0.08),
                          blurRadius: 38,
                          offset: const Offset(0, 16),
                        ),
                      ],
                    ),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Center(child: _Brand()),

                          SizedBox(height: compact ? 18 : 22),

                          const _WorkspaceHeader(),

                          SizedBox(height: compact ? 18 : 22),

                          _Heading(compact: compact),

                          SizedBox(height: compact ? 18 : 22),

                          _Field(
                            controller: _name,
                            label: 'Full name',
                            hint: 'Your full name',
                            icon: Icons.person_outline_rounded,
                            textInputAction: TextInputAction.next,
                            validator: (value) {
                              if ((value?.trim().length ?? 0) < 2) {
                                return 'Enter your full name.';
                              }

                              return null;
                            },
                          ),

                          const SizedBox(height: 13),

                          _Field(
                            controller: _email,
                            label: 'Email address',
                            hint: 'name@example.com',
                            icon: Icons.mail_outline_rounded,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            validator: (value) {
                              final text = value?.trim() ?? '';

                              final valid = RegExp(
                                r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                              ).hasMatch(text);

                              if (!valid) {
                                return 'Enter a valid email address.';
                              }

                              return null;
                            },
                          ),

                          const SizedBox(height: 15),

                          const Text(
                            'I am joining as',
                            style: TextStyle(
                              color: AppColors.primaryDeep,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),

                          const SizedBox(height: 8),

                          LayoutBuilder(
                            builder: (context, constraints) {
                              final columns = constraints.maxWidth < 315
                                  ? 2
                                  : 3;

                              const spacing = 9.0;

                              final width =
                                  (constraints.maxWidth -
                                      ((columns - 1) * spacing)) /
                                  columns;

                              return Wrap(
                                spacing: spacing,
                                runSpacing: spacing,
                                children: roles.map((role) {
                                  return _RoleCard(
                                    width: width,
                                    role: role,
                                    selected: _userType == role.value,
                                    onPressed: () {
                                      setState(() {
                                        _userType = role.value;
                                      });
                                    },
                                  );
                                }).toList(),
                              );
                            },
                          ),

                          const SizedBox(height: 15),

                          _Field(
                            controller: _password,
                            label: 'Password',
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
                                size: 19,
                                color: AppColors.primaryDark,
                              ),
                            ),
                            validator: (value) {
                              final text = value ?? '';

                              if (text.length < 6 ||
                                  !RegExp(r'[A-Za-z]').hasMatch(text) ||
                                  !RegExp(r'\d').hasMatch(text)) {
                                return 'Use 6+ characters with a letter and number.';
                              }

                              return null;
                            },
                          ),

                          const SizedBox(height: 13),

                          _Field(
                            controller: _confirmPassword,
                            label: 'Confirm password',
                            hint: 'Confirm password',
                            icon: Icons.lock_outline_rounded,
                            obscureText: _obscureConfirmPassword,
                            textInputAction: TextInputAction.done,
                            suffixIcon: IconButton(
                              tooltip: _obscureConfirmPassword
                                  ? 'Show password'
                                  : 'Hide password',
                              onPressed: () {
                                setState(() {
                                  _obscureConfirmPassword =
                                      !_obscureConfirmPassword;
                                });
                              },
                              icon: Icon(
                                _obscureConfirmPassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                                size: 19,
                                color: AppColors.primaryDark,
                              ),
                            ),
                            onFieldSubmitted: (_) {
                              if (!_submitting) {
                                _submit();
                              }
                            },
                            validator: (value) {
                              if (value != _password.text) {
                                return 'Passwords do not match.';
                              }

                              return null;
                            },
                          ),

                          const SizedBox(height: 9),

                          Wrap(
                            spacing: 13,
                            runSpacing: 7,
                            children: [
                              _PasswordRule(
                                label: '6+ characters',
                                complete: hasLength,
                              ),
                              _PasswordRule(
                                label: 'One letter',
                                complete: hasLetter,
                              ),
                              _PasswordRule(
                                label: 'One number',
                                complete: hasNumber,
                              ),
                            ],
                          ),

                          const SizedBox(height: 14),

                          _TermsRow(
                            value: _acceptedTerms,
                            onChanged: (value) {
                              setState(() {
                                _acceptedTerms = value;

                                if (value &&
                                    _error ==
                                        'You must accept the Terms of Service and Privacy Policy.') {
                                  _error = null;
                                }
                              });
                            },
                          ),

                          if (_error != null) ...[
                            const SizedBox(height: 10),
                            _ErrorBox(message: _error!),
                          ],

                          const SizedBox(height: 15),

                          SizedBox(
                            width: double.infinity,
                            height: 54,
                            child: FilledButton(
                              onPressed: _submitting ? null : _submit,
                              style: FilledButton.styleFrom(
                                backgroundColor: AppColors.primary,
                                disabledBackgroundColor: AppColors.primary
                                    .withValues(alpha: 0.45),
                                foregroundColor: Colors.white,
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(18),
                                ),
                              ),
                              child: _submitting
                                  ? const SizedBox(
                                      width: 21,
                                      height: 21,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Icon(
                                          Icons.auto_awesome_rounded,
                                          size: 18,
                                        ),
                                        SizedBox(width: 9),
                                        Text(
                                          'Create my workspace',
                                          style: TextStyle(
                                            fontSize: 13.3,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                        SizedBox(width: 9),
                                        Icon(
                                          Icons.arrow_forward_rounded,
                                          size: 19,
                                        ),
                                      ],
                                    ),
                            ),
                          ),

                          const SizedBox(height: 12),

                          Center(
                            child: Wrap(
                              alignment: WrapAlignment.center,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              spacing: 4,
                              children: [
                                const Text(
                                  'Already have an account?',
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 11,
                                  ),
                                ),
                                InkWell(
                                  onTap: () {
                                    Navigator.pushReplacementNamed(
                                      context,
                                      '/login',
                                    );
                                  },
                                  borderRadius: BorderRadius.circular(7),
                                  child: const Padding(
                                    padding: EdgeInsets.symmetric(
                                      horizontal: 3,
                                      vertical: 2,
                                    ),
                                    child: Text(
                                      'Sign in',
                                      style: TextStyle(
                                        color: AppColors.primary,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: 15),

                          Container(height: 1, color: AppColors.border),

                          const SizedBox(height: 13),

                          const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.shield_outlined,
                                size: 15,
                                color: AppColors.pink,
                              ),
                              SizedBox(width: 7),
                              Flexible(
                                child: Text(
                                  'Protected account. Verified email. Private ideas.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 10.3,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
      },
      borderRadius: BorderRadius.circular(18),
      child: const Padding(
        padding: EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _LeafLogo(size: 46),
            SizedBox(width: 10),
            Text(
              'Voxidence',
              style: TextStyle(
                color: AppColors.primaryDeep,
                fontSize: 20,
                height: 1,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.6,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WorkspaceHeader extends StatelessWidget {
  const _WorkspaceHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(11),
          ),
          child: const Icon(
            Icons.shield_outlined,
            color: AppColors.primary,
            size: 17,
          ),
        ),
        const SizedBox(width: 10),
        const Expanded(
          child: Text(
            'YOUR WORKSPACE AWAITS',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AppColors.primary,
              fontSize: 10.2,
              fontWeight: FontWeight.w900,
              letterSpacing: 1,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Material(
          color: Colors.white,
          shape: const CircleBorder(),
          child: InkWell(
            onTap: () {
              Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
            },
            customBorder: const CircleBorder(),
            child: Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.borderStrong),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: 0.04),
                    blurRadius: 12,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: const Icon(
                Icons.arrow_back_rounded,
                color: AppColors.primaryDark,
                size: 19,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.compact});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            children: const [
              TextSpan(text: 'Create '),
              TextSpan(
                text: 'your account',
                style: TextStyle(color: AppColors.primary),
              ),
              TextSpan(text: '.'),
            ],
          ),
          style: TextStyle(
            color: AppColors.primaryDeep,
            fontSize: compact ? 25 : 29,
            height: 1.02,
            fontWeight: FontWeight.w900,
            letterSpacing: -1.1,
          ),
        ),
        const SizedBox(height: 7),
        const Text(
          'Add your details, choose your role, then verify your email to activate your workspace.',
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 12,
            height: 1.45,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.keyboardType,
    this.obscureText = false,
    this.suffixIcon,
    this.validator,
    this.onChanged,
    this.textInputAction,
    this.onFieldSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;

  final TextInputType? keyboardType;
  final bool obscureText;
  final Widget? suffixIcon;
  final String? Function(String?)? validator;
  final ValueChanged<String>? onChanged;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onFieldSubmitted;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(17);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.primaryDeep,
            fontSize: 11.3,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscureText,
          validator: validator,
          onChanged: onChanged,
          textInputAction: textInputAction,
          onFieldSubmitted: onFieldSubmitted,
          autocorrect: false,
          enableSuggestions: !obscureText,
          style: const TextStyle(
            color: AppColors.primaryDeep,
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
          ),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(
              color: Color(0xFF8E9A97),
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
            prefixIcon: Icon(icon, color: AppColors.primaryDark, size: 19),
            suffixIcon: suffixIcon,
            filled: true,
            fillColor: Colors.white.withValues(alpha: 0.72),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 15,
            ),
            border: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(color: AppColors.borderStrong),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(color: AppColors.borderStrong),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(
                color: AppColors.primary,
                width: 1.5,
              ),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(color: AppColors.pink),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: radius,
              borderSide: const BorderSide(color: AppColors.pink, width: 1.4),
            ),
            errorStyle: const TextStyle(
              color: Color(0xFFA45163),
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
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

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.width,
    required this.role,
    required this.selected,
    required this.onPressed,
  });

  final double width;
  final _RoleData role;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(17),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: width,
          height: 82,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          decoration: BoxDecoration(
            color: selected
                ? const Color(0xFFF1FBF8)
                : Colors.white.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
              width: selected ? 1.6 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: 0.10),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : null,
          ),
          child: Stack(
            children: [
              Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: selected
                            ? AppColors.primary.withValues(alpha: 0.16)
                            : AppColors.primarySoft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        role.icon,
                        size: 19,
                        color: selected
                            ? AppColors.primaryDark
                            : AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      role.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: AppColors.primaryDeep,
                        fontSize: 10,
                        fontWeight: selected
                            ? FontWeight.w900
                            : FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              if (selected)
                const Positioned(
                  right: 1,
                  top: 0,
                  child: Icon(
                    Icons.check_circle_rounded,
                    color: AppColors.primary,
                    size: 17,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PasswordRule extends StatelessWidget {
  const _PasswordRule({required this.label, required this.complete});

  final String label;
  final bool complete;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          complete ? Icons.check_circle_rounded : Icons.circle_outlined,
          size: 14,
          color: complete ? AppColors.primary : AppColors.pink,
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: TextStyle(
            color: complete ? AppColors.primaryDark : AppColors.pink,
            fontSize: 9.7,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _TermsRow extends StatelessWidget {
  const _TermsRow({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 22,
          height: 22,
          child: Checkbox(
            value: value,
            onChanged: (checked) {
              onChanged(checked ?? false);
            },
            activeColor: AppColors.primary,
            side: const BorderSide(color: Color(0xFFBEDDD8), width: 1.3),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(5),
            ),
          ),
        ),
        const SizedBox(width: 8),
        const Expanded(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'I agree to the '),
                TextSpan(
                  text: 'Terms of Service',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontWeight: FontWeight.w900,
                    decoration: TextDecoration.underline,
                  ),
                ),
                TextSpan(text: ' and '),
                TextSpan(
                  text: 'Privacy Policy.',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontWeight: FontWeight.w900,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ],
            ),
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.6,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.pink.withValues(alpha: 0.24)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 16,
            color: Color(0xFFA14F62),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Color(0xFF9F4F61),
                fontSize: 9.7,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeafLogo extends StatelessWidget {
  const _LeafLogo({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFB9E3D9), Color(0xFF79C9BE), Color(0xFF55B4AE)],
        ),
        borderRadius: BorderRadius.circular(size * 0.28),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.18),
            blurRadius: 17,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.all(size * 0.18),
              child: CustomPaint(painter: _LeafLogoPainter()),
            ),
          ),
          Positioned(
            top: size * 0.14,
            right: size * 0.14,
            child: Icon(
              Icons.auto_awesome_rounded,
              size: size * 0.16,
              color: const Color(0xFFFFF1D7),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeafLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.96)
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.055
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final stem = Path()
      ..moveTo(size.width * 0.50, size.height * 0.90)
      ..cubicTo(
        size.width * 0.50,
        size.height * 0.68,
        size.width * 0.50,
        size.height * 0.42,
        size.width * 0.60,
        size.height * 0.18,
      );

    canvas.drawPath(stem, paint);

    final upperLeaf = Path()
      ..moveTo(size.width * 0.56, size.height * 0.46)
      ..cubicTo(
        size.width * 0.62,
        size.height * 0.23,
        size.width * 0.79,
        size.height * 0.14,
        size.width * 0.86,
        size.height * 0.12,
      )
      ..cubicTo(
        size.width * 0.84,
        size.height * 0.36,
        size.width * 0.73,
        size.height * 0.48,
        size.width * 0.56,
        size.height * 0.46,
      );

    canvas.drawPath(upperLeaf, paint);

    final leftLeaf = Path()
      ..moveTo(size.width * 0.49, size.height * 0.62)
      ..cubicTo(
        size.width * 0.37,
        size.height * 0.45,
        size.width * 0.19,
        size.height * 0.44,
        size.width * 0.14,
        size.height * 0.44,
      )
      ..cubicTo(
        size.width * 0.18,
        size.height * 0.64,
        size.width * 0.33,
        size.height * 0.71,
        size.width * 0.49,
        size.height * 0.62,
      );

    canvas.drawPath(leftLeaf, paint);

    final rightLeaf = Path()
      ..moveTo(size.width * 0.49, size.height * 0.74)
      ..cubicTo(
        size.width * 0.61,
        size.height * 0.59,
        size.width * 0.79,
        size.height * 0.60,
        size.width * 0.84,
        size.height * 0.61,
      )
      ..cubicTo(
        size.width * 0.77,
        size.height * 0.78,
        size.width * 0.63,
        size.height * 0.82,
        size.width * 0.49,
        size.height * 0.74,
      );

    canvas.drawPath(rightLeaf, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _RegisterBackground extends StatelessWidget {
  const _RegisterBackground();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFAF7F9), Color(0xFFFFFEFD), Color(0xFFF1FAF8)],
          stops: [0, 0.48, 1],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -165,
            left: -145,
            child: _Glow(
              size: 370,
              color: AppColors.pink.withValues(alpha: 0.10),
            ),
          ),
          Positioned(
            top: -170,
            right: -145,
            child: _Glow(
              size: 390,
              color: AppColors.primary.withValues(alpha: 0.12),
            ),
          ),
          Positioned(
            right: -180,
            bottom: -160,
            child: _Glow(
              size: 420,
              color: AppColors.primary.withValues(alpha: 0.10),
            ),
          ),
          const Positioned(
            right: -20,
            top: 250,
            child: IgnorePointer(
              child: Opacity(
                opacity: 0.13,
                child: SizedBox(
                  width: 165,
                  height: 250,
                  child: CustomPaint(painter: _BackgroundLeafPainter()),
                ),
              ),
            ),
          ),
          const Positioned.fill(
            child: IgnorePointer(child: CustomPaint(painter: _DotsPainter())),
          ),
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _BackgroundLeafPainter extends CustomPainter {
  const _BackgroundLeafPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2
      ..strokeCap = StrokeCap.round;

    final stem = Path()
      ..moveTo(size.width * 0.45, size.height)
      ..cubicTo(
        size.width * 0.43,
        size.height * 0.70,
        size.width * 0.49,
        size.height * 0.39,
        size.width * 0.72,
        size.height * 0.10,
      );

    canvas.drawPath(stem, paint);

    final topLeaf = Path()
      ..moveTo(size.width * 0.60, size.height * 0.43)
      ..cubicTo(
        size.width * 0.68,
        size.height * 0.18,
        size.width * 0.90,
        size.height * 0.12,
        size.width * 0.94,
        size.height * 0.11,
      )
      ..cubicTo(
        size.width * 0.92,
        size.height * 0.34,
        size.width * 0.78,
        size.height * 0.47,
        size.width * 0.60,
        size.height * 0.43,
      );

    canvas.drawPath(topLeaf, paint);

    final leftLeaf = Path()
      ..moveTo(size.width * 0.47, size.height * 0.63)
      ..cubicTo(
        size.width * 0.31,
        size.height * 0.47,
        size.width * 0.13,
        size.height * 0.48,
        size.width * 0.08,
        size.height * 0.49,
      )
      ..cubicTo(
        size.width * 0.14,
        size.height * 0.67,
        size.width * 0.31,
        size.height * 0.73,
        size.width * 0.47,
        size.height * 0.63,
      );

    canvas.drawPath(leftLeaf, paint);

    final rightLeaf = Path()
      ..moveTo(size.width * 0.45, size.height * 0.78)
      ..cubicTo(
        size.width * 0.59,
        size.height * 0.63,
        size.width * 0.79,
        size.height * 0.64,
        size.width * 0.85,
        size.height * 0.66,
      )
      ..cubicTo(
        size.width * 0.77,
        size.height * 0.82,
        size.width * 0.60,
        size.height * 0.87,
        size.width * 0.45,
        size.height * 0.78,
      );

    canvas.drawPath(rightLeaf, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _DotsPainter extends CustomPainter {
  const _DotsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final tealPaint = Paint()
      ..color = AppColors.primary.withValues(alpha: 0.07);

    final pinkPaint = Paint()..color = AppColors.pink.withValues(alpha: 0.045);

    for (double y = 35; y < size.height; y += 75) {
      canvas.drawCircle(Offset(10, y), 1.1, tealPaint);

      canvas.drawCircle(
        Offset(size.width - 10, y + 30),
        1.1,
        y.toInt().isEven ? pinkPaint : tealPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}
