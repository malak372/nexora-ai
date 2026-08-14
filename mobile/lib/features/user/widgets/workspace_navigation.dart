import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

enum WorkspaceSection { home, discover, generate, ideas, profile }

class WorkspaceRouteFrame extends StatelessWidget {
  const WorkspaceRouteFrame({super.key, required this.child, this.selected});

  final Widget child;
  final WorkspaceSection? selected;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      backgroundColor: AppColors.background,
      body: child,
      bottomNavigationBar: PersistentWorkspaceBottomNav(selected: selected),
    );
  }
}

class WorkspaceBackButton extends StatelessWidget {
  const WorkspaceBackButton({
    super.key,
    required this.onPressed,
    this.semanticLabel = 'Back',
    this.size = 42,
  });

  final VoidCallback onPressed;
  final String semanticLabel;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(15),
          child: Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .90),
              borderRadius: BorderRadius.circular(15),
              border: Border.all(
                color: AppColors.border.withValues(alpha: .95),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .06),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(
              Icons.arrow_back_rounded,
              size: 20,
              color: AppColors.primaryDeep,
            ),
          ),
        ),
      ),
    );
  }
}

class PersistentWorkspaceBottomNav extends StatelessWidget {
  const PersistentWorkspaceBottomNav({
    super.key,
    this.selected,
    this.onSelected,
  });

  final WorkspaceSection? selected;
  final ValueChanged<WorkspaceSection>? onSelected;

  void _select(BuildContext context, WorkspaceSection section) {
    if (onSelected != null) {
      onSelected!(section);
      return;
    }

    final routeName = switch (section) {
      WorkspaceSection.home => '/normal/dashboard',
      WorkspaceSection.discover => '/normal/discover',
      WorkspaceSection.generate => '/normal/generate',
      WorkspaceSection.ideas => '/normal/ideas',
      WorkspaceSection.profile => '/normal/profile',
    };

    Navigator.of(
      context,
    ).pushNamedAndRemoveUntil(routeName, (route) => route.isFirst);
  }

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
                    color: Colors.white.withValues(alpha: .965),
                    borderRadius: BorderRadius.circular(30),
                    border: Border.all(color: Colors.white),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primaryDeep.withValues(alpha: .10),
                        blurRadius: 30,
                        offset: const Offset(0, 12),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _WorkspaceNavItem(
                          icon: Icons.home_rounded,
                          label: 'Home',
                          selected: selected == WorkspaceSection.home,
                          onTap: () => _select(context, WorkspaceSection.home),
                        ),
                      ),
                      Expanded(
                        child: _WorkspaceNavItem(
                          icon: Icons.search_rounded,
                          label: 'Discover',
                          selected: selected == WorkspaceSection.discover,
                          onTap: () =>
                              _select(context, WorkspaceSection.discover),
                        ),
                      ),
                      const SizedBox(width: 64),
                      Expanded(
                        child: _WorkspaceNavItem(
                          icon: Icons.lightbulb_outline_rounded,
                          selectedIcon: Icons.lightbulb_rounded,
                          label: 'My Ideas',
                          selected: selected == WorkspaceSection.ideas,
                          onTap: () => _select(context, WorkspaceSection.ideas),
                        ),
                      ),
                      Expanded(
                        child: _WorkspaceNavItem(
                          icon: Icons.person_outline_rounded,
                          selectedIcon: Icons.person_rounded,
                          label: 'Profile',
                          selected: selected == WorkspaceSection.profile,
                          onTap: () =>
                              _select(context, WorkspaceSection.profile),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              top: 4,
              child: _GenerateOrb(
                selected: selected == WorkspaceSection.generate,
                onTap: () => _select(context, WorkspaceSection.generate),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GenerateOrb extends StatelessWidget {
  const _GenerateOrb({required this.selected, required this.onTap});

  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              width: selected ? 60 : 58,
              height: selected ? 60 : 58,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF77CEC7),
                    Color(0xFF5CBDB9),
                    Color(0xFF499F99),
                  ],
                ),
                border: Border.all(color: Colors.white, width: 4),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(
                      alpha: selected ? .31 : .23,
                    ),
                    blurRadius: selected ? 22 : 18,
                    spreadRadius: selected ? 1 : 0,
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
                      color: const Color(0xFFFFE49C).withValues(alpha: .96),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 1),
        Text(
          'Generate',
          style: TextStyle(
            color: selected ? AppColors.primaryDeep : AppColors.textMuted,
            fontSize: 8.4,
            height: 1,
            fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _WorkspaceNavItem extends StatelessWidget {
  const _WorkspaceNavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.selectedIcon,
  });

  final IconData icon;
  final IconData? selectedIcon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.primaryDark : AppColors.textMuted;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          margin: const EdgeInsets.symmetric(horizontal: 2, vertical: 5),
          padding: const EdgeInsets.fromLTRB(2, 6, 2, 5),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .58)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                selected ? (selectedIcon ?? icon) : icon,
                size: 21,
                color: color,
              ),
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
