// Mobile profile and security workspace mirroring the web profile settings.
//
// @author Eman

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
  bool _isAdmin = false;

  Object? _error;

  static const _userTypes = <String, String>{
    'STUDENT': 'Student',
    'DEVELOPER': 'Developer',
    'RESEARCHER': 'Researcher',
    'COMPANY': 'Company',
    'OTHER': 'Other',
  };

  List<_SessionGroup> get _sessionGroups {
    final buckets = <String, List<Map<String, dynamic>>>{};

    for (final session in _sessions) {
      final device =
          '${session['deviceLabel'] ?? 'Unknown device'}'.trim();

      final ip =
          '${session['ipAddress'] ?? 'IP unavailable'}'.trim();

      final key =
          '${device.toLowerCase()}::${ip.toLowerCase()}';

      buckets
          .putIfAbsent(
            key,
            () => <Map<String, dynamic>>[],
          )
          .add(session);
    }

    final groups = buckets.values
        .map(_SessionGroup.fromSessions)
        .toList();

    groups.sort((a, b) {
      final aDate = DateTime.tryParse(
        '${a.latest['lastUsedAt'] ?? ''}',
      );

      final bDate = DateTime.tryParse(
        '${b.latest['lastUsedAt'] ?? ''}',
      );

      if (aDate == null && bDate == null) {
        return 0;
      }

      if (aDate == null) {
        return 1;
      }

      if (bDate == null) {
        return -1;
      }

      return bDate.compareTo(aDate);
    });

    return groups;
  }

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

  Future<void> _load({
    bool force = false,
  }) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final values = await Future.wait<dynamic>([
        UserApi.instance.getProfile(
          force: force,
        ),
        UserApi.instance
            .getSessions(
              force: force,
            )
            .catchError(
              (_) => <Map<String, dynamic>>[],
            ),
        SessionStore.instance.readUser(),
      ]);

      final profile = Map<String, dynamic>.from(
        values[0] as Map,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _profile = profile;

        _name.text =
            '${profile['fullName'] ?? ''}';

        final type =
            '${profile['userType'] ?? 'OTHER'}';

        _userType = _userTypes.containsKey(type)
            ? type
            : 'OTHER';

        _sessions =
            List<Map<String, dynamic>>.from(
          values[1] as List,
        );

        final sessionUser = values[2] is Map
            ? Map<String, dynamic>.from(values[2] as Map)
            : <String, dynamic>{};
        final role = '${profile['role'] ?? sessionUser['role'] ?? ''}'
            .trim()
            .toUpperCase();
        _isAdmin = role == 'ADMIN';
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
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

  Future<void> _saveProfile() async {
    final name = _name.text.trim();

    if (name.length < 2) {
      showAppSnackBar(
        context,
        'Full name must contain at least 2 characters.',
        error: true,
      );
      return;
    }

    setState(() {
      _saving = true;
    });

    try {
      final updated =
          await UserApi.instance.updateProfile(
        fullName: name,
        userType: _isAdmin ? null : _userType,
      );

      UserSessionController.instance.applyProfile(
        fullName:
            updated['fullName']?.toString() ?? name,
        email:
            updated['email']?.toString(),
        userType:
            updated['userType']?.toString() ??
                _userType,
        avatarUrl:
            updated['avatarUrl']?.toString(),
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
      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
        });
      }
    }
  }

  Future<void> _openEmailChange() async {
    final changed =
        await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EmailChangeSheet(
        currentEmail:
            '${_profile?['email'] ?? ''}',
      ),
    );

    if (changed == true) {
      await Future.wait([
        _load(
          force: true,
        ),
        UserSessionController.instance.load(
          force: true,
        ),
      ]);
    }
  }

  Future<void> _openPasswordChange() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) =>
          const _PasswordChangeSheet(),
    );
  }

  Future<void> _revokeSessionGroup(
    _SessionGroup group,
  ) async {
    final ids = group.sessions
        .map(
          (session) =>
              '${session['id'] ?? ''}'.trim(),
        )
        .where(
          (id) => id.isNotEmpty,
        )
        .toList();

    if (ids.isEmpty) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(
            ids.length == 1
                ? 'Revoke this session?'
                : 'Revoke ${ids.length} matching sessions?',
          ),
          content: Text(
            ids.length == 1
                ? 'This device session will be signed out.'
                : 'All matching sessions for ${group.deviceLabel} at ${group.ipAddress} will be signed out.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(context).pop(true);
              },
              child: const Text('Revoke'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    try {
      await Future.wait(
        ids.map(
          UserApi.instance.revokeSession,
        ),
      );

      await _load(
        force: true,
      );

      if (mounted) {
        showAppSnackBar(
          context,
          ids.length == 1
              ? 'Session revoked.'
              : '${ids.length} matching sessions revoked.',
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

  Future<void> _revokeAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text(
            'Sign out everywhere?',
          ),
          content: const Text(
            'All active sessions, including this one, will be revoked. You will need to sign in again.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  context,
                  false,
                );
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  context,
                  true,
                );
              },
              child: const Text(
                'Revoke all',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    try {
      await UserApi.instance.revokeAllSessions();
    } finally {
      await SessionStore.instance.clear();

      ApiClient.instance.clearCache();

      UserSessionController.instance.reset();

      if (mounted) {
        Navigator.of(context)
            .pushNamedAndRemoveUntil(
          '/login',
          (route) => false,
        );
      }
    }
  }

  Future<void> _pickAndUploadAvatar() async {
    if (_uploadingAvatar) {
      return;
    }

    try {
      final picked =
          await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 90,
        maxWidth: 1200,
        maxHeight: 1200,
      );

      if (picked == null) {
        return;
      }

      final bytes =
          await picked.readAsBytes();

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

      const maxBytes =
          5 * 1024 * 1024;

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

      setState(() {
        _uploadingAvatar = true;
      });

      final updated =
          await UserApi.instance
              .uploadProfileAvatar(
        bytes: bytes,
        fileName: picked.name.isEmpty
            ? 'voxidence-avatar.jpg'
            : picked.name,
      );

      final avatarUrl =
          updated['avatarUrl']?.toString();

      UserSessionController.instance
          .applyProfile(
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
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
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
      if (mounted) {
        setState(() {
          _uploadingAvatar = false;
        });
      }
    }
  }

  Future<void> _removeAvatar() async {
    try {
      await UserApi.instance
          .removeProfileAvatar();

      UserSessionController.instance
          .applyProfile(
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
    final password =
        TextEditingController();

    final confirmed =
        await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text(
            'Delete account permanently?',
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              const Text(
                'This action is permanent. Enter your current password to confirm.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: password,
                obscureText: true,
                decoration:
                    const InputDecoration(
                  labelText:
                      'Current password',
                  prefixIcon: Icon(
                    Icons.lock_outline_rounded,
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(context);
              },
              child:
                  const Text('Cancel'),
            ),
            FilledButton(
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    AppColors.danger,
              ),
              onPressed: () {
                Navigator.pop(
                  context,
                  password.text,
                );
              },
              child: const Text(
                'Delete account',
              ),
            ),
          ],
        );
      },
    );

    password.dispose();

    if (confirmed == null ||
        confirmed.length < 6) {
      return;
    }

    try {
      await UserApi.instance
          .deleteAccount(
        confirmed,
      );

      await SessionStore.instance.clear();

      UserSessionController.instance.reset();

      if (!mounted) {
        return;
      }

      Navigator.of(context)
          .pushNamedAndRemoveUntil(
        '/',
        (route) => false,
      );
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

  void _backToProfile() {
    returnFromWorkspacePage(context);
  }

  Future<void> _openUserTypePicker() async {
    final selected =
        await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep
          .withValues(
        alpha: .18,
      ),
      builder: (_) => _UserTypePickerSheet(
        selectedValue: _userType,
        options: _userTypes,
      ),
    );

    if (!mounted ||
        selected == null ||
        selected == _userType) {
      return;
    }

    setState(() {
      _userType = selected;
    });
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _ProfileRouteHeader(
            onBack: _backToProfile,
          ),
          Expanded(
            child: WorkspaceBackground(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () => _load(
                  force: true,
                ),
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior
                          .onDrag,
                  physics:
                      const AlwaysScrollableScrollPhysics(
                    parent:
                        BouncingScrollPhysics(),
                  ),
                  padding:
                      const EdgeInsets.fromLTRB(
                    16,
                    14,
                    16,
                    126,
                  ),
                  children: [
                    const _ProfileIntroPanel(),

                    const SizedBox(height: 14),

                    if (_loading &&
                        profile == null)
                      const LoadingList(
                        count: 4,
                      )
                    else if (_error != null &&
                        profile == null)
                      EmptyState(
                        icon: Icons
                            .person_off_outlined,
                        title:
                            'Profile unavailable',
                        message:
                            _error.toString(),
                        action:
                            FilledButton.icon(
                          onPressed: () {
                            _load(
                              force: true,
                            );
                          },
                          icon: const Icon(
                            Icons.refresh_rounded,
                            size: 18,
                          ),
                          label: const Text(
                            'Try again',
                          ),
                        ),
                      )
                    else if (profile != null) ...[
                      _ProfileIdentityCard(
                        profile: profile,
                        isAdmin: _isAdmin,
                        avatarUrl: _mediaUrl(
                          '${profile['avatarUrl'] ?? ''}',
                        ),
                        uploading:
                            _uploadingAvatar,
                        onChangePhoto:
                            _pickAndUploadAvatar,
                        onRemovePhoto:
                            '${profile['avatarUrl'] ?? ''}'
                                    .trim()
                                    .isEmpty
                                ? null
                                : _removeAvatar,
                      ),

                      const SizedBox(
                        height: 14,
                      ),

                      _ProfileDetailsCard(
                        nameController:
                            _name,
                        isAdmin: _isAdmin,
                        userType:
                            _userType,
                        userTypeLabel:
                            _userTypes[
                                    _userType] ??
                                'Other',
                        saving: _saving,
                        onPickUserType:
                            _openUserTypePicker,
                        onSave:
                            _saveProfile,
                      ),

                      const SizedBox(
                        height: 14,
                      ),

                      VoxCard(
                        padding:
                            EdgeInsets.zero,
                        radius: 24,
                        child: Column(
                          children: [
                            const Padding(
                              padding:
                                  EdgeInsets
                                      .fromLTRB(
                                16,
                                15,
                                16,
                                10,
                              ),
                              child:
                                  _ElegantSectionHeader(
                                icon: Icons
                                    .shield_outlined,
                                eyebrow:
                                    'SECURITY',
                                title:
                                    'Sign-in & recovery',
                                subtitle:
                                    'Protect your account credentials without clutter.',
                              ),
                            ),
                            const Divider(
                              height: 1,
                            ),
                            FeatureTile(
                              icon: Icons
                                  .alternate_email_rounded,
                              title:
                                  'Email address',
                              subtitle:
                                  'Change your email using two-step verification.',
                              trailing:
                                  const _MiniActionLabel(
                                label:
                                    'Change',
                              ),
                              onTap:
                                  _openEmailChange,
                            ),
                            const Divider(
                              height: 1,
                            ),
                            FeatureTile(
                              icon: Icons
                                  .lock_outline_rounded,
                              title:
                                  'Password',
                              subtitle:
                                  'Update your password using your current credentials.',
                              trailing:
                                  const _MiniActionLabel(
                                label:
                                    'Update',
                              ),
                              onTap:
                                  _openPasswordChange,
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(
                        height: 16,
                      ),

                      _SessionsHeader(
                        count:
                            _sessions.length,
                        groupCount:
                            _sessionGroups
                                .length,
                        onRevokeAll:
                            _sessions.isEmpty
                                ? null
                                : _revokeAll,
                      ),

                      const SizedBox(
                        height: 10,
                      ),

                      if (_sessions.isEmpty)
                        const InlineNotice(
                          icon: Icons
                              .devices_outlined,
                          title:
                              'No additional sessions',
                          message:
                              'No other active sessions were returned for this account.',
                        )
                      else
                        ..._sessionGroups.map(
                          (group) =>
                              Padding(
                            padding:
                                const EdgeInsets
                                    .only(
                              bottom: 9,
                            ),
                            child:
                                _GroupedSessionCard(
                              group:
                                  group,
                              onRevoke:
                                  () {
                                _revokeSessionGroup(
                                  group,
                                );
                              },
                            ),
                          ),
                        ),

                      const SizedBox(
                        height: 7,
                      ),

                      Container(
                        padding:
                            const EdgeInsets
                                .fromLTRB(
                          14,
                          13,
                          12,
                          13,
                        ),
                        decoration:
                            BoxDecoration(
                          gradient:
                              LinearGradient(
                            begin:
                                Alignment
                                    .topLeft,
                            end:
                                Alignment
                                    .bottomRight,
                            colors: [
                              AppColors
                                  .surfaceRose
                                  .withValues(
                                alpha: .90,
                              ),
                              Colors.white
                                  .withValues(
                                alpha: .94,
                              ),
                            ],
                          ),
                          borderRadius:
                              BorderRadius
                                  .circular(
                            22,
                          ),
                          border:
                              Border.all(
                            color: AppColors
                                .pink
                                .withValues(
                              alpha: .14,
                            ),
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 38,
                              height: 38,
                              decoration:
                                  BoxDecoration(
                                color: Colors
                                    .white
                                    .withValues(
                                  alpha: .82,
                                ),
                                borderRadius:
                                    BorderRadius
                                        .circular(
                                  13,
                                ),
                                border:
                                    Border.all(
                                  color:
                                      AppColors
                                          .pink
                                          .withValues(
                                    alpha:
                                        .12,
                                  ),
                                ),
                              ),
                              child:
                                  const Icon(
                                Icons
                                    .delete_outline_rounded,
                                size: 18,
                                color:
                                    AppColors
                                        .danger,
                              ),
                            ),
                            const SizedBox(
                              width: 10,
                            ),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,
                                children: [
                                  Text(
                                    'Delete account',
                                    style:
                                        TextStyle(
                                      color:
                                          AppColors
                                              .textPrimary,
                                      fontSize:
                                          11.2,
                                      fontWeight:
                                          FontWeight
                                              .w900,
                                    ),
                                  ),
                                  SizedBox(
                                    height: 3,
                                  ),
                                  Text(
                                    'Permanent and protected by your password.',
                                    style:
                                        TextStyle(
                                      color:
                                          AppColors
                                              .textMuted,
                                      fontSize:
                                          8.7,
                                      height:
                                          1.3,
                                      fontWeight:
                                          FontWeight
                                              .w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed:
                                  _deleteAccount,
                              style:
                                  TextButton
                                      .styleFrom(
                                foregroundColor:
                                    AppColors
                                        .danger,
                              ),
                              child:
                                  const Text(
                                'Delete',
                              ),
                            ),
                          ],
                        ),
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

  String _mediaUrl(
    String value,
  ) {
    final trimmed =
        value.trim();

    if (trimmed.isEmpty) {
      return '';
    }

    final uri =
        Uri.tryParse(trimmed);

    if (uri != null &&
        uri.hasScheme) {
      return trimmed;
    }

    return '${ApiConfig.baseUrl}${trimmed.startsWith('/') ? '' : '/'}$trimmed';
  }
}

class _ProfileRouteHeader
    extends StatelessWidget {
  const _ProfileRouteHeader({
    required this.onBack,
  });

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final returnTitle = workspaceReturnTarget(context).title;

    return Material(
      color: AppColors.surface.withValues(
        alpha: .985,
      ),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding:
              const EdgeInsets.fromLTRB(
            14,
            6,
            18,
            10,
          ),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.border
                    .withValues(
                  alpha: .65,
                ),
              ),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep
                    .withValues(
                  alpha: .025,
                ),
                blurRadius: 14,
                offset:
                    const Offset(
                  0,
                  5,
                ),
              ),
            ],
          ),
          child: Row(
            children: [
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onBack,
                  borderRadius:
                      BorderRadius.circular(
                    14,
                  ),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons
                            .arrow_back_rounded,
                        size: 26,
                        color:
                            AppColors
                                .primaryDark,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(
                width: 5,
              ),
              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior:
                      HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize:
                        MainAxisSize.min,
                    crossAxisAlignment:
                        CrossAxisAlignment
                            .start,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors
                              .primaryDeep,
                          fontSize: 18.5,
                          height: 1.08,
                          fontWeight:
                              FontWeight.w900,
                          letterSpacing:
                              -.28,
                        ),
                      ),
                      SizedBox(
                        height: 3,
                      ),
                      Text(
                        'Profile & security',
                        style: TextStyle(
                          color: AppColors
                              .textMuted,
                          fontSize: 9.6,
                          height: 1.1,
                          fontWeight:
                              FontWeight.w700,
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

class _ProfileIntroPanel
    extends StatelessWidget {
  const _ProfileIntroPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius:
            BorderRadius.circular(24),
        border: Border.all(
          color: AppColors.primary
              .withValues(
            alpha: .12,
          ),
        ),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFEFD),
            Color(0xFFF5FBF9),
            Color(0xFFFFFAFB),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep
                .withValues(
              alpha: .045,
            ),
            blurRadius: 24,
            offset: const Offset(
              0,
              9,
            ),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            top: -54,
            right: -42,
            child: Container(
              width: 138,
              height: 138,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary
                    .withValues(
                  alpha: .055,
                ),
              ),
            ),
          ),
          Positioned(
            left: -34,
            bottom: -62,
            child: Container(
              width: 112,
              height: 112,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink
                    .withValues(
                  alpha: .035,
                ),
              ),
            ),
          ),
          Padding(
            padding:
                const EdgeInsets.fromLTRB(
              16,
              14,
              14,
              14,
            ),
            child: Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: Colors.white
                        .withValues(
                      alpha: .82,
                    ),
                    borderRadius:
                        BorderRadius.circular(
                      16,
                    ),
                    border: Border.all(
                      color: AppColors.primary
                          .withValues(
                        alpha: .12,
                      ),
                    ),
                  ),
                  child: Stack(
                    alignment:
                        Alignment.center,
                    children: [
                      const Icon(
                        Icons
                            .verified_user_outlined,
                        size: 21,
                        color:
                            AppColors
                                .primaryDark,
                      ),
                      Positioned(
                        top: 9,
                        right: 9,
                        child: Icon(
                          Icons
                              .auto_awesome_rounded,
                          size: 6.5,
                          color: AppColors
                              .pinkDeep,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(
                  width: 12,
                ),
                const Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment
                            .start,
                    children: [
                      Text(
                        'IDENTITY & SECURITY',
                        style: TextStyle(
                          color: AppColors
                              .primaryDark,
                          fontSize: 7.7,
                          fontWeight:
                              FontWeight.w900,
                          letterSpacing:
                              1.0,
                        ),
                      ),
                      SizedBox(
                        height: 4,
                      ),
                      Text(
                        'Your private account space',
                        style: TextStyle(
                          color: AppColors
                              .textPrimary,
                          fontSize: 15.8,
                          height: 1.08,
                          fontWeight:
                              FontWeight.w900,
                          letterSpacing:
                              -.24,
                        ),
                      ),
                      SizedBox(
                        height: 4,
                      ),
                      Text(
                        'Keep your identity, access and active sessions up to date.',
                        style: TextStyle(
                          color: AppColors
                              .textMuted,
                          fontSize: 8.8,
                          height: 1.35,
                          fontWeight:
                              FontWeight.w600,
                        ),
                      ),
                    ],
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

class _ProfileIdentityCard
    extends StatelessWidget {
  const _ProfileIdentityCard({
    required this.profile,
    required this.isAdmin,
    required this.avatarUrl,
    required this.uploading,
    required this.onChangePhoto,
    required this.onRemovePhoto,
  });

  final Map<String, dynamic> profile;
  final bool isAdmin;
  final String avatarUrl;
  final bool uploading;
  final VoidCallback onChangePhoto;
  final VoidCallback? onRemovePhoto;

  @override
  Widget build(BuildContext context) {
    final name =
        '${profile['fullName'] ?? 'Voxidence User'}';

    final email =
        '${profile['email'] ?? ''}';

    final isPremium =
        '${profile['accountStatus'] ?? 'NORMAL'}'
                .toUpperCase() ==
            'PREMIUM';

    return Container(
      padding:
          const EdgeInsets.fromLTRB(
        15,
        15,
        15,
        14,
      ),
      decoration: BoxDecoration(
        borderRadius:
            BorderRadius.circular(25),
        gradient:
            const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFFFF),
            Color(0xFFF8FCFA),
            Color(0xFFFFFBFC),
          ],
        ),
        border: Border.all(
          color: AppColors.border
              .withValues(
            alpha: .74,
          ),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep
                .withValues(
              alpha: .055,
            ),
            blurRadius: 28,
            offset:
                const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment:
                CrossAxisAlignment.center,
            children: [
              _ProfileAvatar(
                name: name,
                avatarUrl: avatarUrl,
                uploading: uploading,
                onTap: onChangePhoto,
              ),
              const SizedBox(
                width: 12,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment
                          .start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow:
                          TextOverflow
                              .ellipsis,
                      style:
                          const TextStyle(
                        color: AppColors
                            .textPrimary,
                        fontSize: 16.2,
                        height: 1.08,
                        fontWeight:
                            FontWeight
                                .w900,
                        letterSpacing:
                            -.24,
                      ),
                    ),
                    const SizedBox(
                      height: 4,
                    ),
                    Row(
                      children: [
                        const Icon(
                          Icons
                              .alternate_email_rounded,
                          size: 11,
                          color:
                              AppColors
                                  .textMuted,
                        ),
                        const SizedBox(
                          width: 4,
                        ),
                        Expanded(
                          child: Text(
                            email,
                            maxLines: 1,
                            overflow:
                                TextOverflow
                                    .ellipsis,
                            style:
                                const TextStyle(
                              color:
                                  AppColors
                                      .textMuted,
                              fontSize:
                                  9.2,
                              fontWeight:
                                  FontWeight
                                      .w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (!isAdmin) ...[
                      const SizedBox(
                        height: 7,
                      ),
                      AccountTierBadge(
                        isPremium:
                            isPremium,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 13,
          ),
          Container(
            height: 1,
            color: AppColors.border
                .withValues(
              alpha: .60,
            ),
          ),
          const SizedBox(
            height: 12,
          ),
          Row(
            children: [
              Expanded(
                child:
                    FilledButton.icon(
                  onPressed: uploading
                      ? null
                      : onChangePhoto,
                  style:
                      FilledButton
                          .styleFrom(
                    minimumSize:
                        const Size(
                      0,
                      43,
                    ),
                    padding:
                        const EdgeInsets
                            .symmetric(
                      vertical: 10,
                    ),
                    shape:
                        RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius
                              .circular(
                        15,
                      ),
                    ),
                  ),
                  icon: uploading
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child:
                              CircularProgressIndicator(
                            strokeWidth:
                                2,
                            color:
                                Colors
                                    .white,
                          ),
                        )
                      : const Icon(
                          Icons
                              .photo_camera_outlined,
                          size: 16,
                        ),
                  label: Text(
                    avatarUrl.isEmpty
                        ? 'Add photo'
                        : 'Change photo',
                  ),
                ),
              ),
              if (onRemovePhoto !=
                  null) ...[
                const SizedBox(
                  width: 8,
                ),
                OutlinedButton.icon(
                  onPressed: uploading
                      ? null
                      : onRemovePhoto,
                  style:
                      OutlinedButton
                          .styleFrom(
                    minimumSize:
                        const Size(
                      0,
                      43,
                    ),
                    padding:
                        const EdgeInsets
                            .symmetric(
                      horizontal: 13,
                      vertical: 10,
                    ),
                    shape:
                        RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius
                              .circular(
                        15,
                      ),
                    ),
                  ),
                  icon: const Icon(
                    Icons.close_rounded,
                    size: 15,
                  ),
                  label:
                      const Text(
                    'Remove',
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _ProfileDetailsCard
    extends StatelessWidget {
  const _ProfileDetailsCard({
    required this.nameController,
    required this.isAdmin,
    required this.userType,
    required this.userTypeLabel,
    required this.saving,
    required this.onPickUserType,
    required this.onSave,
  });

  final TextEditingController
      nameController;
  final bool isAdmin;

  final String userType;
  final String userTypeLabel;
  final bool saving;

  final VoidCallback onPickUserType;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding:
          const EdgeInsets.fromLTRB(
        15,
        15,
        15,
        14,
      ),
      decoration: BoxDecoration(
        borderRadius:
            BorderRadius.circular(25),
        gradient:
            const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFFFF),
            Color(0xFFF9FCFB),
            Color(0xFFFFFBFC),
          ],
        ),
        border: Border.all(
          color: AppColors.border
              .withValues(
            alpha: .78,
          ),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep
                .withValues(
              alpha: .045,
            ),
            blurRadius: 24,
            offset:
                const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          const _ElegantSectionHeader(
            icon:
                Icons.badge_outlined,
            eyebrow: 'PROFILE',
            title:
                'Profile details',
            subtitle:
                'Keep the information that represents you across Voxidence up to date.',
          ),
          const SizedBox(
            height: 15,
          ),
          TextField(
            controller:
                nameController,
            maxLength: 120,
            textInputAction:
                TextInputAction.done,
            decoration:
                InputDecoration(
              labelText:
                  'Full name',
              hintText:
                  'Your display name',
              counterText: '',
              prefixIcon:
                  const Icon(
                Icons
                    .person_outline_rounded,
              ),
              filled: true,
              fillColor:
                  Colors.white
                      .withValues(
                alpha: .78,
              ),
            ),
          ),
          if (!isAdmin) ...[
            const SizedBox(
              height: 10,
            ),
            _UserTypeSelector(
              value: userType,
              label:
                  userTypeLabel,
              onTap:
                  onPickUserType,
            ),
          ],
          const SizedBox(
            height: 11,
          ),
          Row(
            children: [
              Container(
                width: 26,
                height: 26,
                decoration:
                    BoxDecoration(
                  color: AppColors
                      .primarySoft
                      .withValues(
                    alpha: .74,
                  ),
                  shape:
                      BoxShape.circle,
                ),
                child: const Icon(
                  Icons.sync_rounded,
                  size: 13,
                  color: AppColors
                      .primaryDark,
                ),
              ),
              const SizedBox(
                width: 7,
              ),
              const Expanded(
                child: Text(
                  'Changes are synced securely across your workspace.',
                  style: TextStyle(
                    color: AppColors
                        .textMuted,
                    fontSize: 8.4,
                    height: 1.3,
                    fontWeight:
                        FontWeight
                            .w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 12,
          ),
          SizedBox(
            width: double.infinity,
            height: 45,
            child:
                FilledButton.icon(
              onPressed:
                  saving ? null : onSave,
              style:
                  FilledButton
                      .styleFrom(
                shape:
                    RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius
                          .circular(
                    15,
                  ),
                ),
              ),
              icon: saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child:
                          CircularProgressIndicator(
                        strokeWidth:
                            2,
                        color:
                            Colors.white,
                      ),
                    )
                  : const Icon(
                      Icons
                          .check_rounded,
                      size: 18,
                    ),
              label: Text(
                saving
                    ? 'Saving...'
                    : 'Save changes',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ElegantSectionHeader
    extends StatelessWidget {
  const _ElegantSectionHeader({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: AppColors
                .primarySoft
                .withValues(
              alpha: .84,
            ),
            borderRadius:
                BorderRadius.circular(
              13,
            ),
          ),
          child: Icon(
            icon,
            size: 18,
            color:
                AppColors.primaryDark,
          ),
        ),
        const SizedBox(
          width: 10,
        ),
        Expanded(
          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style:
                    const TextStyle(
                  color: AppColors
                      .primaryDark,
                  fontSize: 7.5,
                  fontWeight:
                      FontWeight.w900,
                  letterSpacing:
                      .95,
                ),
              ),
              const SizedBox(
                height: 3,
              ),
              Text(
                title,
                style:
                    const TextStyle(
                  color: AppColors
                      .textPrimary,
                  fontSize: 15.2,
                  height: 1.08,
                  fontWeight:
                      FontWeight.w900,
                  letterSpacing:
                      -.22,
                ),
              ),
              const SizedBox(
                height: 4,
              ),
              Text(
                subtitle,
                style:
                    const TextStyle(
                  color: AppColors
                      .textMuted,
                  fontSize: 8.7,
                  height: 1.35,
                  fontWeight:
                      FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _UserTypeSelector
    extends StatelessWidget {
  const _UserTypeSelector({
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
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        child: Ink(
          padding:
              const EdgeInsets.fromLTRB(
            12,
            10,
            11,
            10,
          ),
          decoration: BoxDecoration(
            color: Colors.white
                .withValues(
              alpha: .82,
            ),
            borderRadius:
                BorderRadius.circular(
              18,
            ),
            border: Border.all(
              color: AppColors.border
                  .withValues(
                alpha: .95,
              ),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration:
                    BoxDecoration(
                  color: AppColors
                      .primarySoft
                      .withValues(
                    alpha: .85,
                  ),
                  borderRadius:
                      BorderRadius
                          .circular(
                    13,
                  ),
                ),
                child: Icon(
                  _userTypeIcon(
                    value,
                  ),
                  size: 18,
                  color: AppColors
                      .primaryDark,
                ),
              ),
              const SizedBox(
                width: 11,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment
                          .start,
                  children: [
                    const Text(
                      'I use Voxidence as',
                      style:
                          TextStyle(
                        color:
                            AppColors
                                .textMuted,
                        fontSize:
                            8.4,
                        fontWeight:
                            FontWeight
                                .w700,
                      ),
                    ),
                    const SizedBox(
                      height: 3,
                    ),
                    Text(
                      label,
                      style:
                          const TextStyle(
                        color:
                            AppColors
                                .textPrimary,
                        fontSize:
                            12.2,
                        fontWeight:
                            FontWeight
                                .w900,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                width: 30,
                height: 30,
                decoration:
                    BoxDecoration(
                  color: AppColors
                      .primarySoft
                      .withValues(
                    alpha: .62,
                  ),
                  borderRadius:
                      BorderRadius
                          .circular(
                    10,
                  ),
                ),
                child: const Icon(
                  Icons
                      .expand_more_rounded,
                  size: 19,
                  color: AppColors
                      .primaryDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UserTypePickerSheet
    extends StatelessWidget {
  const _UserTypePickerSheet({
    required this.selectedValue,
    required this.options,
  });

  final String selectedValue;
  final Map<String, String> options;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration:
          const BoxDecoration(
        color: AppColors.surface,
        borderRadius:
            BorderRadius.vertical(
          top: Radius.circular(30),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding:
              const EdgeInsets.fromLTRB(
            16,
            10,
            16,
            16,
          ),
          child: Column(
            mainAxisSize:
                MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration:
                    BoxDecoration(
                  color: AppColors.silver
                      .withValues(
                    alpha: .75,
                  ),
                  borderRadius:
                      BorderRadius
                          .circular(
                    999,
                  ),
                ),
              ),
              const SizedBox(
                height: 16,
              ),
              Row(
                crossAxisAlignment:
                    CrossAxisAlignment
                        .start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration:
                        BoxDecoration(
                      color: AppColors
                          .primarySoft,
                      borderRadius:
                          BorderRadius
                              .circular(
                        15,
                      ),
                    ),
                    child: const Icon(
                      Icons
                          .work_outline_rounded,
                      size: 20,
                      color: AppColors
                          .primaryDark,
                    ),
                  ),
                  const SizedBox(
                    width: 11,
                  ),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Text(
                          'Choose your profile type',
                          style:
                              TextStyle(
                            color:
                                AppColors
                                    .textPrimary,
                            fontSize:
                                16.5,
                            fontWeight:
                                FontWeight
                                    .w900,
                            letterSpacing:
                                -.25,
                          ),
                        ),
                        SizedBox(
                          height: 4,
                        ),
                        Text(
                          'Pick the role that best describes how you use Voxidence.',
                          style:
                              TextStyle(
                            color:
                                AppColors
                                    .textMuted,
                            fontSize:
                                9.4,
                            height:
                                1.35,
                            fontWeight:
                                FontWeight
                                    .w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Material(
                    color: AppColors
                        .primarySoft
                        .withValues(
                      alpha: .55,
                    ),
                    borderRadius:
                        BorderRadius
                            .circular(
                      11,
                    ),
                    child: InkWell(
                      onTap: () {
                        Navigator.of(
                          context,
                        ).pop();
                      },
                      borderRadius:
                          BorderRadius
                              .circular(
                        11,
                      ),
                      child:
                          const SizedBox(
                        width: 32,
                        height: 32,
                        child: Icon(
                          Icons
                              .close_rounded,
                          size: 17,
                          color: AppColors
                              .primaryDark,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(
                height: 14,
              ),
              ...options.entries.map(
                (entry) => Padding(
                  padding:
                      const EdgeInsets
                          .only(
                    bottom: 8,
                  ),
                  child:
                      _UserTypeOptionTile(
                    value: entry.key,
                    label:
                        entry.value,
                    selected:
                        entry.key ==
                            selectedValue,
                    onTap: () {
                      Navigator.of(
                        context,
                      ).pop(
                        entry.key,
                      );
                    },
                  ),
                ),
              ),
              const SizedBox(
                height: 2,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UserTypeOptionTile
    extends StatelessWidget {
  const _UserTypeOptionTile({
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
    final accent = selected
        ? AppColors.primaryDark
        : AppColors.textSecondary;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        child:
            AnimatedContainer(
          duration:
              const Duration(
            milliseconds: 180,
          ),
          padding:
              const EdgeInsets.fromLTRB(
            11,
            9,
            11,
            9,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft
                    .withValues(
                    alpha: .72,
                  )
                : Colors.white
                    .withValues(
                    alpha: .82,
                  ),
            borderRadius:
                BorderRadius.circular(
              18,
            ),
            border: Border.all(
              color: selected
                  ? AppColors.primary
                      .withValues(
                      alpha: .28,
                    )
                  : AppColors.border
                      .withValues(
                      alpha: .82,
                    ),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 39,
                height: 39,
                decoration:
                    BoxDecoration(
                  color: selected
                      ? Colors.white
                          .withValues(
                          alpha: .86,
                        )
                      : AppColors
                          .primarySoft
                          .withValues(
                          alpha: .55,
                        ),
                  borderRadius:
                      BorderRadius
                          .circular(
                    13,
                  ),
                ),
                child: Icon(
                  _userTypeIcon(
                    value,
                  ),
                  size: 18,
                  color: accent,
                ),
              ),
              const SizedBox(
                width: 11,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment
                          .start,
                  children: [
                    Text(
                      label,
                      style:
                          TextStyle(
                        color: selected
                            ? AppColors
                                .primaryDeep
                            : AppColors
                                .textPrimary,
                        fontSize:
                            11.5,
                        fontWeight:
                            FontWeight
                                .w900,
                      ),
                    ),
                    const SizedBox(
                      height: 2,
                    ),
                    Text(
                      _userTypeSubtitle(
                        value,
                      ),
                      maxLines: 1,
                      overflow:
                          TextOverflow
                              .ellipsis,
                      style:
                          const TextStyle(
                        color:
                            AppColors
                                .textMuted,
                        fontSize:
                            8.4,
                        fontWeight:
                            FontWeight
                                .w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(
                width: 8,
              ),
              AnimatedContainer(
                duration:
                    const Duration(
                  milliseconds: 180,
                ),
                width: 28,
                height: 28,
                decoration:
                    BoxDecoration(
                  color: selected
                      ? AppColors.primary
                      : Colors
                          .transparent,
                  shape:
                      BoxShape.circle,
                  border: Border.all(
                    color: selected
                        ? AppColors
                            .primary
                        : AppColors
                            .silver
                            .withValues(
                            alpha:
                                .75,
                          ),
                  ),
                ),
                child: Icon(
                  selected
                      ? Icons
                          .check_rounded
                      : Icons
                          .arrow_forward_rounded,
                  size: 15,
                  color: selected
                      ? Colors.white
                      : AppColors
                          .textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

IconData _userTypeIcon(
  String value,
) {
  switch (value) {
    case 'STUDENT':
      return Icons.school_outlined;

    case 'DEVELOPER':
      return Icons.code_rounded;

    case 'RESEARCHER':
      return Icons.science_outlined;

    case 'COMPANY':
      return Icons.apartment_rounded;

    default:
      return Icons.person_outline_rounded;
  }
}

String _userTypeSubtitle(
  String value,
) {
  switch (value) {
    case 'STUDENT':
      return 'Learning, projects and academic exploration';

    case 'DEVELOPER':
      return 'Building products, systems and software';

    case 'RESEARCHER':
      return 'Evidence, studies and structured discovery';

    case 'COMPANY':
      return 'Teams, products and business innovation';

    default:
      return 'A flexible personal workspace';
  }
}

class _MiniActionLabel
    extends StatelessWidget {
  const _MiniActionLabel({
    required this.label,
  });

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: AppColors.primarySoft
            .withValues(
          alpha: .82,
        ),
        borderRadius:
            BorderRadius.circular(
          999,
        ),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color:
              AppColors.primaryDark,
          fontSize: 7.6,
          fontWeight:
              FontWeight.w900,
        ),
      ),
    );
  }
}

class _SessionGroup {
  const _SessionGroup({
    required this.deviceLabel,
    required this.ipAddress,
    required this.sessions,
    required this.latest,
  });

  factory _SessionGroup.fromSessions(
    List<Map<String, dynamic>>
        sessions,
  ) {
    final safeSessions =
        List<Map<String, dynamic>>
            .from(
      sessions,
    );

    safeSessions.sort((a, b) {
      final aDate =
          DateTime.tryParse(
        '${a['lastUsedAt'] ?? ''}',
      );

      final bDate =
          DateTime.tryParse(
        '${b['lastUsedAt'] ?? ''}',
      );

      if (aDate == null &&
          bDate == null) {
        return 0;
      }

      if (aDate == null) {
        return 1;
      }

      if (bDate == null) {
        return -1;
      }

      return bDate.compareTo(
        aDate,
      );
    });

    final latest =
        safeSessions.isEmpty
            ? <String, dynamic>{}
            : safeSessions.first;

    return _SessionGroup(
      deviceLabel:
          '${latest['deviceLabel'] ?? 'Unknown device'}',
      ipAddress:
          '${latest['ipAddress'] ?? 'IP unavailable'}',
      sessions: safeSessions,
      latest: latest,
    );
  }

  final String deviceLabel;
  final String ipAddress;

  final List<Map<String, dynamic>>
      sessions;

  final Map<String, dynamic>
      latest;

  int get count =>
      sessions.length;
}

class _GroupedSessionCard
    extends StatelessWidget {
  const _GroupedSessionCard({
    required this.group,
    required this.onRevoke,
  });

  final _SessionGroup group;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final count = group.count;

    return VoxCard(
      radius: 21,
      padding:
          const EdgeInsets.fromLTRB(
        12,
        11,
        8,
        11,
      ),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              const SoftIconBadge(
                icon:
                    Icons.devices_outlined,
                size: 40,
              ),
              if (count > 1)
                Positioned(
                  right: -5,
                  top: -5,
                  child: Container(
                    constraints:
                        const BoxConstraints(
                      minWidth: 20,
                    ),
                    height: 20,
                    padding:
                        const EdgeInsets
                            .symmetric(
                      horizontal: 5,
                    ),
                    alignment:
                        Alignment.center,
                    decoration:
                        BoxDecoration(
                      color:
                          AppColors
                              .primary,
                      borderRadius:
                          BorderRadius
                              .circular(
                        999,
                      ),
                      border:
                          Border.all(
                        color:
                            Colors.white,
                        width: 1.5,
                      ),
                    ),
                    child: Text(
                      count > 99
                          ? '99+'
                          : '$count',
                      style:
                          const TextStyle(
                        color:
                            Colors.white,
                        fontSize:
                            7.5,
                        fontWeight:
                            FontWeight
                                .w900,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(
            width: 11,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment
                      .start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        group
                            .deviceLabel,
                        maxLines: 1,
                        overflow:
                            TextOverflow
                                .ellipsis,
                        style:
                            const TextStyle(
                          color:
                              AppColors
                                  .textPrimary,
                          fontSize:
                              11.4,
                          fontWeight:
                              FontWeight
                                  .w900,
                        ),
                      ),
                    ),
                    if (count > 1)
                      Container(
                        padding:
                            const EdgeInsets
                                .symmetric(
                          horizontal: 7,
                          vertical: 4,
                        ),
                        decoration:
                            BoxDecoration(
                          color:
                              AppColors
                                  .primarySoft,
                          borderRadius:
                              BorderRadius
                                  .circular(
                            999,
                          ),
                        ),
                        child: Text(
                          '$count sessions',
                          style:
                              const TextStyle(
                            color:
                                AppColors
                                    .primaryDark,
                            fontSize:
                                7.4,
                            fontWeight:
                                FontWeight
                                    .w900,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(
                  height: 4,
                ),
                Text(
                  '${group.ipAddress} · last used ${_sessionDate(group.latest['lastUsedAt'])}',
                  maxLines: 2,
                  overflow:
                      TextOverflow
                          .ellipsis,
                  style:
                      const TextStyle(
                    color:
                        AppColors
                            .textMuted,
                    fontSize: 8.7,
                    height: 1.3,
                    fontWeight:
                        FontWeight
                            .w600,
                  ),
                ),
                if (count > 1) ...[
                  const SizedBox(
                    height: 5,
                  ),
                  const Row(
                    children: [
                      Icon(
                        Icons
                            .layers_outlined,
                        size: 11,
                        color: AppColors
                            .primaryDark,
                      ),
                      SizedBox(
                        width: 4,
                      ),
                      Text(
                        'Matching sessions grouped together',
                        style:
                            TextStyle(
                          color:
                              AppColors
                                  .primaryDark,
                          fontSize:
                              7.5,
                          fontWeight:
                              FontWeight
                                  .w700,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(
            width: 4,
          ),
          IconButton(
            tooltip: count > 1
                ? 'Revoke matching sessions'
                : 'Revoke session',
            onPressed: onRevoke,
            icon: const Icon(
              Icons.logout_rounded,
              size: 17,
              color:
                  AppColors.danger,
            ),
          ),
        ],
      ),
    );
  }
}

class _SessionsHeader
    extends StatelessWidget {
  const _SessionsHeader({
    required this.count,
    required this.groupCount,
    required this.onRevokeAll,
  });

  final int count;
  final int groupCount;
  final VoidCallback? onRevokeAll;

  @override
  Widget build(BuildContext context) {
    final grouped =
        count > groupCount;

    return Row(
      crossAxisAlignment:
          CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              const Text(
                'SESSIONS',
                style:
                    TextStyle(
                  color: AppColors
                      .primaryDark,
                  fontSize: 7.7,
                  fontWeight:
                      FontWeight.w900,
                  letterSpacing:
                      1.0,
                ),
              ),
              const SizedBox(
                height: 4,
              ),
              const Text(
                'Active sessions',
                style:
                    TextStyle(
                  color: AppColors
                      .textPrimary,
                  fontSize: 16.2,
                  fontWeight:
                      FontWeight.w900,
                  letterSpacing:
                      -.25,
                ),
              ),
              const SizedBox(
                height: 3,
              ),
              Text(
                grouped
                    ? '$count sessions grouped into $groupCount matching device${groupCount == 1 ? '' : 's'}'
                    : '$count active session${count == 1 ? '' : 's'}',
                style:
                    const TextStyle(
                  color: AppColors
                      .textMuted,
                  fontSize: 8.8,
                  fontWeight:
                      FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        if (onRevokeAll != null)
          TextButton.icon(
            onPressed:
                onRevokeAll,
            icon: const Icon(
              Icons.logout_rounded,
              size: 14,
            ),
            label: const Text(
              'Revoke all',
            ),
          ),
      ],
    );
  }
}

class _ProfileAvatar
    extends StatelessWidget {
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
        .split(
          RegExp(r'\s+'),
        )
        .where(
          (part) =>
              part.isNotEmpty,
        )
        .toList();

    final initials =
        parts.isEmpty
            ? 'V'
            : parts.length == 1
                ? parts.first
                    .substring(
                      0,
                      1,
                    )
                    .toUpperCase()
                : '${parts.first[0]}${parts.last[0]}'
                    .toUpperCase();

    return Semantics(
      button: true,
      label: avatarUrl.isEmpty
          ? 'Add profile photo'
          : 'Change profile photo',
      child: InkWell(
        borderRadius:
            BorderRadius.circular(
          99,
        ),
        onTap:
            uploading ? null : onTap,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 62,
              height: 62,
              clipBehavior:
                  Clip.antiAlias,
              alignment:
                  Alignment.center,
              decoration:
                  const BoxDecoration(
                gradient:
                    LinearGradient(
                  colors: [
                    AppColors.primary,
                    Color(
                      0xFF4FA9A4,
                    ),
                  ],
                ),
                shape:
                    BoxShape.circle,
              ),
              child: avatarUrl.isEmpty
                  ? Text(
                      initials,
                      style:
                          const TextStyle(
                        color:
                            Colors.white,
                        fontSize: 17,
                        fontWeight:
                            FontWeight
                                .w900,
                      ),
                    )
                  : Image.network(
                      avatarUrl,
                      width: 62,
                      height: 62,
                      fit: BoxFit.cover,
                      errorBuilder:
                          (
                        _,
                        _,
                        _,
                      ) {
                        return Text(
                          initials,
                          style:
                              const TextStyle(
                            color:
                                Colors.white,
                            fontSize:
                                17,
                            fontWeight:
                                FontWeight
                                    .w900,
                          ),
                        );
                      },
                    ),
            ),
            Positioned(
              right: -2,
              bottom: -2,
              child: Container(
                width: 25,
                height: 25,
                alignment:
                    Alignment.center,
                decoration:
                    BoxDecoration(
                  color: Colors.white,
                  shape:
                      BoxShape.circle,
                  border: Border.all(
                    color: AppColors
                        .border,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors
                          .primaryDeep
                          .withValues(
                        alpha: .12,
                      ),
                      blurRadius: 8,
                      offset:
                          const Offset(
                        0,
                        3,
                      ),
                    ),
                  ],
                ),
                child: uploading
                    ? const SizedBox(
                        width: 12,
                        height: 12,
                        child:
                            CircularProgressIndicator(
                          strokeWidth:
                              1.7,
                        ),
                      )
                    : const Icon(
                        Icons
                            .camera_alt_outlined,
                        color:
                            AppColors
                                .primaryDark,
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
  State<_PasswordChangeSheet> createState() =>
      _PasswordChangeSheetState();
}

class _PasswordChangeSheetState extends State<_PasswordChangeSheet> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();

  bool _saving = false;
  bool _obscureCurrent = true;
  bool _obscureNext = true;
  bool _obscureConfirm = true;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final current = _current.text;
    final next = _next.text.trim();
    final confirm = _confirm.text.trim();

    if (current.trim().isEmpty) {
      showAppSnackBar(
        context,
        'Enter your current password.',
        error: true,
      );
      return;
    }

    final valid =
        next.length >= 6 &&
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

    if (next != confirm) {
      showAppSnackBar(
        context,
        'Passwords do not match.',
        error: true,
      );
      return;
    }

    setState(() => _saving = true);

    try {
      await UserApi.instance.changePassword(
        currentPassword: current,
        newPassword: next,
      );

      if (!mounted) return;

      showAppSnackBar(
        context,
        'Password changed successfully.',
      );

      Navigator.pop(context);
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .72,
      minChildSize: .54,
      maxChildSize: .92,
      builder: (context, controller) {
        return _SecuritySheetFrame(
          scrollController: controller,
          icon: Icons.lock_reset_rounded,
          eyebrow: 'SECURITY',
          title: 'Change password',
          subtitle:
              'Create a strong password you do not use anywhere else.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _SecurityHintCard(
                icon: Icons.shield_outlined,
                title: 'Password requirements',
                message:
                    'Use at least 6 characters with one letter and one number.',
              ),
              const SizedBox(height: 14),
              _SecureTextField(
                controller: _current,
                label: 'Current password',
                hint: 'Enter your current password',
                prefixIcon: Icons.lock_outline_rounded,
                obscureText: _obscureCurrent,
                textInputAction: TextInputAction.next,
                onToggleVisibility: () {
                  setState(() {
                    _obscureCurrent = !_obscureCurrent;
                  });
                },
              ),
              const SizedBox(height: 10),
              _SecureTextField(
                controller: _next,
                label: 'New password',
                hint: 'Create a new password',
                prefixIcon: Icons.password_rounded,
                obscureText: _obscureNext,
                textInputAction: TextInputAction.next,
                onToggleVisibility: () {
                  setState(() {
                    _obscureNext = !_obscureNext;
                  });
                },
              ),
              const SizedBox(height: 10),
              _SecureTextField(
                controller: _confirm,
                label: 'Confirm new password',
                hint: 'Re-enter your new password',
                prefixIcon: Icons.verified_user_outlined,
                obscureText: _obscureConfirm,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) {
                  if (!_saving) {
                    _save();
                  }
                },
                onToggleVisibility: () {
                  setState(() {
                    _obscureConfirm = !_obscureConfirm;
                  });
                },
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  style: FilledButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                  icon: _saving
                      ? const SizedBox(
                          width: 17,
                          height: 17,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.check_rounded,
                          size: 19,
                        ),
                  label: Text(
                    _saving
                        ? 'Changing password...'
                        : 'Change password',
                  ),
                ),
              ),
              const SizedBox(height: 10),
              const Center(
                child: Text(
                  'Your active sessions remain protected by your account security.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.5,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EmailChangeSheet extends StatefulWidget {
  const _EmailChangeSheet({
    required this.currentEmail,
  });

  final String currentEmail;

  @override
  State<_EmailChangeSheet> createState() =>
      _EmailChangeSheetState();
}

class _EmailChangeSheetState extends State<_EmailChangeSheet> {
  final _newEmail = TextEditingController();
  final _password = TextEditingController();
  final _currentCode = TextEditingController();
  final _newCode = TextEditingController();

  int _step = 0;
  bool _busy = false;
  bool _obscurePassword = true;

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

    if (!RegExp(
      r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
    ).hasMatch(email)) {
      showAppSnackBar(
        context,
        'Enter a valid new email address.',
        error: true,
      );
      return;
    }

    if (_password.text.length < 6) {
      showAppSnackBar(
        context,
        'Enter your current password.',
        error: true,
      );
      return;
    }

    await _run(
      () async {
        await UserApi.instance.requestEmailChange(
          newEmail: email,
          currentPassword: _password.text,
        );

        if (mounted) {
          setState(() => _step = 1);
        }
      },
      'A verification code was sent to your current email.',
    );
  }

  Future<void> _verifyCurrent() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_currentCode.text.trim())) {
      showAppSnackBar(
        context,
        'Enter the 6-digit code.',
        error: true,
      );
      return;
    }

    await _run(
      () async {
        await UserApi.instance.verifyCurrentEmailChange(
          _currentCode.text.trim(),
        );

        if (mounted) {
          setState(() => _step = 2);
        }
      },
      'Current email verified. A new code was sent to the new address.',
    );
  }

  Future<void> _verifyNew() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_newCode.text.trim())) {
      showAppSnackBar(
        context,
        'Enter the 6-digit code.',
        error: true,
      );
      return;
    }

    await _run(
      () async {
        await UserApi.instance.verifyNewEmailChange(
          _newCode.text.trim(),
        );

        if (!mounted) return;

        Navigator.pop(context, true);
      },
      'Email address changed successfully.',
    );
  }

  Future<void> _cancel() async {
    try {
      await UserApi.instance.cancelEmailChange();
    } catch (_) {
      // Closing the sheet remains safe when no request is active.
    }

    if (mounted) {
      Navigator.pop(context, false);
    }
  }

  Future<void> _run(
    Future<void> Function() work,
    String success,
  ) async {
    if (_busy) return;

    setState(() => _busy = true);

    try {
      await work();

      if (mounted) {
        showAppSnackBar(
          context,
          success,
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
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .75,
      minChildSize: .56,
      maxChildSize: .93,
      builder: (context, controller) {
        return _SecuritySheetFrame(
          scrollController: controller,
          icon: Icons.mark_email_unread_outlined,
          eyebrow: 'VERIFIED CHANGE',
          title: 'Change email',
          subtitle: _step == 0
              ? 'Confirm your identity before moving to a new email address.'
              : _step == 1
                  ? 'Verify your current email before we contact the new one.'
                  : 'One final verification secures your new email address.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _EmailProgressHeader(
                step: _step,
                currentEmail: widget.currentEmail,
                newEmail: _newEmail.text.trim(),
              ),
              const SizedBox(height: 14),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 220),
                child: _step == 0
                    ? Column(
                        key: const ValueKey('email-step-0'),
                        children: [
                          _SecureTextField(
                            controller: _newEmail,
                            label: 'New email',
                            hint: 'name@example.com',
                            prefixIcon: Icons.alternate_email_rounded,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            showVisibilityButton: false,
                          ),
                          const SizedBox(height: 10),
                          _SecureTextField(
                            controller: _password,
                            label: 'Current password',
                            hint: 'Confirm your password',
                            prefixIcon: Icons.lock_outline_rounded,
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            onSubmitted: (_) {
                              if (!_busy) {
                                _request();
                              }
                            },
                            onToggleVisibility: () {
                              setState(() {
                                _obscurePassword = !_obscurePassword;
                              });
                            },
                          ),
                          const SizedBox(height: 15),
                          SizedBox(
                            width: double.infinity,
                            height: 50,
                            child: FilledButton.icon(
                              onPressed: _busy ? null : _request,
                              style: FilledButton.styleFrom(
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(17),
                                ),
                              ),
                              icon: _busy
                                  ? const SizedBox(
                                      width: 17,
                                      height: 17,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.arrow_forward_rounded,
                                      size: 19,
                                    ),
                              label: Text(
                                _busy
                                    ? 'Sending code...'
                                    : 'Continue securely',
                              ),
                            ),
                          ),
                        ],
                      )
                    : _step == 1
                        ? Column(
                            key: const ValueKey('email-step-1'),
                            children: [
                              const _SecurityHintCard(
                                icon: Icons.mark_email_read_outlined,
                                title: 'Check your current inbox',
                                message:
                                    'Enter the 6-digit code sent to your current email address.',
                              ),
                              const SizedBox(height: 12),
                              _VerificationCodeField(
                                controller: _currentCode,
                                label: 'Current email code',
                                onSubmitted: (_) {
                                  if (!_busy) {
                                    _verifyCurrent();
                                  }
                                },
                              ),
                              const SizedBox(height: 15),
                              SizedBox(
                                width: double.infinity,
                                height: 50,
                                child: FilledButton.icon(
                                  onPressed:
                                      _busy ? null : _verifyCurrent,
                                  style: FilledButton.styleFrom(
                                    shape: RoundedRectangleBorder(
                                      borderRadius:
                                          BorderRadius.circular(17),
                                    ),
                                  ),
                                  icon: _busy
                                      ? const SizedBox(
                                          width: 17,
                                          height: 17,
                                          child:
                                              CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Icon(
                                          Icons.verified_outlined,
                                          size: 19,
                                        ),
                                  label: Text(
                                    _busy
                                        ? 'Verifying...'
                                        : 'Verify current email',
                                  ),
                                ),
                              ),
                            ],
                          )
                        : Column(
                            key: const ValueKey('email-step-2'),
                            children: [
                              const _SecurityHintCard(
                                icon: Icons.outgoing_mail,
                                title: 'Verify your new inbox',
                                message:
                                    'Enter the 6-digit code sent to your new email address.',
                              ),
                              const SizedBox(height: 12),
                              _VerificationCodeField(
                                controller: _newCode,
                                label: 'New email code',
                                onSubmitted: (_) {
                                  if (!_busy) {
                                    _verifyNew();
                                  }
                                },
                              ),
                              const SizedBox(height: 15),
                              SizedBox(
                                width: double.infinity,
                                height: 50,
                                child: FilledButton.icon(
                                  onPressed: _busy ? null : _verifyNew,
                                  style: FilledButton.styleFrom(
                                    shape: RoundedRectangleBorder(
                                      borderRadius:
                                          BorderRadius.circular(17),
                                    ),
                                  ),
                                  icon: _busy
                                      ? const SizedBox(
                                          width: 17,
                                          height: 17,
                                          child:
                                              CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Icon(
                                          Icons.check_circle_outline_rounded,
                                          size: 19,
                                        ),
                                  label: Text(
                                    _busy
                                        ? 'Finishing...'
                                        : 'Confirm new email',
                                  ),
                                ),
                              ),
                            ],
                          ),
              ),
              const SizedBox(height: 9),
              Center(
                child: TextButton.icon(
                  onPressed: _busy ? null : _cancel,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primaryDark,
                  ),
                  icon: const Icon(
                    Icons.close_rounded,
                    size: 15,
                  ),
                  label: const Text(
                    'Cancel email change',
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SecuritySheetFrame extends StatelessWidget {
  const _SecuritySheetFrame({
    required this.scrollController,
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final ScrollController scrollController;
  final IconData icon;
  final String eyebrow;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(30),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .13),
            blurRadius: 36,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: ListView(
        controller: scrollController,
        keyboardDismissBehavior:
            ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(
          16,
          10,
          16,
          24 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        children: [
          Center(
            child: Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.silver.withValues(alpha: .82),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 15),
          Container(
            padding: const EdgeInsets.fromLTRB(14, 14, 11, 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFF4FBF9),
                  Color(0xFFFFFEFD),
                  Color(0xFFFFF8FA),
                ],
              ),
              border: Border.all(
                color: AppColors.primary.withValues(alpha: .13),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Icon(
                    icon,
                    size: 21,
                    color: AppColors.primaryDark,
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
                          fontSize: 7.7,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.05,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        title,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 19,
                          height: 1.05,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.34,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.2,
                          height: 1.35,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                Material(
                  color: Colors.white.withValues(alpha: .78),
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    onTap: () => Navigator.of(context).pop(),
                    borderRadius: BorderRadius.circular(12),
                    child: const SizedBox(
                      width: 34,
                      height: 34,
                      child: Icon(
                        Icons.close_rounded,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _SecurityHintCard extends StatelessWidget {
  const _SecurityHintCard({
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
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .50),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .10),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .80),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              icon,
              size: 15,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.3,
                    height: 1.35,
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

class _SecureTextField extends StatelessWidget {
  const _SecureTextField({
    required this.controller,
    required this.label,
    required this.hint,
    required this.prefixIcon,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
    this.onToggleVisibility,
    this.showVisibilityButton = true,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData prefixIcon;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onToggleVisibility;
  final bool showVisibilityButton;

  @override
  Widget build(BuildContext context) {
    final shouldShowToggle =
        showVisibilityButton && onToggleVisibility != null;

    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      enableSuggestions: !obscureText,
      autocorrect: !obscureText,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(prefixIcon),
        filled: true,
        fillColor: Colors.white.withValues(alpha: .86),
        suffixIcon: shouldShowToggle
            ? IconButton(
                tooltip:
                    obscureText ? 'Show password' : 'Hide password',
                onPressed: onToggleVisibility,
                icon: Icon(
                  obscureText
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                  color: AppColors.primaryDark,
                ),
              )
            : null,
      ),
    );
  }
}

class _VerificationCodeField extends StatelessWidget {
  const _VerificationCodeField({
    required this.controller,
    required this.label,
    required this.onSubmitted,
  });

  final TextEditingController controller;
  final String label;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      textInputAction: TextInputAction.done,
      maxLength: 6,
      onSubmitted: onSubmitted,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w900,
        letterSpacing: 6,
      ),
      decoration: InputDecoration(
        labelText: label,
        hintText: '000000',
        counterText: '',
        prefixIcon: const Icon(
          Icons.pin_outlined,
        ),
        filled: true,
        fillColor: Colors.white.withValues(alpha: .86),
      ),
    );
  }
}

class _EmailProgressHeader extends StatelessWidget {
  const _EmailProgressHeader({
    required this.step,
    required this.currentEmail,
    required this.newEmail,
  });

  final int step;
  final String currentEmail;
  final String newEmail;

  @override
  Widget build(BuildContext context) {
    final caption = step == 0
        ? currentEmail
        : step == 1
            ? currentEmail
            : (newEmail.isEmpty ? 'New email address' : newEmail);

    return Container(
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .78),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: AppColors.border.withValues(alpha: .82),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _EmailStepDot(
                  number: 1,
                  active: step == 0,
                  complete: step > 0,
                  label: 'Confirm',
                ),
              ),
              _StepConnector(complete: step > 0),
              Expanded(
                child: _EmailStepDot(
                  number: 2,
                  active: step == 1,
                  complete: step > 1,
                  label: 'Current',
                ),
              ),
              _StepConnector(complete: step > 1),
              Expanded(
                child: _EmailStepDot(
                  number: 3,
                  active: step == 2,
                  complete: false,
                  label: 'New',
                ),
              ),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              const Icon(
                Icons.alternate_email_rounded,
                size: 13,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  caption,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
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

class _EmailStepDot extends StatelessWidget {
  const _EmailStepDot({
    required this.number,
    required this.active,
    required this.complete,
    required this.label,
  });

  final int number;
  final bool active;
  final bool complete;
  final String label;

  @override
  Widget build(BuildContext context) {
    final highlighted = active || complete;

    return Column(
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 27,
          height: 27,
          decoration: BoxDecoration(
            color:
                highlighted ? AppColors.primary : AppColors.primarySoft,
            shape: BoxShape.circle,
            border: Border.all(
              color: highlighted
                  ? AppColors.primary
                  : AppColors.border,
            ),
          ),
          alignment: Alignment.center,
          child: complete
              ? const Icon(
                  Icons.check_rounded,
                  size: 14,
                  color: Colors.white,
                )
              : Text(
                  '$number',
                  style: TextStyle(
                    color: active
                        ? Colors.white
                        : AppColors.primaryDark,
                    fontSize: 8.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: active
                ? AppColors.primaryDark
                : AppColors.textMuted,
            fontSize: 7.4,
            fontWeight: active ? FontWeight.w900 : FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _StepConnector extends StatelessWidget {
  const _StepConnector({
    required this.complete,
  });

  final bool complete;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        height: 1.5,
        margin: const EdgeInsets.only(
          left: 3,
          right: 3,
          bottom: 15,
        ),
        decoration: BoxDecoration(
          color: complete
              ? AppColors.primary
              : AppColors.border.withValues(alpha: .85),
          borderRadius: BorderRadius.circular(99),
        ),
      ),
    );
  }
}

String _sessionDate(
  dynamic value,
) {
  final date =
      DateTime.tryParse(
    '$value',
  )?.toLocal();

  if (date == null) {
    return 'recently';
  }

  return '${date.month}/${date.day}/${date.year}';
}