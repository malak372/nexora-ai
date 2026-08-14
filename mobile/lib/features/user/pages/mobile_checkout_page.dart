// Embedded Stripe checkout for Voxidence mobile.
//
// The backend creates the Stripe Checkout Session and remains authoritative for
// payment state and fulfillment. Native mobile keeps the hosted Stripe page
// inside the app, intercepts the configured return URL, reconciles the payment
// with the backend, and then returns directly to the calling workspace.
//
// @author Eman

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/workspace_navigation.dart';

enum CheckoutFlowStatus { completed, cancelled, closed }

class CheckoutFlowResult {
  const CheckoutFlowResult({
    required this.status,
    this.returnUri,
    this.paymentState,
  });

  final CheckoutFlowStatus status;
  final Uri? returnUri;
  final Map<String, dynamic>? paymentState;
}

/// Opens the Stripe-hosted Checkout Session inside the native application.
///
/// A provider redirect is never treated as proof of payment. The mobile client
/// waits for the authenticated backend to confirm payment and fulfillment.
Future<CheckoutFlowResult> openVoxidenceCheckout(
  BuildContext context, {
  required Map<String, dynamic> checkoutResult,
  required WorkspaceSection selectedSection,
  String? ideaId,
  String? publicationId,
  String title = 'Secure checkout',
}) async {
  final payment = checkoutResult['payment'] is Map
      ? Map<String, dynamic>.from(checkoutResult['payment'] as Map)
      : const <String, dynamic>{};

  final checkoutUrl = _firstNonEmpty(<dynamic>[
    checkoutResult['checkoutUrl'],
    checkoutResult['url'],
    payment['checkoutUrl'],
    payment['url'],
  ]);

  final paymentId = _firstNonEmpty(<dynamic>[
    checkoutResult['paymentId'],
    payment['paymentId'],
    payment['id'],
  ]);

  final status = _firstNonEmpty(<dynamic>[
    checkoutResult['status'],
    payment['status'],
  ]).toUpperCase();

  if (status == 'SUCCEEDED') {
    if (paymentId.isEmpty || paymentId == 'already-unlocked') {
      return CheckoutFlowResult(
        status: CheckoutFlowStatus.completed,
        returnUri: Uri.tryParse(checkoutUrl),
        paymentState: payment.isEmpty ? null : payment,
      );
    }

    final verified = await _waitForPaymentFulfillment(paymentId);
    await UserSessionController.instance.load(force: true);

    return CheckoutFlowResult(
      status: CheckoutFlowStatus.completed,
      returnUri: Uri.tryParse(checkoutUrl),
      paymentState: verified,
    );
  }

  if (checkoutUrl.isEmpty) {
    throw const ApiException('Stripe did not return a secure checkout URL.');
  }

  final checkoutUri = Uri.tryParse(checkoutUrl);
  if (checkoutUri == null ||
      (checkoutUri.scheme != 'https' && checkoutUri.scheme != 'http')) {
    throw const ApiException('Stripe returned an invalid checkout URL.');
  }

  if (!context.mounted) {
    return const CheckoutFlowResult(status: CheckoutFlowStatus.closed);
  }

  final flowResult = await Navigator.of(context).push<CheckoutFlowResult>(
    MaterialPageRoute<CheckoutFlowResult>(
      builder: (_) => WorkspaceRouteFrame(
        selected: selectedSection,
        child: MobileCheckoutPage(
          checkoutUrl: checkoutUrl,
          paymentId: paymentId,
          title: title,
        ),
      ),
    ),
  );

  return flowResult ??
      const CheckoutFlowResult(status: CheckoutFlowStatus.closed);
}

