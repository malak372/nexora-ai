// Template-aware mobile business-model studio with presentation preview.
// Mirrors the React workspace content while adapting the framework library,
// model board, version state, and printable presentation to phone layouts.
//
// @author  Malak

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';

class BusinessModelPage extends StatefulWidget {
  const BusinessModelPage({
    super.key,
    required this.ideaId,
    this.publicationId,
    this.ideaTitle,
  });

  final String ideaId;

  /// Present when the studio was opened from an accepted publication.
  ///
  /// In that flow the source idea belongs to the publisher, so the normal
  /// owner-only idea-details endpoint must not be used for page context.
  final String? publicationId;

  /// Explicit idea title supplied by the workspace that opened this studio.
  ///
  /// Keeping the title here guarantees that the Business Model hero,
  /// presentation preview, printable HTML and Print/PDF output always use
  /// the real idea name even when the accepted-publication context request
  /// is unavailable or returns a reduced payload.
  final String? ideaTitle;

  @override
  State<BusinessModelPage> createState() => _BusinessModelPageState();
}

class _BusinessModelPageState extends State<BusinessModelPage> {
  List<Map<String, dynamic>> _templates = const [];
  Map<String, dynamic>? _current;
  Map<String, dynamic>? _idea;
  String? _templateId;
  bool _loading = true;
  bool _generating = false;
  Object? _error;

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
      // Templates + current model are the only requests required for the
      // studio itself. A missing page-context record must never make the
      // complete studio fail.
      final values = await Future.wait([
        UserApi.instance.getBusinessModelTemplates(force: force),
        UserApi.instance.getCurrentBusinessModel(
          widget.ideaId,
          force: force,
        ),
      ]);

      final templates = values[0] as List<Map<String, dynamic>>;
      final current = values[1] as Map<String, dynamic>?;

      // Own idea workspace:
      //   /users/ideas/:ideaId
      //
      // Accepted publication workspace:
      //   /users/publications/:publicationId
      //
      // The latter is important because the source idea is owned by the
      // publisher. Calling the owner-only idea endpoint for an accepted idea
      // was the reason the mobile page showed "Idea not found."
      final idea = await _loadIdeaContext(force: force);

      if (!mounted) return;

      final currentTemplate = _map(
        current?['businessModelTemplate'],
      );
      final currentId = currentTemplate['id']?.toString();

      Map<String, dynamic>? defaultTemplate;

      for (final template in templates) {
        if (template['isDefault'] == true) {
          defaultTemplate = template;
          break;
        }
      }

      defaultTemplate ??=
          templates.isEmpty ? null : templates.first;

