/// Mobile navigation for the Voxidence public Home screen.
///
/// @author Eman

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class HomeNavbar extends StatelessWidget {
  const HomeNavbar({
    super.key,
    required this.onHomePressed,
    required this.onHowItWorksPressed,
    required this.onAboutPressed,
    required this.onDomainsPressed,
    required this.onIdeasPressed,
    required this.onContactPressed,
    required this.onGeneratePressed,
    required this.onSignInPressed,
    required this.onRegisterPressed,
  });

  final VoidCallback onHomePressed;
  final VoidCallback onHowItWorksPressed;
  final VoidCallback onAboutPressed;
  final VoidCallback onDomainsPressed;
  final VoidCallback onIdeasPressed;
  final VoidCallback onContactPressed;
  final VoidCallback onGeneratePressed;
  final VoidCallback onSignInPressed;
  final VoidCallback onRegisterPressed;

  void _openMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: 0.24),
      builder: (sheetContext) {
        return _MobileMenu(
          onClose: () {
            Navigator.pop(sheetContext);
          },
          onHowItWorks: onHowItWorksPressed,
          onAbout: onAboutPressed,
          onDomains: onDomainsPressed,
          onIdeas: onIdeasPressed,
          onContact: onContactPressed,
          onGenerate: onGeneratePressed,
          onSignIn: onSignInPressed,
          onRegister: onRegisterPressed,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 11, 10, 11),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.87),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: Colors.white),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: 0.07),
                  blurRadius: 28,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: onHomePressed,
                    borderRadius: BorderRadius.circular(20),
                    child: const Row(
                      children: [
                        VoxidenceLeafLogo(size: 53),
                        SizedBox(width: 12),
                        Expanded(child: _BrandText()),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _MenuButton(
                  onPressed: () {
                    _openMenu(context);
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BrandText extends StatelessWidget {
  const _BrandText();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'Voxidence',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.primaryDeep,
            fontSize: 19,
            height: 1,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.55,
          ),
        ),
        SizedBox(height: 6),
        Text(
          'Turning Community Voices\ninto Evidence-Based Ideas.',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 10.5,
            height: 1.28,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _MenuButton extends StatelessWidget {
  const _MenuButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.88),
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: 0.07),
                blurRadius: 16,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: const Icon(
            Icons.menu_rounded,
            size: 28,
            color: AppColors.primaryDark,
          ),
        ),
      ),
    );
  }
}