Future<Map<String, dynamic>> _waitForPaymentFulfillment(
  String paymentId, {
  ValueChanged<String>? onMessage,
}) async {
  const maxAttempts = 42;
  Object? lastError;
  Map<String, dynamic>? latest;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      var state = await UserApi.instance.getPaymentState(
        paymentId,
        force: true,
      );

      final initialStatus = '${state['status'] ?? ''}'.toUpperCase();
      if (initialStatus == 'PENDING' && attempt % 4 == 0) {
        try {
          state = await UserApi.instance.reconcilePayment(paymentId);
        } catch (error) {
          lastError = error;
        }
      }

      latest = state;
      final status = '${state['status'] ?? ''}'.toUpperCase();

      if (status == 'FAILED') {
        throw ApiException(
          '${state['failureReason'] ?? 'Stripe reported that the payment failed.'}',
        );
      }

      if (status == 'SUCCEEDED' && _fulfillmentComplete(state)) {
        return state;
      }

      if (status == 'SUCCEEDED') {
        onMessage?.call(_processingMessage(state));
      } else {
        onMessage?.call(
          'Stripe returned successfully. Voxidence is verifying the sandbox payment…',
        );
      }
    } on ApiException {
      rethrow;
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await Future<void>.delayed(const Duration(milliseconds: 550));
    }
  }

  final succeeded = '${latest?['status'] ?? ''}'.toUpperCase() == 'SUCCEEDED';
  if (succeeded) {
    throw const ApiException(
      'The payment is confirmed, but the related access is still being finalized. Retry safely; you will not be charged twice.',
    );
  }

  if (lastError is ApiException) {
    throw lastError;
  }

  throw ApiException(
    lastError?.toString() ??
        'Payment verification is taking longer than expected. Retry safely.',
  );
}

bool _fulfillmentComplete(Map<String, dynamic> payment) {
  if ('${payment['status'] ?? ''}'.toUpperCase() != 'SUCCEEDED') {
    return false;
  }

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

  return switch (purpose) {
    'BUY_CREDITS' =>
      'Payment verified. Your Premium credits are being attached now…',
    'DIRECT_UNLOCK' =>
      'Payment verified. Your advanced idea workspace is opening now…',
    'ACCEPT_PUBLICATION' =>
      'Payment verified. The protected opportunity brief is being prepared…',
    'UNLOCK_PUBLICATION_ADVANCED' =>
      'Payment verified. Advanced publication outputs are being attached…',
    _ => 'Payment verified. Voxidence is applying your access safely…',
  };
}

String _paymentIdFrom(String current, Uri? uri) {
  if (current.trim().isNotEmpty) {
    return current.trim();
  }

  return uri?.queryParameters['paymentId']?.trim() ?? '';
}

String _firstNonEmpty(List<dynamic> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) {
      return text;
    }
  }

  return '';
}

class MobileCheckoutPage extends StatefulWidget {
  const MobileCheckoutPage({
    super.key,
    required this.checkoutUrl,
    required this.paymentId,
    this.title = 'Secure checkout',
  });

  final String checkoutUrl;
  final String paymentId;
  final String title;

  @override
  State<MobileCheckoutPage> createState() => _MobileCheckoutPageState();
}

class _MobileCheckoutPageState extends State<MobileCheckoutPage> {
  WebViewController? _controller;
  double _progress = 0;
  String? _loadError;
  bool _externalOpening = false;
  bool _verifying = false;
  bool _verified = false;
  String? _verificationError;
  String _verificationMessage =
      'Stripe returned successfully. Voxidence is verifying the sandbox payment…';
  Uri? _successReturnUri;

  bool get _supportsEmbeddedWebView {
    if (kIsWeb) {
      return false;
    }

    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  @override
  void initState() {
    super.initState();

    if (_supportsEmbeddedWebView) {
      _configureController();
    }
  }

  void _configureController() {
    final uri = Uri.parse(widget.checkoutUrl);

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.background)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) {
              return;
            }

