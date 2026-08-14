// Voxidence authenticated Publication / Discovery detail.
//
// This page is the mobile translation of the web PublicationDetailPage.
// It preserves the same product logic while using a touch-first vertical
// composition suitable for phones.
//
// Web-parity behavior:
// - Public title + public abstract are visible before acceptance.
// - Rating, voting and written feedback can be used before acceptance when
//   enabled by the publisher.
// - The problem, objectives and target-user brief stay protected until the
//   publication is accepted.
// - Premium users receive automatic basic acceptance when the backend allows
//   adoption, matching the web flow.
// - Advanced accepted access uses Premium credits or secure hosted checkout.
// - Reporting remains private to the moderation team.
// - Primary publication data paints before optional engagement state.
//
// Visual language:
// - Porcelain, teal, sage, mint and soft rose only.
// - Animated community signal visual inspired by the web hero.
// - Compact cards and controls sized for mobile.
//
// @author  Malak

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../models/payment_currency.dart';
import '../widgets/payment_currency_selector.dart';
import '../widgets/user_ui.dart';
import '../widgets/workspace_navigation.dart';
import 'accepted_idea_workspace_page.dart';
import 'mobile_checkout_page.dart';

class PublicationPage extends StatefulWidget {
  const PublicationPage({super.key, required this.publicationId});

  final String publicationId;

  @override
  State<PublicationPage> createState() => _PublicationPageState();
}

class _PublicationPageState extends State<PublicationPage> {
  final UserSessionController _session = UserSessionController.instance;
  final TextEditingController _feedbackController = TextEditingController();

  Map<String, dynamic>? _data;
  Map<String, dynamic>? _acceptance;
  Map<String, dynamic>? _myRating;
  Map<String, dynamic>? _myVote;
  Map<String, dynamic>? _myFeedback;
  Map<String, dynamic>? _pricing;
  String _paymentCurrency = PaymentCurrencyPreference.current;

  Object? _error;

  bool _loading = true;
  bool _engagementLoading = false;

  // Long-running workspace actions still use the global busy state.
  bool _busy = false;

  // Community interactions are intentionally isolated so a slow feedback
  // request never blocks rating or voting, and vice versa.
  bool _ratingBusy = false;
  bool _voteBusy = false;
  bool _feedbackBusy = false;

  // Prevent a late initial GET from overwriting a tap the user already made.
  int _ratingRevision = 0;
  int _voteRevision = 0;
  int _feedbackRevision = 0;

  bool _autoAcceptAttempted = false;
  bool _autoAccepting = false;

  @override
  void initState() {
    super.initState();
    _load();
    unawaited(_loadPricing());
  }

