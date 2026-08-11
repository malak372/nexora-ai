import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../home/widgets/common.dart';
import '../api/guest_idea_api.dart';

class GuestGenerateIdeaPage extends StatefulWidget {
  const GuestGenerateIdeaPage({super.key});

  @override
  State<GuestGenerateIdeaPage> createState() => _GuestGenerateIdeaPageState();
}

class _GuestGenerateIdeaPageState extends State<GuestGenerateIdeaPage> {
  static const _steps = <String>['Your signal', 'Focus', 'Location', 'Review'];

  static const _minDescriptionWords = 4;
  static const _maxDescriptionWords = 120;

  static const _terminalStatuses = <String>{'COMPLETED', 'FAILED', 'CANCELLED'};

  final _descriptionController = TextEditingController();
  final _countryController = TextEditingController(text: 'Palestine');
  final _cityController = TextEditingController();
  final _regionController = TextEditingController();

  int _step = 0;

  bool _loading = true;
  bool _submitting = false;
  bool _guestUsed = false;

  String _selectedDomainId = '';
  String _language = 'ANY';
  String _error = '';

  List<Map<String, dynamic>> _domains = const [];
  List<Map<String, dynamic>> _languages = const [];

  Map<String, dynamic>? _run;

  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();

    _descriptionController.addListener(_refreshDescriptionState);

    _initialize();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();

    _descriptionController
      ..removeListener(_refreshDescriptionState)
      ..dispose();

    _countryController.dispose();
    _cityController.dispose();
    _regionController.dispose();

