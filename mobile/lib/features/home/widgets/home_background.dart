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
                    Color(0xFFFFFDFC),
                    Color(0xFFFAF9F6),
                    Color(0xFFFFFDFC),
                  ],
                  stops: [0, 0.50, 1],
                ),
              ),
            ),
          ),
          const Positioned.fill(child: _DotField()),
          Positioned(
            right: -140,
            top: 120,
            child: _Glow(
              size: 330,
              color: const Color(0xFFB7DDD8).withValues(alpha: 0.38),
            ),
          ),
          Positioned(
            left: -155,
            top: 480,
            child: _Glow(
              size: 300,
              color: AppColors.pinkLight.withValues(alpha: 0.28),
            ),
          ),
          Positioned(
            right: -160,
            top: 1040,
            child: _Glow(
              size: 330,
              color: const Color(0xFFB7DDD8).withValues(alpha: 0.20),
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
      imageFilter: ImageFilter.blur(sigmaX: 70, sigmaY: 70),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

class _DotField extends StatelessWidget {
  const _DotField();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: _DotFieldPainter());
  }
}

class _DotFieldPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: 0.05)
      ..style = PaintingStyle.fill;

    const spacing = 26.0;

    for (double y = 28; y < size.height; y += spacing) {
      for (double x = 18; x < size.width; x += spacing) {
        canvas.drawCircle(Offset(x, y), 0.9, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}
