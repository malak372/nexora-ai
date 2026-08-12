// Mobile workspace for ideas accepted from Discover.
// Supports permanent advanced access, Premium chat, and Business Model.
//
// @author  Malak

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'business_model_page.dart';
import 'premium_chat_page.dart';

class AcceptedIdeaWorkspacePage extends StatefulWidget {
  const AcceptedIdeaWorkspacePage({
    super.key,
    required this.publicationId,
  });

  final String publicationId;

  @override
  State<AcceptedIdeaWorkspacePage> createState() =>
      _AcceptedIdeaWorkspacePageState();
}

class _AcceptedIdeaWorkspacePageState
    extends State<AcceptedIdeaWorkspacePage> {
  Map<String, dynamic>? _detail;
  Object? _error;
  bool _loading = true;
  bool _unlocking = false;

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
      final detail = await UserApi.instance.getDiscovery(
        widget.publicationId,
        force: force,
      );
      if (!mounted) return;
      setState(() => _detail = detail);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _unlockAdvanced() async {
    if (_unlocking) return;
    setState(() => _unlocking = true);
    try {
      if (UserSessionController.instance.isPremium) {
        await UserApi.instance.unlockAcceptedAdvancedWithCredits(
          widget.publicationId,
        );
        await Future.wait([
          _load(force: true),
          UserSessionController.instance.load(force: true),
        ]);
        if (mounted) {
          showAppSnackBar(context, 'Advanced accepted workspace unlocked.');
        }
        return;
      }

      final result = await UserApi.instance.createAcceptedAdvancedCheckout(
        widget.publicationId,
      );
      final payment = result['payment'] is Map
          ? Map<String, dynamic>.from(result['payment'] as Map)
          : const <String, dynamic>{};
      final checkoutUrl = result['checkoutUrl']?.toString() ??
          payment['checkoutUrl']?.toString() ??
          result['url']?.toString();
      if (checkoutUrl == null || checkoutUrl.isEmpty) {
        throw const ApiException(
          'The payment provider did not return a checkout URL.',
        );
      }
      final uri = Uri.tryParse(checkoutUrl);
      if (uri == null ||
          !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw const ApiException('The secure checkout could not be opened.');
      }
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _unlocking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail ?? const <String, dynamic>{};
    final acceptance = detail['acceptance'] is Map
        ? Map<String, dynamic>.from(detail['acceptance'] as Map)
        : const <String, dynamic>{};
    final outputs = detail['advancedOutputs'] is List
        ? detail['advancedOutputs'] as List
        : const [];
    final businessModel = detail['businessModel'] is Map
        ? Map<String, dynamic>.from(detail['businessModel'] as Map)
        : const <String, dynamic>{};
    final sourceIdeaId = detail['ideaId']?.toString();
    final advancedGranted = detail['advancedAccessGranted'] == true ||
        acceptance['advancedUnlockedAt'] != null;
    final hasAdvanced = detail['hasAdvancedAccess'] == true ||
        (advancedGranted && outputs.isNotEmpty);
    final advancedAvailable = detail['advancedOutputsAvailable'] != false &&
        ((detail['advancedOutputsCount'] as num?)?.toInt() ?? outputs.length) > 0;
    final premium = UserSessionController.instance.isPremium;

    return Scaffold(
      appBar: AppBar(
        leadingWidth: 50,
        leading: IconButton(
          tooltip: 'Back to Publication',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(
            Icons.arrow_back_rounded,
            size: 22,
          ),
        ),
        titleSpacing: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Publication',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              'Accepted workspace',
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
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 42),
            children: [
              if (_loading)
                const LoadingList(count: 4)
              else if (_error != null)
                EmptyState(
                  icon: Icons.cloud_off_rounded,
                  title: 'Accepted workspace unavailable',
                  message: _error.toString(),
                  action: FilledButton(
                    onPressed: () => _load(force: true),
                    child: const Text('Retry'),
                  ),
                )
              else ...[
                _AcceptedWorkspaceHeader(
                  title: '${detail['publicTitle'] ?? 'Accepted idea'}',
                  publisherLine: _publisherLine(detail),
                  hasAdvanced: hasAdvanced,
                ),

                if (hasAdvanced && sourceIdeaId != null) ...[
                  const SizedBox(height: 12),
                  const _WorkspaceToolsHeading(),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: _AcceptedAction(
                          icon: Icons.dashboard_customize_outlined,
                          eyebrow: 'PLAN',
                          title: 'Business model',
                          subtitle: businessModel.isEmpty
                              ? 'Create the business layer'
                              : 'Open your current model',
                          rose: false,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => BusinessModelPage(
                                ideaId: sourceIdeaId,
                                publicationId: widget.publicationId,
                                ideaTitle:
                                    detail['publicTitle']?.toString() ??
                                    detail['title']?.toString(),
                              ),
                            ),
                          ),
                        ),
                      ),
                      if (premium) ...[
                        const SizedBox(width: 8),
                        Expanded(
                          child: _AcceptedAction(
                            icon: Icons.forum_outlined,
                            eyebrow: 'PREMIUM',
                            title: 'AI Chat',
                            subtitle: 'Ask about this idea',
                            rose: true,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => PremiumChatPage(
                                  ideaId: sourceIdeaId,
                                  returnTitle: 'Accepted workspace',
                                  returnSubtitle: 'Premium AI Chat',
                                  contextLabel: 'Accepted idea workspace',
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],

                const SizedBox(height: 14),
                if (_text(detail['publicAbstract']).isNotEmpty)
                  _SectionCard(
                    number: '01',
                    title: 'Overview',
                    value: detail['publicAbstract'],
                    icon: Icons.description_outlined,
                  ),
                if (_hasContent(detail['publicProblem'])) ...[
                  const SizedBox(height: 10),
                  _SectionCard(
                    number: '02',
                    title: 'Problem overview',
                    value: detail['publicProblem'],
                    icon: Icons.layers_outlined,
                  ),
                ],
                if (_hasContent(detail['publicObjectives'])) ...[
                  const SizedBox(height: 10),
                  _SectionCard(
                    number: '03',
                    title: 'Objectives',
                    value: detail['publicObjectives'],
                    icon: Icons.flag_outlined,
                    rose: true,
                  ),
                ],
                if (_hasContent(detail['publicTargetUsers'])) ...[
                  const SizedBox(height: 10),
                  _SectionCard(
                    number: '04',
                    title: 'Target users',
                    value: detail['publicTargetUsers'],
                    icon: Icons.groups_outlined,
                  ),
                ],
                const SizedBox(height: 18),
                SectionHeading(
                  title: 'Advanced package',
                  subtitle: hasAdvanced
                      ? '${outputs.length} execution section(s) available permanently.'
                      : advancedAvailable
                          ? 'Unlock the protected execution outputs for this accepted idea.'
                          : 'The publisher has no completed advanced outputs for this idea.',
                ),
                const SizedBox(height: 10),
                if (!advancedGranted && advancedAvailable)
                  VoxCard(
                    tint: AppColors.primarySoft.withValues(alpha: .82),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.lock_outline_rounded,
                          size: 31,
                          color: AppColors.primaryDark,
                        ),
                        const SizedBox(height: 9),
                        Text(
                          premium
                              ? 'Unlock with Premium credits'
                              : 'Unlock advanced accepted access',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 5),
                        Text(
                          premium
                              ? 'Your current balance is checked before the configured credit cost is deducted once for this accepted idea.'
                              : 'Use secure provider-hosted checkout. Advanced access activates only after verified payment.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 13),
                        FilledButton.icon(
                          onPressed: _unlocking ? null : _unlockAdvanced,
                          icon: Icon(
                            premium ? Icons.bolt_rounded : Icons.lock_outline_rounded,
                          ),
                          label: Text(
                            _unlocking
                                ? 'Opening...'
                                : premium
                                    ? 'Unlock with credits'
                                    : 'Open secure checkout',
                          ),
                        ),
                      ],
                    ),
                  )
                else if (!advancedAvailable)
                  const EmptyState(
                    icon: Icons.layers_clear_outlined,
                    title: 'No advanced package',
                    message:
                        'This accepted publication does not currently contain completed advanced outputs.',
                  )
                else if (outputs.isEmpty)
                  const EmptyState(
                    icon: Icons.sync_rounded,
                    title: 'Advanced access is active',
                    message:
                        'Pull down to refresh the protected output package from the server.',
                  )
                else
                  ...List.generate(outputs.length, (index) {
                    final raw = outputs[index];
                    final output = raw is Map
                        ? Map<String, dynamic>.from(raw)
                        : const <String, dynamic>{};
                    final value = output['structuredContent'] ?? output['content'];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _AcceptedAdvancedOutputCard(
                        number: (index + 1).toString().padLeft(2, '0'),
                        title: '${output['title'] ?? _humanize('${output['outputKey'] ?? 'Advanced output'}')}',
                        value: value,
                      ),
                    );
                  }),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _publisherLine(Map<String, dynamic> detail) {
    final publisher = detail['publisher'] is Map
        ? Map<String, dynamic>.from(detail['publisher'] as Map)
        : const <String, dynamic>{};
    final name = publisher['fullName']?.toString();
    final acceptedAt = detail['acceptance'] is Map
        ? (detail['acceptance'] as Map)['acceptedAt']?.toString()
        : null;
    final date = acceptedAt == null ? null : DateTime.tryParse(acceptedAt);
    final dateText = date == null
        ? null
        : '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
    return [
      if (name != null && name.trim().isNotEmpty) 'Published by $name',
      if (dateText != null) 'Accepted $dateText',
    ].join(' · ');
  }

  static bool _hasContent(dynamic value) {
    if (value == null) return false;
    if (value is String) return value.trim().isNotEmpty;
    if (value is List) return value.isNotEmpty;
    if (value is Map) return value.isNotEmpty;
    return true;
  }

  static String _text(dynamic value) => value?.toString().trim() ?? '';

  static String _humanize(String value) {
    return value
        .replaceAll(RegExp(r'[-_]+'), ' ')
        .replaceAllMapped(
          RegExp(r'([a-z0-9])([A-Z])'),
          (match) => '${match[1]} ${match[2]}',
        );
  }
}

class _AcceptedWorkspaceHeader extends StatelessWidget {
  const _AcceptedWorkspaceHeader({
    required this.title,
    required this.publisherLine,
    required this.hasAdvanced,
  });

  final String title;
  final String publisherLine;
  final bool hasAdvanced;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        13,
        12,
        13,
        13,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            AppColors.surfaceRose,
            Color(0xFFF0F8F5),
          ],
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .065),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF8F2),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.handshake_outlined,
                      size: 10.5,
                      color: AppColors.success,
                    ),
                    SizedBox(width: 4),
                    Text(
                      'ACCEPTED IDEA',
                      style: TextStyle(
                        color: AppColors.success,
                        fontSize: 6.3,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .55,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              if (hasAdvanced)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.lock_open_rounded,
                        size: 10,
                        color: AppColors.primaryDark,
                      ),
                      SizedBox(width: 4),
                      Text(
                        'ADVANCED',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 6.2,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .52,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 9),
          Text(
            title,
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(
                  fontSize: 19.5,
                  height: 1.08,
                  letterSpacing: -.36,
                ),
          ),
          if (publisherLine.trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(
                  Icons.verified_outlined,
                  size: 12,
                  color: AppColors.primary,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    publisherLine,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.4,
                      height: 1.3,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _WorkspaceToolsHeading extends StatelessWidget {
  const _WorkspaceToolsHeading();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        Icon(
          Icons.auto_awesome_rounded,
          size: 11,
          color: AppColors.primaryDark,
        ),
        SizedBox(width: 5),
        Text(
          'WORKSPACE TOOLS',
          style: TextStyle(
            color: AppColors.primaryDark,
            fontSize: 6.4,
            fontWeight: FontWeight.w900,
            letterSpacing: .66,
          ),
        ),
      ],
    );
  }
}

