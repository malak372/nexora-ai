// Contact and footer components for the Voxidence mobile home screen.
//
// Contact Us is connected to the same backend flow used by the web application.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/theme/app_theme.dart';
import '../api/home_public_api.dart';
import 'common.dart';

class ContactSection extends StatefulWidget {
  const ContactSection({super.key, required this.onGetStartedPressed});

  final VoidCallback onGetStartedPressed;

  @override
  State<ContactSection> createState() {
    return _ContactSectionState();
  }
}

class _ContactSectionState extends State<ContactSection> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();

  bool _isSubmitting = false;

  String _submitStatus = 'idle';
  String _submitMessage = '';
  String _referenceId = '';
  String _replyEmail = '';

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _subjectController.dispose();
    _messageController.dispose();

    super.dispose();
  }

  void _handleFieldChanged(String _) {
    if (!mounted) {
      return;
    }

    setState(() {
      if (_submitStatus != 'idle') {
        _submitStatus = 'idle';
        _submitMessage = '';
        _referenceId = '';
      }
    });
  }

  String? _validateName(String? value) {
    final name = (value ?? '').trim();

    if (name.length < 2) {
      return 'Please enter at least 2 characters.';
    }

    if (name.length > 100) {
      return 'Name must not exceed 100 characters.';
    }

    return null;
  }

  String? _validateEmail(String? value) {
    final email = (value ?? '').trim();

    if (email.isEmpty) {
      return 'Email is required.';
    }

    final validEmail = RegExp(r'^\S+@\S+\.\S+$').hasMatch(email);

    if (!validEmail) {
      return 'Please enter a valid email address.';
    }

    if (email.length > 150) {
      return 'Email must not exceed 150 characters.';
    }

    return null;
  }

  String? _validateSubject(String? value) {
    final subject = (value ?? '').trim();

    if (subject.length < 3) {
      return 'Please enter at least 3 characters.';
    }

    if (subject.length > 150) {
      return 'Subject must not exceed 150 characters.';
    }

    return null;
  }

  String? _validateMessage(String? value) {
    final message = (value ?? '').trim();

    if (message.length < 10) {
      return 'Please enter at least 10 characters.';
    }

    if (message.length > 2000) {
      return 'Message must not exceed 2,000 characters.';
    }

    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (_isSubmitting) {
      return;
    }

    final isValid = _formKey.currentState?.validate() ?? false;

    if (!isValid) {
      setState(() {
        _submitStatus = 'error';
        _submitMessage = 'Please review the highlighted fields.';
        _referenceId = '';
      });

      return;
    }

    final fullName = _nameController.text.trim();

    final email = _emailController.text.trim().toLowerCase();

    final subject = _subjectController.text.trim();

    final message = _messageController.text.trim();

    setState(() {
      _isSubmitting = true;
      _submitStatus = 'loading';
      _submitMessage = '';
      _referenceId = '';
    });

    try {
      final response = await HomePublicApi.instance.submitContactMessage(
        fullName: fullName,
        email: email,
        subject: subject,
        message: message,
      );

      if (!mounted) {
        return;
      }

      String referenceId = '';

      final contactMessage = response['contactMessage'];

      if (contactMessage is Map) {
        referenceId = contactMessage['id']?.toString().trim() ?? '';
      }

      final backendMessage = response['message']?.toString().trim() ?? '';

      _nameController.clear();
      _emailController.clear();
      _subjectController.clear();
      _messageController.clear();

      setState(() {
        _isSubmitting = false;
        _submitStatus = 'success';

        _submitMessage = backendMessage.isNotEmpty
            ? backendMessage
            : 'Your message was sent successfully. Our team will review it soon.';

        _referenceId = referenceId;
        _replyEmail = email;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSubmitting = false;
        _submitStatus = 'error';

        if (error is HomePublicException) {
          _submitMessage = error.message;
        } else {
          _submitMessage =
              'We could not send your message right now. Please try again.';
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final visibleEmail = _emailController.text.trim().isNotEmpty
        ? _emailController.text.trim()
        : _replyEmail;

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
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      HomeIconBox(
                        icon: Icons.send_outlined,
                        size: 42,
                        iconSize: 19,
                      ),
                      SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Contact Voxidence',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Tell us how we can help.',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 17),

                  _ContactField(
                    controller: _nameController,
                    label: 'Full name',
                    hint: 'Your full name',
                    icon: Icons.person_outline_rounded,
                    validator: _validateName,
                    keyboardType: TextInputType.name,
                    textInputAction: TextInputAction.next,
                    maxLength: 100,
                    enabled: !_isSubmitting,
                    onChanged: _handleFieldChanged,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _emailController,
                    label: 'Email address',
                    hint: 'you@example.com',
                    icon: Icons.alternate_email_rounded,
                    keyboardType: TextInputType.emailAddress,
                    validator: _validateEmail,
                    textInputAction: TextInputAction.next,
                    maxLength: 150,
                    enabled: !_isSubmitting,
                    onChanged: _handleFieldChanged,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _subjectController,
                    label: 'Subject',
                    hint: 'What would you like to discuss?',
                    icon: Icons.subject_rounded,
                    validator: _validateSubject,
                    textInputAction: TextInputAction.next,
                    maxLength: 150,
                    enabled: !_isSubmitting,
                    onChanged: _handleFieldChanged,
                  ),

                  const SizedBox(height: 12),

                  Row(
                    children: [
                      const Text(
                        'Message',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${_messageController.text.length}/2000',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 7),

                  TextFormField(
                    controller: _messageController,
                    validator: _validateMessage,
                    enabled: !_isSubmitting,
                    minLines: 4,
                    maxLines: 5,
                    maxLength: 2000,
                    textInputAction: TextInputAction.newline,
                    keyboardType: TextInputType.multiline,
                    onChanged: _handleFieldChanged,
                    buildCounter:
                        (
                          context, {
                          required currentLength,
                          required isFocused,
                          required maxLength,
                        }) {
                          return null;
                        },
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                    decoration: const InputDecoration(
                      hintText:
                          'Share the details of your question, feedback, or request...',
                      alignLabelWithHint: true,
                      filled: true,
                      fillColor: Color(0xFFF8FBFA),
                    ),
                  ),

                  if (visibleEmail.isNotEmpty) ...[
                    const SizedBox(height: 10),

                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.mail_outline_rounded,
                          size: 14,
                          color: AppColors.textMuted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              text: 'Reply will be sent to ',
                              children: [
                                TextSpan(
                                  text: visibleEmail,
                                  style: const TextStyle(
                                    color: AppColors.primaryDark,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ],
                            ),
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 10.5,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],

                  if (_submitStatus == 'success' ||
                      _submitStatus == 'error') ...[
                    const SizedBox(height: 13),

                    _SubmitFeedback(
                      success: _submitStatus == 'success',
                      message: _submitMessage,
                      referenceId: _referenceId,
                    ),
                  ],

                  const SizedBox(height: 14),

                  AbsorbPointer(
                    absorbing: _isSubmitting,
                    child: AnimatedOpacity(
                      duration: const Duration(milliseconds: 180),
                      opacity: _isSubmitting ? 0.72 : 1,
                      child: PrimaryButton(
                        label: _isSubmitting
                            ? 'Sending message...'
                            : 'Send message',
                        onPressed: _submit,
                        icon: _isSubmitting
                            ? Icons.hourglass_top_rounded
                            : Icons.arrow_upward_rounded,
                        expand: true,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 15),

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
                    color: AppColors.primary,
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
                  color: AppColors.primary,
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

class _ContactField extends StatelessWidget {
  const _ContactField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    required this.validator,
    required this.textInputAction,
    required this.maxLength,
    required this.enabled,
    required this.onChanged,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final String? Function(String?) validator;
  final TextInputType? keyboardType;
  final TextInputAction textInputAction;
  final int maxLength;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      maxLength: maxLength,
      enabled: enabled,
      onChanged: onChanged,
      buildCounter:
          (
            context, {
            required currentLength,
            required isFocused,
            required maxLength,
          }) {
            return null;
          },
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon, size: 19),
        filled: true,
        fillColor: const Color(0xFFF8FBFA),
      ),
    );
  }
}

class _SubmitFeedback extends StatelessWidget {
  const _SubmitFeedback({
    required this.success,
    required this.message,
    required this.referenceId,
  });

  final bool success;
  final String message;
  final String referenceId;

  @override
  Widget build(BuildContext context) {
    final accent = success ? AppColors.primary : AppColors.pink;

    final background = success ? AppColors.primarySoft : AppColors.pinkSoft;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            success
                ? Icons.check_circle_outline_rounded
                : Icons.error_outline_rounded,
            size: 18,
            color: accent,
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.8,
                    height: 1.4,
                    fontWeight: FontWeight.w700,
                  ),
                ),

                if (referenceId.isNotEmpty) ...[
                  const SizedBox(height: 4),

                  Text(
                    'Reference: $referenceId',
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 9.8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

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
      margin: const EdgeInsets.only(top: 24),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: AppColors.primaryDeep.withValues(alpha: 0.10)),
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            left: -72,
            top: 8,
            child: Container(
              width: 185,
              height: 185,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.07),
              ),
            ),
          ),

          Positioned(
            right: -76,
            bottom: 30,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: 0.06),
              ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.fromLTRB(18, 25, 18, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _FooterBrand(onHomePressed: onHomePressed),

                const SizedBox(height: 23),

                _FooterExplore(
                  onHowItWorksPressed: onHowItWorksPressed,
                  onAboutPressed: onAboutPressed,
                  onDomainsPressed: onDomainsPressed,
                  onIdeasPressed: onIdeasPressed,
                ),

                const SizedBox(height: 22),

                _FooterContact(onContactPressed: onContactPressed),

                const SizedBox(height: 22),

                Container(
                  height: 1,
                  color: AppColors.primaryDeep.withValues(alpha: 0.10),
                ),

                const SizedBox(height: 13),

                const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        '© 2026 Voxidence. All rights reserved.',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.4,
                          height: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),

                    SizedBox(width: 12),

                    Expanded(
                      child: Text(
                        'Community signal to evidence-backed direction.',
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.4,
                          height: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FooterBrand extends StatelessWidget {
  const _FooterBrand({required this.onHomePressed});

  final VoidCallback onHomePressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onHomePressed,
            borderRadius: BorderRadius.circular(16),
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  BrandMark(size: 48),

                  SizedBox(width: 11),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Voxidence',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 18.5,
                            height: 1,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.55,
                          ),
                        ),

                        SizedBox(height: 5),

                        Text(
                          'Community voices. Verified direction.',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 11.2,
                            height: 1.25,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),

        const SizedBox(height: 13),

        const Text(
          'We listen before we generate — turning real needs into software ideas worth building.',
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 12.4,
            height: 1.55,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _FooterExplore extends StatelessWidget {
  const _FooterExplore({
    required this.onHowItWorksPressed,
    required this.onAboutPressed,
    required this.onDomainsPressed,
    required this.onIdeasPressed,
  });

  final VoidCallback onHowItWorksPressed;
  final VoidCallback onAboutPressed;
  final VoidCallback onDomainsPressed;
  final VoidCallback onIdeasPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FooterLabel(
          text: 'EXPLORE VOXIDENCE',
          icon: Icons.auto_awesome_rounded,
        ),

        const SizedBox(height: 13),

        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _FooterLink(
                    label: 'How it works',
                    onTap: onHowItWorksPressed,
                  ),

                  const SizedBox(height: 11),

                  _FooterLink(
                    label: 'Opportunity domains',
                    onTap: onDomainsPressed,
                  ),
                ],
              ),
            ),

            const SizedBox(width: 16),

            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _FooterLink(label: 'Why Voxidence', onTap: onAboutPressed),

                  const SizedBox(height: 11),

                  _FooterLink(label: 'Community ideas', onTap: onIdeasPressed),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _FooterContact extends StatelessWidget {
  const _FooterContact({required this.onContactPressed});

  final VoidCallback onContactPressed;

  static const String _email = 'voxidence@gmail.com';

  Future<void> _openEmail(BuildContext context) async {
    final uri = Uri(
      scheme: 'mailto',
      path: _email,
      queryParameters: {'subject': 'Voxidence inquiry'},
    );

    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);

      if (!opened && context.mounted) {
        _showEmailFallback(context);
      }
    } catch (_) {
      if (context.mounted) {
        _showEmailFallback(context);
      }
    }
  }

  void _showEmailFallback(BuildContext context) {
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
            'Email us at voxidence@gmail.com',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(15, 15, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.62),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.18)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.035),
            blurRadius: 20,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _FooterLabel(text: 'START A CONVERSATION'),

          const SizedBox(height: 8),

          const Text(
            'Questions, feedback, or collaboration in mind?',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11.8,
              height: 1.45,
            ),
          ),

          const SizedBox(height: 12),

          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => _openEmail(context),
              borderRadius: BorderRadius.circular(13),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Container(
                      width: 35,
                      height: 35,
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(
                          color: AppColors.primary.withValues(alpha: 0.18),
                        ),
                      ),
                      child: const Icon(
                        Icons.mail_outline_rounded,
                        size: 17,
                        color: AppColors.primaryDark,
                      ),
                    ),

                    const SizedBox(width: 9),

                    const Expanded(
                      child: Text(
                        _email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 11.8,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),

                    const SizedBox(width: 7),

                    const Icon(
                      Icons.open_in_new_rounded,
                      size: 14,
                      color: AppColors.primaryDark,
                    ),
                  ],
                ),
              ),
            ),
          ),

          const SizedBox(height: 12),

          Align(
            alignment: Alignment.centerLeft,
            child: Material(
              color: Colors.white.withValues(alpha: 0.86),
              borderRadius: BorderRadius.circular(99),
              child: InkWell(
                onTap: onContactPressed,
                borderRadius: BorderRadius.circular(99),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 13,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: 0.20),
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Contact our team',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 11.2,
                          fontWeight: FontWeight.w900,
                        ),
                      ),

                      SizedBox(width: 6),

                      Icon(
                        Icons.north_east_rounded,
                        size: 15,
                        color: AppColors.primaryDark,
                      ),
                    ],
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

class _FooterLabel extends StatelessWidget {
  const _FooterLabel({required this.text, this.icon});

  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 6),
        ],

        Flexible(
          child: Text(
            text,
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9.5,
              height: 1,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.05,
            ),
          ),
        ),
      ],
    );
  }
}

class _FooterLink extends StatelessWidget {
  const _FooterLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11.8,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),

              const SizedBox(width: 4),

              const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 9,
                color: AppColors.primary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