  @override
  void dispose() {
    _feedbackController.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = _data == null;
        _error = null;
      });
    }

    try {
      // Paint the publication as soon as the main detail request returns.
      // Acceptance, engagement and pricing are secondary state and must not
      // hold the whole Community Opportunity page behind a blank skeleton.
      final detail = _map(
        await UserApi.instance.getDiscovery(
          widget.publicationId,
          force: force,
        ),
      );

      final embeddedAcceptance = detail['acceptance'] is Map
          ? _extractAcceptance(
              Map<String, dynamic>.from(detail['acceptance'] as Map),
            )
          : null;

      if (!mounted) return;

      setState(() {
        _data = detail;
        if (embeddedAcceptance != null && embeddedAcceptance.isNotEmpty) {
          _acceptance = embeddedAcceptance;
        }
        _loading = false;
      });

      unawaited(_loadAcceptance(force: force));
      unawaited(_loadEngagement(force: force));
      unawaited(_maybeAutoAcceptPremium(detail));
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadAcceptance({bool force = false}) async {
    try {
      final raw = await UserApi.instance.getMyAcceptance(
        widget.publicationId,
        force: force,
      );

      if (!mounted) return;

      final acceptance = raw == null ? null : _extractAcceptance(_map(raw));
      setState(() {
        if (acceptance == null || acceptance.isEmpty) {
          if (_acceptance == null || force) {
            _acceptance = null;
          }
        } else {
          _acceptance = acceptance;
        }
      });
    } catch (_) {
      // Public detail stays usable even if optional acceptance state is slow.
    }
  }

  Future<void> _loadEngagement({bool force = false}) async {
    final data = _data;
    if (data == null || _engagementLoading) return;

    final ratingRevision = _ratingRevision;
    final voteRevision = _voteRevision;
    final feedbackRevision = _feedbackRevision;

    setState(() => _engagementLoading = true);

    try {
      final requests = <Future<Map<String, dynamic>?>>[];
      final keys = <String>[];

      if (_enabled(data['allowRatings'])) {
        requests.add(
          _safeEngagement(
            UserApi.instance.getMyRating(widget.publicationId, force: force),
          ),
        );
        keys.add('rating');
      }

      if (_enabled(data['allowVoting'])) {
        requests.add(
          _safeEngagement(
            UserApi.instance.getMyVote(widget.publicationId, force: force),
          ),
        );
        keys.add('vote');
      }

      if (_enabled(data['allowFeedback'])) {
        requests.add(
          _safeEngagement(
            UserApi.instance.getMyFeedback(widget.publicationId, force: force),
          ),
        );
        keys.add('feedback');
      }

      if (requests.isEmpty) return;

      final results = await Future.wait(requests);

      if (!mounted) return;

      setState(() {
        for (var i = 0; i < results.length; i++) {
          final result = results[i];

          switch (keys[i]) {
            case 'rating':
              if (ratingRevision == _ratingRevision) {
                _myRating = result;
              }
              break;
            case 'vote':
              if (voteRevision == _voteRevision) {
                _myVote = result;
              }
              break;
            case 'feedback':
              if (feedbackRevision == _feedbackRevision) {
                _myFeedback = result;
                _feedbackController.text = _feedbackComment(result);
              }
              break;
          }
        }
      });
    } finally {
      if (mounted) {
        setState(() => _engagementLoading = false);
      }
    }
  }

  Future<Map<String, dynamic>?> _safeEngagement(
    Future<Map<String, dynamic>?> request,
  ) async {
    try {
      return await request;
    } catch (_) {
      return null;
    }
  }

  Future<void> _loadPricing({bool force = false}) async {
    try {
      final preferredCurrency =
          await UserApi.instance.getPaymentCurrencyPreference(force: force);
      final pricing = await UserApi.instance.getPricing(
        currency: preferredCurrency,
        force: force,
      );

      if (mounted) {
        setState(() {
          _paymentCurrency = preferredCurrency;
          _pricing = pricing;
        });
      }
    } catch (_) {
      // Pricing improves labels only. Backend actions remain authoritative.
    }
  }

  Future<void> _maybeAutoAcceptPremium(Map<String, dynamic> detail) async {
    if (_autoAcceptAttempted ||
        !_session.isPremium ||
        !_enabled(detail['allowAdoption']) ||
        _isOwner(detail) ||
        _accepted) {
      return;
    }

    _autoAcceptAttempted = true;

    if (mounted) {
      setState(() => _autoAccepting = true);
    }

    try {
      final result = await UserApi.instance.acceptDiscovery(
        widget.publicationId,
      );

      final checkoutUrl = _checkoutUrl(result);

      // Premium basic acceptance should not require checkout. If a backend
      // response unexpectedly returns one, never navigate automatically.
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        final acceptance = _extractAcceptance(result);

        if (mounted && acceptance.isNotEmpty) {
          setState(() => _acceptance = acceptance);
        }

        await _load(force: true);
      }
    } catch (_) {
      // Same as web: failure of automatic Premium acceptance must not prevent
      // the public publication from opening.
    } finally {
      if (mounted) {
        setState(() => _autoAccepting = false);
      }
    }
  }

  Future<void> _accept() async {
    if (_busy) return;

    if (!_session.isPremium && (_pricing == null || _pricing!.isEmpty)) {
      await _loadPricing();
      if (!mounted) return;
    }

    setState(() => _busy = true);

    try {
      final result = await UserApi.instance.acceptDiscovery(
        widget.publicationId,
        currency: _paymentCurrency,
      );

      final checkoutUrl = _checkoutUrl(result);

      if (checkoutUrl != null && checkoutUrl.isNotEmpty) {
        await _openCheckout(result);
        return;
      }

      final acceptance = _extractAcceptance(result);

      if (acceptance.isNotEmpty) {
        _acceptance = acceptance;
      }

      await Future.wait([_session.load(force: true), _load(force: true)]);

      if (mounted) {
        showAppSnackBar(
          context,
          'Accepted successfully. The protected brief is now open.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _unlockAdvanced() async {
    if (_busy) return;

    if (_pricing == null || _pricing!.isEmpty) {
      await _loadPricing();
      if (!mounted) return;
    }

    setState(() => _busy = true);

    try {
      if (_session.isPremium) {
        await UserApi.instance.unlockAcceptedAdvancedWithCredits(
          widget.publicationId,
        );

        await Future.wait([_session.load(force: true), _load(force: true)]);

        if (mounted) {
          showAppSnackBar(context, 'Advanced workspace unlocked.');
        }
        return;
      }

      final result = await UserApi.instance.createAcceptedAdvancedCheckout(
        widget.publicationId,
        currency: _paymentCurrency,
      );

      final checkoutUrl = _checkoutUrl(result);

      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        await _load(force: true);

        if (mounted) {
          showAppSnackBar(context, 'Advanced access is already available.');
        }
        return;
      }

      await _openCheckout(result);
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openCheckout(Map<String, dynamic> checkoutResult) async {
    final flow = await openVoxidenceCheckout(
      context,
      checkoutResult: checkoutResult,
      selectedSection: WorkspaceSection.ideas,
      publicationId: widget.publicationId,
      title: 'Secure publication checkout',
    );

    if (flow.status == CheckoutFlowStatus.completed && mounted) {
      await Future.wait([_session.load(force: true), _load(force: true)]);
    }
  }

  Future<void> _setRating(int value) async {
    if (_ratingBusy) return;

    final previousRating = _ratingValue;
    final previousMyRating = _myRating == null
        ? null
        : Map<String, dynamic>.from(_myRating!);

    final previousData = _data == null
        ? null
        : Map<String, dynamic>.from(_data!);

    final removing = previousRating == value;
    final revision = ++_ratingRevision;

    // The visible rating changes before the network request starts.
    setState(() {
      _ratingBusy = true;
      _myRating = removing ? null : <String, dynamic>{'value': value};
    });

    try {
      final result = removing
          ? await UserApi.instance.deleteRatingReturningResult(
              widget.publicationId,
            )
          : await UserApi.instance.setRating(widget.publicationId, value);

      if (!mounted || revision != _ratingRevision) {
        return;
      }

      final stats = _map(result['publicationRating']);

      setState(() {
        if (!removing) {
          _myRating = {'value': value, ..._map(result['rating'])};
        }

        if (stats.isNotEmpty) {
          _patchPublicationData({
            'averageRating': stats['averageRating'],
            'ratingsCount': stats['ratingsCount'],
          });
        }
      });

      showAppSnackBar(context, removing ? 'Rating removed.' : 'Rating saved.');
    } on ApiException catch (error) {
      if (mounted && revision == _ratingRevision) {
        setState(() {
          _myRating = previousMyRating;
          _data = previousData;
        });

        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted && revision == _ratingRevision) {
        setState(() => _ratingBusy = false);
      }
    }
  }

  Future<void> _clearRating() async {
    final current = _ratingValue;
    if (current == 0) return;
    await _setRating(current);
  }

  Future<void> _setVote(String value) async {
    if (_voteBusy) return;

    final previousVote = _voteValue;
    final previousMyVote = _myVote == null
        ? null
        : Map<String, dynamic>.from(_myVote!);

    final previousData = _data == null
        ? null
        : Map<String, dynamic>.from(_data!);

    final removing = previousVote == value;
    final revision = ++_voteRevision;

    setState(() {
      _voteBusy = true;
      _myVote = removing ? null : <String, dynamic>{'value': value};

      _applyOptimisticVoteCounts(
        previousVote: previousVote,
        nextVote: removing ? '' : value,
      );
    });

    try {
      final result = removing
          ? await UserApi.instance.deleteVoteReturningResult(
              widget.publicationId,
            )
          : await UserApi.instance.setVote(widget.publicationId, value);

      if (!mounted || revision != _voteRevision) {
        return;
      }

      final stats = _map(result['publicationVotes']);

      setState(() {
        if (!removing) {
          _myVote = {'value': value, ..._map(result['vote'])};
        }

        if (stats.isNotEmpty) {
          _patchPublicationData({
            'upvotesCount': stats['upvotesCount'],
            'downvotesCount': stats['downvotesCount'],
          });
        }
      });

      showAppSnackBar(context, removing ? 'Vote removed.' : 'Vote saved.');
    } on ApiException catch (error) {
      if (mounted && revision == _voteRevision) {
        setState(() {
          _myVote = previousMyVote;
          _data = previousData;
        });

        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted && revision == _voteRevision) {
        setState(() => _voteBusy = false);
      }
    }
  }

  Future<void> _saveFeedback() async {
    final comment = _feedbackController.text.trim();

    if (_feedbackBusy || comment.isEmpty) {
      return;
    }

    final wasSaved = _feedbackSaved;

    final previousFeedback = _myFeedback == null
        ? null
        : Map<String, dynamic>.from(_myFeedback!);

    final previousData = _data == null
        ? null
        : Map<String, dynamic>.from(_data!);

    final revision = ++_feedbackRevision;

    setState(() {
      _feedbackBusy = true;
      _myFeedback = {'comment': comment};

      if (!wasSaved) {
        _patchPublicationData({
          'feedbackCount': _int(_data?['feedbackCount']) + 1,
        });
      }
    });

    try {
      final result = await UserApi.instance.setFeedback(
        widget.publicationId,
        comment,
      );

      if (!mounted || revision != _feedbackRevision) {
        return;
      }

      setState(() {
        _myFeedback = {'comment': comment, ..._map(result['feedback'])};

        if (result['feedbackCount'] != null) {
          _patchPublicationData({'feedbackCount': result['feedbackCount']});
        }
      });

      showAppSnackBar(
        context,
        wasSaved ? 'Feedback updated.' : 'Feedback shared.',
      );
    } on ApiException catch (error) {
      if (mounted && revision == _feedbackRevision) {
        setState(() {
          _myFeedback = previousFeedback;
          _data = previousData;
        });

        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted && revision == _feedbackRevision) {
        setState(() => _feedbackBusy = false);
      }
    }
  }

  Future<void> _deleteFeedback() async {
    if (_feedbackBusy || !_feedbackSaved) {
      return;
    }

    final previousFeedback = _myFeedback == null
        ? null
        : Map<String, dynamic>.from(_myFeedback!);

    final previousText = _feedbackController.text;

    final previousData = _data == null
        ? null
        : Map<String, dynamic>.from(_data!);

    final revision = ++_feedbackRevision;

    setState(() {
      _feedbackBusy = true;
      _feedbackController.clear();
      _myFeedback = null;

      _patchPublicationData({
        'feedbackCount': math.max(0, _int(_data?['feedbackCount']) - 1),
      });
    });

    try {
      final result = await UserApi.instance.deleteFeedbackReturningResult(
        widget.publicationId,
      );

      if (!mounted || revision != _feedbackRevision) {
        return;
      }

      if (result['feedbackCount'] != null) {
        setState(() {
          _patchPublicationData({'feedbackCount': result['feedbackCount']});
        });
      }

      showAppSnackBar(context, 'Feedback removed.');
    } on ApiException catch (error) {
      if (mounted && revision == _feedbackRevision) {
        setState(() {
          _feedbackController.text = previousText;
          _myFeedback = previousFeedback;
          _data = previousData;
        });

        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted && revision == _feedbackRevision) {
        setState(() => _feedbackBusy = false);
      }
    }
  }

  void _patchPublicationData(Map<String, dynamic> patch) {
    final current = _data;

    if (current == null) return;

    _data = {...current, ...patch};
  }

  void _applyOptimisticVoteCounts({
    required String previousVote,
    required String nextVote,
  }) {
    var upvotes = _int(_data?['upvotesCount']);

    var downvotes = _int(_data?['downvotesCount']);

    if (previousVote == 'UP') {
      upvotes = math.max(0, upvotes - 1).toInt();
    } else if (previousVote == 'DOWN') {
      downvotes = math.max(0, downvotes - 1).toInt();
    }

    if (nextVote == 'UP') {
      upvotes += 1;
    } else if (nextVote == 'DOWN') {
      downvotes += 1;
    }

    _patchPublicationData({
      'upvotesCount': upvotes,
      'downvotesCount': downvotes,
    });
  }

  Future<void> _openReport() async {
    if (_busy) return;

    final payload =
        await showModalBottomSheet<({String reason, String? details})>(
          context: context,
          backgroundColor: Colors.transparent,
          isScrollControlled: true,
          builder: (_) => const _ReportPublicationSheet(),
        );

    if (payload == null || !mounted) return;

    setState(() => _busy = true);

    try {
      await UserApi.instance.reportPublication(
        widget.publicationId,
        reason: payload.reason,
        details: payload.details,
      );

      if (mounted) {
        showAppSnackBar(
          context,
          'Your report was sent privately to the moderation team.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data ?? const <String, dynamic>{};

    final title = _text(
      data['publicTitle'] ?? data['title'],
      fallback: 'Untitled discovery',
    );

    final abstractText = _text(
      data['publicAbstract'] ?? data['publicDescription'],
    );

    final problem = data['publicProblem'];
    final objectives = data['publicObjectives'];
    final targetUsers = data['publicTargetUsers'];

    final publisher = data['publisher'] is Map
        ? Map<String, dynamic>.from(data['publisher'] as Map)
        : const <String, dynamic>{};

    final publisherName = _text(
      publisher['fullName'],
      fallback: 'Voxidence creator',
    );

    final ratingsEnabled = _enabled(data['allowRatings']);

    final votingEnabled = _enabled(data['allowVoting']);

    final feedbackEnabled = _enabled(data['allowFeedback']);

    final adoptionEnabled = _enabled(data['allowAdoption']);

    final advancedAvailable =
        data['advancedOutputsAvailable'] == true ||
        _int(data['advancedOutputsCount']) > 0 ||
        (data['advancedOutputs'] is List &&
            (data['advancedOutputs'] as List).isNotEmpty);

    final hasPublicEngagement =
        ratingsEnabled || votingEnabled || feedbackEnabled;

    final owner = _isOwner(data);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: AppColors.background,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
          systemNavigationBarColor: AppColors.background,
          systemNavigationBarIconBrightness: Brightness.dark,
        ),
        leadingWidth: 50,
        leading: IconButton(
          tooltip: 'Back to Discover',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.arrow_back_rounded, size: 22),
        ),
        titleSpacing: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Discover',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              'Community opportunity',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 7.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: WorkspaceBackground(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(force: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 44),
            children: [
              if (_loading)
                const _PublicationLoadingState()
              else if (_error != null)
                EmptyState(
                  icon: Icons.cloud_off_rounded,
                  title: 'Discovery unavailable',
                  message: _error.toString(),
                  action: FilledButton.icon(
                    onPressed: () => _load(force: true),
                    icon: const Icon(Icons.refresh_rounded, size: 16),
                    label: const Text('Retry'),
                  ),
                )
              else ...[
                _Reveal(
                  delay: 0,
                  child: _PublicationHero(
                    title: title,
                    abstractText: abstractText,
                    publisherName: publisherName,
                    isOwner: owner,
                    ratingsEnabled: ratingsEnabled,
                    votingEnabled: votingEnabled,
                    feedbackEnabled: feedbackEnabled,
                    averageRating: _double(data['averageRating']),
                    upvotes: _int(data['upvotesCount']),
                    feedbackCount: _int(data['feedbackCount']),
                    onReport: _busy ? null : _openReport,
                  ),
                ),

                if (hasPublicEngagement) ...[
                  const SizedBox(height: 14),
                  _Reveal(
                    delay: 65,
                    child: _CommunitySignalPanel(
                      ratingsEnabled: ratingsEnabled,
                      votingEnabled: votingEnabled,
                      feedbackEnabled: feedbackEnabled,
                      rating: _ratingValue,
                      vote: _voteValue,
                      feedbackController: _feedbackController,
                      feedbackSaved: _feedbackSaved,
                      loading: _engagementLoading,
                      ratingBusy: _ratingBusy,
                      voteBusy: _voteBusy,
                      feedbackBusy: _feedbackBusy,
                      onRating: _setRating,
                      onDeleteRating: _clearRating,
                      onVote: _setVote,
                      onFeedback: _saveFeedback,
                      onDeleteFeedback: _deleteFeedback,
                    ),
                  ),
                ],

                const SizedBox(height: 14),

                if (owner)
                  _Reveal(delay: 105, child: const _OwnerPublicationCard())
                else if (!_accepted &&
                    _session.isPremium &&
                    adoptionEnabled &&
                    _autoAccepting)
                  _Reveal(delay: 105, child: const _PremiumOpeningCard())
                else if (!_accepted && adoptionEnabled)
                  _Reveal(
                    delay: 105,
                    child: Column(
                      children: [
                        if (!_session.isPremium) ...[
                          PaymentCurrencyPreferenceCard(
                            value: _paymentCurrency,
                            compact: true,
                            returnTitle: 'Discover',
                            returnRoute:
                                '/normal/discover/${widget.publicationId}',
                            returnAfterSave: true,
                            onReturn: () => _loadPricing(force: true),
                          ),
                          const SizedBox(height: 10),
                        ],
                        _ProtectedAccessCard(
                          priceLabel: _acceptancePriceLabel,
                          premium: _session.isPremium,
                          busy: _busy,
                          onAccept: _accept,
                        ),
                      ],
                    ),
                  )
                else if (!_accepted)
                  _Reveal(delay: 105, child: const _AcceptancePausedCard())
                else ...[
                  _Reveal(delay: 105, child: const _AcceptedBanner()),

                  const SizedBox(height: 12),

                  _Reveal(
                    delay: 135,
                    child: _ProtectedBrief(
                      problem: problem,
                      objectives: objectives,
                      targetUsers: targetUsers,
                    ),
                  ),

                  if (advancedAvailable) ...[
                    const SizedBox(height: 14),
                    if (!_advancedGranted && !_session.isPremium) ...[
                      PaymentCurrencyPreferenceCard(
                        value: _paymentCurrency,
                        compact: true,
                        returnTitle: 'Discover',
                        returnRoute:
                            '/normal/discover/${widget.publicationId}',
                        returnAfterSave: true,
                        onReturn: () => _loadPricing(force: true),
                      ),
                      const SizedBox(height: 10),
                    ],
                    _Reveal(
                      delay: 175,
                      child: _AdvancedWorkspaceCard(
                        granted: _advancedGranted,
                        premium: _session.isPremium,
                        priceLabel: _session.isPremium
                            ? _advancedCreditsLabel
                            : _advancedPriceLabel,
                        outputCount: _int(data['advancedOutputsCount']),
                        busy: _busy,
                        onOpen: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => AcceptedIdeaWorkspacePage(
                              publicationId: widget.publicationId,
                            ),
                          ),
                        ),
                        onUnlock: _unlockAdvanced,
                      ),
                    ),
                  ],
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }

  bool get _accepted {
    if (_acceptance != null && _acceptance!.isNotEmpty) {
      return _acceptance!['id'] != null ||
          _acceptance!['acceptedAt'] != null ||
          _acceptance!.isNotEmpty;
    }

    final embedded = _data?['acceptance'];

    return embedded is Map && embedded.isNotEmpty;
  }

  bool get _advancedGranted {
    final acceptance =
        _acceptance ??
        (_data?['acceptance'] is Map
            ? Map<String, dynamic>.from(_data!['acceptance'] as Map)
            : const <String, dynamic>{});

    return _data?['advancedAccessGranted'] == true ||
        _data?['hasAdvancedAccess'] == true ||
        acceptance['advancedUnlockedAt'] != null ||
        acceptance['hasAdvancedAccess'] == true;
  }

  int get _ratingValue {
    final direct = _myRating?['value'];

    if (direct != null) return _int(direct);

    final nested = _myRating?['rating'];

    if (nested is Map) {
      return _int(nested['value']);
    }

    return 0;
  }

  String get _voteValue {
    final direct = _myVote?['value']?.toString();

    if (direct != null && direct.isNotEmpty) {
      return direct;
    }

    final nested = _myVote?['vote'];

    if (nested is Map) {
      return nested['value']?.toString() ?? '';
    }

    return '';
  }

  bool get _feedbackSaved => _feedbackComment(_myFeedback).trim().isNotEmpty;

  bool _isOwner(Map<String, dynamic> detail) {
    final publisher = detail['publisher'];

    if (publisher is! Map) return false;

    final currentId = _session.summary?.id;

    return currentId != null && publisher['id']?.toString() == currentId;
  }

  String get _acceptancePriceLabel {
    final value = _pricingValue(const [
      'publicationAcceptancePrice',
      'normalAcceptancePrice',
      'publication_acceptance_price',
    ]);

    final currency = _pricingCurrency;

    return value == null ? 'Secure checkout' : '${_money(value)} $currency';
  }

  String get _advancedPriceLabel {
    final value = _pricingValue(const [
      'normalPublicationAdvancedPrice',
      'publicationAdvancedPrice',
      'normal_publication_advanced_price',
    ]);

    final currency = _pricingCurrency;

    return value == null
        ? 'Backend-controlled price'
        : '${_money(value)} $currency';
  }

  String get _advancedCreditsLabel {
    final value = _pricingValue(const [
      'publicationAdvancedCreditCost',
      'publication_advanced_credit_cost',
    ]);

    return value == null ? 'Premium credits' : '${_money(value)} credits';
  }

  String get _pricingCurrency {
    final pricing = _pricing;

    if (pricing == null) return 'USD';

    return _text(
      pricing['currency'] ??
          (pricing['pricing'] is Map
              ? (pricing['pricing'] as Map)['currency']
              : null),
      fallback: 'USD',
    );
  }

  num? _pricingValue(List<String> keys) {
    final pricing = _pricing;
    if (pricing == null) return null;

    final containers = <Map>[
      pricing,
      if (pricing['pricing'] is Map) pricing['pricing'] as Map,
      if (pricing['settings'] is Map) pricing['settings'] as Map,
    ];

    for (final container in containers) {
      for (final key in keys) {
        final raw = container[key];

        if (raw is num) return raw;

        final parsed = num.tryParse(raw?.toString() ?? '');

        if (parsed != null) return parsed;
      }
    }

    return null;
  }

  static String? _checkoutUrl(Map<String, dynamic> result) {
    final payment = result['payment'] is Map
        ? Map<String, dynamic>.from(result['payment'] as Map)
        : const <String, dynamic>{};

    final value =
        result['checkoutUrl'] ?? payment['checkoutUrl'] ?? result['url'];

    final url = value?.toString().trim();

    return url == null || url.isEmpty ? null : url;
  }

  static Map<String, dynamic> _extractAcceptance(Map<String, dynamic> payload) {
    if (payload['acceptance'] is Map) {
      return Map<String, dynamic>.from(payload['acceptance'] as Map);
    }

    return Map<String, dynamic>.from(payload);
  }

  static Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return const <String, dynamic>{};
  }

  static bool _enabled(dynamic value) => value != false;

  static int _int(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static double _double(dynamic value) {
    if (value is double) return value;
    if (value is num) return value.toDouble();

    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  static String _text(dynamic value, {String fallback = ''}) {
    final text = value?.toString().trim() ?? '';

    return text.isEmpty ? fallback : text;
  }

  static String _feedbackComment(Map<String, dynamic>? payload) {
    if (payload == null) return '';

    final direct = payload['comment']?.toString();
    if (direct != null) return direct;

    final nested = payload['feedback'];

    if (nested is Map) {
      return nested['comment']?.toString() ?? '';
    }

    return '';
  }

  static String _money(num value) {
    final asDouble = value.toDouble();

    if (asDouble == asDouble.roundToDouble()) {
      return asDouble.toInt().toString();
    }

    return asDouble.toStringAsFixed(2);
  }
}

class _PublicationHero extends StatefulWidget {
  const _PublicationHero({
    required this.title,
    required this.abstractText,
    required this.publisherName,
    required this.isOwner,
    required this.ratingsEnabled,
    required this.votingEnabled,
    required this.feedbackEnabled,
    required this.averageRating,
    required this.upvotes,
    required this.feedbackCount,
    required this.onReport,
  });

  final String title;
  final String abstractText;
  final String publisherName;
  final bool isOwner;

  final bool ratingsEnabled;
  final bool votingEnabled;
  final bool feedbackEnabled;

  final double averageRating;
  final int upvotes;
  final int feedbackCount;

  final VoidCallback? onReport;

  @override
  State<_PublicationHero> createState() => _PublicationHeroState();
}

class _PublicationHeroState extends State<_PublicationHero>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 13),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final metrics = <Widget>[
      if (widget.ratingsEnabled)
        _HeroMetric(
          icon: Icons.star_rounded,
          value: widget.averageRating.toStringAsFixed(1),
          label: 'Rating',
          tint: AppColors.pinkSoft,
          accent: AppColors.pinkDeep,
        ),
      if (widget.votingEnabled)
        _HeroMetric(
          icon: Icons.thumb_up_alt_rounded,
          value: '${widget.upvotes}',
          label: 'Upvotes',
          tint: AppColors.primarySoft,
          accent: AppColors.primaryDark,
        ),
      if (widget.feedbackEnabled)
        _HeroMetric(
          icon: Icons.chat_bubble_rounded,
          value: '${widget.feedbackCount}',
          label: 'Feedback',
          tint: const Color(0xFFF1F8F5),
          accent: AppColors.primaryDeep,
        ),
    ];

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, AppColors.surfaceRose, Color(0xFFF1F9F7)],
          stops: [0, .56, 1],
        ),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .075),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 26,
            offset: const Offset(0, 11),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 92,
              width: double.infinity,
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) {
                  return CustomPaint(
                    painter: _PublicationVisualPainter(
                      progress: _controller.value,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 13, 14, 12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 9,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: .76),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(color: Colors.white),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.auto_awesome_rounded,
                                  size: 10.5,
                                  color: AppColors.primaryDark,
                                ),
                                SizedBox(width: 4),
                                Text(
                                  'COMMUNITY DISCOVERY',
                                  style: TextStyle(
                                    color: AppColors.primaryDark,
                                    fontSize: 6.4,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: .62,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Spacer(),
                          Transform.translate(
                            offset: Offset(
                              0,
                              math.sin(_controller.value * math.pi * 2) * 1.5,
                            ),
                            child: Container(
                              width: 38,
                              height: 38,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .76),
                                borderRadius: BorderRadius.circular(13),
                                border: Border.all(color: Colors.white),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppColors.primaryDark.withValues(
                                      alpha: .055,
                                    ),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: const Icon(
                                Icons.auto_awesome_rounded,
                                size: 15,
                                color: AppColors.primaryDark,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(15, 14, 15, 15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.title,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontSize: 20.5,
                      height: 1.08,
                      letterSpacing: -.42,
                    ),
                  ),

                  if (widget.abstractText.trim().isNotEmpty) ...[
                    const SizedBox(height: 8),
                    _RichPublicContent(
                      value: widget.abstractText,
                      maxLines: 6,
                      compact: true,
                    ),
                  ],

                  const SizedBox(height: 12),

                  Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [AppColors.primarySoft, AppColors.pinkSoft],
                          ),
                          borderRadius: BorderRadius.circular(11),
                          border: Border.all(
                            color: AppColors.primaryDark.withValues(alpha: .05),
                          ),
                        ),
                        child: Text(
                          _initials(widget.publisherName),
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'PUBLISHED BY',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 6.1,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .62,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              widget.publisherName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 9.2,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (!widget.isOwner)
                        Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: widget.onReport,
                            borderRadius: BorderRadius.circular(12),
                            child: Ink(
                              height: 35,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                              decoration: BoxDecoration(
                                color: AppColors.pinkSoft.withValues(
                                  alpha: .72,
                                ),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: AppColors.pink.withValues(alpha: .13),
                                ),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.outlined_flag_rounded,
                                    size: 12.5,
                                    color: AppColors.pinkDeep,
                                  ),
                                  SizedBox(width: 5),
                                  Text(
                                    'Report',
                                    style: TextStyle(
                                      color: AppColors.pinkDeep,
                                      fontSize: 7.9,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),

                  if (metrics.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .66),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: AppColors.primaryDark.withValues(alpha: .055),
                        ),
                      ),
                      child: Row(
                        children: [
                          for (var i = 0; i < metrics.length; i++) ...[
                            Expanded(child: metrics[i]),
                            if (i != metrics.length - 1)
                              Container(
                                width: 1,
                                height: 28,
                                color: AppColors.primaryDark.withValues(
                                  alpha: .065,
                                ),
                              ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PublicationVisualPainter extends CustomPainter {
  const _PublicationVisualPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF0F8F5), Color(0xFFE4F2EE), Color(0xFFFFF3F6)],
          stops: [0, .62, 1],
        ).createShader(rect),
    );

    final linePaint = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: .045)
      ..strokeWidth = .65;

    for (double x = 12; x < size.width; x += 24) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), linePaint);
    }

    final center = Offset(size.width * .66, size.height * .52);

    for (final radius in [22.0, 35.0, 50.0]) {
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color = AppColors.primaryDark.withValues(alpha: .105)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .8,
      );
    }

    final angle = progress * math.pi * 2;
    final reverse = -angle * 1.25;

    canvas.drawCircle(
      Offset(
        center.dx + math.cos(angle) * 50,
        center.dy + math.sin(angle) * 50,
      ),
      3.1,
      Paint()..color = AppColors.pink,
    );

    canvas.drawCircle(
      Offset(
        center.dx + math.cos(reverse) * 35,
        center.dy + math.sin(reverse) * 35,
      ),
      2.6,
      Paint()..color = AppColors.primary,
    );

    final path = Path()
      ..moveTo(-18, size.height * .70)
      ..cubicTo(
        size.width * .18,
        size.height * .23,
        size.width * .30,
        size.height * .96,
        size.width * .52,
        size.height * .48,
      )
      ..cubicTo(
        size.width * .70,
        size.height * .10,
        size.width * .84,
        size.height * .88,
        size.width + 20,
        size.height * .30,
      );

    canvas.drawPath(
      path,
      Paint()
        ..color = AppColors.primary.withValues(alpha: .22)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.15,
    );

    final shimmerX = -40 + ((size.width + 80) * progress);

    final shimmer = Path()
      ..moveTo(shimmerX - 18, size.height)
      ..lineTo(shimmerX + 6, 0)
      ..lineTo(shimmerX + 18, 0)
      ..lineTo(shimmerX - 6, size.height)
      ..close();

    canvas.drawPath(
      shimmer,
      Paint()..color = Colors.white.withValues(alpha: .18),
    );
  }

  @override
  bool shouldRepaint(covariant _PublicationVisualPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

class _HeroMetric extends StatelessWidget {
  const _HeroMetric({
    required this.icon,
    required this.value,
    required this.label,
    required this.tint,
    required this.accent,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color tint;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 27,
            height: 27,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tint,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 12, color: accent),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.2,
                    height: 1,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 6.4,
                    height: 1,
                    fontWeight: FontWeight.w700,
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

class _CommunitySignalPanel extends StatelessWidget {
  const _CommunitySignalPanel({
    required this.ratingsEnabled,
    required this.votingEnabled,
    required this.feedbackEnabled,
    required this.rating,
    required this.vote,
    required this.feedbackController,
    required this.feedbackSaved,
    required this.loading,
    required this.ratingBusy,
    required this.voteBusy,
    required this.feedbackBusy,
    required this.onRating,
    required this.onDeleteRating,
    required this.onVote,
    required this.onFeedback,
    required this.onDeleteFeedback,
  });

  final bool ratingsEnabled;
  final bool votingEnabled;
  final bool feedbackEnabled;

  final int rating;
  final String vote;
  final TextEditingController feedbackController;

  final bool feedbackSaved;
  final bool loading;
  final bool ratingBusy;
  final bool voteBusy;
  final bool feedbackBusy;

  final ValueChanged<int> onRating;
  final VoidCallback onDeleteRating;
  final ValueChanged<String> onVote;
  final VoidCallback onFeedback;
  final VoidCallback onDeleteFeedback;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 13),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, Color(0xFFF3FAF8)],
        ),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .065),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 39,
                height: 39,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF6BC5BF), Color(0xFF4FA8A3)],
                  ),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.insights_outlined,
                  size: 17,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 9),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'COMMUNITY SIGNALS',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 6.1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .68,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'React without leaving the idea',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Every action updates on screen immediately.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.1,
                      ),
                    ),
                  ],
                ),
              ),
              if (loading)
                const SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.7,
                    color: AppColors.primary,
                  ),
                ),
            ],
          ),

          if (ratingsEnabled) ...[
            const SizedBox(height: 11),
            _RatingSignal(
              value: rating,
              busy: ratingBusy,
              onSelect: onRating,
              onClear: onDeleteRating,
            ),
          ],

          if (votingEnabled) ...[
            if (ratingsEnabled) const SizedBox(height: 8),
            _VotingSignal(value: vote, busy: voteBusy, onVote: onVote),
          ],

          if (feedbackEnabled) ...[
            if (ratingsEnabled || votingEnabled) const SizedBox(height: 8),
            _FeedbackSignal(
              controller: feedbackController,
              saved: feedbackSaved,
              busy: feedbackBusy,
              onSave: onFeedback,
              onDelete: onDeleteFeedback,
            ),
          ],
        ],
      ),
    );
  }
}

