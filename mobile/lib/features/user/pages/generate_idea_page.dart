//
// Preserves the web generation behavior while presenting Signal, domain
// Focus, local Grounding, and Launch review as a polished touch-first flow.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class GenerateIdeaPage extends StatefulWidget {
  const GenerateIdeaPage({
    super.key,
    this.onGenerationStarted,
    this.onExit,
    this.initialProblem,
  });

  final VoidCallback? onGenerationStarted;
  final VoidCallback? onExit;
  final String? initialProblem;

  @override
  State<GenerateIdeaPage> createState() => _GenerateIdeaPageState();
}

class _GenerateIdeaPageState extends State<GenerateIdeaPage> {
  static const int _maxDomains = 3;
  static const int _minSignal = 10;
  static const int _maxSignal = 2000;

  static const _steps = <({String label, String subtitle})>[
    (label: 'Signal', subtitle: 'Describe the real problem'),
    (label: 'Focus', subtitle: 'Blend up to three domains'),
    (label: 'Ground', subtitle: 'Add local context'),
    (label: 'Launch', subtitle: 'Review and generate'),
  ];

  static const _languages = <({String value, String label})>[
    (value: 'ANY', label: 'Any language'),
    (value: 'EN', label: 'English'),
    (value: 'AR', label: 'Arabic'),
    (value: 'FR', label: 'French'),
    (value: 'ES', label: 'Spanish'),
    (value: 'DE', label: 'German'),
    (value: 'TR', label: 'Turkish'),
  ];

  final _description = TextEditingController();
  final _country = TextEditingController(text: 'Palestine');
  final _city = TextEditingController();
  final _region = TextEditingController();
  final _session = UserSessionController.instance;
  final SpeechToText _speech = SpeechToText();

  int _step = 0;
  bool _loading = true;
  bool _submitting = false;
  bool _forceRefresh = false;
  bool _personalized = false;
  bool _listening = false;
  bool _speechReady = false;
  bool _checkingEntitlement = true;
  String _language = 'ANY';
  String _error = '';
  String _voiceError = '';
  String _voiceBase = '';
  List<Map<String, dynamic>> _domains = const [];
  final List<String> _selectedDomainIds = [];
  Map<String, dynamic> _pricing = const {};