    super.dispose();
  }

  void _refreshDescriptionState() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _initialize() async {
    try {
      final session = await GuestIdeaApi.instance.ensureGuestSession();

      final results = await Future.wait([
        GuestIdeaApi.instance.getAvailableDomains(),
        GuestIdeaApi.instance.getAvailableLanguages(),
      ]);

      if (!mounted) {
        return;
      }

      final languageItems = results[1];

      setState(() {
        _guestUsed = session['hasGenerated'] == true;

        _domains = results[0];
        _languages = languageItems;

        if (languageItems.isNotEmpty &&
            !languageItems.any(
              (item) => item['code']?.toString() == _language,
            )) {
          _language = languageItems.first['code']?.toString() ?? 'ANY';
        }
      });
    } on GuestIdeaException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  int get _wordCount {
    final text = _descriptionController.text.trim();

    if (text.isEmpty) {
      return 0;
    }

    return text.split(RegExp(r'\s+')).where((word) => word.isNotEmpty).length;
  }

  bool get _descriptionValid {
    return _wordCount >= _minDescriptionWords &&
        _wordCount <= _maxDescriptionWords;
  }

  bool get _descriptionTooLong {
    return _wordCount > _maxDescriptionWords;
  }

  bool get _canContinue {
    switch (_step) {
      case 0:
        return !_descriptionTooLong;

      case 1:
        return _descriptionValid || _selectedDomainId.isNotEmpty;

      case 2:
        return _countryController.text.trim().isNotEmpty;

      default:
        return true;
    }
  }

  Map<String, dynamic>? get _selectedDomain {
    for (final domain in _domains) {
      if (domain['id']?.toString() == _selectedDomainId) {
        return domain;
      }
    }

    return null;
  }

  String get _selectedDomainName {
    final domain = _selectedDomain;

    return domain?['name']?.toString() ??
        domain?['displayName']?.toString() ??
        'Auto-detected';
  }

  String get _selectedLanguageName {
    for (final language in _languages) {
      if (language['code']?.toString() == _language) {
        return language['name']?.toString() ?? _language;
      }
    }

    return _language;
  }

  void _previous() {
    FocusManager.instance.primaryFocus?.unfocus();

    setState(() {
      _error = '';
    });

    if (_step == 0) {
      Navigator.pop(context);
      return;
    }

    setState(() {
      _step--;
    });
  }

  void _continue() {
    FocusManager.instance.primaryFocus?.unfocus();

    if (!_canContinue) {
      if (_descriptionTooLong) {
        setState(() {
          _error =
              'Keep the description within $_maxDescriptionWords words before continuing.';
          _step = 0;
        });
      } else if (_step == 1) {
        setState(() {
          _error =
              'Choose a domain or write at least $_minDescriptionWords words.';
        });
      }

      return;
    }

    setState(() {
      _error = '';
      _step++;
    });
  }

  Future<void> _submit() async {
    if (_submitting) {
      return;
    }

    if (_descriptionTooLong) {
      setState(() {
        _error = 'Description must not exceed $_maxDescriptionWords words.';
        _step = 0;
      });

      return;
    }

    if (!_descriptionValid && _selectedDomainId.isEmpty) {
      setState(() {
        _error =
            'Choose a domain or write at least $_minDescriptionWords words.';
        _step = 1;
      });

      return;
    }

    setState(() {
      _submitting = true;
      _error = '';
    });

    final description = _descriptionController.text.trim();

    final city = _cityController.text.trim();

    final region = _regionController.text.trim();

    final payload = <String, dynamic>{
      if (description.isNotEmpty) 'description': description,

      if (_selectedDomainId.isNotEmpty) 'domainId': _selectedDomainId,

      'country': _countryController.text.trim(),

      if (city.isNotEmpty) 'city': city,

      if (region.isNotEmpty) 'region': region,

      'language': _language,
      'forceRefresh': false,
    };

    try {
      final queuedRun = await GuestIdeaApi.instance.generateIdea(payload);

      if (!mounted) {
        return;
      }

      setState(() {
        _run = <String, dynamic>{
          'id': queuedRun['runId'] ?? queuedRun['id'],
          'status': queuedRun['status'] ?? 'QUEUED',
          'progressPercent': queuedRun['progressPercent'] ?? 0,
        };
      });

      _startPolling();
    } on GuestIdeaException catch (error) {
      if (!mounted) {
        return;
      }

      if (error.isGenerationAlreadyRunning &&
          error.activeRunId != null &&
          error.activeRunId!.isNotEmpty) {
        await _resumeExistingRun(error.activeRunId!);
      } else if (error.isGuestLimitReached) {
        setState(() {
          _guestUsed = true;
          _run = null;
          _error = '';
        });
      } else {
        setState(() {
          _error = error.message;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  Future<void> _resumeExistingRun(String runId) async {
    try {
      final activeRun = await GuestIdeaApi.instance.getGenerationRun(runId);

      if (!mounted) {
        return;
      }

      setState(() {
        _run = activeRun;
        _error = '';
      });

      _startPolling();
    } on GuestIdeaException {
      if (!mounted) {
        return;
      }

      setState(() {
        _run = <String, dynamic>{
          'id': runId,
          'status': 'QUEUED',
          'progressPercent': 0,
        };

        _error = '';
      });

      _startPolling();
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();

    _pollTimer = Timer.periodic(const Duration(milliseconds: 1800), (_) {
      _refreshRun();
    });

    _refreshRun();
  }

  Future<void> _refreshRun() async {
    final runId = _run?['id']?.toString();

    final status = _run?['status']?.toString().toUpperCase();

    if (runId == null || runId.isEmpty || _terminalStatuses.contains(status)) {
      _pollTimer?.cancel();
      return;
    }

    try {
      final latest = await GuestIdeaApi.instance.getGenerationRun(runId);

      if (!mounted) {
        return;
      }

      setState(() {
        _run = latest;
        _error = '';

        if (latest['status']?.toString().toUpperCase() == 'COMPLETED') {
          _guestUsed = true;
        }
      });

      if (_terminalStatuses.contains(
        latest['status']?.toString().toUpperCase(),
      )) {
        _pollTimer?.cancel();
      }
    } on GuestIdeaException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,

      body: Stack(
        children: [
          const Positioned.fill(child: _GenerateBackground()),

          SafeArea(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 280),

              child: _loading
                  ? const _BootstrapView(key: ValueKey('loading'))
                  : _run != null
                  ? _buildRunView()
                  : _guestUsed
                  ? _buildLimitView()
                  : _buildFormView(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormView() {
    return SingleChildScrollView(
      key: const ValueKey('form'),

      physics: const BouncingScrollPhysics(),

      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,

      padding: const EdgeInsets.fromLTRB(14, 8, 14, 24),

      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 540),

          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,

            children: [
              _TopBar(onBack: () => Navigator.pop(context)),

              const SizedBox(height: 14),

              _Header(step: _step),

              const SizedBox(height: 12),

              _ProgressStrip(step: _step),

              const SizedBox(height: 12),

              _EvidenceFlow(step: _step),

              const SizedBox(height: 12),

              Container(
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.94),

                  borderRadius: BorderRadius.circular(24),

                  border: Border.all(color: AppColors.border),

                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: 0.055),

                      blurRadius: 30,

                      offset: const Offset(0, 14),
                    ),
                  ],
                ),

                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),

                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 220),

                        child: KeyedSubtree(
                          key: ValueKey(_step),

                          child: _buildStepContent(),
                        ),
                      ),
                    ),

                    if (_error.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),

                        child: _ErrorBanner(message: _error),
                      ),

                    _ActionBar(
                      step: _step,

                      stepCount: _steps.length,

                      canContinue: _canContinue,

                      submitting: _submitting,

                      onPrevious: _previous,

                      onContinue: _step == _steps.length - 1
                          ? _submit
                          : _continue,
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

  Widget _buildStepContent() {
    switch (_step) {
      case 0:
        return _buildSignalStep();

      case 1:
        return _buildFocusStep();

      case 2:
        return _buildLocationStep();

      default:
        return _buildReviewStep();
    }
  }

  Widget _buildSignalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,

      children: [
        const _SectionTitle(
          number: '01',
          title: 'Describe the signal',
          subtitle: 'Four words are enough to begin.',
        ),

        const SizedBox(height: 15),

        Stack(
          children: [
            TextField(
              controller: _descriptionController,

              maxLength: 2000,

              minLines: 6,

              maxLines: 9,

              style: const TextStyle(
                color: AppColors.textPrimary,

                fontSize: 13.5,

                height: 1.55,

                fontWeight: FontWeight.w600,
              ),

              decoration: InputDecoration(
                counterText: '',

                hintText:
                    'Example: Students struggle to coordinate shared transportation when class schedules change at short notice…',

                hintStyle: const TextStyle(
                  color: Color(0xFF9CA9A5),

                  fontSize: 12.5,

                  height: 1.45,
                ),

                contentPadding: const EdgeInsets.fromLTRB(15, 17, 48, 17),

                fillColor: const Color(0xFFFCFEFD),

                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(17),

                  borderSide: const BorderSide(color: AppColors.borderStrong),
                ),

                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(17),

                  borderSide: const BorderSide(color: AppColors.borderStrong),
                ),

                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(17),

                  borderSide: const BorderSide(
                    color: AppColors.primary,

                    width: 1.4,
                  ),
                ),
              ),
            ),

            const Positioned(
              top: 12,
              right: 12,

              child: _MiniIcon(icon: Icons.auto_awesome_rounded),
            ),
          ],
        ),

        const SizedBox(height: 8),

        Row(
          children: [
            Expanded(
              child: Text(
                _descriptionTooLong
                    ? 'Too long — keep it within $_maxDescriptionWords words.'
                    : _descriptionValid
                    ? 'Enough context to infer a domain automatically.'
                    : 'Write $_minDescriptionWords+ words, or choose a domain next.',

                style: TextStyle(
                  color: _descriptionTooLong
                      ? AppColors.pinkDeep
                      : AppColors.textMuted,

                  fontSize: 10.8,

                  fontWeight: FontWeight.w700,
                ),
              ),
            ),

            const SizedBox(width: 10),

            Text(
              '$_wordCount/$_maxDescriptionWords words',

              style: TextStyle(
                color: _descriptionTooLong
                    ? AppColors.pinkDeep
                    : AppColors.primaryDark,

                fontSize: 10.5,

                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildFocusStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,

      children: [
        const _SectionTitle(
          number: '02',

          title: 'Choose a software space',

          subtitle: 'Or let Voxidence infer the best fit from your signal.',
        ),

        const SizedBox(height: 15),

        if (_descriptionValid) ...[
          _DomainTile(
            title: 'Auto-detect the best domain',

            subtitle: 'Use the problem signal you already wrote.',

            icon: Icons.auto_awesome_rounded,

            selected: _selectedDomainId.isEmpty,

            onTap: () {
              setState(() {
                _selectedDomainId = '';
              });
            },

            emphasized: true,
          ),

          const SizedBox(height: 9),
        ],

        if (_domains.isEmpty)
          const _SoftNotice(
            icon: Icons.grid_view_rounded,

            title: 'No domains available yet',

            text:
                'Your written signal can still be used when it is detailed enough.',
          )
        else
          LayoutBuilder(
            builder: (context, constraints) {
              final itemWidth = (constraints.maxWidth - 9) / 2;

              return Wrap(
                spacing: 9,

                runSpacing: 9,

                children: _domains
                    .map((domain) {
                      final id = domain['id']?.toString() ?? '';

                      final name =
                          domain['name']?.toString() ??
                          domain['displayName']?.toString() ??
                          'Software';

                      return SizedBox(
                        width: itemWidth,

                        child: _DomainTile(
                          title: name,

                          icon: _domainIcon(name),

                          selected: _selectedDomainId == id,

                          onTap: () {
                            setState(() {
                              _selectedDomainId = id;
                            });
                          },
                        ),
                      );
                    })
                    .toList(growable: false),
              );
            },
          ),
      ],
    );
  }

  Widget _buildLocationStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,

      children: [
        const _SectionTitle(
          number: '03',

          title: 'Add local context',

          subtitle: 'Location helps shape relevance and realistic assumptions.',
        ),

        const SizedBox(height: 15),

        _LabeledField(
          label: 'Country',

          controller: _countryController,

          icon: Icons.public_rounded,

          hintText: 'Palestine',

          onChanged: (_) {
            setState(() {});
          },
        ),

        const SizedBox(height: 11),

        Row(
          crossAxisAlignment: CrossAxisAlignment.start,

          children: [
            Expanded(
              child: _LabeledField(
                label: 'City',

                controller: _cityController,

                icon: Icons.location_city_rounded,

                hintText: 'Nablus',
              ),
            ),

            const SizedBox(width: 10),

            Expanded(
              child: _LabeledField(
                label: 'Region',

                controller: _regionController,

                icon: Icons.location_on_outlined,

                hintText: 'West Bank',
              ),
            ),
          ],
        ),

        const SizedBox(height: 11),

        Text(
          'Language',

          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: AppColors.textSecondary,

            fontSize: 11.5,

            fontWeight: FontWeight.w900,
          ),
        ),

        const SizedBox(height: 6),

        DropdownButtonFormField<String>(
          initialValue: _language,

          isExpanded: true,

          icon: const Icon(Icons.keyboard_arrow_down_rounded),

          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.translate_rounded, size: 18),

            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          ),

          items:
              (_languages.isEmpty
                      ? const <Map<String, dynamic>>[
                          {'code': 'ANY', 'name': 'Any language'},
                        ]
                      : _languages)
                  .map((language) {
                    return DropdownMenuItem<String>(
                      value: language['code']?.toString() ?? 'ANY',

                      child: Text(
                        language['name']?.toString() ??
                            language['code']?.toString() ??
                            'Any language',

                        overflow: TextOverflow.ellipsis,

                        style: const TextStyle(
                          color: AppColors.textPrimary,

                          fontSize: 12.5,

                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    );
                  })
                  .toList(growable: false),

          onChanged: (value) {
            if (value != null) {
              setState(() {
                _language = value;
              });
            }
          },
        ),
      ],
    );
  }

  Widget _buildReviewStep() {
    final location = <String>[
      _cityController.text.trim(),
      _regionController.text.trim(),
      _countryController.text.trim(),
    ].where((part) => part.isNotEmpty).join(', ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,

      children: [
        const _SectionTitle(
          number: '04',

          title: 'Final discovery brief',

          subtitle: 'Everything Voxidence will start from.',
        ),

        const SizedBox(height: 15),

        Container(
          padding: const EdgeInsets.all(14),

          decoration: BoxDecoration(
            color: const Color(0xFFFBFDFC),

            borderRadius: BorderRadius.circular(16),

            border: Border.all(color: AppColors.border),
          ),

          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,

            children: [
              const Text(
                'PROBLEM SIGNAL',

                style: TextStyle(
                  color: AppColors.primaryDark,

                  fontSize: 9.5,

                  fontWeight: FontWeight.w900,

                  letterSpacing: 1,
                ),
              ),

              const SizedBox(height: 7),

              Text(
                _descriptionController.text.trim().isEmpty
                    ? 'No written signal — generation will use the selected domain.'
                    : _descriptionController.text.trim(),

                style: const TextStyle(
                  color: AppColors.textSecondary,

                  fontSize: 12.2,

                  height: 1.5,

                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 9),

        Row(
          children: [
            Expanded(
              child: _ReviewTile(label: 'Domain', value: _selectedDomainName),
            ),

            const SizedBox(width: 9),

            Expanded(
              child: _ReviewTile(
                label: 'Language',

                value: _selectedLanguageName,
              ),
            ),
          ],
        ),

        const SizedBox(height: 9),

        _ReviewTile(label: 'Location', value: location),

        const SizedBox(height: 10),

        const _ReadyBanner(),
      ],
    );
  }

  Widget _buildRunView() {
    final status = _run?['status']?.toString().toUpperCase() ?? 'QUEUED';

    final isCompleted = status == 'COMPLETED' && _run?['idea'] is Map;

    final isFailed = status == 'FAILED' || status == 'CANCELLED';

    if (isCompleted) {
      return _buildCompletedView(
        Map<String, dynamic>.from(_run!['idea'] as Map),
      );
    }

    if (isFailed) {
      return _buildFailedView(status);
    }

    final double progress =
        (((_run?['progressPercent'] as num?)?.toDouble() ?? 0.0).clamp(
          0.0,
          99.0,
        )).toDouble();

    return SingleChildScrollView(
      key: const ValueKey('generating'),

      physics: const BouncingScrollPhysics(),

      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),

      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),

          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,

            children: [
              _TopBar(onBack: () => Navigator.pop(context)),

              const SizedBox(height: 28),

              Container(
                padding: const EdgeInsets.fromLTRB(22, 28, 22, 24),

                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.95),

                  borderRadius: BorderRadius.circular(28),

                  border: Border.all(color: AppColors.border),

                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: 0.06),

                      blurRadius: 34,

                      offset: const Offset(0, 16),
                    ),
                  ],
                ),

                child: Column(
                  children: [
                    const _GenerationOrb(),

                    const SizedBox(height: 24),

                    const Text(
                      'Turning evidence into direction',

                      textAlign: TextAlign.center,

                      style: TextStyle(
                        color: AppColors.textPrimary,

                        fontSize: 22,

                        height: 1.08,

                        fontWeight: FontWeight.w900,

                        letterSpacing: -0.5,
                      ),
                    ),

                    const SizedBox(height: 9),

                    Text(
                      _progressMessage(progress),

                      textAlign: TextAlign.center,

                      style: const TextStyle(
                        color: AppColors.textSecondary,

                        fontSize: 12.5,

                        height: 1.5,

                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 24),

                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),

                      child: LinearProgressIndicator(
                        value: progress / 100,

                        minHeight: 7,

                        backgroundColor: AppColors.primarySoft,

                        valueColor: const AlwaysStoppedAnimation(
                          AppColors.primary,
                        ),
                      ),
                    ),

                    const SizedBox(height: 9),

                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,

                      children: [
                        const Text(
                          'Evidence-led discovery',

                          style: TextStyle(
                            color: AppColors.textMuted,

                            fontSize: 10.5,

                            fontWeight: FontWeight.w800,
                          ),
                        ),

                        Text(
                          '${progress.round()}%',

                          style: const TextStyle(
                            color: AppColors.primaryDark,

                            fontSize: 11,

                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),

                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 16),

                      _ErrorBanner(message: _error),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCompletedView(Map<String, dynamic> idea) {
    final objectives = _stringList(idea['objectives']);

    final targetUsers = _stringList(idea['targetUsers']);

    return SingleChildScrollView(
      key: const ValueKey('completed'),

      physics: const BouncingScrollPhysics(),

      padding: const EdgeInsets.fromLTRB(16, 12, 16, 30),

      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),

          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,

            children: [
              _TopBar(onBack: () => Navigator.pop(context)),

              const SizedBox(height: 20),

              Container(
                padding: const EdgeInsets.all(20),

                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.95),

                  borderRadius: BorderRadius.circular(27),

                  border: Border.all(color: AppColors.border),

                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: 0.06),

                      blurRadius: 30,

                      offset: const Offset(0, 14),
                    ),
                  ],
                ),

                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,

                  children: [
                    const _SuccessBadge(),

                    const SizedBox(height: 16),

                    Text(
                      idea['title']?.toString() ?? 'Your idea is ready',

                      style: const TextStyle(
                        color: AppColors.textPrimary,

                        fontSize: 24,

                        height: 1.08,

                        fontWeight: FontWeight.w900,

                        letterSpacing: -0.55,
                      ),
                    ),

                    const SizedBox(height: 10),

                    Text(
                      idea['limitedAbstract']?.toString() ??
                          'Your evidence-backed software idea is ready.',

                      style: const TextStyle(
                        color: AppColors.textSecondary,

                        fontSize: 12.8,

                        height: 1.55,

                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    if ((idea['problemStatement']?.toString() ?? '')
                        .isNotEmpty) ...[
                      const SizedBox(height: 18),

                      _ResultSection(
                        title: 'Problem',

                        text: idea['problemStatement'].toString(),
                      ),
                    ],

                    if (objectives.isNotEmpty) ...[
                      const SizedBox(height: 12),

                      _ResultList(title: 'Objectives', items: objectives),
                    ],

                    if (targetUsers.isNotEmpty) ...[
                      const SizedBox(height: 12),

                      _ResultList(title: 'Target users', items: targetUsers),
                    ],

                    const SizedBox(height: 20),

                    Container(
                      padding: const EdgeInsets.all(13),

                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,

                        borderRadius: BorderRadius.circular(16),

                        border: Border.all(color: AppColors.borderStrong),
                      ),

                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,

                        children: [
                          Icon(
                            Icons.bookmark_add_outlined,

                            color: AppColors.primaryDark,

                            size: 19,
                          ),

                          SizedBox(width: 10),

                          Expanded(
                            child: Text(
                              'Create a free account to keep this discovery and generate more ideas.',

                              style: TextStyle(
                                color: AppColors.textPrimary,

                                fontSize: 11.7,

                                height: 1.45,

                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 12),

                    SizedBox(
                      width: double.infinity,

                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.pushNamed(context, '/register');
                        },

                        icon: const Icon(
                          Icons.person_add_alt_1_rounded,

                          size: 18,
                        ),

                        label: const Text(
                          'Create free account',

                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

                    SizedBox(
                      width: double.infinity,

                      child: OutlinedButton(
                        onPressed: () {
                          Navigator.pushNamed(context, '/login');
                        },

                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryDark,

                          side: const BorderSide(color: AppColors.borderStrong),

                          padding: const EdgeInsets.symmetric(vertical: 13),

                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(15),
                          ),
                        ),

                        child: const Text(
                          'Sign in instead',

                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
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

  Widget _buildFailedView(String status) {
    return Center(
      key: const ValueKey('failed'),

      child: SingleChildScrollView(
        padding: const EdgeInsets.all(18),

        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 470),

          child: Container(
            padding: const EdgeInsets.all(22),

            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.95),

              borderRadius: BorderRadius.circular(25),

              border: Border.all(color: AppColors.border),
            ),

            child: Column(
              children: [
                Container(
                  width: 52,

                  height: 52,

                  decoration: BoxDecoration(
                    color: AppColors.pinkSoft,

                    borderRadius: BorderRadius.circular(17),
                  ),

                  child: const Icon(
                    Icons.refresh_rounded,

                    color: AppColors.pinkDeep,
                  ),
                ),

                const SizedBox(height: 15),

                Text(
                  status == 'CANCELLED'
                      ? 'Generation was cancelled'
                      : 'Generation needs another try',

                  textAlign: TextAlign.center,

                  style: const TextStyle(
                    color: AppColors.textPrimary,

                    fontSize: 20,

                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 8),

                Text(
                  _run?['errorMessage']?.toString() ??
                      'Your input is still available, so you can review it and try again.',

                  textAlign: TextAlign.center,

                  style: const TextStyle(
                    color: AppColors.textSecondary,

                    fontSize: 12.5,

                    height: 1.5,
                  ),
                ),

                const SizedBox(height: 18),

                SizedBox(
                  width: double.infinity,

                  child: FilledButton.icon(
                    onPressed: () {
                      _pollTimer?.cancel();

                      setState(() {
                        _run = null;
                        _step = 3;
                        _error = '';
                      });
                    },

                    icon: const Icon(Icons.arrow_back_rounded, size: 18),

                    label: const Text('Review and try again'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLimitView() {
    return SingleChildScrollView(
      key: const ValueKey('limit'),

      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),

      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500),

          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,

            children: [
              _TopBar(onBack: () => Navigator.pop(context)),

              const SizedBox(height: 24),

              Container(
                padding: const EdgeInsets.all(22),

                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.95),

                  borderRadius: BorderRadius.circular(27),

                  border: Border.all(color: AppColors.border),

                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: 0.055),

                      blurRadius: 30,

                      offset: const Offset(0, 14),
                    ),
                  ],
                ),

                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,

                  children: [
                    const _LimitBadge(),

                    const SizedBox(height: 18),

                    const Text(
                      'Your free discovery is complete.',

                      style: TextStyle(
                        color: AppColors.textPrimary,

                        fontSize: 25,

                        height: 1.08,

                        fontWeight: FontWeight.w900,

                        letterSpacing: -0.55,
                      ),
                    ),

                    const SizedBox(height: 10),

                    const Text(
                      'Your guest idea has already been used. Create a free Voxidence account to generate more ideas and save your discoveries.',

                      style: TextStyle(
                        color: AppColors.textSecondary,

                        fontSize: 12.8,

                        height: 1.55,

                        fontWeight: FontWeight.w600,
                      ),
                    ),

                    const SizedBox(height: 18),

                    const _BenefitTile(
                      icon: Icons.auto_awesome_rounded,

                      text: 'More idea attempts',
                    ),

                    const SizedBox(height: 8),

                    const _BenefitTile(
                      icon: Icons.bookmark_border_rounded,

                      text: 'Saved discoveries',
                    ),

                    const SizedBox(height: 8),

                    const _BenefitTile(
                      icon: Icons.dashboard_customize_outlined,

                      text: 'Your own workspace',
                    ),

                    const SizedBox(height: 18),

                    SizedBox(
                      width: double.infinity,

                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.pushNamed(context, '/register');
                        },

                        icon: const Icon(
                          Icons.person_add_alt_1_rounded,

                          size: 18,
                        ),

                        label: const Text(
                          'Create free account',

                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),

                    SizedBox(
                      width: double.infinity,

                      child: OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pushNamed(context, '/login');
                        },

                        icon: const Icon(Icons.login_rounded, size: 17),

                        label: const Text('Sign in'),

                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primaryDark,

                          side: const BorderSide(color: AppColors.borderStrong),

                          padding: const EdgeInsets.symmetric(vertical: 13),

                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(15),
                          ),
                        ),
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

  IconData _domainIcon(String name) {
    final value = name.toLowerCase();

    if (value.contains('health')) {
      return Icons.health_and_safety_outlined;
    }

    if (value.contains('education')) {
      return Icons.school_outlined;
    }

    if (value.contains('finance')) {
      return Icons.account_balance_wallet_outlined;
    }

    if (value.contains('business')) {
      return Icons.business_center_outlined;
    }

    if (value.contains('security')) {
      return Icons.shield_outlined;
    }

    if (value.contains('commerce') || value.contains('retail')) {
      return Icons.shopping_bag_outlined;
    }

    if (value.contains('transport')) {
      return Icons.directions_car_outlined;
    }

    if (value.contains('ai') || value.contains('artificial')) {
      return Icons.psychology_alt_outlined;
    }

    return Icons.apps_rounded;
  }

  String _progressMessage(double progress) {
    if (progress < 20) {
      return 'Exploring real-world needs around your signal…';
    }

    if (progress < 45) {
      return 'Finding meaningful opportunities worth building…';
    }

    if (progress < 70) {
      return 'Shaping a focused software direction…';
    }

    if (progress < 90) {
      return 'Refining the concept for clarity and value…';
    }

    return 'Preparing your discovery…';
  }

  List<String> _stringList(dynamic value) {
    if (value is List) {
      return value
          .map((item) => item.toString())
          .where((item) => item.trim().isNotEmpty)
          .toList();
    }

    if (value is String && value.trim().isNotEmpty) {
      return <String>[value.trim()];
    }

    return const <String>[];
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        InkWell(
          onTap: onBack,

          borderRadius: BorderRadius.circular(14),

          child: Container(
            width: 39,

            height: 39,

            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.86),

              borderRadius: BorderRadius.circular(14),

              border: Border.all(color: AppColors.border),
            ),

            child: const Icon(
              Icons.arrow_back_rounded,

              size: 18,

              color: AppColors.primaryDeep,
            ),
          ),
        ),

        const SizedBox(width: 10),

        const BrandMark(size: 34),

        const SizedBox(width: 7),

        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,

            children: [
              Text(
                'Voxidence',

                style: TextStyle(
                  color: AppColors.primaryDeep,

                  fontSize: 13.5,

                  fontWeight: FontWeight.w900,
                ),
              ),

              Text(
                'Evidence-led idea discovery',

                overflow: TextOverflow.ellipsis,

                style: TextStyle(
                  color: AppColors.textMuted,

                  fontSize: 8.5,

                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),

        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),

          decoration: BoxDecoration(
            color: AppColors.primarySoft.withValues(alpha: 0.9),

            borderRadius: BorderRadius.circular(999),

            border: Border.all(color: AppColors.borderStrong),
          ),

          child: const Row(
            mainAxisSize: MainAxisSize.min,

            children: [
              Icon(
                Icons.auto_awesome_rounded,

                size: 13,

                color: AppColors.primaryDark,
              ),

              SizedBox(width: 5),

              Text(
                '1 free idea',

                style: TextStyle(
                  color: AppColors.primaryDark,

                  fontSize: 9.5,

                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.step});

  final int step;

  static const _titles = <String>[
    'Start with the problem, not the solution.',
    'Give the signal a direction.',
    'Anchor the idea in a real place.',
    'Your discovery brief is ready.',
  ];

  static const _descriptions = <String>[
    'Tell us what keeps going wrong, who feels it, and why it matters.',
    'Choose a software space, or let Voxidence infer the best fit from your signal.',
    'Local context helps shape relevance and realistic market assumptions.',
    'Check the essentials once, then turn them into an evidence-backed software idea.',
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(17, 18, 17, 17),

      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.66),

        borderRadius: BorderRadius.circular(22),

        border: Border.all(color: AppColors.border.withValues(alpha: 0.8)),
      ),

      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          Row(
            children: [
              Text(
                'STEP ${(step + 1).toString().padLeft(2, '0')}',

                style: const TextStyle(
                  color: AppColors.primaryDark,

                  fontSize: 9.3,

                  fontWeight: FontWeight.w900,

                  letterSpacing: 1.2,
                ),
              ),

              Container(
                width: 21,

                height: 1,

                margin: const EdgeInsets.symmetric(horizontal: 8),

                color: AppColors.primary.withValues(alpha: 0.55),
              ),

              Text(
                _GuestGenerateIdeaPageState._steps[step].toUpperCase(),

                style: const TextStyle(
                  color: AppColors.primaryDark,

                  fontSize: 9.3,

                  fontWeight: FontWeight.w900,

                  letterSpacing: 0.9,
                ),
              ),
            ],
          ),

          const SizedBox(height: 9),

          Text(
            _titles[step],

            style: const TextStyle(
              color: AppColors.textPrimary,

              fontSize: 23,

              height: 1.05,

              fontWeight: FontWeight.w900,

              letterSpacing: -0.65,
            ),
          ),

          const SizedBox(height: 8),

          Text(
            _descriptions[step],

            style: const TextStyle(
              color: AppColors.textSecondary,

              fontSize: 11.8,

              height: 1.48,

              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressStrip extends StatelessWidget {
  const _ProgressStrip({required this.step});

  final int step;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(_GuestGenerateIdeaPageState._steps.length, (
        index,
      ) {
        final active = index == step;

        final done = index < step;

        return Expanded(
          child: Row(
            children: [
              Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),

                  padding: const EdgeInsets.symmetric(
                    vertical: 9,
                    horizontal: 4,
                  ),

                  decoration: BoxDecoration(
                    color: active ? AppColors.primarySoft : Colors.transparent,

                    borderRadius: BorderRadius.circular(13),
                  ),

                  child: Column(
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 200),

                        width: 27,

                        height: 27,

                        decoration: BoxDecoration(
                          color: active
                              ? AppColors.primary
                              : done
                              ? const Color(0xFFE2F2EE)
                              : Colors.white.withValues(alpha: 0.84),

                          borderRadius: BorderRadius.circular(9),

                          border: Border.all(
                            color: active
                                ? AppColors.primary
                                : AppColors.borderStrong,
                          ),
                        ),

                        child: Center(
                          child: done
                              ? const Icon(
                                  Icons.check_rounded,

                                  size: 14,

                                  color: AppColors.primaryDark,
                                )
                              : Text(
                                  '${index + 1}',

                                  style: TextStyle(
                                    color: active
                                        ? Colors.white
                                        : AppColors.textMuted,

                                    fontSize: 10,

                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                        ),
                      ),

                      const SizedBox(height: 5),

                      Text(
                        _GuestGenerateIdeaPageState._steps[index],

                        maxLines: 1,

                        overflow: TextOverflow.ellipsis,

                        style: TextStyle(
                          color: active || done
                              ? AppColors.primaryDeep
                              : AppColors.textMuted,

                          fontSize: 8.8,

                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              if (index < _GuestGenerateIdeaPageState._steps.length - 1)
                Container(
                  width: 5,

                  height: 1,

                  color: index < step
                      ? AppColors.primary
                      : AppColors.borderStrong,
                ),
            ],
          ),
        );
      }),
    );
  }
}

class _EvidenceFlow extends StatelessWidget {
  const _EvidenceFlow({required this.step});

  final int step;

  static const _labels = <String>['Listen', 'Focus', 'Ground', 'Build'];

  static const _icons = <IconData>[
    Icons.graphic_eq_rounded,
    Icons.lightbulb_outline_rounded,
    Icons.location_on_outlined,
    Icons.auto_awesome_rounded,
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(13, 11, 13, 11),

      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.primarySoft.withValues(alpha: 0.82),

            Colors.white.withValues(alpha: 0.9),

            AppColors.pinkSoft.withValues(alpha: 0.58),
          ],
        ),

        borderRadius: BorderRadius.circular(18),

        border: Border.all(color: AppColors.border),
      ),

      child: Row(
        children: List.generate(_labels.length, (index) {
          final enabled = index <= step;

          return Expanded(
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      Container(
                        width: 29,

                        height: 29,

                        decoration: BoxDecoration(
                          color: enabled
                              ? Colors.white
                              : Colors.white.withValues(alpha: 0.55),

                          borderRadius: BorderRadius.circular(10),

                          border: Border.all(
                            color: enabled
                                ? AppColors.borderStrong
                                : AppColors.border,
                          ),
                        ),

                        child: Icon(
                          _icons[index],

                          size: 14,

                          color: enabled
                              ? AppColors.primaryDark
                              : AppColors.textMuted,
                        ),
                      ),

                      const SizedBox(height: 4),

                      Text(
                        _labels[index],

                        style: TextStyle(
                          color: enabled
                              ? AppColors.primaryDeep
                              : AppColors.textMuted,

                          fontSize: 8.7,

                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),

                if (index < _labels.length - 1)
                  Icon(
                    Icons.arrow_forward_rounded,

                    size: 12,

                    color: index < step
                        ? AppColors.primary
                        : AppColors.borderStrong,
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.number,
    required this.title,
    required this.subtitle,
  });

  final String number;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,

      children: [
        Container(
          width: 38,
          height: 38,

          decoration: BoxDecoration(
            color: AppColors.primarySoft,

            borderRadius: BorderRadius.circular(12),

            border: Border.all(color: AppColors.borderStrong),
          ),

          child: Center(
            child: Text(
              number,

              style: const TextStyle(
                color: AppColors.primaryDark,

                fontSize: 10,

                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),

        const SizedBox(width: 10),

        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,

            children: [
              Text(
                title,

                style: const TextStyle(
                  color: AppColors.textPrimary,

                  fontSize: 14,

                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 2),

              Text(
                subtitle,

                style: const TextStyle(
                  color: AppColors.textMuted,

                  fontSize: 10.5,

                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MiniIcon extends StatelessWidget {
  const _MiniIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 31,

      height: 31,

      decoration: BoxDecoration(
        color: AppColors.primarySoft,

        borderRadius: BorderRadius.circular(10),
      ),

      child: Icon(icon, size: 14, color: AppColors.primaryDark),
    );
  }
}

class _DomainTile extends StatelessWidget {
  const _DomainTile({
    required this.title,
    required this.icon,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.emphasized = false,
  });

  final String title;

  final String? subtitle;

  final IconData icon;

  final bool selected;

  final VoidCallback onTap;

  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,

      child: InkWell(
        onTap: onTap,

        borderRadius: BorderRadius.circular(15),

        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),

          constraints: BoxConstraints(minHeight: emphasized ? 64.0 : 58.0),

          padding: const EdgeInsets.all(10),

          decoration: BoxDecoration(
            color: selected ? AppColors.primarySoft : Colors.white,

            borderRadius: BorderRadius.circular(15),

            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: 0.62)
                  : AppColors.border,
            ),

            boxShadow: emphasized
                ? [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: 0.035),

                      blurRadius: 16,

                      offset: const Offset(0, 7),
                    ),
                  ]
                : null,
          ),

          child: Row(
            children: [
              Container(
                width: 36,

                height: 36,

                decoration: BoxDecoration(
                  color: emphasized
                      ? AppColors.primary
                      : const Color(0xFFF3F9F7),

                  borderRadius: BorderRadius.circular(11),
                ),

                child: Icon(
                  icon,

                  size: 17,

                  color: emphasized ? Colors.white : AppColors.primaryDark,
                ),
              ),

              const SizedBox(width: 9),

              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,

                  crossAxisAlignment: CrossAxisAlignment.start,

                  children: [
                    Text(
                      title,

                      maxLines: emphasized ? 1 : 2,

                      overflow: TextOverflow.ellipsis,

                      style: const TextStyle(
                        color: AppColors.textPrimary,

                        fontSize: 10.8,

                        height: 1.2,

                        fontWeight: FontWeight.w900,
                      ),
                    ),

                    if (subtitle != null) ...[
                      const SizedBox(height: 2),

                      Text(
                        subtitle!,

                        maxLines: 1,

                        overflow: TextOverflow.ellipsis,

                        style: const TextStyle(
                          color: AppColors.textMuted,

                          fontSize: 9.3,

                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              ),

              AnimatedOpacity(
                duration: const Duration(milliseconds: 160),

                opacity: selected ? 1 : 0,

                child: const Icon(
                  Icons.check_circle_rounded,

                  size: 17,

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

class _LabeledField extends StatelessWidget {
  const _LabeledField({
    required this.label,
    required this.controller,
    required this.icon,
    required this.hintText,
    this.onChanged,
  });

  final String label;

  final TextEditingController controller;

  final IconData icon;

  final String hintText;

  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,

      children: [
        Text(
          label,

          style: const TextStyle(
            color: AppColors.textSecondary,

            fontSize: 11.5,

            fontWeight: FontWeight.w900,
          ),
        ),

        const SizedBox(height: 6),

        TextField(
          controller: controller,

          onChanged: onChanged,

          style: const TextStyle(
            color: AppColors.textPrimary,

            fontSize: 12.5,

            fontWeight: FontWeight.w700,
          ),

          decoration: InputDecoration(
            hintText: hintText,

            prefixIcon: Icon(icon, size: 18),

            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 13,
            ),
          ),
        ),
      ],
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.label, required this.value});

  final String label;

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),

      decoration: BoxDecoration(
        color: const Color(0xFFFBFDFC),

        borderRadius: BorderRadius.circular(13),

        border: Border.all(color: AppColors.border),
      ),

      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          Text(
            label,

            style: const TextStyle(
              color: AppColors.textMuted,

              fontSize: 9.2,

              fontWeight: FontWeight.w800,
            ),
          ),

          const SizedBox(height: 3),

          Text(
            value.isEmpty ? '—' : value,

            maxLines: 2,

            overflow: TextOverflow.ellipsis,

            style: const TextStyle(
              color: AppColors.textPrimary,

              fontSize: 10.8,

              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReadyBanner extends StatelessWidget {
  const _ReadyBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),

      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFEDF8F5), Colors.white],
        ),

        borderRadius: BorderRadius.circular(14),

        border: Border.all(color: AppColors.borderStrong),
      ),

      child: const Row(
        children: [
          _MiniIcon(icon: Icons.check_rounded),

          SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,

              children: [
                Text(
                  'Ready to discover',

                  style: TextStyle(
                    color: AppColors.textPrimary,

                    fontSize: 11.5,

                    fontWeight: FontWeight.w900,
                  ),
                ),

                SizedBox(height: 1),

                Text(
                  'Your free guest idea will start from this brief.',

                  style: TextStyle(
                    color: AppColors.textMuted,

                    fontSize: 9.7,

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

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.step,
    required this.stepCount,
    required this.canContinue,
    required this.submitting,
    required this.onPrevious,
    required this.onContinue,
  });

  final int step;

  final int stepCount;

  final bool canContinue;

  final bool submitting;

  final VoidCallback onPrevious;

  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    final isLast = step == stepCount - 1;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 13),

      decoration: const BoxDecoration(
        color: Color(0xFFF8FCFA),

        border: Border(top: BorderSide(color: AppColors.border)),

        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
      ),

      child: Row(
        children: [
          OutlinedButton.icon(
            onPressed: onPrevious,

            icon: const Icon(Icons.arrow_back_rounded, size: 15),

            label: Text(step == 0 ? 'Cancel' : 'Previous'),

            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primaryDeep,

              backgroundColor: Colors.white,

              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),

              side: const BorderSide(color: AppColors.borderStrong),

              textStyle: const TextStyle(
                fontSize: 10.5,

                fontWeight: FontWeight.w900,
              ),

              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(13),
              ),
            ),
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Text(
              '${step + 1} of $stepCount',

              textAlign: TextAlign.center,

              style: const TextStyle(
                color: AppColors.textMuted,

                fontSize: 9.5,

                fontWeight: FontWeight.w900,

                letterSpacing: 0.7,
              ),
            ),
          ),

          const SizedBox(width: 8),

          FilledButton.icon(
            onPressed: canContinue && !submitting ? onContinue : null,

            icon: submitting
                ? const SizedBox(
                    width: 14,

                    height: 14,

                    child: CircularProgressIndicator(
                      strokeWidth: 2,

                      color: Colors.white,
                    ),
                  )
                : Icon(
                    isLast
                        ? Icons.auto_awesome_rounded
                        : Icons.arrow_forward_rounded,

                    size: 15,
                  ),

            label: Text(isLast ? 'Generate' : 'Continue'),

            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),

              textStyle: const TextStyle(
                fontSize: 10.5,

                fontWeight: FontWeight.w900,
              ),

              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,

      padding: const EdgeInsets.all(11),

      decoration: BoxDecoration(
        color: AppColors.pinkSoft,

        borderRadius: BorderRadius.circular(13),

        border: Border.all(color: AppColors.pinkLight),
      ),

      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          const Icon(
            Icons.error_outline_rounded,

            color: AppColors.pinkDeep,

            size: 17,
          ),

          const SizedBox(width: 8),

          Expanded(
            child: Text(
              message,

              style: const TextStyle(
                color: AppColors.textPrimary,

                fontSize: 10.7,

                height: 1.4,

                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SoftNotice extends StatelessWidget {
  const _SoftNotice({
    required this.icon,
    required this.title,
    required this.text,
  });

  final IconData icon;

  final String title;

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(13),

      decoration: BoxDecoration(
        color: AppColors.primarySoft,

        borderRadius: BorderRadius.circular(15),

        border: Border.all(color: AppColors.borderStrong),
      ),

      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          Icon(icon, size: 18, color: AppColors.primaryDark),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,

              children: [
                Text(
                  title,

                  style: const TextStyle(
                    color: AppColors.textPrimary,

                    fontSize: 11.5,

                    fontWeight: FontWeight.w900,
                  ),
                ),

                const SizedBox(height: 2),

                Text(
                  text,

                  style: const TextStyle(
                    color: AppColors.textSecondary,

                    fontSize: 10.2,

                    height: 1.4,

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

class _BootstrapView extends StatelessWidget {
  const _BootstrapView({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),

        child: Column(
          mainAxisSize: MainAxisSize.min,

          children: [
            Stack(
              alignment: Alignment.center,

              children: [
                Container(
                  width: 100,

                  height: 100,

                  decoration: BoxDecoration(
                    shape: BoxShape.circle,

                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: 0.22),
                    ),
                  ),
                ),

                Container(
                  width: 70,

                  height: 70,

                  decoration: BoxDecoration(
                    shape: BoxShape.circle,

                    border: Border.all(color: AppColors.borderStrong),
                  ),
                ),

                Container(
                  width: 48,

                  height: 48,

                  decoration: BoxDecoration(
                    color: AppColors.primary,

                    borderRadius: BorderRadius.circular(16),

                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withValues(alpha: 0.2),

                        blurRadius: 22,

                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),

                  child: const Icon(
                    Icons.lightbulb_outline_rounded,

                    color: Colors.white,

                    size: 22,
                  ),
                ),
              ],
            ),

            const SizedBox(height: 18),

            const Text(
              'VOXIDENCE GUEST STUDIO',

              style: TextStyle(
                color: AppColors.primaryDark,

                fontSize: 9.5,

                fontWeight: FontWeight.w900,

                letterSpacing: 1.2,
              ),
            ),

            const SizedBox(height: 5),

            const Text(
              'Preparing your discovery space',

              textAlign: TextAlign.center,

              style: TextStyle(
                color: AppColors.textPrimary,

                fontSize: 17,

                fontWeight: FontWeight.w900,
              ),
            ),

            const SizedBox(height: 5),

            const Text(
              'Loading the domains and context you can build from.',

              textAlign: TextAlign.center,

              style: TextStyle(
                color: AppColors.textMuted,

                fontSize: 11.5,

                fontWeight: FontWeight.w600,
              ),
            ),

            const SizedBox(height: 17),

            const SizedBox(
              width: 150,

              child: LinearProgressIndicator(
                minHeight: 4,

                backgroundColor: AppColors.primarySoft,

                valueColor: AlwaysStoppedAnimation(AppColors.primary),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GenerationOrb extends StatelessWidget {
  const _GenerationOrb();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 138,

      height: 138,

      child: Stack(
        alignment: Alignment.center,

        children: [
          Container(
            width: 132,

            height: 132,

            decoration: BoxDecoration(
              shape: BoxShape.circle,

              border: Border.all(
                color: AppColors.primary.withValues(alpha: 0.16),
              ),
            ),
          ),

          Container(
            width: 100,

            height: 100,

            decoration: BoxDecoration(
              shape: BoxShape.circle,

              color: AppColors.primarySoft.withValues(alpha: 0.72),
            ),
          ),

          Container(
            width: 64,

            height: 64,

            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,

                end: Alignment.bottomRight,

                colors: [Color(0xFF68C8C2), Color(0xFF46AAA4)],
              ),

              borderRadius: BorderRadius.circular(22),

              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.24),

                  blurRadius: 25,

                  offset: const Offset(0, 12),
                ),
              ],
            ),

            child: const Icon(
              Icons.auto_awesome_rounded,

              color: Colors.white,

              size: 26,
            ),
          ),

          const Positioned(
            top: 15,

            right: 29,

            child: _OrbitDot(color: AppColors.primary),
          ),

          const Positioned(
            bottom: 21,

            left: 24,

            child: _OrbitDot(color: AppColors.pinkLight),
          ),

          const Positioned(
            bottom: 16,

            right: 39,

            child: _OrbitDot(color: AppColors.primaryDark),
          ),
        ],
      ),
    );
  }
}

class _OrbitDot extends StatelessWidget {
  const _OrbitDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 9,

      height: 9,

      decoration: BoxDecoration(
        color: color,

        shape: BoxShape.circle,

        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.16),

            blurRadius: 0,

            spreadRadius: 5,
          ),
        ],
      ),
    );
  }
}

class _SuccessBadge extends StatelessWidget {
  const _SuccessBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),

      decoration: BoxDecoration(
        color: AppColors.primarySoft,

        borderRadius: BorderRadius.circular(999),

        border: Border.all(color: AppColors.borderStrong),
      ),

      child: const Row(
        mainAxisSize: MainAxisSize.min,

        children: [
          Icon(
            Icons.check_circle_rounded,

            size: 15,

            color: AppColors.primaryDark,
          ),

          SizedBox(width: 6),

          Text(
            'YOUR FREE IDEA IS READY',

            style: TextStyle(
              color: AppColors.primaryDark,

              fontSize: 9.2,

              fontWeight: FontWeight.w900,

              letterSpacing: 0.7,
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultSection extends StatelessWidget {
  const _ResultSection({required this.title, required this.text});

  final String title;

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,

      padding: const EdgeInsets.all(13),

      decoration: BoxDecoration(
        color: const Color(0xFFFBFDFC),

        borderRadius: BorderRadius.circular(15),

        border: Border.all(color: AppColors.border),
      ),

      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          Text(
            title.toUpperCase(),

            style: const TextStyle(
              color: AppColors.primaryDark,

              fontSize: 9.2,

              fontWeight: FontWeight.w900,

              letterSpacing: 0.7,
            ),
          ),

          const SizedBox(height: 6),

          Text(
            text,

            style: const TextStyle(
              color: AppColors.textSecondary,

              fontSize: 11.7,

              height: 1.5,

              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultList extends StatelessWidget {
  const _ResultList({required this.title, required this.items});

  final String title;

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,

      padding: const EdgeInsets.all(13),

      decoration: BoxDecoration(
        color: const Color(0xFFFBFDFC),

        borderRadius: BorderRadius.circular(15),

        border: Border.all(color: AppColors.border),
      ),

      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,

        children: [
          Text(
            title.toUpperCase(),

            style: const TextStyle(
              color: AppColors.primaryDark,

              fontSize: 9.2,

              fontWeight: FontWeight.w900,

              letterSpacing: 0.7,
            ),
          ),

          const SizedBox(height: 7),

          ...items.take(5).map((item) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 5),

              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,

                children: [
                  Container(
                    width: 5,

                    height: 5,

                    margin: const EdgeInsets.only(top: 6),

                    decoration: const BoxDecoration(
                      color: AppColors.primary,

                      shape: BoxShape.circle,
                    ),
                  ),

                  const SizedBox(width: 8),

                  Expanded(
                    child: Text(
                      item,

                      style: const TextStyle(
                        color: AppColors.textSecondary,

                        fontSize: 11.5,

                        height: 1.45,

                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _LimitBadge extends StatelessWidget {
  const _LimitBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),

      decoration: BoxDecoration(
        color: AppColors.pinkSoft,

        borderRadius: BorderRadius.circular(999),

        border: Border.all(color: AppColors.pinkLight),
      ),

      child: const Row(
        mainAxisSize: MainAxisSize.min,

        children: [
          Icon(Icons.lock_outline_rounded, size: 14, color: AppColors.pinkDeep),

          SizedBox(width: 6),

          Text(
            'FREE GUEST IDEA COMPLETED',

            style: TextStyle(
              color: AppColors.textPrimary,

              fontSize: 9.2,

              fontWeight: FontWeight.w900,

              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _BenefitTile extends StatelessWidget {
  const _BenefitTile({required this.icon, required this.text});

  final IconData icon;

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),

      decoration: BoxDecoration(
        color: const Color(0xFFFBFDFC),

        borderRadius: BorderRadius.circular(14),

        border: Border.all(color: AppColors.border),
      ),

      child: Row(
        children: [
          _MiniIcon(icon: icon),

          const SizedBox(width: 10),

          Expanded(
            child: Text(
              text,

              style: const TextStyle(
                color: AppColors.textPrimary,

                fontSize: 11.5,

                fontWeight: FontWeight.w900,
              ),
            ),
          ),

          const Icon(
            Icons.arrow_forward_rounded,

            size: 15,

            color: AppColors.primaryDark,
          ),
        ],
      ),
    );
  }
}

class _GenerateBackground extends StatelessWidget {
  const _GenerateBackground();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [
          const ColoredBox(color: AppColors.background),

          Positioned(
            top: -90,

            right: -75,

            child: Container(
              width: 235,

              height: 235,

              decoration: BoxDecoration(
                shape: BoxShape.circle,

                color: AppColors.primary.withValues(alpha: 0.085),
              ),
            ),
          ),

          Positioned(
            top: 210,

            left: -90,

            child: Container(
              width: 190,

              height: 190,

              decoration: BoxDecoration(
                shape: BoxShape.circle,

                color: AppColors.pinkLight.withValues(alpha: 0.2),
              ),
            ),
          ),

          Positioned(
            bottom: -80,

            right: -60,

            child: Container(
              width: 200,

              height: 200,

              decoration: BoxDecoration(
                shape: BoxShape.circle,

                color: AppColors.mint.withValues(alpha: 0.42),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
