/// Contact and footer components for the Voxidence mobile home screen.
///
/// Includes the public contact form, registration call-to-action,
/// and compact mobile navigation footer.
///
/// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import 'common.dart';

class ContactSection extends StatefulWidget {
  const ContactSection({super.key, required this.onGetStartedPressed});

  final VoidCallback onGetStartedPressed;

  @override
  State<ContactSection> createState() => _ContactSectionState();
}

class _ContactSectionState extends State<ContactSection> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _messageController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _messageController.dispose();

    super.dispose();
  }

  /// Validates fields that must contain a value.
  String? _requiredField(String? value) {
    if ((value ?? '').trim().isEmpty) {
      return 'This field is required.';
    }

    return null;
  }

  /// Performs basic validation for the contact email address.
  String? _validateEmail(String? value) {
    final email = (value ?? '').trim();

    if (email.isEmpty) {
      return 'Email is required.';
    }

    final validEmail = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email);

    if (!validEmail) {
      return 'Enter a valid email.';
    }

    return null;
  }

  /// Validates the form before it is connected to the backend endpoint.
  void _submit() {
    FocusScope.of(context).unfocus();

    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.primaryDark,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          content: const Text(
            'Your message is ready to be connected to the backend.',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 40, 16, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(
            text: 'LET’S BUILD SOMETHING USEFUL',
            icon: Icons.chat_bubble_outline_rounded,
          ),

          const SizedBox(height: 14),

          const Text(
            'Have a question?\nTalk to us.',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 29,
              height: 1.07,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.8,
            ),
          ),

          const SizedBox(height: 9),

          const Text(
            'Send a quick message and we will help you move in the right direction.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 14,
              height: 1.5,
            ),
          ),

          const SizedBox(height: 19),

          // Public contact form.
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDark.withValues(alpha: 0.055),
                  blurRadius: 24,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  _ContactField(
                    controller: _nameController,
                    label: 'Name',
                    icon: Icons.person_outline_rounded,
                    validator: _requiredField,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _emailController,
                    label: 'Email',
                    icon: Icons.alternate_email_rounded,
                    keyboardType: TextInputType.emailAddress,
                    validator: _validateEmail,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _messageController,
                    label: 'How can we help?',
                    icon: Icons.edit_outlined,
                    maxLines: 4,
                    validator: _requiredField,
                  ),

                  const SizedBox(height: 14),

                  PrimaryButton(
                    label: 'Send message',
                    onPressed: _submit,
                    icon: Icons.arrow_upward_rounded,
                    expand: true,
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 15),

          // Registration call-to-action.
          Container(
            padding: const EdgeInsets.all(19),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AppColors.pinkSoft, AppColors.warmSoft],
              ),
              borderRadius: BorderRadius.circular(23),
              border: Border.all(color: AppColors.pink.withValues(alpha: 0.45)),
            ),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: const Icon(
                    Icons.rocket_launch_outlined,
                    color: AppColors.primaryDark,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Ready to explore?',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Start with real needs instead of an empty prompt.',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11.5,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Material(
                  color: AppColors.primaryDark,
                  borderRadius: BorderRadius.circular(14),
                  child: InkWell(
                    onTap: widget.onGetStartedPressed,
                    borderRadius: BorderRadius.circular(14),
                    child: const SizedBox(
                      width: 43,
                      height: 43,
                      child: Icon(
                        Icons.arrow_forward_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
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

/// Reusable contact form field with consistent mobile styling.
class _ContactField extends StatelessWidget {
  const _ContactField({
    required this.controller,
    required this.label,
    required this.icon,
    required this.validator,
    this.keyboardType,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final String? Function(String?) validator;
  final TextInputType? keyboardType;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      maxLines: maxLines,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      decoration: InputDecoration(
        labelText: label,
        alignLabelWithHint: maxLines > 1,
        prefixIcon: maxLines == 1 ? Icon(icon, size: 19) : null,
        filled: true,
        fillColor: const Color(0xFFF8FBFA),
      ),
    );
  }
}

/// Compact footer designed specifically for the mobile home screen.
class HomeFooter extends StatelessWidget {
  const HomeFooter({
    super.key,
    required this.onHomePressed,
    required this.onHowItWorksPressed,
    required this.onAboutPressed,
    required this.onDomainsPressed,
    required this.onIdeasPressed,
    required this.onContactPressed,
  });

  final VoidCallback onHomePressed;
  final VoidCallback onHowItWorksPressed;
  final VoidCallback onAboutPressed;
  final VoidCallback onDomainsPressed;
  final VoidCallback onIdeasPressed;
  final VoidCallback onContactPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 25, 16, 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(27),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              BrandMark(size: 40),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Voxidence',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Real voices. Better ideas.',
                      style: TextStyle(
                        color: Color(0xFFB9C8C4),
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 19),

          // Quick section navigation.
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _FooterChip(label: 'Home', onTap: onHomePressed),
              _FooterChip(label: 'How it works', onTap: onHowItWorksPressed),
              _FooterChip(label: 'About', onTap: onAboutPressed),
              _FooterChip(label: 'Domains', onTap: onDomainsPressed),
              _FooterChip(label: 'Ideas', onTap: onIdeasPressed),
              _FooterChip(label: 'Contact', onTap: onContactPressed),
            ],
          ),

          const SizedBox(height: 19),

          Divider(color: Colors.white.withValues(alpha: 0.1), height: 1),

          const SizedBox(height: 13),

          const Text(
            '© 2026 Voxidence',
            style: TextStyle(color: Color(0xFF91A39E), fontSize: 10.5),
          ),
        ],
      ),
    );
  }
}

/// Small navigation button used inside the mobile footer.
class _FooterChip extends StatelessWidget {
  const _FooterChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.07),
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}
