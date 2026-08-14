// Refined mobile Preferences workspace for Voxidence.
//
// Keeps preference behavior aligned with the backend while presenting
// language, location and interests in a polished mobile-first experience.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../widgets/user_ui.dart';

class PreferencesPage extends StatefulWidget {
  const PreferencesPage({super.key});

  @override
  State<PreferencesPage> createState() => _PreferencesPageState();
}

class _PreferencesPageState extends State<PreferencesPage> {
  final _country = TextEditingController();
  final _city = TextEditingController();
  final _region = TextEditingController();

  String _language = 'EN';
  List<Map<String, dynamic>> _groups = const [];
  final Set<String> _selectedIds = <String>{};
  final Map<String, String> _categoryById = <String, String>{};

  bool _loading = true;
  bool _saving = false;
  Object? _error;

  static const _languages = <String, String>{
    'ANY': 'Any language',
    'EN': 'English',
    'AR': 'Arabic',
    'FR': 'French',
    'ES': 'Spanish',
    'DE': 'German',
    'TR': 'Turkish',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _country.dispose();
    _city.dispose();
    _region.dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final values = await Future.wait<dynamic>([
        UserApi.instance.getPreferences(force: force),
        UserApi.instance.getPreferenceOptions(force: force),
      ]);

      final current = values[0] is Map
          ? Map<String, dynamic>.from(values[0] as Map)
          : <String, dynamic>{};
      final rawCatalog = values[1];

      final groups = <Map<String, dynamic>>[];
      final selected = <String>{};
      final categoryById = <String, String>{};

      final currentSelections = current['selections'];
      if (currentSelections is List) {
        for (final raw in currentSelections) {
          if (raw is! Map) continue;
          final id = raw['id']?.toString();
          if (id != null && id.isNotEmpty) selected.add(id);
        }
      }

      final source = rawCatalog is List
          ? rawCatalog
          : rawCatalog is Map && rawCatalog['data'] is List
              ? rawCatalog['data'] as List
              : rawCatalog is Map && rawCatalog['items'] is List
                  ? rawCatalog['items'] as List
                  : const <dynamic>[];

      for (final rawGroup in source) {
        if (rawGroup is! Map) continue;

        final group = Map<String, dynamic>.from(rawGroup);
        final category = '${group['category'] ?? 'OTHER'}';
        final options = group['options'];

        if (options is List) {
          for (final rawOption in options) {
            if (rawOption is! Map) continue;

            final id = rawOption['id']?.toString();
            if (id == null || id.isEmpty) continue;

            categoryById[id] = category;
            if (rawOption['selected'] == true) selected.add(id);
          }
        }

        groups.add(group);
      }

      if (!mounted) return;

      setState(() {
        final language = '${current['preferredLanguage'] ?? 'EN'}';
        _language = _languages.containsKey(language) ? language : 'EN';
        _country.text = '${current['preferredCountry'] ?? ''}';
        _city.text = '${current['preferredCity'] ?? ''}';
        _region.text = '${current['preferredRegion'] ?? ''}';
        _groups = groups;
        _selectedIds
          ..clear()
          ..addAll(selected);
        _categoryById
          ..clear()
          ..addAll(categoryById);
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toggle(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else if (_selectedIds.length < 20) {
        _selectedIds.add(id);
      } else {
        showAppSnackBar(
          context,
          'You can select up to 20 interests.',
          error: true,
        );
      }
    });
  }

  Future<void> _pickLanguage() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (_) => _LanguagePickerSheet(
        selected: _language,
        languages: _languages,
      ),
    );

