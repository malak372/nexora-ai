// Voxidence mobile billing history workspace.
//
// Provides a refined, mobile-first view of verified invoices, payment records,
// invoice details, provider references, and downloadable PDF receipts.
//
// @author Eman

import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'invoice_pdf_download.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';

class BillingPage extends StatefulWidget {
  const BillingPage({super.key});

  @override
  State<BillingPage> createState() => _BillingPageState();
}

class _BillingPageState extends State<BillingPage> {
  List<Map<String, dynamic>> _items = const [];

  bool _loading = true;
  bool _syncing = false;

  Object? _error;

  int _page = 1;
  int _total = 0;
  int _totalPages = 1;

  @override
  void initState() {
    super.initState();
    _load();
    _syncInBackground();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final result = await UserApi.instance.getInvoices(
        page: _page,
        limit: 8,
        force: force,
      );

      if (!mounted) return;

      setState(() {
        _items = result.items;
        _total = result.total;
        _totalPages = result.totalPages < 1 ? 1 : result.totalPages;

        if (_page > _totalPages) {
          _page = _totalPages;
        }
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error;
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _syncInBackground() async {
    if (_syncing) return;

    _syncing = true;

    try {
      final result = await UserApi.instance.synchronizeInvoices();
      final created = _toInt(result['created']);

      if (created > 0) {
        await _load(force: true);
      }
    } catch (_) {
      // Background synchronization should never block the billing workspace.
    } finally {
      _syncing = false;
    }
  }

  Future<void> _openInvoice(Map<String, dynamic> invoice) async {
    final id = invoice['id']?.toString().trim() ?? '';

    if (id.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (_) {
        return _InvoiceDetailSheet(
          invoiceId: id,
          initialInvoice: invoice,
        );
      },
    );
  }

  Future<void> _goToPage(int next) async {
    if (next < 1 ||
        next > _totalPages ||
        next == _page ||
        _loading) {
      return;
    }

    setState(() {
      _page = next;
    });

    await _load();
  }

  void _backToProfile() {
    returnFromWorkspacePage(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _BillingNavigationHeader(
            onBack: _backToProfile,
          ),
          Expanded(
            child: WorkspaceBackground(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () => _load(force: true),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    15,
                    16,
                    126,
                  ),
                  children: [
                    _BillingHero(total: _total),

                    const SizedBox(height: 14),

                    const _ProviderPanel(),

                    const SizedBox(height: 22),

                    _InvoiceSectionHeader(
                      total: _total,
                    ),

                    const SizedBox(height: 12),

                    if (_loading && _items.isEmpty)
                      const LoadingList(count: 4)
                    else if (_error != null && _items.isEmpty)
                      EmptyState(
                        icon: Icons.receipt_long_outlined,
                        title: 'Billing history unavailable',
                        message: _cleanError(_error),
                        action: FilledButton.icon(
                          onPressed: () => _load(force: true),
                          icon: const Icon(
                            Icons.refresh_rounded,
                            size: 18,
                          ),
                          label: const Text('Try again'),
                        ),
                      )
                    else if (_items.isEmpty)
                      const EmptyState(
                        icon: Icons.receipt_long_outlined,
                        title: 'No invoices yet',
                        message:
                            'Your verified invoices will appear here after your first successful payment.',
                      )
                    else
                      ..._items.map(
                        (invoice) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 11),
                            child: _InvoiceCard(
                              invoice: invoice,
                              onTap: () => _openInvoice(invoice),
                            ),
                          );
                        },
                      ),

                    if (_totalPages > 1) ...[
                      const SizedBox(height: 4),
                      _PaginationBar(
                        page: _page,
                        totalPages: _totalPages,
                        loading: _loading,
                        onPrevious: () => _goToPage(_page - 1),
                        onNext: () => _goToPage(_page + 1),
                      ),
                    ],

                    const SizedBox(height: 8),

                    const _BillingSecurityNote(),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  int _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();

    return int.tryParse('$value') ?? 0;
  }
}

class _BillingNavigationHeader extends StatelessWidget {
  const _BillingNavigationHeader({
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
          padding: const EdgeInsets.fromLTRB(
            15,
            7,
            18,
            11,
          ),
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
                  borderRadius: BorderRadius.circular(15),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons.arrow_back_rounded,
                        size: 27,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 4),

              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 19,
                          height: 1.1,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.25,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Billing history',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 10.2,
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

class _BillingHero extends StatelessWidget {
  const _BillingHero({
    required this.total,
  });

  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(25),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .14),
        ),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFEFD),
            Color(0xFFF4FAF8),
            Color(0xFFFFF8FA),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 28,
            offset: const Offset(0, 11),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            top: -55,
            right: -42,
            child: IgnorePointer(
              child: Container(
                width: 135,
                height: 135,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.primary.withValues(alpha: .065),
                ),
              ),
            ),
          ),
          Positioned(
            left: -48,
            bottom: -72,
            child: IgnorePointer(
              child: Container(
                width: 140,
                height: 140,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.pink.withValues(alpha: .045),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 17, 18, 17),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Row(
                        children: [
                          Icon(
                            Icons.auto_awesome_rounded,
                            size: 12,
                            color: AppColors.primaryDark,
                          ),
                          SizedBox(width: 6),
                          Text(
                            'VERIFIED BILLING',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 8.7,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.05,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    _InvoiceCountBadge(total: total),
                  ],
                ),
                const SizedBox(height: 14),
                const Text(
                  'Every payment,\nbeautifully organized.',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 22,
                    height: 1.04,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.58,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Review secure invoices, provider references and payment totals from one private place.',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.3,
                    height: 1.42,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 13),
                const Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    _HeroTrustChip(
                      icon: Icons.verified_user_outlined,
                      label: 'Provider verified',
                    ),
                    _HeroTrustChip(
                      icon: Icons.lock_outline_rounded,
                      label: 'Private records',
                      rose: true,
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

class _HeroTrustChip extends StatelessWidget {
  const _HeroTrustChip({
    required this.icon,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final foreground = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    final background = rose
        ? AppColors.pinkSoft.withValues(alpha: .9)
        : AppColors.primarySoft.withValues(alpha: .95);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 7,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: foreground.withValues(alpha: .09),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 12,
            color: foreground,
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 8.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _InvoiceCountBadge extends StatelessWidget {
  const _InvoiceCountBadge({
    required this.total,
  });

  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(9, 7, 10, 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .14),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 29,
            height: 29,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.receipt_long_outlined,
              size: 15,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 7),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '$total',
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 16,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.3,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                total == 1 ? 'record' : 'records',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 7.3,
                  height: 1,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ProviderPanel extends StatelessWidget {
  const _ProviderPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        13,
        11,
        12,
        11,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .9),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primarySoft,
                  AppColors.surfaceRose,
                ],
              ),
            ),
            child: const Icon(
              Icons.credit_card_rounded,
              color: AppColors.primaryDark,
              size: 19,
            ),
          ),

          const SizedBox(width: 10),

          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Stripe Checkout',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Secure provider payment history',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),

          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 8,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.lock_outline_rounded,
                  size: 11,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 4),
                Text(
                  'PRIVATE',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .45,
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

class _InvoiceSectionHeader extends StatelessWidget {
  const _InvoiceSectionHeader({
    required this.total,
  });

  final int total;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'BILLING LEDGER',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 8.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.05,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'Your invoices',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 19,
                  height: 1.05,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.3,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Private records tied to your account.',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(width: 10),

        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 7,
          ),
          decoration: BoxDecoration(
            color: AppColors.surfaceRose.withValues(alpha: .78),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: AppColors.pink.withValues(alpha: .09),
            ),
          ),
          child: Text(
            '$total ${total == 1 ? 'invoice' : 'invoices'}',
            style: const TextStyle(
              color: AppColors.pinkDeep,
              fontSize: 8.7,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }
}

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({
    required this.invoice,
    required this.onTap,
  });

  final Map<String, dynamic> invoice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final number =
        '${invoice['invoiceNumber'] ?? invoice['number'] ?? 'Invoice'}';

    final status =
        '${invoice['status'] ?? 'SUCCEEDED'}';

    final provider =
        '${invoice['providerKey'] ?? 'STRIPE'}'.toUpperCase();

    final purpose = _purposeLabel(
      '${invoice['paymentPurpose'] ?? invoice['purpose'] ?? 'PAYMENT'}',
    );

    final reference =
        '${invoice['transactionReference'] ?? invoice['providerPaymentId'] ?? 'Verified transaction'}';

    final amount = _moneyText(
      invoice['amount'] ?? invoice['totalAmount'],
      invoice['currency'],
    );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(23),
        child: Ink(
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .95),
            borderRadius: BorderRadius.circular(23),
            border: Border.all(
              color: AppColors.border.withValues(alpha: .92),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .045),
                blurRadius: 24,
                offset: const Offset(0, 9),
              ),
            ],
          ),
          child: Stack(
            children: [
              Positioned(
                left: 0,
                top: 20,
                bottom: 20,
                child: Container(
                  width: 3,
                  decoration: BoxDecoration(
                    color: _isSuccessful(status)
                        ? AppColors.primary
                        : AppColors.pink,
                    borderRadius: const BorderRadius.horizontal(
                      right: Radius.circular(999),
                    ),
                  ),
                ),
              ),

              Padding(
                padding: const EdgeInsets.fromLTRB(
                  15,
                  14,
                  13,
                  13,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(14),
                            gradient: const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                AppColors.primarySoft,
                                AppColors.surfaceRose,
                              ],
                            ),
                          ),
                          child: const Icon(
                            Icons.description_outlined,
                            color: AppColors.primaryDark,
                            size: 19,
                          ),
                        ),

                        const SizedBox(width: 10),

                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                number,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),

                              const SizedBox(height: 3),

                              Row(
                                children: [
                                  const Icon(
                                    Icons.calendar_today_outlined,
                                    size: 10,
                                    color: AppColors.textMuted,
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      _friendlyDate(
                                        invoice['issuedAt'] ??
                                            invoice['createdAt'],
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: AppColors.textMuted,
                                        fontSize: 8.8,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(width: 8),

                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              amount,
                              textAlign: TextAlign.right,
                              style: const TextStyle(
                                color: AppColors.primaryDeep,
                                fontSize: 13.3,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 3),
                            const Text(
                              'TOTAL PAID',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 7.2,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .55,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(
                        10,
                        9,
                        9,
                        9,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft.withValues(alpha: .52),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.tag_rounded,
                            size: 12,
                            color: AppColors.primaryDark,
                          ),

                          const SizedBox(width: 6),

                          Expanded(
                            child: Text(
                              reference,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 8.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 10),

                    Row(
                      children: [
                        Expanded(
                          child: Wrap(
                            spacing: 5,
                            runSpacing: 5,
                            children: [
                              StatusChip(
                                label: purpose,
                                icon: Icons.shopping_bag_outlined,
                              ),
                              StatusChip(
                                label: provider,
                                icon: Icons.credit_card_rounded,
                                rose: provider != 'STRIPE',
                              ),
                              StatusChip(
                                label: status,
                                icon: _isSuccessful(status)
                                    ? Icons.check_circle_outline_rounded
                                    : Icons.schedule_rounded,
                                positive: _isSuccessful(status),
                                rose: !_isSuccessful(status),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(width: 8),

                        Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: AppColors.primarySoft,
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                            color: AppColors.primaryDark,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaginationBar extends StatelessWidget {
  const _PaginationBar({
    required this.page,
    required this.totalPages,
    required this.loading,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final bool loading;

  final VoidCallback onPrevious;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 8,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.surfaceRose.withValues(alpha: .55),
            Colors.white.withValues(alpha: .86),
            AppColors.primarySoft.withValues(alpha: .72),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .85),
        ),
      ),
      child: Row(
        children: [
          _PaginationButton(
            icon: Icons.arrow_back_rounded,
            enabled: !loading && page > 1,
            onPressed: onPrevious,
          ),

          Expanded(
            child: Column(
              children: [
                Text(
                  'Page $page',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  'of $totalPages',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),

          _PaginationButton(
            icon: Icons.arrow_forward_rounded,
            enabled: !loading && page < totalPages,
            onPressed: onNext,
          ),
        ],
      ),
    );
  }
}

class _PaginationButton extends StatelessWidget {
  const _PaginationButton({
    required this.icon,
    required this.enabled,
    required this.onPressed,
  });

  final IconData icon;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: enabled
          ? Colors.white.withValues(alpha: .92)
          : Colors.white.withValues(alpha: .45),
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: enabled ? onPressed : null,
        borderRadius: BorderRadius.circular(13),
        child: SizedBox(
          width: 42,
          height: 38,
          child: Icon(
            icon,
            size: 18,
            color: enabled
                ? AppColors.primaryDark
                : AppColors.silver,
          ),
        ),
      ),
    );
  }
}

class _BillingSecurityNote extends StatelessWidget {
  const _BillingSecurityNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .52),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .65),
        ),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.shield_outlined,
            size: 16,
            color: AppColors.primaryDark,
          ),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Card and wallet credentials are handled securely by the payment provider and are not stored in your billing history.',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 9,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InvoiceDetailSheet extends StatefulWidget {
  const _InvoiceDetailSheet({
    required this.invoiceId,
    required this.initialInvoice,
  });

  final String invoiceId;
  final Map<String, dynamic> initialInvoice;

  @override
  State<_InvoiceDetailSheet> createState() {
    return _InvoiceDetailSheetState();
  }
}

class _InvoiceDetailSheetState extends State<_InvoiceDetailSheet> {
  Map<String, dynamic>? _invoice;

  Object? _error;

  bool _downloading = false;
  bool _refreshing = true;

  @override
  void initState() {
    super.initState();

    _invoice = widget.initialInvoice;

    _load();
  }

  Future<void> _load() async {
    try {
      final invoice = await UserApi.instance.getInvoice(
        widget.invoiceId,
      );

      if (!mounted) return;

      setState(() {
        _invoice = {
          ...widget.initialInvoice,
          ...invoice,
        };
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error;
      });
    } finally {
      if (mounted) {
        setState(() {
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _downloadPdf() async {
    if (_downloading) return;

    setState(() {
      _downloading = true;
    });

    try {
      final bytes = await UserApi.instance.downloadInvoicePdf(
        widget.invoiceId,
      );

      final invoiceNumber =
          '${_invoice?['invoiceNumber'] ?? widget.invoiceId}'.trim();
      final safeNumber = invoiceNumber.replaceAll(
        RegExp(r'[^a-zA-Z0-9_-]+'),
        '-',
      );

      final opened = await downloadInvoicePdfBytes(
        bytes,
        fileName: 'Voxidence-Invoice-$safeNumber.pdf',
      );

      if (!opened && mounted) {
        showAppSnackBar(
          context,
          'The invoice PDF could not be downloaded on this device.',
          error: true,
        );
      }
    } catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          _cleanError(error),
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _downloading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final invoice = _invoice;

    return DraggableScrollableSheet(
      initialChildSize: .82,
      minChildSize: .55,
      maxChildSize: .95,
      expand: false,
      builder: (context, controller) {
        return Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(30),
            ),
            border: Border.all(
              color: Colors.white,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .12),
                blurRadius: 44,
                offset: const Offset(0, -8),
              ),
            ],
          ),
          child: ListView(
            controller: controller,
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(
              18,
              10,
              18,
              28,
            ),
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver.withValues(alpha: .75),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),

              const SizedBox(height: 14),

              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.primarySoft,
                          AppColors.surfaceRose,
                        ],
                      ),
                    ),
                    child: const Icon(
                      Icons.receipt_long_outlined,
                      size: 22,
                      color: AppColors.primaryDark,
                    ),
                  ),

                  const SizedBox(width: 11),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'VOXIDENCE INVOICE',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          invoice == null
                              ? 'Invoice'
                              : '${invoice['invoiceNumber'] ?? invoice['id'] ?? 'Invoice'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.25,
                          ),
                        ),
                      ],
                    ),
                  ),

                  if (_refreshing)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 7),
                      child: SizedBox(
                        width: 17,
                        height: 17,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.primary,
                        ),
                      ),
                    )
                  else if (invoice != null)
                    StatusChip(
                      label: '${invoice['status'] ?? 'VERIFIED'}',
                      icon: _isSuccessful(
                        '${invoice['status'] ?? ''}',
                      )
                          ? Icons.check_circle_outline_rounded
                          : Icons.schedule_rounded,
                      positive: _isSuccessful(
                        '${invoice['status'] ?? ''}',
                      ),
                      rose: !_isSuccessful(
                        '${invoice['status'] ?? ''}',
                      ),
                    ),

                  const SizedBox(width: 3),

                  Material(
                    color: AppColors.primarySoft.withValues(alpha: .72),
                    borderRadius: BorderRadius.circular(12),
                    child: InkWell(
                      onTap: () => Navigator.of(context).pop(),
                      borderRadius: BorderRadius.circular(12),
                      child: const SizedBox(
                        width: 34,
                        height: 34,
                        child: Icon(
                          Icons.close_rounded,
                          size: 18,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 17),

              if (invoice == null && _error == null)
                const LoadingList(count: 3)
              else if (invoice == null && _error != null)
                EmptyState(
                  icon: Icons.cloud_off_rounded,
                  title: 'Invoice unavailable',
                  message: _cleanError(_error),
                  action: FilledButton.icon(
                    onPressed: _load,
                    icon: const Icon(
                      Icons.refresh_rounded,
                      size: 18,
                    ),
                    label: const Text('Retry'),
                  ),
                )
              else if (invoice != null) ...[
                _InvoiceTotalPanel(invoice: invoice),

                const SizedBox(height: 12),

                _InvoiceInformationPanel(invoice: invoice),

                const SizedBox(height: 12),

                const InlineNotice(
                  icon: Icons.verified_user_outlined,
                  title: 'Verified provider confirmation',
                  message:
                      'Voxidence stores no card or wallet credentials. This invoice belongs to your private billing record.',
                ),

                const SizedBox(height: 12),

                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _downloading
                        ? null
                        : _downloadPdf,
                    icon: _downloading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(
                            Icons.download_rounded,
                            size: 19,
                          ),
                    label: Text(
                      _downloading
                          ? 'Preparing PDF...'
                          : 'Download invoice PDF',
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _InvoiceTotalPanel extends StatelessWidget {
  const _InvoiceTotalPanel({
    required this.invoice,
  });

  final Map<String, dynamic> invoice;

  @override
  Widget build(BuildContext context) {
    final status =
        '${invoice['status'] ?? 'SUCCEEDED'}';

    return Container(
      padding: const EdgeInsets.fromLTRB(
        15,
        15,
        15,
        14,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(21),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF65C4BD),
            Color(0xFF4FA9A4),
            Color(0xFF347F7B),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: .18),
            blurRadius: 24,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .16),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.payments_outlined,
              color: Colors.white,
              size: 20,
            ),
          ),

          const SizedBox(width: 11),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _isSuccessful(status)
                      ? 'Payment confirmed'
                      : 'Payment record',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .78),
                    fontSize: 8.7,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'Total paid',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),

          Text(
            _moneyText(
              invoice['amount'] ?? invoice['totalAmount'],
              invoice['currency'],
            ),
            textAlign: TextAlign.right,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: -.3,
            ),
          ),
        ],
      ),
    );
  }
}

