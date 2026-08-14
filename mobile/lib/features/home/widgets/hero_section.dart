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
      padding: EdgeInsets.fromLTRB(14, compact ? 13 : 17, 14, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _HeroIntroPanel(
            compact: compact,
            onGeneratePressed: onGeneratePressed,
            onExplorePressed: onExplorePressed,
          ),
          const SizedBox(height: 14),
          _DiscoveryCard(
            onGeneratePressed: onGeneratePressed,
            onExplorePressed: onExplorePressed,
          ),
          const SizedBox(height: 15),
          const _FeatureStrip(),
          const SizedBox(height: 24),
          const _VisualShowcase(),
        ],
      ),
    );
  }
}

/// Gives the top of Home the same complete, card-led visual language used by
/// the rest of the mobile product without changing any navigation or logic.
class _HeroIntroPanel extends StatelessWidget {
  const _HeroIntroPanel({
    required this.compact,
    required this.onGeneratePressed,
    required this.onExplorePressed,
  });

  final bool compact;
  final VoidCallback onGeneratePressed;
  final VoidCallback onExplorePressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface.withValues(alpha: .98),
            const Color(0xFFF8FCFA),
            AppColors.surfaceRose.withValues(alpha: .72),
          ],
          stops: const [0, .64, 1],
        ),
        borderRadius: BorderRadius.circular(30),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .58),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 34,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(
            right: -42,
            top: -58,
            child: Container(
              width: 176,
              height: 176,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primarySoft.withValues(alpha: .55),
              ),
            ),
          ),
          Positioned(
            right: 22,
            top: 22,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary,
                border: Border.all(color: Colors.white, width: 3),
              ),
            ),
          ),
          Positioned(
            right: 51,
            top: 54,
            child: Container(
              width: 7,
              height: 7,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink,
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(
              compact ? 15 : 18,
              compact ? 17 : 20,
              compact ? 15 : 18,
              compact ? 16 : 18,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _HeroBadge(),
                SizedBox(height: compact ? 17 : 20),
                const _HeroHeading(),
                SizedBox(height: compact ? 10 : 12),
                const _HeroLead(),
                SizedBox(height: compact ? 14 : 16),
                const _HeroSignalFlow(),
                SizedBox(height: compact ? 15 : 17),
                Row(
                  children: [
                    Expanded(
                      flex: 6,
                      child: _HeroPrimaryAction(onTap: onGeneratePressed),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 5,
                      child: _HeroSecondaryAction(onTap: onExplorePressed),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    _HeroTrustPoint(
                      icon: Icons.forum_outlined,
                      label: 'Real voices',
                    ),
                    _HeroTrustPoint(
                      icon: Icons.fact_check_outlined,
                      label: 'Evidence-backed',
                    ),
                    _HeroTrustPoint(
                      icon: Icons.auto_awesome_rounded,
                      label: 'AI refined',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroPrimaryAction extends StatelessWidget {
  const _HeroPrimaryAction({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: FilledButton.icon(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          elevation: 0,
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.primaryDeep,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        icon: const Icon(
          Icons.auto_awesome_rounded,
          size: 17,
          color: AppColors.primaryDeep,
        ),
        label: const FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            'Generate free idea',
            style: TextStyle(fontSize: 11.2, fontWeight: FontWeight.w900),
          ),
        ),
      ),
    );
  }
}

class _HeroSecondaryAction extends StatelessWidget {
  const _HeroSecondaryAction({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: OutlinedButton.icon(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryDeep,
          backgroundColor: Colors.white.withValues(alpha: .76),
          side: BorderSide(
            color: AppColors.borderStrong.withValues(alpha: .92),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 11),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        icon: const Icon(Icons.south_rounded, size: 16),
        label: const FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            'How it works',
            style: TextStyle(fontSize: 11.1, fontWeight: FontWeight.w900),
          ),
        ),
      ),
    );
  }
}

class _HeroTrustPoint extends StatelessWidget {
  const _HeroTrustPoint({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .62),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.border.withValues(alpha: .8)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12.5, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.3,
              fontWeight: FontWeight.w800,
            ),
          ),
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
      width: double.infinity,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .64),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .68),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 27,
            height: 27,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .92),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.graphic_eq_rounded,
              size: 14,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'REAL VOICES  →  VERIFIED EVIDENCE',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7.8,
                fontWeight: FontWeight.w900,
                letterSpacing: .48,
              ),
            ),
          ),
          const SizedBox(width: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: AppColors.border),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.auto_awesome_rounded,
                  size: 10.5,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 4),
                Text(
                  'BUILDABLE IDEAS',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 6.9,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ignore: unused_element
class _HeroBadgeMark extends StatelessWidget {
  const _HeroBadgeMark();

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Container(
          width: 22,
          height: 22,
          decoration: const BoxDecoration(
            color: AppColors.primarySoft,
            shape: BoxShape.circle,
          ),
        ),
        const Icon(
          Icons.auto_awesome_rounded,
          size: 12,
          color: AppColors.primaryDark,
        ),
      ],
    );
  }
}

class _HeroHeading extends StatelessWidget {
  const _HeroHeading();

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    final fontSize = screenWidth < 355 ? 27.5 : 30.0;

    return Text.rich(
      TextSpan(
        style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: fontSize,
          height: 1.04,
          fontWeight: FontWeight.w900,
          letterSpacing: -1.0,
        ),
        children: const [
          TextSpan(text: 'Hear the need.\n'),
          TextSpan(text: 'Find the evidence.\n'),
          TextSpan(
            text: 'Build the idea.',
            style: TextStyle(color: AppColors.primaryDark),
          ),
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
          fontSize: 12.3,
          height: 1.52,
          fontWeight: FontWeight.w500,
        ),
        children: [
          TextSpan(
            text: 'Voxidence ',
            style: TextStyle(
              color: AppColors.primaryDeep,
              fontWeight: FontWeight.w900,
            ),
          ),
          TextSpan(
            text:
                'connects recurring community pain points with evidence, then turns the strongest signals into focused software opportunities.',
          ),
        ],
      ),
    );
  }
}

class _HeroSignalFlow extends StatelessWidget {
  const _HeroSignalFlow();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .64),
        ),
      ),
      child: const Row(
        children: [
          Expanded(
            child: _HeroSignalStep(
              icon: Icons.record_voice_over_outlined,
              label: 'Listen',
              caption: 'voices',
            ),
          ),
          _HeroFlowArrow(),
          Expanded(
            child: _HeroSignalStep(
              icon: Icons.hub_outlined,
              label: 'Connect',
              caption: 'evidence',
            ),
          ),
          _HeroFlowArrow(),
          Expanded(
            child: _HeroSignalStep(
              icon: Icons.lightbulb_outline_rounded,
              label: 'Shape',
              caption: 'ideas',
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroSignalStep extends StatelessWidget {
  const _HeroSignalStep({
    required this.icon,
    required this.label,
    required this.caption,
  });

  final IconData icon;
  final String label;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 29,
          height: 29,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .9),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 15, color: AppColors.primaryDark),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                caption,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.4,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _HeroFlowArrow extends StatelessWidget {
  const _HeroFlowArrow();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Icon(
        Icons.arrow_forward_rounded,
        size: 13,
        color: AppColors.sage.withValues(alpha: .9),
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
