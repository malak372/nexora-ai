// Mobile navigation header for the Voxidence public Home screen.
//
// @author Eman

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import 'common.dart';

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
      barrierColor: AppColors.primaryDeep.withValues(alpha: 0.30),
      builder: (sheetContext) {
        return _MobileMenu(
          onClose: () {
            Navigator.pop(sheetContext);
          },
          onHome: onHomePressed,
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
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
            height: 76,
            padding: const EdgeInsets.fromLTRB(10, 8, 9, 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.91),
              borderRadius: BorderRadius.circular(26),
              border: Border.all(color: Colors.white.withValues(alpha: 0.98)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: 0.055),
                  blurRadius: 25,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: Material(
                    color: Colors.transparent,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      onTap: onHomePressed,
                      borderRadius: BorderRadius.circular(18),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 2),
                        child: Row(
                          children: [
                            // Smaller top logo.
                            BrandMark(size: 45),

                            SizedBox(width: 11),

                            Expanded(child: _BrandText()),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 8),

                Material(
                  color: const Color(0xFFF9FCFB),
                  borderRadius: BorderRadius.circular(19),
                  child: InkWell(
                    onTap: () {
                      _openMenu(context);
                    },
                    borderRadius: BorderRadius.circular(19),
                    child: Container(
                      width: 52,
                      height: 52,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(19),
                        border: Border.all(color: AppColors.border),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDeep.withValues(
                              alpha: 0.035,
                            ),
                            blurRadius: 12,
                            offset: const Offset(0, 5),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.menu_rounded,
                        size: 27,
                        color: AppColors.primaryDeep,
                      ),
                    ),
                  ),
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
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Voxidence',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.primaryDeep,
            fontSize: 18.5,
            height: 1,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.55,
          ),
        ),

        SizedBox(height: 5),

        Text(
          'Real voices. Better ideas.',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 10.4,
            height: 1,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _MobileMenu extends StatelessWidget {
  const _MobileMenu({
    required this.onClose,
    required this.onHome,
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

  final VoidCallback onHome;
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

    Future<void>.delayed(const Duration(milliseconds: 120), callback);
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      padding: EdgeInsets.fromLTRB(16, 12, 16, 15 + bottomInset),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDFC),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.16),
            blurRadius: 36,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.borderStrong,
              borderRadius: BorderRadius.circular(99),
            ),
          ),

          const SizedBox(height: 16),

          const Row(
            children: [
              BrandMark(size: 45),

              SizedBox(width: 11),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Voxidence',
                      style: TextStyle(
                        color: AppColors.primaryDeep,
                        fontSize: 17,
                        height: 1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    SizedBox(height: 5),

                    Text(
                      'Real voices. Better ideas.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.home_outlined,
                  label: 'Home',
                  onTap: () {
                    _run(onHome);
                  },
                ),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: _MenuTile(
                  icon: Icons.route_outlined,
                  label: 'How it works',
                  onTap: () {
                    _run(onHowItWorks);
                  },
                ),
              ),
            ],
          ),

          const SizedBox(height: 9),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.auto_awesome_outlined,
                  label: 'About',
                  onTap: () {
                    _run(onAbout);
                  },
                ),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: _MenuTile(
                  icon: Icons.grid_view_rounded,
                  label: 'Domains',
                  onTap: () {
                    _run(onDomains);
                  },
                ),
              ),
            ],
          ),

          const SizedBox(height: 9),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.lightbulb_outline,
                  label: 'Ideas',
                  onTap: () {
                    _run(onIdeas);
                  },
                ),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: _MenuTile(
                  icon: Icons.mail_outline_rounded,
                  label: 'Contact',
                  onTap: () {
                    _run(onContact);
                  },
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () {
                _run(onGenerate);
              },
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(17),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.lightbulb_outline_rounded, size: 19),

                  SizedBox(width: 8),

                  Text(
                    'Generate Free Idea',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 9),

          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    _run(onSignIn);
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(47),
                    foregroundColor: AppColors.primaryDark,
                    side: const BorderSide(color: AppColors.borderStrong),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  child: const Text(
                    'Login',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    _run(onRegister);
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(47),
                    foregroundColor: AppColors.primaryDark,
                    side: const BorderSide(color: AppColors.borderStrong),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
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

class _MenuTile extends StatelessWidget {
  const _MenuTile({
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
      color: AppColors.primarySoft.withValues(alpha: 0.55),
      borderRadius: BorderRadius.circular(17),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          height: 58,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.88),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 18, color: AppColors.primaryDark),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
