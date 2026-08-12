// Reference-based mobile Hero section for the Voxidence public Home.
//
// Matches the provided mobile concept using the real Voxidence palette
// and existing project illustration assets.
//
// @author Eman

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

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
    final screenWidth = MediaQuery.sizeOf(context).width;

    final compact = screenWidth < 355;

    return Padding(
      padding: EdgeInsets.fromLTRB(16, compact ? 25 : 30, 16, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _HeroBadge(),

          SizedBox(height: compact ? 20 : 23),

          const _HeroHeading(),

          SizedBox(height: compact ? 13 : 16),

          const _HeroLead(),

          SizedBox(height: compact ? 22 : 28),

          _DiscoveryCard(
            onGeneratePressed: onGeneratePressed,
            onExplorePressed: onExplorePressed,
          ),

          const SizedBox(height: 17),

          const _FeatureStrip(),

          const SizedBox(height: 24),

          const _VisualShowcase(),
        ],
      ),
    );
  }
}

class _HeroBadge extends StatelessWidget {
  const _HeroBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.84),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.borderStrong),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.025),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _LiveDot(),

          SizedBox(width: 8),

          Icon(Icons.auto_awesome_rounded, size: 13, color: AppColors.primary),

          SizedBox(width: 6),

          Flexible(
            child: Text(
              'EVIDENCE-FIRST IDEA DISCOVERY',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 9.4,
                fontWeight: FontWeight.w900,
                letterSpacing: 0.48,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveDot extends StatelessWidget {
  const _LiveDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: AppColors.primary,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.27),
            blurRadius: 8,
            spreadRadius: 2,
          ),
        ],
      ),
    );
  }
}

class _HeroHeading extends StatelessWidget {
  const _HeroHeading();

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.sizeOf(context).width;

    final fontSize = screenWidth < 355 ? 31.5 : 34.0;

    return Text.rich(
      TextSpan(
        style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: fontSize,
          height: 1.08,
          fontWeight: FontWeight.w900,
          letterSpacing: -1.25,
        ),
        children: const [
          TextSpan(text: 'Real voices reveal\nthe '),

          TextSpan(
            text: 'ideas',
            style: TextStyle(color: AppColors.primary),
          ),

          TextSpan(text: ' worth building.'),
        ],
      ),
    );
  }
}

class _HeroLead extends StatelessWidget {
  const _HeroLead();

  @override
  Widget build(BuildContext context) {
    return const Text.rich(
      TextSpan(
        style: TextStyle(
          color: AppColors.textSecondary,
          fontSize: 13.2,
          height: 1.62,
          fontWeight: FontWeight.w500,
        ),
        children: [
          TextSpan(
            text: 'Voxidence ',
            style: TextStyle(
              color: AppColors.primaryDark,
              fontWeight: FontWeight.w900,
            ),
          ),

          TextSpan(
            text:
                'listens to recurring community needs, connects them with evidence, and turns them into focused software opportunities.',
          ),
        ],
      ),
    );
  }
}

class _DiscoveryCard extends StatelessWidget {
  const _DiscoveryCard({
    required this.onGeneratePressed,
    required this.onExplorePressed,
  });

  final VoidCallback onGeneratePressed;
  final VoidCallback onExplorePressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 235,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.93),
        borderRadius: BorderRadius.circular(31),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.075),
            blurRadius: 32,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(31),
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Positioned.fill(child: _DiscoveryBackground()),

            Positioned(
              left: 0,
              right: 0,
              top: 30,
              height: 100,
              child: CustomPaint(painter: _SignalPathPainter()),
            ),

            Positioned(top: 26, child: _IdeaOrb(onTap: onGeneratePressed)),

            Positioned(
              left: 18,
              right: 18,
              bottom: 17,
              child: Column(
                children: [
                  Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: onGeneratePressed,
                      borderRadius: BorderRadius.circular(14),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 5,
                        ),
                        child: Text(
                          'Discover your next idea',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 17,
                            height: 1.1,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.35,
                          ),
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 4),

                  const Text(
                    "We'll handle the rest",
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),

                  const SizedBox(height: 9),

                  Material(
                    color: Colors.white.withValues(alpha: 0.92),
                    shape: const CircleBorder(),
                    child: InkWell(
                      onTap: onExplorePressed,
                      customBorder: const CircleBorder(),
                      child: Container(
                        width: 31,
                        height: 31,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Icon(
                          Icons.keyboard_arrow_down_rounded,
                          color: AppColors.primaryDeep,
                          size: 19,
                        ),
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

class _DiscoveryBackground extends StatelessWidget {
  const _DiscoveryBackground();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0.05, -0.40),
          radius: 1.15,
          colors: [Color(0xFFFFFEF9), Color(0xFFFBFDFC), Color(0xFFF6FBF9)],
          stops: [0, 0.55, 1],
        ),
      ),
      child: SizedBox.expand(),
    );
  }
}