class VoxidenceLeafLogo extends StatelessWidget {
  const VoxidenceLeafLogo({super.key, this.size = 53});

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
          colors: [Color(0xFFB4E2D8), Color(0xFF79C7BC), Color(0xFF63B7AF)],
        ),
        borderRadius: BorderRadius.circular(size * 0.30),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.17),
            blurRadius: 17,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Stack(
        children: [
          Center(
            child: SizedBox(
              width: size * 0.62,
              height: size * 0.62,
              child: CustomPaint(painter: _LeafLogoPainter()),
            ),
          ),
          Positioned(
            top: size * 0.15,
            right: size * 0.17,
            child: Container(
              width: size * 0.065,
              height: size * 0.065,
              decoration: BoxDecoration(
                color: const Color(0xFFFFF5DB).withValues(alpha: 0.95),
                shape: BoxShape.circle,
              ),
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
      ..color = Colors.white.withValues(alpha: 0.95)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final centerX = size.width * 0.5;

    final stem = Path()
      ..moveTo(centerX, size.height * 0.86)
      ..cubicTo(
        centerX * 0.98,
        size.height * 0.65,
        centerX * 1.02,
        size.height * 0.42,
        centerX,
        size.height * 0.19,
      );

    canvas.drawPath(stem, paint);

    final upperLeaf = Path()
      ..moveTo(centerX, size.height * 0.46)
      ..cubicTo(
        size.width * 0.62,
        size.height * 0.28,
        size.width * 0.82,
        size.height * 0.20,
        size.width * 0.82,
        size.height * 0.20,
      )
      ..cubicTo(
        size.width * 0.79,
        size.height * 0.43,
        size.width * 0.66,
        size.height * 0.55,
        centerX,
        size.height * 0.46,
      );

    canvas.drawPath(upperLeaf, paint);

    final leftLeaf = Path()
      ..moveTo(centerX, size.height * 0.61)
      ..cubicTo(
        size.width * 0.35,
        size.height * 0.43,
        size.width * 0.16,
        size.height * 0.43,
        size.width * 0.16,
        size.height * 0.43,
      )
      ..cubicTo(
        size.width * 0.21,
        size.height * 0.65,
        size.width * 0.35,
        size.height * 0.70,
        centerX,
        size.height * 0.61,
      );

    canvas.drawPath(leftLeaf, paint);

    final rightLeaf = Path()
      ..moveTo(centerX, size.height * 0.72)
      ..cubicTo(
        size.width * 0.62,
        size.height * 0.57,
        size.width * 0.79,
        size.height * 0.57,
        size.width * 0.81,
        size.height * 0.57,
      )
      ..cubicTo(
        size.width * 0.76,
        size.height * 0.75,
        size.width * 0.63,
        size.height * 0.80,
        centerX,
        size.height * 0.72,
      );

    canvas.drawPath(rightLeaf, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _MobileMenu extends StatelessWidget {
  const _MobileMenu({
    required this.onClose,
    required this.onHowItWorks,
    required this.onAbout,
    required this.onDomains,
    required this.onIdeas,
    required this.onContact,
    required this.onGenerate,
    required this.onSignIn,
    required this.onRegister,
  });

  final VoidCallback onClose;
  final VoidCallback onHowItWorks;
  final VoidCallback onAbout;
  final VoidCallback onDomains;
  final VoidCallback onIdeas;
  final VoidCallback onContact;
  final VoidCallback onGenerate;
  final VoidCallback onSignIn;
  final VoidCallback onRegister;

  void _run(VoidCallback callback) {
    onClose();

    Future<void>.delayed(const Duration(milliseconds: 140), callback);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 22),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDFC),
        borderRadius: BorderRadius.circular(30),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 38,
            offset: const Offset(0, -10),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 42,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.borderStrong,
              borderRadius: BorderRadius.circular(99),
            ),
          ),
          const SizedBox(height: 17),
          const Row(
            children: [
              VoxidenceLeafLogo(size: 44),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Explore Voxidence',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Community evidence into focused ideas.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _MenuItem(
            icon: Icons.route_outlined,
            label: 'How it works',
            onTap: () {
              _run(onHowItWorks);
            },
          ),
          _MenuItem(
            icon: Icons.info_outline_rounded,
            label: 'About',
            onTap: () {
              _run(onAbout);
            },
          ),
          _MenuItem(
            icon: Icons.grid_view_rounded,
            label: 'Domains',
            onTap: () {
              _run(onDomains);
            },
          ),
          _MenuItem(
            icon: Icons.lightbulb_outline_rounded,
            label: 'Ideas',
            onTap: () {
              _run(onIdeas);
            },
          ),
          _MenuItem(
            icon: Icons.mail_outline_rounded,
            label: 'Contact',
            onTap: () {
              _run(onContact);
            },
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () {
              _run(onGenerate);
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.primaryDark,
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(54),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.auto_awesome_rounded, size: 18),
                SizedBox(width: 8),
                Text(
                  'Generate your idea',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    _run(onSignIn);
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(50),
                    foregroundColor: AppColors.primaryDeep,
                    side: const BorderSide(color: AppColors.borderStrong),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                  child: const Text(
                    'Sign in',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.tonal(
                  onPressed: () {
                    _run(onRegister);
                  },
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(50),
                    backgroundColor: AppColors.primarySoft,
                    foregroundColor: AppColors.primaryDark,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                  child: const Text(
                    'Register',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 11),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: AppColors.primaryDark, size: 20),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const Icon(
                Icons.arrow_forward_ios_rounded,
                color: AppColors.textMuted,
                size: 14,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