            setState(() => _progress = progress.clamp(0, 100) / 100);
          },
          onPageStarted: (_) {
            if (!mounted) {
              return;
            }

            setState(() => _loadError = null);
          },
          onPageFinished: (_) {
            if (!mounted) {
              return;
            }

            setState(() => _progress = 1);
          },
          onWebResourceError: (error) {
            if (!mounted || error.isForMainFrame == false || _verifying) {
              return;
            }

            setState(() {
              _loadError =
                  'Stripe Checkout could not finish loading. Check the API connection and try again.';
            });
          },
          onNavigationRequest: _handleNavigationRequest,
        ),
      )
      ..loadRequest(uri);

    _controller = controller;
  }

  Future<NavigationDecision> _handleNavigationRequest(
    NavigationRequest request,
  ) async {
    final uri = Uri.tryParse(request.url);
    if (uri == null) {
      return NavigationDecision.prevent;
    }

    if (_isSuccessReturn(uri)) {
      unawaited(_completeFromProviderReturn(uri));
      return NavigationDecision.prevent;
    }

    if (_isCancelReturn(uri)) {
      if (mounted) {
        Navigator.of(context).pop(
          CheckoutFlowResult(
            status: CheckoutFlowStatus.cancelled,
            returnUri: uri,
          ),
        );
      }

      return NavigationDecision.prevent;
    }

    if (uri.scheme == 'http' || uri.scheme == 'https') {
      return NavigationDecision.navigate;
    }

    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Keep Stripe Checkout visible when no matching external app exists.
    }

    return NavigationDecision.prevent;
  }

  Future<void> _completeFromProviderReturn(Uri uri) async {
    if (_verifying || _verified) {
      return;
    }

    final paymentId = _paymentIdFrom(widget.paymentId, uri);
    if (paymentId.isEmpty) {
      if (!mounted) {
        return;
      }

      setState(() {
        _verificationError =
            'Stripe returned without the Voxidence payment reference.';
      });
      return;
    }

    setState(() {
      _successReturnUri = uri;
      _verifying = true;
      _verified = false;
      _verificationError = null;
      _verificationMessage =
          'Stripe returned successfully. Voxidence is verifying the sandbox payment…';
    });

    try {
      final paymentState = await _waitForPaymentFulfillment(
        paymentId,
        onMessage: (message) {
          if (!mounted) {
            return;
          }

          setState(() => _verificationMessage = message);
        },
      );

      await UserSessionController.instance.load(force: true);

      if (!mounted) {
        return;
      }

      setState(() {
        _verifying = false;
        _verified = true;
        _verificationError = null;
      });

      await Future<void>.delayed(const Duration(milliseconds: 720));

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop(
        CheckoutFlowResult(
          status: CheckoutFlowStatus.completed,
          returnUri: uri,
          paymentState: paymentState,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _verifying = false;
        _verified = false;
        _verificationError = error.message;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _verifying = false;
        _verified = false;
        _verificationError = error.toString();
      });
    }
  }

  Future<void> _retryVerification() async {
    final uri = _successReturnUri;
    if (uri == null) {
      return;
    }

    await _completeFromProviderReturn(uri);
  }

  bool _isSuccessReturn(Uri uri) {
    final path = uri.path.toLowerCase();

    return path == '/mobile/payments/success' ||
        path == '/normal/payments/success' ||
        uri.host.toLowerCase() == 'payment-success';
  }

  bool _isCancelReturn(Uri uri) {
    final path = uri.path.toLowerCase();
    final query = uri.queryParameters;

    return path == '/mobile/payments/cancel' ||
        query['payment'] == 'cancelled' ||
        query['cancelled'] == '1' ||
        query['advancedCancelled'] == '1';
  }

  void _close() {
    if (_verifying) {
      return;
    }

    Navigator.of(
      context,
    ).pop(const CheckoutFlowResult(status: CheckoutFlowStatus.closed));
  }

  Future<void> _openFallback() async {
    if (_externalOpening) {
      return;
    }

    setState(() => _externalOpening = true);

    try {
      final uri = Uri.parse(widget.checkoutUrl);
      final opened = await launchUrl(uri, mode: LaunchMode.inAppBrowserView);

      if (!opened && mounted) {
        setState(() {
          _loadError = 'Stripe Checkout could not be opened on this platform.';
        });
      }
    } finally {
      if (mounted) {
        setState(() => _externalOpening = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: AppColors.background,
        leadingWidth: 50,
        leading: IconButton(
          tooltip: 'Close checkout',
          onPressed: _verifying ? null : _close,
          icon: const Icon(
            Icons.arrow_back_rounded,
            size: 22,
            color: AppColors.primaryDeep,
          ),
        ),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16.5,
                height: 1.05,
                fontWeight: FontWeight.w900,
                letterSpacing: -.35,
              ),
            ),
            const SizedBox(height: 2),
            const Text(
              'Stripe checkout · inside Voxidence',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 7.7,
                height: 1,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .82),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.border),
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
                  'STRIPE',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 7.1,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .55,
                  ),
                ),
              ],
            ),
          ),
        ],
        bottom: _supportsEmbeddedWebView && _progress < 1
            ? PreferredSize(
                preferredSize: const Size.fromHeight(2),
                child: LinearProgressIndicator(
                  minHeight: 2,
                  value: _progress <= 0 ? null : _progress,
                ),
              )
            : null,
      ),
      body: SafeArea(top: false, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (!_supportsEmbeddedWebView) {
      return _FallbackCheckout(
        busy: _externalOpening,
        error: _loadError,
        onOpen: _openFallback,
      );
    }

    final controller = _controller;
    if (controller == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Stack(
      children: [
        Positioned.fill(child: WebViewWidget(controller: controller)),
        if (_loadError != null && !_verifying && !_verified)
          Positioned.fill(
            child: ColoredBox(
              color: AppColors.background.withValues(alpha: .97),
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: _CheckoutErrorCard(
                    message: _loadError!,
                    onRetry: () {
                      setState(() => _loadError = null);
                      controller.reload();
                    },
                  ),
                ),
              ),
            ),
          ),
        if (_verifying || _verified || _verificationError != null)
          Positioned.fill(
            child: _PaymentVerificationOverlay(
              verifying: _verifying,
              verified: _verified,
              message: _verificationError ?? _verificationMessage,
              onRetry: _verificationError == null ? null : _retryVerification,
            ),
          ),
      ],
    );
  }
}