class _RatingSignal extends StatelessWidget {
  const _RatingSignal({
    required this.value,
    required this.busy,
    required this.onSelect,
    required this.onClear,
  });

  final int value;
  final bool busy;
  final ValueChanged<int> onSelect;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return _SignalSurface(
      icon: Icons.star_rounded,
      eyebrow: 'YOUR RATING',
      title: value == 0
          ? 'How strong is this opportunity?'
          : '$value / 5 · your current rating',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (busy)
            const Padding(
              padding: EdgeInsets.only(right: 7),
              child: SizedBox(
                width: 13,
                height: 13,
                child: CircularProgressIndicator(
                  strokeWidth: 1.6,
                  color: AppColors.primary,
                ),
              ),
            ),
          if (value > 0)
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: busy ? null : onClear,
                borderRadius: BorderRadius.circular(999),
                child: Container(
                  height: 29,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .72),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: AppColors.primaryDark.withValues(alpha: .07),
                    ),
                  ),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.close_rounded,
                        size: 11,
                        color: AppColors.textMuted,
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Remove',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 6.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      child: Row(
        children: List.generate(5, (index) {
          final ratingValue = index + 1;
          final active = ratingValue <= value;

          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: index == 4 ? 0 : 5),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: busy ? null : () => onSelect(ratingValue),
                  borderRadius: BorderRadius.circular(12),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    height: 43,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: active
                          ? const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [Color(0xFF65C3BD), Color(0xFF4A9F9B)],
                            )
                          : null,
                      color: active
                          ? null
                          : Colors.white.withValues(alpha: .74),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: active
                            ? AppColors.primary.withValues(alpha: .10)
                            : AppColors.primaryDark.withValues(alpha: .055),
                      ),
                      boxShadow: active
                          ? [
                              BoxShadow(
                                color: AppColors.primary.withValues(alpha: .12),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              ),
                            ]
                          : null,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          active
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          size: 17,
                          color: active ? Colors.white : AppColors.primaryDark,
                        ),
                        const SizedBox(height: 1),
                        Text(
                          '$ratingValue',
                          style: TextStyle(
                            color: active
                                ? Colors.white.withValues(alpha: .92)
                                : AppColors.textMuted,
                            fontSize: 5.8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _VotingSignal extends StatelessWidget {
  const _VotingSignal({
    required this.value,
    required this.busy,
    required this.onVote,
  });

  final String value;
  final bool busy;
  final ValueChanged<String> onVote;

  @override
  Widget build(BuildContext context) {
    return _SignalSurface(
      icon: Icons.how_to_vote_outlined,
      eyebrow: 'QUICK VOTE',
      title: value.isEmpty
          ? 'Would you support this direction?'
          : value == 'UP'
          ? 'You support this direction'
          : 'You marked this as needing work',
      trailing: busy
          ? const SizedBox(
              width: 13,
              height: 13,
              child: CircularProgressIndicator(
                strokeWidth: 1.6,
                color: AppColors.primary,
              ),
            )
          : null,
      child: Row(
        children: [
          Expanded(
            child: _VoteAction(
              icon: Icons.thumb_up_alt_outlined,
              selectedIcon: Icons.thumb_up_alt_rounded,
              label: 'Support',
              helper: value == 'UP' ? 'Selected' : 'Looks promising',
              selected: value == 'UP',
              positive: true,
              onTap: busy ? null : () => onVote('UP'),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: _VoteAction(
              icon: Icons.tune_rounded,
              selectedIcon: Icons.check_circle_outline_rounded,
              label: 'Needs work',
              helper: value == 'DOWN' ? 'Selected' : 'Needs refinement',
              selected: value == 'DOWN',
              positive: false,
              onTap: busy ? null : () => onVote('DOWN'),
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedbackSignal extends StatefulWidget {
  const _FeedbackSignal({
    required this.controller,
    required this.saved,
    required this.busy,
    required this.onSave,
    required this.onDelete,
  });

  final TextEditingController controller;
  final bool saved;
  final bool busy;
  final VoidCallback onSave;
  final VoidCallback onDelete;

  @override
  State<_FeedbackSignal> createState() => _FeedbackSignalState();
}

class _FeedbackSignalState extends State<_FeedbackSignal> {
  @override
  Widget build(BuildContext context) {
    final hasText = widget.controller.text.trim().isNotEmpty;

    return _SignalSurface(
      icon: Icons.chat_bubble_outline_rounded,
      eyebrow: 'WRITTEN FEEDBACK',
      title: widget.saved ? 'Your feedback is saved' : 'Leave a useful note',
      trailing: widget.busy
          ? const SizedBox(
              width: 13,
              height: 13,
              child: CircularProgressIndicator(
                strokeWidth: 1.6,
                color: AppColors.primary,
              ),
            )
          : widget.saved
          ? Container(
              height: 27,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFEAF8F2),
                borderRadius: BorderRadius.circular(999),
              ),
              child: const Row(
                children: [
                  Icon(Icons.check_rounded, size: 10, color: AppColors.success),
                  SizedBox(width: 4),
                  Text(
                    'SAVED',
                    style: TextStyle(
                      color: AppColors.success,
                      fontSize: 5.7,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .45,
                    ),
                  ),
                ],
              ),
            )
          : null,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .76),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: AppColors.primaryDark.withValues(alpha: .055),
              ),
            ),
            child: TextField(
              controller: widget.controller,
              minLines: 3,
              maxLines: 5,
              maxLength: 2000,
              onChanged: (_) => setState(() {}),
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                height: 1.45,
              ),
              decoration: const InputDecoration(
                hintText:
                    'What feels strong, unclear, risky or worth validating?',
                hintStyle: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.4,
                  height: 1.4,
                ),
                counterText: '',
                filled: false,
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
          const SizedBox(height: 7),
          Row(
            children: [
              Text(
                '${widget.controller.text.length}/2000',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              if (widget.saved) ...[
                OutlinedButton.icon(
                  onPressed: widget.busy ? null : widget.onDelete,
                  icon: const Icon(Icons.delete_outline_rounded, size: 12),
                  label: const Text('Remove'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: BorderSide(
                      color: AppColors.danger.withValues(alpha: .18),
                    ),
                    minimumSize: const Size(0, 37),
                    padding: const EdgeInsets.symmetric(horizontal: 9),
                    textStyle: const TextStyle(
                      fontSize: 7.2,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
              ],
              FilledButton.icon(
                onPressed: widget.busy || !hasText ? null : widget.onSave,
                icon: Icon(
                  widget.saved ? Icons.refresh_rounded : Icons.send_rounded,
                  size: 12,
                ),
                label: Text(widget.saved ? 'Update' : 'Share feedback'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 37),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(11),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 7.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SignalSurface extends StatelessWidget {
  const _SignalSurface({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.child,
    this.trailing,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .68),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 14, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 5.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .54,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 6), trailing!],
            ],
          ),
          const SizedBox(height: 9),
          child,
        ],
      ),
    );
  }
}

class _VoteAction extends StatelessWidget {
  const _VoteAction({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.helper,
    required this.selected,
    required this.positive,
    required this.onTap,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final String helper;
  final bool selected;
  final bool positive;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final accent = positive ? AppColors.primaryDark : AppColors.graphite;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 9),
          decoration: BoxDecoration(
            gradient: selected
                ? LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: positive
                        ? const [Color(0xFFE1F4F0), Color(0xFFF6FBFA)]
                        : const [Color(0xFFF0F3F2), Color(0xFFFAFBFA)],
                  )
                : null,
            color: selected ? null : Colors.white.withValues(alpha: .68),
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: selected
                  ? accent.withValues(alpha: .18)
                  : AppColors.primaryDark.withValues(alpha: .05),
              width: selected ? 1.15 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 33,
                height: 33,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? (positive ? AppColors.primary : AppColors.graphite)
                      : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  selected ? selectedIcon : icon,
                  size: 14,
                  color: selected ? Colors.white : accent,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: accent,
                        fontSize: 8.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      helper,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 5.9,
                        fontWeight: FontWeight.w700,
                      ),
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

class _ProtectedAccessCard extends StatelessWidget {
  const _ProtectedAccessCard({
    required this.priceLabel,
    required this.premium,
    required this.busy,
    required this.onAccept,
  });

  final String priceLabel;
  final bool premium;
  final bool busy;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(23),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            AppColors.surfaceRose,
            Color(0xFFEAF6F3),
          ],
        ),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .12),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .05),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 43,
                height: 43,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      AppColors.primary,
                      Color(0xFF4FA9A4),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.lock_outline_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'PROTECTED OPPORTUNITY BRIEF',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 6.7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .72,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Unlock the complete public brief.',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.7,
                        height: 1.15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            premium
                ? 'Premium basic acceptance opens automatically. This button safely retries access if it is still pending.'
                : 'Open the protected problem, objectives and target users with one verified checkout.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.8,
              height: 1.42,
            ),
          ),
          const SizedBox(height: 10),
          const Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _LightBenefit(icon: Icons.layers_outlined, text: 'Problem'),
              _LightBenefit(icon: Icons.flag_outlined, text: 'Objectives'),
              _LightBenefit(icon: Icons.groups_outlined, text: 'Target users'),
            ],
          ),
          const SizedBox(height: 11),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: 10,
              vertical: 9,
            ),
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .58),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Row(
              children: [
                Icon(
                  premium ? Icons.verified_user_outlined : Icons.credit_card_outlined,
                  size: 14,
                  color: AppColors.primaryDark,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    premium
                        ? 'Premium protected access'
                        : 'One-time protected access',
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 8,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  premium ? 'Included' : priceLabel,
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: busy ? null : onAccept,
              icon: Icon(
                premium
                    ? Icons.arrow_outward_rounded
                    : Icons.lock_open_rounded,
                size: 15,
              ),
              label: Text(
                busy
                    ? 'Checking access...'
                    : premium
                    ? 'Open protected brief'
                    : 'Unlock protected brief',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(43),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
                textStyle: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LightBenefit extends StatelessWidget {
  const _LightBenefit({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 27,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .85),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 12,
            color: AppColors.primaryDark,
          ),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 7.4,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _AcceptedBanner extends StatelessWidget {
  const _AcceptedBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFECFAF5), Color(0xFFF3FAF8), AppColors.surfaceRose],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.success.withValues(alpha: .10)),
      ),
      child: const Row(
        children: [
          SoftIconBadge(icon: Icons.check_circle_outline_rounded, size: 37),
          SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Accepted opportunity',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'The protected basic brief is available below.',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 7.8),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProtectedBrief extends StatelessWidget {
  const _ProtectedBrief({
    required this.problem,
    required this.objectives,
    required this.targetUsers,
  });

  final dynamic problem;
  final dynamic objectives;
  final dynamic targetUsers;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _BriefCard(
          number: '01',
          title: 'Problem overview',
          value: problem,
          icon: Icons.layers_outlined,
        ),
        const SizedBox(height: 9),
        _BriefCard(
          number: '02',
          title: 'Objectives',
          value: objectives,
          icon: Icons.flag_outlined,
          rose: true,
        ),
        const SizedBox(height: 9),
        _BriefCard(
          number: '03',
          title: 'Target users',
          value: targetUsers,
          icon: Icons.groups_outlined,
        ),
      ],
    );
  }
}

