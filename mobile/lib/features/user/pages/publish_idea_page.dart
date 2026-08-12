// Voxidence mobile publication studio.
//
// Mobile-first publishing flow for transforming a private idea into a safe,
// polished public community story.
//
// The studio keeps backend behavior unchanged while presenting story,
// visibility, community controls and the live preview as a clear mobile flow.
//
// @author Eman

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class PublishIdeaPage extends StatefulWidget {
  const PublishIdeaPage({
    super.key,
    required this.ideaId,
    this.returnTitle = 'Idea workspace',
    this.initialIdea,
  });

  final String ideaId;

  /// Optional already-loaded idea snapshot supplied by Idea Workspace.
  ///
  /// It lets the publication studio paint immediately while a silent
  /// lightweight refresh confirms the newest publication settings.
  final Map<String, dynamic>? initialIdea;

  /// Label shown beside the back arrow.
  ///
  /// The caller supplies the page the user will return to so navigation stays
  /// explicit, matching the rest of the Voxidence mobile workspace.
  final String returnTitle;

  @override
  State<PublishIdeaPage> createState() =>
      _PublishIdeaPageState();
}

class _PublishIdeaPageState
    extends State<PublishIdeaPage> {
  final _title = TextEditingController();
  final _abstract = TextEditingController();
  final _problem = TextEditingController();
  final _objectives = TextEditingController();
  final _targetUsers = TextEditingController();

  String _visibility = 'PUBLIC';

  bool _allowRatings = true;
  bool _allowFeedback = true;
  bool _allowVoting = true;
  bool _allowAdoption = true;

  final Set<String> _selectedUserTypes = <String>{};

  bool _loading = true;
  bool _saving = false;
  bool _generating = false;

  Object? _error;
  String? _status;

  @override
  void initState() {
    super.initState();

    final initial = widget.initialIdea;

    if (initial != null && initial.isNotEmpty) {
      _hydrateIdea(initial);
      _loading = false;

      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          unawaited(
            _load(
              force: false,
              showLoading: false,
            ),
          );
        }
      });
    } else {
      _load();
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _abstract.dispose();
    _problem.dispose();
    _objectives.dispose();
    _targetUsers.dispose();
    super.dispose();
  }

  Future<void> _load({
    bool force = false,
    bool showLoading = true,
  }) async {
    if (mounted && showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      // Use the same lightweight workspace bundle as Idea Workspace.
      //
      // The backend workspace endpoint now includes the publication snapshot,
      // so opening Publication Studio no longer needs the expensive complete
      // idea query containing generation runs, candidates, NLP and audit data.
      final bundle =
          await UserApi.instance.getWorkspace(
        widget.ideaId,
        force: force,
      );

      final rawIdea = bundle['idea'];

      if (rawIdea is! Map) {
        throw const ApiException(
          'The idea could not be loaded for publication.',
        );
      }

      final idea =
          Map<String, dynamic>.from(rawIdea);

      if (!mounted) return;

      _hydrateIdea(idea);

      setState(() => _error = null);
    } catch (error) {
      if (mounted && showLoading) {
        setState(() => _error = error);
      }
      // A silent refresh must never replace an already-painted publication
      // studio with an error screen. The cached/current idea stays usable.
    } finally {
      if (mounted && showLoading) {
        setState(() => _loading = false);
      }
    }
  }

  void _hydrateIdea(
    Map<String, dynamic> idea,
  ) {
    final publication =
        idea['publication'] is Map
            ? Map<String, dynamic>.from(
                idea['publication'] as Map,
              )
            : const <String, dynamic>{};

    _title.text =
        '${publication['publicTitle'] ?? idea['title'] ?? ''}';

    _abstract.text =
        '${publication['publicAbstract'] ?? idea['fullAbstract'] ?? idea['partialAbstract'] ?? idea['limitedAbstract'] ?? ''}';

    _problem.text =
        '${publication['publicProblem'] ?? idea['problemStatement'] ?? ''}';

    _objectives.text =
        publication['publicObjectives']?.toString() ??
            _plainText(
              idea['objectives'],
            );

    _targetUsers.text =
        publication['publicTargetUsers']?.toString() ??
            _plainText(
              idea['targetUsers'],
            );

    final audienceValues = <String>{};
    final audiences = publication['audiences'];

    if (audiences is List) {
      for (final raw in audiences) {
        if (raw is Map &&
            raw['audienceType'] == 'user-type') {
          final value =
              raw['audienceValue']?.toString();

          if (value != null &&
              value.isNotEmpty) {
            audienceValues.add(value);
          }
        }
      }
    }

    _visibility =
        '${publication['visibility'] ?? 'PUBLIC'}';

    _allowRatings =
        publication['allowRatings'] ?? true;

    _allowFeedback =
        publication['allowFeedback'] ?? true;

    _allowVoting =
        publication['allowVoting'] ?? true;

    _allowAdoption =
        publication['allowAdoption'] ?? true;

    _selectedUserTypes
      ..clear()
      ..addAll(audienceValues);

    _status =
        publication['status']?.toString();
  }


  Future<void> _generateDescription() async {
    if (_generating) return;

    setState(() => _generating = true);

    try {
      final result = await UserApi.instance
          .generatePublicationDescription(
        widget.ideaId,
      );

      final description =
          result['description']?.toString() ??
              result['publicAbstract']?.toString() ??
              result['abstract']?.toString() ??
              result['text']?.toString();

      if (description == null ||
          description.trim().isEmpty) {
        throw const ApiException(
          'The generator returned no public description.',
        );
      }

      _abstract.text = description.trim();

      if (!mounted) return;

      setState(() {});

      showAppSnackBar(
        context,
        'AI public copy generated. Review it before publishing.',
      );
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
        setState(() => _generating = false);
      }
    }
  }

  Map<String, dynamic> _payload() => {
        'visibility': _visibility,
        'publicTitle': _title.text.trim(),
        'publicAbstract': _abstract.text.trim(),
        'publicProblem': _problem.text.trim(),
        'publicObjectives':
            _objectives.text.trim(),
        'publicTargetUsers':
            _targetUsers.text.trim(),
        'allowRatings': _allowRatings,
        'allowFeedback': _allowFeedback,
        'allowVoting': _allowVoting,
        'allowAdoption': _allowAdoption,
        if (_visibility ==
            'SELECTED_AUDIENCE')
          'audiences': _selectedUserTypes
              .map(
                (value) => {
                  'audienceType': 'user-type',
                  'audienceValue': value,
                },
              )
              .toList(),
      };

  bool _validate() {
    if (_title.text.trim().isEmpty ||
        _abstract.text.trim().isEmpty) {
      showAppSnackBar(
        context,
        'Add a public title and abstract first.',
        error: true,
      );

      return false;
    }

    if (_visibility ==
            'SELECTED_AUDIENCE' &&
        _selectedUserTypes.isEmpty) {
      showAppSnackBar(
        context,
        'Choose at least one audience type.',
        error: true,
      );

      return false;
    }

    return true;
  }

  Future<void> _saveDraft({
    bool publish = false,
  }) async {
    if (!_validate() || _saving) return;

    setState(() => _saving = true);

    try {
      await UserApi.instance.savePublicationDraft(
        widget.ideaId,
        _payload(),
      );

      if (publish) {
        await UserApi.instance.publishIdea(
          widget.ideaId,
        );

        await UserSessionController.instance.load(
          force: true,
        );
      }

      if (!mounted) return;

      showAppSnackBar(
        context,
        publish
            ? 'Idea published.'
            : 'Publication draft saved.',
      );

      await _load(force: true);
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
        setState(() => _saving = false);
      }
    }
  }

  int get _storyProgress {
    var completed = 0;

    if (_title.text.trim().isNotEmpty) {
      completed += 1;
    }

    if (_abstract.text.trim().isNotEmpty) {
      completed += 1;
    }

    if (_problem.text.trim().isNotEmpty) {
      completed += 1;
    }

    if (_objectives.text.trim().isNotEmpty) {
      completed += 1;
    }

    if (_targetUsers.text.trim().isNotEmpty) {
      completed += 1;
    }

    return completed;
  }

  bool get _published =>
      _status?.toUpperCase() == 'PUBLISHED';

  @override
  Widget build(BuildContext context) {
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
              'Publication studio',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 7.4,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        actions: [
          if (_status != null &&
              !_loading)
            Padding(
              padding:
                  const EdgeInsets.only(
                right: 10,
              ),
              child: Center(
                child: _StatusPill(
                  label: _published
                      ? 'LIVE'
                      : _humanizeStatus(
                          _status!,
                        ),
                  positive: _published,
                ),
              ),
            ),
        ],
      ),
      body: WorkspaceBackground(
        child: _loading
            ? const _PublicationLoadingView()
            : _error != null
                ? _PublicationErrorView(
                    error: _error!,
                    onRetry: () =>
                        _load(force: true),
                  )
                : RefreshIndicator(
                    color: AppColors.primary,
                    onRefresh: () =>
                        _load(force: true),
                    child: ListView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior
                              .onDrag,
                      physics:
                          const AlwaysScrollableScrollPhysics(
                        parent:
                            BouncingScrollPhysics(),
                      ),
                      padding:
                          const EdgeInsets.fromLTRB(
                        18,
                        12,
                        18,
                        130,
                      ),
                      children: [
                        _PublicationHero(
                          completed:
                              _storyProgress,
                          published: _published,
                        ),

                        const SizedBox(height: 12),

                        _StudioSection(
                          number: '01',
                          eyebrow: 'PUBLIC STORY',
                          title:
                              'Shape the story people will discover',
                          subtitle:
                              'Keep the public version clear, focused and safe to share.',
                          icon:
                              Icons.edit_note_rounded,
                          trailing:
                              _GenerateCopyButton(
                            loading:
                                _generating,
                            onTap:
                                _generateDescription,
                          ),
                          child: Column(
                            children: [
                              _StudioTextField(
                                controller: _title,
                                label:
                                    'Public title',
                                hint:
                                    'Give the opportunity a clear public name',
                                icon: Icons
                                    .title_rounded,
                                maxLength: 200,
                                minLines: 1,
                                maxLines: 2,
                                onChanged:
                                    (_) =>
                                        setState(
                                          () {},
                                        ),
                              ),

                              const SizedBox(
                                height: 10,
                              ),

                              _StudioTextField(
                                controller:
                                    _abstract,
                                label:
                                    'Public abstract',
                                hint:
                                    'Explain the opportunity in a concise public-safe way',
                                icon: Icons
                                    .subject_rounded,
                                maxLength: 5000,
                                minLines: 5,
                                maxLines: 8,
                                onChanged:
                                    (_) =>
                                        setState(
                                          () {},
                                        ),
                              ),

                              const SizedBox(
                                height: 10,
                              ),

                              _StudioTextField(
                                controller:
                                    _problem,
                                label:
                                    'Public problem',
                                hint:
                                    'What real problem does this opportunity address?',
                                icon: Icons
                                    .report_problem_outlined,
                                maxLength: 3000,
                                minLines: 3,
                                maxLines: 5,
                                rose: true,
                                onChanged:
                                    (_) =>
                                        setState(
                                          () {},
                                        ),
                              ),

                              const SizedBox(
                                height: 10,
                              ),

                              _StudioTextField(
                                controller:
                                    _objectives,
                                label:
                                    'Public objectives',
                                hint:
                                    'What should the solution accomplish?',
                                icon:
                                    Icons.flag_outlined,
                                maxLength: 5000,
                                minLines: 3,
                                maxLines: 5,
                                onChanged:
                                    (_) =>
                                        setState(
                                          () {},
                                        ),
                              ),

                              const SizedBox(
                                height: 10,
                              ),

                              _StudioTextField(
                                controller:
                                    _targetUsers,
                                label:
                                    'Target users',
                                hint:
                                    'Who benefits from this idea?',
                                icon:
                                    Icons.groups_outlined,
                                maxLength: 3000,
                                minLines: 3,
                                maxLines: 4,
                                rose: true,
                                onChanged:
                                    (_) =>
                                        setState(
                                          () {},
                                        ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(height: 12),

                        _StudioSection(
                          number: '02',
                          eyebrow:
                              'PUBLIC ACCESS',
                          title:
                              'Choose who can see it',
                          subtitle:
                              'Visibility controls discovery without changing the private workspace.',
                          icon: Icons
                              .visibility_outlined,
                          child: Column(
                            children: [
                              _VisibilityOption(
                                icon:
                                    Icons.public_rounded,
                                title: 'Public',
                                subtitle:
                                    'Visible to everyone and included in Discover.',
                                value: 'PUBLIC',
                                selected:
                                    _visibility ==
                                        'PUBLIC',
                                onTap: () =>
                                    setState(
                                  () =>
                                      _visibility =
                                          'PUBLIC',
                                ),
                              ),

                              const SizedBox(
                                height: 7,
                              ),

                              _VisibilityOption(
                                icon: Icons
                                    .verified_user_outlined,
                                title:
                                    'Voxidence members',
                                subtitle:
                                    'Visible only to authenticated Voxidence users.',
                                value:
                                    'REGISTERED_USERS',
                                selected:
                                    _visibility ==
                                        'REGISTERED_USERS',
                                onTap: () =>
                                    setState(
                                  () =>
                                      _visibility =
                                          'REGISTERED_USERS',
                                ),
                              ),

                              const SizedBox(
                                height: 7,
                              ),

                              _VisibilityOption(
                                icon: Icons
                                    .group_work_outlined,
                                title:
                                    'Selected audience',
                                subtitle:
                                    'Choose the member categories that may discover it.',
                                value:
                                    'SELECTED_AUDIENCE',
                                selected:
                                    _visibility ==
                                        'SELECTED_AUDIENCE',
                                rose: true,
                                onTap: () =>
                                    setState(
                                  () =>
                                      _visibility =
                                          'SELECTED_AUDIENCE',
                                ),
                              ),

                              if (_visibility ==
                                  'SELECTED_AUDIENCE') ...[
                                const SizedBox(
                                  height: 12,
                                ),

                                const Align(
                                  alignment:
                                      Alignment
                                          .centerLeft,
                                  child: Text(
                                    'WHO CAN SEE IT?',
                                    style: TextStyle(
                                      color: AppColors
                                          .primaryDark,
                                      fontSize: 6,
                                      fontWeight:
                                          FontWeight
                                              .w900,
                                      letterSpacing:
                                          .62,
                                    ),
                                  ),
                                ),

                                const SizedBox(
                                  height: 7,
                                ),

                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: const [
                                    (
                                      'STUDENT',
                                      'Students',
                                      Icons
                                          .school_outlined,
                                    ),
                                    (
                                      'DEVELOPER',
                                      'Developers',
                                      Icons
                                          .code_rounded,
                                    ),
                                    (
                                      'RESEARCHER',
                                      'Researchers',
                                      Icons
                                          .science_outlined,
                                    ),
                                    (
                                      'COMPANY',
                                      'Companies',
                                      Icons
                                          .business_outlined,
                                    ),
                                    (
                                      'OTHER',
                                      'Other',
                                      Icons
                                          .interests_outlined,
                                    ),
                                  ].map(
                                    (entry) {
                                      final selected =
                                          _selectedUserTypes
                                              .contains(
                                        entry.$1,
                                      );

                                      return _AudienceChip(
                                        label:
                                            entry.$2,
                                        icon:
                                            entry.$3,
                                        selected:
                                            selected,
                                        onTap: () {
                                          setState(
                                            () {
                                              if (selected) {
                                                _selectedUserTypes
                                                    .remove(
                                                  entry.$1,
                                                );
                                              } else {
                                                _selectedUserTypes
                                                    .add(
                                                  entry.$1,
                                                );
                                              }
                                            },
                                          );
                                        },
                                      );
                                    },
                                  ).toList(),
                                ),
                              ],
                            ],
                          ),
                        ),

                        const SizedBox(height: 12),

                        _StudioSection(
                          number: '03',
                          eyebrow:
                              'COMMUNITY SETTINGS',
                          title:
                              'Decide how people can interact',
                          subtitle:
                              'Keep only the community signals that are useful for this publication.',
                          icon:
                              Icons.tune_rounded,
                          child: LayoutBuilder(
                            builder:
                                (
                              context,
                              constraints,
                            ) {
                              const gap = 7.0;

                              final cardWidth =
                                  (constraints
                                              .maxWidth -
                                          gap) /
                                      2;

                              return Wrap(
                                spacing: gap,
                                runSpacing: 7,
                                children: [
                                  SizedBox(
                                    width:
                                        cardWidth,
                                    child:
                                        _CommunityToggle(
                                      icon: Icons
                                          .star_outline_rounded,
                                      title:
                                          'Ratings',
                                      subtitle:
                                          'Community score',
                                      value:
                                          _allowRatings,
                                      onChanged:
                                          (value) =>
                                              setState(
                                        () =>
                                            _allowRatings =
                                                value,
                                      ),
                                    ),
                                  ),
                                  SizedBox(
                                    width:
                                        cardWidth,
                                    child:
                                        _CommunityToggle(
                                      icon: Icons
                                          .chat_bubble_outline_rounded,
                                      title:
                                          'Feedback',
                                      subtitle:
                                          'Written comments',
                                      value:
                                          _allowFeedback,
                                      rose: true,
                                      onChanged:
                                          (value) =>
                                              setState(
                                        () =>
                                            _allowFeedback =
                                                value,
                                      ),
                                    ),
                                  ),
                                  SizedBox(
                                    width:
                                        cardWidth,
                                    child:
                                        _CommunityToggle(
                                      icon: Icons
                                          .thumbs_up_down_outlined,
                                      title:
                                          'Voting',
                                      subtitle:
                                          'Support / oppose',
                                      value:
                                          _allowVoting,
                                      onChanged:
                                          (value) =>
                                              setState(
                                        () =>
                                            _allowVoting =
                                                value,
                                      ),
                                    ),
                                  ),
                                  SizedBox(
                                    width:
                                        cardWidth,
                                    child:
                                        _CommunityToggle(
                                      icon: Icons
                                          .handshake_outlined,
                                      title:
                                          'Acceptance',
                                      subtitle:
                                          'Adopt to workspace',
                                      value:
                                          _allowAdoption,
                                      rose: true,
                                      onChanged:
                                          (value) =>
                                              setState(
                                        () =>
                                            _allowAdoption =
                                                value,
                                      ),
                                    ),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),

                        const SizedBox(height: 12),

                        _StudioSection(
                          number: '04',
                          eyebrow:
                              'LIVE PREVIEW',
                          title:
                              'See what the community will see',
                          subtitle:
                              'This is a compact preview of the public discovery card.',
                          icon: Icons
                              .preview_outlined,
                          child:
                              _PublicationPreview(
                            title:
                                _title.text
                                        .trim()
                                        .isEmpty
                                    ? 'Your public title'
                                    : _title.text
                                        .trim(),
                            abstract:
                                _abstract.text
                                        .trim()
                                        .isEmpty
                                    ? 'Your public abstract will appear here.'
                                    : _abstract.text
                                        .trim(),
                            problem:
                                _problem.text
                                        .trim()
                                        .isEmpty
                                    ? 'Problem statement'
                                    : _problem.text
                                        .trim(),
                            audience:
                                _targetUsers.text
                                        .trim()
                                        .isEmpty
                                    ? 'Target audience'
                                    : _targetUsers.text
                                        .trim(),
                            visibility:
                                _visibility,
                            ratings:
                                _allowRatings,
                            feedback:
                                _allowFeedback,
                            voting:
                                _allowVoting,
                            adoption:
                                _allowAdoption,
                          ),
                        ),
                      ],
                    ),
                  ),
      ),
      bottomNavigationBar:
          _loading || _error != null
              ? null
              : _PublicationActionBar(
                  saving: _saving,
                  published: _published,
                  onSave: () =>
                      _saveDraft(),
                  onPublish: () =>
                      _saveDraft(
                    publish: true,
                  ),
                ),
    );
  }

  String _plainText(dynamic value) {
    if (value == null) return '';

    if (value is String) return value;

    if (value is List) {
      return value
          .map(
            (item) => '$item',
          )
          .join('\n');
    }

    if (value is Map) {
      return value.entries
          .map(
            (entry) =>
                '${entry.key}: ${entry.value}',
          )
          .join('\n');
    }

    return '$value';
  }
}

class _PublicationHero extends StatelessWidget {
  const _PublicationHero({
    required this.completed,
    required this.published,
  });

  final int completed;
  final bool published;

  @override
  Widget build(BuildContext context) {
    final progress = completed / 5;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        14,
        13,
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
          stops: [0, .62, 1],
        ),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark
              .withValues(alpha: .065),
        ),
        boxShadow: [
          BoxShadow(
            color:
                AppColors.primaryDeep.withValues(alpha: .04),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -6,
            top: -12,
            child: Icon(
              Icons.public_rounded,
              size: 84,
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
                  Container(
                    width: 39,
                    height: 39,
                    alignment:
                        Alignment.center,
                    decoration: BoxDecoration(
                      gradient:
                          const LinearGradient(
                        begin:
                            Alignment.topLeft,
                        end: Alignment
                            .bottomRight,
                        colors: [
                          Color(
                            0xFF68C5BF,
                          ),
                          Color(
                            0xFF50AAA5,
                          ),
                        ],
                      ),
                      borderRadius:
                          BorderRadius.circular(
                        13,
                      ),
                    ),
                    child: const Icon(
                      Icons.public_rounded,
                      size: 18,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Text(
                          published
                              ? 'PUBLICATION IS LIVE'
                              : 'PUBLICATION STUDIO',
                          style:
                              const TextStyle(
                            color: AppColors
                                .primaryDark,
                            fontSize: 6.1,
                            fontWeight:
                                FontWeight.w900,
                            letterSpacing:
                                .68,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          published
                              ? 'Refine the public story anytime.'
                              : 'Turn the private idea into a polished public story.',
                          style:
                              const TextStyle(
                            color: AppColors
                                .textPrimary,
                            fontSize: 14.4,
                            height: 1.14,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              const Text(
                'Control what is shared, who can discover it, and which community interactions are enabled.',
                style: TextStyle(
                  color:
                      AppColors.textSecondary,
                  fontSize: 8.2,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 11),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius:
                          BorderRadius.circular(
                        999,
                      ),
                      child:
                          LinearProgressIndicator(
                        value: progress,
                        minHeight: 5,
                        color:
                            AppColors.primary,
                        backgroundColor:
                            AppColors
                                .primarySoft,
                      ),
                    ),
                  ),
                  const SizedBox(width: 9),
                  Text(
                    '$completed / 5 ready',
                    style: const TextStyle(
                      color:
                          AppColors.primaryDark,
                      fontSize: 7,
                      fontWeight:
                          FontWeight.w900,
                    ),
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

class _StudioSection extends StatelessWidget {
  const _StudioSection({
    required this.number,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.child,
    this.trailing,
  });

  final String number;
  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        12,
        12,
        12,
        13,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            Color(0xFFF8FCFB),
            AppColors.surfaceRose,
          ],
          stops: [0, .72, 1],
        ),
        borderRadius: BorderRadius.circular(21),
        border: Border.all(
          color: AppColors.primaryDark
              .withValues(alpha: .055),
        ),
        boxShadow: [
          BoxShadow(
            color:
                AppColors.primaryDeep.withValues(alpha: .03),
            blurRadius: 15,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: 1,
            top: -5,
            child: Text(
              number,
              style: TextStyle(
                color: AppColors.primaryDark
                    .withValues(alpha: .04),
                fontSize: 39,
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
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    alignment:
                        Alignment.center,
                    decoration: BoxDecoration(
                      color:
                          AppColors.primarySoft,
                      borderRadius:
                          BorderRadius.circular(
                        11,
                      ),
                    ),
                    child: Icon(
                      icon,
                      size: 16,
                      color:
                          AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Text(
                          eyebrow,
                          style:
                              const TextStyle(
                            color: AppColors
                                .primaryDark,
                            fontSize: 5.8,
                            fontWeight:
                                FontWeight.w900,
                            letterSpacing:
                                .62,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          title,
                          style:
                              const TextStyle(
                            color: AppColors
                                .textPrimary,
                            fontSize: 12.2,
                            height: 1.16,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          subtitle,
                          style:
                              const TextStyle(
                            color: AppColors
                                .textMuted,
                            fontSize: 7.3,
                            height: 1.34,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (trailing != null) ...[
                    const SizedBox(width: 6),
                    trailing!,
                  ],
                ],
              ),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ],
      ),
    );
  }
}

class _GenerateCopyButton
    extends StatelessWidget {
  const _GenerateCopyButton({
    required this.loading,
    required this.onTap,
  });

  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: loading ? null : onTap,
        borderRadius:
            BorderRadius.circular(12),
        child: Ink(
          height: 35,
          padding: const EdgeInsets.symmetric(
            horizontal: 9,
          ),
          decoration: BoxDecoration(
            gradient:
                const LinearGradient(
              colors: [
                Color(0xFFE5F5F1),
                AppColors.surfaceRose,
              ],
            ),
            borderRadius:
                BorderRadius.circular(12),
            border: Border.all(
              color: AppColors.primary
                  .withValues(alpha: .10),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (loading)
                const SizedBox(
                  width: 13,
                  height: 13,
                  child:
                      CircularProgressIndicator(
                    strokeWidth: 1.6,
                    color:
                        AppColors.primary,
                  ),
                )
              else
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: 13,
                  color:
                      AppColors.primaryDark,
                ),
              const SizedBox(width: 5),
              Text(
                loading ? 'Writing…' : 'AI copy',
                style: const TextStyle(
                  color:
                      AppColors.primaryDark,
                  fontSize: 6.8,
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StudioTextField
    extends StatelessWidget {
  const _StudioTextField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    required this.maxLength,
    required this.minLines,
    required this.maxLines,
    required this.onChanged,
    this.rose = false,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final int maxLength;
  final int minLines;
  final int maxLines;
  final ValueChanged<String> onChanged;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        10,
        9,
        10,
        8,
      ),
      decoration: BoxDecoration(
        color:
            Colors.white.withValues(alpha: .70),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: accent.withValues(alpha: .08),
        ),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 29,
                height: 29,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: rose
                      ? AppColors.pinkSoft
                      : AppColors.primarySoft,
                  borderRadius:
                      BorderRadius.circular(9),
                ),
                child: Icon(
                  icon,
                  size: 13.5,
                  color: accent,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color:
                        AppColors.textPrimary,
                    fontSize: 8.8,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
              ),
              Text(
                '${controller.text.length}/$maxLength',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 6.2,
                  fontWeight:
                      FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          TextField(
            controller: controller,
            minLines: minLines,
            maxLines: maxLines,
            maxLength: maxLength,
            onChanged: onChanged,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.4,
              height: 1.45,
            ),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.5,
                height: 1.4,
              ),
              counterText: '',
              filled: false,
              border: InputBorder.none,
              enabledBorder:
                  InputBorder.none,
              focusedBorder:
                  InputBorder.none,
              contentPadding:
                  const EdgeInsets.fromLTRB(
                1,
                3,
                1,
                3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _VisibilityOption
    extends StatelessWidget {
  const _VisibilityOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.selected,
    required this.onTap,
    this.rose = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String value;
  final bool selected;
  final VoidCallback onTap;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(15),
        child: AnimatedContainer(
          duration:
              const Duration(milliseconds: 180),
          padding: const EdgeInsets.fromLTRB(
            9,
            9,
            9,
            9,
          ),
          decoration: BoxDecoration(
            gradient: selected
                ? LinearGradient(
                    begin: Alignment.topLeft,
                    end:
                        Alignment.bottomRight,
                    colors: rose
                        ? const [
                            AppColors
                                .surfaceRose,
                            Color(
                              0xFFF3F9F7,
                            ),
                          ]
                        : const [
                            Color(
                              0xFFE6F5F1,
                            ),
                            Color(
                              0xFFF8FCFB,
                            ),
                          ],
                  )
                : null,
            color: selected
                ? null
                : Colors.white
                    .withValues(alpha: .60),
            borderRadius:
                BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? accent.withValues(
                      alpha: .20,
                    )
                  : AppColors.primaryDark
                      .withValues(alpha: .04),
              width: selected ? 1.15 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 35,
                height: 35,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? (rose
                          ? AppColors
                              .pinkSoft
                          : AppColors
                              .primarySoft)
                      : AppColors.surface,
                  borderRadius:
                      BorderRadius.circular(11),
                ),
                child: Icon(
                  icon,
                  size: 15,
                  color: selected
                      ? accent
                      : AppColors.textMuted,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: selected
                            ? AppColors
                                .textPrimary
                            : AppColors
                                .textSecondary,
                        fontSize: 9.2,
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color:
                            AppColors.textMuted,
                        fontSize: 6.9,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 7),
              AnimatedContainer(
                duration:
                    const Duration(
                  milliseconds: 180,
                ),
                width: 25,
                height: 25,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected
                      ? accent
                      : Colors.transparent,
                  border: Border.all(
                    color: selected
                        ? accent
                        : AppColors.silver,
                  ),
                ),
                child: selected
                    ? const Icon(
                        Icons.check_rounded,
                        size: 13,
                        color: Colors.white,
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AudienceChip extends StatelessWidget {
  const _AudienceChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(999),
        child: AnimatedContainer(
          duration:
              const Duration(milliseconds: 180),
          height: 34,
          padding: const EdgeInsets.symmetric(
            horizontal: 9,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft
                : Colors.white
                    .withValues(alpha: .66),
            borderRadius:
                BorderRadius.circular(999),
            border: Border.all(
              color: selected
                  ? AppColors.primary
                      .withValues(alpha: .25)
                  : AppColors.primaryDark
                      .withValues(alpha: .05),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                selected
                    ? Icons.check_rounded
                    : icon,
                size: 12,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.textMuted,
              ),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDark
                      : AppColors
                          .textSecondary,
                  fontSize: 6.9,
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommunityToggle
    extends StatelessWidget {
  const _CommunityToggle({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.rose = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Container(
      constraints: const BoxConstraints(
        minHeight: 101,
      ),
      padding: const EdgeInsets.fromLTRB(
        9,
        9,
        7,
        8,
      ),
      decoration: BoxDecoration(
        gradient: value
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: rose
                    ? const [
                        AppColors.surfaceRose,
                        AppColors.surface,
                      ]
                    : const [
                        Color(0xFFEAF6F3),
                        AppColors.surface,
                      ],
              )
            : null,
        color: value
            ? null
            : Colors.white
                .withValues(alpha: .58),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(
          color: value
              ? accent.withValues(alpha: .12)
              : AppColors.primaryDark
                  .withValues(alpha: .04),
        ),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: rose
                      ? AppColors.pinkSoft
                      : AppColors.primarySoft,
                  borderRadius:
                      BorderRadius.circular(9),
                ),
                child: Icon(
                  icon,
                  size: 13.5,
                  color: accent,
                ),
              ),
              const Spacer(),
              Transform.scale(
                scale: .76,
                child: Switch.adaptive(
                  value: value,
                  onChanged: onChanged,
                  activeThumbColor:
                      AppColors.primary,
                  activeTrackColor:
                      AppColors.primarySoft,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            title,
            style: const TextStyle(
              color:
                  AppColors.textPrimary,
              fontSize: 8.7,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 6.5,
              height: 1.25,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublicationPreview
    extends StatelessWidget {
  const _PublicationPreview({
    required this.title,
    required this.abstract,
    required this.problem,
    required this.audience,
    required this.visibility,
    required this.ratings,
    required this.feedback,
    required this.voting,
    required this.adoption,
  });

  final String title;
  final String abstract;
  final String problem;
  final String audience;
  final String visibility;

  final bool ratings;
  final bool feedback;
  final bool voting;
  final bool adoption;

  @override
  Widget build(BuildContext context) {
    final visibilityLabel =
        switch (visibility) {
      'REGISTERED_USERS' => 'Members',
      'SELECTED_AUDIENCE' =>
        'Selected audience',
      _ => 'Public',
    };

    return Container(
      decoration: BoxDecoration(
        color:
            Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.primaryDark
              .withValues(alpha: .055),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            Container(
              height: 5,
              decoration:
                  const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppColors.primary,
                    Color(0xFF80CEC8),
                    AppColors.pinkLight,
                  ],
                ),
              ),
            ),
            Padding(
              padding:
                  const EdgeInsets.fromLTRB(
                11,
                10,
                11,
                11,
              ),
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _PreviewBadge(
                        icon: Icons
                            .auto_awesome_rounded,
                        label:
                            'COMMUNITY IDEA',
                      ),
                      const Spacer(),
                      _PreviewBadge(
                        icon: Icons
                            .visibility_outlined,
                        label:
                            visibilityLabel
                                .toUpperCase(),
                        rose: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    maxLines: 3,
                    overflow:
                        TextOverflow.ellipsis,
                    style: const TextStyle(
                      color:
                          AppColors.textPrimary,
                      fontSize: 14.4,
                      height: 1.14,
                      fontWeight:
                          FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    abstract,
                    maxLines: 5,
                    overflow:
                        TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors
                          .textSecondary,
                      fontSize: 8.7,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _PreviewFact(
                          label: 'Problem',
                          value: problem,
                        ),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: _PreviewFact(
                          label: 'Audience',
                          value: audience,
                          rose: true,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  Wrap(
                    spacing: 5,
                    runSpacing: 5,
                    children: [
                      if (ratings)
                        const _PreviewSignal(
                          icon: Icons
                              .star_outline_rounded,
                          label: 'Ratings',
                        ),
                      if (feedback)
                        const _PreviewSignal(
                          icon: Icons
                              .chat_bubble_outline_rounded,
                          label: 'Feedback',
                        ),
                      if (voting)
                        const _PreviewSignal(
                          icon: Icons
                              .thumb_up_alt_outlined,
                          label: 'Voting',
                        ),
                      if (adoption)
                        const _PreviewSignal(
                          icon: Icons
                              .handshake_outlined,
                          label: 'Acceptance',
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PreviewFact extends StatelessWidget {
  const _PreviewFact({
    required this.label,
    required this.value,
    this.rose = false,
  });

  final String label;
  final String value;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;

    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.pinkSoft
                .withValues(alpha: .55)
            : AppColors.primarySoft
                .withValues(alpha: .55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: accent,
              fontSize: 5.7,
              fontWeight: FontWeight.w900,
              letterSpacing: .5,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color:
                  AppColors.textSecondary,
              fontSize: 7.2,
              height: 1.35,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewBadge extends StatelessWidget {
  const _PreviewBadge({
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
      height: 27,
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
      ),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.pinkSoft
            : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10,
            color: accent,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: accent,
              fontSize: 5.6,
              fontWeight: FontWeight.w900,
              letterSpacing: .42,
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewSignal extends StatelessWidget {
  const _PreviewSignal({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 27,
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
      ),
      decoration: BoxDecoration(
        color: AppColors.primarySoft
            .withValues(alpha: .68),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 10,
            color: AppColors.primaryDark,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 6.3,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublicationActionBar
    extends StatelessWidget {
  const _PublicationActionBar({
    required this.saving,
    required this.published,
    required this.onSave,
    required this.onPublish,
  });

  final bool saving;
  final bool published;
  final VoidCallback onSave;
  final VoidCallback onPublish;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          12,
          9,
          12,
          10,
        ),
        decoration: BoxDecoration(
          color:
              AppColors.surface.withValues(alpha: .97),
          border: Border(
            top: BorderSide(
              color: AppColors.primaryDark
                  .withValues(alpha: .05),
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep
                  .withValues(alpha: .08),
              blurRadius: 20,
              offset: const Offset(0, -6),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed:
                    saving ? null : onSave,
                icon: const Icon(
                  Icons.save_outlined,
                  size: 14,
                ),
                label:
                    const Text('Save draft'),
                style:
                    OutlinedButton.styleFrom(
                  minimumSize:
                      const Size.fromHeight(
                    45,
                  ),
                  shape:
                      RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(
                      13,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed:
                    saving ? null : onPublish,
                icon: saving
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
                        published
                            ? Icons
                                .refresh_rounded
                            : Icons
                                .public_rounded,
                        size: 15,
                      ),
                label: Text(
                  saving
                      ? 'Saving…'
                      : published
                          ? 'Republish'
                          : 'Publish idea',
                ),
                style: FilledButton.styleFrom(
                  minimumSize:
                      const Size.fromHeight(
                    45,
                  ),
                  shape:
                      RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(
                      13,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.positive,
  });

  final String label;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    final accent = positive
        ? AppColors.success
        : AppColors.primaryDark;

    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(
        horizontal: 8,
      ),
      decoration: BoxDecoration(
        color: positive
            ? const Color(0xFFEAF8F2)
            : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent.withValues(alpha: .10),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accent,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: accent,
              fontSize: 5.8,
              fontWeight: FontWeight.w900,
              letterSpacing: .5,
            ),
          ),
        ],
      ),
    );
  }
}

class _PublicationLoadingView
    extends StatelessWidget {
  const _PublicationLoadingView();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics:
          const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        18,
        28,
        18,
        40,
      ),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(
            16,
            18,
            16,
            18,
          ),
          decoration: BoxDecoration(
            gradient:
                const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.surface,
                Color(0xFFF0F8F5),
                AppColors.surfaceRose,
              ],
            ),
            borderRadius:
                BorderRadius.circular(23),
            border: Border.all(
              color: AppColors.primaryDark
                  .withValues(alpha: .06),
            ),
          ),
          child: Column(
            children: [
              Container(
                width: 54,
                height: 54,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color:
                      AppColors.primarySoft,
                  border: Border.all(
                    color: AppColors.primary
                        .withValues(alpha: .10),
                  ),
                ),
                child: const SizedBox(
                  width: 22,
                  height: 22,
                  child:
                      CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color:
                        AppColors.primary,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Preparing publication studio',
                style: TextStyle(
                  color:
                      AppColors.textPrimary,
                  fontSize: 14,
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Loading your private idea and its current publication settings.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.2,
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

class _PublicationErrorView
    extends StatelessWidget {
  const _PublicationErrorView({
    required this.error,
    required this.onRetry,
  });

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics:
          const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(18),
      children: [
        EmptyState(
          icon: Icons.cloud_off_rounded,
          title:
              'Publication studio unavailable',
          message: error.toString(),
          action: FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(
              Icons.refresh_rounded,
              size: 15,
            ),
            label: const Text('Retry'),
          ),
        ),
      ],
    );
  }
}

String _humanizeStatus(String value) {
  final normalized = value
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .trim();

  if (normalized.isEmpty) {
    return 'DRAFT';
  }

  return normalized.toUpperCase();
}
