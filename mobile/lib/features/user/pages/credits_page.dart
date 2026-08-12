// Mobile equivalent of the web Credits / Upgrade page.
//
// @author  Malak

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class CreditsPage extends StatefulWidget {
  const CreditsPage({super.key});

  @override
  State<CreditsPage> createState() => _CreditsPageState();
}

class _CreditsPageState extends State<CreditsPage> {
  Map<String, dynamic>? _pricing;
  bool _loading = true;
  bool _checkoutLoading = false;
  Object? _error;
  int _quantity = 15;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final pricing = await UserApi.instance.getPricing(
        creditsQuantity: _quantity,
      );
      final minimum = _asInt(
        pricing['minimumCreditsForPremiumActivation'],
        fallback: 1,
      );
      if (!mounted) return;
      setState(() {
        _pricing = pricing;
        if (_quantity < minimum) _quantity = minimum;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refreshQuote() async {
    try {
      final pricing = await UserApi.instance.getPricing(
        creditsQuantity: _quantity,
      );
      if (mounted) setState(() => _pricing = pricing);
    } catch (_) {
      // Keep the last visible quote while the quantity is being adjusted.
    }
  }

  Future<void> _changeQuantity(int delta) async {
    final minimum = _asInt(
      _pricing?['minimumCreditsForPremiumActivation'],
      fallback: 1,
    );
    final next = (_quantity + delta).clamp(minimum, 999).toInt();
    if (next == _quantity) return;
    setState(() => _quantity = next);
    await _refreshQuote();
  }

  Future<void> _checkout() async {
    if (_checkoutLoading) return;
    setState(() => _checkoutLoading = true);

    try {
      final result = await UserApi.instance.createCreditsCheckout(
        quantity: _quantity,
      );
      final url = result['checkoutUrl']?.toString() ??
          result['url']?.toString() ??
          (result['payment'] is Map
              ? (result['payment'] as Map)['checkoutUrl']?.toString()
              : null);

      if (url == null || url.trim().isEmpty) {
        throw const ApiException(
          'The payment provider did not return a secure checkout URL.',
        );
      }

      final uri = Uri.tryParse(url);
      if (uri == null ||
          !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw const ApiException('The secure checkout could not be opened.');
      }
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _checkoutLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = UserSessionController.instance;

    return Scaffold(
      appBar: AppBar(title: const Text('Credits & Premium')),
      body: WorkspaceBackground(
        child: AnimatedBuilder(
          animation: session,
          builder: (context, _) {
            final summary = session.summary;
            final pricing = _pricing ?? const <String, dynamic>{};
            final currency = '${pricing['currency'] ?? 'USD'}';
            final creditPrice = '${pricing['creditPrice'] ?? '—'}';
            final total = '${pricing['creditPurchaseTotal'] ?? '—'}';
            final fee = '${pricing['activationFeeApplied'] ?? '0.00'}';
            final minimum = _asInt(
              pricing['minimumCreditsForPremiumActivation'],
              fallback: 1,
            );

            return RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () async {
                await Future.wait([
                  _load(force: true),
                  session.load(force: true),
                ]);
              },
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 34),
                children: [
                  WorkspacePageHeader(
                    eyebrow: 'ACCESS',
                    title: 'Unlock premium capabilities only when you need them.',
                    subtitle: summary?.isPremium == true
                        ? 'Add more credits to keep using your Premium generation and advanced idea capabilities.'
                        : 'Activate your Premium account and add credits for complete idea generation and advanced outputs.',
                    trailing: AccountTierBadge(
                      isPremium: summary?.isPremium == true,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (summary != null)
                    VoxCard(
                      tint: AppColors.primarySoft.withValues(alpha: .82),
                      child: Row(
                        children: [
                          const SoftIconBadge(
                            icon: Icons.bolt_rounded,
                            size: 44,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  summary.isPremium
                                      ? '${summary.creditBalance} credits available'
                                      : '${summary.remainingFreeGenerations} free ideas remaining',
                                  style: const TextStyle(
                                    color: AppColors.primaryDeep,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  summary.isPremium
                                      ? 'Credits are used only for premium actions that require them.'
                                      : 'Buying credits upgrades this account to Premium and adds the activation fee once.',
                                  style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 10.5,
                                    height: 1.4,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 14),
                  if (_loading && _pricing == null)
                    const LoadingList(count: 3)
                  else if (_error != null && _pricing == null)
                    EmptyState(
                      icon: Icons.cloud_off_rounded,
                      title: 'Pricing unavailable',
                      message: _error.toString(),
                      action: FilledButton(
                        onPressed: () => _load(force: true),
                        child: const Text('Retry'),
                      ),
                    )
                  else ...[
                    VoxCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SectionHeading(
                            title: 'Choose credits',
                            subtitle: summary?.isPremium == true
                                ? 'Select a shortcut or enter the exact quantity you want to add.'
                                : 'Choose your starting credit balance. Premium activates automatically after payment is verified.',
                          ),
                          const SizedBox(height: 14),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [15, 30, 45, 60].map((amount) {
                              final selected = _quantity == amount;
                              final disabled = amount < minimum;
                              return ChoiceChip(
                                selected: selected,
                                label: Text('$amount credits'),
                                onSelected: disabled
                                    ? null
                                    : (_) async {
                                        setState(() => _quantity = amount);
                                        await _refreshQuote();
                                      },
                              );
                            }).toList(),
                          ),
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              IconButton.filledTonal(
                                onPressed: _quantity <= minimum
                                    ? null
                                    : () => _changeQuantity(-1),
                                icon: const Icon(Icons.remove_rounded),
                              ),
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      '$_quantity',
                                      style: const TextStyle(
                                        color: AppColors.primaryDeep,
                                        fontSize: 29,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    const Text(
                                      'credits',
                                      style: TextStyle(
                                        color: AppColors.textMuted,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton.filledTonal(
                                onPressed: () => _changeQuantity(1),
                                icon: const Icon(Icons.add_rounded),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Center(
                            child: Text(
                              summary?.isPremium == true
                                  ? 'Custom quantity · minimum 1 credit'
                                  : 'Custom quantity · minimum $minimum credits to activate Premium',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          const _PaymentMethodCard(),
                          const SizedBox(height: 14),
                          _ActivationFeeNotice(
                            isPremium: summary?.isPremium == true,
                            fee: fee,
                            currency: currency,
                            pricingLoaded: _pricing != null,
                          ),
                          const SizedBox(height: 14),
                          _PriceLine(
                            label: 'Credit price',
                            value: '$creditPrice $currency',
                          ),
                          if (fee != '0.00')
                            _PriceLine(
                              label: 'Premium activation fee',
                              value: '$fee $currency',
                            ),
                          const Divider(height: 22),
                          _PriceLine(
                            label: 'Total',
                            value: '$total $currency',
                            strong: true,
                          ),
                          const SizedBox(height: 14),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed:
                                  _checkoutLoading ? null : _checkout,
                              icon: _checkoutLoading
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(Icons.lock_outline_rounded),
                              label: Text(
                                _checkoutLoading
                                    ? 'Opening secure checkout...'
                                    : summary?.isPremium == true
                                        ? 'Continue to secure payment'
                                        : 'Continue to secure payment',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    VoxCard(
                      tint: AppColors.surfaceRose.withValues(alpha: .86),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              SoftIconBadge(
                                icon: Icons.auto_awesome_rounded,
                                rose: true,
                                size: 38,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'What Premium unlocks',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          const _Benefit(
                            title: 'Premium idea generation',
                            text: 'Each Premium idea uses the configured credit cost and includes complete technical, business, feasibility, market, budget, and execution outputs.',
                          ),
                          const _Benefit(
                            title: 'AI Chat for unlocked ideas',
                            text: 'Use Voxidence Chat while your account is Premium to explore and refine ideas that are already unlocked.',
                          ),
                          const _Benefit(
                            title: 'See every active published idea',
                            text: 'Browse active published ideas with Premium discovery access.',
                          ),
                          const _Benefit(
                            title: 'Premium publication access',
                            text: 'Accept published ideas, then use the configured credit cost only when unlocking protected advanced publication outputs.',
                          ),
                          const _Benefit(
                            title: 'Permanent unlocked access',
                            text: 'Ideas and outputs already generated or unlocked remain available even after your credit balance reaches zero.',
                          ),
                          const _Benefit(
                            title: 'Premium account capabilities',
                            text: 'Premium status enables the Premium discovery and AI workspace experience while the account remains Premium.',
                          ),
                          const SizedBox(height: 8),
                          const Row(
                            children: [
                              Expanded(
                                child: InlineNotice(
                                  icon: Icons.verified_user_outlined,
                                  message: 'Verified provider webhook',
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  int _asInt(dynamic value, {required int fallback}) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse('$value') ?? fallback;
  }
}

class _PriceLine extends StatelessWidget {
  const _PriceLine({
    required this.label,
    required this.value,
    this.strong = false,
  });

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: strong
                    ? AppColors.textPrimary
                    : AppColors.textSecondary,
                fontSize: strong ? 13 : 11.5,
                fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: AppColors.primaryDeep,
              fontSize: strong ? 15 : 12,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _Benefit extends StatelessWidget {
  const _Benefit({required this.title, required this.text});

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(
              Icons.check_circle_rounded,
              size: 16,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  text,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.8,
                    height: 1.4,
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

class _PaymentMethodCard extends StatelessWidget {
  const _PaymentMethodCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .48),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: const Row(
        children: [
          SoftIconBadge(icon: Icons.credit_card_rounded, size: 36),
          SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Credit or debit card',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Visa or Mastercard through Stripe Checkout · Most popular',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.2,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          Icon(Icons.check_circle_rounded, color: AppColors.primary, size: 18),
        ],
      ),
    );
  }
}

class _ActivationFeeNotice extends StatelessWidget {
  const _ActivationFeeNotice({
    required this.isPremium,
    required this.fee,
    required this.currency,
    required this.pricingLoaded,
  });

  final bool isPremium;
  final String fee;
  final String currency;
  final bool pricingLoaded;

  @override
  Widget build(BuildContext context) {
    return InlineNotice(
      icon: Icons.workspace_premium_outlined,
      message: isPremium
          ? 'No Premium activation fee. Your account is already Premium, so the activation fee is not charged again.'
          : pricingLoaded
              ? '$fee $currency is charged when this Normal account activates Premium. If the balance later reaches 0, the account returns to Normal and this fee applies again on the next activation.'
              : 'Loading the current Premium activation fee…',
    );
  }
}
