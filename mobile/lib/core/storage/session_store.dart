// Authentication session storage for Voxidence.
//
// Native builds keep tokens in FlutterSecureStorage, while an in-memory mirror
// prevents every API request from reopening secure storage. This keeps page
// navigation responsive without weakening persistence: secure storage remains
// the source of truth across application launches.
//
// @author Eman

import 'dart:convert';

import 'platform_key_value_store.dart';

class SessionStore {
  SessionStore._();

  static final SessionStore instance = SessionStore._();
  static final PlatformKeyValueStore _storage = PlatformKeyValueStore.instance;

  static const _accessTokenKey = 'access_token';
  static const _refreshTokenKey = 'refresh_token';
  static const _userSnapshotKey = 'authenticated_user';
  static const _rememberMeKey = 'remember_me';

  String? _accessTokenMemory;
  String? _refreshTokenMemory;
  Map<String, dynamic>? _userMemory;
  bool? _rememberMeMemory;

  bool _accessTokenHydrated = false;
  bool _refreshTokenHydrated = false;
  bool _userHydrated = false;
  bool _rememberMeHydrated = false;

  Future<String?>? _accessTokenRead;
  Future<String?>? _refreshTokenRead;
  Future<Map<String, dynamic>?>? _userRead;
  Future<bool>? _rememberMeRead;

  Future<String?> getAccessToken() {
    if (_accessTokenHydrated) {
      return Future<String?>.value(_accessTokenMemory);
    }

    final activeRead = _accessTokenRead;
    if (activeRead != null) return activeRead;

    final request = _storage.read(_accessTokenKey).then((value) {
      _accessTokenMemory = _clean(value);
      _accessTokenHydrated = true;
      return _accessTokenMemory;
    }).whenComplete(() {
      _accessTokenRead = null;
    });

    _accessTokenRead = request;
    return request;
  }

  Future<String?> getRefreshToken() {
    if (_refreshTokenHydrated) {
      return Future<String?>.value(_refreshTokenMemory);
    }

    final activeRead = _refreshTokenRead;
    if (activeRead != null) return activeRead;

    final request = _storage.read(_refreshTokenKey).then((value) {
      _refreshTokenMemory = _clean(value);
      _refreshTokenHydrated = true;
      return _refreshTokenMemory;
    }).whenComplete(() {
      _refreshTokenRead = null;
    });

    _refreshTokenRead = request;
    return request;
  }

  Future<bool> hasAccessToken() async {
    final token = await getAccessToken();
    return token != null && token.isNotEmpty;
  }

  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    required Map<String, dynamic> user,
    required bool rememberMe,
  }) async {
    _accessTokenMemory = _clean(accessToken);
    _refreshTokenMemory = _clean(refreshToken);
    _userMemory = Map<String, dynamic>.from(user);
    _rememberMeMemory = rememberMe;

    _accessTokenHydrated = true;
    _refreshTokenHydrated = true;
    _userHydrated = true;
    _rememberMeHydrated = true;

    await Future.wait([
      _storage.write(_accessTokenKey, accessToken),
      _storage.write(_refreshTokenKey, refreshToken),
      _storage.write(_userSnapshotKey, jsonEncode(user)),
      _storage.write(_rememberMeKey, rememberMe ? '1' : '0'),
    ]);
  }

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    _accessTokenMemory = _clean(accessToken);
    _refreshTokenMemory = _clean(refreshToken);
    _accessTokenHydrated = true;
    _refreshTokenHydrated = true;

    await Future.wait([
      _storage.write(_accessTokenKey, accessToken),
      _storage.write(_refreshTokenKey, refreshToken),
    ]);
  }

  Future<Map<String, dynamic>?> readUser() {
    if (_userHydrated) {
      final cached = _userMemory;
      return Future<Map<String, dynamic>?>.value(
        cached == null ? null : Map<String, dynamic>.from(cached),
      );
    }

    final activeRead = _userRead;
    if (activeRead != null) return activeRead;

    final request = _readUserFromStorage().whenComplete(() {
      _userRead = null;
    });

    _userRead = request;
    return request;
  }

  Future<Map<String, dynamic>?> _readUserFromStorage() async {
    final value = await _storage.read(_userSnapshotKey);
    final normalized = _clean(value);

    if (normalized == null) {
      _userMemory = null;
      _userHydrated = true;
      return null;
    }

    try {
      final decoded = jsonDecode(normalized);
      final user = decoded is Map<String, dynamic>
          ? Map<String, dynamic>.from(decoded)
          : decoded is Map
              ? Map<String, dynamic>.from(decoded)
              : null;

      _userMemory = user;
      _userHydrated = true;
      return user == null ? null : Map<String, dynamic>.from(user);
    } catch (_) {
      _userMemory = null;
      _userHydrated = true;
      return null;
    }
  }

  Future<bool> readRememberMe() {
    if (_rememberMeHydrated) {
      return Future<bool>.value(_rememberMeMemory ?? false);
    }

    final activeRead = _rememberMeRead;
    if (activeRead != null) return activeRead;

    final request = _storage.read(_rememberMeKey).then((value) {
      _rememberMeMemory = value == '1';
      _rememberMeHydrated = true;
      return _rememberMeMemory!;
    }).whenComplete(() {
      _rememberMeRead = null;
    });

    _rememberMeRead = request;
    return request;
  }

  Future<void> updateUser(Map<String, dynamic> patch) async {
    final current = await readUser() ?? <String, dynamic>{};
    current.addAll(patch);

    _userMemory = Map<String, dynamic>.from(current);
    _userHydrated = true;

    await _storage.write(_userSnapshotKey, jsonEncode(current));
  }

  Future<void> clear() async {
    _accessTokenMemory = null;
    _refreshTokenMemory = null;
    _userMemory = null;
    _rememberMeMemory = null;

    _accessTokenHydrated = true;
    _refreshTokenHydrated = true;
    _userHydrated = true;
    _rememberMeHydrated = true;

    _accessTokenRead = null;
    _refreshTokenRead = null;
    _userRead = null;
    _rememberMeRead = null;

    await Future.wait([
      _storage.delete(_accessTokenKey),
      _storage.delete(_refreshTokenKey),
      _storage.delete(_userSnapshotKey),
      _storage.delete(_rememberMeKey),
    ]);
  }

  String? _clean(String? value) {
    final text = value?.trim();
    return text == null || text.isEmpty ? null : text;
  }
}