class _AcceptedAction extends StatelessWidget {
  const _AcceptedAction({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.rose = false,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent =
        rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: 92,
          ),
          child: Ink(
            padding: const EdgeInsets.fromLTRB(
              10,
              10,
              9,
              10,
            ),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: rose
                    ? const [
                        AppColors.surface,
                        AppColors.surfaceRose,
                      ]
                    : const [
                        AppColors.surface,
                        Color(0xFFF0F8F5),
                      ],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: accent.withValues(alpha: .09),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .035),
                  blurRadius: 14,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 33,
                      height: 33,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: rose
                            ? AppColors.pinkSoft
                            : AppColors.primarySoft,
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Icon(
                        icon,
                        size: 16,
                        color: accent,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      width: 25,
                      height: 25,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .72),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.arrow_outward_rounded,
                        size: 12,
                        color: accent,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  eyebrow,
                  style: TextStyle(
                    color: accent,
                    fontSize: 5.8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .62,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w900,
                    fontSize: 10.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.2,
                    height: 1.25,
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



class _SectionCard extends StatelessWidget {
  const _SectionCard({
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
    final accent =
        rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        13,
        12,
        13,
        13,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: rose
              ? const [
                  AppColors.surface,
                  AppColors.surfaceRose,
                ]
              : const [
                  AppColors.surface,
                  Color(0xFFF2F9F7),
                ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: accent.withValues(alpha: .07),
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
                color: accent.withValues(alpha: .065),
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
                  Container(
                    width: 34,
                    height: 34,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: rose
                          ? AppColors.pinkSoft
                          : AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(
                      icon,
                      size: 16,
                      color: accent,
                    ),
                  ),
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
              _AcceptedContent(value: value),
            ],
          ),
        ],
      ),
    );
  }
}