class _IdeaOrb extends StatelessWidget {
  const _IdeaOrb({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 106,
      height: 106,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 104,
            height: 104,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.primary.withValues(alpha: 0.08),
              ),
            ),
          ),

          Container(
            width: 83,
            height: 83,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: const Color(0xFFF3DBA8).withValues(alpha: 0.25),
              ),
            ),
          ),

          Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: onTap,
              customBorder: const CircleBorder(),
              child: Container(
                width: 63,
                height: 63,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFFFFEF6),
                  border: Border.all(color: const Color(0xFFF1E7C8)),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFF3D78C).withValues(alpha: 0.18),
                      blurRadius: 26,
                      spreadRadius: 3,
                    ),
                  ],
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Icon(
                      Icons.lightbulb_outline_rounded,
                      size: 35,
                      color: AppColors.primaryDark,
                    ),

                    Positioned(
                      top: 10,
                      left: 12,
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        size: 8,
                        color: AppColors.primary.withValues(alpha: 0.9),
                      ),
                    ),

                    const Positioned(
                      top: 10,
                      right: 12,
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        size: 7,
                        color: Color(0xFFE8C96B),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SignalPathPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(-10, size.height * 0.61)
      ..cubicTo(
        size.width * 0.10,
        size.height * 0.75,
        size.width * 0.17,
        size.height * 0.25,
        size.width * 0.30,
        size.height * 0.45,
      )
      ..cubicTo(
        size.width * 0.42,
        size.height * 0.65,
        size.width * 0.58,
        size.height * 0.27,
        size.width * 0.68,
        size.height * 0.43,
      )
      ..cubicTo(
        size.width * 0.79,
        size.height * 0.61,
        size.width * 0.88,
        size.height * 0.20,
        size.width + 10,
        size.height * 0.28,
      );

    final linePaint = Paint()
      ..color = AppColors.primary.withValues(alpha: 0.24)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.7
      ..strokeCap = StrokeCap.round;

    canvas.drawPath(path, linePaint);

    _drawNode(
      canvas,
      Offset(size.width * 0.16, size.height * 0.52),
      AppColors.pink,
    );

    _drawNode(
      canvas,
      Offset(size.width * 0.29, size.height * 0.47),
      AppColors.primary,
    );

    _drawNode(
      canvas,
      Offset(size.width * 0.71, size.height * 0.43),
      AppColors.primaryDark,
    );

    _drawNode(
      canvas,
      Offset(size.width * 0.87, size.height * 0.34),
      AppColors.primary,
    );
  }

  void _drawNode(Canvas canvas, Offset center, Color color) {
    final glowPaint = Paint()
      ..color = color.withValues(alpha: 0.14)
      ..style = PaintingStyle.fill;

    final whitePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    final ringPaint = Paint()
      ..color = color.withValues(alpha: 0.85)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.7;

    canvas.drawCircle(center, 6, glowPaint);

    canvas.drawCircle(center, 3.8, whitePaint);

    canvas.drawCircle(center, 3.8, ringPaint);
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.045),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: const Row(
        children: [
          Expanded(
            child: _FeatureItem(
              icon: Icons.verified_user_outlined,
              label: 'Evidence-\nbacked',
            ),
          ),

          _FeatureDivider(),

          Expanded(
            child: _FeatureItem(
              icon: Icons.psychology_alt_outlined,
              label: 'Multi-model\nAI',
            ),
          ),

          _FeatureDivider(),

          Expanded(
            child: _FeatureItem(
              icon: Icons.location_on_outlined,
              label: 'Locally\nrelevant',
            ),
          ),
        ],
      ),
    );
  }
}

class _FeatureDivider extends StatelessWidget {
  const _FeatureDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 39, color: AppColors.border);
  }
}

class _FeatureItem extends StatelessWidget {
  const _FeatureItem({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 5),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: 0.88),
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.border),
            ),
            child: Icon(icon, size: 18, color: AppColors.primaryDark),
          ),

          const SizedBox(width: 7),

          Flexible(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.4,
                height: 1.18,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Automatically rotates between the four evidence pipeline illustrations.
///
/// The stage duration matches the web Home implementation.
class _VisualShowcase extends StatefulWidget {
  const _VisualShowcase();

  @override
  State<_VisualShowcase> createState() => _VisualShowcaseState();
}

class _VisualShowcaseState extends State<_VisualShowcase>
    with WidgetsBindingObserver {
  static const Duration _stageDuration = Duration(milliseconds: 4800);

  static const Duration _fadeDuration = Duration(milliseconds: 650);

  static const List<String> _stageAssets = [
    'assets/images/hero-stages/01-collect-signals.svg',
    'assets/images/hero-stages/02-evidence-pipeline.svg',
    'assets/images/hero-stages/03-compare-directions.svg',
    'assets/images/hero-stages/04-selected-opportunity.svg',
  ];

  Timer? _stageTimer;

  int _activeStageIndex = 0;

  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addObserver(this);

    _startStageTimer();
  }

  void _startStageTimer() {
    _stageTimer?.cancel();

    _stageTimer = Timer.periodic(_stageDuration, (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _activeStageIndex = (_activeStageIndex + 1) % _stageAssets.length;
      });
    });
  }

  void _stopStageTimer() {
    _stageTimer?.cancel();
    _stageTimer = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);

    if (state == AppLifecycleState.resumed) {
      _startStageTimer();
      return;
    }

    _stopStageTimer();
  }

  @override
  void dispose() {
    _stopStageTimer();

    WidgetsBinding.instance.removeObserver(this);

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final activeAsset = _stageAssets[_activeStageIndex];

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF9FCFA), Color(0xFFFFF8FA)],
        ),
        borderRadius: BorderRadius.circular(29),
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.065),
            blurRadius: 30,
            offset: const Offset(0, 15),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(27),
        child: AspectRatio(
          aspectRatio: 1.36,
          child: AnimatedSwitcher(
            duration: _fadeDuration,
            reverseDuration: _fadeDuration,
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            transitionBuilder: (child, animation) {
              return FadeTransition(opacity: animation, child: child);
            },
            layoutBuilder: (currentChild, previousChildren) {
              return Stack(
                fit: StackFit.expand,
                alignment: Alignment.center,
                children: [...previousChildren, ?currentChild],
              );
            },
            child: SvgPicture.asset(
              activeAsset,
              key: ValueKey<String>(activeAsset),
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
        ),
      ),
    );
  }
}