class _InvoiceInformationPanel extends StatelessWidget {
  const _InvoiceInformationPanel({
    required this.invoice,
  });

  final Map<String, dynamic> invoice;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        14,
        8,
        14,
        8,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(21),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .9),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          _DetailRow(
            icon: Icons.person_outline_rounded,
            label: 'Billed to',
            value:
                '${invoice['customerName'] ?? 'Voxidence account'}',
            secondary:
                '${invoice['customerEmail'] ?? ''}',
          ),

          const _InformationDivider(),

          _DetailRow(
            icon: Icons.calendar_today_outlined,
            label: 'Issued',
            value: _friendlyDate(
              invoice['issuedAt'] ?? invoice['createdAt'],
            ),
            secondary:
                '${invoice['providerKey'] ?? 'Stripe'} · ${invoice['paymentMethodKey'] ?? 'Verified payment'}',
          ),

          const _InformationDivider(),

          _DetailRow(
            icon: Icons.shopping_bag_outlined,
            label: 'Purpose',
            value: _purposeLabel(
              '${invoice['paymentPurpose'] ?? invoice['purpose'] ?? 'PAYMENT'}',
            ),
          ),

          const _InformationDivider(),

          _DetailRow(
            icon: Icons.tag_rounded,
            label: 'Reference',
            value:
                '${invoice['transactionReference'] ?? invoice['providerPaymentId'] ?? 'Verified transaction'}',
          ),
        ],
      ),
    );
  }
}

