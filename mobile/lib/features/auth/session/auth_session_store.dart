import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Manages the authenticated user session for the mobile application.
///
/// Authentication data such as access tokens, refresh tokens, user
/// information, and the "remember me" preference are stored securely
/// using [FlutterSecureStorage].
///
/// The class also keeps the current session in memory to reduce repeated
/// secure-storage reads while the application is running.
///
/// @author Eman
class AuthSessionStore {
  AuthSessionStore._();

  /// Shared singleton instance used throughout the application.
  static final AuthSessionStore instance = AuthSessionStore._();

  /// Secure storage used to persist authentication information.
  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  /// Storage key for the access token.
  static const String _accessTokenKey = 'access_token';

  /// Storage key for the refresh token.
  static const String _refreshTokenKey = 'refresh_token';

  /// Storage key for the authenticated user data.
  static const String _userKey = 'auth_user';

  /// Storage key for the "remember me" preference.
  static const String _rememberMeKey = 'remember_me';

  /// Cached authenticated user for the current application session.
  Map<String, dynamic>? _sessionUser;

  /// Cached access token for the current application session.
  String? _sessionAccessToken;

  /// Cached refresh token for the current application session.
  String? _sessionRefreshToken;

  /// Indicates whether the session has already been loaded from storage.
  bool _sessionLoaded = false;

  /// Restores a persisted authentication session when the app launches.
  ///
  /// If the user previously enabled "remember me", the stored tokens and
  /// user information are loaded into memory.
  ///
  /// If "remember me" is disabled, any persisted authentication data is
  /// cleared to ensure the user starts with a fresh session.
  Future<void> prepareForLaunch() async {
    final rememberMe = await _storage.read(key: _rememberMeKey) == 'true';

    if (!rememberMe) {
      await clear();
      return;
    }

    _sessionAccessToken = await _storage.read(key: _accessTokenKey);

    _sessionRefreshToken = await _storage.read(key: _refreshTokenKey);

    _sessionUser = await _readStoredUser();

    _sessionLoaded = true;
  }

  /// Saves a complete authentication session after a successful login.
  ///
  /// The [session] map is expected to contain:
  /// - `accessToken`
  /// - `refreshToken` when available
  /// - `user`
  ///
  /// The [rememberMe] value determines whether the session should be
  /// restored automatically when the application is launched again.
  ///
  /// Throws an [AuthSessionException] when the session does not contain
  /// the minimum required authentication information.
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

    await _storage.write(key: _accessTokenKey, value: accessToken);

    await _storage.write(
      key: _refreshTokenKey,
      value: refreshToken.isEmpty ? null : refreshToken,
    );

    await _storage.write(key: _userKey, value: jsonEncode(user));

    await _storage.write(key: _rememberMeKey, value: rememberMe.toString());
  }

  /// Updates the stored access and refresh tokens.
  ///
  /// This is typically used after the backend refreshes an expired
  /// authentication token pair.
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

  /// Returns the current access token.
  ///
  /// The in-memory token is returned first when available. Otherwise,
  /// the value is loaded from secure storage unless the session has
  /// already been resolved.
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

  /// Returns the current refresh token.
  ///
  /// The cached value is used first to avoid unnecessary secure-storage
  /// reads during the current application session.
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

  /// Returns the authenticated user information.
  ///
  /// A defensive copy is returned so external code cannot directly modify
  /// the internally cached session user.
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

  /// Returns whether the user enabled the "remember me" option.
  Future<bool> getRememberMe() async {
    return await _storage.read(key: _rememberMeKey) == 'true';
  }

  /// Checks whether a valid local authentication session is available.
  ///
  /// A session is considered available when both a non-empty access token
  /// and authenticated user information exist.
  Future<bool> hasSession() async {
    final token = await getAccessToken();
    final user = await getUser();

    return token != null && token.trim().isNotEmpty && user != null;
  }

  /// Clears the complete authentication session.
  ///
  /// Both the in-memory cache and all persisted authentication values are
  /// removed from secure storage.
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

  /// Reads and decodes the stored authenticated user.
  ///
  /// If the persisted JSON is invalid or corrupted, the authentication
  /// session is cleared to prevent the application from using inconsistent
  /// session data.
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

/// Exception thrown when authentication session data cannot be stored
/// or is incomplete.
///
/// @author Eman
class AuthSessionException implements Exception {
  const AuthSessionException(this.message);

  /// Human-readable description of the session error.
  final String message;

  @override
  String toString() => message;
}
