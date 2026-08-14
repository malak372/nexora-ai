import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_selection_field.dart';
import '../widgets/admin_ui.dart';

class AdminSystemSettingsPage extends StatefulWidget {
  const AdminSystemSettingsPage({super.key});

  @override
  State<AdminSystemSettingsPage> createState() => _AdminSystemSettingsPageState();
}

class _AdminSystemSettingsPageState extends State<AdminSystemSettingsPage> {
  static const _currencyOptions = <AdminSelectionOption>[
    AdminSelectionOption(value: 'USD', label: 'US Dollar (USD)', icon: Icons.attach_money_rounded),
    AdminSelectionOption(value: 'EUR', label: 'Euro (EUR)', icon: Icons.euro_rounded),
    AdminSelectionOption(value: 'GBP', label: 'British Pound (GBP)', icon: Icons.currency_exchange_rounded),
    AdminSelectionOption(value: 'ILS', label: 'Israeli New Shekel (ILS)', icon: Icons.currency_exchange_rounded),
    AdminSelectionOption(value: 'AED', label: 'UAE Dirham (AED)', icon: Icons.currency_exchange_rounded),
  ];

  final _api = AdminApi.instance;
  final _passwordController = TextEditingController();

  final Map<String, TextEditingController> _controllers = {
    'creditPrice': TextEditingController(),
    'premiumIdeaCreditCost': TextEditingController(),
    'directUnlockPrice': TextEditingController(),
    'premiumActivationFee': TextEditingController(),
    'normalAcceptancePrice': TextEditingController(),
    'normalPublicationAdvancedPrice': TextEditingController(),
    'publicationAdvancedCreditCost': TextEditingController(),
    'bonusThreshold': TextEditingController(),
    'bonusCredits': TextEditingController(),
  };

  String _accessToken = '';
  String _pricingCurrency = 'USD';
  Map<String, dynamic> _settings = const {};
  DateTime? _expiresAt;

  bool _showPassword = false;
  bool _verifying = false;
  bool _saving = false;
  bool _refreshing = false;
  String _error = '';

