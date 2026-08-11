// Mobile-first Hero section inspired by the Voxidence web landing page.
//
// @author Eman

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/theme/app_theme.dart';
import '../models/home_models.dart';

class HeroSection extends StatefulWidget {
  const HeroSection({
    super.key,
    required this.onGeneratePressed,
    required this.onExplorePressed,
  });

  final VoidCallback onGeneratePressed;
  final VoidCallback onExplorePressed;

  @override
  State<HeroSection> createState() => _HeroSectionState();
}

class _HeroSectionState extends State<HeroSection> {
  static const _stageDuration = Duration(milliseconds: 4800);

  Timer? _timer;

  int _activeStage = 0;

  @override
  void initState() {
    super.initState();

    _timer = Timer.periodic(_stageDuration, (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _activeStage = (_activeStage + 1) % HomeData.heroStages.length;
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _HeroBadge(),

          const SizedBox(height: 14),

          const _HeroHeading(),

          const SizedBox(height: 12),

          const _HeroLead(),

          const SizedBox(height: 18),

          _HeroActions(
            onGeneratePressed: widget.onGeneratePressed,
            onExplorePressed: widget.onExplorePressed,
          ),

          const SizedBox(height: 14),

          const _TrustPoints(),

          const SizedBox(height: 21),

          _StageShowcase(
            activeStage: _activeStage,
            onStageChanged: (index) {
              setState(() {
                _activeStage = index;
              });
            },
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.74),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.borderStrong),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _LiveDot(),

          SizedBox(width: 7),

          Icon(Icons.auto_awesome_rounded, size: 13, color: AppColors.primary),

          SizedBox(width: 5),

          Text(
            'EVIDENCE-FIRST IDEA DISCOVERY',
            style: TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9.2,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.55,
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
      width: 7,
      height: 7,
      decoration: BoxDecoration(
        color: AppColors.primary,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.34),
            blurRadius: 7,
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
    return const Text(
      'Real voices reveal\nthe ideas worth building.',
      style: TextStyle(
        color: AppColors.textPrimary,
        fontSize: 32,
        height: 1.04,
        fontWeight: FontWeight.w900,
        letterSpacing: -1.15,
      ),
    );
  }
}

class _HeroLead extends StatelessWidget {
  const _HeroLead();

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: const TextSpan(
        style: TextStyle(
          color: AppColors.textSecondary,
          fontSize: 12.7,
          height: 1.5,
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

class _HeroActions extends StatelessWidget {
  const _HeroActions({
    required this.onGeneratePressed,
    required this.onExplorePressed,
  });

  final VoidCallback onGeneratePressed;
  final VoidCallback onExplorePressed;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: SizedBox(
            height: 46,
            child: FilledButton(
              onPressed: onGeneratePressed,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 11),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _GenerateIdeaIcon(),

                  SizedBox(width: 8),

                  Flexible(
                    child: Text(
                      'Generate free idea',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11.7,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),

                  SizedBox(width: 6),

                  Icon(Icons.arrow_forward_rounded, size: 16),
                ],
              ),
            ),
          ),
        ),

        const SizedBox(width: 8),

        SizedBox(
          height: 46,
          width: 46,
          child: OutlinedButton(
            onPressed: onExplorePressed,
            style: OutlinedButton.styleFrom(
              padding: EdgeInsets.zero,
              backgroundColor: Colors.white.withValues(alpha: 0.88),
              foregroundColor: AppColors.primaryDark,
              side: const BorderSide(color: AppColors.borderStrong),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(15),
              ),
            ),
            child: const Icon(Icons.keyboard_arrow_down_rounded, size: 22),
          ),
        ),
      ],
    );
  }
}

class _GenerateIdeaIcon extends StatelessWidget {
  const _GenerateIdeaIcon();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 24,
      height: 24,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          Icon(
            Icons.lightbulb_outline_rounded,
            size: 18,
            color: Colors.white.withValues(alpha: 0.98),
          ),

          Positioned(
            top: 1,
            right: 0,
            child: Container(
              width: 4.5,
              height: 4.5,
              decoration: BoxDecoration(
                color: const Color(0xFFFFE7A8),
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFFFE7A8).withValues(alpha: 0.42),
                    blurRadius: 5,
                    spreadRadius: 0.8,
                  ),
                ],
              ),
            ),
          ),

          Positioned(
            top: -1,
            left: 1,
            child: Icon(
              Icons.auto_awesome_rounded,
              size: 6,
              color: Colors.white.withValues(alpha: 0.8),
            ),
          ),
        ],
      ),
    );
  }
}

class _TrustPoints extends StatelessWidget {
  const _TrustPoints();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 12,
      runSpacing: 7,
      children: [
        _TrustPoint(text: 'Evidence-backed'),
        _TrustPoint(text: 'Multi-model AI'),
        _TrustPoint(text: 'Locally relevant'),
      ],
    );
  }
}

class _TrustPoint extends StatelessWidget {
  const _TrustPoint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(
          Icons.check_circle_outline_rounded,
          size: 14,
          color: AppColors.primaryDark,
        ),

        const SizedBox(width: 5),

        Text(
          text,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 9.8,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _StageShowcase extends StatelessWidget {
  const _StageShowcase({
    required this.activeStage,
    required this.onStageChanged,
  });

  final int activeStage;
  final ValueChanged<int> onStageChanged;

  @override
  Widget build(BuildContext context) {
    final stage = HomeData.heroStages[activeStage];

    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFEAF5F2), Color(0xFFFFF2F5)],
        ),
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: 0.07),
            blurRadius: 28,
            offset: const Offset(0, 13),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.95),
              borderRadius: BorderRadius.circular(19),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                const _WindowRail(),

                ClipRRect(
                  borderRadius: const BorderRadius.vertical(
                    bottom: Radius.circular(18),
                  ),
                  child: SizedBox(
                    height: 198,
                    width: double.infinity,
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 380),
                      child: Container(
                        key: ValueKey(stage.assetPath),
                        color: const Color(0xFFFBFDFC),
                        alignment: Alignment.center,
                        padding: const EdgeInsets.fromLTRB(5, 3, 5, 2),
                        child: SvgPicture.asset(
                          stage.assetPath,
                          width: double.infinity,
                          height: 196,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 10),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.8),
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    '0${activeStage + 1}',
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),

                const SizedBox(width: 9),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stage.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 11.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),

                      const SizedBox(height: 2),

                      Text(
                        stage.description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.1,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 9),

          Row(
            children: List.generate(HomeData.heroStages.length, (index) {
              final selected = index == activeStage;

              return Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    onStageChanged(index);
                  },
                  child: Padding(
                    padding: EdgeInsets.only(
                      right: index == HomeData.heroStages.length - 1 ? 0 : 5,
                    ),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      height: selected ? 5 : 3,
                      decoration: BoxDecoration(
                        color: selected
                            ? AppColors.primary
                            : AppColors.borderStrong,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),

          const SizedBox(height: 3),
        ],
      ),
    );
  }
}

class _WindowRail extends StatelessWidget {
  const _WindowRail();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 27,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 11),
        child: Row(
          children: [
            Container(
              width: 6,
              height: 6,
              decoration: const BoxDecoration(
                color: AppColors.pink,
                shape: BoxShape.circle,
              ),
            ),

            const SizedBox(width: 5),

            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.65),
                shape: BoxShape.circle,
              ),
            ),

            const SizedBox(width: 5),

            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: AppColors.primaryDark.withValues(alpha: 0.45),
                shape: BoxShape.circle,
              ),
            ),

            const Spacer(),

            Container(
              width: 44,
              height: 5,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
