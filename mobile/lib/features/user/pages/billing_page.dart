// Mobile billing history with the same records and actions as the web workspace.
//
// @author  Malak

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/theme/app_theme.dart';
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
        if (_page > _totalPages) _page = _totalPages;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _syncInBackground() async {
    if (_syncing) return;
    _syncing = true;
    try {
      final result = await UserApi.instance.synchronizeInvoices();
      final created = _toInt(result['created']);
      if (created > 0) await _load(force: true);
    } catch (_) {
      // Historical synchronization stays silent so it never blocks the page.
    } finally {
      _syncing = false;
    }
  }

  Future<void> _openInvoice(Map<String, dynamic> invoice) async {
    final id = invoice['id']?.toString() ?? '';
    if (id.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _InvoiceDetailSheet(
        invoiceId: id,
        initialInvoice: invoice,
      ),
    );
  }

  Future<void> _goToPage(int next) async {
    if (next < 1 || next > _totalPages || next == _page || _loading) return;
    setState(() => _page = next);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Billing history')),
      body: WorkspaceBackground(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(force: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 34),
            children: [
              const WorkspacePageHeader(
                eyebrow: 'VERIFIED BILLING',
                title: 'Billing history, beautifully organized.',
                subtitle:
                    'Every successful Stripe payment creates a secure invoice automatically. Review provider references, totals, and downloadable records from one private workspace.',
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _TrustPill(
                      icon: Icons.verified_user_outlined,
                      title: 'Provider verified',
                      subtitle: 'Stripe confirmation',
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _TrustPill(
                      icon: Icons.receipt_long_outlined,
                      title: '$_total invoices',
                      subtitle: 'Auto-generated records',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              VoxCard(
                tint: AppColors.primarySoft.withValues(alpha: .58),
                child: const Row(
                  children: [
                    SoftIconBadge(icon: Icons.credit_card_rounded, size: 40),
                    SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Stripe Checkout',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Secure provider history',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    StatusChip(
                      label: 'PRIVATE',
                      icon: Icons.lock_outline_rounded,
                      positive: true,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const SectionHeading(
                title: 'Your invoices',
                subtitle: 'Private records tied to your authenticated account.',
              ),
              const SizedBox(height: 12),
              if (_loading && _items.isEmpty)
                const LoadingList(count: 4)
              else if (_error != null && _items.isEmpty)
                EmptyState(
                  icon: Icons.receipt_long_outlined,
                  title: 'Billing history unavailable',
                  message: _error.toString(),
                  action: FilledButton(
                    onPressed: () => _load(force: true),
                    child: const Text('Retry'),
                  ),
                )
              else if (_items.isEmpty)
                const EmptyState(
                  icon: Icons.receipt_long_outlined,
                  title: 'No invoices yet',
                  message:
                      'A verified invoice will appear here after your first successful payment.',
                )
              else
                ..._items.map(
                  (invoice) => Padding(
                    padding: const EdgeInsets.only(bottom: 11),
                    child: _InvoiceCard(
                      invoice: invoice,
                      onTap: () => _openInvoice(invoice),
                    ),
                  ),
                ),
              if (_totalPages > 1) ...[
                const SizedBox(height: 5),
                _PaginationBar(
                  page: _page,
                  totalPages: _totalPages,
                  loading: _loading,
                  onPrevious: () => _goToPage(_page - 1),
                  onNext: () => _goToPage(_page + 1),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  int _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse('$value') ?? 0;
  }
}

class _TrustPill extends StatelessWidget {
  const _TrustPill({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: AppColors.primaryDark),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.8,
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

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({required this.invoice, required this.onTap});

  final Map<String, dynamic> invoice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final number = '${invoice['invoiceNumber'] ?? invoice['number'] ?? 'Invoice'}';
    final amount = '${invoice['amount'] ?? invoice['totalAmount'] ?? '—'}';
    final currency = '${invoice['currency'] ?? 'USD'}';
    final status = '${invoice['status'] ?? 'SUCCEEDED'}';
    final provider = '${invoice['providerKey'] ?? 'STRIPE'}'.toUpperCase();
    final purpose = _purposeLabel(
      '${invoice['paymentPurpose'] ?? invoice['purpose'] ?? 'PAYMENT'}',
    );
    final reference = '${invoice['transactionReference'] ?? 'Verified transaction'}';

    return VoxCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SoftIconBadge(icon: Icons.description_outlined, size: 42),
              const SizedBox(width: 11),
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
                        fontSize: 12.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      reference,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.8,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.textMuted,
                size: 20,
              ),
            ],
          ),
          const SizedBox(height: 11),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusChip(
                label: purpose,
                icon: Icons.shopping_bag_outlined,
              ),
              StatusChip(
                label: provider,
                icon: Icons.credit_card_rounded,
              ),
              StatusChip(
                label: status,
                icon: Icons.check_circle_outline_rounded,
                positive: _isSuccessful(status),
              ),
            ],
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: Text(
                  _friendlyDate(invoice['issuedAt'] ?? invoice['createdAt']),
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.3,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                '$amount $currency',
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ],
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
    return VoxCard(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      child: Row(
        children: [
          IconButton.filledTonal(
            onPressed: loading || page <= 1 ? null : onPrevious,
            tooltip: 'Previous page',
            icon: const Icon(Icons.arrow_back_rounded, size: 18),
          ),
          Expanded(
            child: Text(
              'Page $page of $totalPages',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          IconButton.filledTonal(
            onPressed: loading || page >= totalPages ? null : onNext,
            tooltip: 'Next page',
            icon: const Icon(Icons.arrow_forward_rounded, size: 18),
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
  State<_InvoiceDetailSheet> createState() => _InvoiceDetailSheetState();
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
      final invoice = await UserApi.instance.getInvoice(widget.invoiceId);
      if (mounted) setState(() => _invoice = {...widget.initialInvoice, ...invoice});
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _downloadPdf() async {
    if (_downloading) return;
    setState(() => _downloading = true);
    try {
      final bytes = await UserApi.instance.downloadInvoicePdf(widget.invoiceId);
      final uri = UriData.fromBytes(bytes, mimeType: 'application/pdf').uri;
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        showAppSnackBar(
          context,
          'The invoice PDF could not be opened on this device.',
          error: true,
        );
      }
    } catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          error is Exception
              ? error.toString().replaceFirst('Exception: ', '')
              : '$error',
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final invoice = _invoice;

    return DraggableScrollableSheet(
      initialChildSize: .78,
      maxChildSize: .95,
      minChildSize: .5,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                const SoftIconBadge(icon: Icons.receipt_long_outlined, size: 46),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'VOXIDENCE',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1,
                        ),
                      ),
                      Text('Invoice', style: Theme.of(context).textTheme.headlineSmall),
                      if (invoice != null)
                        Text(
                          '${invoice['invoiceNumber'] ?? invoice['id'] ?? ''}',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9.5,
                          ),
                        ),
                    ],
                  ),
                ),
                if (_refreshing)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else if (invoice != null)
                  StatusChip(
                    label: '${invoice['status'] ?? 'VERIFIED'}',
                    icon: Icons.check_circle_outline_rounded,
                    positive: _isSuccessful('${invoice['status'] ?? ''}'),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            if (invoice == null && _error == null)
              const LoadingList(count: 3)
            else if (invoice == null && _error != null)
              EmptyState(
                icon: Icons.cloud_off_rounded,
                title: 'Invoice unavailable',
                message: _error.toString(),
                action: FilledButton(onPressed: _load, child: const Text('Retry')),
              )
            else if (invoice != null) ...[
              VoxCard(
                tint: AppColors.primarySoft.withValues(alpha: .72),
                child: Column(
                  children: [
                    _DetailRow(
                      label: 'Billed to',
                      value: '${invoice['customerName'] ?? 'Voxidence account'}',
                      secondary: '${invoice['customerEmail'] ?? ''}',
                    ),
                    _DetailRow(
                      label: 'Issued',
                      value: _friendlyDate(invoice['issuedAt'] ?? invoice['createdAt']),
                      secondary:
                          '${invoice['providerKey'] ?? 'Stripe'} · ${invoice['paymentMethodKey'] ?? 'Verified payment'}',
                    ),
                    _DetailRow(
                      label: 'Purpose',
                      value: _purposeLabel(
                        '${invoice['paymentPurpose'] ?? invoice['purpose'] ?? 'PAYMENT'}',
                      ),
                    ),
                    _DetailRow(
                      label: 'Reference',
                      value:
                          '${invoice['transactionReference'] ?? invoice['providerPaymentId'] ?? 'Verified transaction'}',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              VoxCard(
                tint: AppColors.surfaceRose.withValues(alpha: .65),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Total paid',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Text(
                      '${invoice['amount'] ?? invoice['totalAmount'] ?? '—'} ${invoice['currency'] ?? 'USD'}',
                      style: const TextStyle(
                        color: AppColors.primaryDeep,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const InlineNotice(
                icon: Icons.verified_user_outlined,
                title: 'Verified provider confirmation',
                message:
                    'Voxidence stores no card or wallet credentials. This invoice belongs to your private billing record.',
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _downloading ? null : _downloadPdf,
                  icon: _downloading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(_downloading ? 'Preparing PDF...' : 'Download PDF'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.secondary,
  });

  final String label;
  final String value;
  final String? secondary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (secondary != null && secondary!.trim().isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    secondary!,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.5,
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
  final status = value.toUpperCase();
  return status == 'SUCCEEDED' || status == 'PAID' || status == 'SUCCESS';
}

String _purposeLabel(String value) {
  return switch (value.toUpperCase()) {
    'BUY_CREDITS' => 'Credits purchase',
    'DIRECT_UNLOCK' => 'Advanced idea unlock',
    'ACCEPT_PUBLICATION' => 'Publication acceptance',
    'UNLOCK_PUBLICATION_ADVANCED' => 'Advanced publication unlock',
    _ => value.replaceAll('_', ' '),
  };
}

String _friendlyDate(dynamic value) {
  final parsed = DateTime.tryParse('$value')?.toLocal();
  if (parsed == null) return 'Recently';
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${months[parsed.month - 1]} ${parsed.day}, ${parsed.year}';
}
