import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthSessionStore {
  AuthSessionStore._();

  static final AuthSessionStore instance = AuthSessionStore._();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _accessTokenKey = 'access_token';

  static const String _refreshTokenKey = 'refresh_token';

  static const String _userKey = 'auth_user';

  static const String _rememberMeKey = 'remember_me';

  Map<String, dynamic>? _sessionUser;

  String? _sessionAccessToken;

  String? _sessionRefreshToken;

  bool _sessionLoaded = false;

  Future<void> prepareForLaunch() async {
    final storedRememberMe = await _storage.read(key: _rememberMeKey);
    final rememberMe =
        storedRememberMe == 'true' || storedRememberMe == '1';

    if (!rememberMe) {
      await clear();
      return;
    }

    _sessionAccessToken = await _storage.read(key: _accessTokenKey);

    _sessionRefreshToken = await _storage.read(key: _refreshTokenKey);

    _sessionUser = await _readStoredUser();

    _sessionLoaded = true;
  }

  Future<void> saveLoginSession(
    Map<String, dynamic> session, {
    required bool rememberMe,
  }) async {
    final accessToken = session['accessToken']?.toString().trim() ?? '';

    final refreshToken = session['refreshToken']?.toString().trim() ?? '';

    final rawUser = session['user'];

    if (accessToken.isEmpty || rawUser is! Map) {
      throw const AuthSessionException(
        'Cannot save an incomplete authentication session.',
      );
    }

    final user = Map<String, dynamic>.from(rawUser);

    _sessionAccessToken = accessToken;

    _sessionRefreshToken = refreshToken.isEmpty ? null : refreshToken;

    _sessionUser = user;

    _sessionLoaded = true;

    await Future.wait([
      _storage.write(key: _accessTokenKey, value: accessToken),
      _storage.write(
        key: _refreshTokenKey,
        value: refreshToken.isEmpty ? null : refreshToken,
      ),
      _storage.write(key: _userKey, value: jsonEncode(user)),
      _storage.write(key: _rememberMeKey, value: rememberMe.toString()),
    ]);
  }

  Future<void> updateTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    _sessionAccessToken = accessToken;
    _sessionRefreshToken = refreshToken;
    _sessionLoaded = true;

    await _storage.write(key: _accessTokenKey, value: accessToken);

    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<String?> getAccessToken() async {
    if (_sessionAccessToken != null) {
      return _sessionAccessToken;
    }

    if (_sessionLoaded) {
      return null;
    }

    _sessionAccessToken = await _storage.read(key: _accessTokenKey);

    return _sessionAccessToken;
  }

  Future<String?> getRefreshToken() async {
    if (_sessionRefreshToken != null) {
      return _sessionRefreshToken;
    }

    if (_sessionLoaded) {
      return null;
    }

    _sessionRefreshToken = await _storage.read(key: _refreshTokenKey);

    return _sessionRefreshToken;
  }

  Future<Map<String, dynamic>?> getUser() async {
    if (_sessionUser != null) {
      return Map<String, dynamic>.from(_sessionUser!);
    }

    if (_sessionLoaded) {
      return null;
    }

    _sessionUser = await _readStoredUser();
    _sessionLoaded = true;

    if (_sessionUser == null) {
      return null;
    }

    return Map<String, dynamic>.from(_sessionUser!);
  }

  Future<bool> getRememberMe() async {
    final value = await _storage.read(key: _rememberMeKey);
    return value == 'true' || value == '1';
  }

  Future<bool> hasSession() async {
    final token = await getAccessToken();
    final user = await getUser();

    return token != null && token.trim().isNotEmpty && user != null;
  }

  Future<void> clear() async {
    _sessionAccessToken = null;
    _sessionRefreshToken = null;
    _sessionUser = null;
    _sessionLoaded = true;

    await Future.wait([
      _storage.delete(key: _accessTokenKey),
      _storage.delete(key: _refreshTokenKey),
      _storage.delete(key: _userKey),
      _storage.delete(key: _rememberMeKey),
    ]);
  }

  Future<Map<String, dynamic>?> _readStoredUser() async {
    final value = await _storage.read(key: _userKey);

    if (value == null || value.trim().isEmpty) {
      return null;
    }

    try {
      final decoded = jsonDecode(value);

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      await clear();
    }

    return null;
  }
}

class AuthSessionException implements Exception {
  const AuthSessionException(this.message);

  final String message;

  @override
  String toString() => message;
}