  @override
  void dispose() {
    _passwordController.dispose();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _unlock() async {
    if (_verifying || _passwordController.text.trim().isEmpty) return;

    setState(() {
      _verifying = true;
      _error = '';
    });

    try {
      final verified = await _api.verifySensitiveAccess('SYSTEM_SETTINGS', _passwordController.text);
      final token = _text(verified['accessToken']);
      if (token.isEmpty) throw const ApiException('Sensitive access could not be verified.');

      final rawSettings = verified['settings'];
      final settings = rawSettings is Map
          ? Map<String, dynamic>.from(rawSettings)
          : await _api.getSensitiveWorkspace('/admin/settings', token, force: true);

      if (!mounted) return;

      setState(() {
        _accessToken = token;
        _expiresAt = DateTime.tryParse(_text(verified['expiresAt']))?.toLocal();
        _settings = settings;
        _applySettings(settings);
        _passwordController.clear();
      });
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not verify sensitive access.');
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _refresh() async {
    if (_accessToken.isEmpty || _refreshing) return;
    setState(() {
      _refreshing = true;
      _error = '';
    });

    try {
      final settings = await _api.getSensitiveWorkspace('/admin/settings', _accessToken, force: true);
      if (!mounted) return;
      setState(() {
        _settings = settings;
        _applySettings(settings);
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.statusCode == 401 || error.statusCode == 403) {
        _lock(error.message);
      } else {
        setState(() => _error = error.message);
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not refresh system settings.');
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  Future<void> _save() async {
    if (_accessToken.isEmpty || _saving || !_hasChanges) return;

    final validation = _validate();
    if (validation != null) {
      _snack(validation, error: true);
      return;
    }

    setState(() {
      _saving = true;
      _error = '';
    });

    try {
      final body = <String, dynamic>{'pricingCurrency': _pricingCurrency};
      for (final entry in _controllers.entries) {
        final key = entry.key;
        final value = num.tryParse(entry.value.text.trim());
        if (_integerFields.contains(key)) {
          body[key] = value?.toInt();
        } else {
          body[key] = value?.toDouble();
        }
      }

      final result = await _api.patchSensitive('/admin/settings', body, _accessToken);
      final raw = result['settings'];
      final settings = raw is Map
          ? Map<String, dynamic>.from(raw)
          : await _api.getSensitiveWorkspace('/admin/settings', _accessToken, force: true);

      if (!mounted) return;
      setState(() {
        _settings = settings;
        _applySettings(settings);
      });
      _snack(_text(result['message']).isEmpty ? 'System settings updated.' : _text(result['message']));
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.statusCode == 401 || error.statusCode == 403) {
        _lock(error.message);
      } else {
        setState(() => _error = error.message);
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not update system settings.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _applySettings(Map<String, dynamic> settings) {
    final currency = _text(settings['pricingCurrency']).toUpperCase();
    _pricingCurrency = {'USD', 'EUR', 'GBP', 'ILS', 'AED'}.contains(currency) ? currency : 'USD';
    for (final entry in _controllers.entries) {
      entry.value.text = _formatEditable(settings[entry.key]);
    }
  }

  void _discard() {
    setState(() => _applySettings(_settings));
  }

  void _lock([String message = '']) {
    setState(() {
      _accessToken = '';
      _settings = const {};
      _expiresAt = null;
      _error = message;
    });
  }

  bool get _hasChanges {
    if (_accessToken.isEmpty || _settings.isEmpty) return false;
    final originalCurrency = _text(_settings['pricingCurrency']).toUpperCase().isEmpty ? 'USD' : _text(_settings['pricingCurrency']).toUpperCase();
    if (originalCurrency != _pricingCurrency) return true;

    for (final entry in _controllers.entries) {
      final original = num.tryParse(_formatEditable(_settings[entry.key]));
      final current = num.tryParse(entry.value.text.trim());
      if (original == null && current == null) continue;
      if (original == null || current == null || (original - current).abs() > .000001) return true;
    }
    return false;
  }

  int get _changedCount {
    if (_settings.isEmpty) return 0;
    var count = 0;
    final originalCurrency = _text(_settings['pricingCurrency']).toUpperCase().isEmpty ? 'USD' : _text(_settings['pricingCurrency']).toUpperCase();
    if (originalCurrency != _pricingCurrency) count += 1;
    for (final entry in _controllers.entries) {
      final original = num.tryParse(_formatEditable(_settings[entry.key]));
      final current = num.tryParse(entry.value.text.trim());
      if (original == null && current == null) continue;
      if (original == null || current == null || (original - current).abs() > .000001) count += 1;
    }
    return count;
  }

  String? _validate() {
    for (final key in _controllers.keys) {
      final value = num.tryParse(_controllers[key]!.text.trim());
      if (value == null) return '${_fieldMeta[key]!.label}: enter a valid number.';
      final min = _fieldMeta[key]!.minimum;
      if (value < min) return '${_fieldMeta[key]!.label}: minimum allowed value is ${_formatEditable(min)}.';
      if (_integerFields.contains(key) && value % 1 != 0) return '${_fieldMeta[key]!.label}: use a whole number.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: _accessToken.isEmpty ? _buildLocked() : _buildUnlocked(),
        ),
      ),
    );
  }

  Widget _buildLocked() {
    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
          sliver: SliverToBoxAdapter(
            child: AdminPageHeader(
              title: 'System settings',
              subtitle: 'Protected platform pricing and credit configuration.',
              eyebrow: 'Security & system',
              icon: Icons.tune_rounded,
              accentColor: AppColors.primary,
              onBack: () => Navigator.of(context).pop(),
            ),
          ),
        ),
        SliverFillRemaining(
          hasScrollBody: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 22),
            child: Column(
              children: [
                const Spacer(flex: 1),
                _SystemSettingsSensitiveGate(
                  password: _passwordController,
                  showPassword: _showPassword,
                  busy: _verifying,
                  error: _error,
                  onToggleVisibility: () {
                    setState(() {
                      _showPassword = !_showPassword;
                    });
                  },
                  onSubmit: _unlock,
                ),
                const Spacer(flex: 2),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildUnlocked() {
    final updatedBy = _map(_settings['updatedBy']);
    final updatedName = _text(updatedBy['fullName']);
    final updatedEmail = _text(updatedBy['email']);
    final expiresText = _expiresAt == null ? 'Protected session active' : 'Unlocked until ${DateFormat('HH:mm').format(_expiresAt!)}';

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 34),
        children: [
          AdminPageHeader(
            title: 'System settings',
            subtitle: 'Protected commercial rules used by credits, Premium and publication access.',
            eyebrow: 'Security & system',
            icon: Icons.tune_rounded,
            accentColor: AppColors.primary,
            onBack: () => Navigator.of(context).pop(),
            trailing: _HeaderActions(
              refreshing: _refreshing,
              onRefresh: _refresh,
              onLock: () => _lock(),
            ),
          ),
          const SizedBox(height: 13),
          _AccessStrip(expiresText: expiresText, changedCount: _changedCount),
          if (_error.isNotEmpty) ...[
            const SizedBox(height: 10),
            _ErrorBanner(message: _error),
          ],
          const SizedBox(height: 12),
          AdminGlassCard(
            tint: const Color(0xFFF0F8F6),
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _GroupHeading(icon: Icons.currency_exchange_rounded, eyebrow: 'BASE PRICING', title: 'Pricing currency', description: 'Direct prices entered below use this administrator-selected base currency.'),
                const SizedBox(height: 12),
                AdminSelectionField(
                  label: 'Base currency',
                  value: _pricingCurrency,
                  options: _currencyOptions,
                  icon: Icons.currency_exchange_rounded,
                  onChanged: (value) => setState(() => _pricingCurrency = value),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _SettingsGroup(
            icon: Icons.toll_outlined,
            eyebrow: 'CREDIT ECONOMICS',
            title: 'Credits & generation',
            description: 'Core credit price and Premium idea-generation cost.',
            fields: const ['creditPrice', 'premiumIdeaCreditCost'],
            controllers: _controllers,
            currency: _pricingCurrency,
            onChanged: () => setState(() {}),
          ),
          const SizedBox(height: 12),
          _SettingsGroup(
            icon: Icons.workspace_premium_outlined,
            eyebrow: 'PREMIUM ACCESS',
            title: 'Upgrade & direct unlock',
            description: 'Pricing used when an account upgrades or unlocks advanced idea outputs.',
            fields: const ['premiumActivationFee', 'directUnlockPrice'],
            controllers: _controllers,
            currency: _pricingCurrency,
            onChanged: () => setState(() {}),
          ),
          const SizedBox(height: 12),
          _SettingsGroup(
            icon: Icons.payments_outlined,
            eyebrow: 'PUBLICATION ACCESS',
            title: 'Acceptance & advanced outputs',
            description: 'Commercial rules for publication acceptance and advanced outputs.',
            fields: const ['normalAcceptancePrice', 'normalPublicationAdvancedPrice', 'publicationAdvancedCreditCost'],
            controllers: _controllers,
            currency: _pricingCurrency,
            onChanged: () => setState(() {}),
          ),
          const SizedBox(height: 12),
          _SettingsGroup(
            icon: Icons.card_giftcard_rounded,
            eyebrow: 'PURCHASE INCENTIVES',
            title: 'Bonus policy',
            description: 'Optional bonus credits applied to qualifying credit purchases.',
            fields: const ['bonusThreshold', 'bonusCredits'],
            controllers: _controllers,
            currency: _pricingCurrency,
            onChanged: () => setState(() {}),
          ),
          const SizedBox(height: 12),
          AdminGlassCard(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AdminIconBadge(icon: Icons.history_rounded, size: 38, tone: AppColors.primarySoft, iconColor: AppColors.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Last configuration update', style: TextStyle(color: AppColors.textPrimary, fontSize: 11.3, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 3),
                      Text(
                        updatedName.isEmpty && updatedEmail.isEmpty ? 'No administrator metadata stored.' : [updatedName, updatedEmail].where((item) => item.isNotEmpty).join(' · '),
                        style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, height: 1.35),
                      ),
                      const SizedBox(height: 3),
                      Text(_formatDate(_settings['updatedAt']), style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: OutlinedButton.icon(onPressed: _hasChanges && !_saving ? _discard : null, icon: const Icon(Icons.undo_rounded, size: 17), label: const Text('Discard changes'))),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _hasChanges && !_saving ? _save : null,
                  icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.save_outlined, size: 17),
                  label: Text(_saving ? 'Saving...' : 'Save settings'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _snack(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? AppColors.danger : AppColors.primary));
  }
}

class _SystemSettingsSensitiveGate extends StatelessWidget {
  const _SystemSettingsSensitiveGate({
    required this.password,
    required this.showPassword,
    required this.busy,
    required this.error,
    required this.onToggleVisibility,
    required this.onSubmit,
  });

  final TextEditingController password;
  final bool showPassword;
  final bool busy;
  final String error;
  final VoidCallback onToggleVisibility;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AdminGlassCard(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 19),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _SystemSettingsLockMark(),
                  const SizedBox(height: 15),
                  Text(
                    'Confirm your identity',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontSize: 20,
                      height: 1.1,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -.35,
                    ),
                  ),
                  const SizedBox(height: 7),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Text(
                      'Enter your administrator password to unlock this protected page.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10.7,
                        height: 1.45,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(height: 19),
                  TextField(
                    controller: password,
                    obscureText: !showPassword,
                    enabled: !busy,
                    autocorrect: false,
                    enableSuggestions: false,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => onSubmit(),
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                    decoration: InputDecoration(
                      labelText: 'Administrator password',
                      floatingLabelBehavior: FloatingLabelBehavior.auto,
                      labelStyle: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                      floatingLabelStyle: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                      prefixIcon: const Icon(
                        Icons.key_rounded,
                        size: 20,
                        color: AppColors.primaryDark,
                      ),
                      suffixIcon: IconButton(
                        tooltip: showPassword ? 'Hide password' : 'Show password',
                        onPressed: busy ? null : onToggleVisibility,
                        icon: Icon(
                          showPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          size: 20,
                          color: AppColors.primaryDark,
                        ),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 15,
                      ),
                      filled: true,
                      fillColor: AppColors.surface.withValues(alpha: .97),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(17),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(17),
                        borderSide: BorderSide(
                          color: AppColors.primary.withValues(alpha: .62),
                          width: 1.2,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(17),
                        borderSide: const BorderSide(
                          color: AppColors.primary,
                          width: 1.6,
                        ),
                      ),
                      disabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(17),
                        borderSide: BorderSide(
                          color: AppColors.border.withValues(alpha: .9),
                        ),
                      ),
                    ),
                  ),
                  if (error.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 11,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.pinkSoft,
                        borderRadius: BorderRadius.circular(13),
                        border: Border.all(
                          color: AppColors.pink.withValues(alpha: .2),
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 1),
                            child: Icon(
                              Icons.error_outline_rounded,
                              size: 15,
                              color: AppColors.danger,
                            ),
                          ),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(
                              error,
                              style: const TextStyle(
                                color: AppColors.danger,
                                fontSize: 9.8,
                                height: 1.35,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: FilledButton.icon(
                      onPressed: busy ? null : onSubmit,
                      style: FilledButton.styleFrom(
                        elevation: 0,
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor: AppColors.primary.withValues(
                          alpha: .52,
                        ),
                        disabledForegroundColor: Colors.white.withValues(
                          alpha: .9,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(17),
                        ),
                      ),
                      icon: busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.shield_outlined, size: 18),
                      label: Text(
                        busy ? 'Verifying…' : 'Unlock settings',
                        style: const TextStyle(
                          fontSize: 12.3,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 11),
            const _SystemSettingsSecurityNote(),
          ],
        ),
      ),
    );
  }
}

class _SystemSettingsLockMark extends StatelessWidget {
  const _SystemSettingsLockMark();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 94,
      height: 68,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(
              color: AppColors.pinkSoft,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.pink.withValues(alpha: .18)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.pink.withValues(alpha: .07),
                  blurRadius: 16,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: const Icon(
              Icons.lock_outline_rounded,
              color: AppColors.pinkDeep,
              size: 28,
            ),
          ),
          const Positioned(
            left: 3,
            top: 25,
            child: Icon(
              Icons.auto_awesome_rounded,
              color: AppColors.primary,
              size: 9,
            ),
          ),
          const Positioned(
            right: 3,
            top: 17,
            child: Icon(
              Icons.auto_awesome_rounded,
              color: AppColors.pink,
              size: 10,
            ),
          ),
          Positioned(
            left: 14,
            bottom: 7,
            child: Container(
              width: 4,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: .65),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            right: 15,
            bottom: 10,
            child: Container(
              width: 4,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.pink.withValues(alpha: .72),
                shape: BoxShape.circle,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SystemSettingsSecurityNote extends StatelessWidget {
  const _SystemSettingsSecurityNote();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: .42),
          borderRadius: BorderRadius.circular(999),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_outlined, size: 13, color: AppColors.primary),
            SizedBox(width: 6),
            Flexible(
              child: Text(
                'Protected verification · scoped to this page only',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FieldMeta {
  const _FieldMeta({required this.label, required this.hint, required this.minimum, this.money = false, this.integer = false});

  final String label;
  final String hint;
  final double minimum;
  final bool money;
  final bool integer;
}

const _fieldMeta = <String, _FieldMeta>{
  'creditPrice': _FieldMeta(label: 'Credit price', hint: 'Price charged for one credit.', minimum: .01, money: true),
  'premiumIdeaCreditCost': _FieldMeta(label: 'Premium idea cost', hint: 'Credits required to generate one Premium idea.', minimum: 1, integer: true),
  'directUnlockPrice': _FieldMeta(label: 'Direct idea unlock', hint: 'Direct payment to unlock advanced outputs for a free idea.', minimum: .01, money: true),
  'premiumActivationFee': _FieldMeta(label: 'Premium activation fee', hint: 'One-time fee when a NORMAL account becomes Premium.', minimum: 0, money: true),
  'normalAcceptancePrice': _FieldMeta(label: 'Normal acceptance price', hint: 'Fixed price for a NORMAL user to accept a publication.', minimum: .01, money: true),
  'normalPublicationAdvancedPrice': _FieldMeta(label: 'Normal publication advanced', hint: 'Direct payment for advanced publication outputs.', minimum: .01, money: true),
  'publicationAdvancedCreditCost': _FieldMeta(label: 'Premium publication advanced', hint: 'Credits a Premium user spends for advanced publication outputs.', minimum: 1, integer: true),
  'bonusThreshold': _FieldMeta(label: 'Bonus threshold', hint: 'Minimum purchased credits required before bonus credits apply.', minimum: 0, integer: true),
  'bonusCredits': _FieldMeta(label: 'Bonus credits', hint: 'Additional credits awarded after the threshold is reached.', minimum: 0, integer: true),
};

const _integerFields = <String>{'premiumIdeaCreditCost', 'publicationAdvancedCreditCost', 'bonusThreshold', 'bonusCredits'};

class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({required this.icon, required this.eyebrow, required this.title, required this.description, required this.fields, required this.controllers, required this.currency, required this.onChanged});

  final IconData icon;
  final String eyebrow;
  final String title;
  final String description;
  final List<String> fields;
  final Map<String, TextEditingController> controllers;
  final String currency;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _GroupHeading(icon: icon, eyebrow: eyebrow, title: title, description: description),
          const SizedBox(height: 13),
          ...fields.indexed.map((entry) {
            final index = entry.$1;
            final key = entry.$2;
            final meta = _fieldMeta[key]!;
            return Padding(
              padding: EdgeInsets.only(bottom: index == fields.length - 1 ? 0 : 11),
              child: _SettingField(fieldKey: key, meta: meta, controller: controllers[key]!, currency: currency, onChanged: onChanged),
            );
          }),
        ],
      ),
    );
  }
}

class _GroupHeading extends StatelessWidget {
  const _GroupHeading({required this.icon, required this.eyebrow, required this.title, required this.description});

  final IconData icon;
  final String eyebrow;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AdminIconBadge(icon: icon, size: 40, tone: AppColors.primarySoft, iconColor: AppColors.primary),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(eyebrow, style: const TextStyle(color: AppColors.primary, fontSize: 8.2, fontWeight: FontWeight.w900, letterSpacing: 1.05)),
              const SizedBox(height: 2),
              Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13.2, fontWeight: FontWeight.w900)),
              const SizedBox(height: 3),
              Text(description, style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2, height: 1.35)),
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingField extends StatelessWidget {
  const _SettingField({required this.fieldKey, required this.meta, required this.controller, required this.currency, required this.onChanged});

  final String fieldKey;
  final _FieldMeta meta;
  final TextEditingController controller;
  final String currency;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(meta.label, style: const TextStyle(color: AppColors.textPrimary, fontSize: 10.7, fontWeight: FontWeight.w900)),
        const SizedBox(height: 3),
        Text(meta.hint, style: const TextStyle(color: AppColors.textMuted, fontSize: 8.9, height: 1.35)),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          onChanged: (_) => onChanged(),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            prefixIcon: Icon(meta.money ? Icons.payments_outlined : Icons.numbers_rounded, size: 18),
            suffixText: meta.money ? currency : 'credits',
          ),
        ),
      ],
    );
  }
}

