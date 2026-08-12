// Ambient background for the public mobile Home screen.
//
// @author Eman

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
                    Color(0xFFFFFEFC),
                    Color(0xFFFBFAF7),
                    Color(0xFFFFFDFC),
                  ],
                  stops: [0, 0.54, 1],
                ),
              ),
            ),
          ),

          Positioned(
            right: -120,
            top: 150,
            child: _Glow(
              size: 300,
              color: const Color(0xFFCDE9E4).withValues(alpha: 0.30),
            ),
          ),

          Positioned(
            left: -145,
            top: 590,
            child: _Glow(
              size: 285,
              color: AppColors.pinkLight.withValues(alpha: 0.16),
            ),
          ),

          Positioned(
            right: -160,
            top: 980,
            child: _Glow(
              size: 320,
              color: const Color(0xFFCDE9E4).withValues(alpha: 0.17),
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
      imageFilter: ImageFilter.blur(sigmaX: 76, sigmaY: 76),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}