  @override
  void initState() {
    super.initState();

    final incoming = widget.initialProblem?.trim();

    if (incoming != null && incoming.isNotEmpty) {
      _description.text = incoming.substring(
        0,
        incoming.length.clamp(0, _maxSignal).toInt(),
      );
    }

    _description.addListener(_refresh);
    _session.addListener(_handleSessionChanged);

    // UserSessionController notifies listeners while refreshing the summary.
    // Starting that refresh synchronously from initState can notify an
    // AnimatedBuilder while Flutter is still building the first frame.
    // Defer the initial load until the first frame has completed.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _load(force: true);
    });

    _initSpeech();
  }

  @override
  void dispose() {
    _speech.cancel();
    _session.removeListener(_handleSessionChanged);
    _description
      ..removeListener(_refresh)
      ..dispose();
    _country.dispose();
    _city.dispose();
    _region.dispose();
    super.dispose();
  }

  void _refresh() {
    if (!mounted) return;
    setState(() {
      if (_hasDescriptionText) _personalized = false;
    });
  }

  void _handleSessionChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _checkingEntitlement = true;
        _error = '';
      });
    }

    try {
      // Entitlement is the source of truth for whether generation is allowed.
      // Refresh it first so a cached zero cannot lock a user who still has
      // free generations remaining.
      await _session.load(force: true);

      if (!mounted) return;
      setState(() => _checkingEntitlement = false);

      final results = await Future.wait<dynamic>([
        UserApi.instance.getDomains(force: force),
        UserApi.instance.getPricing(),
      ]);

      if (!mounted) return;
      setState(() {
        _domains = results[0] as List<Map<String, dynamic>>;
        _pricing = Map<String, dynamic>.from(results[1] as Map);
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not refresh generation options. Please try again.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _checkingEntitlement = false;
        });
      }
    }
  }

  Future<void> _initSpeech() async {
    try {
      final ready = await _speech.initialize(
        onStatus: (status) {
          if (!mounted) return;
          setState(
            () => _listening = status.toLowerCase().contains('listening'),
          );
        },
        onError: (error) {
          if (!mounted) return;
          final raw = error.errorMsg.toLowerCase();
          setState(() {
            _listening = false;
            _voiceError =
                raw.contains('permission') || raw.contains('not-allowed')
                ? 'Allow microphone access to use voice typing.'
                : 'Voice typing stopped. Please try again.';
          });
        },
      );
      if (mounted) setState(() => _speechReady = ready);
    } catch (_) {
      if (mounted) {
        setState(() {
          _speechReady = false;
          _voiceError =
              'Voice typing is not available here. You can still type normally.';
        });
      }
    }
  }

  Future<String?> _speechLocale() async {
    if (_language == 'ANY') return null;
    final prefix = switch (_language) {
      'AR' => 'ar',
      'EN' => 'en',
      'FR' => 'fr',
      'ES' => 'es',
      'DE' => 'de',
      'TR' => 'tr',
      _ => '',
    };
    if (prefix.isEmpty) return null;
    try {
      for (final locale in await _speech.locales()) {
        if (locale.localeId.toLowerCase().startsWith(prefix)) {
          return locale.localeId;
        }
      }
    } catch (_) {}
    return null;
  }

  Future<void> _toggleVoice() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_speech.isListening || _listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }

    setState(() => _voiceError = '');
    if (!_speechReady) {
      await _initSpeech();
      if (!_speechReady) return;
    }

    _voiceBase = _description.text.trimRight();
    try {
      await _speech.listen(
        onResult: _onSpeechResult,
        listenOptions: SpeechListenOptions(localeId: await _speechLocale()),
      );
      if (mounted) setState(() => _listening = _speech.isListening);
    } catch (_) {
      if (mounted) {
        setState(() {
          _listening = false;
          _voiceError =
              'The microphone could not start. Check permission and try again.';
        });
      }
    }
  }

  void _onSpeechResult(SpeechRecognitionResult result) {
    final spoken = result.recognizedWords.trim();
    if (spoken.isEmpty) return;
    final next = [
      _voiceBase,
      spoken,
    ].where((value) => value.trim().isNotEmpty).join(' ').trim();
    _description.value = TextEditingValue(
      text: next.length > _maxSignal ? next.substring(0, _maxSignal) : next,
      selection: TextSelection.collapsed(
        offset: next.length.clamp(0, _maxSignal).toInt(),
      ),
    );
    if (mounted && result.finalResult) setState(() => _listening = false);
  }

  bool get _hasDescriptionText => _description.text.trim().isNotEmpty;
  bool get _hasSignal => _description.text.trim().length >= _minSignal;
  bool get _canChooseDomainsInstead => !_hasDescriptionText;
  bool get _isPremium => _session.summary?.isPremium == true;
  int get _creditBalance => _session.summary?.creditBalance ?? 0;
  int get _premiumCost => _asInt(_pricing['premiumIdeaCreditCost']);

  bool get _blocked {
    final summary = _session.summary;

    // Never render a false "completed" state while account data is loading
    // or unavailable. The backend still validates entitlement on submit.
    if (_checkingEntitlement || _session.loading || summary == null) {
      return false;
    }

    if (_session.error != null && _session.usingCachedSnapshot) {
      return false;
    }

    if (summary.isPremium) {
      // If pricing is still being refreshed, keep the generation flow open
      // rather than incorrectly treating an unknown cost as insufficient.
      if (_premiumCost <= 0) return false;
      return summary.creditBalance < _premiumCost;
    }

    return summary.remainingFreeGenerations <= 0;
  }

  bool get _canContinue {
    return switch (_step) {
      0 => _hasSignal,
      1 => _hasSignal || _selectedDomainIds.isNotEmpty,
      2 => _country.text.trim().isNotEmpty,
      _ => true,
    };
  }

  List<Map<String, dynamic>> get _selectedDomains => _domains
      .where((domain) => _selectedDomainIds.contains('${domain['id'] ?? ''}'))
      .toList(growable: false);

  void _toggleDomain(String id) {
    setState(() {
      _personalized = false;
      if (_selectedDomainIds.contains(id)) {
        _selectedDomainIds.remove(id);
      } else if (_selectedDomainIds.length < _maxDomains) {
        _selectedDomainIds.add(id);
      }
    });
  }

  void _startPersonalizedDiscovery() {
    if (!_canChooseDomainsInstead) return;

    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _error = '';
      _personalized = true;
      _selectedDomainIds.clear();
      _step = 2;
    });
  }

  void _selectAuto() {
    if (!_hasSignal) return;
    setState(() {
      _personalized = false;
      _selectedDomainIds.clear();
    });
  }

  void _next() {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _error = '');

    if (_step == 0 && !_hasSignal) {
      setState(
        () => _error =
            'Describe the problem with at least $_minSignal characters, or choose domains instead.',
      );
      return;
    }
    if (_step == 1 && !_canContinue) {
      setState(
        () => _error =
            'Choose one to three domains, or go back and add a problem signal.',
      );
      return;
    }
    if (_step == 2 && _country.text.trim().isEmpty) {
      setState(
        () => _error =
            'Country is required so Voxidence can ground the evidence.',
      );
      return;
    }
    if (_step < 3) setState(() => _step += 1);
  }

  void _chooseDomainsInstead() {
    if (!_canChooseDomainsInstead) return;

    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _error = '';
      _personalized = false;
      _step = 1;
    });
  }

  void _back() {
    if (_step <= 0) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _error = '';
      if (_step == 2 && _personalized) {
        _step = 0;
      } else {
        _step -= 1;
      }
    });
  }

  Future<void> _openLanguagePicker() async {
    FocusManager.instance.primaryFocus?.unfocus();

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (_) => _LanguagePickerSheet(
        selectedValue: _language,
        options: _languages,
      ),
    );

    if (!mounted || selected == null || selected == _language) return;

    setState(() {
      _language = selected;
    });
  }

  bool _isGenerationAlreadyRunning(ApiException error) {
    final message = error.message.toLowerCase();

    return message.contains(
          'an idea-generation run is already active for this owner',
        ) ||
        (error.statusCode == 409 &&
            message.contains('generation') &&
            (message.contains('already active') ||
                message.contains('already running')));
  }

  Future<void> _showGenerationAlreadyRunningDialog() async {
    if (!mounted) return;

    await showDialog<void>(
      context: context,
      useRootNavigator: true,
      barrierDismissible: false,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .28),
      builder: (dialogContext) {
        return Dialog(
          alignment: Alignment.center,
          insetPadding: const EdgeInsets.symmetric(horizontal: 24),
          backgroundColor: Colors.transparent,
          elevation: 0,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 410),
            child: Container(
              padding: const EdgeInsets.fromLTRB(24, 26, 24, 22),
              decoration: BoxDecoration(
                color: const Color(0xFFFFFEFD),
                borderRadius: BorderRadius.circular(28),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: .22),
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryDeep.withValues(alpha: .18),
                    blurRadius: 46,
                    offset: const Offset(0, 20),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 62,
                    height: 62,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.primarySoft.withValues(alpha: .96),
                          AppColors.surfaceRose.withValues(alpha: .82),
                        ],
                      ),
                    ),
                    child: const Icon(
                      Icons.auto_awesome_rounded,
                      color: AppColors.primaryDeep,
                      size: 27,
                    ),
                  ),
                  const SizedBox(height: 15),
                  Text(
                    'GENERATION IN PROGRESS',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppColors.primaryDeep,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.15,
                        ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    'Another idea is already being generated.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w900,
                          height: 1.12,
                        ),
                  ),
                  const SizedBox(height: 11),
                  Text(
                    'Voxidence is still working on your current generation. Please try later after it finishes.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textMuted,
                          height: 1.55,
                        ),
                  ),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () => Navigator.of(dialogContext).pop(),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(15),
                        ),
                        textStyle: const TextStyle(
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      child: const Text('Close'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _submit() async {
    if (_submitting || _blocked || _checkingEntitlement) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _submitting = true;
      _error = '';
    });

    try {
      final payload = <String, dynamic>{
        if (_selectedDomainIds.isNotEmpty) ...{
          'domainIds': List<String>.from(_selectedDomainIds),
          'domainId': _selectedDomainIds.first,
        },
        'generationType': _isPremium ? 'PREMIUM_CREDIT' : 'NORMAL_FREE',
        if (!_personalized && _description.text.trim().isNotEmpty)
          'description': _description.text.trim(),
        'country': _country.text.trim(),
        if (_city.text.trim().isNotEmpty) 'city': _city.text.trim(),
        if (_region.text.trim().isNotEmpty) 'region': _region.text.trim(),
        'language': _language,
        'forceRefresh': _forceRefresh,
        'keywords': const <String>[],
      };

      final response = await UserApi.instance.startGeneration(payload);
      final runId = _readRunId(response);
      if (runId.isEmpty) {
        throw const ApiException(
          'Generation started without a run identifier.',
        );
      }

      _resetWizardForNextRun();
      widget.onGenerationStarted?.call();
      if (!mounted) return;
      await Navigator.of(context).pushNamed('/normal/generation/$runId');
    } on ApiException catch (error) {
      if (!mounted) return;

      if (_isGenerationAlreadyRunning(error)) {
        setState(() => _error = '');
        await _showGenerationAlreadyRunningDialog();
        return;
      }

      if ((error.statusCode == 403 || error.statusCode == 409) &&
          error.message.toLowerCase().contains('free')) {
        await _session.load(force: true);
      }

      // A connection drop may hide the accepted response while the backend
      // continues the durable run. Recover that run instead of reporting a
      // false timeout and inviting a second generation request.
      if (error.statusCode == null || error.statusCode! >= 500) {
        try {
          final activeRun = await UserApi.instance.getActiveGenerationRun(
            force: true,
          );
          final recoveredRunId = activeRun == null ? '' : _readRunId(activeRun);

          if (recoveredRunId.isNotEmpty) {
            _resetWizardForNextRun();
            widget.onGenerationStarted?.call();
            if (!mounted) return;
            await Navigator.of(
              context,
            ).pushNamed('/normal/generation/$recoveredRunId');
            return;
          }
        } catch (_) {
          // Preserve the original start error if no durable active run exists.
        }
      }

      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Idea generation could not be started.');
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _resetWizardForNextRun() {
    _speech.stop();
    _description.clear();
    _country.text = 'Palestine';
    _city.clear();
    _region.clear();

    setState(() {
      _step = 0;
      _forceRefresh = false;
      _personalized = false;
      _listening = false;
      _language = 'ANY';
      _error = '';
      _voiceError = '';
      _voiceBase = '';
      _selectedDomainIds.clear();
    });
  }

  String _readRunId(Map<String, dynamic> response) {
    final direct = response['runId'] ?? response['id'];
    if (direct != null && '$direct'.trim().isNotEmpty) return '$direct';
    final run = response['run'];
    if (run is Map) return '${run['runId'] ?? run['id'] ?? ''}';
    final data = response['data'];
    if (data is Map) return '${data['runId'] ?? data['id'] ?? ''}';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    if (_blocked) return _buildBlocked();

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          child: Column(
            children: [
              const _TopBar(),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 104),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _GenerationIntro(
                        step: _step,
                        isPremium: _isPremium,
                      ),
                      const SizedBox(height: 11),
                      _StepRail(step: _step),
                      const SizedBox(height: 13),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        transitionBuilder: (child, animation) {
                          final slide = Tween<Offset>(
                            begin: const Offset(.035, .015),
                            end: Offset.zero,
                          ).animate(animation);
                          return FadeTransition(
                            opacity: animation,
                            child: SlideTransition(
                              position: slide,
                              child: child,
                            ),
                          );
                        },
                        child: KeyedSubtree(
                          key: ValueKey(_step),
                          child: _stepBody(),
                        ),
                      ),
                      if (_error.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        InlineNotice(
                          icon: Icons.error_outline_rounded,
                          message: _error,
                          error: true,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 8),
        child: SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: const Color(0xFFFFFEFD).withValues(alpha: .985),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: Colors.white.withValues(alpha: .95),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: .12),
                  blurRadius: 30,
                  offset: const Offset(0, 11),
                ),
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: .06),
                  blurRadius: 0,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: Row(
              children: [
                if (_step > 0)
                  SizedBox(
                    width: 94,
                    child: OutlinedButton.icon(
                      onPressed: _submitting ? null : _back,
                      icon: const Icon(Icons.arrow_back_rounded, size: 16),
                      label: const Text('Back'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(40),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        textStyle: const TextStyle(
                          fontSize: 10.2,
                          fontWeight: FontWeight.w800,
                        ),
                        backgroundColor: AppColors.surface,
                      ),
                    ),
                  ),
                if (_step > 0) const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _submitting || !_canContinue
                        ? null
                        : _step == 3
                            ? _submit
                            : _next,
                    icon: _submitting
                        ? const SizedBox(
                            width: 17,
                            height: 17,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Icon(
                            _step == 3
                                ? Icons.auto_awesome_rounded
                                : Icons.arrow_forward_rounded,
                            size: 16,
                          ),
                    label: Text(
                      _submitting
                          ? 'Preparing discovery...'
                          : _step == 3
                              ? 'Generate idea'
                              : 'Continue',
                    ),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(40),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      textStyle: const TextStyle(
                        fontSize: 10.8,
                        fontWeight: FontWeight.w900,
                      ),
                      backgroundColor: AppColors.primary,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13),
                      ),
                      disabledBackgroundColor:
                          AppColors.silver.withValues(alpha: .36),
                      disabledForegroundColor:
                          AppColors.textMuted.withValues(alpha: .72),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _stepBody() {
    return switch (_step) {
      0 => _signalStep(),
      1 => _focusStep(),
      2 => _groundStep(),
      _ => _reviewStep(),
    };
  }

  Widget _signalStep() {
    final count = _description.text.length;
    final progress = (count / _minSignal).clamp(0.0, 1.0).toDouble();

    return _GenerationPanel(
      accent: AppColors.pink,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _PanelHeading(
            index: '01',
            icon: Icons.graphic_eq_rounded,
            eyebrow: 'REAL-WORLD SIGNAL',
            title: 'What problem keeps repeating?',
            subtitle:
                'Give Voxidence the human signal first: who feels the pain, what keeps failing, and why the current workaround is not enough.',
          ),
          const SizedBox(height: 18),
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Colors.white.withValues(alpha: .98),
                  AppColors.surfaceRose.withValues(alpha: .70),
                  AppColors.primarySoft.withValues(alpha: .34),
                ],
              ),
              borderRadius: BorderRadius.circular(23),
              border: Border.all(
                color: _listening ? AppColors.primary : AppColors.borderStrong,
                width: _listening ? 1.5 : 1,
              ),
              boxShadow: _listening
                  ? [
                      BoxShadow(
                        color: AppColors.primary.withValues(alpha: .12),
                        blurRadius: 0,
                        spreadRadius: 5,
                      ),
                    ]
                  : null,
            ),
            child: Column(
              children: [
                TextField(
                  controller: _description,
                  minLines: 6,
                  maxLines: 9,
                  maxLength: _maxSignal,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.4,
                    height: 1.56,
                    fontWeight: FontWeight.w600,
                  ),
                  cursorColor: AppColors.primaryDark,
                  decoration: const InputDecoration(
                    hintText:
                        'Example: Students in Nablus struggle to coordinate shared transport because schedules change constantly and there is no trusted real-time matching system…',
                    filled: false,
                    fillColor: Colors.transparent,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    counterText: '',
                    contentPadding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 4, 10, 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _toggleVoice,
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(42),
                            backgroundColor: _listening
                                ? AppColors.primarySoft
                                : Colors.white.withValues(alpha: .92),
                            side: BorderSide(
                              color: _listening
                                  ? AppColors.primary
                                  : AppColors.border,
                            ),
                          ),
                          icon: Icon(
                            _listening
                                ? Icons.mic_off_rounded
                                : Icons.mic_none_rounded,
                            size: 17,
                          ),
                          label: Text(
                            _listening ? 'Listening…' : 'Speak to type',
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 160),
                          opacity: _canChooseDomainsInstead ? 1 : .45,
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: _canChooseDomainsInstead
                                  ? _chooseDomainsInstead
                                  : null,
                              borderRadius: BorderRadius.circular(15),
                              child: Ink(
                                height: 42,
                                padding: const EdgeInsets.symmetric(
                                horizontal: 9,
                              ),
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    AppColors.primarySoft.withValues(
                                      alpha: .72,
                                    ),
                                    Colors.white.withValues(alpha: .94),
                                  ],
                                ),
                                borderRadius: BorderRadius.circular(15),
                                border: Border.all(
                                  color: AppColors.primary.withValues(
                                    alpha: .22,
                                  ),
                                ),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Container(
                                    width: 28,
                                    height: 28,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(
                                        alpha: .90,
                                      ),
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: const Icon(
                                      Icons.layers_outlined,
                                      size: 14,
                                      color: AppColors.primaryDark,
                                    ),
                                  ),
                                  const SizedBox(width: 7),
                                  const Flexible(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Choose domains',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            color: AppColors.primaryDeep,
                                            fontSize: 9.2,
                                            height: 1.05,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                        SizedBox(height: 2),
                                        Text(
                                          'instead',
                                          style: TextStyle(
                                            color: AppColors.textMuted,
                                            fontSize: 7.7,
                                            height: 1,
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
                        ),
                      ),
                    ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 11),
          _ModeCard(
            selected: false,
            disabled: !_canChooseDomainsInstead,
            icon: Icons.explore_outlined,
            title: 'I’m not sure what my idea should be yet',
            subtitle:
                'Help me discover a direction from my interests and preferences',
            badge: 'GUIDED DISCOVERY',
            rose: true,
            onTap: _startPersonalizedDiscovery,
          ),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                    minHeight: 5,
                    value: progress,
                    backgroundColor: AppColors.border,
                    color: _hasSignal ? AppColors.success : AppColors.primary,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: _hasSignal
                      ? AppColors.primarySoft
                      : AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '$count/$_maxSignal',
                  style: TextStyle(
                    color: _hasSignal
                        ? AppColors.primaryDeep
                        : AppColors.textMuted,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Row(
            children: [
              Icon(
                _hasSignal
                    ? Icons.check_circle_rounded
                    : Icons.info_outline_rounded,
                size: 13,
                color: _hasSignal ? AppColors.success : AppColors.textMuted,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  _hasSignal
                      ? 'Signal ready. You can refine the direction in the next step.'
                      : 'Add at least $_minSignal characters, or continue by choosing domains instead.',
                  style: TextStyle(
                    color: _hasSignal
                        ? AppColors.primaryDark
                        : AppColors.textMuted,
                    fontSize: 8.9,
                    height: 1.34,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (_voiceError.isNotEmpty) ...[
            const SizedBox(height: 9),
            InlineNotice(
              icon: Icons.mic_off_rounded,
              message: _voiceError,
              error: true,
            ),
          ],
          const SizedBox(height: 15),
          const Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _Tip(
                icon: Icons.groups_2_outlined,
                text: 'Who is affected?',
              ),
              _Tip(
                icon: Icons.repeat_rounded,
                text: 'What repeats?',
              ),
              _Tip(
                icon: Icons.place_outlined,
                text: 'Where does it happen?',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _focusStep() {
    final autoSelected = _hasSignal && _selectedDomainIds.isEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _GenerationPanel(
          accent: AppColors.primary,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _PanelHeading(
                index: '02',
                icon: Icons.hub_outlined,
                eyebrow: 'OPPORTUNITY FOCUS',
                title: 'Shape the strongest domain blend.',
                subtitle:
                    'Keep the signal as the anchor, then let Voxidence combine up to three complementary software domains around it.',
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.fromLTRB(12, 11, 11, 11),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .58),
                  borderRadius: BorderRadius.circular(17),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 35,
                      height: 35,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .85),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.layers_outlined,
                        size: 17,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${_selectedDomainIds.length} of $_maxDomains selected',
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 10.8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            autoSelected
                                ? 'Automatic matching is ready from your signal.'
                                : 'Choose related areas rather than unrelated categories.',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.7,
                              height: 1.3,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (_selectedDomainIds.isNotEmpty)
                      TextButton(
                        onPressed: () => setState(() {
                          _selectedDomainIds.clear();
                          _personalized = false;
                        }),
                        child: const Text('Clear'),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        _ModeCard(
          selected: autoSelected,
          disabled: !_hasSignal,
          icon: Icons.auto_fix_high_rounded,
          title: 'Let Voxidence resolve the blend',
          subtitle: _hasSignal
              ? 'Recommended from your signal · automatic domain matching'
              : 'Add a problem signal first to unlock automatic matching',
          badge: 'RECOMMENDED',
          onTap: _selectAuto,
        ),
        if (_selectedDomains.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: _selectedDomains
                .map((domain) {
                  final id = '${domain['id'] ?? ''}';
                  final name =
                      '${domain['name'] ?? domain['displayName'] ?? 'Domain'}';
                  return InputChip(
                    label: Text(name),
                    avatar: const Icon(
                      Icons.check_rounded,
                      size: 13,
                      color: AppColors.primaryDark,
                    ),
                    onDeleted: () => _toggleDomain(id),
                    deleteIcon: const Icon(Icons.close_rounded, size: 13),
                    side: const BorderSide(color: AppColors.borderStrong),
                    backgroundColor: AppColors.primarySoft,
                    labelStyle: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 8.8,
                      fontWeight: FontWeight.w900,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(99),
                    ),
                  );
                })
                .toList(growable: false),
          ),
        ],
        const SizedBox(height: 12),
        if (_loading)
          const LoadingList(count: 5)
        else if (_domains.isEmpty)
          EmptyState(
            icon: Icons.layers_clear_outlined,
            title: 'No domains are available',
            message: 'Reload the available opportunity domains.',
            action: FilledButton.icon(
              onPressed: () => _load(force: true),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Reload domains'),
            ),
          )
        else
          LayoutBuilder(
            builder: (context, constraints) {
              final singleColumn = constraints.maxWidth < 350;
              final width = singleColumn
                  ? constraints.maxWidth
                  : (constraints.maxWidth - 9) / 2;

              return Wrap(
                spacing: 9,
                runSpacing: 9,
                children: _domains
                    .map((domain) {
                      final id = '${domain['id'] ?? ''}';
                      final selected = _selectedDomainIds.contains(id);
                      final blocked =
                          !selected && _selectedDomainIds.length >= _maxDomains;
                      final name =
                          '${domain['name'] ?? domain['displayName'] ?? 'Software domain'}';
                      final description =
                          '${domain['description'] ?? 'Software opportunity domain'}';

                      return SizedBox(
                        width: width,
                        child: _DomainCard(
                          selected: selected,
                          disabled: blocked,
                          icon: _domainIcon(name),
                          title: name,
                          subtitle: description,
                          onTap: () => _toggleDomain(id),
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

  Widget _groundStep() {
    final selectedLanguage = _languages
        .firstWhere((item) => item.value == _language)
        .label;

    return _GenerationPanel(
      accent: AppColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _PanelHeading(
            index: '03',
            icon: Icons.travel_explore_rounded,
            eyebrow: 'LOCAL GROUNDING',
            title: 'Give the discovery a real place.',
            subtitle:
                'Location and language help Voxidence prioritize evidence that feels relevant to the people and context you care about.',
          ),
          const SizedBox(height: 17),
          _Field(
            controller: _country,
            label: 'Country',
            hint: 'Palestine',
            icon: Icons.flag_outlined,
            requiredField: true,
          ),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 360) {
                return Column(
                  children: [
                    _Field(
                      controller: _city,
                      label: 'City',
                      hint: 'Nablus',
                      icon: Icons.location_city_outlined,
                    ),
                    const SizedBox(height: 10),
                    _Field(
                      controller: _region,
                      label: 'Region',
                      hint: 'West Bank',
                      icon: Icons.map_outlined,
                    ),
                  ],
                );
              }

              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _Field(
                      controller: _city,
                      label: 'City',
                      hint: 'Nablus',
                      icon: Icons.location_city_outlined,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: _Field(
                      controller: _region,
                      label: 'Region',
                      hint: 'West Bank',
                      icon: Icons.map_outlined,
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          const Text(
            'Community language',
            style: TextStyle(
              color: AppColors.primaryDeep,
              fontSize: 9.3,
              fontWeight: FontWeight.w900,
              letterSpacing: .25,
            ),
          ),
          const SizedBox(height: 6),
          _LanguageSelector(
            value: _language,
            label: selectedLanguage,
            onTap: _openLanguagePicker,
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppColors.primarySoft.withValues(alpha: .72),
                  AppColors.surfaceRose.withValues(alpha: .48),
                ],
              ),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: AppColors.border),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.auto_fix_high_rounded,
                  size: 17,
                  color: AppColors.primaryDark,
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Voxidence chooses the strongest public sources automatically using domain, language, location, availability, and evidence quality.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 8.9,
                      height: 1.38,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _reviewStep() {
    final location = [
      _city.text.trim(),
      _region.text.trim(),
      _country.text.trim(),
    ].where((part) => part.isNotEmpty).join(', ');

    final domainBlend = _personalized
        ? 'Personalized by Voxidence'
        : _selectedDomains.isNotEmpty
            ? _selectedDomains
                .map(
                  (item) =>
                      '${item['name'] ?? item['displayName'] ?? 'Domain'}',
                )
                .join(' + ')
            : 'Auto-detected by Voxidence';

    final language = _languages
        .firstWhere((item) => item.value == _language)
        .label;

    final discoveryInput = _personalized
        ? 'Personalized discovery based on your interests, preferences, favorites, accepted ideas, and idea history.'
        : _description.text.trim().isNotEmpty
            ? _description.text.trim()
            : 'Cross-domain discovery: $domainBlend';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _GenerationPanel(
          accent: AppColors.primary,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _PanelHeading(
                index: '04',
                icon: Icons.rocket_launch_outlined,
                eyebrow: 'LAUNCH REVIEW',
                title: 'Everything is ready for discovery.',
                subtitle:
                    'Review the signal and context once more. Voxidence will resolve sources, rank opportunities, generate candidates, validate quality, and save the strongest idea.',
              ),
              const SizedBox(height: 17),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppColors.primarySoft.withValues(alpha: .78),
                      Colors.white.withValues(alpha: .88),
                      AppColors.surfaceRose.withValues(alpha: .56),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .88),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(
                            Icons.format_quote_rounded,
                            color: AppColors.primaryDark,
                            size: 17,
                          ),
                        ),
                        const SizedBox(width: 9),
                        const Expanded(
                          child: Text(
                            'DISCOVERY INPUT',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 8.4,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .8,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      discoveryInput,
                      maxLines: 7,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.8,
                        height: 1.48,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 11),
              _ReviewFact(
                label: 'Domain blend',
                value: domainBlend,
                icon: Icons.layers_outlined,
              ),
              _ReviewFact(
                label: 'Location',
                value: location.isEmpty ? 'Not specified' : location,
                icon: Icons.location_on_outlined,
              ),
              _ReviewFact(
                label: 'Language',
                value: language,
                icon: Icons.translate_rounded,
              ),
              const _ReviewFact(
                label: 'Source strategy',
                value: 'Automatic evidence intelligence',
                icon: Icons.hub_outlined,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          child: InkWell(
            onTap: () {
              setState(() {
                _forceRefresh = !_forceRefresh;
              });
            },
            borderRadius: BorderRadius.circular(20),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
              decoration: BoxDecoration(
                color: _forceRefresh
                    ? AppColors.primarySoft.withValues(alpha: .78)
                    : Colors.white.withValues(alpha: .88),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color:
                      _forceRefresh ? AppColors.primary : AppColors.border,
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .86),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(
                      Icons.refresh_rounded,
                      size: 18,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Collect fresh evidence',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 10.8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Skip recent reusable collections and start a fresh evidence pass.',
                          style: TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 8.7,
                            height: 1.32,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Switch.adaptive(
                    value: _forceRefresh,
                    onChanged: (value) {
                      setState(() {
                        _forceRefresh = value;
                      });
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: _isPremium
                  ? [
                      const Color(0xFFE6F5F2),
                      Colors.white,
                      const Color(0xFFFFF4F7),
                    ]
                  : [
                      Colors.white,
                      AppColors.surfaceRose.withValues(alpha: .70),
                    ],
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: _isPremium
                        ? [AppColors.primary, AppColors.primaryDark]
                        : [AppColors.pinkLight, AppColors.pink],
                  ),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  _isPremium
                      ? Icons.auto_awesome_rounded
                      : Icons.lightbulb_outline_rounded,
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
                      _isPremium
                          ? 'Complete premium generation'
                          : 'Normal validated generation',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _isPremium
                          ? 'Uses ${_premiumCost > 0 ? _premiumCost : '…'} credits from your $_creditBalance-credit balance and prepares the advanced workspace immediately.'
                          : 'Creates the validated core idea first. Advanced outputs remain optional after the idea is saved.',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.9,
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBlocked() {
    final premium = _isPremium;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const _TopBar(),
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(18, 10, 18, 110),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              AppColors.surface,
                              premium
                                  ? AppColors.primarySoft.withValues(alpha: .68)
                                  : AppColors.surfaceRose.withValues(
                                      alpha: .72,
                                    ),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(28),
                          border: Border.all(color: Colors.white),
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.primaryDeep.withValues(
                                alpha: .09,
                              ),
                              blurRadius: 34,
                              offset: const Offset(0, 14),
                            ),
                          ],
                        ),
                        child: Column(
                          children: [
                            SoftIconBadge(
                              icon: premium
                                  ? Icons.bolt_rounded
                                  : Icons.lock_outline_rounded,
                              size: 62,
                              rose: !premium,
                            ),
                            const SizedBox(height: 16),
                            const Text(
                              'GENERATION ACCESS',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 8.7,
                                fontWeight: FontWeight.w900,
                                letterSpacing: .9,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              premium
                                  ? 'Add credits to keep creating complete ideas.'
                                  : 'Your free discoveries are complete.',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 21,
                                height: 1.08,
                                fontWeight: FontWeight.w900,
                                letterSpacing: -.5,
                              ),
                            ),
                            const SizedBox(height: 9),
                            Text(
                              premium
                                  ? 'Premium generation needs $_premiumCost credits. Your current balance is $_creditBalance credits.'
                                  : 'Your existing ideas stay safe in My Ideas. Add credits whenever you want to continue generating.',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 10.7,
                                height: 1.5,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 19),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton.icon(
                                onPressed: () => Navigator.pushNamed(
                                  context,
                                  '/normal/credits',
                                ),
                                icon: Icon(
                                  premium
                                      ? Icons.add_card_rounded
                                      : Icons.workspace_premium_outlined,
                                  size: 18,
                                ),
                                label: Text(
                                  premium
                                      ? 'Buy more credits'
                                      : 'View credits & Premium',
                                ),
                              ),
                            ),
                            const SizedBox(height: 9),
                            SizedBox(
                              width: double.infinity,
                              child: OutlinedButton.icon(
                                onPressed: () => Navigator.pushNamed(
                                  context,
                                  '/normal/ideas',
                                ),
                                icon: const Icon(
                                  Icons.lightbulb_outline_rounded,
                                  size: 18,
                                ),
                                label: const Text('View my ideas'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
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
    if (value.contains('education')) return Icons.school_outlined;
    if (value.contains('health')) return Icons.favorite_border_rounded;
    if (value.contains('finance') || value.contains('business')) {
      return Icons.business_center_outlined;
    }
    if (value.contains('environment')) return Icons.eco_outlined;
    if (value.contains('community')) return Icons.groups_2_outlined;
    if (value.contains('transport')) return Icons.route_outlined;
    if (value.contains('security')) return Icons.shield_outlined;
    return Icons.widgets_outlined;
  }

  int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse('$value') ?? 0;
  }
}

class _GenerationIntro extends StatelessWidget {
  const _GenerationIntro({
    required this.step,
    required this.isPremium,
  });

  final int step;
  final bool isPremium;

  static const _titles = <String>[
    'From a real signal to a software opportunity.',
    'Blend context without losing the original pain.',
    'Ground the discovery in the right community.',
    'Launch an evidence-backed generation run.',
  ];

  static const _subtitles = <String>[
    'Start with the problem. Voxidence will do the source discovery, opportunity ranking and candidate validation.',
    'Use automatic matching, your workspace context, or up to three domains to shape the search.',
    'Location and language make the evidence more relevant without forcing manual source selection.',
    'One review before the intelligence pipeline starts collecting, ranking and validating.',
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      padding: const EdgeInsets.fromLTRB(15, 14, 14, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: .96)),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFEFD),
            Color(0xFFF0F9F7),
            Color(0xFFFFF7F9),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 25,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -26,
            top: -34,
            child: Container(
              width: 104,
              height: 104,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .07),
              ),
            ),
          ),
          Positioned(
            right: 20,
            bottom: -42,
            child: Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .055),
              ),
            ),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF6FC7C1), Color(0xFF459A93)],
                  ),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: .20),
                      blurRadius: 18,
                      offset: const Offset(0, 7),
                    ),
                  ],
                ),
                child: Icon(
                  step == 3
                      ? Icons.rocket_launch_rounded
                      : Icons.auto_awesome_rounded,
                  color: Colors.white,
                  size: 22,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text(
                          'EVIDENCE-LED IDEATION',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 7.5,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .95,
                          ),
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: isPremium
                                ? AppColors.primarySoft
                                : AppColors.surfaceRose,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            isPremium ? 'ADVANCED' : 'VALIDATED',
                            style: TextStyle(
                              color: isPremium
                                  ? AppColors.primaryDeep
                                  : AppColors.pinkDeep,
                              fontSize: 6.8,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .55,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      _titles[step],
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16.8,
                        height: 1.08,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.35,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      _subtitles[step],
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 8.8,
                        height: 1.38,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _GenerationPanel extends StatelessWidget {
  const _GenerationPanel({
    required this.child,
    this.accent = AppColors.primary,
  });

  final Widget child;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 17, 16, 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: .96),
            AppColors.surface.withValues(alpha: .94),
            accent.withValues(alpha: .035),
          ],
        ),
        border: Border.all(color: Colors.white.withValues(alpha: .95)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .06),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _PanelHeading extends StatelessWidget {
  const _PanelHeading({
    required this.index,
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
  });

  final String index;
  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft.withValues(alpha: .82),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: AppColors.border),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icon, color: AppColors.primaryDark, size: 20),
              Positioned(
                right: 5,
                bottom: 4,
                child: Text(
                  index,
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 6.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 7.4,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .95,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18.2,
                  height: 1.08,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.42,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.3,
                  height: 1.42,
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

class _TopBar extends StatelessWidget {
  const _TopBar();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .94),
        border: Border(
          bottom: BorderSide(
            color: AppColors.border.withValues(alpha: .66),
          ),
        ),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Generate an idea',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 17.2,
              height: 1.04,
              fontWeight: FontWeight.w900,
              letterSpacing: -.36,
            ),
          ),
          SizedBox(height: 4),
          Text(
            'Evidence-led discovery studio',
            style: TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.8,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StepRail extends StatelessWidget {
  const _StepRail({required this.step});

  final int step;

  @override
  Widget build(BuildContext context) {
    final item = _GenerateIdeaPageState._steps[step];
    final progress = (step + 1) / _GenerateIdeaPageState._steps.length;

    return Container(
      padding: const EdgeInsets.fromLTRB(13, 12, 13, 11),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .90),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .04),
            blurRadius: 18,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'STEP ${step + 1} OF ${_GenerateIdeaPageState._steps.length}',
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .72,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${item.label} · ${item.subtitle}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.9,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  '${(progress * 100).round()}%',
                  style: const TextStyle(
                    color: AppColors.primaryDeep,
                    fontSize: 8.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: List.generate(_GenerateIdeaPageState._steps.length, (
              index,
            ) {
              final current = index == step;
              final complete = index < step;

              return Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 220),
                            width: 34,
                            height: 34,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              gradient: current || complete
                                  ? const LinearGradient(
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                      colors: [
                                        Color(0xFF69C6C0),
                                        Color(0xFF4B9D96),
                                      ],
                                    )
                                  : null,
                              color: current || complete
                                  ? null
                                  : AppColors.surfaceMuted,
                              border: Border.all(
                                color: current || complete
                                    ? Colors.transparent
                                    : AppColors.borderStrong,
                              ),
                              boxShadow: current
                                  ? [
                                      BoxShadow(
                                        color: AppColors.primary.withValues(
                                          alpha: .16,
                                        ),
                                        blurRadius: 0,
                                        spreadRadius: 5,
                                      ),
                                    ]
                                  : null,
                            ),
                            child: complete
                                ? const Icon(
                                    Icons.check_rounded,
                                    color: Colors.white,
                                    size: 16,
                                  )
                                : Icon(
                                    switch (index) {
                                      0 => Icons.graphic_eq_rounded,
                                      1 => Icons.hub_outlined,
                                      2 => Icons.place_outlined,
                                      _ => Icons.rocket_launch_outlined,
                                    },
                                    color: current
                                        ? Colors.white
                                        : AppColors.textMuted,
                                    size: 16,
                                  ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            _GenerateIdeaPageState._steps[index].label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: current || complete
                                  ? AppColors.primaryDeep
                                  : AppColors.textMuted,
                              fontSize: 7.4,
                              fontWeight: current
                                  ? FontWeight.w900
                                  : FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (index < _GenerateIdeaPageState._steps.length - 1)
                      Expanded(
                        child: Container(
                          height: 2,
                          margin: const EdgeInsets.only(bottom: 18),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(99),
                            color: complete
                                ? AppColors.primary
                                : AppColors.border,
                          ),
                        ),
                      ),
                  ],
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}



class _Tip extends StatelessWidget {
  const _Tip({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .84),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(
            text,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 8.3,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.disabled = false,
    this.badge,
    this.rose = false,
  });

  final bool selected;
  final bool disabled;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final String? badge;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose ? AppColors.pink : AppColors.primary;
    final accentDark = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Opacity(
      opacity: disabled ? .46 : 1,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: disabled ? null : onTap,
          borderRadius: BorderRadius.circular(20),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 210),
            padding: const EdgeInsets.fromLTRB(12, 11, 11, 11),
            decoration: BoxDecoration(
              gradient: selected
                  ? LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        accent.withValues(alpha: .14),
                        Colors.white.withValues(alpha: .94),
                      ],
                    )
                  : LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Colors.white.withValues(alpha: .94),
                        AppColors.surface.withValues(alpha: .86),
                      ],
                    ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected ? accent.withValues(alpha: .62) : AppColors.border,
                width: selected ? 1.35 : 1,
              ),
              boxShadow: selected
                  ? [
                      BoxShadow(
                        color: accent.withValues(alpha: .10),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ]
                  : null,
            ),
            child: Row(
              children: [
                Container(
                  width: 43,
                  height: 43,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected
                        ? accent.withValues(alpha: .14)
                        : AppColors.primarySoft.withValues(alpha: .70),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, color: accentDark, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (badge != null) ...[
                        Text(
                          badge!,
                          style: TextStyle(
                            color: accentDark,
                            fontSize: 6.8,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .65,
                          ),
                        ),
                        const SizedBox(height: 3),
                      ],
                      Text(
                        title,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 10.8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 8.6,
                          height: 1.34,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected ? accent : Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: selected ? accent : AppColors.borderStrong,
                    ),
                  ),
                  child: Icon(
                    selected ? Icons.check_rounded : Icons.arrow_forward_rounded,
                    color: selected ? Colors.white : AppColors.textMuted,
                    size: 15,
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

class _DomainCard extends StatelessWidget {
  const _DomainCard({
    required this.selected,
    required this.disabled,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final bool disabled;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: disabled ? .40 : 1,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: disabled ? null : onTap,
          borderRadius: BorderRadius.circular(17),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 210),
            curve: Curves.easeOutCubic,
            constraints: const BoxConstraints(minHeight: 108),
            padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
            decoration: BoxDecoration(
              gradient: selected
                  ? LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppColors.primarySoft,
                        Colors.white.withValues(alpha: .94),
                        AppColors.surfaceRose.withValues(alpha: .52),
                      ],
                    )
                  : LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Colors.white.withValues(alpha: .95),
                        AppColors.surfaceMuted.withValues(alpha: .34),
                      ],
                    ),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(
                color: selected ? AppColors.primary : AppColors.border,
                width: selected ? 1.4 : 1,
              ),
              boxShadow: selected
                  ? [
                      BoxShadow(
                        color: AppColors.primaryDeep.withValues(alpha: .085),
                        blurRadius: 18,
                        offset: const Offset(0, 7),
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
                      width: 32,
                      height: 32,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .88),
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Icon(icon, color: AppColors.primaryDark, size: 16),
                    ),
                    const Spacer(),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: 24,
                      height: 24,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: selected ? AppColors.primary : Colors.white,
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(
                          color: selected
                              ? AppColors.primary
                              : AppColors.borderStrong,
                        ),
                      ),
                      child: Icon(
                        selected ? Icons.check_rounded : Icons.add_rounded,
                        color: selected ? Colors.white : AppColors.textMuted,
                        size: 14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 7.6,
                    height: 1.28,
                    fontWeight: FontWeight.w600,
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

class _LanguageSelector extends StatelessWidget {
  const _LanguageSelector({
    required this.value,
    required this.label,
    required this.onTap,
  });

  final String value;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(11, 9, 10, 9),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withValues(alpha: .94),
                AppColors.primarySoft.withValues(alpha: .42),
                AppColors.surfaceRose.withValues(alpha: .30),
              ],
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: AppColors.borderStrong.withValues(alpha: .80),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .88),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: .12),
                  ),
                ),
                child: const Icon(
                  Icons.translate_rounded,
                  size: 17,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'DISCOVERY LANGUAGE',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 6.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .70,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _languageHint(value),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.7,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .68),
                  borderRadius: BorderRadius.circular(10),
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

class _LanguagePickerSheet extends StatelessWidget {
  const _LanguagePickerSheet({
    required this.selectedValue,
    required this.options,
  });

  final String selectedValue;
  final List<({String value, String label})> options;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(30),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(15, 10, 15, 17),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver.withValues(alpha: .78),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const SizedBox(height: 15),
              Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(0xFFDCF1ED),
                          Color(0xFFFFF4F6),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.language_rounded,
                      size: 20,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Choose discovery language',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 15.6,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -.24,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'Use the language that best matches the community evidence you want to prioritize.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.3,
                            height: 1.32,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 7),
                  Material(
                    color: AppColors.primarySoft.withValues(alpha: .56),
                    borderRadius: BorderRadius.circular(11),
                    child: InkWell(
                      onTap: () => Navigator.of(context).pop(),
                      borderRadius: BorderRadius.circular(11),
                      child: const SizedBox(
                        width: 32,
                        height: 32,
                        child: Icon(
                          Icons.close_rounded,
                          size: 17,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 13),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(context).height * .58,
                ),
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  child: Column(
                    children: options
                        .map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 7),
                            child: _LanguageOptionTile(
                              value: item.value,
                              label: item.label,
                              selected: item.value == selectedValue,
                              onTap: () =>
                                  Navigator.of(context).pop(item.value),
                            ),
                          ),
                        )
                        .toList(growable: false),
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

class _LanguageOptionTile extends StatelessWidget {
  const _LanguageOptionTile({
    required this.value,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String value;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final code = value == 'ANY' ? 'ALL' : value;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .76)
                : Colors.white.withValues(alpha: .86),
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .42)
                  : AppColors.border.withValues(alpha: .92),
              width: selected ? 1.2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? Colors.white.withValues(alpha: .88)
                      : AppColors.surfaceMuted.withValues(alpha: .70),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  code,
                  style: TextStyle(
                    color: selected
                        ? AppColors.primaryDeep
                        : AppColors.textSecondary,
                    fontSize: 7.6,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .35,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: selected
                            ? AppColors.primaryDeep
                            : AppColors.textPrimary,
                        fontSize: 10.6,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _languageHint(value),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.6,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 27,
                height: 27,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? AppColors.primary : Colors.transparent,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected
                        ? AppColors.primary
                        : AppColors.silver.withValues(alpha: .72),
                  ),
                ),
                child: Icon(
                  selected ? Icons.check_rounded : Icons.arrow_forward_rounded,
                  size: 14,
                  color: selected ? Colors.white : AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _languageHint(String value) {
  return switch (value) {
    'EN' => 'Prioritize English-language community evidence',
    'AR' => 'Prioritize Arabic-language community evidence',
    'FR' => 'Prioritize French-language community evidence',
    'ES' => 'Prioritize Spanish-language community evidence',
    'DE' => 'Prioritize German-language community evidence',
    'TR' => 'Prioritize Turkish-language community evidence',
    _ => 'Let Voxidence use the strongest language match automatically',
  };
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.requiredField = false,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final bool requiredField;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              label,
              style: const TextStyle(
                color: AppColors.primaryDeep,
                fontSize: 9.2,
                fontWeight: FontWeight.w900,
              ),
            ),
            if (requiredField) ...[
              const SizedBox(width: 4),
              const Text(
                'REQUIRED',
                style: TextStyle(
                  color: AppColors.pinkDeep,
                  fontSize: 6.4,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .45,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 10.8,
            fontWeight: FontWeight.w700,
          ),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Icon(icon, size: 18),
            filled: true,
            fillColor: Colors.white.withValues(alpha: .88),
          ),
        ),
      ],
    );
  }
}

class _ReviewFact extends StatelessWidget {
  const _ReviewFact({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .72),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.primarySoft.withValues(alpha: .74),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(icon, size: 16, color: AppColors.primaryDark),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label.toUpperCase(),
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 7.2,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .55,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 9.8,
                      height: 1.3,
                      fontWeight: FontWeight.w800,
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
