// Mobile-first navigation for the Voxidence Home screen.
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
          onClose: () => Navigator.pop(sheetContext),
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
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 3),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
          child: Container(
            height: 58,
            padding: const EdgeInsets.fromLTRB(8, 6, 7, 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.90),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withValues(alpha: 0.95)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: 0.055),
                  blurRadius: 18,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: onHomePressed,
                      borderRadius: BorderRadius.circular(16),
                      child: const Row(
                        children: [
                          BrandMark(size: 40),
                          SizedBox(width: 9),
                          Expanded(child: _BrandText()),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Material(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(15),
                  child: InkWell(
                    onTap: () => _openMenu(context),
                    borderRadius: BorderRadius.circular(15),
                    child: Container(
                      width: 43,
                      height: 43,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(15),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: const Icon(
                        Icons.menu_rounded,
                        size: 23,
                        color: AppColors.primaryDark,
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
            color: AppColors.primaryDark,
            fontSize: 16.5,
            height: 1,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.5,
          ),
        ),
        SizedBox(height: 4),
        Text(
          'Real voices. Better ideas.',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 9.2,
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
        borderRadius: BorderRadius.circular(28),
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
              BrandMark(size: 42),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Voxidence',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Explore Voxidence',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 18),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.home_outlined,
                  label: 'Home',
                  onTap: () => _run(onHome),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MenuTile(
                  icon: Icons.route_outlined,
                  label: 'Process',
                  onTap: () => _run(onHowItWorks),
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.auto_awesome_outlined,
                  label: 'About',
                  onTap: () => _run(onAbout),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MenuTile(
                  icon: Icons.grid_view_rounded,
                  label: 'Domains',
                  onTap: () => _run(onDomains),
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          Row(
            children: [
              Expanded(
                child: _MenuTile(
                  icon: Icons.lightbulb_outline_rounded,
                  label: 'Ideas',
                  onTap: () => _run(onIdeas),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _MenuTile(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'Contact',
                  onTap: () => _run(onContact),
                ),
              ),
            ],
          ),

          const SizedBox(height: 15),

          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => _run(onGenerate),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.lightbulb_outline_rounded, size: 18),
                  SizedBox(width: 7),
                  Text(
                    'Generate a free idea',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 8),

          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _run(onSignIn),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primaryDark,
                    side: const BorderSide(color: AppColors.borderStrong),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  child: const Text(
                    'Sign in',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: () => _run(onRegister),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  child: const Text(
                    'Join',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
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
      color: const Color(0xFFF6FAF8),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Icon(icon, size: 17, color: AppColors.primaryDark),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.5,
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
