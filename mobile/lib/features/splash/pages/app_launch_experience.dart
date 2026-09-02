import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_theme.dart';

class AppLaunchExperience extends StatelessWidget {
  const AppLaunchExperience({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FCFB),
      body: Stack(
        fit: StackFit.expand,
        children: [
          const CustomPaint(painter: _SplashBackgroundPainter()),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final width = constraints.maxWidth;
                final height = constraints.maxHeight;
                final illustrationSize = math.min(width * .67, 255.0);
                final brandMarkSize = math.max(31.0, math.min(width * .105, 42.0));

                return Stack(
                  children: [
                    Positioned(
                      left: width * .045,
                      top: math.max(12.0, height * .018),
                      child: _TopBrand(markSize: brandMarkSize),
                    ),
                    Positioned(
                      top: math.max(18.0, height * .025),
                      right: width * .045,
                      child: Container(
                        width: width * .245,
                        height: width * .245,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.primary.withValues(alpha: .10),
                        ),
                      ),
                    ),
                    Positioned(
                      top: height * .255,
                      left: (width - illustrationSize) / 2,
                      child: _EvidenceIllustration(size: illustrationSize),
                    ),
                    Positioned(
                      left: 20,
                      right: 20,
                      top: height * .685,
                      child: Column(
                        children: [
                          Text(
                            'Voxidence',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: const Color(0xFF087A78),
                              fontSize: math.min(39.0, width * .118),
                              height: 1,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -1.25,
                            ),
                          ),
                          SizedBox(height: math.max(12.0, height * .018)),
                          Text(
                            'Ideas built from real needs',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: math.min(15.0, width * .044),
                              height: 1.15,
                              fontWeight: FontWeight.w500,
                              letterSpacing: -.15,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TopBrand extends StatelessWidget {
  const _TopBrand({required this.markSize});

  final double markSize;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: markSize,
          height: markSize,
          child: SvgPicture.asset(
            'assets/brand/voxidence-icon.svg',
            fit: BoxFit.contain,
          ),
        ),
        SizedBox(width: math.max(9.0, markSize * .24)),
        Text(
          'Voxidence',
          maxLines: 1,
          overflow: TextOverflow.visible,
          style: TextStyle(
            color: AppColors.primaryDeep,
            fontSize: math.max(15.5, markSize * .49),
            height: 1,
            fontWeight: FontWeight.w900,
            letterSpacing: -.55,
          ),
        ),
      ],
    );
  }
}

class _EvidenceIllustration extends StatelessWidget {
  const _EvidenceIllustration({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white.withValues(alpha: .94),
        border: Border.all(
          color: const Color(0xFF3EB2AE),
          width: 1.65,
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF57C7BE).withValues(alpha: .22),
            blurRadius: 24,
            spreadRadius: 4,
          ),
          BoxShadow(
            color: Colors.white.withValues(alpha: .85),
            blurRadius: 8,
            spreadRadius: 2,
          ),
        ],
      ),
      child: ClipOval(
        child: Stack(
          children: [
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: const Alignment(0, .18),
                    radius: .88,
                    colors: [
                      const Color(0xFFF9FFFC),
                      const Color(0xFFFFFFFF),
                      AppColors.primarySoft.withValues(alpha: .44),
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              left: size * .10,
              top: size * .31,
              child: _DocumentCard(
                width: size * .39,
                height: size * .45,
              ),
            ),
            Positioned(
              left: size * .20,
              top: size * .61,
              child: _Magnifier(size: size * .26),
            ),
            Positioned(
              left: size * .39,
              top: size * .35,
              child: _IdeaBulb(size: size * .31),
            ),
            Positioned(
              right: size * .09,
              top: size * .22,
              child: _AiNetwork(size: size * .31),
            ),
            Positioned(
              right: size * .10,
              top: size * .59,
              child: _AnalyticsCard(
                width: size * .29,
                height: size * .27,
              ),
            ),
            Positioned(
              left: size * .48,
              top: size * .17,
              child: Icon(
                Icons.auto_awesome,
                size: size * .035,
                color: AppColors.primary.withValues(alpha: .65),
              ),
            ),
            Positioned(
              left: size * .38,
              top: size * .20,
              child: Container(
                width: size * .012,
                height: size * .012,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: .52),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DocumentCard extends StatelessWidget {
  const _DocumentCard({required this.width, required this.height});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      padding: EdgeInsets.fromLTRB(
        width * .16,
        height * .15,
        width * .12,
        height * .11,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFFBFEFD),
        borderRadius: BorderRadius.circular(width * .05),
        border: Border.all(color: const Color(0xFF407878), width: 1.15),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .08),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: -width * .07,
            top: -height * .08,
            child: Container(
              width: width * .21,
              height: width * .21,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0xFF20AFA7),
              ),
              child: Icon(
                Icons.check_rounded,
                size: width * .14,
                color: Colors.white,
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Line(width: width * .48),
              SizedBox(height: height * .09),
              _Line(width: width * .60),
              SizedBox(height: height * .07),
              _Line(width: width * .45),
              const Spacer(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _Bar(height: height * .18),
                  SizedBox(width: width * .05),
                  _Bar(height: height * .28),
                  SizedBox(width: width * .05),
                  _Bar(height: height * .40),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.width});

  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: 2,
      decoration: BoxDecoration(
        color: const Color(0xFF82B8B4).withValues(alpha: .72),
        borderRadius: BorderRadius.circular(99),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 5,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFF58C3B9),
        borderRadius: BorderRadius.circular(1.5),
      ),
    );
  }
}

class _Magnifier extends StatelessWidget {
  const _Magnifier({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Positioned(
            left: size * .08,
            top: size * .02,
            child: Container(
              width: size * .63,
              height: size * .63,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFFF9FFFD),
                border: Border.all(color: const Color(0xFF387B7A), width: 1.8),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: .16),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: Center(
                child: Icon(
                  Icons.bar_chart_rounded,
                  color: const Color(0xFF65BFB7),
                  size: size * .34,
                ),
              ),
            ),
          ),
          Positioned(
            left: size * .61,
            top: size * .57,
            child: Transform.rotate(
              angle: -.76,
              child: Container(
                width: size * .14,
                height: size * .43,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF2C9D99), Color(0xFF53C5BC)],
                  ),
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(color: const Color(0xFF387B7A), width: 1),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _IdeaBulb extends StatelessWidget {
  const _IdeaBulb({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned.fill(
            child: CustomPaint(painter: _BulbRaysPainter()),
          ),
          Container(
            width: size * .73,
            height: size * .73,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFFFFEF4),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFF4D36A).withValues(alpha: .22),
                  blurRadius: 12,
                ),
              ],
            ),
            child: Icon(
              Icons.lightbulb_outline_rounded,
              color: const Color(0xFF78BFA5),
              size: size * .64,
            ),
          ),
          Positioned(
            top: size * .28,
            child: Icon(
              Icons.auto_awesome,
              size: size * .18,
              color: const Color(0xFFE8B83E),
            ),
          ),
        ],
      ),
    );
  }
}

