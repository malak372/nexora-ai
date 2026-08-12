// Authentication session storage for Voxidence.
//
// Uses a platform-aware key/value store so Flutter Web does not depend on the
// WebCrypto-backed flutter_secure_storage implementation during app bootstrap.
// Native builds continue to use secure storage through PlatformKeyValueStore.
//
// @author  Malak

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

  Future<String?> getAccessToken() => _storage.read(_accessTokenKey);

  Future<String?> getRefreshToken() => _storage.read(_refreshTokenKey);

  Future<bool> hasAccessToken() async {
    final token = await getAccessToken();
    return token != null && token.trim().isNotEmpty;
  }

  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    required Map<String, dynamic> user,
    required bool rememberMe,
  }) async {
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
    await Future.wait([
      _storage.write(_accessTokenKey, accessToken),
      _storage.write(_refreshTokenKey, refreshToken),
    ]);
  }

  Future<Map<String, dynamic>?> readUser() async {
    final value = await _storage.read(_userSnapshotKey);
    if (value == null || value.trim().isEmpty) return null;

    try {
      final decoded = jsonDecode(value);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {
      return null;
    }

    return null;
  }

  Future<bool> readRememberMe() async {
    final value = await _storage.read(_rememberMeKey);
    return value == '1';
  }

  Future<void> updateUser(Map<String, dynamic> patch) async {
    final current = await readUser() ?? <String, dynamic>{};
    current.addAll(patch);
    await _storage.write(_userSnapshotKey, jsonEncode(current));
  }

  Future<void> clear() async {
    await Future.wait([
      _storage.delete(_accessTokenKey),
      _storage.delete(_refreshTokenKey),
      _storage.delete(_userSnapshotKey),
      _storage.delete(_rememberMeKey),
    ]);
  }
}