class _AcceptedAdvancedOutputCard extends StatelessWidget {
  const _AcceptedAdvancedOutputCard({
    required this.number,
    required this.title,
    required this.value,
  });

  final String number;
  final String title;
  final dynamic value;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            Color(0xFFF2F9F7),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .07),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .03),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Theme(
        data: Theme.of(context).copyWith(
          dividerColor: Colors.transparent,
          splashColor: Colors.transparent,
          highlightColor: Colors.transparent,
        ),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.fromLTRB(12, 7, 10, 7),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          leading: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Text(
              number,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          title: Text(
            title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 11.2,
              fontWeight: FontWeight.w900,
            ),
          ),
          subtitle: const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text(
              'Advanced workspace output',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 6.6,
              ),
            ),
          ),
          iconColor: AppColors.primaryDark,
          collapsedIconColor: AppColors.primaryDark,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .58),
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                  color: AppColors.primaryDark.withValues(alpha: .04),
                ),
              ),
              child: _AcceptedContent(value: value),
            ),
          ],
        ),
      ),
    );
  }
}

class _AcceptedContent extends StatelessWidget {
  const _AcceptedContent({
    required this.value,
  });

  final dynamic value;

  @override
  Widget build(BuildContext context) {
    if (value is List) {
      final items = value as List;

      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: items
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
                      child: _AcceptedContent(
                        value: item,
                      ),
                    ),
                  ],
                ),
              ),
            )
            .toList(),
      );
    }

    if (value is Map) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: (value as Map)
            .entries
            .map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .58),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: AppColors.primaryDark
                          .withValues(alpha: .045),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _label('${entry.key}'),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w900,
                          fontSize: 9.2,
                        ),
                      ),
                      const SizedBox(height: 3),
                      _AcceptedContent(
                        value: entry.value,
                      ),
                    ],
                  ),
                ),
              ),
            )
            .toList(),
      );
    }

    return Text(
      value?.toString() ?? '',
      style: const TextStyle(
        color: AppColors.textSecondary,
        fontSize: 9.2,
        height: 1.48,
      ),
    );
  }

  static String _label(String value) {
    final spaced = value
        .replaceAll(RegExp(r'[-_]+'), ' ')
        .replaceAllMapped(
          RegExp(r'([a-z0-9])([A-Z])'),
          (match) => '${match[1]} ${match[2]}',
        );

    if (spaced.isEmpty) return spaced;

    return '${spaced[0].toUpperCase()}${spaced.substring(1)}';
  }
}