class _AccessStrip extends StatelessWidget {
  const _AccessStrip({required this.expiresText, required this.changedCount});

  final String expiresText;
  final int changedCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      decoration: BoxDecoration(color: const Color(0xFFEEF8F5), borderRadius: BorderRadius.circular(18), border: Border.all(color: AppColors.borderStrong)),
      child: Row(
        children: [
          const Icon(Icons.shield_outlined, size: 16, color: AppColors.primary),
          const SizedBox(width: 7),
          Expanded(child: Text(expiresText, style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.5, fontWeight: FontWeight.w800))),
          if (changedCount > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(999), border: Border.all(color: AppColors.border)),
              child: Text('$changedCount changed', style: const TextStyle(color: AppColors.primary, fontSize: 8.5, fontWeight: FontWeight.w900)),
            ),
        ],
      ),
    );
  }
}

class _HeaderActions extends StatelessWidget {
  const _HeaderActions({required this.refreshing, required this.onRefresh, required this.onLock});

  final bool refreshing;
  final VoidCallback onRefresh;
  final VoidCallback onLock;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _SquareButton(icon: Icons.lock_outline_rounded, onTap: onLock),
        const SizedBox(width: 7),
        _SquareButton(icon: Icons.refresh_rounded, onTap: refreshing ? null : onRefresh, busy: refreshing),
      ],
    );
  }
}

class _SquareButton extends StatelessWidget {
  const _SquareButton({required this.icon, this.onTap, this.busy = false});

  final IconData icon;
  final VoidCallback? onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.primarySoft,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(15), border: Border.all(color: AppColors.borderStrong)),
          child: busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary)) : Icon(icon, size: 19, color: AppColors.primary),
        ),
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
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(color: AppColors.pinkSoft, borderRadius: BorderRadius.circular(15), border: Border.all(color: AppColors.pinkLight.withValues(alpha: .72))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded, size: 16, color: AppColors.danger),
          const SizedBox(width: 7),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.5, height: 1.35, fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

String _formatEditable(dynamic value) {
  if (value == null) return '';
  final number = value is num ? value.toDouble() : double.tryParse(value.toString());
  if (number == null) return value.toString();
  if (number == number.roundToDouble()) return number.toInt().toString();
  return number.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
}

String _formatDate(dynamic value) {
  final raw = _text(value);
  if (raw.isEmpty) return 'No update time stored';
  final date = DateTime.tryParse(raw)?.toLocal();
  if (date == null) return raw;
  return DateFormat('MMM d, y · HH:mm').format(date);
}

String _text(dynamic value) => value?.toString().trim() ?? '';
Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
