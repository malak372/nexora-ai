// Four-step Voxidence idea-generation flow for authenticated mobile users.
// Content and behavior mirror the normal-user web wizard while the layout is
// rebuilt for compact, touch-first mobile interaction.
//
// @author  Malak

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'generation_progress_page.dart';

class GenerateIdeaPage extends StatefulWidget {
  const GenerateIdeaPage({
    super.key,
    this.onGenerationStarted,
    this.initialProblem,
  });

  final VoidCallback? onGenerationStarted;
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
      _description.text = incoming.substring(0, incoming.length.clamp(0, _maxSignal).toInt());
    }
    _description.addListener(_refresh);
    _load();
    _initSpeech();
  }

  @override
  void dispose() {
    _speech.cancel();
    _description
      ..removeListener(_refresh)
      ..dispose();
    _country.dispose();
    _city.dispose();
    _region.dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }

    try {
      final results = await Future.wait<dynamic>([
        UserApi.instance.getDomains(force: force),
        UserApi.instance.getPricing(),
      ]);
      if (!mounted) return;
      setState(() {
        _domains = (results[0] as List<Map<String, dynamic>>);
        _pricing = Map<String, dynamic>.from(results[1] as Map);
      });
      await _session.load(force: force);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load generation options. Please try again.');
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
          setState(() => _listening = status.toLowerCase().contains('listening'));
        },
        onError: (error) {
          if (!mounted) return;
          final raw = error.errorMsg.toLowerCase();
          setState(() {
            _listening = false;
            _voiceError = raw.contains('permission') || raw.contains('not-allowed')
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
          _voiceError = 'Voice typing is not available here. You can still type normally.';
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
        if (locale.localeId.toLowerCase().startsWith(prefix)) return locale.localeId;
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
          _voiceError = 'The microphone could not start. Check permission and try again.';
        });
      }
    }
  }

  void _onSpeechResult(SpeechRecognitionResult result) {
    final spoken = result.recognizedWords.trim();
    if (spoken.isEmpty) return;
    final next = [_voiceBase, spoken].where((value) => value.trim().isNotEmpty).join(' ').trim();
    _description.value = TextEditingValue(
      text: next.length > _maxSignal ? next.substring(0, _maxSignal) : next,
      selection: TextSelection.collapsed(offset: next.length.clamp(0, _maxSignal).toInt()),
    );
    if (mounted && result.finalResult) setState(() => _listening = false);
  }

  bool get _hasSignal => _description.text.trim().length >= _minSignal;
  bool get _isPremium => _session.summary?.isPremium == true;
  int get _creditBalance => _session.summary?.creditBalance ?? 0;
  int get _freeRemaining => _session.summary?.remainingFreeGenerations ?? 0;
  int get _premiumCost => _asInt(_pricing['premiumIdeaCreditCost']);

  bool get _blocked {
    if (_checkingEntitlement) return false;
    if (_isPremium) return _premiumCost <= 0 || _creditBalance < _premiumCost;
    return _freeRemaining <= 0;
  }

  bool get _canContinue {
    return switch (_step) {
      0 => _hasSignal,
      1 => _hasSignal || _selectedDomainIds.isNotEmpty || _personalized,
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

  void _togglePersonalized() {
    setState(() {
      _personalized = !_personalized;
      if (_personalized) _selectedDomainIds.clear();
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
      setState(() => _error = 'Describe the problem with at least $_minSignal characters, or choose domains instead.');
      return;
    }
    if (_step == 1 && !_canContinue) {
      setState(() => _error = 'Choose one to three domains, use personalized discovery, or go back and add a problem signal.');
      return;
    }
    if (_step == 2 && _country.text.trim().isEmpty) {
      setState(() => _error = 'Country is required so Voxidence can ground the evidence.');
      return;
    }
    if (_step < 3) setState(() => _step += 1);
  }

  void _chooseDomainsInstead() {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _error = '';
      _step = 1;
    });
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
      if (runId.isEmpty) throw const ApiException('Generation started without a run identifier.');

      widget.onGenerationStarted?.call();
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => GenerationProgressPage(runId: runId),
          settings: RouteSettings(name: '/normal/generation/$runId'),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      if ((error.statusCode == 403 || error.statusCode == 409) &&
          error.message.toLowerCase().contains('free')) {
        await _session.load(force: true);
      }
      setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Idea generation could not be started.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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
              _TopBar(
                isPremium: _isPremium,
                onBack: _step == 0 ? null : () => setState(() => _step -= 1),
              ),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 118),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _StepRail(step: _step),
                      const SizedBox(height: 14),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 260),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        child: KeyedSubtree(key: ValueKey(_step), child: _stepBody()),
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
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .96),
            border: const Border(top: BorderSide(color: AppColors.border)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .06),
                blurRadius: 22,
                offset: const Offset(0, -8),
              ),
            ],
          ),
          child: Row(
            children: [
              if (_step > 0)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _submitting ? null : () => setState(() => _step -= 1),
                    icon: const Icon(Icons.arrow_back_rounded, size: 17),
                    label: const Text('Back'),
                  ),
                ),
              if (_step > 0) const SizedBox(width: 10),
              Expanded(
                flex: _step > 0 ? 2 : 1,
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
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Icon(_step == 3 ? Icons.auto_awesome_rounded : Icons.arrow_forward_rounded),
                  label: Text(_submitting ? 'Starting...' : _step == 3 ? 'Generate idea' : 'Continue'),
                ),
              ),
            ],
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
    return VoxCard(
      padding: const EdgeInsets.fromLTRB(18, 19, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Kicker(icon: Icons.auto_awesome_rounded, text: 'Tell us what you noticed'),
          const SizedBox(height: 10),
          Text('What real problem should Voxidence investigate?', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          const Text(
            'Describe the frustration, who experiences it, and why current solutions are not enough.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11.3, height: 1.48),
          ),
          const SizedBox(height: 15),
          Container(
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .86),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: _listening ? AppColors.primary : AppColors.border, width: _listening ? 1.5 : 1),
            ),
            child: Column(
              children: [
                TextField(
                  controller: _description,
                  minLines: 5,
                  maxLines: 8,
                  maxLength: _maxSignal,
                  decoration: const InputDecoration(
                    hintText: 'Example: Students in Nablus struggle to coordinate shared transport because schedules change and there is no trusted real-time matching system…',
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    counterText: '',
                    contentPadding: EdgeInsets.fromLTRB(15, 15, 15, 8),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 2, 10, 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _toggleVoice,
                          style: OutlinedButton.styleFrom(
                            backgroundColor: _listening ? AppColors.primarySoft : Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 10),
                          ),
                          icon: Icon(_listening ? Icons.mic_off_rounded : Icons.mic_none_rounded, size: 17),
                          label: Text(_listening ? 'Listening…' : 'Speak to type'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextButton.icon(
                          onPressed: _chooseDomainsInstead,
                          icon: const Icon(Icons.layers_outlined, size: 17),
                          label: const Text('Choose domains instead'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Row(
            children: [
              Text(
                _hasSignal ? 'Enough detail to continue.' : 'At least $_minSignal characters to use this signal.',
                style: TextStyle(
                  color: _hasSignal ? AppColors.primaryDark : AppColors.textMuted,
                  fontSize: 9.4,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              Text('$count/$_maxSignal', style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w800)),
            ],
          ),
          if (_voiceError.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(_voiceError, style: const TextStyle(color: AppColors.pinkDeep, fontSize: 9.8, height: 1.35)),
          ],
          const SizedBox(height: 14),
          const Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _Tip(text: 'Include who is affected'),
              _Tip(text: 'Explain the repeated pain'),
              _Tip(text: 'Mention the location when relevant'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _focusStep() {
    final autoSelected = _hasSignal && _selectedDomainIds.isEmpty && !_personalized;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        VoxCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _Kicker(icon: Icons.public_rounded, text: 'Opportunity focus'),
              const SizedBox(height: 10),
              Text('Blend domains into one stronger opportunity.', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                _hasSignal
                    ? 'Your description remains the primary signal. Select up to three domains so Voxidence can combine related pains, evidence, and business opportunities.'
                    : 'Select one to three domains. Voxidence will search for a meaningful cross-domain problem and generate one coherent business idea.',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.1, height: 1.46),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _personalized ? 'Personalized discovery selected' : '${_selectedDomainIds.length} of $_maxDomains domains selected',
                          style: const TextStyle(color: AppColors.primaryDeep, fontSize: 11.2, fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _personalized
                              ? 'Voxidence will use your saved interests, preferences, favorites, accepted ideas, and idea history.'
                              : 'Choose complementary areas rather than unrelated categories.',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 9.5, height: 1.35),
                        ),
                      ],
                    ),
                  ),
                  if (_selectedDomainIds.isNotEmpty || _personalized)
                    TextButton(
                      onPressed: () => setState(() {
                        _selectedDomainIds.clear();
                        _personalized = false;
                      }),
                      child: const Text('Clear'),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        _ModeCard(
          selected: _personalized,
          icon: Icons.auto_awesome_rounded,
          title: 'I don’t have an idea yet',
          subtitle: 'Build a direction around my interests and preferences',
          onTap: _togglePersonalized,
        ),
        const SizedBox(height: 8),
        _ModeCard(
          selected: autoSelected,
          disabled: !_hasSignal,
          icon: Icons.hub_outlined,
          title: 'Auto-detect the best domain blend',
          subtitle: _hasSignal
              ? 'Recommended · Voxidence resolves the strongest combination from your signal'
              : 'Add a description first to use automatic detection',
          onTap: _selectAuto,
        ),
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
          ..._domains.map((domain) {
            final id = '${domain['id'] ?? ''}';
            final selected = _selectedDomainIds.contains(id);
            final blocked = !selected && _selectedDomainIds.length >= _maxDomains;
            final name = '${domain['name'] ?? domain['displayName'] ?? 'Software domain'}';
            final description = '${domain['description'] ?? 'Software opportunity domain'}';
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _DomainCard(
                selected: selected,
                disabled: blocked,
                icon: _domainIcon(name),
                title: name,
                subtitle: description,
                onTap: () => _toggleDomain(id),
              ),
            );
          }),
      ],
    );
  }

  Widget _groundStep() {
    return VoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Kicker(icon: Icons.location_on_outlined, text: 'Local intelligence'),
          const SizedBox(height: 10),
          Text('Where should the solution create impact?', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          const Text(
            'Location helps Voxidence prioritize locally relevant evidence while source selection stays automatic.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11.1, height: 1.45),
          ),
          const SizedBox(height: 16),
          _Field(controller: _country, label: 'Country *', hint: 'Palestine', icon: Icons.flag_outlined),
          const SizedBox(height: 11),
          _Field(controller: _city, label: 'City', hint: 'Nablus', icon: Icons.location_city_outlined),
          const SizedBox(height: 11),
          _Field(controller: _region, label: 'Region', hint: 'West Bank', icon: Icons.map_outlined),
          const SizedBox(height: 11),
          const Text('Community language', style: TextStyle(color: AppColors.primaryDeep, fontSize: 10.2, fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: _language,
            items: _languages.map((item) => DropdownMenuItem(value: item.value, child: Text(item.label))).toList(),
            onChanged: (value) => setState(() => _language = value ?? 'ANY'),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.translate_rounded, size: 18)),
          ),
          const SizedBox(height: 13),
          const InlineNotice(
            icon: Icons.auto_fix_high_rounded,
            message: 'No manual data-source selection. Voxidence chooses active sources automatically using domain, language, location, availability, and evidence quality.',
          ),
        ],
      ),
    );
  }

  Widget _reviewStep() {
    final location = [_city.text.trim(), _region.text.trim(), _country.text.trim()].where((part) => part.isNotEmpty).join(', ');
    final domainBlend = _personalized
        ? 'Personalized by Voxidence'
        : _selectedDomains.isNotEmpty
            ? _selectedDomains.map((item) => '${item['name'] ?? item['displayName'] ?? 'Domain'}').join(' + ')
            : 'Auto-detected by Voxidence';
    final language = _languages.firstWhere((item) => item.value == _language).label;
    final discoveryInput = _personalized
        ? 'Personalized discovery based on your interests, preferences, favorites, accepted ideas, and idea history.'
        : _description.text.trim().isNotEmpty
            ? _description.text.trim()
            : 'Cross-domain discovery: $domainBlend';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        VoxCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _Kicker(icon: Icons.auto_awesome_rounded, text: 'Ready to discover'),
              const SizedBox(height: 10),
              Text('Review the signal before launching.', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 13),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .52),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('DISCOVERY INPUT', style: TextStyle(color: AppColors.primaryDark, fontSize: 8.7, fontWeight: FontWeight.w900, letterSpacing: .8)),
                    const SizedBox(height: 6),
                    Text(discoveryInput, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.2, height: 1.48, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              _ReviewFact(label: 'Domain blend', value: domainBlend, icon: Icons.layers_outlined),
              _ReviewFact(label: 'Location', value: location, icon: Icons.location_on_outlined),
              _ReviewFact(label: 'Language', value: language, icon: Icons.translate_rounded),
              const _ReviewFact(label: 'Source strategy', value: 'Backend intelligence', icon: Icons.hub_outlined),
            ],
          ),
        ),
        const SizedBox(height: 10),
        VoxCard(
          tint: _forceRefresh ? AppColors.primarySoft.withValues(alpha: .68) : null,
          child: SwitchListTile.adaptive(
            contentPadding: EdgeInsets.zero,
            value: _forceRefresh,
            onChanged: (value) => setState(() => _forceRefresh = value),
            title: const Text('Collect fresh evidence', style: TextStyle(color: AppColors.textPrimary, fontSize: 11.6, fontWeight: FontWeight.w900)),
            subtitle: const Text('Turn this on only when you do not want to reuse a recent matching collection.', style: TextStyle(color: AppColors.textSecondary, fontSize: 9.6, height: 1.35)),
          ),
        ),
        const SizedBox(height: 10),
        VoxCard(
          tint: _isPremium ? AppColors.primarySoft.withValues(alpha: .72) : AppColors.pinkSoft.withValues(alpha: .45),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SoftIconBadge(icon: _isPremium ? Icons.bolt_rounded : Icons.eco_outlined, size: 40, rose: !_isPremium),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _isPremium ? 'Premium idea generation' : 'Normal idea generation',
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.5, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _isPremium
                          ? 'This generation uses ${_premiumCost > 0 ? _premiumCost : '…'} of your $_creditBalance credits and creates the complete advanced workspace immediately.'
                          : 'Your available free generation creates the core validated idea. After it is ready, you can open it first and choose Direct Unlock only when you want the advanced workspace.',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.8, height: 1.42),
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
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: VoxCard(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    children: [
                      SoftIconBadge(icon: premium ? Icons.bolt_rounded : Icons.lock_outline_rounded, size: 58, rose: !premium),
                      const SizedBox(height: 15),
                      Text('Generation access', style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      Text(
                        premium
                            ? 'Premium generation needs $_premiumCost credits. Your current balance is $_creditBalance.'
                            : 'You have used your available free discoveries. Your existing ideas stay safe and available in My Ideas.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.1, height: 1.48),
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: () => Navigator.pushNamed(context, premium ? '/normal/credits' : '/normal/credits'),
                          icon: Icon(premium ? Icons.add_card_rounded : Icons.workspace_premium_outlined),
                          label: Text(premium ? 'Buy more credits' : 'Upgrade workspace'),
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () => Navigator.pushNamed(context, '/normal/ideas'),
                          icon: const Icon(Icons.lightbulb_outline_rounded),
                          label: const Text('View my ideas'),
                        ),
                      ),
                      TextButton(
                        onPressed: () => Navigator.pushNamed(context, '/normal/dashboard'),
                        child: const Text('Back to dashboard'),
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

  IconData _domainIcon(String name) {
    final value = name.toLowerCase();
    if (value.contains('education')) return Icons.school_outlined;
    if (value.contains('health')) return Icons.favorite_border_rounded;
    if (value.contains('finance') || value.contains('business')) return Icons.business_center_outlined;
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

class _TopBar extends StatelessWidget {
  const _TopBar({required this.isPremium, this.onBack});

  final bool isPremium;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
      child: Row(
        children: [
          if (onBack != null)
            IconButton.filledTonal(onPressed: onBack, icon: const Icon(Icons.arrow_back_rounded, size: 18))
          else
            const SoftIconBadge(icon: Icons.auto_awesome_rounded, size: 40),
          const SizedBox(width: 10),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Generate an idea', style: TextStyle(color: AppColors.textPrimary, fontSize: 16.4, fontWeight: FontWeight.w900)),
                SizedBox(height: 2),
                Text('Evidence-led discovery', style: TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          AccountTierBadge(isPremium: isPremium),
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
    return VoxCard(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 10),
      child: Row(
        children: List.generate(_GenerateIdeaPageState._steps.length, (index) {
          final current = index == step;
          final complete = index < step;
          final item = _GenerateIdeaPageState._steps[index];
          return Expanded(
            child: Row(
              children: [
                Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 3),
                    decoration: BoxDecoration(
                      color: current ? AppColors.primarySoft : Colors.transparent,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      children: [
                        Container(
                          width: 29,
                          height: 29,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: current || complete ? AppColors.primary : Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: current || complete ? AppColors.primary : AppColors.border),
                          ),
                          child: complete
                              ? const Icon(Icons.check_rounded, color: Colors.white, size: 15)
                              : Text('${index + 1}', style: TextStyle(color: current ? Colors.white : AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w900)),
                        ),
                        const SizedBox(height: 5),
                        Text(item.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: current ? AppColors.primaryDeep : AppColors.textMuted, fontSize: 8.4, fontWeight: FontWeight.w900)),
                      ],
                    ),
                  ),
                ),
                if (index < 3)
                  Container(width: 8, height: 1, color: complete ? AppColors.primary : AppColors.border),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _Kicker extends StatelessWidget {
  const _Kicker({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.primaryDark),
        const SizedBox(width: 6),
        Text(text.toUpperCase(), style: const TextStyle(color: AppColors.primaryDark, fontSize: 8.8, fontWeight: FontWeight.w900, letterSpacing: .8)),
      ],
    );
  }
}

class _Tip extends StatelessWidget {
  const _Tip({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check_circle_outline_rounded, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(text, style: const TextStyle(color: AppColors.textSecondary, fontSize: 8.9, fontWeight: FontWeight.w700)),
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
      opacity: disabled ? .48 : 1,
      child: VoxCard(
        onTap: disabled ? null : onTap,
        tint: selected ? AppColors.primarySoft.withValues(alpha: .78) : null,
        child: Row(
          children: [
            SoftIconBadge(icon: icon, size: 39),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.2, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 3),
                  Text(subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.3, height: 1.34)),
                ],
              ),
            ),
            Icon(selected ? Icons.check_circle_rounded : Icons.arrow_forward_ios_rounded, color: selected ? AppColors.primary : AppColors.textMuted, size: selected ? 20 : 14),
          ],
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
      opacity: disabled ? .44 : 1,
      child: VoxCard(
        onTap: disabled ? null : onTap,
        padding: const EdgeInsets.all(13),
        tint: selected ? AppColors.primarySoft.withValues(alpha: .74) : null,
        child: Row(
          children: [
            SoftIconBadge(icon: icon, size: 39),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 11.2, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 3),
                  Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.1, height: 1.34)),
                ],
              ),
            ),
            Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? AppColors.primary : Colors.white,
                shape: BoxShape.circle,
                border: Border.all(color: selected ? AppColors.primary : AppColors.border),
              ),
              child: selected ? const Icon(Icons.check_rounded, color: Colors.white, size: 15) : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.controller, required this.label, required this.hint, required this.icon});
  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.primaryDeep, fontSize: 10.2, fontWeight: FontWeight.w900)),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          decoration: InputDecoration(hintText: hint, prefixIcon: Icon(icon, size: 18)),
        ),
      ],
    );
  }
}

class _ReviewFact extends StatelessWidget {
  const _ReviewFact({required this.label, required this.value, required this.icon});
  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .66),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Icon(icon, size: 17, color: AppColors.primaryDark),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label.toUpperCase(), style: const TextStyle(color: AppColors.textMuted, fontSize: 8.2, fontWeight: FontWeight.w900, letterSpacing: .5)),
                  const SizedBox(height: 2),
                  Text(value, style: const TextStyle(color: AppColors.textPrimary, fontSize: 10.5, fontWeight: FontWeight.w800)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