      setState(() {
        _templates = templates;
        _current = current;
        _idea = idea;
        _templateId =
            currentId ?? defaultTemplate?['id']?.toString();
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<Map<String, dynamic>> _loadIdeaContext({
    required bool force,
  }) async {
    final publicationId = widget.publicationId?.trim();

    try {
      if (publicationId != null && publicationId.isNotEmpty) {
        final publication = await UserApi.instance.getDiscovery(
          publicationId,
          force: force,
        );

        return {
          ...publication,
          'id': widget.ideaId,
          'title':
              _cleanTitle(widget.ideaTitle) ??
              publication['publicTitle'] ??
              publication['title'] ??
              'Accepted opportunity',
          'abstract':
              publication['publicAbstract'] ??
              publication['publicDescription'] ??
              publication['abstract'],
        };
      }

      return await UserApi.instance.getIdeaDetails(
        widget.ideaId,
        force: force,
      );
    } on ApiException catch (error) {
      // The studio endpoints themselves are authoritative. Page context is
      // only used for presentation labels, so a 404 here must not block an
      // accepted user's business-model workspace.
      if (error.statusCode != 404) {
        rethrow;
      }

      return {
        'id': widget.ideaId,
        'title': _cleanTitle(widget.ideaTitle) ??
            (publicationId == null
                ? 'Voxidence idea'
                : 'Accepted opportunity'),
      };
    } catch (_) {
      return {
        'id': widget.ideaId,
        'title': _cleanTitle(widget.ideaTitle) ??
            (publicationId == null
                ? 'Voxidence idea'
                : 'Accepted opportunity'),
      };
    }
  }

  Future<void> _generate() async {
    final templateId = _templateId;

    if (_generating ||
        templateId == null ||
        templateId.isEmpty) {
      return;
    }

    setState(() {
      _generating = true;
      _error = null;
    });

    try {
      final generated =
          await UserApi.instance.generateBusinessModel(
        widget.ideaId,
        templateId,
      );

      if (!mounted) return;

      setState(() => _current = generated);

      showAppSnackBar(
        context,
        'Business model generated successfully.',
      );
    } on ApiException catch (error) {
      final timeout = error.message
          .toLowerCase()
          .contains('too long');

      // A client timeout does not guarantee the backend stopped. The AI
      // request may have completed and persisted the model after the mobile
      // connection closed. Check the current model before asking the user to
      // generate a duplicate version.
      if (timeout) {
        final recovered =
            await _recoverGeneratedModel(templateId);

        if (recovered) {
          if (mounted) {
            showAppSnackBar(
              context,
              'The model finished generating and is ready.',
            );
          }
          return;
        }
      }

      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    } catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          '$error',
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _generating = false);
      }
    }
  }

  Future<bool> _recoverGeneratedModel(
    String templateId,
  ) async {
    const delays = <Duration>[
      Duration(seconds: 2),
      Duration(seconds: 3),
      Duration(seconds: 4),
    ];

    for (final delay in delays) {
      await Future<void>.delayed(delay);

      try {
        final model =
            await UserApi.instance.getCurrentBusinessModel(
          widget.ideaId,
          force: true,
        );

        if (model == null) continue;

        final template = _map(
          model['businessModelTemplate'],
        );

        if (template['id']?.toString() != templateId) {
          continue;
        }

        if (!mounted) return false;

        setState(() => _current = model);
        return true;
      } catch (_) {
        // Recovery is best-effort only. The original API error remains
        // authoritative if the generated model cannot be confirmed.
      }
    }

    return false;
  }

  Future<void> _chooseFramework() async {
    if (_templates.isEmpty || _generating) return;

    final selectedId =
        await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _FrameworkPickerSheet(
        templates: _templates,
        selectedId: _templateId,
      ),
    );

    if (!mounted ||
        selectedId == null ||
        selectedId.isEmpty ||
        selectedId == _templateId) {
      return;
    }

    setState(() => _templateId = selectedId);
  }

  Map<String, dynamic>? get _selectedTemplate {
    for (final template in _templates) {
      if (template['id']?.toString() == _templateId) return template;
    }
    return null;
  }

  bool get _modelMatchesSelection {
    final model = _current;
    if (model == null) return false;
    final currentTemplate = _map(model['businessModelTemplate']);
    return _templateId == null || currentTemplate['id']?.toString() == _templateId;
  }


  String get _resolvedIdeaTitle {
    final explicit = _cleanTitle(widget.ideaTitle);
    if (explicit != null) return explicit;

    final idea = _idea;
    if (idea != null) {
      final direct = _cleanTitle(
        idea['title'] ??
        idea['publicTitle'] ??
        idea['ideaTitle'],
      );
      if (direct != null) return direct;
    }

    final model = _current;
    if (model != null) {
      final embeddedIdea = _map(model['idea']);
      final embedded = _cleanTitle(
        embeddedIdea['title'] ??
        model['ideaTitle'],
      );
      if (embedded != null) return embedded;
    }

    return widget.publicationId?.trim().isNotEmpty == true
        ? 'Accepted opportunity'
        : 'Voxidence idea';
  }

  Future<void> _openPresentation(Map<String, dynamic> model) async {
    final content = _map(model['content']);
    final template = _map(model['businessModelTemplate']);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _BusinessModelPresentationSheet(
        ideaTitle: _resolvedIdeaTitle,
        templateName: template['name']?.toString() ?? _selectedTemplate?['name']?.toString() ?? 'Business Model',
        version: _asInt(model['version'], fallback: 1),
        content: content,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final model = _current;
    final selected = _selectedTemplate;
    final visibleModel = _modelMatchesSelection ? model : null;
    final currentTemplate = _map(visibleModel?['businessModelTemplate']);
    final content = _map(visibleModel?['content']);
    final layoutName = selected?['name']?.toString() ??
        currentTemplate['name']?.toString() ??
        'Business Model';

    final openedFromAccepted =
        widget.publicationId?.trim().isNotEmpty == true;

    return Scaffold(
      appBar: AppBar(
        leadingWidth: 50,
        leading: IconButton(
          tooltip: openedFromAccepted
              ? 'Back to Accepted workspace'
              : 'Back to Idea workspace',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(
            Icons.arrow_back_rounded,
            size: 22,
          ),
        ),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              openedFromAccepted
                  ? 'Accepted workspace'
                  : 'Idea workspace',
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            const Text(
              'Business model studio',
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
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 40),
            children: [
              _BusinessStudioHero(
                ideaTitle: _resolvedIdeaTitle,
                layoutName: layoutName,
                version: visibleModel == null
                    ? 'New'
                    : '${visibleModel['version'] ?? 1}',
                acceptedContext: openedFromAccepted,
              ),
              const SizedBox(height: 14),
              if (_loading)
                const LoadingList(count: 4)
              else if (_error != null)
                EmptyState(
                  icon: Icons.cloud_off_rounded,
                  title: 'Business-model studio needs attention',
                  message: _error is ApiException
                      ? (_error as ApiException).message
                      : 'The studio could not be loaded. Pull down or retry.',
                  action: FilledButton(
                    onPressed: () => _load(force: true),
                    child: const Text('Retry'),
                  ),
                )
              else ...[
                const _BusinessSectionLabel(
                  eyebrow: 'FRAMEWORK',
                  title: 'Choose how the model is structured',
                  subtitle:
                      'Pick one framework now. You can switch later and generate a new version without losing previous models.',
                ),
                const SizedBox(height: 9),

                if (_templates.isEmpty)
                  const EmptyState(
                    icon: Icons.view_quilt_outlined,
                    title: 'No frameworks available',
                    message:
                        'Business-model templates have not been configured yet.',
                  )
                else
                  _FrameworkSelector(
                    template: selected,
                    templateCount: _templates.length,
                    onTap: _chooseFramework,
                  ),

                const SizedBox(height: 11),

                _GenerateModelPanel(
                  templateName:
                      selected?['name']?.toString() ??
                      'Choose a framework',
                  generating: _generating,
                  hasCurrentModel: visibleModel != null,
                  enabled:
                      _templateId != null &&
                      !_generating,
                  changedFramework:
                      model != null &&
                      !_modelMatchesSelection,
                  onGenerate: _generate,
                ),

                if (visibleModel == null)
                  const SizedBox(height: 4)
                else ...[
                  _GeneratedModelHeader(
                    templateName:
                        currentTemplate['name']?.toString() ??
                        layoutName,
                    version:
                        _asInt(
                          visibleModel['version'],
                          fallback: 1,
                        ),
                    onPresentation: () =>
                        _openPresentation(visibleModel),
                  ),
                  const SizedBox(height: 10),
                  if (content.isEmpty)
                    const EmptyState(
                      icon: Icons.layers_outlined,
                      title: 'Model content unavailable',
                      message: 'Pull down to refresh the current model from the server.',
                    )
                  else
                    ...content.entries.toList().asMap().entries.map(
                      (indexed) {
                        final index = indexed.key;
                        final entry = indexed.value;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _ModelSectionCard(
                            number: index + 1,
                            title: _prettify(entry.key),
                            value: entry.value,
                            rose: index.isOdd,
                          ),
                        );
                      },
                    ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BusinessStudioHero extends StatelessWidget {
  const _BusinessStudioHero({
    required this.ideaTitle,
    required this.layoutName,
    required this.version,
    required this.acceptedContext,
  });

  final String ideaTitle;
  final String layoutName;
  final String version;
  final bool acceptedContext;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        13,
        12,
        13,
        12,
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
          stops: [0, .60, 1],
        ),
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .07),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 19,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -9,
            top: -14,
            child: Text(
              'BM',
              style: TextStyle(
                color: AppColors.primaryDark.withValues(alpha: .035),
                fontSize: 62,
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
                    width: 37,
                    height: 37,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF65C3BD),
                          Color(0xFF51AAA5),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.dashboard_customize_outlined,
                      color: Colors.white,
                      size: 17,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          acceptedContext
                              ? 'ACCEPTED IDEA · BUSINESS DESIGN'
                              : 'BUSINESS DESIGN STUDIO',
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 6.4,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .65,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          ideaTitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 12.2,
                            height: 1.16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Build a business model around the idea using the framework that fits it best.',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 8.2,
                  height: 1.38,
                ),
              ),
              const SizedBox(height: 9),
              Row(
                children: [
                  Expanded(
                    child: _StudioMeta(
                      icon: Icons.view_quilt_outlined,
                      label: 'FRAMEWORK',
                      value: layoutName,
                    ),
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: _StudioMeta(
                      icon: Icons.history_rounded,
                      label: 'VERSION',
                      value: version,
                      rose: true,
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

class _StudioMeta extends StatelessWidget {
  const _StudioMeta({
    required this.icon,
    required this.label,
    required this.value,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent =
        rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      height: 47,
      padding: const EdgeInsets.symmetric(horizontal: 9),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.pinkSoft.withValues(alpha: .70)
            : AppColors.primarySoft.withValues(alpha: .70),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: accent.withValues(alpha: .06),
        ),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            size: 14,
            color: accent,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 5.8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .5,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
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



class _BusinessSectionLabel extends StatelessWidget {
  const _BusinessSectionLabel({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
  });

  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome_rounded,
                size: 10,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 4),
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 5.8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .62,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13.8,
              height: 1.12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            subtitle,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.8,
              height: 1.36,
            ),
          ),
        ],
      ),
    );
  }
}

class _FrameworkSelector extends StatelessWidget {
  const _FrameworkSelector({
    required this.template,
    required this.templateCount,
    required this.onTap,
  });

  final Map<String, dynamic>? template;
  final int templateCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name =
        template?['name']?.toString() ??
        template?['key']?.toString() ??
        'Select a framework';

    final description =
        template?['description']?.toString() ??
        'Choose the structure that best matches this idea.';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(19),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(
            11,
            11,
            10,
            11,
          ),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFFF7FBFA),
                Color(0xFFECF7F4),
                AppColors.surfaceRose,
              ],
            ),
            borderRadius: BorderRadius.circular(19),
            border: Border.all(
              color: AppColors.primary
                  .withValues(alpha: .16),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep
                    .withValues(alpha: .035),
                blurRadius: 13,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 43,
                height: 43,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF68C5BF),
                      Color(0xFF51AAA5),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.view_quilt_outlined,
                  color: Colors.white,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text(
                          'SELECTED FRAMEWORK',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 5.7,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .52,
                          ),
                        ),
                        const SizedBox(width: 5),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white
                                .withValues(alpha: .72),
                            borderRadius:
                                BorderRadius.circular(999),
                          ),
                          child: Text(
                            '$templateCount options',
                            style: const TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 5.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 7),
              Container(
                width: 31,
                height: 31,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white
                      .withValues(alpha: .78),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 19,
                  color: AppColors.primaryDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FrameworkPickerSheet extends StatelessWidget {
  const _FrameworkPickerSheet({
    required this.templates,
    required this.selectedId,
  });

  final List<Map<String, dynamic>> templates;
  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final maxHeight =
        MediaQuery.sizeOf(context).height * .82;

    return SafeArea(
      top: false,
      child: Container(
        constraints: BoxConstraints(
          maxHeight: maxHeight,
        ),
        margin: const EdgeInsets.fromLTRB(
          8,
          0,
          8,
          8,
        ),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.surface,
              Color(0xFFF2F9F7),
              AppColors.surfaceRose,
            ],
          ),
          borderRadius: BorderRadius.circular(25),
          border: Border.all(
            color: Colors.white,
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep
                  .withValues(alpha: .14),
              blurRadius: 34,
              offset: const Offset(0, 13),
            ),
          ],
        ),
        child: Column(
          children: [
            const SizedBox(height: 9),
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.silver,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                14,
                13,
                14,
                10,
              ),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.dashboard_customize_outlined,
                      size: 17,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        Text(
                          'CHOOSE A FRAMEWORK',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 6.1,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .62,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Select the structure for your next business-model version.',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.2,
                            height: 1.32,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(
                  12,
                  2,
                  12,
                  14,
                ),
                physics: const BouncingScrollPhysics(),
                itemCount: templates.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(height: 6),
                itemBuilder: (context, index) {
                  final template = templates[index];
                  final id =
                      template['id']?.toString() ?? '';

                  return _TemplateCard(
                    index: index + 1,
                    template: template,
                    selected: id == selectedId,
                    onTap: () =>
                        Navigator.of(context).pop(id),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GenerateModelPanel extends StatelessWidget {
  const _GenerateModelPanel({
    required this.templateName,
    required this.generating,
    required this.hasCurrentModel,
    required this.enabled,
    required this.changedFramework,
    required this.onGenerate,
  });

  final String templateName;
  final bool generating;
  final bool hasCurrentModel;
  final bool enabled;
  final bool changedFramework;
  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        12,
        12,
        12,
        12,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: generating
              ? const [
                  Color(0xFFE7F6F2),
                  Color(0xFFFFF4F7),
                ]
              : const [
                  Color(0xFFF8FCFB),
                  Color(0xFFF0F8F5),
                ],
        ),
        borderRadius: BorderRadius.circular(19),
        border: Border.all(
          color: AppColors.primary
              .withValues(alpha: .11),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: generating
                      ? AppColors.primary
                      : AppColors.primarySoft,
                  borderRadius:
                      BorderRadius.circular(12),
                ),
                child: generating
                    ? const SizedBox(
                        width: 17,
                        height: 17,
                        child:
                            CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Icon(
                        hasCurrentModel
                            ? Icons.refresh_rounded
                            : Icons.auto_awesome_rounded,
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
                    Text(
                      generating
                          ? 'Building your model…'
                          : hasCurrentModel
                              ? 'Generate a new version'
                              : 'Ready to build',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.7,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      templateName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.4,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              if (!generating)
                FilledButton(
                  onPressed:
                      enabled ? onGenerate : null,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(43, 39),
                    padding:
                        const EdgeInsets.symmetric(
                      horizontal: 12,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                  ),
                  child: Icon(
                    hasCurrentModel
                        ? Icons.refresh_rounded
                        : Icons.arrow_forward_rounded,
                    size: 17,
                  ),
                ),
            ],
          ),
          if (generating) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: const LinearProgressIndicator(
                minHeight: 4,
                color: AppColors.primary,
                backgroundColor:
                    AppColors.primarySoft,
              ),
            ),
            const SizedBox(height: 7),
            const Row(
              children: [
                Icon(
                  Icons.auto_awesome_rounded,
                  size: 10,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 5),
                Expanded(
                  child: Text(
                    'AI is generating the framework sections. This can take up to about a minute; keep this page open.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 7.2,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          ] else if (changedFramework) ...[
            const SizedBox(height: 8),
            const Row(
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  size: 11,
                  color: AppColors.pinkDeep,
                ),
                SizedBox(width: 5),
                Expanded(
                  child: Text(
                    'You changed the framework. Generate once to create a new version; the previous model stays preserved.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 7.2,
                      height: 1.35,
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

class _GeneratedModelHeader extends StatelessWidget {
  const _GeneratedModelHeader({
    required this.templateName,
    required this.version,
    required this.onPresentation,
  });

  final String templateName;
  final int version;
  final VoidCallback onPresentation;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        12,
        11,
        10,
        11,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFF2FAF7),
            AppColors.surface,
            AppColors.surfaceRose,
          ],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: AppColors.primaryDark
              .withValues(alpha: .06),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(
              Icons.check_circle_outline_rounded,
              size: 17,
              color: AppColors.success,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  templateName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Version $version · presentation ready',
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 7.1,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          OutlinedButton(
            onPressed: onPresentation,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 36),
              padding:
                  const EdgeInsets.symmetric(
                horizontal: 10,
              ),
              shape: RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(11),
              ),
            ),
            child: const Row(
              children: [
                Icon(
                  Icons.visibility_outlined,
                  size: 13,
                ),
                SizedBox(width: 4),
                Text(
                  'View',
                  style: TextStyle(
                    fontSize: 7.8,
                    fontWeight: FontWeight.w900,
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

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({
    required this.index,
    required this.template,
    required this.selected,
    required this.onTap,
  });

  final int index;
  final Map<String, dynamic> template;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name =
        template['name']?.toString() ??
        template['key']?.toString() ??
        'Business model';

    final description =
        template['description']?.toString() ??
        'Professional business-model framework.';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.fromLTRB(
            11,
            10,
            10,
            10,
          ),
          decoration: BoxDecoration(
            gradient: selected
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFFE5F5F1),
                      AppColors.surfaceRose,
                    ],
                  )
                : null,
            color: selected
                ? null
                : Colors.white.withValues(alpha: .72),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .34)
                  : AppColors.primaryDark
                      .withValues(alpha: .055),
              width: selected ? 1.2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.primary
                      : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  index.toString().padLeft(2, '0'),
                  style: TextStyle(
                    color: selected
                        ? Colors.white
                        : AppColors.primaryDark,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .45,
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.5,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 25,
                height: 25,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected
                      ? AppColors.primary
                      : Colors.transparent,
                  border: Border.all(
                    color: selected
                        ? AppColors.primary
                        : AppColors.silver,
                  ),
                ),
                child: selected
                    ? const Icon(
                        Icons.check_rounded,
                        size: 14,
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



class _ModelSectionCard extends StatelessWidget {
  const _ModelSectionCard({
    required this.number,
    required this.title,
    required this.value,
    this.rose = false,
  });

  final int number;
  final String title;
  final dynamic value;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      tint: rose ? AppColors.surfaceRose.withValues(alpha: .54) : null,
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
                  color: rose ? AppColors.pinkSoft : AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  number.toString().padLeft(2, '0'),
                  style: TextStyle(
                    color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w900,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          _ContentValue(value: value),
        ],
      ),
    );
  }
}

class _BusinessModelPresentationSheet extends StatelessWidget {
  const _BusinessModelPresentationSheet({
    required this.ideaTitle,
    required this.templateName,
    required this.version,
    required this.content,
  });

  final String ideaTitle;
  final String templateName;
  final int version;
  final Map<String, dynamic> content;

  Future<void> _openPrintable(BuildContext context) async {
    final html = _buildPrintableHtml(
      ideaTitle: ideaTitle,
      templateName: templateName,
      version: version,
      content: content,
    );
    final uri = Uri.dataFromString(
      html,
      mimeType: 'text/html',
      encoding: utf8,
    );

    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      showAppSnackBar(
        context,
        'Printable view could not be opened on this device.',
        error: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .88,
      minChildSize: .58,
      maxChildSize: .96,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Presentation preview',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w900,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$ideaTitle · $templateName',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5),
                        ),
                      ],
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => _openPrintable(context),
                    icon: const Icon(Icons.print_outlined, size: 17),
                    label: const Text('Print / PDF'),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 30),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.primarySoft, AppColors.surfaceRose],
                      ),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'VOXIDENCE · BUSINESS MODEL',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .9,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          ideaTitle,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 21,
                            height: 1.15,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '$templateName · Version $version',
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  ...content.entries.toList().asMap().entries.map(
                    (indexed) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _ModelSectionCard(
                        number: indexed.key + 1,
                        title: _prettify(indexed.value.key),
                        value: indexed.value.value,
                        rose: indexed.key.isOdd,
                      ),
                    ),
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

class _ContentValue extends StatelessWidget {
  const _ContentValue({required this.value});

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
                      padding: EdgeInsets.only(top: 7),
                      child: Icon(Icons.circle, size: 5, color: AppColors.primary),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        _stringify(item),
                        style: Theme.of(context).textTheme.bodyMedium,
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
        children: (value as Map).entries
            .map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  '${_prettify(entry.key.toString())}: ${_stringify(entry.value)}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            )
            .toList(),
      );
    }

    return Text(_stringify(value), style: Theme.of(context).textTheme.bodyMedium);
  }
}


String? _cleanTitle(dynamic value) {
  final title = value?.toString().trim() ?? '';
  if (title.isEmpty) return null;

  final lower = title.toLowerCase();
  if (lower == 'voxidence idea' ||
      lower == 'untitled idea' ||
      lower == 'accepted opportunity') {
    return null;
  }

  return title;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const <String, dynamic>{};
}

int _asInt(dynamic value, {required int fallback}) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value') ?? fallback;
}

