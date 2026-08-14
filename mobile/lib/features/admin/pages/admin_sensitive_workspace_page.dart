import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import '../widgets/admin_ui.dart';

/// Displays a protected administrative workspace that requires
/// additional identity verification before sensitive information
/// can be accessed.
///
/// The page performs a secondary administrator password check before
/// requesting or displaying protected workspace data.
///
/// It supports:
/// - Password-based sensitive-access verification.
/// - Scoped temporary access tokens.
/// - Protected workspace retrieval.
/// - Refreshing unlocked workspace data.
/// - Administrator invitation management.
/// - Automatic workspace locking when authorization expires.
/// - Custom administrator mobile layout.
/// - Rendering scalar, map, and list-based protected data.
/// - Error and loading states.
///
/// @author Eman
class AdminSensitiveWorkspacePage extends StatefulWidget {
  const AdminSensitiveWorkspacePage({
    super.key,
    required this.scope,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.path,
  });

  /// Sensitive-access scope sent to the backend.
  final String scope;

  /// Main page title.
  final String title;

  /// Supporting page description.
  final String subtitle;

  /// Workspace icon.
  final IconData icon;

  /// Protected backend endpoint.
  final String path;

  @override
  State<AdminSensitiveWorkspacePage> createState() =>
      _AdminSensitiveWorkspacePageState();
}

