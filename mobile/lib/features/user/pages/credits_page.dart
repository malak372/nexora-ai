// Premium credit center for the Voxidence mobile application.
//
// The page keeps the backend/payment behavior unchanged while presenting the
// account balance, quantity selector, live quote and Premium benefits in a
// compact mobile-first layout.
//
// @author Eman

import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import '../widgets/workspace_navigation.dart';
import 'mobile_checkout_page.dart';

class CreditsPage extends StatefulWidget {
  const CreditsPage({super.key});

  @override
  State<CreditsPage> createState() => _CreditsPageState();
}

class _CreditsPageState extends State<CreditsPage> {
  static const List<int> _presets = [15, 30, 45, 60];

  Map<String, dynamic>? _pricing;
  Object? _error;

  bool _loading = true;
  bool _quoteLoading = false;
  bool _checkoutLoading = false;

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
      var pricing = await UserApi.instance.getPricing(
        creditsQuantity: _quantity,
      );

      final minimum = _asInt(
        pricing['minimumCreditsForPremiumActivation'],
        fallback: 1,
      );

      if (_quantity < minimum) {
        _quantity = minimum;
        pricing = await UserApi.instance.getPricing(creditsQuantity: _quantity);
      }

      if (!mounted) return;

      setState(() {
        _pricing = pricing;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setQuantity(int value) async {
    final minimum = _minimumQuantity;
    final next = value.clamp(minimum, 999).toInt();

    if (next == _quantity || _quoteLoading) return;

    setState(() {
      _quantity = next;
      _quoteLoading = true;
    });

    try {
      final pricing = await UserApi.instance.getPricing(creditsQuantity: next);

      if (!mounted) return;
      setState(() => _pricing = pricing);
    } catch (_) {
      // Keep the previous successful quote visible. The checkout endpoint still
      // validates the selected quantity on the server.
    } finally {
      if (mounted) setState(() => _quoteLoading = false);
    }
  }

  Future<void> _changeQuantity(int delta) {
    return _setQuantity(_quantity + delta);
  }

  Future<void> _checkout() async {
    if (_checkoutLoading) return;

    setState(() => _checkoutLoading = true);

    try {
      final result = await UserApi.instance.createCreditsCheckout(
        quantity: _quantity,
      );

      final flow = await openVoxidenceCheckout(
        // ignore: use_build_context_synchronously
        context,
        checkoutResult: result,
        selectedSection: WorkspaceSection.profile,
        title: 'Buy Premium credits',
      );

      if (flow.status == CheckoutFlowStatus.completed && mounted) {
        await Future.wait([
          UserSessionController.instance.load(force: true),
          _load(force: true),
        ]);
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } catch (_) {
      if (mounted) {
        showAppSnackBar(
          context,
          'Could not open secure checkout. Please try again.',
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _checkoutLoading = false);
    }
  }

  int get _minimumQuantity =>
      _asInt(_pricing?['minimumCreditsForPremiumActivation'], fallback: 1);

  void _backToProfile() {
    returnFromWorkspacePage(context);
  }

  @override
  Widget build(BuildContext context) {
    final session = UserSessionController.instance;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _CreditsRouteHeader(onBack: _backToProfile),
          Expanded(
            child: WorkspaceBackground(
              child: AnimatedBuilder(
                animation: session,
                builder: (context, _) {
                  final summary = session.summary;
                  final pricing = _pricing ?? const <String, dynamic>{};
                  final premium = summary?.isPremium == true;
                  final currency = '${pricing['currency'] ?? 'USD'}';

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
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 126),
                      children: [
                        _AccessHero(
                          premium: premium,
                          creditBalance: summary?.creditBalance ?? 0,
                          freeIdeas: summary?.remainingFreeGenerations ?? 0,
                        ),
                        const SizedBox(height: 14),
                        if (_loading && _pricing == null)
                          const LoadingList(count: 3)
                        else if (_error != null && _pricing == null)
                          EmptyState(
                            icon: Icons.cloud_off_rounded,
                            title: 'Pricing unavailable',
                            message: _error.toString(),
                            action: FilledButton.icon(
                              onPressed: () => _load(force: true),
                              icon: const Icon(
                                Icons.refresh_rounded,
                                size: 17,
                              ),
                              label: const Text('Try again'),
                            ),
                          )
                        else ...[
                          _CreditSelectorCard(
                            premium: premium,
                            quantity: _quantity,
                            minimum: _minimumQuantity,
                            quoteLoading: _quoteLoading,
                            presets: _presets,
                            onSelectPreset: _setQuantity,
                            onDecrease: () => _changeQuantity(-1),
                            onIncrease: () => _changeQuantity(1),
                          ),
                          const SizedBox(height: 12),
                          _CheckoutCard(
                            premium: premium,
                            quantity: _quantity,
                            pricing: pricing,
                            currency: currency,
                            loading: _checkoutLoading,
                            onCheckout: _checkout,
                          ),
                          const SizedBox(height: 12),
                          _PremiumBenefitsCard(premium: premium),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreditsRouteHeader extends StatelessWidget {
  const _CreditsRouteHeader({
    required this.onBack,
  });

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final returnTitle = workspaceReturnTarget(context).title;

    return Material(
      color: AppColors.surface.withValues(alpha: .985),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 6, 18, 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.border.withValues(alpha: .65),
              ),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .025),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onBack,
                  borderRadius: BorderRadius.circular(14),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons.arrow_back_rounded,
                        size: 26,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 18.5,
                          height: 1.08,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.28,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Credits & Premium',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.6,
                          height: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}


class _AccessHero extends StatelessWidget {
  const _AccessHero({
    required this.premium,
    required this.creditBalance,
    required this.freeIdeas,
  });

  final bool premium;
  final int creditBalance;
  final int freeIdeas;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 17),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF3FBF9), Color(0xFFFFFDFC), Color(0xFFFFF4F7)],
          stops: [0, .58, 1],
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: .96)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .07),
            blurRadius: 30,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            top: -38,
            right: -28,
            child: Container(
              width: 118,
              height: 118,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .075),
              ),
            ),
          ),
          Positioned(
            bottom: -44,
            left: -34,
            child: Container(
              width: 104,
              height: 104,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .065),
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFFECF8F5), Color(0xFFDDF2EE)],
                      ),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: .13),
                      ),
                    ),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        const Icon(
                          Icons.bolt_rounded,
                          color: AppColors.primaryDark,
                          size: 22,
                        ),
                        Positioned(
                          top: 9,
                          right: 9,
                          child: Icon(
                            Icons.auto_awesome_rounded,
                            color: AppColors.pinkDeep,
                            size: 7,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  AccountTierBadge(isPremium: premium),
                ],
              ),
              const SizedBox(height: 17),
              Text(
                premium
                    ? 'Power your next move.'
                    : 'Unlock more when you need it.',
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 25,
                  height: 1.05,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.75,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                premium
                    ? 'Add credits only when a Premium action needs them. Your already-unlocked work stays available.'
                    : 'Choose a credit amount and activate Premium through one secure checkout.',
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 11.2,
                  height: 1.48,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.fromLTRB(13, 11, 13, 11),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .70),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primarySoft,
                      ),
                      child: Icon(
                        premium ? Icons.bolt_rounded : Icons.eco_outlined,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            premium
                                ? '$creditBalance credits available'
                                : '$freeIdeas free ideas remaining',
                            style: const TextStyle(
                              color: AppColors.primaryDeep,
                              fontSize: 13.2,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            premium
                                ? 'Live balance from your account'
                                : 'Premium activates after verified payment',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.7,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.verified_rounded,
                      color: AppColors.primary,
                      size: 18,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CreditSelectorCard extends StatelessWidget {
  const _CreditSelectorCard({
    required this.premium,
    required this.quantity,
    required this.minimum,
    required this.quoteLoading,
    required this.presets,
    required this.onSelectPreset,
    required this.onDecrease,
    required this.onIncrease,
  });

  final bool premium;
  final int quantity;
  final int minimum;
  final bool quoteLoading;
  final List<int> presets;
  final ValueChanged<int> onSelectPreset;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      padding: const EdgeInsets.fromLTRB(16, 17, 16, 16),
      radius: 26,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Choose credits',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 17.5,
              fontWeight: FontWeight.w900,
              letterSpacing: -.35,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            premium
                ? 'Pick a shortcut or fine-tune the exact amount.'
                : 'Pick your starting balance for Premium access.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.4,
              height: 1.4,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 14),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = (constraints.maxWidth - 8) / 2;

              return Wrap(
                spacing: 8,
                runSpacing: 8,
                children: presets.map((amount) {
                  final selected = amount == quantity;
                  final disabled = amount < minimum;

                  return SizedBox(
                    width: width,
                    child: _CreditPreset(
                      amount: amount,
                      selected: selected,
                      disabled: disabled,
                      onTap: () => onSelectPreset(amount),
                    ),
                  );
                }).toList(),
              );
            },
          ),
          const SizedBox(height: 17),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primarySoft.withValues(alpha: .85),
                  const Color(0xFFF8FCFB),
                ],
              ),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    _QuantityButton(
                      icon: Icons.remove_rounded,
                      enabled: quantity > minimum && !quoteLoading,
                      onTap: onDecrease,
                    ),
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 180),
                        child: Column(
                          key: ValueKey(quantity),
                          children: [
                            Text(
                              '$quantity',
                              style: const TextStyle(
                                color: AppColors.primaryDeep,
                                fontSize: 31,
                                height: 1,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.8,
                              ),
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'credits',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9.5,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    _QuantityButton(
                      icon: Icons.add_rounded,
                      enabled: !quoteLoading,
                      onTap: onIncrease,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (quoteLoading) ...[
                      const SizedBox(
                        width: 11,
                        height: 11,
                        child: CircularProgressIndicator(
                          strokeWidth: 1.4,
                          color: AppColors.primaryDark,
                        ),
                      ),
                      const SizedBox(width: 6),
                    ],
                    Flexible(
                      child: Text(
                        premium
                            ? 'Custom quantity · minimum 1 credit'
                            : 'Minimum $minimum credits for activation',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 8.6,
                          fontWeight: FontWeight.w700,
                        ),
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

class _CreditPreset extends StatelessWidget {
  const _CreditPreset({
    required this.amount,
    required this.selected,
    required this.disabled,
    required this.onTap,
  });

  final int amount;
  final bool selected;
  final bool disabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: disabled ? null : onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 170),
          height: 46,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primary.withValues(alpha: .20)
                : AppColors.surface.withValues(alpha: .78),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .42)
                  : AppColors.borderStrong,
              width: selected ? 1.2 : 1,
            ),
          ),
          child: Row(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 170),
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected
                      ? AppColors.primaryDark
                      : AppColors.primarySoft,
                ),
                child: Icon(
                  selected ? Icons.check_rounded : Icons.bolt_rounded,
                  size: 13,
                  color: selected ? Colors.white : AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$amount credits',
                  maxLines: 1,
                  style: TextStyle(
                    color: disabled
                        ? AppColors.textMuted.withValues(alpha: .58)
                        : AppColors.textPrimary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: enabled
          ? AppColors.primary.withValues(alpha: .18)
          : AppColors.silver.withValues(alpha: .17),
      shape: const CircleBorder(),
      child: InkWell(
        onTap: enabled ? onTap : null,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: 45,
          height: 45,
          child: Icon(
            icon,
            size: 22,
            color: enabled
                ? AppColors.primaryDeep
                : AppColors.textMuted.withValues(alpha: .45),
          ),
        ),
      ),
    );
  }
}

