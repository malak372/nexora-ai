// Mobile direct-unlock / premium-credit page.
//
// @author  Malak

import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import '../widgets/workspace_navigation.dart';
import 'idea_workspace_page.dart';
import 'mobile_checkout_page.dart';

class DirectUnlockPage extends StatefulWidget {
  const DirectUnlockPage({super.key, required this.ideaId});

  final String ideaId;

  @override
  State<DirectUnlockPage> createState() => _DirectUnlockPageState();
}

class _DirectUnlockPageState extends State<DirectUnlockPage> {
  bool _loading = true;
  bool _busy = false;
  String? _error;
  Map<String, dynamic> _pricing = const {};
  Map<String, dynamic> _idea = const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final values = await Future.wait([
        UserApi.instance.getPricing(),
        UserApi.instance.getIdeaDetails(widget.ideaId, force: true),
      ]);
      if (!mounted) return;
      setState(() {
        _pricing = values[0];
        _idea = values[1];
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _unlock() async {
    if (_busy) return;
    final session = UserSessionController.instance;
    final premium = session.summary?.isPremium == true;
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      if (premium) {
        await UserApi.instance.unlockIdeaWithCredits(widget.ideaId);
        await session.load(force: true);
        if (!mounted) return;
        showAppSnackBar(context, 'Advanced idea outputs unlocked.');
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => IdeaWorkspacePage(ideaId: widget.ideaId),
          ),
        );
        return;
      }

      final result = await UserApi.instance.createDirectUnlockCheckout(
        widget.ideaId,
      );

      final flow = await openVoxidenceCheckout(
        // ignore: use_build_context_synchronously
        context,
        checkoutResult: result,
        selectedSection: WorkspaceSection.ideas,
        ideaId: widget.ideaId,
        title: 'Unlock advanced workspace',
      );

      if (flow.status == CheckoutFlowStatus.completed && mounted) {
        await session.load(force: true);
        await _load();
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = UserSessionController.instance;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          child: AnimatedBuilder(
            animation: session,
            builder: (context, _) {
              final premium = session.summary?.isPremium == true;
              final cost = _asInt(_pricing['premiumIdeaCreditCost']);
              final title = _ideaTitle(_idea);
              return ListView(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 34),
                children: [
                  WorkspacePageHeader(
                    eyebrow: premium ? 'PREMIUM ACCESS' : 'DIRECT UNLOCK',
                    title: premium
                        ? 'Unlock with credits'
                        : 'Complete this idea',
                    subtitle: premium
                        ? 'Use your Premium credits to attach the advanced outputs and AI workspace.'
                        : 'Open the complete execution package through secure checkout.',
                    icon: Icons.lock_open_rounded,
                    onBack: () => Navigator.maybePop(context),
                    trailing: AccountTierBadge(isPremium: premium),
                  ),
                  const SizedBox(height: 16),
                  if (_loading)
                    const LoadingList(count: 3)
                  else if (_error != null && _idea.isEmpty)
                    EmptyState(
                      icon: Icons.cloud_off_rounded,
                      title: 'Unlock details unavailable',
                      message: _error!,
                      action: FilledButton(
                        onPressed: _load,
                        child: const Text('Retry'),
                      ),
                    )
                  else ...[
                    VoxCard(
                      tint: AppColors.primarySoft.withValues(alpha: .72),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const SoftIconBadge(
                                icon: Icons.auto_awesome_rounded,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          _Benefit(
                            icon: Icons.description_outlined,
                            text: 'Full abstract and complete technical stack',
                          ),
                          _Benefit(
                            icon: Icons.account_tree_outlined,
                            text:
                                'System architecture, database design, MVP and timeline',
                          ),
                          _Benefit(
                            icon: Icons.analytics_outlined,
                            text:
                                'Business, feasibility, market and budget outputs',
                          ),
                          _Benefit(
                            icon: Icons.picture_as_pdf_outlined,
                            text:
                                'Business-model studio with polished PDF export',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _TrustPill(
                            icon: Icons.verified_user_outlined,
                            label: premium
                                ? 'No direct payment'
                                : 'Provider verified',
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _TrustPill(
                            icon: Icons.lock_outline_rounded,
                            label: premium
                                ? (cost > 0
                                      ? '$cost credits only'
                                      : 'Workspace-priced credits')
                                : 'Secure redirect',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    VoxCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            premium ? 'Credit unlock' : 'Secure direct payment',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            premium
                                ? (cost > 0
                                      ? '$cost credits · ${session.summary?.creditBalance ?? 0} available. Confirming deducts the required credits once and opens the advanced workspace.'
                                      : 'The required credit amount is loaded from your workspace pricing before unlock.')
                                : '${_money(_pricing['directUnlockPrice'])} ${_pricing['currency'] ?? 'USD'} · Choose a payment method. Voxidence sends you to a secure provider-hosted checkout and grants access only after verified confirmation.',
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              height: 1.45,
                              fontSize: 11,
                            ),
                          ),
                          if (!premium) ...[
                            const SizedBox(height: 13),
                            const _PaymentMethodCard(),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            InlineNotice(
                              icon: Icons.error_outline_rounded,
                              title: 'Could not continue',
                              message: _error!,
                            ),
                          ],
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: _busy ? null : _unlock,
                              icon: _busy
                                  ? const SizedBox(
                                      width: 17,
                                      height: 17,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Icon(
                                      premium
                                          ? Icons.bolt_rounded
                                          : Icons.credit_card_rounded,
                                      size: 18,
                                    ),
                              label: Text(
                                premium
                                    ? (cost > 0
                                          ? 'Unlock for $cost credits'
                                          : 'Unlock with credits')
                                    : 'Open secure checkout',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _TrustPill extends StatelessWidget {
  const _TrustPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: .8),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              style: const TextStyle(
                color: AppColors.primaryDeep,
                fontSize: 9.2,
                fontWeight: FontWeight.w800,
              ),
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
        color: AppColors.primarySoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.primary.withValues(alpha: .32)),
      ),
      child: const Row(
        children: [
          SoftIconBadge(icon: Icons.credit_card_rounded, size: 38),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Credit or debit card',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w900,
                          fontSize: 11.2,
                        ),
                      ),
                    ),
                    StatusChip(label: 'MOST POPULAR', positive: true),
                  ],
                ),
                SizedBox(height: 3),
                Text(
                  'Visa or Mastercard through Stripe Test Checkout',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.5,
                    height: 1.35,
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

String _money(dynamic value) {
  final amount = num.tryParse('$value');
  if (amount == null) return 'Loading price…';
  return amount == amount.roundToDouble()
      ? amount.toInt().toString()
      : amount.toStringAsFixed(2);
}

class _Benefit extends StatelessWidget {
  const _Benefit({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .78),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.primaryDark, size: 15),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(
                text,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10.8,
                  height: 1.4,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

int _asInt(dynamic value) {
  if (value is num) return value.toInt();
  return int.tryParse('${value ?? ''}') ?? 0;
}

String _ideaTitle(Map<String, dynamic> raw) {
  final idea = raw['idea'] is Map
      ? Map<String, dynamic>.from(raw['idea'] as Map)
      : const <String, dynamic>{};
  final title = '${raw['title'] ?? idea['title'] ?? 'Your idea'}'.trim();
  return title.isEmpty ? 'Your idea' : title;
}