/// Controls verification, protected workspace loading,
/// refreshing, and administrator invitations.
///
/// @author Eman
class _AdminSensitiveWorkspacePageState
    extends State<AdminSensitiveWorkspacePage> {
  final _api = AdminApi.instance;

  /// Administrator password controller.
  final _password = TextEditingController();

  /// Temporary sensitive-access token.
  String _accessToken = '';

  /// Protected workspace data.
  Map<String, dynamic>? _data;

  /// Password visibility state.
  bool _showPassword = false;

  /// Request loading state.
  bool _busy = false;

  /// Current error message.
  String _error = '';

  /// Administrator-selected base currency for commercial prices.
  String _pricingCurrencyDraft = 'USD';

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  /// Verifies the administrator password and unlocks
  /// the protected workspace.
  Future<void> _unlock() async {
    if (_busy || _password.text.trim().isEmpty) {
      return;
    }

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      final verified = await _api.verifySensitiveAccess(
        widget.scope,
        _password.text,
      );

      final token = verified['accessToken']?.toString().trim() ?? '';

      if (token.isEmpty) {
        throw const ApiException('Sensitive access could not be verified.');
      }

      final embeddedKey = widget.scope == 'ADMINISTRATORS'
          ? 'workspace'
          : 'settings';

      final embedded = verified[embeddedKey];

      final data = embedded is Map
          ? Map<String, dynamic>.from(embedded)
          : await _api.getSensitiveWorkspace(widget.path, token, force: true);

      if (!mounted) {
        return;
      }

      setState(() {
        _accessToken = token;
        _data = data;
        _pricingCurrencyDraft = _pricingCurrencyFrom(data);
        _password.clear();
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = 'Could not verify sensitive access.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  /// Refreshes the unlocked sensitive workspace.
  ///
  /// If access expires, the page returns automatically
  /// to the identity confirmation state.
  Future<void> _refresh() async {
    if (_accessToken.isEmpty || _busy) {
      return;
    }

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      final data = await _api.getSensitiveWorkspace(
        widget.path,
        _accessToken,
        force: true,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _data = data;
        _pricingCurrencyDraft = _pricingCurrencyFrom(data);
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = error.message;

        if (error.statusCode == 401 || error.statusCode == 403) {
          _accessToken = '';
          _data = null;
        }
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = 'Could not refresh this workspace.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  String _pricingCurrencyFrom(Map<String, dynamic> data) {
    final nested = data['settings'];
    final source = nested is Map ? Map<String, dynamic>.from(nested) : data;
    final value = source['pricingCurrency']?.toString().trim().toUpperCase() ?? '';
    const supported = {'USD', 'EUR', 'GBP', 'ILS', 'AED'};
    return supported.contains(value) ? value : 'USD';
  }

  Future<void> _savePricingCurrency() async {
    if (_busy || _accessToken.isEmpty || widget.scope != 'SYSTEM_SETTINGS') {
      return;
    }

    final current = _data == null ? 'USD' : _pricingCurrencyFrom(_data!);
    if (current == _pricingCurrencyDraft) return;

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      final result = await _api.patchSensitive(
        widget.path,
        {'pricingCurrency': _pricingCurrencyDraft},
        _accessToken,
      );

      final rawSettings = result['settings'];
      final settings = rawSettings is Map
          ? Map<String, dynamic>.from(rawSettings)
          : await _api.getSensitiveWorkspace(
              widget.path,
              _accessToken,
              force: true,
            );

      if (!mounted) return;

      setState(() {
        _data = settings;
        _pricingCurrencyDraft = _pricingCurrencyFrom(settings);
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Text(
            'Base pricing currency updated to $_pricingCurrencyDraft.',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        if (error.statusCode == 401 || error.statusCode == 403) {
          _accessToken = '';
          _data = null;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not update the base pricing currency.';
      });
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  /// Opens the administrator invitation bottom sheet.
  ///
  /// The action is available only in the protected
  /// administrators workspace.
  Future<void> _openAdministratorInvite() async {
    if (_accessToken.isEmpty || _busy || widget.scope != 'ADMINISTRATORS') {
      return;
    }

    final result = await showModalBottomSheet<_AdministratorInviteResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.textPrimary.withValues(alpha: .22),
      builder: (context) {
        return _AdministratorInviteSheet(accessToken: _accessToken);
      },
    );

    if (!mounted || result == null) {
      return;
    }

    /// The sensitive verification expired while the
    /// administrator invitation was being submitted.
    if (result == _AdministratorInviteResult.accessExpired) {
      setState(() {
        _accessToken = '';
        _data = null;
        _error = 'Sensitive access expired. Confirm your identity to continue.';
      });

      return;
    }

    /// Reload administrators and invitations immediately.
    await _refresh();

    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(18, 0, 18, 18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        content: const Row(
          children: [
            Icon(
              Icons.check_circle_outline_rounded,
              color: Colors.white,
              size: 19,
            ),
            SizedBox(width: 9),
            Expanded(
              child: Text(
                'Administrator invitation sent successfully.',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Builds the protected administrative workspace.
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: AdminWorkspaceBackground(
        child: SafeArea(
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              /// Page header.
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                sliver: SliverToBoxAdapter(
                  child: AdminPageHeader(
                    title: widget.title,
                    subtitle: widget.subtitle,
                    eyebrow: 'Protected admin workspace',
                    icon: widget.icon,
                    onBack: () {
                      Navigator.maybePop(context);
                    },
                    trailing: _accessToken.isEmpty
                        ? null
                        : IconButton.filledTonal(
                            onPressed: _busy ? null : _refresh,
                            icon: const Icon(Icons.refresh_rounded, size: 19),
                          ),
                  ),
                ),
              ),

              /// Locked workspace.
              if (_accessToken.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 22),
                    child: Column(
                      children: [
                        const Spacer(flex: 1),
                        _SensitiveGate(
                          password: _password,
                          showPassword: _showPassword,
                          busy: _busy,
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
                )
              /// Unlocked workspace.
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 16, 14, 80),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      /// Compact unlocked state.
                      const _UnlockedWorkspaceBanner(),

                      if (_error.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        _WorkspaceErrorMessage(message: _error),
                      ],

                      const SizedBox(height: 14),

                      if (_busy && _data == null)
                        const AdminLoadingList(count: 4)
                      /// Administrators receive a dedicated,
                      /// more compact mobile layout.
                      else if (widget.scope == 'ADMINISTRATORS')
                        _AdministratorsWorkspaceContent(
                          data: _data ?? const {},
                          busy: _busy,
                          onInvite: _openAdministratorInvite,
                        )
                      else if (widget.scope == 'SYSTEM_SETTINGS')
                        _SystemSettingsWorkspaceContent(
                          data: _data ?? const {},
                          pricingCurrency: _pricingCurrencyDraft,
                          busy: _busy,
                          onCurrencyChanged: (value) {
                            setState(() => _pricingCurrencyDraft = value);
                          },
                          onSaveCurrency: _savePricingCurrency,
                        )
                      /// Other protected workspaces continue
                      /// using the generic card renderer.
                      else
                        ..._WorkspaceDataCards(
                          data: _data ?? const {},
                        ).buildCards(context),
                    ]),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SystemSettingsWorkspaceContent extends StatelessWidget {
  const _SystemSettingsWorkspaceContent({
    required this.data,
    required this.pricingCurrency,
    required this.busy,
    required this.onCurrencyChanged,
    required this.onSaveCurrency,
  });

  final Map<String, dynamic> data;
  final String pricingCurrency;
  final bool busy;
  final ValueChanged<String> onCurrencyChanged;
  final VoidCallback onSaveCurrency;

  static const _currencies = <String, String>{
    'USD': 'US Dollar',
    'EUR': 'Euro',
    'GBP': 'British Pound',
    'ILS': 'Israeli New Shekel',
    'AED': 'UAE Dirham',
  };

  Map<String, dynamic> get _settings {
    final nested = data['settings'];
    return nested is Map ? Map<String, dynamic>.from(nested) : data;
  }

  String _number(String key) {
    final value = _settings[key];
    final parsed = value is num ? value.toDouble() : double.tryParse('$value');
    return parsed == null ? '—' : parsed.toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    final savedCurrency =
        _settings['pricingCurrency']?.toString().trim().toUpperCase() ?? 'USD';
    final dirty = savedCurrency != pricingCurrency;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AdminGlassCard(
          padding: const EdgeInsets.all(15),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Base pricing currency',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'All direct prices configured by the administrator are entered in this currency. Users can still choose another supported currency at checkout.',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.4,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 13),
              DropdownButtonFormField<String>(
                initialValue: pricingCurrency,
                decoration: InputDecoration(
                  labelText: 'Pricing currency',
                  prefixIcon: const Icon(Icons.currency_exchange_rounded),
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                items: _currencies.entries
                    .map(
                      (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text('${entry.key} · ${entry.value}'),
                      ),
                    )
                    .toList(),
                onChanged: busy
                    ? null
                    : (value) {
                        if (value != null) onCurrencyChanged(value);
                      },
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: busy || !dirty ? null : onSaveCurrency,
                  icon: busy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_outlined, size: 17),
                  label: const Text('Save pricing currency'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        AdminGlassCard(
          padding: const EdgeInsets.all(15),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Configured direct prices',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              _PricingSettingRow(
                label: 'Credit price',
                value: '${_number('creditPrice')} $savedCurrency',
              ),
              _PricingSettingRow(
                label: 'Premium activation fee',
                value: '${_number('premiumActivationFee')} $savedCurrency',
              ),
              _PricingSettingRow(
                label: 'Direct idea unlock',
                value: '${_number('directUnlockPrice')} $savedCurrency',
              ),
              _PricingSettingRow(
                label: 'Normal acceptance',
                value: '${_number('normalAcceptancePrice')} $savedCurrency',
              ),
              _PricingSettingRow(
                label: 'Publication advanced',
                value: '${_number('normalPublicationAdvancedPrice')} $savedCurrency',
                divider: false,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PricingSettingRow extends StatelessWidget {
  const _PricingSettingRow({
    required this.label,
    required this.value,
    this.divider = true,
  });

  final String label;
  final String value;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                value,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 11.2,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
        if (divider) const Divider(height: 1, color: AppColors.border),
      ],
    );
  }
}

/// Result returned by the administrator invitation sheet.
///
/// @author Eman
enum _AdministratorInviteResult { success, accessExpired }

/// Compact notification that the protected workspace
/// has been successfully unlocked.
///
/// @author Eman
class _UnlockedWorkspaceBanner extends StatelessWidget {
  const _UnlockedWorkspaceBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(13, 11, 13, 11),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .52),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primary.withValues(alpha: .15)),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .86),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.lock_open_rounded,
              color: AppColors.primaryDark,
              size: 18,
            ),
          ),

          const SizedBox(width: 10),

          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Sensitive workspace unlocked',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Verified for this page only',
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.8,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),

          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: .10),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.verified_rounded,
              color: AppColors.primaryDark,
              size: 15,
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays an unlocked-workspace error.
///
/// @author Eman
class _WorkspaceErrorMessage extends StatelessWidget {
  const _WorkspaceErrorMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.pink.withValues(alpha: .15)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: AppColors.danger,
            size: 16,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
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
    );
  }
}

/// Custom mobile presentation for the administrators
/// sensitive workspace.
///
/// Instead of showing every response section as a large
/// independent card, the administrators screen combines:
/// - Compact administrator metrics.
/// - Administrator management.
/// - Invitation action.
/// - Pending invitations.
///
/// This keeps the page shorter and more natural on phones.
///
/// @author Eman
class _AdministratorsWorkspaceContent extends StatelessWidget {
  const _AdministratorsWorkspaceContent({
    required this.data,
    required this.busy,
    required this.onInvite,
  });

  final Map<String, dynamic> data;

  final bool busy;

  final VoidCallback onInvite;

  /// Reads a top-level workspace property in a
  /// case-insensitive manner.
  dynamic _readValue(String wantedKey) {
    Map<String, dynamic> source = data;

    if (data['data'] is Map) {
      source = Map<String, dynamic>.from(data['data'] as Map);
    }

    for (final entry in source.entries) {
      if (entry.key.toLowerCase() == wantedKey.toLowerCase()) {
        return entry.value;
      }
    }

    return null;
  }

  /// Converts a workspace property into a list of maps.
  List<Map<String, dynamic>> _list(String key) {
    final value = _readValue(key);

    if (value is! List) {
      return const [];
    }

    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  /// Reads a count from the summary object.
  int _readSummaryCount(String key, int fallback) {
    final rawSummary = _readValue('summary');

    if (rawSummary is Map) {
      final summary = Map<String, dynamic>.from(rawSummary);

      for (final entry in summary.entries) {
        if (entry.key.toLowerCase() == key.toLowerCase()) {
          return _toInt(entry.value, fallback);
        }
      }
    }

    return fallback;
  }

  /// Converts an arbitrary value to an integer.
  int _toInt(dynamic value, int fallback) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? fallback;
  }

  @override
  Widget build(BuildContext context) {
    final administrators = _list('administrators');

    final invitations = _list('invitations');

    final activeCount = _readSummaryCount(
      'activeAdministrators',
      administrators.length,
    );

    final pendingCount = _readSummaryCount(
      'pendingInvitations',
      invitations.length,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        /// Compact statistics.
        Row(
          children: [
            Expanded(
              child: _AdminMiniStat(
                icon: Icons.groups_2_outlined,
                label: 'Active admins',
                value: '$activeCount',
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: _AdminMiniStat(
                icon: Icons.mail_outline_rounded,
                label: 'Pending invites',
                value: '$pendingCount',
              ),
            ),
          ],
        ),

        const SizedBox(height: 12),

        /// Main administration card.
        AdminGlassCard(
          padding: const EdgeInsets.fromLTRB(14, 15, 14, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              /// Section header and invite action.
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Administrators',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 15.5,
                            height: 1.05,
                            letterSpacing: -.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Manage protected admin access',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.8,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(width: 10),

                  SizedBox(
                    height: 38,
                    child: FilledButton.icon(
                      onPressed: busy ? null : onInvite,
                      style: FilledButton.styleFrom(
                        elevation: 0,
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        disabledBackgroundColor: AppColors.primary.withValues(
                          alpha: .45,
                        ),
                        disabledForegroundColor: Colors.white.withValues(
                          alpha: .9,
                        ),
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(13),
                        ),
                      ),
                      icon: const Icon(
                        Icons.person_add_alt_1_rounded,
                        size: 15,
                      ),
                      label: const Text(
                        'Invite',
                        style: TextStyle(
                          fontSize: 9.8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 14),

              /// Administrator records.
              if (administrators.isEmpty)
                const _AdminEmptyMiniState(
                  icon: Icons.group_outlined,
                  title: 'No administrators',
                  message: 'No administrator accounts were found.',
                )
              else
                ...administrators.map(
                  (administrator) =>
                      _AdministratorRow(administrator: administrator),
                ),

              /// Soft divider between administrators
              /// and pending invitations.
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Divider(
                  height: 1,
                  thickness: 1,
                  color: AppColors.border.withValues(alpha: .72),
                ),
              ),

              const SizedBox(height: 8),

              /// Invitations title.
              Row(
                children: [
                  Container(
                    width: 31,
                    height: 31,
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft.withValues(alpha: .64),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(
                      Icons.forward_to_inbox_outlined,
                      color: AppColors.primaryDark,
                      size: 15,
                    ),
                  ),

                  const SizedBox(width: 9),

                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Invitations',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 11.7,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 1),
                        Text(
                          'Pending administrator access',
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.3,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),

                  Container(
                    constraints: const BoxConstraints(minWidth: 27),
                    height: 27,
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 7),
                    decoration: BoxDecoration(
                      color: AppColors.primarySoft,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$pendingCount',
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 9.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 10),

              if (invitations.isEmpty)
                const _AdminEmptyMiniState(
                  icon: Icons.mark_email_read_outlined,
                  title: 'No pending invitations',
                  message: 'New invitations will appear here.',
                )
              else
                ...invitations.map(
                  (invitation) => _InvitationRow(invitation: invitation),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Compact administrator statistic.
///
/// @author Eman
class _AdminMiniStat extends StatelessWidget {
  const _AdminMiniStat({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;

  final String label;

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .88),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border.withValues(alpha: .95)),
        boxShadow: [
          BoxShadow(
            color: AppColors.textPrimary.withValues(alpha: .018),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 37,
            height: 37,
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .78),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 17, color: AppColors.primaryDark),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 17,
                    height: 1,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.3,
                    fontWeight: FontWeight.w700,
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

/// Displays an active administrator.
///
/// @author Eman
class _AdministratorRow extends StatelessWidget {
  const _AdministratorRow({required this.administrator});

  final Map<String, dynamic> administrator;

  String get _name =>
      (administrator['fullName'] ??
              administrator['name'] ??
              administrator['email'] ??
              'Administrator')
          .toString();

  String get _email => administrator['email']?.toString() ?? '';

  /// Generates short initials for the administrator avatar.
  String get _initials {
    final parts = _name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();

    if (parts.isEmpty) {
      return 'A';
    }

    if (parts.length == 1) {
      final word = parts.first;

      if (word.length == 1) {
        return word.toUpperCase();
      }

      return word.substring(0, 2).toUpperCase();
    }

    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 39,
            height: 39,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(13),
            ),
            child: Text(
              _initials,
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: .15,
              ),
            ),
          ),

          const SizedBox(width: 10),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.7,
                    height: 1.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),

                if (_email.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    _email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.7,
                      height: 1.2,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(width: 8),

          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .65),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              'Admin',
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7.7,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays a pending administrator invitation.
///
/// @author Eman
class _InvitationRow extends StatelessWidget {
  const _InvitationRow({required this.invitation});

  final Map<String, dynamic> invitation;

  @override
  Widget build(BuildContext context) {
    final name =
        (invitation['fullName'] ??
                invitation['name'] ??
                'Pending administrator')
            .toString();

    final email = invitation['email']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 7),
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .34),
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Container(
            width: 35,
            height: 35,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .85),
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(
              Icons.mail_outline_rounded,
              size: 16,
              color: AppColors.primaryDark,
            ),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),

                if (email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.5,
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(width: 7),

          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .7),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              'Pending',
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7.5,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Small inline empty state used inside the custom
/// administrators card.
///
/// @author Eman
class _AdminEmptyMiniState extends StatelessWidget {
  const _AdminEmptyMiniState({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;

  final String title;

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .42),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .7),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, size: 16, color: AppColors.textMuted),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 9.3,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.2,
                    fontWeight: FontWeight.w500,
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

/// Mobile form used to invite a new administrator.
///
/// The invitation uses the temporary sensitive-access token
/// associated with the unlocked administrators workspace.
///
/// @author Eman
class _AdministratorInviteSheet extends StatefulWidget {
  const _AdministratorInviteSheet({required this.accessToken});

  /// Current sensitive-access token.
  final String accessToken;

  @override
  State<_AdministratorInviteSheet> createState() =>
      _AdministratorInviteSheetState();
}

/// Controls administrator invitation validation
/// and request submission.
///
/// @author Eman
class _AdministratorInviteSheetState extends State<_AdministratorInviteSheet> {
  final _formKey = GlobalKey<FormState>();

  /// New administrator full name.
  final _fullName = TextEditingController();

  /// New administrator email address.
  final _email = TextEditingController();

  /// Invitation request loading state.
  bool _busy = false;

  /// Current invitation request error.
  String _error = '';

  @override
  void dispose() {
    _fullName.dispose();
    _email.dispose();
    super.dispose();
  }

  /// Validates the administrator full name.
  String? _validateName(String? value) {
    final text = value?.trim() ?? '';

    if (text.isEmpty) {
      return 'Enter the administrator name.';
    }

    if (text.length < 2) {
      return 'Name must contain at least 2 characters.';
    }

    return null;
  }

  /// Validates the administrator email address.
  String? _validateEmail(String? value) {
    final text = value?.trim().toLowerCase() ?? '';

    if (text.isEmpty) {
      return 'Enter the administrator email.';
    }

    final valid = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(text);

    if (!valid) {
      return 'Enter a valid email address.';
    }

    return null;
  }

  /// Sends the administrator invitation.
  Future<void> _submit() async {
    if (_busy) {
      return;
    }

    final valid = _formKey.currentState?.validate() ?? false;

    if (!valid) {
      return;
    }

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      await AdminApi.instance.inviteAdministrator(
        fullName: _fullName.text.trim(),
        email: _email.text.trim(),
        accessToken: widget.accessToken,
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop(_AdministratorInviteResult.success);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      if (error.statusCode == 401 || error.statusCode == 403) {
        Navigator.of(context).pop(_AdministratorInviteResult.accessExpired);
        return;
      }

      setState(() {
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = 'Could not send the administrator invitation.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return AnimatedPadding(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Align(
        alignment: Alignment.bottomCenter,
        child: Material(
          color: Colors.transparent,
          child: Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxWidth: 560),
            margin: const EdgeInsets.fromLTRB(10, 20, 10, 10),
            padding: const EdgeInsets.fromLTRB(17, 10, 17, 17),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(26),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: AppColors.textPrimary.withValues(alpha: .10),
                  blurRadius: 28,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SingleChildScrollView(
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    /// Drag indicator.
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: AppColors.textMuted.withValues(alpha: .25),
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),

                    const SizedBox(height: 15),

                    /// Invitation header.
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 45,
                          height: 45,
                          decoration: BoxDecoration(
                            color: AppColors.primarySoft,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.person_add_alt_1_rounded,
                            color: AppColors.primaryDark,
                            size: 21,
                          ),
                        ),

                        const SizedBox(width: 11),

                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Invite administrator',
                                style: TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 16,
                                  height: 1.15,
                                  letterSpacing: -.2,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Add a new administrator using a secure email invitation.',
                                style: TextStyle(
                                  color: AppColors.textMuted,
                                  fontSize: 9.6,
                                  height: 1.4,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),

                        IconButton(
                          tooltip: 'Close',
                          onPressed: _busy
                              ? null
                              : () {
                                  Navigator.of(context).pop();
                                },
                          icon: const Icon(
                            Icons.close_rounded,
                            color: AppColors.textSecondary,
                            size: 20,
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 18),

                    /// Full name.
                    TextFormField(
                      controller: _fullName,
                      enabled: !_busy,
                      validator: _validateName,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                      decoration: _inviteInputDecoration(
                        label: 'Full name',
                        hint: 'Administrator name',
                        icon: Icons.person_outline_rounded,
                      ),
                    ),

                    const SizedBox(height: 12),

                    /// Email address.
                    TextFormField(
                      controller: _email,
                      enabled: !_busy,
                      validator: _validateEmail,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.done,
                      autocorrect: false,
                      enableSuggestions: false,
                      onFieldSubmitted: (_) {
                        _submit();
                      },
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                      decoration: _inviteInputDecoration(
                        label: 'Email address',
                        hint: 'admin@example.com',
                        icon: Icons.mail_outline_rounded,
                      ),
                    ),

                    const SizedBox(height: 13),

                    /// Security information.
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft.withValues(alpha: .54),
                        borderRadius: BorderRadius.circular(15),
                        border: Border.all(
                          color: AppColors.primary.withValues(alpha: .11),
                        ),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.shield_outlined,
                            color: AppColors.primaryDark,
                            size: 17,
                          ),

                          SizedBox(width: 9),

                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Protected invitation',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Only a verified administrator can create this invitation.',
                                  style: TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 8.8,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    if (_error.isNotEmpty) ...[
                      const SizedBox(height: 11),
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
                            color: AppColors.pink.withValues(alpha: .18),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.error_outline_rounded,
                              color: AppColors.danger,
                              size: 16,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _error,
                                style: const TextStyle(
                                  color: AppColors.danger,
                                  fontSize: 9.6,
                                  height: 1.35,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 16),

                    /// Bottom actions.
                    Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: 47,
                            child: OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () {
                                      Navigator.of(context).pop();
                                    },
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.textSecondary,
                                side: const BorderSide(color: AppColors.border),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(15),
                                ),
                              ),
                              child: const Text(
                                'Cancel',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ),
                        ),

                        const SizedBox(width: 9),

                        Expanded(
                          flex: 2,
                          child: SizedBox(
                            height: 47,
                            child: FilledButton.icon(
                              onPressed: _busy ? null : _submit,
                              style: FilledButton.styleFrom(
                                elevation: 0,
                                backgroundColor: AppColors.primary,
                                foregroundColor: Colors.white,
                                disabledBackgroundColor: AppColors.primary
                                    .withValues(alpha: .5),
                                disabledForegroundColor: Colors.white
                                    .withValues(alpha: .9),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(15),
                                ),
                              ),
                              icon: _busy
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(Icons.send_rounded, size: 16),
                              label: Text(
                                _busy ? 'Sending…' : 'Send invitation',
                                style: const TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Shared text-field decoration for invitation fields.
  InputDecoration _inviteInputDecoration({
    required String label,
    required String hint,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      labelStyle: const TextStyle(
        color: AppColors.textSecondary,
        fontSize: 11,
        fontWeight: FontWeight.w600,
      ),
      floatingLabelStyle: const TextStyle(
        color: AppColors.primaryDark,
        fontSize: 11,
        fontWeight: FontWeight.w700,
      ),
      hintStyle: TextStyle(
        color: AppColors.textMuted.withValues(alpha: .68),
        fontSize: 10.8,
      ),
      prefixIcon: Icon(icon, color: AppColors.primaryDark, size: 19),
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: AppColors.primary.withValues(alpha: .42)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.danger),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.danger, width: 1.4),
      ),
    );
  }
}

/// Compact administrator identity verification card.
///
/// @author Eman
class _SensitiveGate extends StatelessWidget {
  const _SensitiveGate({
    required this.password,
    required this.showPassword,
    required this.busy,
    required this.error,
    required this.onToggleVisibility,
    required this.onSubmit,
  });

  /// Administrator password controller.
  final TextEditingController password;

  /// Password visibility state.
  final bool showPassword;

  /// Verification loading state.
  final bool busy;

  /// Verification error.
  final String error;

  /// Password visibility callback.
  final VoidCallback onToggleVisibility;

  /// Verification submission callback.
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
                  const _SensitiveLockMark(),

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

                  /// Administrator password.
                  TextField(
                    controller: password,
                    obscureText: !showPassword,
                    enabled: !busy,
                    autocorrect: false,
                    enableSuggestions: false,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) {
                      onSubmit();
                    },
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
                        tooltip: showPassword
                            ? 'Hide password'
                            : 'Show password',
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

                  /// Verification error.
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

                  /// Unlock button.
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
                        busy ? 'Verifying…' : 'Unlock workspace',
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

            const _SensitiveSecurityNote(),
          ],
        ),
      ),
    );
  }
}

/// Soft lock illustration displayed above the password form.
///
/// @author Eman
class _SensitiveLockMark extends StatelessWidget {
  const _SensitiveLockMark();

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

/// Small contextual security label shown beneath
/// the sensitive-access card.
///
/// @author Eman
class _SensitiveSecurityNote extends StatelessWidget {
  const _SensitiveSecurityNote();

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

/// Converts protected backend response data
/// into reusable workspace cards.
///
/// This remains available for other protected
/// administrative workspaces.
///
/// @author Eman
class _WorkspaceDataCards {
  const _WorkspaceDataCards({required this.data});

  final Map<String, dynamic> data;

  /// Builds cards for all supported protected
  /// workspace response structures.
  List<Widget> buildCards(BuildContext context) {
    final source = data['data'] is Map
        ? Map<String, dynamic>.from(data['data'] as Map)
        : data;

    final cards = <Widget>[];

    for (final entry in source.entries) {
      final value = entry.value;

      if (value is List) {
        cards.add(_ListSection(title: _pretty(entry.key), items: value));
      } else if (value is Map) {
        cards.add(
          _MapSection(
            title: _pretty(entry.key),
            data: Map<String, dynamic>.from(value),
          ),
        );
      } else if (value != null) {
        cards.add(
          AdminGlassCard(
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _pretty(entry.key),
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 10.7,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    value.toString(),
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 10.8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    }

    if (cards.isEmpty) {
      cards.add(
        const AdminEmptyState(
          title: 'No workspace data',
          message: 'The server returned an empty protected workspace.',
          icon: Icons.lock_outline_rounded,
        ),
      );
    }

    final result = <Widget>[];

    for (var index = 0; index < cards.length; index++) {
      result.add(cards[index]);

      if (index != cards.length - 1) {
        result.add(const SizedBox(height: 10));
      }
    }

    return result;
  }

  /// Converts camelCase and snake_case property names
  /// into readable labels.
  static String _pretty(String key) {
    return key
        .replaceAllMapped(
          RegExp(r'([a-z])([A-Z])'),
          (match) => '${match[1]} ${match[2]}',
        )
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }
}

/// Displays a nested scalar map.
///
/// @author Eman
class _MapSection extends StatelessWidget {
  const _MapSection({required this.title, required this.data});

  final String title;

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final rows = data.entries
        .where((entry) => entry.value is! Map && entry.value is! List)
        .take(18)
        .toList();

    return AdminGlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),

          const SizedBox(height: 8),

          ...rows.map(
            (entry) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      _WorkspaceDataCards._pretty(entry.key),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.7,
                      ),
                    ),
                  ),

                  const SizedBox(width: 10),

                  Flexible(
                    child: Text(
                      entry.value?.toString() ?? '—',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays list-based protected workspace data.
///
/// @author Eman
class _ListSection extends StatelessWidget {
  const _ListSection({required this.title, required this.items});

  final String title;

  final List<dynamic> items;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '${items.length}',
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 9),

          ...items.take(12).map((item) {
            final map = item is Map ? Map<String, dynamic>.from(item) : null;

            final titleText = map == null
                ? item.toString()
                : (map['fullName'] ??
                              map['name'] ??
                              map['email'] ??
                              map['title'] ??
                              map['status'] ??
                              map['id'])
                          ?.toString() ??
                      'Record';

            final subtitle = map == null
                ? ''
                : (map['email'] ??
                              map['role'] ??
                              map['status'] ??
                              map['createdAt'])
                          ?.toString() ??
                      '';

            return Container(
              margin: const EdgeInsets.only(bottom: 7),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.background.withValues(alpha: .72),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Row(
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                  ),

                  const SizedBox(width: 8),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          titleText,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),

                        if (subtitle.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.9,
                            ),
                          ),
                        ],
                      ],
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
