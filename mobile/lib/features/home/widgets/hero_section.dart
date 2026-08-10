/// Mobile hero section for the Voxidence public Home screen.
///
/// Author: Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class HeroSection extends StatelessWidget {
  const HeroSection({
    super.key,
    required this.onGeneratePressed,
    required this.onExplorePressed,
  });

  final VoidCallback onGeneratePressed;
  final VoidCallback onExplorePressed;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 380;

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 34, 18, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SignalBadge(),
          const SizedBox(height: 23),

          Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                right: compact ? -58 : -46,
                top: 68,
                child: const _HeroLeafDecoration(),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _HeroHeadline(),

                  const SizedBox(height: 18),

                  SizedBox(
                    width: compact ? 286 : 320,
                    child: Text.rich(
                      TextSpan(
                        children: const [
                          TextSpan(
                            text: 'Voxidence ',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          TextSpan(
                            text:
                                'listens, understands, and turns community needs '
                                'into focused software opportunities with purpose, '
                                'context, and local relevance.',
                          ),
                        ],
                      ),
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 14,
                        height: 1.5,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),

          const SizedBox(height: 20),

          _PrimaryHeroButton(
            label: 'Generate your free idea',
            onPressed: onGeneratePressed,
          ),

          const SizedBox(height: 10),

          _SecondaryHeroButton(
            label: 'Explore how it works',
            onPressed: onExplorePressed,
          ),

          const SizedBox(height: 20),

          const _EvidenceVisualCard(),

          const SizedBox(height: 12),

          const _FeatureStrip(),
        ],
      ),
    );
  }
}

class _SignalBadge extends StatelessWidget {
  const _SignalBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(9, 8, 14, 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.80),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.borderStrong),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.04),
            blurRadius: 16,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _BadgeDot(),

          SizedBox(width: 8),

          Icon(
            Icons.auto_awesome_rounded,
            size: 15,
            color: AppColors.primaryDark,
          ),

          SizedBox(width: 7),

          Text(
            'COMMUNITY VOICES, VERIFIED\nINTO DIRECTION',
            style: TextStyle(
              color: AppColors.primaryDeep,
              fontSize: 9.5,
              height: 1.2,
              fontWeight: FontWeight.w900,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _BadgeDot extends StatelessWidget {
  const _BadgeDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 24,
      height: 24,
      decoration: const BoxDecoration(
        color: AppColors.primarySoft,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Container(
        width: 7,
        height: 7,
        decoration: const BoxDecoration(
          color: AppColors.primary,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

class _HeroHeadline extends StatelessWidget {
  const _HeroHeadline();

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final fontSize = width < 370 ? 42.0 : 48.0;

    return Text.rich(
      TextSpan(
        children: const [
          TextSpan(text: 'Real voices\nreveal '),
          TextSpan(
            text: 'the ideas',
            style: TextStyle(color: AppColors.primary),
          ),
          TextSpan(text: '\nworth building'),
          TextSpan(
            text: '.',
            style: TextStyle(color: AppColors.pink),
          ),
        ],
      ),
      style: TextStyle(
        color: AppColors.primaryDeep,
        fontSize: fontSize,
        height: 1.01,
        fontWeight: FontWeight.w500,
        letterSpacing: -2,
      ),
    );
  }
}

class _HeroLeafDecoration extends StatelessWidget {
  const _HeroLeafDecoration();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Opacity(
        opacity: 0.17,
        child: SizedBox(
          width: 165,
          height: 238,
          child: CustomPaint(painter: _LargeLeafPainter()),
        ),
      ),
    );
  }
}

class _LargeLeafPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final stem = Path()
      ..moveTo(size.width * 0.50, size.height)
      ..cubicTo(
        size.width * 0.47,
        size.height * 0.70,
        size.width * 0.48,
        size.height * 0.40,
        size.width * 0.70,
        size.height * 0.12,
      );

    canvas.drawPath(stem, paint);

    final topLeaf = Path()
      ..moveTo(size.width * 0.61, size.height * 0.40)
      ..cubicTo(
        size.width * 0.67,
        size.height * 0.14,
        size.width * 0.88,
        size.height * 0.08,
        size.width * 0.94,
        size.height * 0.05,
      )
      ..cubicTo(
        size.width * 0.93,
        size.height * 0.29,
        size.width * 0.80,
        size.height * 0.43,
        size.width * 0.61,
        size.height * 0.40,
      );

    canvas.drawPath(topLeaf, paint);

    final leftLeaf = Path()
      ..moveTo(size.width * 0.50, size.height * 0.64)
      ..cubicTo(
        size.width * 0.34,
        size.height * 0.46,
        size.width * 0.12,
        size.height * 0.46,
        size.width * 0.08,
        size.height * 0.46,
      )
      ..cubicTo(
        size.width * 0.12,
        size.height * 0.68,
        size.width * 0.30,
        size.height * 0.76,
        size.width * 0.50,
        size.height * 0.64,
      );

    canvas.drawPath(leftLeaf, paint);

    final rightLeaf = Path()
      ..moveTo(size.width * 0.48, size.height * 0.79)
      ..cubicTo(
        size.width * 0.62,
        size.height * 0.61,
        size.width * 0.86,
        size.height * 0.62,
        size.width * 0.91,
        size.height * 0.64,
      )
      ..cubicTo(
        size.width * 0.82,
        size.height * 0.83,
        size.width * 0.65,
        size.height * 0.88,
        size.width * 0.48,
        size.height * 0.79,
      );

    canvas.drawPath(rightLeaf, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _PrimaryHeroButton extends StatelessWidget {
  const _PrimaryHeroButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(19),
        child: Ink(
          height: 58,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xFF57B9B3), Color(0xFF71C7AF)],
            ),
            borderRadius: BorderRadius.circular(19),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.20),
                blurRadius: 20,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              children: [
                const _ButtonIconBubble(
                  icon: Icons.lightbulb_outline_rounded,
                  dark: false,
                ),

                const SizedBox(width: 12),

                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15.8,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.2,
                    ),
                  ),
                ),

                const Icon(
                  Icons.arrow_forward_rounded,
                  color: Colors.white,
                  size: 24,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SecondaryHeroButton extends StatelessWidget {
  const _SecondaryHeroButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.72),
      borderRadius: BorderRadius.circular(19),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(19),
        child: Container(
          height: 54,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(19),
            border: Border.all(color: AppColors.primary, width: 1.15),
          ),
          child: Row(
            children: [
              const _ButtonIconBubble(icon: Icons.explore_outlined, dark: true),

              const SizedBox(width: 12),

              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 15.3,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.15,
                  ),
                ),
              ),

              const Icon(
                Icons.arrow_forward_rounded,
                color: AppColors.primaryDark,
                size: 24,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ButtonIconBubble extends StatelessWidget {
  const _ButtonIconBubble({required this.icon, required this.dark});

  final IconData icon;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: dark
            ? AppColors.primarySoft
            : Colors.white.withValues(alpha: 0.14),
        shape: BoxShape.circle,
        border: Border.all(
          color: dark
              ? Colors.transparent
              : Colors.white.withValues(alpha: 0.18),
        ),
      ),
      child: Icon(
        icon,
        color: dark ? AppColors.primaryDark : Colors.white,
        size: 19,
      ),
    );
  }
}

