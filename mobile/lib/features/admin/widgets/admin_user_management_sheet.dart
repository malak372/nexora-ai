import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';
import 'admin_ui.dart';

/// Mobile user-management workspace aligned with the web Users modal.
///
/// Administrators can inspect a profile, activate/deactivate the account,
/// edit supported account fields, adjust credits through the audited credit
/// ledger, send a password-recovery email, and move an account to the soft-deleted archive.
///
/// @author Eman
class AdminUserManagementSheet extends StatefulWidget {
  const AdminUserManagementSheet({
    super.key,
    required this.user,
    required this.onChanged,
  });

  final Map<String, dynamic> user;
  final Future<void> Function() onChanged;

  @override
  State<AdminUserManagementSheet> createState() =>
      _AdminUserManagementSheetState();
}

class _AdminUserManagementSheetState extends State<AdminUserManagementSheet> {
  final _api = AdminApi.instance;
  final _formKey = GlobalKey<FormState>();

  late Map<String, dynamic> _user;
  late final TextEditingController _nameController;
  late final TextEditingController _creditsController;
  late final TextEditingController _freeUsedController;
  late final TextEditingController _freeLimitController;
  late final TextEditingController _creditReasonController;

  String _userType = 'OTHER';
  bool _verified = false;
  bool _editing = false;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _user = Map<String, dynamic>.from(widget.user);
    _nameController = TextEditingController();
    _creditsController = TextEditingController();
    _freeUsedController = TextEditingController();
    _freeLimitController = TextEditingController();
    _creditReasonController = TextEditingController();
    _hydrateForm();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_loadFreshDetail());
    });
  }

  Future<void> _loadFreshDetail() async {
    if (_id.isEmpty) return;

    try {
      final detail = await _api.getDetail('/admin/users/$_id');
      if (!mounted || detail.isEmpty) return;

      setState(() {
        _user = {..._user, ...detail};
        if (!_editing) _hydrateForm();
      });
    } catch (_) {
      // The row snapshot already gives the sheet enough data to stay usable.
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _creditsController.dispose();
    _freeUsedController.dispose();
    _freeLimitController.dispose();
    _creditReasonController.dispose();
    super.dispose();
  }

  String get _id => _text(_user['id'] ?? _user['userId']);

  String get _name => _text(
        _user['fullName'] ?? _user['name'] ?? _user['displayName'],
        fallback: 'Unnamed user',
      );

  String get _email => _text(_user['email'], fallback: 'No email');

  String get _avatarUrl => _text(
        _user['avatarUrl'] ??
            _user['profileImageUrl'] ??
            _user['profileImage'] ??
            _user['avatar'],
      );

  int get _currentCredits => _asInt(_user['creditBalance'] ?? _user['credits']);

  bool get _isDeleted => _text(_user['deletedAt']).isNotEmpty;

  bool get _isActive => !_isDeleted && _user['isActive'] != false;

  String get _plan => _text(
        _user['accountStatus'] ?? _user['plan'] ?? _user['tier'],
        fallback: _currentCredits > 0 ? 'PREMIUM' : 'NORMAL',
      ).toUpperCase();

  void _hydrateForm() {
    _nameController.text = _name;
    _creditsController.text = _currentCredits.toString();
    _freeUsedController.text = _asInt(_user['freeGenerationsUsed']).toString();
    _freeLimitController.text =
        _asInt(_user['freeGenerationLimit'], fallback: 3).toString();
    _creditReasonController.clear();
    _userType = _text(_user['userType'] ?? _user['type'], fallback: 'OTHER')
        .toUpperCase();
    _verified = _user['isVerified'] == true || _user['emailVerified'] == true;
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .91,
      minChildSize: .58,
      maxChildSize: .97,
      builder: (context, controller) => Container(
        margin: const EdgeInsets.fromLTRB(6, 0, 6, 6),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: Colors.white),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .12),
              blurRadius: 36,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: Form(
          key: _formKey,
          child: ListView(
            controller: controller,
            physics: const BouncingScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 9, 16, 28),
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _header(),
              const SizedBox(height: 15),
              if (_editing) _editContent() else _viewContent(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Row(
      children: [
        AdminAvatar(name: _name, avatarUrl: _avatarUrl, size: 50),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _editing ? 'ACCOUNT EDITOR' : 'USER PROFILE',
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                _name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.3,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _email,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 10.2,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          icon: const Icon(Icons.close_rounded),
        ),
      ],
    );
  }

  Widget _viewContent() {
    final freeUsed = _asInt(_user['freeGenerationsUsed']);
    final freeLimit = _asInt(_user['freeGenerationLimit'], fallback: 3);
    final userType = _readable(
      _text(_user['userType'] ?? _user['type'], fallback: 'OTHER'),
    );
    final role = _text(_user['role'], fallback: 'USER').toUpperCase();
    final joined = _formatDate(_user['createdAt']);
    final updated = _formatDateTime(_user['updatedAt']);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AdminGlassCard(
          tint: AppColors.primarySoft.withValues(alpha: .72),
          child: Row(
            children: [
              const AdminIconBadge(
                icon: Icons.power_settings_new_rounded,
                size: 39,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Access state',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _isDeleted
                          ? 'Soft-deleted record. Platform access is disabled.'
                          : _isActive
                              ? 'This user can access the platform.'
                              : 'This account is currently disabled.',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.5,
                      ),
                    ),
                  ],
                ),
              ),
              Switch.adaptive(
                value: _isActive,
                onChanged: _busy || _isDeleted ? null : _setStatus,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _metric(
                Icons.workspace_premium_outlined,
                'Plan',
                _readable(_plan),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _metric(
                Icons.toll_outlined,
                'Credits',
                _currentCredits.toString(),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _metric(
                Icons.auto_awesome_outlined,
                'Free usage',
                '$freeUsed / $freeLimit',
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _sectionTitle(
          Icons.shield_outlined,
          'Identity & access',
          'Core account details and permissions.',
        ),
        const SizedBox(height: 9),
        _detailTile('Full name', _name),
        _detailTile('Email address', _email),
        _detailTile('User type', userType),
        _detailTile('Role', role),
        _detailTile('Email state', _verified ? 'Verified' : 'Not verified'),
        if (_id.isNotEmpty) _detailTile('Record ID', _id, monospace: true),
        if (joined.isNotEmpty) _detailTile('Member since', joined),
        if (updated.isNotEmpty) _detailTile('Last updated', updated),
        if (_isDeleted)
          _detailTile(
            'Deleted at',
            _formatDateTime(_user['deletedAt']),
          ),
        const SizedBox(height: 14),
        _sectionTitle(
          Icons.admin_panel_settings_outlined,
          'Admin actions',
          _isDeleted
              ? 'This record is retained for audit and history.'
              : 'Account controls aligned with the web Users workspace.',
        ),
        const SizedBox(height: 9),
        if (_isDeleted)
          AdminGlassCard(
            tint: AppColors.surfaceMuted.withValues(alpha: .76),
            child: Row(
              children: [
                const AdminIconBadge(
                  icon: Icons.inventory_2_outlined,
                  size: 38,
                  tone: AppColors.surface,
                  iconColor: AppColors.textSecondary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Deleted user record',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 11.8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Voxidence uses soft deletion: the database row stays for audit history, while sign-in and account actions are disabled.',
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.2,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          )
        else ...[
          _actionButton(
            icon: Icons.edit_outlined,
            title: 'Edit user',
            subtitle: 'Profile, type, free usage, verification and credits',
            onTap: _busy
                ? null
                : () {
                    setState(() {
                      _editing = true;
                      _error = '';
                      _hydrateForm();
                    });
                  },
          ),
          const SizedBox(height: 8),
          _actionButton(
            icon: Icons.mark_email_read_outlined,
            title: 'Send password recovery',
            subtitle: _isActive
                ? 'Email a secure reset link and show a clear sent confirmation'
                : 'Activate this account before sending a reset link',
            onTap: _busy || !_isActive ? null : _sendPasswordReset,
          ),
          const SizedBox(height: 8),
          _actionButton(
            icon: Icons.inventory_2_outlined,
            title: 'Move to deleted users',
            subtitle: 'Disable access and retain the record for audit history',
            danger: true,
            onTap: _busy ? null : _confirmSoftDelete,
          ),
        ],
      ],
    );
  }

  Widget _editContent() {
    final proposedCredits = int.tryParse(_creditsController.text.trim());
    final creditsChanged = proposedCredits != null && proposedCredits != _currentCredits;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AdminGlassCard(
          tint: AppColors.primarySoft.withValues(alpha: .55),
          child: Row(
            children: [
              const AdminIconBadge(
                icon: Icons.shield_outlined,
                size: 38,
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Protected editor',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Email and role stay protected. Credit changes are audited.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_error.isNotEmpty) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(11),
            decoration: BoxDecoration(
              color: AppColors.pinkSoft,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.pink.withValues(alpha: .15)),
            ),
            child: Text(
              _error,
              style: const TextStyle(
                color: AppColors.danger,
                fontSize: 10.2,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        const SizedBox(height: 14),
        _field(
          label: 'Full name',
          child: TextFormField(
            controller: _nameController,
            maxLength: 120,
            textInputAction: TextInputAction.next,
            decoration: _inputDecoration('User name'),
            validator: (value) => (value?.trim().isEmpty ?? true)
                ? 'Full name is required.'
                : null,
          ),
        ),
        _field(
          label: 'User type',
          helper: 'Choose the profile category shown across the platform.',
          child: Material(
            color: AppColors.background.withValues(alpha: .72),
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: _busy ? null : _openUserTypePicker,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                height: 50,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppColors.primarySoft,
                        borderRadius: BorderRadius.circular(11),
                      ),
                      child: Icon(
                        _userTypeIcon(_userType),
                        size: 17,
                        color: AppColors.primaryDark,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _readable(_userType),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 11.4,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const Icon(
                      Icons.expand_more_rounded,
                      color: AppColors.textMuted,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        _field(
          label: 'Credit balance',
          helper: 'Changing credits creates an audited ADMIN_ADJUSTMENT entry.',
          child: TextFormField(
            controller: _creditsController,
            keyboardType: TextInputType.number,
            decoration: _inputDecoration('0'),
            onChanged: (_) => setState(() {}),
            validator: (value) {
              final parsed = int.tryParse(value?.trim() ?? '');
              if (parsed == null || parsed < 0) {
                return 'Enter a whole number greater than or equal to 0.';
              }
              return null;
            },
          ),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _field(
                label: 'Free used',
                child: TextFormField(
                  controller: _freeUsedController,
                  keyboardType: TextInputType.number,
                  decoration: _inputDecoration('0'),
                  validator: (value) {
                    final parsed = int.tryParse(value?.trim() ?? '');
                    if (parsed == null || parsed < 0) return 'Invalid value.';
                    return null;
                  },
                ),
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              child: _field(
                label: 'Free limit',
                child: TextFormField(
                  controller: _freeLimitController,
                  keyboardType: TextInputType.number,
                  decoration: _inputDecoration('3'),
                  validator: (value) {
                    final parsed = int.tryParse(value?.trim() ?? '');
                    if (parsed == null || parsed < 0) return 'Invalid value.';
                    return null;
                  },
                ),
              ),
            ),
          ],
        ),
        if (creditsChanged)
          _field(
            label: 'Credit adjustment reason',
            helper: 'Stored in the credit ledger and audit log.',
            child: TextFormField(
              controller: _creditReasonController,
              maxLength: 500,
              decoration: _inputDecoration(
                'Example: Manual correction approved by support',
              ),
              validator: (value) {
                if (!creditsChanged) return null;
                if ((value?.trim().length ?? 0) < 5) {
                  return 'Write a reason of at least 5 characters.';
                }
                return null;
              },
            ),
          ),
        AdminGlassCard(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          child: Row(
            children: [
              const Icon(
                Icons.verified_user_outlined,
                color: AppColors.primaryDark,
                size: 20,
              ),
              const SizedBox(width: 9),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Email verification',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 11.4,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Control the verified state stored on this account.',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.1,
                      ),
                    ),
                  ],
                ),
              ),
              Switch.adaptive(
                value: _verified,
                onChanged: _busy ? null : (value) => setState(() => _verified = value),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        _lockedField(Icons.mail_outline_rounded, 'Protected email', _email),
        const SizedBox(height: 8),
        _lockedField(
          Icons.shield_outlined,
          'Protected role',
          _text(_user['role'], fallback: 'USER').toUpperCase(),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy
                    ? null
                    : () {
                        setState(() {
                          _editing = false;
                          _error = '';
                          _hydrateForm();
                        });
                      },
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 9),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed: _busy ? null : _save,
                icon: _busy
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.save_outlined, size: 18),
                label: Text(_busy ? 'Saving…' : 'Save changes'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _metric(IconData icon, String label, String value) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 9),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Icon(icon, size: 17, color: AppColors.primaryDark),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 11.5,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(IconData icon, String title, String subtitle) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AdminIconBadge(icon: icon, size: 35),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 13.1,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _detailTile(String label, String value, {bool monospace = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.background.withValues(alpha: .72),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 8.6,
                fontWeight: FontWeight.w900,
                letterSpacing: .45,
              ),
            ),
            const SizedBox(height: 4),
            SelectableText(
              value,
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: monospace ? 10.3 : 11.2,
                height: 1.35,
                fontWeight: FontWeight.w700,
                fontFamily: monospace ? 'monospace' : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionButton({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback? onTap,
    bool danger = false,
  }) {
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 160),
      opacity: onTap == null ? .52 : 1,
      child: Material(
        color: danger ? AppColors.pinkSoft : AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(17),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(17),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(17),
              border: Border.all(
                color: danger
                    ? AppColors.pink.withValues(alpha: .18)
                    : AppColors.border,
              ),
            ),
            child: Row(
              children: [
                AdminIconBadge(
                  icon: icon,
                  size: 36,
                  tone: danger ? AppColors.pinkSoft : AppColors.primarySoft,
                  iconColor: danger ? AppColors.danger : AppColors.primaryDark,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: danger
                              ? AppColors.danger
                              : AppColors.textPrimary,
                          fontSize: 11.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.1,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 12,
                  color: danger ? AppColors.danger : AppColors.sage,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field({
    required String label,
    required Widget child,
    String? helper,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.7,
              fontWeight: FontWeight.w900,
              letterSpacing: .45,
            ),
          ),
          const SizedBox(height: 6),
          child,
          if (helper != null) ...[
            const SizedBox(height: 4),
            Text(
              helper,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 8.8),
            ),
          ],
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: AppColors.background.withValues(alpha: .72),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.3),
      ),
    );
  }

  Widget _lockedField(IconData icon, String label, String value) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: .7),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.textMuted),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.6,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(99),
            ),
            child: const Text(
              'PROTECTED',
              style: TextStyle(
                color: AppColors.primaryDark,
                fontSize: 7.5,
                fontWeight: FontWeight.w900,
                letterSpacing: .45,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _setStatus(bool value) async {
    if (_id.isEmpty || _busy) return;

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      await _api.setUserStatus(_id, value);
      _user = {..._user, 'isActive': value};
      await widget.onChanged();
      if (!mounted) return;
      setState(() {});
      _message(value ? 'User activated.' : 'User deactivated.');
    } on ApiException catch (error) {
      if (mounted) _message(error.message, danger: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendPasswordReset() async {
    if (_id.isEmpty || _busy || _isDeleted) return;

    setState(() => _busy = true);
    try {
      final result = await _api.sendUserPasswordReset(_id);
      if (!mounted) return;

      final serverMessage = _text(
        result['message'],
        fallback: 'Password reset email sent successfully',
      );

      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: AppColors.surface,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          title: const Row(
            children: [
              AdminIconBadge(
                icon: Icons.mark_email_read_outlined,
                size: 40,
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Recovery email sent',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          content: Text(
            '$serverMessage\n\nSent to $_email. The reset link expires after 15 minutes.',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11,
              height: 1.5,
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primarySoft,
                foregroundColor: AppColors.primaryDeep,
                elevation: 0,
              ),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } on ApiException catch (error) {
      if (mounted) _message(error.message, danger: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmSoftDelete() async {
    if (_id.isEmpty || _busy || _isDeleted) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
        ),
        title: const Text(
          'Move to deleted users?',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w900,
          ),
        ),
        content: Text(
          '$_name will lose platform access and disappear from the normal Users list. '
          'The database record is intentionally retained with a deletedAt timestamp for audit history.',
          style: const TextStyle(
            color: AppColors.textSecondary,
            height: 1.45,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.pinkSoft,
              foregroundColor: AppColors.danger,
              elevation: 0,
              side: BorderSide(
                color: AppColors.pink.withValues(alpha: .22),
              ),
            ),
            icon: const Icon(Icons.inventory_2_outlined, size: 17),
            label: const Text('Move to deleted'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final result = await _api.moveUserToDeleted(_id);
      await widget.onChanged();
      if (!mounted) return;

      _message(
        _text(
          result['message'],
          fallback: 'User moved to deleted users.',
        ),
      );
      Navigator.of(context).pop();
    } on ApiException catch (error) {
      if (mounted) _message(error.message, danger: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    if (_busy || _id.isEmpty) return;

    if (!(_formKey.currentState?.validate() ?? false)) return;

    final freeUsed = int.parse(_freeUsedController.text.trim());
    final freeLimit = int.parse(_freeLimitController.text.trim());
    final nextCredits = int.parse(_creditsController.text.trim());
    final creditDelta = nextCredits - _currentCredits;

    if (freeUsed > freeLimit) {
      setState(() {
        _error = 'Free generations used cannot be greater than the free generation limit.';
      });
      return;
    }

    setState(() {
      _busy = true;
      _error = '';
    });

    try {
      await _api.updateUser(
        _id,
        {
          'fullName': _nameController.text.trim(),
          'userType': _userType,
          'freeGenerationsUsed': freeUsed,
          'freeGenerationLimit': freeLimit,
          'isVerified': _verified,
        },
      );

      if (creditDelta != 0) {
        await _api.adjustCredits(
          userId: _id,
          amount: creditDelta,
          description: _creditReasonController.text.trim(),
        );
      }

      try {
        final detail = await _api.getDetail('/admin/users/$_id', force: true);
        if (detail.isNotEmpty) {
          _user = detail;
        } else {
          _user = {
            ..._user,
            'fullName': _nameController.text.trim(),
            'userType': _userType,
            'freeGenerationsUsed': freeUsed,
            'freeGenerationLimit': freeLimit,
            'isVerified': _verified,
            'creditBalance': nextCredits,
            'accountStatus': nextCredits > 0 ? 'PREMIUM' : 'NORMAL',
          };
        }
      } catch (_) {
        _user = {
          ..._user,
          'fullName': _nameController.text.trim(),
          'userType': _userType,
          'freeGenerationsUsed': freeUsed,
          'freeGenerationLimit': freeLimit,
          'isVerified': _verified,
          'creditBalance': nextCredits,
          'accountStatus': nextCredits > 0 ? 'PREMIUM' : 'NORMAL',
        };
      }

      await widget.onChanged();
      if (!mounted) return;

      setState(() {
        _editing = false;
        _hydrateForm();
      });
      _message('User updated successfully.');
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not update this user.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openUserTypePicker() async {
    const types = ['STUDENT', 'DEVELOPER', 'COMPANY', 'RESEARCHER', 'OTHER'];
    String draft = types.contains(_userType) ? _userType : 'OTHER';

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Container(
          margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .12),
                blurRadius: 32,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 15),
              const Text(
                'User type',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              const Text(
                'Choose the profile category stored on this account.',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.7,
                ),
              ),
              const SizedBox(height: 12),
              ...types.map((type) {
                final active = draft == type;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Material(
                    color: active
                        ? AppColors.primarySoft
                        : AppColors.background.withValues(alpha: .66),
                    borderRadius: BorderRadius.circular(16),
                    child: InkWell(
                      onTap: () => setSheetState(() => draft = type),
                      borderRadius: BorderRadius.circular(16),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: active
                                ? AppColors.primary.withValues(alpha: .28)
                                : AppColors.border,
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 36,
                              height: 36,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                _userTypeIcon(type),
                                size: 17,
                                color: active
                                    ? AppColors.primaryDark
                                    : AppColors.textSecondary,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _readable(type),
                                style: TextStyle(
                                  color: active
                                      ? AppColors.primaryDeep
                                      : AppColors.textPrimary,
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            Icon(
                              active
                                  ? Icons.check_circle_rounded
                                  : Icons.circle_outlined,
                              size: 20,
                              color: active
                                  ? AppColors.primary
                                  : AppColors.silver,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
              const SizedBox(height: 4),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(sheetContext, draft),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primarySoft,
                    foregroundColor: AppColors.primaryDeep,
                    elevation: 0,
                    side: BorderSide(
                      color: AppColors.primary.withValues(alpha: .2),
                    ),
                  ),
                  icon: const Icon(Icons.check_rounded, size: 18),
                  label: const Text('Use this type'),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (!mounted || selected == null || selected == _userType) return;
    setState(() => _userType = selected);
  }

  IconData _userTypeIcon(String type) {
    return switch (type.toUpperCase()) {
      'STUDENT' => Icons.school_outlined,
      'DEVELOPER' => Icons.code_rounded,
      'COMPANY' => Icons.apartment_rounded,
      'RESEARCHER' => Icons.science_outlined,
      _ => Icons.person_outline_rounded,
    };
  }

  void _message(String text, {bool danger = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: danger ? AppColors.danger : null,
      ),
    );
  }

  String _text(dynamic value, {String fallback = ''}) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }

  int _asInt(dynamic value, {int fallback = 0}) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? fallback;
  }

  String _readable(String value) {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }

  String _formatDate(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (parsed == null) return '';
    const months = [
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

  String _formatDateTime(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (parsed == null) return '';
    final date = _formatDate(parsed.toIso8601String());
    final hour = parsed.hour.toString().padLeft(2, '0');
    final minute = parsed.minute.toString().padLeft(2, '0');
    return '$date · $hour:$minute';
  }
}