class _BriefCard extends StatelessWidget {
  const _BriefCard({
    required this.number,
    required this.title,
    required this.value,
    required this.icon,
    this.rose = false,
  });

  final String number;
  final String title;
  final dynamic value;
  final IconData icon;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(13, 12, 13, 13),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: rose
              ? const [AppColors.surface, AppColors.surfaceRose]
              : const [AppColors.surface, Color(0xFFF2F9F7)],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: rose
              ? AppColors.pink.withValues(alpha: .10)
              : AppColors.primaryDark.withValues(alpha: .06),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .035),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: 0,
            top: -4,
            child: Text(
              number,
              style: TextStyle(
                color: (rose ? AppColors.pinkDeep : AppColors.primaryDark)
                    .withValues(alpha: .07),
                fontSize: 36,
                height: 1,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  SoftIconBadge(icon: icon, rose: rose, size: 34),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              _RichPublicContent(
                value: value,
                fallback: 'No information was provided.',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AdvancedWorkspaceCard extends StatelessWidget {
  const _AdvancedWorkspaceCard({
    required this.granted,
    required this.premium,
    required this.priceLabel,
    required this.outputCount,
    required this.busy,
    required this.onOpen,
    required this.onUnlock,
  });

  final bool granted;
  final bool premium;
  final String priceLabel;
  final int outputCount;
  final bool busy;

  final VoidCallback onOpen;
  final VoidCallback onUnlock;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(23),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.surface, AppColors.surfaceRose, Color(0xFFEAF6F3)],
        ),
        border: Border.all(
          color: granted
              ? AppColors.success.withValues(alpha: .12)
              : AppColors.primary.withValues(alpha: .12),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .05),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 43,
                height: 43,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: granted
                      ? const LinearGradient(
                          colors: [Color(0xFFE8F8F2), Color(0xFFF4FBF8)],
                        )
                      : const LinearGradient(
                          colors: [AppColors.primary, Color(0xFF4FA9A4)],
                        ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  granted
                      ? Icons.check_circle_outline_rounded
                      : Icons.auto_awesome_rounded,
                  color: granted ? AppColors.success : Colors.white,
                  size: 21,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      granted
                          ? 'ADVANCED ACCESS READY'
                          : 'ADVANCED EXECUTION LAYER',
                      style: TextStyle(
                        color: granted
                            ? AppColors.success
                            : AppColors.primaryDark,
                        fontSize: 6.7,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .72,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      granted
                          ? 'Your complete workspace is ready.'
                          : 'Unlock the complete execution package.',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.7,
                        height: 1.15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 9),

          Text(
            granted
                ? 'Open ${outputCount > 0 ? outputCount : 'all'} available advanced outputs in one accepted-idea workspace.'
                : 'Architecture, technology, feasibility, implementation and business planning are protected in the advanced package.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.8,
              height: 1.42,
            ),
          ),

          const SizedBox(height: 11),

          if (!granted)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
              decoration: BoxDecoration(
                color: AppColors.primarySoft.withValues(alpha: .58),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Row(
                children: [
                  Icon(
                    premium ? Icons.toll_rounded : Icons.credit_card_outlined,
                    size: 14,
                    color: AppColors.primaryDark,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      premium
                          ? 'Premium advanced unlock'
                          : 'One-time advanced access',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Text(
                    priceLabel,
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 8.8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 10),

          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: busy
                  ? null
                  : granted
                  ? onOpen
                  : onUnlock,
              icon: Icon(
                granted
                    ? Icons.arrow_outward_rounded
                    : premium
                    ? Icons.bolt_rounded
                    : Icons.lock_open_rounded,
                size: 15,
              ),
              label: Text(
                busy
                    ? 'Processing...'
                    : granted
                    ? 'Open accepted workspace'
                    : premium
                    ? 'Unlock · $priceLabel'
                    : 'Pay · $priceLabel',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(43),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
                textStyle: const TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OwnerPublicationCard extends StatelessWidget {
  const _OwnerPublicationCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .60),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .06)),
      ),
      child: const Row(
        children: [
          SoftIconBadge(icon: Icons.person_outline_rounded, size: 36),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'This is your publication. Community users see the protected acceptance flow here.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 8.8,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PremiumOpeningCard extends StatelessWidget {
  const _PremiumOpeningCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primarySoft, AppColors.surfaceRose],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primary.withValues(alpha: .09)),
      ),
      child: const Row(
        children: [
          SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primary,
            ),
          ),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Opening your Premium basic brief',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Premium acceptance is being verified in the background.',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 7.8),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AcceptancePausedCard extends StatelessWidget {
  const _AcceptancePausedCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.surfaceRose,
        borderRadius: BorderRadius.circular(19),
        border: Border.all(color: AppColors.pink.withValues(alpha: .10)),
      ),
      child: const Row(
        children: [
          SoftIconBadge(icon: Icons.shield_outlined, rose: true, size: 38),
          SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Acceptance paused by publisher',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.3,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 3),
                Text(
                  'This idea is currently open for discovery only. Existing accepted users keep their access.',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8,
                    height: 1.38,
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

class _ModalHeader extends StatelessWidget {
  const _ModalHeader({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SoftIconBadge(icon: icon, size: 42),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 6.7,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .68,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 14.5,
                  height: 1.15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                message,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.3,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ReportPublicationSheet extends StatefulWidget {
  const _ReportPublicationSheet();

  @override
  State<_ReportPublicationSheet> createState() =>
      _ReportPublicationSheetState();
}

class _ReportPublicationSheetState extends State<_ReportPublicationSheet> {
  static const _reasons = <_ReportReasonOption>[
    _ReportReasonOption(
      value: 'MISLEADING',
      label: 'Misleading',
      helper: 'Claims or context may be inaccurate.',
      icon: Icons.fact_check_outlined,
    ),
    _ReportReasonOption(
      value: 'SPAM',
      label: 'Spam',
      helper: 'Promotional, repetitive, or manipulative.',
      icon: Icons.mark_email_unread_outlined,
    ),
    _ReportReasonOption(
      value: 'OFFENSIVE',
      label: 'Offensive',
      helper: 'Abusive or inappropriate content.',
      icon: Icons.sentiment_dissatisfied_outlined,
    ),
    _ReportReasonOption(
      value: 'COPYRIGHT',
      label: 'Copyright',
      helper: 'Possible ownership or copying concern.',
      icon: Icons.copyright_rounded,
    ),
    _ReportReasonOption(
      value: 'PRIVACY',
      label: 'Privacy',
      helper: 'Personal or sensitive information exposed.',
      icon: Icons.privacy_tip_outlined,
    ),
    _ReportReasonOption(
      value: 'OTHER',
      label: 'Other',
      helper: 'Something else needs moderation review.',
      icon: Icons.more_horiz_rounded,
    ),
  ];

  final TextEditingController _details = TextEditingController();

  String _reason = 'MISLEADING';

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  void _submit() {
    final details = _details.text.trim();

    if (details.isNotEmpty && details.length < 5) {
      showAppSnackBar(
        context,
        'Add at least 5 characters or leave details empty.',
        error: true,
      );
      return;
    }

    Navigator.of(
      context,
    ).pop((reason: _reason, details: details.isEmpty ? null : details));
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SafeArea(
        top: false,
        child: Container(
          margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * .88,
          ),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                AppColors.surfaceRose,
                Color(0xFFF1F9F7),
              ],
            ),
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: Colors.white),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .15),
                blurRadius: 36,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(15, 10, 15, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.silver,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),

                const SizedBox(height: 13),

                const _ModalHeader(
                  icon: Icons.outlined_flag_rounded,
                  eyebrow: 'TRUST & SAFETY',
                  title: 'What should we review?',
                  message:
                      'Your report is private. Choose the closest reason and add context only when useful.',
                ),

                const SizedBox(height: 14),

                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = (constraints.maxWidth - 7) / 2;

                    return Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: _reasons
                          .map(
                            (option) => SizedBox(
                              width: width,
                              child: _ReportReasonCard(
                                option: option,
                                selected: _reason == option.value,
                                onTap: () {
                                  setState(() => _reason = option.value);
                                },
                              ),
                            ),
                          )
                          .toList(),
                    );
                  },
                ),

                const SizedBox(height: 13),

                const Text(
                  'ADDITIONAL DETAILS',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 6.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .66,
                  ),
                ),

                const SizedBox(height: 6),

                TextField(
                  controller: _details,
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: InputDecoration(
                    hintText:
                        'Add anything that would help the moderation team understand the issue...',
                    alignLabelWithHint: true,
                    filled: true,
                    fillColor: Colors.white.withValues(alpha: .74),
                    counterStyle: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 7,
                    ),
                  ),
                ),

                const SizedBox(height: 5),

                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _submit,
                    icon: const Icon(Icons.shield_outlined, size: 14),
                    label: const Text('Send private report'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                      backgroundColor: AppColors.pinkDeep,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
                      ),
                      textStyle: const TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 7),

                const Center(
                  child: Text(
                    'The publisher is not shown who submitted the report.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textMuted, fontSize: 7.2),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReportReasonOption {
  const _ReportReasonOption({
    required this.value,
    required this.label,
    required this.helper,
    required this.icon,
  });

  final String value;
  final String label;
  final String helper;
  final IconData icon;
}

class _ReportReasonCard extends StatelessWidget {
  const _ReportReasonCard({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final _ReportReasonOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          constraints: const BoxConstraints(minHeight: 88),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            gradient: selected
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFFFF2F5), Color(0xFFEAF6F3)],
                  )
                : null,
            color: selected ? null : Colors.white.withValues(alpha: .68),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? AppColors.pink.withValues(alpha: .30)
                  : AppColors.primaryDark.withValues(alpha: .055),
              width: selected ? 1.2 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppColors.pinkDeep.withValues(alpha: .07),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected
                          ? AppColors.pinkSoft
                          : AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Icon(
                      option.icon,
                      size: 14,
                      color: selected
                          ? AppColors.pinkDeep
                          : AppColors.primaryDark,
                    ),
                  ),
                  const Spacer(),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    width: 18,
                    height: 18,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: selected ? AppColors.primary : Colors.transparent,
                      border: Border.all(
                        color: selected ? AppColors.primary : AppColors.silver,
                      ),
                    ),
                    child: selected
                        ? const Icon(
                            Icons.check_rounded,
                            color: Colors.white,
                            size: 11,
                          )
                        : null,
                  ),
                ],
              ),
              const SizedBox(height: 7),
              Text(
                option.label,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 9.2,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                option.helper,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.8,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RichPublicContent extends StatelessWidget {
  const _RichPublicContent({
    required this.value,
    this.fallback = '',
    this.maxLines,
    this.compact = false,
  });

  final dynamic value;
  final String fallback;
  final int? maxLines;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final items = _contentItems(value);

    if (items.isEmpty) {
      return Text(
        fallback,
        style: TextStyle(
          color: AppColors.textSecondary,
          fontSize: compact ? 9.5 : 9.2,
          height: 1.48,
        ),
      );
    }

    if (items.length == 1) {
      return Text(
        items.first,
        maxLines: maxLines,
        overflow: maxLines == null
            ? TextOverflow.visible
            : TextOverflow.ellipsis,
        style: TextStyle(
          color: AppColors.textSecondary,
          fontSize: compact ? 9.7 : 9.3,
          height: 1.5,
        ),
      );
    }

    final visibleItems = maxLines == null
        ? items
        : items.take(math.min(items.length, 4)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: visibleItems
          .map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(
                      Icons.check_circle_outline_rounded,
                      size: 13,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item,
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: compact ? 9.4 : 9.1,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _Reveal extends StatelessWidget {
  const _Reveal({required this.child, required this.delay});

  final Widget child;
  final int delay;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: Duration(milliseconds: 500 + delay),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        final normalized = ((value * (500 + delay) - delay) / 500).clamp(
          0.0,
          1.0,
        );

        return Opacity(
          opacity: normalized,
          child: Transform.translate(
            offset: Offset(0, 16 * (1 - normalized)),
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}

List<String> _contentItems(dynamic value) {
  if (value == null) return const [];

  if (value is List) {
    return value
        .map((item) => item?.toString().trim() ?? '')
        .where((item) => item.isNotEmpty)
        .toList();
  }

  if (value is Map) {
    return value.entries
        .map((entry) => '${_humanize(entry.key.toString())}: ${entry.value}')
        .where((item) => item.trim().isNotEmpty)
        .toList();
  }

  final raw = value.toString().trim();

  if (raw.isEmpty) return const [];

  // Common backend values can arrive as JSON-like lists or delimited text.
  final cleaned = raw
      .replaceAll(RegExp(r'^\s*\['), '')
      .replaceAll(RegExp(r'\]\s*$'), '')
      .replaceAll('"', '');

  final parts = cleaned
      .split(RegExp(r'\r?\n|(?:^|\s)[•*-]\s+|;(?=\s*[A-Z])'))
      .map((item) => item.trim())
      .where((item) => item.isNotEmpty)
      .toList();

  return parts.isEmpty ? [raw] : parts;
}

String _initials(String value) {
  final parts = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .take(2)
      .toList();

  if (parts.isEmpty) return 'VX';

  return parts.map((part) => part[0]).join().toUpperCase();
}

String _humanize(String value) {
  return value
      .replaceAll(RegExp(r'[-_]+'), ' ')
      .replaceAllMapped(
        RegExp(r'([a-z0-9])([A-Z])'),
        (match) => '${match[1]} ${match[2]}',
      );
}

class _PublicationLoadingState extends StatefulWidget {
  const _PublicationLoadingState();

  @override
  State<_PublicationLoadingState> createState() =>
      _PublicationLoadingStateState();
}

class _PublicationLoadingStateState extends State<_PublicationLoadingState>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final wave = (math.sin(_controller.value * math.pi * 2) + 1) / 2;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 15),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFFFFFDFC),
                    Color(0xFFF3FAF8),
                    Color(0xFFFFF7F9),
                  ],
                ),
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: .10),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: .05),
                    blurRadius: 22,
                    offset: const Offset(0, 9),
                  ),
                ],
              ),
              child: Row(
                children: [
                  SizedBox(
                    width: 54,
                    height: 54,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        Container(
                          width: 48 + (wave * 4),
                          height: 48 + (wave * 4),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppColors.primarySoft.withValues(
                              alpha: .58 + (wave * .18),
                            ),
                            border: Border.all(
                              color: AppColors.primary.withValues(alpha: .12),
                            ),
                          ),
                        ),
                        Transform.rotate(
                          angle: _controller.value * math.pi * 2,
                          child: const Icon(
                            Icons.auto_awesome_rounded,
                            color: AppColors.primaryDark,
                            size: 23,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Reading community signals',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.2,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Bringing the opportunity, creator context and engagement together.',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.9,
                            height: 1.42,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: List.generate(3, (index) {
                            final phase = (_controller.value + index * .18) *
                                math.pi *
                                2;
                            final value = (math.sin(phase) + 1) / 2;

                            return Container(
                              width: 17 + (value * 8),
                              height: 4.5,
                              margin: const EdgeInsets.only(right: 5),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(99),
                                color: index == 1
                                    ? AppColors.pink.withValues(
                                        alpha: .20 + (value * .28),
                                      )
                                    : AppColors.primary.withValues(
                                        alpha: .28 + (value * .38),
                                      ),
                              ),
                            );
                          }),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 13),
            const _PublicationLoadingCard(
              icon: Icons.campaign_outlined,
              titleWidth: .74,
              lines: [.94, .86, .66],
              height: 154,
            ),
            const SizedBox(height: 11),
            const _PublicationLoadingCard(
              icon: Icons.groups_2_outlined,
              titleWidth: .58,
              lines: [.88, .70],
              height: 118,
            ),
            const SizedBox(height: 11),
            const _PublicationLoadingCard(
              icon: Icons.insights_outlined,
              titleWidth: .64,
              lines: [.92, .77, .52],
              height: 134,
            ),
          ],
        );
      },
    );
  }
}

class _PublicationLoadingCard extends StatelessWidget {
  const _PublicationLoadingCard({
    required this.icon,
    required this.titleWidth,
    required this.lines,
    required this.height,
  });

  final IconData icon;
  final double titleWidth;
  final List<double> lines;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: height,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .82),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 31,
                height: 31,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  icon,
                  size: 15,
                  color: AppColors.primaryDark.withValues(alpha: .66),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: titleWidth,
                  child: const _PublicationLoadingBar(height: 9),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ...lines.map(
            (width) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: width,
                child: const _PublicationLoadingBar(height: 7),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PublicationLoadingBar extends StatelessWidget {
  const _PublicationLoadingBar({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.mint.withValues(alpha: .52),
            AppColors.primarySoft.withValues(alpha: .78),
            AppColors.surfaceRose.withValues(alpha: .54),
          ],
        ),
        borderRadius: BorderRadius.circular(99),
      ),
    );
  }
}