class _EvidenceVisualCard extends StatelessWidget {
  const _EvidenceVisualCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 218,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.82),
        borderRadius: BorderRadius.circular(27),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.06),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomLeft,
                  end: Alignment.topRight,
                  colors: [
                    AppColors.primarySoft.withValues(alpha: 0.58),
                    Colors.white.withValues(alpha: 0.75),
                    AppColors.pinkSoft.withValues(alpha: 0.52),
                  ],
                ),
              ),
            ),
          ),

          const Positioned(left: 16, top: 16, child: _WindowDots()),

          Positioned(
            right: 18,
            top: 17,
            child: Container(
              width: 30,
              height: 5,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primary, Color(0xFF9DD8CE)],
                ),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
          ),

          const Positioned.fill(
            child: Padding(
              padding: EdgeInsets.fromLTRB(18, 27, 18, 14),
              child: _SoftIdeaIllustration(),
            ),
          ),
        ],
      ),
    );
  }
}

class _WindowDots extends StatelessWidget {
  const _WindowDots();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        _WindowDot(color: Color(0xFF8CD0C5)),
        SizedBox(width: 6),
        _WindowDot(color: Color(0xFFE8C7CF)),
        SizedBox(width: 6),
        _WindowDot(color: AppColors.pink),
      ],
    );
  }
}

