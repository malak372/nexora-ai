// Voxidence mobile legal information screens.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../widgets/auth_shell.dart';

enum LegalDocumentType { terms, privacy, security }

class LegalPage extends StatelessWidget {
  const LegalPage({super.key, required this.type});

  const LegalPage.terms({super.key}) : type = LegalDocumentType.terms;

  const LegalPage.privacy({super.key}) : type = LegalDocumentType.privacy;

  const LegalPage.security({super.key}) : type = LegalDocumentType.security;

  final LegalDocumentType type;

  String get _title {
    switch (type) {
      case LegalDocumentType.terms:
        return 'Terms of Service';

      case LegalDocumentType.privacy:
        return 'Privacy Policy';

      case LegalDocumentType.security:
        return 'Security Policy';
    }
  }

  String get _eyebrow {
    switch (type) {
      case LegalDocumentType.terms:
        return 'TERMS & RESPONSIBILITIES';

      case LegalDocumentType.privacy:
        return 'PRIVACY & DATA';

      case LegalDocumentType.security:
        return 'ACCOUNT & PLATFORM SECURITY';
    }
  }

  IconData get _icon {
    switch (type) {
      case LegalDocumentType.terms:
        return Icons.description_outlined;

      case LegalDocumentType.privacy:
        return Icons.privacy_tip_outlined;

      case LegalDocumentType.security:
        return Icons.security_rounded;
    }
  }

  List<_LegalSectionData> get _sections {
    switch (type) {
      case LegalDocumentType.terms:
        return const [
          _LegalSectionData(
            title: 'Using Voxidence responsibly',
            body:
                'Voxidence helps users discover, generate, evaluate, and manage software project ideas. You must provide accurate account information and use the platform only for lawful, academic, research, or business purposes.',
          ),
          _LegalSectionData(
            title: 'Your account and generated content',
            body:
                'You are responsible for protecting your login credentials and for reviewing AI-generated output before relying on it. Generated ideas may contain incomplete or inaccurate information and do not replace legal, financial, technical, or professional advice.',
          ),
          _LegalSectionData(
            title: 'Acceptable use',
            body:
                'You may not misuse the service, attempt unauthorized access, disrupt platform operation, scrape protected data, violate intellectual-property rights, or use Voxidence to create harmful or illegal content.',
          ),
          _LegalSectionData(
            title: 'Availability and changes',
            body:
                'Features, limits, pricing, and supported AI providers may change as the graduation project evolves. Access may be restricted when necessary to protect users, data, or platform security.',
          ),
        ];

      case LegalDocumentType.privacy:
        return const [
          _LegalSectionData(
            title: 'Information we process',
            body:
                'Voxidence may process your name, email address, account type, authentication data, generated ideas, publication activity, feedback, voting, ratings, payment records, and technical usage information needed to operate the platform.',
          ),
          _LegalSectionData(
            title: 'Why we use it',
            body:
                'We use this information to create and secure your account, deliver idea-generation features, save your workspace, support publications and interactions, process payments, improve reliability, and prevent abuse.',
          ),
          _LegalSectionData(
            title: 'AI and service providers',
            body:
                'Content submitted for generation may be sent to configured AI or infrastructure providers to perform the requested service. Payment information is handled through the configured payment flow, and sensitive payment credentials should not be entered into idea-generation fields.',
          ),
          _LegalSectionData(
            title: 'Your choices',
            body:
                'You may review or update supported profile information and use available account controls. Some records may need to be retained for security, audit, payment, or legal obligations.',
          ),
        ];

      case LegalDocumentType.security:
        return const [
          _LegalSectionData(
            title: 'Protecting your account',
            body:
                'Keep your password private and do not share verification or reset codes. Use a unique password and sign out from devices you no longer use or control.',
          ),
          _LegalSectionData(
            title: 'Authentication and sessions',
            body:
                'Voxidence uses account authentication, email verification, and session controls to limit access to protected workspace features. Password-reset links and verification codes should be treated as confidential.',
          ),
          _LegalSectionData(
            title: 'Data and platform protection',
            body:
                'Security controls are used to reduce unauthorized access, abuse, and accidental exposure. No online system can guarantee absolute security, so users should avoid submitting unnecessary sensitive information.',
          ),
          _LegalSectionData(
            title: 'Security concerns',
            body:
                'If you notice suspicious account activity, unauthorized access, or a security issue, stop using the affected session, change your password when appropriate, and report the issue through the available support channel.',
          ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LegalTopBar(title: _title),

          const SizedBox(height: 18),

          AuthCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AuthEyebrow(label: _eyebrow, icon: _icon),

                const SizedBox(height: 14),

                Text(
                  _title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 27,
                    height: 1.08,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.8,
                  ),
                ),

                const SizedBox(height: 7),

                const Text(
                  'Please review this information before creating your Voxidence account.',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11.6,
                    height: 1.5,
                  ),
                ),

                const SizedBox(height: 20),

                ..._sections.map(
                  (section) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _LegalSection(section: section),
                  ),
                ),

                const SizedBox(height: 6),

                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                    },
                    icon: const Icon(Icons.check_rounded, size: 18),
                    label: const Text(
                      'I understand',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w900,
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

class _LegalTopBar extends StatelessWidget {
  const _LegalTopBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Material(
          color: Colors.white.withValues(alpha: 0.78),
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            onTap: () {
              Navigator.pop(context);
            },
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.border),
              ),
              child: const Icon(
                Icons.arrow_back_rounded,
                size: 19,
                color: AppColors.primaryDark,
              ),
            ),
          ),
        ),

        const SizedBox(width: 10),

        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Voxidence',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 2),

              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LegalSection extends StatelessWidget {
  const _LegalSection({required this.section});

  final _LegalSectionData section;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: 0.52),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            section.title,
            style: const TextStyle(
              color: AppColors.primaryDeep,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),

          const SizedBox(height: 7),

          Text(
            section.body,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.8,
              height: 1.55,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _LegalSectionData {
  const _LegalSectionData({required this.title, required this.body});

  final String title;
  final String body;
}
