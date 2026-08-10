// Author: Eman

import 'package:flutter/material.dart';

import '../api/auth_api.dart';
import '../widgets/auth_shell.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();

  // Form controllers
  final _email = TextEditingController();
  final _password = TextEditingController();

  // UI state
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

  // Validates the form and sends the login request.
  Future<void> _submit() async {
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

      if (!mounted) {
        return;
      }

      final user = session['user'];

      final role = user is Map
          ? (user['role']?.toString().toUpperCase() ?? '')
          : '';

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            role == 'ADMIN'
                ? 'Signed in as administrator.'
                : 'Signed in successfully.',
          ),
        ),
      );
    } on AuthException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
        });
      }
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
      form: LayoutBuilder(
        builder: (context, constraints) {
          final screenWidth = MediaQuery.sizeOf(context).width;

          // Responsive breakpoints
          final isMobile = screenWidth < 700;
          final isVerySmall = screenWidth < 370;

          return Container(
            width: double.infinity,

            // Compact card spacing on smaller screens
            padding: EdgeInsets.fromLTRB(
              isVerySmall
                  ? 14
                  : isMobile
                  ? 16
                  : 38,
              isVerySmall
                  ? 15
                  : isMobile
                  ? 17
                  : 30,
              isVerySmall
                  ? 14
                  : isMobile
                  ? 16
                  : 38,
              isVerySmall
                  ? 15
                  : isMobile
                  ? 17
                  : 26,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .96),
              borderRadius: BorderRadius.circular(isMobile ? 22 : 34),
              border: Border.all(color: const Color(0xFFDDEBE8)),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF315F57).withValues(alpha: .06),
                  blurRadius: isMobile ? 22 : 58,
                  offset: Offset(0, isMobile ? 8 : 20),
                ),
              ],
            ),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(child: AuthBrand(compact: isMobile)),

                  SizedBox(height: isMobile ? 16 : 28),

                  AuthEyebrow(isMobile: isMobile),

                  SizedBox(height: isMobile ? 14 : 24),

                  Text(
                    'Step back into the signal.',
                    style: TextStyle(
                      color: AuthShell.darkTeal,
                      fontSize: isVerySmall
                          ? 23
                          : isMobile
                          ? 25
                          : 38,
                      height: 1.02,
                      letterSpacing: isMobile ? -.8 : -1.7,
                      fontWeight: FontWeight.w900,
                    ),
                  ),

                  SizedBox(height: isMobile ? 7 : 9),

                  Text(
                    'Continue discovering, validating, and shaping ideas designed to solve real problems.',
                    style: TextStyle(
                      color: const Color(0xFF637B76),
                      fontSize: isMobile ? 11.7 : 14.5,
                      height: 1.4,
                    ),
                  ),

                  SizedBox(height: isMobile ? 15 : 26),

                  _Field(
                    controller: _email,
                    label: 'Email address',
                    hint: 'you@example.com',
                    icon: Icons.mail_outline_rounded,
                    keyboardType: TextInputType.emailAddress,
                    isMobile: isMobile,
                    validator: (value) {
                      final text = value?.trim() ?? '';

                      if (text.isEmpty || !text.contains('@')) {
                        return 'Enter a valid email address.';
                      }

                      return null;
                    },
                  ),

                  SizedBox(height: isMobile ? 10 : 16),

                  Row(
                    children: [
                      Text(
                        'Password',
                        style: TextStyle(
                          color: AuthShell.darkTeal,
                          fontSize: isMobile ? 10.8 : 12.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),

                      const Spacer(),

                      InkWell(
                        onTap: () {},
                        borderRadius: BorderRadius.circular(8),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 3,
                            vertical: 3,
                          ),
                          child: Text(
                            'Forgot password?',
                            style: TextStyle(
                              color: AuthShell.teal,
                              fontSize: isMobile ? 10.3 : 11.8,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),

                  SizedBox(height: isMobile ? 5 : 7),

                  TextFormField(
                    controller: _password,
                    obscureText: _obscure,
                    validator: (value) {
                      if ((value ?? '').isEmpty) {
                        return 'Enter your password.';
                      }

                      return null;
                    },
                    decoration: _inputDecoration(
                      hint: 'Enter your password',
                      icon: Icons.lock_outline_rounded,
                      isMobile: isMobile,
                      suffix: IconButton(
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
                          size: isMobile ? 18 : 20,
                          color: AuthShell.bodyTeal,
                        ),
                      ),
                    ),
                  ),

                  SizedBox(height: isMobile ? 10 : 15),

                  _SessionOptions(
                    isMobile: isMobile,
                    rememberMe: _rememberMe,
                    onRememberChanged: (value) {
                      setState(() {
                        _rememberMe = value;
                      });
                    },
                  ),

                  if (_error != null) ...[
                    SizedBox(height: isMobile ? 9 : 12),
                    _ErrorBox(message: _error!),
                  ],

                  SizedBox(height: isMobile ? 13 : 19),

                  SizedBox(
                    width: double.infinity,
                    height: isMobile ? 47 : 56,
                    child: FilledButton(
                      onPressed: _submitting ? null : _submit,
                      style: FilledButton.styleFrom(
                        backgroundColor: AuthShell.teal,
                        disabledBackgroundColor: const Color(0xFF9DD9D5),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(
                            isMobile ? 14 : 17,
                          ),
                        ),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.2,
                                color: Colors.white,
                              ),
                            )
                          : Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  'Continue the discovery',
                                  style: TextStyle(
                                    fontSize: isMobile ? 12.4 : 14.5,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Icon(
                                  Icons.arrow_forward_rounded,
                                  size: isMobile ? 18 : 20,
                                ),
                              ],
                            ),
                    ),
                  ),

                  SizedBox(height: isMobile ? 10 : 17),

                  Center(
                    child: Wrap(
                      alignment: WrapAlignment.center,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 3,
                      runSpacing: 3,
                      children: [
                        Text(
                          'Ready to uncover your first signal?',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: const Color(0xFF728681),
                            fontSize: isMobile ? 10.2 : 11.5,
                          ),
                        ),
                        InkWell(
                          onTap: () {
                            Navigator.pushReplacementNamed(
                              context,
                              '/register',
                            );
                          },
                          borderRadius: BorderRadius.circular(6),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 2,
                              vertical: 2,
                            ),
                            child: Text(
                              'Start discovering',
                              style: TextStyle(
                                color: AuthShell.teal,
                                fontSize: isMobile ? 10.2 : 11.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  SizedBox(height: isMobile ? 11 : 20),

                  const AuthFooter(
                    text:
                        'Protected credentials. Private ideas. Secure workspace.',
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// Controls the persistent login preference and session indicator.
class _SessionOptions extends StatelessWidget {
  const _SessionOptions({
    required this.isMobile,
    required this.rememberMe,
    required this.onRememberChanged,
  });

  final bool isMobile;
  final bool rememberMe;
  final ValueChanged<bool> onRememberChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 20,
          height: 20,
          child: Checkbox(
            value: rememberMe,
            activeColor: AuthShell.teal,
            side: const BorderSide(color: Color(0xFFCFE5E1)),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(5),
            ),
            onChanged: (value) {
              onRememberChanged(value ?? false);
            },
          ),
        ),

        const SizedBox(width: 7),

        Expanded(
          child: Text(
            'Keep me signed in',
            style: TextStyle(
              color: const Color(0xFF5D746F),
              fontSize: isMobile ? 10.7 : 12,
            ),
          ),
        ),

        Container(
          width: 15,
          height: 15,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFFCFE5E1)),
          ),
          child: Container(
            width: 5,
            height: 5,
            decoration: const BoxDecoration(
              color: AuthShell.teal,
              shape: BoxShape.circle,
            ),
          ),
        ),

        const SizedBox(width: 6),

        Text(
          'Secure session',
          style: TextStyle(
            color: AuthShell.pink,
            fontSize: isMobile ? 9.3 : 10.8,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

// Shared styled field used by the login form.
class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    required this.isMobile,
    this.keyboardType,
    this.validator,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final bool isMobile;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: AuthShell.darkTeal,
            fontSize: isMobile ? 10.8 : 12.5,
            fontWeight: FontWeight.w900,
          ),
        ),

        SizedBox(height: isMobile ? 5 : 7),

        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          validator: validator,
          decoration: _inputDecoration(
            hint: hint,
            icon: icon,
            isMobile: isMobile,
          ),
        ),
      ],
    );
  }
}

// Shared decoration for login input fields.
InputDecoration _inputDecoration({
  required String hint,
  required IconData icon,
  required bool isMobile,
  Widget? suffix,
}) {
  final radius = BorderRadius.circular(isMobile ? 13 : 17);

  return InputDecoration(
    hintText: hint,
    hintStyle: TextStyle(
      color: const Color(0xFF7A8986),
      fontSize: isMobile ? 11.8 : 14,
    ),
    prefixIcon: Icon(icon, size: isMobile ? 18 : 20, color: AuthShell.bodyTeal),
    suffixIcon: suffix,
    isDense: true,
    filled: true,
    fillColor: const Color(0xFFFCFEFD),
    contentPadding: EdgeInsets.symmetric(
      horizontal: 14,
      vertical: isMobile ? 12 : 17,
    ),
    border: OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: Color(0xFFDCEBE8)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: Color(0xFFDCEBE8)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: AuthShell.teal, width: 1.6),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: AuthShell.pink),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: AuthShell.pink, width: 1.4),
    ),
  );
}

// Displays authentication errors without interrupting the form.
class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F4),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AuthShell.pink.withValues(alpha: .20)),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: Color(0xFF9F4F61),
          fontSize: 9.8,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
