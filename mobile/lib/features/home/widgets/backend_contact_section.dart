import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../api/home_public_api.dart';
import 'common.dart';

/// Backend-connected Contact Us section.
///
/// Validation mirrors the backend DTO and public web Home page.
///
/// @author Eman
class BackendContactSection extends StatefulWidget {
  const BackendContactSection({super.key, required this.onGetStartedPressed});

  final VoidCallback onGetStartedPressed;

  @override
  State<BackendContactSection> createState() => _BackendContactSectionState();
}

class _BackendContactSectionState extends State<BackendContactSection> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();

  final _emailController = TextEditingController();

  final _subjectController = TextEditingController();

  final _messageController = TextEditingController();

  bool _isSubmitting = false;

  String _status = 'idle';
  String _statusMessage = '';
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

  void _handleChanged(String _) {
    setState(() {
      if (_status != 'idle') {
        _status = 'idle';
        _statusMessage = '';
        _referenceId = '';
      }
    });
  }

  String? _validateName(String? value) {
    final text = (value ?? '').trim();

    if (text.length < 2) {
      return 'Please enter at least 2 characters.';
    }

    if (text.length > 100) {
      return 'Name must not exceed 100 characters.';
    }

    return null;
  }

  String? _validateEmail(String? value) {
    final email = (value ?? '').trim();

    if (!RegExp(r'^\S+@\S+\.\S+$').hasMatch(email)) {
      return 'Please enter a valid email address.';
    }

    if (email.length > 150) {
      return 'Email must not exceed 150 characters.';
    }

    return null;
  }

  String? _validateSubject(String? value) {
    final text = (value ?? '').trim();

    if (text.length < 3) {
      return 'Please enter at least 3 characters.';
    }

    if (text.length > 150) {
      return 'Subject must not exceed 150 characters.';
    }

    return null;
  }

  String? _validateMessage(String? value) {
    final text = (value ?? '').trim();

    if (text.length < 10) {
      return 'Please enter at least 10 characters.';
    }

    if (text.length > 2000) {
      return 'Message must not exceed 2,000 characters.';
    }

    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();

    if (_isSubmitting) {
      return;
    }

    if (!(_formKey.currentState?.validate() ?? false)) {
      setState(() {
        _status = 'error';
        _statusMessage = 'Please review the highlighted fields.';
      });

      return;
    }

    final submittedEmail = _emailController.text.trim().toLowerCase();

    setState(() {
      _isSubmitting = true;
      _status = 'loading';
      _statusMessage = '';
      _referenceId = '';
    });

    try {
      final response = await HomePublicApi.instance.submitContactMessage(
        fullName: _nameController.text,
        email: submittedEmail,
        subject: _subjectController.text,
        message: _messageController.text,
      );

      if (!mounted) {
        return;
      }

      final contactMessage = response['contactMessage'];

      final referenceId = contactMessage is Map
          ? contactMessage['id']?.toString().trim() ?? ''
          : '';

      _nameController.clear();
      _emailController.clear();
      _subjectController.clear();
      _messageController.clear();

      final responseMessage = response['message']?.toString().trim() ?? '';

      setState(() {
        _isSubmitting = false;
        _status = 'success';

        _statusMessage = responseMessage.isNotEmpty
            ? responseMessage
            : 'Your message was sent successfully. Our team will review it soon.';

        _referenceId = referenceId;
        _replyEmail = submittedEmail;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSubmitting = false;
        _status = 'error';

        _statusMessage = error is HomePublicException
            ? error.message
            : 'We could not send your message right now. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final messageLength = _messageController.text.length;

    final currentEmail = _emailController.text.trim();

    final currentEmailError = currentEmail.isEmpty
        ? null
        : _validateEmail(currentEmail);

    final isCurrentEmailValid =
        currentEmail.isNotEmpty && currentEmailError == null;

    final visibleReplyEmail = isCurrentEmailValid
        ? currentEmail
        : (_status == 'success' ? _replyEmail : '');

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 40, 16, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(
            text: 'START A MEANINGFUL CONVERSATION',
            icon: Icons.chat_bubble_outline_rounded,
          ),
          const SizedBox(height: 14),
          const Text(
            'Let’s turn your question into\na clearer next step.',
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
            'Share your question, feedback, or collaboration idea. The Voxidence team will review the context and reply to the email you provide.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13.3,
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
                    enabled: !_isSubmitting,
                    maxLength: 100,
                    textInputAction: TextInputAction.next,
                    onChanged: _handleChanged,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _emailController,
                    label: 'Email address',
                    hint: 'you@example.com',
                    icon: Icons.alternate_email_rounded,
                    validator: _validateEmail,
                    keyboardType: TextInputType.emailAddress,
                    enabled: !_isSubmitting,
                    maxLength: 150,
                    textInputAction: TextInputAction.next,
                    onChanged: _handleChanged,
                  ),

                  const SizedBox(height: 12),

                  _ContactField(
                    controller: _subjectController,
                    label: 'Subject',
                    hint: 'What would you like to discuss?',
                    icon: Icons.subject_rounded,
                    validator: _validateSubject,
                    enabled: !_isSubmitting,
                    maxLength: 150,
                    textInputAction: TextInputAction.next,
                    onChanged: _handleChanged,
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
                        '$messageLength/2000',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.5,
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
                    onChanged: _handleChanged,
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
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                    ),
                    decoration: const InputDecoration(
                      hintText:
                          'Share the details of your question, feedback, or request...',
                    ),
                  ),

                  // ---------------------------------------------------------
                  // Email reply information
                  // ---------------------------------------------------------
                  if (visibleReplyEmail.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.mail_outline_rounded,
                          size: 14,
                          color: AppColors.primaryDark,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              text: 'Reply will be sent to ',
                              children: [
                                TextSpan(
                                  text: visibleReplyEmail,
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
                  ]
                  // If the user typed an email but the format is invalid,
                  // never tell them that a reply will be sent to it.
                  else if (currentEmail.isNotEmpty &&
                      currentEmailError != null) ...[
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          size: 14,
                          color: AppColors.pink,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            currentEmailError,
                            style: const TextStyle(
                              color: AppColors.pink,
                              fontSize: 10.5,
                              height: 1.35,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],

                  if (_status == 'success' || _status == 'error') ...[
                    const SizedBox(height: 13),
                    _SubmitFeedback(
                      success: _status == 'success',
                      message: _statusMessage,
                      referenceId: _referenceId,
                    ),
                  ],

                  const SizedBox(height: 14),

                  PrimaryButton(
                    label: _isSubmitting
                        ? 'Sending message...'
                        : 'Send message',
                    onPressed: _isSubmitting ? null : _submit,
                    icon: _isSubmitting
                        ? Icons.hourglass_top_rounded
                        : Icons.arrow_upward_rounded,
                    expand: true,
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
    required this.enabled,
    required this.maxLength,
    required this.textInputAction,
    required this.onChanged,
    this.keyboardType,
  });

  final TextEditingController controller;

  final String label;

  final String hint;

  final IconData icon;

  final String? Function(String?) validator;

  final bool enabled;

  final int maxLength;

  final TextInputAction textInputAction;

  final ValueChanged<String> onChanged;

  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      enabled: enabled,
      maxLength: maxLength,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
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
        fontSize: 13.5,
        fontWeight: FontWeight.w600,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon, size: 19),
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
    final background = success ? AppColors.primarySoft : AppColors.pinkSoft;

    final border = success ? AppColors.primary : AppColors.pink;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: border.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            success
                ? Icons.check_circle_outline_rounded
                : Icons.error_outline_rounded,
            size: 18,
            color: border,
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
                  const SizedBox(height: 3),
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
