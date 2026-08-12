// Floating bottom navigation for the public Voxidence mobile Home.
//
// @author Eman

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class HomeBottomNav extends StatelessWidget {
  const HomeBottomNav({
    super.key,
    required this.onHomePressed,
    required this.onDiscoverPressed,
    required this.onGeneratePressed,
    required this.onMyIdeasPressed,
    required this.onProfilePressed,
  });

  final VoidCallback onHomePressed;
  final VoidCallback onDiscoverPressed;
  final VoidCallback onGeneratePressed;
  final VoidCallback onMyIdeasPressed;
  final VoidCallback onProfilePressed;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(14, 0, 14, 10),
      child: SizedBox(
        height: 84,
        child: Stack(
          alignment: Alignment.bottomCenter,
          clipBehavior: Clip.none,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(30),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 22, sigmaY: 22),
                child: Container(
                  height: 70,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.96),
                    borderRadius: BorderRadius.circular(30),
                    border: Border.all(color: Colors.white),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primaryDeep.withValues(alpha: 0.10),
                        blurRadius: 30,
                        offset: const Offset(0, 12),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _NavItem(
                          icon: Icons.home_rounded,
                          label: 'Home',
                          selected: true,
                          onTap: onHomePressed,
                        ),
                      ),

                      Expanded(
                        child: _NavItem(
                          icon: Icons.search_rounded,
                          label: 'Discover',
                          onTap: onDiscoverPressed,
                        ),
                      ),

                      const SizedBox(width: 64),

                      Expanded(
                        child: _NavItem(
                          icon: Icons.lightbulb_outline_rounded,
                          label: 'My Ideas',
                          onTap: onMyIdeasPressed,
                        ),
                      ),

                      Expanded(
                        child: _NavItem(
                          icon: Icons.person_outline_rounded,
                          label: 'Profile',
                          onTap: onProfilePressed,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            Positioned(top: 4, child: _GenerateOrb(onTap: onGeneratePressed)),
          ],
        ),
      ),
    );
  }
}

class _GenerateOrb extends StatelessWidget {
  const _GenerateOrb({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 58,
          height: 58,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF77CEC7), Color(0xFF5CBDB9), Color(0xFF499F99)],
            ),
            border: Border.all(color: Colors.white, width: 4),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.25),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(
                Icons.lightbulb_outline_rounded,
                size: 25,
                color: Colors.white,
              ),

              Positioned(
                top: 12,
                right: 13,
                child: Icon(
                  Icons.auto_awesome_rounded,
                  size: 6,
                  color: const Color(0xFFFFE49C).withValues(alpha: 0.95),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.primaryDark : AppColors.textMuted;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(2, 10, 2, 7),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 21, color: color),

              const SizedBox(height: 5),

              Text(
                label,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.fade,
                style: TextStyle(
                  color: color,
                  fontSize: 8.7,
                  height: 1,
                  fontWeight: selected ? FontWeight.w900 : FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