class _CheckoutCard extends StatelessWidget {
  const _CheckoutCard({
    required this.premium,
    required this.quantity,
    required this.pricing,
    required this.currency,
    required this.loading,
    required this.onCheckout,
  });

  final bool premium;
  final int quantity;
  final Map<String, dynamic> pricing;
  final String currency;
  final bool loading;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    final creditPrice = _money(pricing['creditPrice']);
    final activationFee = _money(pricing['activationFeeApplied']);
    final total = _money(pricing['creditPurchaseTotal']);
    final feeValue = num.tryParse('${pricing['activationFeeApplied']}') ?? 0;

    return VoxCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      radius: 26,
      tint: AppColors.surface.withValues(alpha: .96),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SoftIconBadge(icon: Icons.credit_card_rounded, size: 39),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Secure checkout',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Card payment through the verified provider',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.7,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.lock_rounded,
                      size: 11,
                      color: AppColors.primaryDark,
                    ),
                    SizedBox(width: 4),
                    Text(
                      'SECURE',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.3,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .45,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.fromLTRB(13, 11, 13, 11),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted.withValues(alpha: .50),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                _QuoteLine(
                  label: '$quantity credits',
                  value: '$creditPrice $currency each',
                ),
                if (feeValue > 0) ...[
                  const SizedBox(height: 8),
                  _QuoteLine(
                    label: 'Premium activation',
                    value: '$activationFee $currency',
                  ),
                ],
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 10),
                  child: Divider(height: 1),
                ),
                _QuoteLine(
                  label: 'Total',
                  value: '$total $currency',
                  strong: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 11),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.info_outline_rounded,
                size: 14,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  premium
                      ? 'Your account is already Premium, so no activation fee is charged again.'
                      : 'Premium activates automatically after payment is verified. The activation fee is applied only when shown above.',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.8,
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: loading ? null : onCheckout,
              icon: loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.arrow_forward_rounded, size: 18),
              label: Text(
                loading
                    ? 'Opening secure checkout…'
                    : 'Continue · $total $currency',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuoteLine extends StatelessWidget {
  const _QuoteLine({
    required this.label,
    required this.value,
    this.strong = false,
  });

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: strong ? AppColors.textPrimary : AppColors.textSecondary,
              fontSize: strong ? 11.6 : 9.8,
              fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Text(
          value,
          textAlign: TextAlign.right,
          style: TextStyle(
            color: AppColors.primaryDeep,
            fontSize: strong ? 14.2 : 10,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _PremiumBenefitsCard extends StatelessWidget {
  const _PremiumBenefitsCard({required this.premium});

  final bool premium;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      radius: 26,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      tint: AppColors.surfaceRose.withValues(alpha: .78),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SoftIconBadge(
                icon: Icons.auto_awesome_rounded,
                rose: true,
                size: 39,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      premium ? 'Your Premium toolkit' : 'What Premium unlocks',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Credits are used only for actions that require them.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          const _BenefitRow(
            icon: Icons.auto_awesome_motion_rounded,
            title: 'Complete Premium ideas',
            text:
                'Generate the technical, business, market, feasibility and execution layers.',
          ),
          const _BenefitRow(
            icon: Icons.chat_bubble_outline_rounded,
            title: 'Premium AI workspace',
            text:
                'Use AI Chat with eligible unlocked ideas while the account is Premium.',
          ),
          const _BenefitRow(
            icon: Icons.lock_open_rounded,
            title: 'Advanced unlocks',
            text:
                'Use the configured credit cost only when protected outputs need access.',
          ),
          const _BenefitRow(
            icon: Icons.inventory_2_outlined,
            title: 'Keep what you unlock',
            text:
                'Previously generated or unlocked outputs remain available after credits are used.',
            last: true,
          ),
        ],
      ),
    );
  }
}

class _BenefitRow extends StatelessWidget {
  const _BenefitRow({
    required this.icon,
    required this.title,
    required this.text,
    this.last = false,
  });

  final IconData icon;
  final String title;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 31,
            height: 31,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white.withValues(alpha: .68),
              border: Border.all(color: AppColors.border),
            ),
            child: Icon(icon, size: 15, color: AppColors.primaryDark),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  text,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 8.8,
                    height: 1.38,
                    fontWeight: FontWeight.w600,
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

int _asInt(dynamic value, {required int fallback}) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value') ?? fallback;
}

String _money(dynamic value) {
  final amount = num.tryParse('$value');
  if (amount == null) return '—';

  if (amount == amount.roundToDouble()) {
    return amount.toInt().toString();
  }

  return amount.toStringAsFixed(2);
}