class _WindowDot extends StatelessWidget {
  const _WindowDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _SoftIdeaIllustration extends StatelessWidget {
  const _SoftIdeaIllustration();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          clipBehavior: Clip.none,
          children: [
            const Positioned.fill(
              child: CustomPaint(painter: _SoftOrbitPainter()),
            ),

            Align(
              alignment: const Alignment(0, -0.03),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: const [
                  _TopMiniNode(),

                  SizedBox(height: 5),

                  _MainSoftCard(),

                  SizedBox(height: 5),

                  _BottomCheckNode(),
                ],
              ),
            ),

            const Positioned(
              left: 22,
              bottom: 15,
              child: _SideNode(
                icon: Icons.trending_up_rounded,
                iconColor: AppColors.primaryDark,
                background: AppColors.primarySoft,
              ),
            ),

            const Positioned(
              right: 22,
              bottom: 15,
              child: _SideNode(
                icon: Icons.view_list_rounded,
                iconColor: AppColors.pink,
                background: AppColors.pinkSoft,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _TopMiniNode extends StatelessWidget {
  const _TopMiniNode();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 39,
      height: 39,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.97),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.07),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Container(
        width: 25,
        height: 25,
        decoration: BoxDecoration(
          color: AppColors.primarySoft.withValues(alpha: 0.90),
          shape: BoxShape.circle,
        ),
        child: const Icon(
          Icons.eco_outlined,
          size: 14,
          color: AppColors.primaryDark,
        ),
      ),
    );
  }
}

class _MainSoftCard extends StatelessWidget {
  const _MainSoftCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 106,
      height: 67,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF82D0C1), Color(0xFF58B6AF)],
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.18),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Container(
        width: 84,
        height: 38,
        padding: const EdgeInsets.symmetric(horizontal: 9),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(13),
        ),
        child: Row(
          children: [
            Container(
              width: 23,
              height: 23,
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.add_rounded,
                size: 16,
                color: Colors.white,
              ),
            ),

            const SizedBox(width: 7),

            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.textSecondary.withValues(alpha: 0.47),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),

                  const SizedBox(height: 5),

                  FractionallySizedBox(
                    widthFactor: 0.60,
                    child: Container(
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.borderStrong,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BottomCheckNode extends StatelessWidget {
  const _BottomCheckNode();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.border.withValues(alpha: 0.65)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.055),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: const Icon(
        Icons.check_rounded,
        size: 15,
        color: AppColors.primaryDark,
      ),
    );
  }
}

class _SideNode extends StatelessWidget {
  const _SideNode({
    required this.icon,
    required this.iconColor,
    required this.background,
  });

  final IconData icon;
  final Color iconColor;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 43,
      height: 43,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.97),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.065),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Container(
        width: 29,
        height: 29,
        decoration: BoxDecoration(color: background, shape: BoxShape.circle),
        child: Icon(icon, size: 15, color: iconColor),
      ),
    );
  }
}

class _SoftOrbitPainter extends CustomPainter {
  const _SoftOrbitPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2 + 2);

    final orbitPaint = Paint()
      ..color = AppColors.primary.withValues(alpha: 0.16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    final connectorPaint = Paint()
      ..color = AppColors.primary.withValues(alpha: 0.12)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    final radius1 = size.shortestSide * 0.30;
    final radius2 = size.shortestSide * 0.19;

    canvas.drawCircle(center, radius1, orbitPaint);

    canvas.drawCircle(center, radius2, orbitPaint);

    canvas.drawLine(
      Offset(center.dx, center.dy - 47),
      Offset(center.dx, center.dy - 15),
      connectorPaint,
    );

    canvas.drawLine(
      Offset(center.dx - 37, center.dy + 12),
      Offset(43, size.height - 36),
      connectorPaint,
    );

    canvas.drawLine(
      Offset(center.dx + 37, center.dy + 12),
      Offset(size.width - 43, size.height - 36),
      connectorPaint,
    );

    final dotPaint = Paint()..color = AppColors.primary.withValues(alpha: 0.24);

    canvas.drawCircle(Offset(center.dx, center.dy - radius1), 2, dotPaint);

    canvas.drawCircle(Offset(center.dx - radius1, center.dy), 2, dotPaint);

    canvas.drawCircle(Offset(center.dx + radius1, center.dy), 2, dotPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _FeatureStrip extends StatelessWidget {
  const _FeatureStrip();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        Expanded(
          child: _FeatureMiniCard(
            icon: Icons.verified_user_outlined,
            label: 'Real community\nevidence',
          ),
        ),

        SizedBox(width: 8),

        Expanded(
          child: _FeatureMiniCard(
            icon: Icons.bar_chart_rounded,
            label: 'Multi-model\ncomparison',
          ),
        ),

        SizedBox(width: 8),

        Expanded(
          child: _FeatureMiniCard(
            icon: Icons.location_on_outlined,
            label: 'Locally relevant\noutcomes',
          ),
        ),
      ],
    );
  }
}

class _FeatureMiniCard extends StatelessWidget {
  const _FeatureMiniCard({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.84),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.045),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 35,
            height: 35,
            decoration: const BoxDecoration(
              color: AppColors.primarySoft,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 20, color: AppColors.primary),
          ),

          const SizedBox(width: 7),

          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10.2,
                height: 1.22,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
