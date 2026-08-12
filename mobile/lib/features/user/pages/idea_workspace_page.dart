// Voxidence mobile idea workspace.
//
// Mobile-first private workspace for an owned idea. The visual hierarchy
// intentionally matches the Accepted Workspace so both flows feel like one
// product while preserving the owned-idea actions and access rules.
//
// @author  Malak

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'business_model_page.dart';
import 'direct_unlock_page.dart';
import 'premium_chat_page.dart';
import 'publish_idea_page.dart';

class IdeaWorkspacePage extends StatefulWidget {
  const IdeaWorkspacePage({
    super.key,
    required this.ideaId,
    this.returnTitle = 'My ideas',
  });

  final String ideaId;

  /// Label displayed beside the back arrow.
  ///
  /// The default reflects the normal entry point from the idea library.
  final String returnTitle;

  @override
  State<IdeaWorkspacePage> createState() =>
      _IdeaWorkspacePageState();
}

class _IdeaWorkspacePageState
    extends State<IdeaWorkspacePage> {
  Map<String, dynamic>? _bundle;
  Object? _error;

  bool _unlocking = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({
    bool force = false,
  }) async {
    try {
      final bundle =
          await UserApi.instance.getWorkspace(
        widget.ideaId,
        force: force,
      );

      if (!mounted) return;

      setState(() {
        _bundle = bundle;
        _error = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    }
  }

  Future<void> _unlockWithCredits() async {
    if (_unlocking) return;

    setState(() => _unlocking = true);

    try {
      await UserApi.instance.unlockIdeaWithCredits(
        widget.ideaId,
      );

      await Future.wait([
        _load(force: true),
        UserSessionController.instance.load(
          force: true,
        ),
      ]);

      if (mounted) {
        showAppSnackBar(
          context,
          'Advanced outputs unlocked.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _unlocking = false);
      }
    }
  }

  Future<void> _openPublish(
    Map<String, dynamic> idea,
  ) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublishIdeaPage(
          ideaId: widget.ideaId,
          returnTitle: 'Idea workspace',
          initialIdea: idea,
        ),
      ),
    );

    if (mounted) {
      await _load(force: true);
    }
  }

  Future<void> _openBusinessModel(
    Map<String, dynamic> idea,
  ) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => BusinessModelPage(
          ideaId: widget.ideaId,
          ideaTitle: idea['title']?.toString(),
        ),
      ),
    );

    if (mounted) {
      await _load(force: true);
    }
  }

  Future<void> _openAiChat() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PremiumChatPage(
          ideaId: widget.ideaId,
          returnTitle: 'Idea workspace',
          returnSubtitle: 'Premium AI Chat',
          contextLabel: 'Own idea workspace',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bundle = _bundle;

    final idea = bundle?['idea'] is Map
        ? Map<String, dynamic>.from(
            bundle!['idea'] as Map,
          )
        : const <String, dynamic>{};

    final outputs = bundle?['outputs'] is List
        ? bundle!['outputs'] as List
        : const [];

    final access = idea['access'] is Map
        ? Map<String, dynamic>.from(
            idea['access'] as Map,
          )
        : const <String, dynamic>{};

    final canChat =
        access['canUseAiChat'] == true;

    final canPublish =
        access['canPublish'] == true;

    final unlocked =
        idea['isUnlocked'] == true;

    final premiumAccount =
        UserSessionController.instance.isPremium;

    final title =
        _text(idea['title']).isEmpty
            ? 'Untitled idea'
            : _text(idea['title']);

    final abstractValue =
        idea['fullAbstract'] ??
        idea['partialAbstract'] ??
        idea['limitedAbstract'];

    final domain = idea['domain'] is Map
        ? _text(
            (idea['domain'] as Map)['name'],
          )
        : _text(
            idea['domainName'],
          );

    final generationType = _humanize(
      _text(
        idea['generationType'],
      ).isEmpty
          ? 'Idea'
          : _text(
              idea['generationType'],
            ),
    );

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        leadingWidth: 50,
        leading: IconButton(
          tooltip: 'Back to ${widget.returnTitle}',
          onPressed: () =>
              Navigator.of(context).maybePop(),
          icon: const Icon(
            Icons.arrow_back_rounded,
            size: 22,
          ),
        ),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            Text(
              widget.returnTitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            const Text(
              'Idea workspace',
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
          onRefresh: () =>
              _load(force: true),
          child: ListView(
            physics:
                const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(
              18,
              12,
              18,
              42,
            ),
            children: [
              if (bundle == null &&
                  _error == null)
                const LoadingList(count: 4)
              else if (_error != null)
                EmptyState(
                  icon:
                      Icons.cloud_off_rounded,
                  title:
                      'Idea workspace unavailable',
                  message: _error.toString(),
                  action: FilledButton.icon(
                    onPressed: () =>
                        _load(force: true),
                    icon: const Icon(
                      Icons.refresh_rounded,
                      size: 15,
                    ),
                    label: const Text('Retry'),
                  ),
                )
              else ...[
                _IdeaWorkspaceHeader(
                  title: title,
                  generationType:
                      generationType,
                  domain: domain.isEmpty
                      ? 'General innovation'
                      : domain,
                  createdAt:
                      _workspaceDate(
                    idea['createdAt'],
                  ),
                  unlocked: unlocked,
                  premiumAccount:
                      premiumAccount,
                ),

                const SizedBox(height: 12),

                const _WorkspaceToolsHeading(),

                const SizedBox(height: 8),

                Row(
                  children: [
                    Expanded(
                      child:
                          _WorkspaceToolAction(
                        icon:
                            Icons.public_rounded,
                        eyebrow: 'SHARE',
                        title: 'Publish',
                        subtitle: canPublish
                            ? 'Create a safe public snapshot'
                            : 'Publishing is unavailable',
                        onTap: canPublish
                            ? () => _openPublish(
                                  idea,
                                )
                            : null,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child:
                          _WorkspaceToolAction(
                        icon: Icons
                            .dashboard_customize_outlined,
                        eyebrow: 'PLAN',
                        title: 'Business model',
                        subtitle: unlocked
                            ? 'Open the business studio'
                            : 'Unlock advanced access first',
                        onTap: unlocked
                            ? () =>
                                _openBusinessModel(
                                  idea,
                                )
                            : null,
                        rose: true,
                      ),
                    ),
                  ],
                ),

                if (canChat) ...[
                  const SizedBox(height: 8),
                  _WorkspaceToolAction(
                    icon:
                        Icons.forum_outlined,
                    eyebrow:
                        'PREMIUM INTELLIGENCE',
                    title: 'AI Chat',
                    subtitle:
                        'Ask questions about this idea in real time',
                    onTap: _openAiChat,
                    fullWidth: true,
                  ),
                ],

                const SizedBox(height: 14),

                if (_hasContent(
                  abstractValue,
                ))
                  _WorkspaceSectionCard(
                    number: '01',
                    title: 'Overview',
                    value: abstractValue,
                    icon:
                        Icons.description_outlined,
                  ),

                if (_hasContent(
                  idea['problemStatement'],
                )) ...[
                  const SizedBox(height: 10),
                  _WorkspaceSectionCard(
                    number: '02',
                    title:
                        'Problem overview',
                    value:
                        idea['problemStatement'],
                    icon:
                        Icons.layers_outlined,
                  ),
                ],

                if (_hasContent(
                  idea['objectives'],
                )) ...[
                  const SizedBox(height: 10),
                  _WorkspaceSectionCard(
                    number: '03',
                    title: 'Objectives',
                    value:
                        idea['objectives'],
                    icon:
                        Icons.flag_outlined,
                    rose: true,
                  ),
                ],

                if (_hasContent(
                  idea['targetUsers'],
                )) ...[
                  const SizedBox(height: 10),
                  _WorkspaceSectionCard(
                    number: '04',
                    title: 'Target users',
                    value:
                        idea['targetUsers'],
                    icon:
                        Icons.groups_outlined,
                  ),
                ],

                const SizedBox(height: 18),

                _AdvancedPackageHeading(
                  unlocked: unlocked,
                  outputCount:
                      outputs.length,
                ),

                const SizedBox(height: 9),

                if (!unlocked)
                  _LockedAdvancedPanel(
                    premiumAccount:
                        premiumAccount,
                    unlocking: _unlocking,
                    onUnlock:
                        premiumAccount
                            ? _unlockWithCredits
                            : () async {
                                await Navigator.of(
                                  context,
                                ).push(
                                  MaterialPageRoute<
                                      void>(
                                    builder: (_) =>
                                        DirectUnlockPage(
                                      ideaId:
                                          widget
                                              .ideaId,
                                    ),
                                  ),
                                );

                                if (mounted) {
                                  await _load(
                                    force: true,
                                  );
                                }
                              },
                  )
                else if (outputs.isEmpty)
                  const EmptyState(
                    icon:
                        Icons.layers_outlined,
                    title:
                        'No outputs available',
                    message:
                        'The idea is unlocked but no completed advanced outputs were returned.',
                  )
                else
                  ...List.generate(
                    outputs.length,
                    (index) {
                      final raw =
                          outputs[index];

                      final output =
                          raw is Map
                              ? Map<
                                  String,
                                  dynamic>.from(
                                  raw,
                                )
                              : const <
                                  String,
                                  dynamic>{};

                      final content =
                          output['content'] ??
                          output[
                              'structuredContent'];

                      final outputTitle =
                          _text(
                            output['title'],
                          ).isNotEmpty
                              ? _text(
                                  output[
                                      'title'],
                                )
                              : _humanize(
                                  _text(
                                    output[
                                        'outputKey'],
                                  ).isEmpty
                                      ? 'Advanced output'
                                      : _text(
                                          output[
                                              'outputKey'],
                                        ),
                                );

                      return Padding(
                        padding:
                            const EdgeInsets.only(
                          bottom: 9,
                        ),
                        child:
                            _AdvancedOutputCard(
                          number:
                              (index + 1)
                                  .toString()
                                  .padLeft(
                                    2,
                                    '0',
                                  ),
                          title:
                              outputTitle,
                          value: content,
                          rose: false,
                        ),
                      );
                    },
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _IdeaWorkspaceHeader
    extends StatelessWidget {
  const _IdeaWorkspaceHeader({
    required this.title,
    required this.generationType,
    required this.domain,
    required this.createdAt,
    required this.unlocked,
    required this.premiumAccount,
  });

  final String title;
  final String generationType;
  final String domain;
  final String createdAt;
  final bool unlocked;
  final bool premiumAccount;

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
          color: AppColors.primaryDark
              .withValues(alpha: .065),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep
                .withValues(alpha: .035),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -4,
            top: -12,
            child: Icon(
              Icons.auto_awesome_rounded,
              size: 75,
              color: AppColors.primaryDark
                  .withValues(alpha: .025),
            ),
          ),
          Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _HeaderBadge(
                    icon: Icons
                        .auto_awesome_rounded,
                    label: generationType
                        .toUpperCase(),
                    accent:
                        AppColors.primaryDark,
                    tint:
                        AppColors.primarySoft,
                  ),
                  const Spacer(),
                  _HeaderBadge(
                    icon: unlocked
                        ? Icons
                            .lock_open_rounded
                        : Icons
                            .lock_outline_rounded,
                    label: unlocked
                        ? 'ADVANCED'
                        : 'NORMAL',
                    accent: unlocked
                        ? AppColors.success
                        : AppColors
                            .primaryDark,
                    tint: unlocked
                        ? const Color(
                            0xFFEAF8F2,
                          )
                        : AppColors
                            .primarySoft,
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
                      letterSpacing:
                          -.36,
                    ),
              ),

              const SizedBox(height: 8),

              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _HeaderMeta(
                    icon:
                        Icons.grid_view_rounded,
                    label: domain,
                  ),
                  _HeaderMeta(
                    icon: Icons
                        .calendar_today_outlined,
                    label: createdAt,
                    rose: true,
                  ),
                  if (premiumAccount)
                    const _HeaderMeta(
                      icon: Icons
                          .auto_awesome_rounded,
                      label:
                          'Premium workspace',
                    ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeaderBadge extends StatelessWidget {
  const _HeaderBadge({
    required this.icon,
    required this.label,
    required this.accent,
    required this.tint,
  });

  final IconData icon;
  final String label;
  final Color accent;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: tint,
        borderRadius:
            BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10.5,
            color: accent,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: accent,
              fontSize: 6.2,
              fontWeight: FontWeight.w900,
              letterSpacing: .52,
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderMeta extends StatelessWidget {
  const _HeaderMeta({
    required this.icon,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Container(
      height: 28,
      constraints:
          const BoxConstraints(
        maxWidth: 180,
      ),
      padding:
          const EdgeInsets.symmetric(
        horizontal: 8,
      ),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.pinkSoft
                .withValues(alpha: .70)
            : Colors.white
                .withValues(alpha: .62),
        borderRadius:
            BorderRadius.circular(999),
        border: Border.all(
          color: accent
              .withValues(alpha: .05),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10.5,
            color: accent,
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow:
                  TextOverflow.ellipsis,
              style: TextStyle(
                color: accent,
                fontSize: 6.6,
                fontWeight:
                    FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkspaceToolsHeading
    extends StatelessWidget {
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

class _WorkspaceToolAction
    extends StatelessWidget {
  const _WorkspaceToolAction({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.rose = false,
    this.fullWidth = false,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  final bool rose;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;

    final accent = !enabled
        ? AppColors.textMuted
        : rose
            ? AppColors.pinkDeep
            : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(18),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight:
                fullWidth ? 76 : 94,
          ),
          child: Ink(
            width: fullWidth
                ? double.infinity
                : null,
            padding:
                const EdgeInsets.fromLTRB(
              10,
              10,
              9,
              10,
            ),
            decoration: BoxDecoration(
              gradient: enabled
                  ? LinearGradient(
                      begin:
                          Alignment.topLeft,
                      end: Alignment
                          .bottomRight,
                      colors: rose
                          ? const [
                              AppColors
                                  .surface,
                              AppColors
                                  .surfaceRose,
                            ]
                          : const [
                              AppColors
                                  .surface,
                              Color(
                                0xFFF0F8F5,
                              ),
                            ],
                    )
                  : null,
              color: enabled
                  ? null
                  : AppColors.surfaceMuted
                      .withValues(
                      alpha: .70,
                    ),
              borderRadius:
                  BorderRadius.circular(18),
              border: Border.all(
                color: enabled
                    ? accent.withValues(
                        alpha: .09,
                      )
                    : AppColors.silver
                        .withValues(
                          alpha: .25,
                        ),
              ),
              boxShadow: enabled
                  ? [
                      BoxShadow(
                        color: AppColors
                            .primaryDeep
                            .withValues(
                          alpha: .035,
                        ),
                        blurRadius: 14,
                        offset:
                            const Offset(
                          0,
                          5,
                        ),
                      ),
                    ]
                  : null,
            ),
            child: fullWidth
                ? Row(
                    children: [
                      _ToolIcon(
                        icon: icon,
                        accent: accent,
                        rose: rose,
                        enabled:
                            enabled,
                      ),
                      const SizedBox(
                        width: 9,
                      ),
                      Expanded(
                        child: _ToolText(
                          eyebrow:
                              eyebrow,
                          title: title,
                          subtitle:
                              subtitle,
                          accent:
                              accent,
                          enabled:
                              enabled,
                        ),
                      ),
                      _ToolArrow(
                        accent: accent,
                        enabled:
                            enabled,
                      ),
                    ],
                  )
                : Column(
                    crossAxisAlignment:
                        CrossAxisAlignment
                            .start,
                    children: [
                      Row(
                        children: [
                          _ToolIcon(
                            icon: icon,
                            accent:
                                accent,
                            rose: rose,
                            enabled:
                                enabled,
                          ),
                          const Spacer(),
                          _ToolArrow(
                            accent:
                                accent,
                            enabled:
                                enabled,
                          ),
                        ],
                      ),
                      const SizedBox(
                        height: 8,
                      ),
                      _ToolText(
                        eyebrow:
                            eyebrow,
                        title: title,
                        subtitle:
                            subtitle,
                        accent: accent,
                        enabled:
                            enabled,
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _ToolIcon extends StatelessWidget {
  const _ToolIcon({
    required this.icon,
    required this.accent,
    required this.rose,
    required this.enabled,
  });

  final IconData icon;
  final Color accent;
  final bool rose;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: !enabled
            ? AppColors.silver
                .withValues(alpha: .16)
            : rose
                ? AppColors.pinkSoft
                : AppColors.primarySoft,
        borderRadius:
            BorderRadius.circular(11),
      ),
      child: Icon(
        icon,
        size: 16,
        color: accent,
      ),
    );
  }
}

class _ToolArrow extends StatelessWidget {
  const _ToolArrow({
    required this.accent,
    required this.enabled,
  });

  final Color accent;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 25,
      height: 25,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white
            .withValues(alpha: .68),
        shape: BoxShape.circle,
      ),
      child: Icon(
        enabled
            ? Icons.arrow_outward_rounded
            : Icons.lock_outline_rounded,
        size: 12,
        color: accent,
      ),
    );
  }
}

class _ToolText extends StatelessWidget {
  const _ToolText({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.accent,
    required this.enabled,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final Color accent;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          eyebrow,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: accent,
            fontSize: 5.7,
            fontWeight: FontWeight.w900,
            letterSpacing: .58,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: enabled
                ? AppColors.textPrimary
                : AppColors.textMuted,
            fontSize: 10.1,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          subtitle,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 7.1,
            height: 1.25,
          ),
        ),
      ],
    );
  }
}

class _WorkspaceSectionCard
    extends StatelessWidget {
  const _WorkspaceSectionCard({
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
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

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
        borderRadius:
            BorderRadius.circular(20),
        border: Border.all(
          color: accent
              .withValues(alpha: .07),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep
                .withValues(alpha: .035),
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
                color: accent
                    .withValues(alpha: .065),
                fontSize: 36,
                height: 1,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    alignment:
                        Alignment.center,
                    decoration: BoxDecoration(
                      color: rose
                          ? AppColors.pinkSoft
                          : AppColors.primarySoft,
                      borderRadius:
                          BorderRadius.circular(
                        11,
                      ),
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
                        color: AppColors
                            .textPrimary,
                        fontSize: 12,
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              _WorkspaceContent(
                value: value,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AdvancedPackageHeading
    extends StatelessWidget {
  const _AdvancedPackageHeading({
    required this.unlocked,
    required this.outputCount,
  });

  final bool unlocked;
  final int outputCount;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment:
          CrossAxisAlignment.end,
      children: [
        Container(
          width: 37,
          height: 37,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient:
                const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.primarySoft,
                AppColors.surfaceRose,
              ],
            ),
            borderRadius:
                BorderRadius.circular(12),
          ),
          child: Icon(
            unlocked
                ? Icons
                    .verified_outlined
                : Icons
                    .lock_outline_rounded,
            size: 17,
            color: AppColors.primaryDark,
          ),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              const Text(
                'ADVANCED PACKAGE',
                style: TextStyle(
                  color:
                      AppColors.primaryDark,
                  fontSize: 6.1,
                  fontWeight:
                      FontWeight.w900,
                  letterSpacing: .68,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                unlocked
                    ? 'Execution outputs'
                    : 'Protected outputs',
                style: const TextStyle(
                  color:
                      AppColors.textPrimary,
                  fontSize: 14,
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                unlocked
                    ? '$outputCount generated ${outputCount == 1 ? 'section' : 'sections'} available.'
                    : 'Unlock the evidence-backed execution layer when you are ready.',
                style: const TextStyle(
                  color:
                      AppColors.textMuted,
                  fontSize: 7.5,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LockedAdvancedPanel
    extends StatelessWidget {
  const _LockedAdvancedPanel({
    required this.premiumAccount,
    required this.unlocking,
    required this.onUnlock,
  });

  final bool premiumAccount;
  final bool unlocking;
  final VoidCallback onUnlock;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        14,
        15,
        14,
        14,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            Color(0xFFF0F8F5),
            AppColors.surfaceRose,
          ],
        ),
        borderRadius:
            BorderRadius.circular(21),
        border: Border.all(
          color: AppColors.primary
              .withValues(alpha: .10),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primarySoft,
              border: Border.all(
                color: AppColors.primary
                    .withValues(alpha: .10),
              ),
            ),
            child: const Icon(
              Icons.lock_outline_rounded,
              size: 22,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            premiumAccount
                ? 'Unlock with Premium credits'
                : 'Advanced workspace is locked',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            premiumAccount
                ? 'Your balance and configured credit cost are checked before a one-time unlock.'
                : 'Open the secure unlock options to activate advanced outputs for this idea.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed:
                  unlocking ? null : onUnlock,
              icon: unlocking
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child:
                          CircularProgressIndicator(
                        strokeWidth: 1.7,
                        color: Colors.white,
                      ),
                    )
                  : Icon(
                      premiumAccount
                          ? Icons.bolt_rounded
                          : Icons
                              .lock_open_rounded,
                      size: 15,
                    ),
              label: Text(
                unlocking
                    ? 'Opening…'
                    : premiumAccount
                        ? 'Unlock with credits'
                        : 'View unlock options',
              ),
              style: FilledButton.styleFrom(
                minimumSize:
                    const Size.fromHeight(43),
                shape: RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(12),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AdvancedOutputCard extends StatelessWidget {
  const _AdvancedOutputCard({
    required this.number,
    required this.title,
    required this.value,
    required this.rose,
  });

  final String number;
  final String title;
  final dynamic value;
  final bool rose;

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
              child: _WorkspaceContent(value: value),
            ),
          ],
        ),
      ),
    );
  }
}



class _WorkspaceContent
    extends StatelessWidget {
  const _WorkspaceContent({
    required this.value,
  });

  final dynamic value;

  @override
  Widget build(BuildContext context) {
    if (!_hasContent(value)) {
      return const Text(
        'Not available yet.',
        style: TextStyle(
          color: AppColors.textMuted,
          fontSize: 8.8,
        ),
      );
    }

    if (value is List) {
      final items = value as List;

      return Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: items
            .map(
              (item) => Padding(
                padding:
                    const EdgeInsets.only(
                  bottom: 6,
                ),
                child: Row(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding:
                          EdgeInsets.only(
                        top: 2,
                      ),
                      child: Icon(
                        Icons
                            .check_circle_outline_rounded,
                        size: 13,
                        color:
                            AppColors.primary,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child:
                          _WorkspaceContent(
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
      final entries =
          (value as Map).entries.toList();

      return Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: entries
            .map(
              (entry) => Padding(
                padding:
                    const EdgeInsets.only(
                  bottom: 8,
                ),
                child: Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: Colors.white
                        .withValues(
                      alpha: .58,
                    ),
                    borderRadius:
                        BorderRadius.circular(
                      12,
                    ),
                    border: Border.all(
                      color: AppColors
                          .primaryDark
                          .withValues(
                        alpha: .045,
                      ),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment
                            .start,
                    children: [
                      Text(
                        _humanize(
                          '${entry.key}',
                        ),
                        style: const TextStyle(
                          color: AppColors
                              .textPrimary,
                          fontWeight:
                              FontWeight.w900,
                          fontSize: 9.2,
                        ),
                      ),
                      const SizedBox(
                        height: 3,
                      ),
                      _WorkspaceContent(
                        value:
                            entry.value,
                      ),
                    ],
                  ),
                ),
              ),
            )
            .toList(),
      );
    }

    final raw = value.toString().trim();

    final lines = raw
        .split('\n')
        .map((line) => line.trim())
        .where(
          (line) => line.isNotEmpty,
        )
        .toList();

    if (lines.length <= 1) {
      return Text(
        raw,
        style: const TextStyle(
          color:
              AppColors.textSecondary,
          fontSize: 9.2,
          height: 1.48,
        ),
      );
    }

    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children: lines
          .map(
            (line) => Padding(
              padding:
                  const EdgeInsets.only(
                bottom: 6,
              ),
              child: Row(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding:
                        EdgeInsets.only(
                      top: 2,
                    ),
                    child: Icon(
                      Icons
                          .auto_awesome_rounded,
                      size: 11,
                      color: AppColors
                          .primaryDark,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      line,
                      style:
                          const TextStyle(
                        color: AppColors
                            .textSecondary,
                        fontSize: 9.2,
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

bool _hasContent(dynamic value) {
  if (value == null) return false;

  if (value is String) {
    return value.trim().isNotEmpty;
  }

  if (value is List) {
    return value.isNotEmpty;
  }

  if (value is Map) {
    return value.isNotEmpty;
  }

  return true;
}

String _text(dynamic value) =>
    value?.toString().trim() ?? '';

String _humanize(String value) {
  final spaced = value
      .replaceAll(
        RegExp(r'[_-]+'),
        ' ',
      )
      .replaceAllMapped(
        RegExp(r'([a-z0-9])([A-Z])'),
        (match) =>
            '${match[1]} ${match[2]}',
      )
      .trim();

  if (spaced.isEmpty) {
    return '';
  }

  return spaced
      .split(RegExp(r'\s+'))
      .map(
        (word) => word.isEmpty
            ? word
            : '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}',
      )
      .join(' ');
}

String _workspaceDate(dynamic value) {
  final parsed =
      DateTime.tryParse('$value')?.toLocal();

  if (parsed == null) {
    return 'Created recently';
  }

  const months = <String>[
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
