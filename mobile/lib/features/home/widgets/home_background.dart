/// Background decoration for the public mobile Home screen.
///
/// @author Eman

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class HomeBackground extends StatelessWidget {
  const HomeBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xFFFCFAF8),
                    Color(0xFFFAFCFB),
                    Color(0xFFF3F8F6),
                  ],
                  stops: [0, 0.48, 1],
                ),
              ),
            ),
          ),
          Positioned(
            left: -125,
            top: 80,
            child: _Glow(
              size: 300,
              color: AppColors.pink.withValues(alpha: 0.08),
            ),
          ),
          Positioned(
            right: -160,
            top: 170,
            child: _Glow(
              size: 370,
              color: AppColors.primary.withValues(alpha: 0.12),
            ),
          ),
          Positioned(
            left: -160,
            top: 780,
            child: _Glow(
              size: 340,
              color: AppColors.primary.withValues(alpha: 0.08),
            ),
          ),
          Positioned(
            right: -130,
            top: 1040,
            child: _Glow(
              size: 280,
              color: AppColors.pink.withValues(alpha: 0.055),
            ),
          ),
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ImageFiltered(
      imageFilter: ImageFilter.blur(sigmaX: 75, sigmaY: 75),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}