    if (!mounted || selected == null || selected == _language) return;
    setState(() => _language = selected);
  }

  Future<void> _save() async {
    if (_saving) return;

    if (_selectedIds.length < 3) {
      showAppSnackBar(
        context,
        'Choose at least 3 interests.',
        error: true,
      );
      return;
    }

    final categories = _selectedIds
        .map((id) => _categoryById[id])
        .whereType<String>()
        .toSet();

    if (categories.length < 2) {
      showAppSnackBar(
        context,
        'Choose interests from at least 2 categories.',
        error: true,
      );
      return;
    }

    setState(() => _saving = true);

    try {
      await UserApi.instance.updatePreferences({
        'preferenceOptionIds': _selectedIds.toList(),
        'preferredLanguage': _language,
        if (_country.text.trim().isNotEmpty)
          'preferredCountry': _country.text.trim(),
        if (_city.text.trim().isNotEmpty) 'preferredCity': _city.text.trim(),
        if (_region.text.trim().isNotEmpty)
          'preferredRegion': _region.text.trim(),
      });

      if (mounted) {
        showAppSnackBar(context, 'Preferences saved.');
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _backToProfile() {
    returnFromWorkspacePage(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _PreferencesRouteHeader(onBack: _backToProfile),
          Expanded(
            child: WorkspaceBackground(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () => _load(force: true),
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 126),
                  children: [
                    _PreferencesHero(
                      selectedCount: _selectedIds.length,
                    ),
                    const SizedBox(height: 14),
                    if (_loading)
                      const LoadingList(count: 4)
                    else if (_error != null)
                      EmptyState(
                        icon: Icons.tune_rounded,
                        title: 'Preferences unavailable',
                        message: _error.toString(),
                        action: FilledButton.icon(
                          onPressed: () => _load(force: true),
                          icon: const Icon(Icons.refresh_rounded, size: 17),
                          label: const Text('Try again'),
                        ),
                      )
                    else ...[
                      _DiscoveryContextCard(
                        languageCode: _language,
                        languageLabel:
                            _languages[_language] ?? _languages['EN']!,
                        countryController: _country,
                        cityController: _city,
                        regionController: _region,
                        onLanguageTap: _pickLanguage,
                      ),
                      const SizedBox(height: 18),
                      _InterestsHeading(
                        selected: _selectedIds.length,
                      ),
                      const SizedBox(height: 10),
                      ..._groups.map(_buildInterestGroup),
                      const SizedBox(height: 3),
                      _SavePreferencesButton(
                        saving: _saving,
                        onPressed: _save,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInterestGroup(Map<String, dynamic> group) {
    final rawCategory = '${group['category'] ?? 'OTHER'}';
    final category = _prettyCategory(rawCategory);
    final rawOptions = group['options'];
    final options = rawOptions is List ? rawOptions : const <dynamic>[];
    final selectedInGroup = options.whereType<Map>().where((raw) {
      final id = raw['id']?.toString() ?? '';
      return _selectedIds.contains(id);
    }).length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: _InterestGroupCard(
        category: category,
        selectedCount: selectedInGroup,
        icon: _categoryIcon(rawCategory),
        children: options.whereType<Map>().map((raw) {
          final id = raw['id']?.toString() ?? '';
          final selected = _selectedIds.contains(id);
          final label = '${raw['name'] ?? raw['key'] ?? 'Interest'}';

          return _InterestChip(
            label: label,
            selected: selected,
            onTap: id.isEmpty ? null : () => _toggle(id),
          );
        }).toList(),
      ),
    );
  }
}

class _PreferencesRouteHeader extends StatelessWidget {
  const _PreferencesRouteHeader({
    required this.onBack,
  });

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final returnTitle = workspaceReturnTarget(context).title;

    return Material(
      color: AppColors.surface.withValues(alpha: .985),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 6, 18, 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.border.withValues(alpha: .65),
              ),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .025),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onBack,
                  borderRadius: BorderRadius.circular(14),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons.arrow_back_rounded,
                        size: 26,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 18.5,
                          height: 1.08,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.28,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Preferences',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.6,
                          height: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
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

class _PreferencesHero extends StatelessWidget {
  const _PreferencesHero({
    required this.selectedCount,
  });

  final int selectedCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .12),
        ),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFEFD),
            Color(0xFFF2FAF7),
            Color(0xFFFFF7F9),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .05),
            blurRadius: 26,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -36,
            top: -52,
            child: Container(
              width: 138,
              height: 138,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .065),
              ),
            ),
          ),
          Positioned(
            left: -38,
            bottom: -60,
            child: Container(
              width: 118,
              height: 118,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .04),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 15, 14, 15),
            child: Row(
              children: [
                Container(
                  width: 50,
                  height: 50,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(17),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Color(0xFFE6F6F2),
                        Color(0xFFFFF7F8),
                      ],
                    ),
                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: .12),
                    ),
                  ),
                  child: const Icon(
                    Icons.tune_rounded,
                    size: 23,
                    color: AppColors.primaryDark,
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'PERSONALIZE',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 7.8,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.05,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Shape what Voxidence listens for',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 16.2,
                          height: 1.08,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.28,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Language, location and interests work together to tune discovery.',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 8.8,
                          height: 1.35,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .72),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: .12),
                    ),
                  ),
                  child: Text(
                    '$selectedCount',
                    style: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
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
}

class _DiscoveryContextCard extends StatelessWidget {
  const _DiscoveryContextCard({
    required this.languageCode,
    required this.languageLabel,
    required this.countryController,
    required this.cityController,
    required this.regionController,
    required this.onLanguageTap,
  });