class _BulbRaysPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final paint = Paint()
      ..color = const Color(0xFFF1C34B).withValues(alpha: .85)
      ..strokeWidth = 1.35
      ..strokeCap = StrokeCap.round;

    for (var i = 0; i < 8; i++) {
      final angle = (math.pi * 2 / 8) * i - math.pi / 2;
      final start = Offset(
        center.dx + math.cos(angle) * size.width * .39,
        center.dy + math.sin(angle) * size.height * .39,
      );
      final end = Offset(
        center.dx + math.cos(angle) * size.width * .47,
        center.dy + math.sin(angle) * size.height * .47,
      );
      canvas.drawLine(start, end, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _AiNetwork extends StatelessWidget {
  const _AiNetwork({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Positioned.fill(child: CustomPaint(painter: _NetworkPainter())),
          Positioned(
            right: 0,
            bottom: size * .03,
            child: Container(
              width: size * .39,
              height: size * .36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0xFF29B5AC),
                borderRadius: BorderRadius.circular(size * .09),
                border: Border.all(color: const Color(0xFF2D7C79), width: 1),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: .16),
                    blurRadius: 7,
                  ),
                ],
              ),
              child: Text(
                'AI',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: size * .20,
                  height: 1,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NetworkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final points = <Offset>[
      Offset(size.width * .18, size.height * .26),
      Offset(size.width * .46, size.height * .09),
      Offset(size.width * .59, size.height * .40),
      Offset(size.width * .83, size.height * .28),
    ];

    final line = Paint()
      ..color = const Color(0xFF2E817D)
      ..strokeWidth = 1.25
      ..style = PaintingStyle.stroke;

    canvas.drawLine(points[0], points[1], line);
    canvas.drawLine(points[0], points[2], line);
    canvas.drawLine(points[1], points[2], line);
    canvas.drawLine(points[2], points[3], line);

    for (var i = 0; i < points.length; i++) {
      canvas.drawCircle(
        points[i],
        size.width * (i == 1 ? .10 : .085),
        Paint()
          ..color = i.isEven
              ? const Color(0xFF8BD8B8)
              : const Color(0xFF2DB8AE),
      );
      canvas.drawCircle(
        points[i],
        size.width * (i == 1 ? .10 : .085),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = const Color(0xFF2D7774),
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _AnalyticsCard extends StatelessWidget {
  const _AnalyticsCard({required this.width, required this.height});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      padding: EdgeInsets.all(width * .12),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFEFD),
        borderRadius: BorderRadius.circular(width * .07),
        border: Border.all(color: const Color(0xFF3A7978), width: 1.1),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .08),
            blurRadius: 7,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: CustomPaint(painter: _ChartPainter()),
    );
  }
}

class _ChartPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final guide = Paint()
      ..color = const Color(0xFFBBDDD8)
      ..strokeWidth = 1;

    canvas.drawLine(
      Offset(0, size.height * .78),
      Offset(size.width, size.height * .78),
      guide,
    );

    final path = Path()
      ..moveTo(0, size.height * .70)
      ..cubicTo(
        size.width * .20,
        size.height * .68,
        size.width * .25,
        size.height * .42,
        size.width * .43,
        size.height * .48,
      )
      ..cubicTo(
        size.width * .60,
        size.height * .54,
        size.width * .69,
        size.height * .20,
        size.width,
        size.height * .20,
      );

    canvas.drawPath(
      path,
      Paint()
        ..color = const Color(0xFF3DB5AC)
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round,
    );

    canvas.drawCircle(
      Offset(size.width, size.height * .20),
      2.5,
      Paint()..color = const Color(0xFF3DB5AC),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _SplashBackgroundPainter extends CustomPainter {
  const _SplashBackgroundPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFFFBFCFD),
            Color(0xFFF9FCFB),
            Color(0xFFE6F8F5),
            Color(0xFFD8F3F1),
          ],
          stops: [0, .34, .73, 1],
        ).createShader(rect),
    );

    final glowRect = Rect.fromCircle(
      center: Offset(size.width * .53, size.height * .53),
      radius: size.width * .70,
    );
    canvas.drawCircle(
      Offset(size.width * .53, size.height * .53),
      size.width * .70,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.white.withValues(alpha: .95),
            const Color(0xFFB8ECE6).withValues(alpha: .22),
            Colors.transparent,
          ],
          stops: const [0, .55, 1],
        ).createShader(glowRect),
    );

    final linePaint = Paint()
      ..color = const Color(0xFF9EDDD6).withValues(alpha: .12)
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    for (var i = 0; i < 5; i++) {
      final path = Path()
        ..moveTo(size.width * (.72 + i * .045), size.height * .20)
        ..quadraticBezierTo(
          size.width * (.88 + i * .02),
          size.height * .42,
          size.width * (.98 + i * .018),
          size.height * .63,
        );
      canvas.drawPath(path, linePaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
