// First-frame startup loader for Voxidence.
//
// This widget is intentionally lightweight and contains no plugin calls. It is
// the first Flutter frame so Android's native starting window can hand off to
// a real loading experience immediately.
//
// @author Eman

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class AppLaunchExperience extends StatefulWidget {
  const AppLaunchExperience({super.key});

  @override
  State<AppLaunchExperience> createState() => _AppLaunchExperienceState();
}

class _AppLaunchExperienceState extends State<AppLaunchExperience>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFEDF7F3),
      body: Stack(
        fit: StackFit.expand,
        children: [
          const _StartupBackdrop(),
          SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: AnimatedBuilder(
                  animation: _controller,
                  builder: (context, _) {
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 154,
                          height: 154,
                          child: CustomPaint(
                            painter: _CommunityOrbitPainter(
                              progress: _controller.value,
                            ),
                            child: Center(
                              child: _CenterPulse(
                                progress: _controller.value,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'Preparing your workspace',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 20,
                            height: 1.05,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.45,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Connecting your ideas, evidence and community signals.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 10.8,
                            height: 1.45,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 22),
                        _ProgressRail(progress: _controller.value),
                        const SizedBox(height: 13),
                        const Text(
                          'VOXIDENCE  •  EVIDENCE-FIRST',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 7.3,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.25,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CenterPulse extends StatelessWidget {
  const _CenterPulse({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    final pulse = (math.sin(progress * math.pi * 2) + 1) / 2;

    return Transform.scale(
      scale: .96 + (pulse * .045),
      child: Container(
        width: 58,
        height: 58,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: const Color(0xFFF9FFFC),
          border: Border.all(
            color: AppColors.primary.withValues(alpha: .23),
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .08 + pulse * .05),
              blurRadius: 25,
              spreadRadius: 2,
              offset: const Offset(0, 9),
            ),
          ],
        ),
        child: Center(
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 23,
                height: 23,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: .13),
                ),
              ),
              Container(
                width: 8.5,
                height: 8.5,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primaryDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProgressRail extends StatelessWidget {
  const _ProgressRail({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    final t = Curves.easeInOut.transform(progress);

    return Container(
      width: 132,
      height: 7,
      padding: const EdgeInsets.all(1.5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .70),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final travel = math.max(0.0, constraints.maxWidth - 34);
          return Stack(
            children: [
              Positioned(
                left: travel * t,
                top: 0,
                bottom: 0,
                child: Container(
                  width: 34,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF8FD3CA),
                        Color(0xFF4EB7B0),
                        Color(0xFFAFCDBB),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StartupBackdrop extends StatelessWidget {
  const _StartupBackdrop();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFEDF7F3),
            Color(0xFFF7FBF8),
            Color(0xFFF3F8F5),
          ],
        ),
      ),
    );
  }
}

class _CommunityOrbitPainter extends CustomPainter {
  const _CommunityOrbitPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final orbitPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = AppColors.primary.withValues(alpha: .13);

    canvas.drawCircle(center, 50, orbitPaint);
    canvas.drawCircle(
      center,
      66,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = .8
        ..color = AppColors.sage.withValues(alpha: .11),
    );

    const radii = [50.0, 50.0, 66.0, 66.0];
    const phases = [0.0, 1.55, 3.15, 4.7];
    const nodeSizes = [5.0, 4.0, 4.5, 3.6];

    for (var i = 0; i < phases.length; i++) {
      final direction = i.isEven ? 1.0 : -1.0;
      final angle = phases[i] + direction * progress * math.pi * 2;
      final p = Offset(
        center.dx + math.cos(angle) * radii[i],
        center.dy + math.sin(angle) * radii[i],
      );

      final glow = Paint()
        ..color = (i == 0 ? AppColors.primary : AppColors.sage)
            .withValues(alpha: .12);
      canvas.drawCircle(p, nodeSizes[i] + 5, glow);

      final node = Paint()
        ..color = i == 0
            ? AppColors.primaryDark
            : AppColors.primary.withValues(alpha: .78);
      canvas.drawCircle(p, nodeSizes[i], node);
    }

    final sparkAngle = (progress * math.pi * 2) + .7;
    final spark = Offset(
      center.dx + math.cos(sparkAngle) * 36,
      center.dy + math.sin(sparkAngle) * 36,
    );
    canvas.drawCircle(
      spark,
      2.3,
      Paint()..color = const Color(0xFFD5B36B).withValues(alpha: .85),
    );
  }

  @override
  bool shouldRepaint(covariant _CommunityOrbitPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}
