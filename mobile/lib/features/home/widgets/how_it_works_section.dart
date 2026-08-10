/// Compact mobile How It Works section for Voxidence.
///
/// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class MobileHowItWorksSection extends StatelessWidget {
  const MobileHowItWorksSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 4, 18, 18),
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.86),
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: 0.05),
              blurRadius: 22,
              offset: const Offset(0, 11),
            ),
          ],
        ),
        child: Column(
          children: [
            const Row(
              children: [
                Expanded(
                  child: Text(
                    'How it works',
                    style: TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.5,
                    ),
                  ),
                ),
                Text(
                  'See all steps',
                  style: TextStyle(
                    color: AppColors.primary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(width: 5),
                Icon(
                  Icons.arrow_forward_rounded,
                  size: 17,
                  color: AppColors.primary,
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _HowStepCard(
                    number: '1',
                    icon: Icons.groups_2_outlined,
                    title: 'Collect voices',
                    description: 'Gather real input from your community.',
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: _HowStepCard(
                    number: '2',
                    icon: Icons.search_rounded,
                    title: 'Analyze signals',
                    description: 'Find repeated needs and key patterns.',
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: _HowStepCard(
                    number: '3',
                    icon: Icons.ads_click_rounded,
                    title: 'Spot opportunities',
                    description: 'Turn evidence into ideas worth building.',
                    pink: true,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HowStepCard extends StatelessWidget {
  const _HowStepCard({
    required this.number,
    required this.icon,
    required this.title,
    required this.description,
    this.pink = false,
  });

  final String number;
  final IconData icon;
  final String title;
  final String description;
  final bool pink;

  @override
  Widget build(BuildContext context) {
    final accent = pink ? AppColors.pink : AppColors.primary;

    final soft = pink ? AppColors.pinkSoft : AppColors.primarySoft;

    return Container(
      padding: const EdgeInsets.fromLTRB(10, 11, 10, 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.88),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: AppColors.border.withValues(alpha: 0.82)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: soft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: accent, size: 21),
              ),
              const Spacer(),
              Container(
                width: 25,
                height: 25,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border),
                ),
                alignment: Alignment.center,
                child: Text(
                  number,
                  style: TextStyle(
                    color: accent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            title,
            maxLines: 2,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 11.5,
              height: 1.2,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            description,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.3,
              height: 1.32,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
