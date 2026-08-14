import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../models/payment_currency.dart';

class PaymentCurrencyPreferenceCard extends StatelessWidget {
  const PaymentCurrencyPreferenceCard({
    super.key,
    required this.value,
    this.compact = false,
    this.returnTitle = 'Profile',
    this.returnRoute = '/normal/profile',
    this.returnAfterSave = false,
    this.onReturn,
  });

  final String value;
  final bool compact;
  final String returnTitle;
  final String returnRoute;
  final bool returnAfterSave;
  final Future<void> Function()? onReturn;

  @override
  Widget build(BuildContext context) {
    final option = PaymentCurrencyPreference.optionFor(value);

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 11 : 13,
        vertical: compact ? 10 : 12,
      ),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .48),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .13),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .9),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              option.symbol,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 13,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Saved payment currency',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.6,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${option.code} · ${option.name}',
                  style: const TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 11.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () async {
              await Navigator.of(context).pushNamed(
                '/normal/preferences',
                arguments: {
                  'returnTitle': returnTitle,
                  'returnRoute': returnRoute,
                  'returnAfterSave': returnAfterSave,
                },
              );
              await onReturn?.call();
            },
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primaryDark,
              padding: const EdgeInsets.symmetric(
                horizontal: 9,
                vertical: 7,
              ),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Change',
              style: TextStyle(
                fontSize: 9.8,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