class _FallbackCheckout extends StatelessWidget {
  const _FallbackCheckout({
    required this.busy,
    required this.error,
    required this.onOpen,
  });

  final bool busy;
  final String? error;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: _CheckoutErrorCard(
            message: error ??
                'Embedded Stripe Checkout is only available in the native Android and iOS app.',
            onRetry: onOpen,
            retryLabel: busy ? 'Opening…' : 'Open checkout',
          ),
        ),
      ),
    );
  }
}

class _PaymentVerificationOverlay extends StatelessWidget {
  const _PaymentVerificationOverlay({
    required this.verifying,
    required this.verified,
    required this.message,
    required this.onRetry,
  });

  final bool verifying;
  final bool verified;
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final hasError = !verifying && !verified && onRetry != null;

    return ColoredBox(
      color: AppColors.background.withValues(alpha: .965),
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 420),
            padding: const EdgeInsets.fromLTRB(22, 25, 22, 21),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .10),
                  blurRadius: 34,
                  offset: const Offset(0, 14),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 240),
                  width: 66,
                  height: 66,
                  decoration: BoxDecoration(
                    color: hasError
                        ? AppColors.surfaceRose
                        : AppColors.primarySoft,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: hasError
                          ? AppColors.pinkLight
                          : AppColors.borderStrong,
                    ),
                  ),
                  alignment: Alignment.center,
                  child: verified
                      ? const Icon(
                          Icons.check_rounded,
                          color: AppColors.primaryDark,
                          size: 32,
                        )
                      : hasError
                          ? const Icon(
                              Icons.error_outline_rounded,
                              color: AppColors.danger,
                              size: 29,
                            )
                          : const SizedBox(
                              width: 27,
                              height: 27,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                              ),
                            ),
                ),
                const SizedBox(height: 15),
                Text(
                  verified
                      ? 'Payment verified'
                      : hasError
                          ? 'Verification needs attention'
                          : 'Confirming your payment',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    height: 1.12,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.4,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  verified
                      ? 'Stripe and Voxidence agree. Returning you to the workspace now.'
                      : message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.2,
                    height: 1.48,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (hasError) ...[
                  const SizedBox(height: 17),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded, size: 17),
                      label: const Text('Verify again'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CheckoutErrorCard extends StatelessWidget {
  const _CheckoutErrorCard({
    required this.message,
    required this.onRetry,
    this.retryLabel = 'Try again',
  });

  final String message;
  final VoidCallback onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 24, 22, 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .08),
            blurRadius: 28,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: const BoxDecoration(
              color: AppColors.primarySoft,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.lock_clock_outlined,
              color: AppColors.primaryDark,
              size: 27,
            ),
          ),
          const SizedBox(height: 15),
          const Text(
            'Stripe Checkout needs attention',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w900,
              letterSpacing: -.4,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.8,
              height: 1.48,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 17),
              label: Text(retryLabel),
            ),
          ),
        ],
      ),
    );
  }
}
