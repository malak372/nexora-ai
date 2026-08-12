// Compact mobile workflow section for Voxidence.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../models/home_models.dart';
import 'common.dart';

class MobileHowItWorksSection extends StatelessWidget {
  const MobileHowItWorksSection({super.key});

  static const double _cardHeight = 162;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 28, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Eyebrow(
            text: 'HOW VOXIDENCE WORKS',
            icon: Icons.auto_awesome_rounded,
          ),

          const SizedBox(height: 13),

          const Text(
            'From scattered voices to one clear direction.',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 29,
              height: 1.08,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.8,
            ),
          ),

          const SizedBox(height: 9),

          const Text(
            'Voxidence listens, finds repeated patterns, compares AI directions, and shapes the strongest opportunity into a clear project.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 15,
              height: 1.58,
            ),
          ),

          const SizedBox(height: 18),

          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.86),
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: 0.05),
                  blurRadius: 22,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: _cardHeight,
                        child: _StepCard(step: HomeData.workflowSteps[0]),
                      ),
                    ),

                    const SizedBox(width: 8),

                    Expanded(
                      child: SizedBox(
                        height: _cardHeight,
                        child: _StepCard(step: HomeData.workflowSteps[1]),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 8),

                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: _cardHeight,
                        child: _StepCard(step: HomeData.workflowSteps[2]),
                      ),
                    ),

                    const SizedBox(width: 8),

                    Expanded(
                      child: SizedBox(
                        height: _cardHeight,
                        child: _StepCard(step: HomeData.workflowSteps[3]),
                      ),
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

class _StepCard extends StatelessWidget {
  const _StepCard({required this.step});

  final WorkflowStep step;

  @override
  Widget build(BuildContext context) {
    final usePink = step.number == 3;

    final accent = usePink ? AppColors.pink : AppColors.primaryDark;

    final soft = usePink ? AppColors.pinkSoft : AppColors.primarySoft;

    return Container(
      width: double.infinity,
      height: double.infinity,
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 11),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, soft.withValues(alpha: 0.58)],
        ),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: soft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(step.icon, size: 17, color: accent),
              ),

              const Spacer(),

              Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border),
                ),
                alignment: Alignment.center,
                child: Text(
                  '0${step.number}',
                  style: TextStyle(
                    color: accent,
                    fontSize: 8.6,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),

          SizedBox(
            height: 29,
            child: Align(
              alignment: Alignment.topLeft,
              child: Text(
                step.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.1,
                  height: 1.16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),

          const SizedBox(height: 5),

          Expanded(
            child: Text(
              step.description,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.1,
                height: 1.30,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