class _InformationDivider extends StatelessWidget {
  const _InformationDivider();

  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      color: AppColors.border.withValues(alpha: .7),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
    this.secondary,
  });

  final IconData icon;
  final String label;
  final String value;
  final String? secondary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        vertical: 11,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .8),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              icon,
              size: 15,
              color: AppColors.primaryDark,
            ),
          ),

          const SizedBox(width: 10),

          SizedBox(
            width: 69,
            child: Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),

          const SizedBox(width: 7),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.5,
                    height: 1.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                if (secondary != null &&
                    secondary!.trim().isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    secondary!,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.3,
                      height: 1.3,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

bool _isSuccessful(String value) {
  final status = value.trim().toUpperCase();

  return status == 'SUCCEEDED' ||
      status == 'PAID' ||
      status == 'SUCCESS' ||
      status == 'COMPLETED';
}

String _purposeLabel(String value) {
  return switch (value.trim().toUpperCase()) {
    'BUY_CREDITS' => 'Credits purchase',
    'DIRECT_UNLOCK' => 'Advanced idea unlock',
    'ACCEPT_PUBLICATION' => 'Publication acceptance',
    'UNLOCK_PUBLICATION_ADVANCED' => 'Advanced publication unlock',
    'PREMIUM_ACTIVATION' => 'Premium activation',
    _ => _titleCase(value.replaceAll('_', ' ')),
  };
}

String _titleCase(String value) {
  final words = value
      .trim()
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();

  if (words.isEmpty) return 'Payment';

  return words
      .map(
        (word) => '${word[0].toUpperCase()}${word.substring(1)}',
      )
      .join(' ');
}

String _friendlyDate(dynamic value) {
  final raw = '$value'.trim();

  if (raw.isEmpty || raw == 'null') {
    return 'Recently';
  }

  final parsed = DateTime.tryParse(raw)?.toLocal();

  if (parsed == null) {
    return 'Recently';
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return '${months[parsed.month - 1]} ${parsed.day}, ${parsed.year}';
}

String _moneyText(
  dynamic amount,
  dynamic currency,
) {
  final rawAmount = amount?.toString().trim() ?? '';
  final rawCurrency =
      currency?.toString().trim().toUpperCase() ?? '';

  if (rawAmount.isEmpty ||
      rawAmount == 'null' ||
      rawAmount == '—') {
    return rawCurrency.isEmpty
        ? '—'
        : '— $rawCurrency';
  }

  final number = num.tryParse(rawAmount);

  final formatted = number == null
      ? rawAmount
      : number.toStringAsFixed(2);

  return rawCurrency.isEmpty
      ? formatted
      : '$formatted $rawCurrency';
}

String _cleanError(Object? error) {
  if (error == null) {
    return 'Something went wrong while loading billing history.';
  }

  final message = error.toString().trim();

  if (message.startsWith('Exception: ')) {
    return message.substring('Exception: '.length);
  }

  return message;
}