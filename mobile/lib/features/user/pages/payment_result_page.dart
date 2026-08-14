// Mobile payment confirmation page. The backend remains the source of truth.
//
// @author  Malak

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/payment_currency.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class PaymentResultPage extends StatefulWidget {
  const PaymentResultPage({
    super.key,
    this.paymentId,
    this.ideaId,
    this.publicationId,
  });

  final String? paymentId;
  final String? ideaId;
  final String? publicationId;

  @override
  State<PaymentResultPage> createState() => _PaymentResultPageState();
}

class _PaymentResultPageState extends State<PaymentResultPage> {
  static const _maxAttempts = 40;

  bool _loading = true;
  String? _error;
  String _message = 'Verifying the provider payment and applying your access…';
  Map<String, dynamic>? _payment;

  @override
  void initState() {
    super.initState();
    _confirm();
  }

  Future<void> _confirm() async {
    final paymentId = widget.paymentId?.trim();
    if (paymentId == null || paymentId.isEmpty) {
      setState(() {
        _loading = false;
        _error =
            'No payment reference was provided. Open this screen from the checkout return link or your billing history.';
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
      _message = 'Verifying the provider payment and applying your access…';
    });

    Object? lastError;
    Map<String, dynamic>? latest;
    for (var attempt = 0; attempt < _maxAttempts; attempt++) {
      try {
        var payment = await UserApi.instance.getPaymentState(
          paymentId,
          force: true,
        );
        if ('${payment['status']}'.toUpperCase() == 'PENDING' &&
            attempt % 5 == 0) {
          try {
            payment = await UserApi.instance.reconcilePayment(paymentId);
          } catch (error) {
            lastError = error;
          }
        }
        latest = payment;
        if (!mounted) return;
        setState(() => _payment = payment);

        final status = '${payment['status'] ?? ''}'.toUpperCase();
        if (status == 'FAILED') {
          setState(() {
            _loading = false;
            _error = '${payment['failureReason'] ?? 'Payment failed.'}';
          });
          return;
        }

        if (status == 'SUCCEEDED' && _fulfillmentComplete(payment)) {
          await UserSessionController.instance.load(force: true);
          if (!mounted) return;
          setState(() {
            _loading = false;
            _error = null;
            _message = '';
          });
          return;
        }

        if (status == 'SUCCEEDED') {
          setState(() {
            _message = _processingMessage(payment);
          });
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < _maxAttempts - 1) {
        await Future<void>.delayed(const Duration(milliseconds: 600));
      }
    }

    if (!mounted) return;
    final succeeded = '${latest?['status'] ?? ''}'.toUpperCase() == 'SUCCEEDED';
    setState(() {
      _loading = false;
      _error = succeeded
          ? 'Payment is confirmed, but the related access is still being finalized. Check again safely; you will not be charged twice.'
          : _errorText(lastError);
    });
  }

  bool _fulfillmentComplete(Map<String, dynamic> payment) {
    if ('${payment['status']}'.toUpperCase() != 'SUCCEEDED') return false;
    final purpose = '${payment['paymentPurpose'] ?? ''}'.toUpperCase();
    if (purpose == 'DIRECT_UNLOCK') {
      return payment['ideaUnlocked'] == true ||
          payment['unlockInProgress'] == true;
    }
    if (purpose == 'ACCEPT_PUBLICATION') {
      return payment['publicationAccepted'] == true;
    }
    if (purpose == 'UNLOCK_PUBLICATION_ADVANCED') {
      return payment['advancedPublicationAccess'] == true;
    }
    return true;
  }

  String _processingMessage(Map<String, dynamic> payment) {
    final purpose = '${payment['paymentPurpose'] ?? ''}'.toUpperCase();
    if (purpose == 'DIRECT_UNLOCK') {
      return 'Payment is verified. The advanced idea outputs are being attached now.';
    }
    if (purpose == 'ACCEPT_PUBLICATION') {
      return 'Payment is verified. Accepted publication access is being prepared now.';
    }
    if (purpose == 'UNLOCK_PUBLICATION_ADVANCED') {
      return 'Payment is verified. Advanced publication outputs are being attached now.';
    }
    return 'Payment is verified. Voxidence is applying your access safely.';
  }

  String _errorText(Object? error) {
    if (error is ApiException) return error.message;
    if (error != null) return error.toString();
    return 'Payment confirmation is taking longer than expected. Check again safely; you will not be charged twice.';
  }

  void _goToDestination() {
    final payment = _payment ?? const <String, dynamic>{};
    final purpose = '${payment['paymentPurpose'] ?? ''}'.toUpperCase();
    final ideaId = '${payment['ideaId'] ?? widget.ideaId ?? ''}'.trim();
    final publicationId =
        '${payment['publicationId'] ?? widget.publicationId ?? ''}'.trim();

    if (purpose == 'DIRECT_UNLOCK' && ideaId.isNotEmpty) {
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil('/normal/ideas/$ideaId', (route) => false);
      return;
    }

    if (purpose == 'UNLOCK_PUBLICATION_ADVANCED' && publicationId.isNotEmpty) {
      Navigator.of(context).pushNamedAndRemoveUntil(
        '/normal/accepted/$publicationId/workspace',
        (route) => false,
      );
      return;
    }

    if (purpose == 'ACCEPT_PUBLICATION' && publicationId.isNotEmpty) {
      Navigator.of(context).pushNamedAndRemoveUntil(
        '/normal/discover/$publicationId',
        (route) => false,
      );
      return;
    }

    if (purpose == 'BUY_CREDITS') {
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil('/normal/credits', (route) => false);
      return;
    }

    Navigator.of(
      context,
    ).pushNamedAndRemoveUntil('/normal/dashboard', (route) => false);
  }

  void _returnSafely() {
    final ideaId = widget.ideaId?.trim() ?? '';
    final publicationId = widget.publicationId?.trim() ?? '';

    if (ideaId.isNotEmpty) {
      Navigator.of(context).pushReplacementNamed('/normal/ideas/$ideaId');
      return;
    }

    if (publicationId.isNotEmpty) {
      Navigator.of(
        context,
      ).pushReplacementNamed('/normal/discover/$publicationId');
      return;
    }

    Navigator.of(context).pushReplacementNamed('/normal/credits');
  }

  String _successTitle(Map<String, dynamic> payment) {
    return switch ('${payment['paymentPurpose'] ?? ''}'.toUpperCase()) {
      'BUY_CREDITS' => 'Welcome to Premium.',
      'DIRECT_UNLOCK' => 'Your advanced workspace is open.',
      'UNLOCK_PUBLICATION_ADVANCED' => 'Your accepted idea workspace is ready.',
      'ACCEPT_PUBLICATION' => 'The opportunity brief is unlocked.',
      _ => 'Your access is ready.',
    };
  }

  String _continueLabel(Map<String, dynamic> payment) {
    return switch ('${payment['paymentPurpose'] ?? ''}'.toUpperCase()) {
      'BUY_CREDITS' => 'View credits & Premium',
      'DIRECT_UNLOCK' => 'Open idea workspace',
      'UNLOCK_PUBLICATION_ADVANCED' => 'Go to idea workspace',
      'ACCEPT_PUBLICATION' => 'Open protected brief',
      _ => 'Continue to your workspace',
    };
  }

  @override
  Widget build(BuildContext context) {
    final payment = _payment ?? const <String, dynamic>{};
    final success = !_loading && _error == null;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 470),
                child: VoxCard(
                  padding: const EdgeInsets.fromLTRB(22, 26, 22, 22),
                  child: Column(
                    children: [
                      Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          color: _loading
                              ? AppColors.primarySoft
                              : success
                              ? AppColors.primarySoft
                              : AppColors.pinkSoft,
                          shape: BoxShape.circle,
                        ),
                        alignment: Alignment.center,
                        child: _loading
                            ? const SizedBox(
                                width: 27,
                                height: 27,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                ),
                              )
                            : Icon(
                                success
                                    ? Icons.check_circle_outline_rounded
                                    : Icons.error_outline_rounded,
                                color: success
                                    ? AppColors.primaryDark
                                    : AppColors.pinkDeep,
                                size: 34,
                              ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        _loading
                            ? 'Completing your access…'
                            : success
                            ? _successTitle(payment)
                            : 'Confirmation needs attention',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _loading
                            ? _message
                            : (_error ??
                                  'Your payment was verified and the related Voxidence access is ready.'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11.5,
                          height: 1.5,
                        ),
                      ),
                      if (payment.isNotEmpty) ...[
                        const SizedBox(height: 18),
                        Container(
                          padding: const EdgeInsets.all(13),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceMuted,
                            borderRadius: BorderRadius.circular(17),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Column(
                            children: [
                              _DetailRow(
                                label: 'Status',
                                value: '${payment['status'] ?? '—'}',
                              ),
                              _DetailRow(
                                label: 'Purpose',
                                value: _pretty(
                                  '${payment['paymentPurpose'] ?? 'Payment'}',
                                ),
                              ),
                              _DetailRow(
                                label: 'Amount',
                                value:
                                    '${payment['amount'] ?? '—'} ${payment['currency'] ?? PaymentCurrencyPreference.current}',
                                last: true,
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _loading
                              ? null
                              : success
                              ? _goToDestination
                              : ((widget.paymentId?.trim().isNotEmpty ?? false)
                                    ? _confirm
                                    : _returnSafely),
                          icon: Icon(
                            success
                                ? Icons.arrow_forward_rounded
                                : Icons.refresh_rounded,
                          ),
                          label: Text(
                            success
                                ? _continueLabel(payment)
                                : ((widget.paymentId?.trim().isNotEmpty ??
                                          false)
                                      ? 'Check again'
                                      : 'Return safely'),
                          ),
                        ),
                      ),
                      const SizedBox(height: 7),
                      TextButton(
                        onPressed: _loading
                            ? null
                            : () =>
                                  Navigator.of(context).pushNamedAndRemoveUntil(
                                    '/normal/dashboard',
                                    (route) => false,
                                  ),
                        child: const Text('Back to workspace'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.last = false,
  });

  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: last
            ? null
            : Border(
                bottom: BorderSide(
                  color: AppColors.border.withValues(alpha: .7),
                ),
              ),
      ),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5),
          ),
          const Spacer(),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _pretty(String value) {
  final normalized = value.replaceAll('_', ' ').toLowerCase();
  if (normalized.isEmpty) return 'Payment';
  return '${normalized[0].toUpperCase()}${normalized.substring(1)}';
}