  final String languageCode;
  final String languageLabel;
  final TextEditingController countryController;
  final TextEditingController cityController;
  final TextEditingController regionController;
  final VoidCallback onLanguageTap;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      radius: 25,
      padding: const EdgeInsets.fromLTRB(15, 16, 15, 15),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(
            title: 'Discovery context',
            subtitle: 'Optional location and preferred language.',
          ),
          const SizedBox(height: 14),
          _LanguageSelector(
            code: languageCode,
            label: languageLabel,
            onTap: onLanguageTap,
          ),
          const SizedBox(height: 10),
          TextField(
            controller: countryController,
            maxLength: 100,
            decoration: const InputDecoration(
              labelText: 'Preferred country',
              prefixIcon: Icon(Icons.public_outlined),
              counterText: '',
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cityController,
                  maxLength: 100,
                  decoration: const InputDecoration(
                    labelText: 'City',
                    prefixIcon: Icon(Icons.location_city_outlined),
                    counterText: '',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: regionController,
                  maxLength: 100,
                  decoration: const InputDecoration(
                    labelText: 'Region',
                    prefixIcon: Icon(Icons.map_outlined),
                    counterText: '',
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

class _LanguageSelector extends StatelessWidget {
  const _LanguageSelector({
    required this.code,
    required this.label,
    required this.onTap,
  });

  final String code;
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
          padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFBFEFD),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .90),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.translate_rounded,
                  size: 19,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Preferred language',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.4,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      label,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceRose.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  code,
                  style: const TextStyle(
                    color: AppColors.pinkDeep,
                    fontSize: 8.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 7),
              const Icon(
                Icons.keyboard_arrow_down_rounded,
                color: AppColors.primaryDark,
                size: 20,
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
    required this.selected,
    required this.languages,
  });

  final String selected;
  final Map<String, String> languages;

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
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const SizedBox(height: 16),
              const Row(
                children: [
                  SoftIconBadge(
                    icon: Icons.translate_rounded,
                    size: 42,
                  ),
                  SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Choose a language',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 16.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 3),
                        Text(
                          'This helps tune discovery and generated ideas.',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              ...languages.entries.map(
                (entry) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _LanguageOption(
                    code: entry.key,
                    label: entry.value,
                    selected: entry.key == selected,
                    onTap: () => Navigator.of(context).pop(entry.key),
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

class _LanguageOption extends StatelessWidget {
  const _LanguageOption({
    required this.code,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String code;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Ink(
          padding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 11,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .82)
                : Colors.white.withValues(alpha: .72),
            borderRadius: BorderRadius.circular(17),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .32)
                  : AppColors.border,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.primary
                      : AppColors.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  code,
                  style: TextStyle(
                    color: selected
                        ? Colors.white
                        : AppColors.primaryDark,
                    fontSize: 8.6,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.4,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Icon(
                selected
                    ? Icons.check_circle_rounded
                    : Icons.arrow_forward_ios_rounded,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.textMuted,
                size: selected ? 18 : 12,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InterestsHeading extends StatelessWidget {
  const _InterestsHeading({
    required this.selected,
  });

  final int selected;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'YOUR SIGNALS',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 7.8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.0,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Your interests',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.25,
                ),
              ),
              SizedBox(height: 3),
              Text(
                'Pick at least 3 interests across 2 categories.',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 7,
          ),
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '$selected/20',
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    );
  }
}

class _InterestGroupCard extends StatelessWidget {
  const _InterestGroupCard({
    required this.category,
    required this.selectedCount,
    required this.icon,
    required this.children,
  });

  final String category;
  final int selectedCount;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      radius: 23,
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SoftIconBadge(
                icon: icon,
                size: 36,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  category,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (selectedCount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceRose,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$selectedCount selected',
                    style: const TextStyle(
                      color: AppColors.pinkDeep,
                      fontSize: 7.7,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 11),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: children,
          ),
        ],
      ),
    );
  }
}

class _InterestChip extends StatelessWidget {
  const _InterestChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Ink(
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 8,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .98)
                : const Color(0xFFFBFDFC),
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .30)
                  : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                selected ? Icons.check_rounded : Icons.add_rounded,
                size: 14,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.primary,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDeep
                      : AppColors.textSecondary,
                  fontSize: 9.8,
                  fontWeight: selected
                      ? FontWeight.w900
                      : FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SavePreferencesButton extends StatelessWidget {
  const _SavePreferencesButton({
    required this.saving,
    required this.onPressed,
  });

  final bool saving;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: saving ? null : onPressed,
        icon: saving
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Icon(
                Icons.check_circle_outline_rounded,
                size: 18,
              ),
        label: Text(
          saving ? 'Saving...' : 'Save preferences',
        ),
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(49),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    );
  }
}

String _prettyCategory(String value) {
  final words = value
      .trim()
      .toLowerCase()
      .replaceAll('_', ' ')
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();

  return words
      .map(
        (word) => '${word[0].toUpperCase()}${word.substring(1)}',
      )
      .join(' ');
}

IconData _categoryIcon(String value) {
  final category = value.toUpperCase();

  if (category.contains('TECH') ||
      category.contains('AI') ||
      category.contains('SOFTWARE')) {
    return Icons.memory_rounded;
  }

  if (category.contains('HEALTH')) {
    return Icons.health_and_safety_outlined;
  }

  if (category.contains('BUSINESS') ||
      category.contains('FINANCE')) {
    return Icons.business_center_outlined;
  }

  if (category.contains('EDUCATION')) {
    return Icons.school_outlined;
  }

  if (category.contains('SECURITY')) {
    return Icons.shield_outlined;
  }

  if (category.contains('DESIGN') ||
      category.contains('CREATIVE')) {
    return Icons.palette_outlined;
  }

  return Icons.auto_awesome_rounded;
}
