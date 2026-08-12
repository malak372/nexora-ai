// Mobile equivalent of the web Preferences page.
//
// @author  Malak

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
        _language = '${current['preferredLanguage'] ?? 'EN'}';
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
        if (_city.text.trim().isNotEmpty)
          'preferredCity': _city.text.trim(),
        if (_region.text.trim().isNotEmpty)
          'preferredRegion': _region.text.trim(),
      });

      if (mounted) showAppSnackBar(context, 'Preferences saved.');
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Preferences')),
      body: WorkspaceBackground(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(force: true),
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 34),
            children: [
              const WorkspacePageHeader(
                eyebrow: 'PERSONALIZE',
                title: 'Tune what Voxidence listens for',
                subtitle:
                    'Your language, region, and interests shape discovery and generation consistently across Voxidence.',
              ),
              const SizedBox(height: 16),
              if (_loading)
                const LoadingList(count: 4)
              else if (_error != null)
                EmptyState(
                  icon: Icons.tune_rounded,
                  title: 'Preferences unavailable',
                  message: _error.toString(),
                  action: FilledButton(
                    onPressed: () => _load(force: true),
                    child: const Text('Retry'),
                  ),
                )
              else ...[
                VoxCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionHeading(
                        title: 'Discovery context',
                        subtitle: 'Optional location + preferred language.',
                      ),
                      const SizedBox(height: 14),
                      DropdownButtonFormField<String>(
                        initialValue: const {
                          'ANY',
                          'EN',
                          'AR',
                          'FR',
                          'ES',
                          'DE',
                          'TR',
                        }.contains(_language)
                            ? _language
                            : 'EN',
                        decoration: const InputDecoration(
                          labelText: 'Preferred language',
                          prefixIcon: Icon(Icons.translate_rounded),
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: 'ANY',
                            child: Text('Any language'),
                          ),
                          DropdownMenuItem(
                            value: 'EN',
                            child: Text('English'),
                          ),
                          DropdownMenuItem(
                            value: 'AR',
                            child: Text('Arabic'),
                          ),
                          DropdownMenuItem(
                            value: 'FR',
                            child: Text('French'),
                          ),
                          DropdownMenuItem(
                            value: 'ES',
                            child: Text('Spanish'),
                          ),
                          DropdownMenuItem(
                            value: 'DE',
                            child: Text('German'),
                          ),
                          DropdownMenuItem(
                            value: 'TR',
                            child: Text('Turkish'),
                          ),
                        ],
                        onChanged: (value) {
                          setState(() => _language = value ?? 'EN');
                        },
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _country,
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
                              controller: _city,
                              maxLength: 100,
                              decoration: const InputDecoration(
                                labelText: 'City',
                                counterText: '',
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: _region,
                              maxLength: 100,
                              decoration: const InputDecoration(
                                labelText: 'Region',
                                counterText: '',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Expanded(
                      child: SectionHeading(
                        title: 'Your interests',
                        subtitle: 'At least 3 across 2 categories.',
                      ),
                    ),
                    StatusChip(label: '${_selectedIds.length}/20'),
                  ],
                ),
                const SizedBox(height: 10),
                ..._groups.map((group) {
                  final category = '${group['category'] ?? 'OTHER'}'
                      .replaceAll('_', ' ');
                  final rawOptions = group['options'];
                  final options = rawOptions is List
                      ? rawOptions
                      : const <dynamic>[];

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 11),
                    child: VoxCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            category,
                            style: const TextStyle(
                              color: AppColors.primaryDeep,
                              fontSize: 11.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .25,
                            ),
                          ),
                          const SizedBox(height: 9),
                          Wrap(
                            spacing: 7,
                            runSpacing: 7,
                            children: options.whereType<Map>().map((raw) {
                              final id = raw['id']?.toString() ?? '';
                              final selected = _selectedIds.contains(id);
                              final label =
                                  '${raw['name'] ?? raw['key'] ?? 'Interest'}';
                              return FilterChip(
                                selected: selected,
                                label: Text(label),
                                avatar: Icon(
                                  selected
                                      ? Icons.check_rounded
                                      : Icons.add_rounded,
                                  size: 15,
                                ),
                                onSelected:
                                    id.isEmpty ? null : (_) => _toggle(id),
                              );
                            }).toList(),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 4),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _saving ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.check_rounded),
                    label: Text(_saving ? 'Saving...' : 'Save preferences'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
