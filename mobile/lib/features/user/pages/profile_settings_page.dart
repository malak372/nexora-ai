// Mobile profile and security workspace mirroring the web profile settings.
//
// @author  Malak

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_config.dart';
import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class ProfileSettingsPage extends StatefulWidget {
  const ProfileSettingsPage({super.key});

  @override
  State<ProfileSettingsPage> createState() => _ProfileSettingsPageState();
}

class _ProfileSettingsPageState extends State<ProfileSettingsPage> {
  final _name = TextEditingController();
  String _userType = 'OTHER';
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _sessions = const [];
  bool _loading = true;
  bool _saving = false;
  bool _uploadingAvatar = false;
  Object? _error;

  static const _userTypes = <String, String>{
    'STUDENT': 'Student',
    'DEVELOPER': 'Developer',
    'RESEARCHER': 'Researcher',
    'COMPANY': 'Company',
    'OTHER': 'Other',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
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
        UserApi.instance.getProfile(force: force),
        UserApi.instance.getSessions(force: force).catchError(
              (_) => <Map<String, dynamic>>[],
            ),
      ]);
      final profile = Map<String, dynamic>.from(values[0] as Map);
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _name.text = '${profile['fullName'] ?? ''}';
        final type = '${profile['userType'] ?? 'OTHER'}';
        _userType = _userTypes.containsKey(type) ? type : 'OTHER';
        _sessions = List<Map<String, dynamic>>.from(values[1] as List);
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveProfile() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      showAppSnackBar(context, 'Full name must contain at least 2 characters.', error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final updated = await UserApi.instance.updateProfile(
        fullName: name,
        userType: _userType,
      );
      UserSessionController.instance.applyProfile(
        fullName: updated['fullName']?.toString() ?? name,
        email: updated['email']?.toString(),
        userType: updated['userType']?.toString() ?? _userType,
        avatarUrl: updated['avatarUrl']?.toString(),
      );

      if (mounted) {
        setState(() {
          _profile = {
            ...?_profile,
            ...updated,
          };
        });

        showAppSnackBar(
          context,
          'Profile updated.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _openEmailChange() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EmailChangeSheet(
        currentEmail: '${_profile?['email'] ?? ''}',
      ),
    );

    if (changed == true) {
      await Future.wait([
        _load(force: true),
        UserSessionController.instance.load(force: true),
      ]);
    }
  }

  Future<void> _openPasswordChange() async {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _PasswordChangeSheet(),
    );
  }

  Future<void> _revokeSession(String id) async {
    try {
      await UserApi.instance.revokeSession(id);
      await _load(force: true);
      if (mounted) showAppSnackBar(context, 'Session revoked.');
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  Future<void> _revokeAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out everywhere?'),
        content: const Text(
          'All active sessions, including this one, will be revoked. You will need to sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Revoke all'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await UserApi.instance.revokeAllSessions();
    } finally {
      await SessionStore.instance.clear();
      ApiClient.instance.clearCache();
      UserSessionController.instance.reset();
      if (mounted) {
        Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
      }
    }
  }

  Future<void> _pickAndUploadAvatar() async {
    if (_uploadingAvatar) return;

    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 90,
        maxWidth: 1200,
        maxHeight: 1200,
      );
      if (picked == null) return;

      final bytes = await picked.readAsBytes();
      if (bytes.isEmpty) {
        if (mounted) {
          showAppSnackBar(
            context,
            'The selected image could not be read.',
            error: true,
          );
        }
        return;
      }

      const maxBytes = 5 * 1024 * 1024;
      if (bytes.length > maxBytes) {
        if (mounted) {
          showAppSnackBar(
            context,
            'Choose an image smaller than 5 MB.',
            error: true,
          );
        }
        return;
      }

      setState(() => _uploadingAvatar = true);

      final updated =
          await UserApi.instance.uploadProfileAvatar(
        bytes: bytes,
        fileName: picked.name.isEmpty
            ? 'voxidence-avatar.jpg'
            : picked.name,
      );

      final avatarUrl =
          updated['avatarUrl']?.toString();

      UserSessionController.instance.applyProfile(
        avatarUrl: avatarUrl,
      );

      if (mounted) {
        setState(() {
          _profile = {
            ...?_profile,
            ...updated,
          };
        });

        showAppSnackBar(
          context,
          'Profile image updated.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } catch (_) {
      if (mounted) {
        showAppSnackBar(
          context,
          'The profile image could not be uploaded.',
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _removeAvatar() async {
    try {
      await UserApi.instance.removeProfileAvatar();

      UserSessionController.instance.applyProfile(
        clearAvatar: true,
      );

      if (mounted) {
        setState(() {
          _profile = {
            ...?_profile,
            'avatarUrl': null,
          };
        });

        showAppSnackBar(
          context,
          'Profile image removed.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    }
  }

  Future<void> _deleteAccount() async {
    final password = TextEditingController();
    final confirmed = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete account permanently?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'This action is permanent. Enter your current password to confirm.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Current password',
                prefixIcon: Icon(Icons.lock_outline_rounded),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, password.text),
            child: const Text('Delete account'),
          ),
        ],
      ),
    );
    password.dispose();

    if (confirmed == null || confirmed.length < 6) return;

    try {
      await UserApi.instance.deleteAccount(confirmed);
      await SessionStore.instance.clear();
      UserSessionController.instance.reset();
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile & security')),
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
                eyebrow: 'ACCOUNT',
                title: 'Your identity & security',
                subtitle:
                    'Edit profile information, manage email and password, and control active sessions from one mobile workspace.',
              ),
              const SizedBox(height: 16),
              if (_loading && profile == null)
                const LoadingList(count: 4)
              else if (_error != null && profile == null)
                EmptyState(
                  icon: Icons.person_off_outlined,
                  title: 'Profile unavailable',
                  message: _error.toString(),
                  action: FilledButton(
                    onPressed: () => _load(force: true),
                    child: const Text('Retry'),
                  ),
                )
              else if (profile != null) ...[
                VoxCard(
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _ProfileAvatar(
                            name: '${profile['fullName'] ?? 'Voxidence User'}',
                            avatarUrl: _mediaUrl('${profile['avatarUrl'] ?? ''}'),
                            uploading: _uploadingAvatar,
                            onTap: _pickAndUploadAvatar,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${profile['fullName'] ?? ''}',
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${profile['email'] ?? ''}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 10.5,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                AccountTierBadge(
                                  isPremium: '${profile['accountStatus'] ?? 'NORMAL'}'
                                          .toUpperCase() ==
                                      'PREMIUM',
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 11),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            FilledButton.tonalIcon(
                              onPressed:
                                  _uploadingAvatar ? null : _pickAndUploadAvatar,
                              icon: _uploadingAvatar
                                  ? const SizedBox(
                                      width: 15,
                                      height: 15,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.photo_camera_outlined,
                                      size: 16,
                                    ),
                              label: Text(
                                '${profile['avatarUrl'] ?? ''}'.trim().isEmpty
                                    ? 'Add photo'
                                    : 'Change photo',
                              ),
                            ),
                            if ('${profile['avatarUrl'] ?? ''}'
                                .trim()
                                .isNotEmpty)
                              TextButton.icon(
                                onPressed:
                                    _uploadingAvatar ? null : _removeAvatar,
                                icon: const Icon(
                                  Icons.image_not_supported_outlined,
                                  size: 16,
                                ),
                                label: const Text('Remove photo'),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                VoxCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionHeading(
                        title: 'Profile details',
                        subtitle: 'These fields can be updated without email verification.',
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        controller: _name,
                        maxLength: 120,
                        decoration: const InputDecoration(
                          labelText: 'Full name',
                          prefixIcon: Icon(Icons.badge_outlined),
                          counterText: '',
                        ),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        initialValue: _userType,
                        decoration: const InputDecoration(
                          labelText: 'I use Voxidence as',
                          prefixIcon: Icon(Icons.work_outline_rounded),
                        ),
                        items: _userTypes.entries
                            .map(
                              (entry) => DropdownMenuItem(
                                value: entry.key,
                                child: Text(entry.value),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          if (value != null) setState(() => _userType = value);
                        },
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _saving ? null : _saveProfile,
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
                          label: Text(_saving ? 'Saving...' : 'Save profile'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                VoxCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      FeatureTile(
                        icon: Icons.alternate_email_rounded,
                        title: 'Change email',
                        subtitle:
                            'Two-step verification protects both your current and new email addresses.',
                        onTap: _openEmailChange,
                      ),
                      const Divider(height: 1),
                      FeatureTile(
                        icon: Icons.password_rounded,
                        title: 'Change password',
                        subtitle: 'Requires your current password and the Voxidence password policy.',
                        onTap: _openPasswordChange,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                SectionHeading(
                  title: 'Active sessions',
                  subtitle: '${_sessions.length} active session${_sessions.length == 1 ? '' : 's'}',
                  trailing: _sessions.isEmpty
                      ? null
                      : TextButton(
                          onPressed: _revokeAll,
                          child: const Text('Revoke all'),
                        ),
                ),
                const SizedBox(height: 10),
                if (_sessions.isEmpty)
                  const InlineNotice(
                    icon: Icons.devices_outlined,
                    message: 'No additional active sessions were returned.',
                  )
                else
                  ..._sessions.map(
                    (session) => Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: VoxCard(
                        child: Row(
                          children: [
                            const SoftIconBadge(
                              icon: Icons.devices_outlined,
                              size: 40,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${session['deviceLabel'] ?? 'Unknown device'}',
                                    style: const TextStyle(
                                      color: AppColors.textPrimary,
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${session['ipAddress'] ?? 'IP unavailable'} · last used ${_date(session['lastUsedAt'])}',
                                    style: const TextStyle(
                                      color: AppColors.textMuted,
                                      fontSize: 9.4,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              tooltip: 'Revoke session',
                              onPressed: () => _revokeSession('${session['id']}'),
                              icon: const Icon(
                                Icons.logout_rounded,
                                size: 18,
                                color: AppColors.danger,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                VoxCard(
                  tint: AppColors.surfaceRose.withValues(alpha: .82),
                  child: Row(
                    children: [
                      const SoftIconBadge(
                        icon: Icons.delete_outline_rounded,
                        rose: true,
                        size: 42,
                      ),
                      const SizedBox(width: 11),
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Delete account',
                              style: TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            SizedBox(height: 3),
                            Text(
                              'Permanent and password protected.',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: _deleteAccount,
                        style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                        child: const Text('Delete'),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _mediaUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return '';
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.hasScheme) return trimmed;
    return '${ApiConfig.baseUrl}${trimmed.startsWith('/') ? '' : '/'}$trimmed';
  }


  String _date(dynamic value) {
    final date = DateTime.tryParse('$value')?.toLocal();
    if (date == null) return 'recently';
    return '${date.month}/${date.day}/${date.year}';
  }
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({
    required this.name,
    required this.avatarUrl,
    required this.uploading,
    required this.onTap,
  });

  final String name;
  final String avatarUrl;
  final bool uploading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    final initials = parts.isEmpty
        ? 'V'
        : parts.length == 1
            ? parts.first.substring(0, 1).toUpperCase()
            : '${parts.first[0]}${parts.last[0]}'.toUpperCase();

    return Semantics(
      button: true,
      label: avatarUrl.isEmpty ? 'Add profile photo' : 'Change profile photo',
      child: InkWell(
        borderRadius: BorderRadius.circular(99),
        onTap: uploading ? null : onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 62,
              height: 62,
              clipBehavior: Clip.antiAlias,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppColors.primary, Color(0xFF4FA9A4)],
                ),
                shape: BoxShape.circle,
              ),
              child: avatarUrl.isEmpty
                  ? Text(
                      initials,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    )
                  : Image.network(
                      avatarUrl,
                      width: 62,
                      height: 62,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => Text(
                        initials,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
            ),
            Positioned(
              right: -2,
              bottom: -2,
              child: Container(
                width: 25,
                height: 25,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primaryDeep.withValues(alpha: .12),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: uploading
                    ? const SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 1.7),
                      )
                    : const Icon(
                        Icons.camera_alt_outlined,
                        color: AppColors.primaryDark,
                        size: 13,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PasswordChangeSheet extends StatefulWidget {
  const _PasswordChangeSheet();

  @override
  State<_PasswordChangeSheet> createState() => _PasswordChangeSheetState();
}

class _PasswordChangeSheetState extends State<_PasswordChangeSheet> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;
  bool _obscure = true;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final next = _next.text.trim();
    final valid = next.length >= 6 &&
        RegExp(r'[A-Za-z]').hasMatch(next) &&
        RegExp(r'\d').hasMatch(next);

    if (!valid) {
      showAppSnackBar(
        context,
        'New password must be at least 6 characters and contain a letter and a number.',
        error: true,
      );
      return;
    }
    if (next != _confirm.text.trim()) {
      showAppSnackBar(context, 'Passwords do not match.', error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      await UserApi.instance.changePassword(
        currentPassword: _current.text,
        newPassword: next,
      );
      if (!mounted) return;
      showAppSnackBar(context, 'Password changed successfully.');
      Navigator.pop(context);
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .66,
      maxChildSize: .86,
      minChildSize: .48,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            const WorkspacePageHeader(
              eyebrow: 'SECURITY',
              title: 'Change password',
              subtitle: 'Use at least one letter and one number.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _current,
              obscureText: _obscure,
              decoration: const InputDecoration(
                labelText: 'Current password',
                prefixIcon: Icon(Icons.lock_outline_rounded),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _next,
              obscureText: _obscure,
              decoration: const InputDecoration(
                labelText: 'New password',
                prefixIcon: Icon(Icons.password_rounded),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _confirm,
              obscureText: _obscure,
              decoration: InputDecoration(
                labelText: 'Confirm new password',
                prefixIcon: const Icon(Icons.verified_user_outlined),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: const Icon(Icons.check_rounded),
                label: Text(_saving ? 'Saving...' : 'Change password'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmailChangeSheet extends StatefulWidget {
  const _EmailChangeSheet({required this.currentEmail});

  final String currentEmail;

  @override
  State<_EmailChangeSheet> createState() => _EmailChangeSheetState();
}

class _EmailChangeSheetState extends State<_EmailChangeSheet> {
  final _newEmail = TextEditingController();
  final _password = TextEditingController();
  final _currentCode = TextEditingController();
  final _newCode = TextEditingController();
  int _step = 0;
  bool _busy = false;

  @override
  void dispose() {
    _newEmail.dispose();
    _password.dispose();
    _currentCode.dispose();
    _newCode.dispose();
    super.dispose();
  }

  Future<void> _request() async {
    final email = _newEmail.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      showAppSnackBar(context, 'Enter a valid new email address.', error: true);
      return;
    }
    if (_password.text.length < 6) {
      showAppSnackBar(context, 'Enter your current password.', error: true);
      return;
    }

    await _run(() async {
      await UserApi.instance.requestEmailChange(
        newEmail: email,
        currentPassword: _password.text,
      );
      if (mounted) setState(() => _step = 1);
    }, 'A verification code was sent to your current email.');
  }

  Future<void> _verifyCurrent() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_currentCode.text.trim())) {
      showAppSnackBar(context, 'Enter the 6-digit code.', error: true);
      return;
    }

    await _run(() async {
      await UserApi.instance.verifyCurrentEmailChange(_currentCode.text);
      if (mounted) setState(() => _step = 2);
    }, 'Current email verified. A new code was sent to the new address.');
  }

  Future<void> _verifyNew() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_newCode.text.trim())) {
      showAppSnackBar(context, 'Enter the 6-digit code.', error: true);
      return;
    }

    await _run(() async {
      await UserApi.instance.verifyNewEmailChange(_newCode.text);
      if (!mounted) return;
      Navigator.pop(context, true);
    }, 'Email address changed successfully.');
  }

  Future<void> _cancel() async {
    try {
      await UserApi.instance.cancelEmailChange();
    } catch (_) {
      // Closing the sheet is still safe when there is no active request.
    }
    if (mounted) Navigator.pop(context, false);
  }

  Future<void> _run(Future<void> Function() work, String success) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await work();
      if (mounted) showAppSnackBar(context, success);
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .72,
      maxChildSize: .9,
      minChildSize: .52,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            WorkspacePageHeader(
              eyebrow: 'VERIFIED CHANGE',
              title: 'Change email safely',
              subtitle: _step == 0
                  ? 'Current email: ${widget.currentEmail}'
                  : _step == 1
                      ? 'Step 1 of 2: verify the current address.'
                      : 'Step 2 of 2: verify the new address.',
            ),
            const SizedBox(height: 16),
            if (_step == 0) ...[
              TextField(
                controller: _newEmail,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'New email',
                  prefixIcon: Icon(Icons.alternate_email_rounded),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _password,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Current password',
                  prefixIcon: Icon(Icons.lock_outline_rounded),
                ),
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _busy ? null : _request,
                icon: const Icon(Icons.send_rounded),
                label: Text(_busy ? 'Sending...' : 'Send verification code'),
              ),
            ] else if (_step == 1) ...[
              TextField(
                controller: _currentCode,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'Code from current email',
                  prefixIcon: Icon(Icons.pin_outlined),
                  counterText: '',
                ),
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _busy ? null : _verifyCurrent,
                icon: const Icon(Icons.verified_outlined),
                label: Text(_busy ? 'Verifying...' : 'Verify current email'),
              ),
            ] else ...[
              TextField(
                controller: _newCode,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'Code from new email',
                  prefixIcon: Icon(Icons.pin_outlined),
                  counterText: '',
                ),
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _busy ? null : _verifyNew,
                icon: const Icon(Icons.check_circle_outline_rounded),
                label: Text(_busy ? 'Finishing...' : 'Confirm new email'),
              ),
            ],
            const SizedBox(height: 8),
            TextButton(
              onPressed: _busy ? null : _cancel,
              child: const Text('Cancel email change'),
            ),
          ],
        ),
      ),
    );
  }
}