String _prettify(String value) {
  return value
      .replaceAllMapped(RegExp(r'([a-z0-9])([A-Z])'), (match) => '${match[1]} ${match[2]}')
      .replaceAll(RegExp(r'[-_]+'), ' ')
      .split(' ')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _stringify(dynamic value) {
  if (value is List) return value.map(_stringify).join(' · ');
  if (value is Map) {
    return value.entries
        .map((entry) => '${_prettify(entry.key.toString())}: ${_stringify(entry.value)}')
        .join(' · ');
  }
  return '$value';
}

String _buildPrintableHtml({
  required String ideaTitle,
  required String templateName,
  required int version,
  required Map<String, dynamic> content,
}) {
  const escape = HtmlEscape(HtmlEscapeMode.element);
  final sections = content.entries.toList().asMap().entries.map((indexed) {
    final entry = indexed.value;
    final number = (indexed.key + 1).toString().padLeft(2, '0');
    final title = escape.convert(_prettify(entry.key));
    final body = escape.convert(_stringify(entry.value));
    return '<section><span>$number</span><h2>$title</h2><p>$body</p></section>';
  }).join();

  return '''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape.convert(ideaTitle)} business model</title>
<style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#365f59;background:#faf9f6}.hero{padding:28px;border:1px solid #d9e8e3;border-radius:24px;background:linear-gradient(135deg,#e5f2ee,#fff4f3);margin-bottom:20px}.hero small{font-weight:800;letter-spacing:1px}.hero h1{font-size:30px;margin:10px 0 6px}.hero p{margin:0;color:#637a74}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}section{break-inside:avoid;padding:18px;border:1px solid #dde9e5;border-radius:18px;background:#fff}section span{font-size:11px;font-weight:900;color:#3f9b92}section h2{font-size:17px;margin:7px 0;color:#365f59}section p{font-size:13px;line-height:1.55;margin:0;color:#5f756f}@media(max-width:700px){body{padding:16px}.grid{grid-template-columns:1fr}}@media print{body{background:#fff;padding:10mm}.hero,section{box-shadow:none}}
</style></head><body><div class="hero"><small>VOXIDENCE · BUSINESS MODEL</small><h1>${escape.convert(ideaTitle)}</h1><p>${escape.convert(templateName)} · Version $version</p></div><div class="grid">$sections</div></body></html>''';
}
