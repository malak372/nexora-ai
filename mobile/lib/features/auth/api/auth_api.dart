import 'dart:math' as math;

import 'package:dio/dio.dart';

import '../../../core/network/api_config.dart';
import '../../../core/storage/platform_key_value_store.dart';
import '../../../core/storage/session_store.dart';
import '../session/auth_session_store.dart';

/// Handles authentication-related communication with the backend API.
///
/// This service provides:
/// - Login.
/// - Registration.
/// - Email verification.
/// - Verification-code resend.
/// - Password recovery.
/// - Password reset.
/// - Session refresh.
/// - Logout.
/// - Login-attempt warnings and temporary account-lock handling.
///
/// The application currently contains both the authentication session store
/// used by the authentication flow and the shared core session store used by
/// authenticated mobile user features. Both stores are synchronized here so
/// all application areas see the same active session.
///
/// @author Eman
class AuthApi {
  AuthApi._();

  static final AuthApi instance = AuthApi._();

  static final PlatformKeyValueStore _storage = PlatformKeyValueStore.instance;

  static const String _guestCookieStorageKey = 'guest_session_cookie';

  static const String accountTemporarilyLockedCode =
      'ACCOUNT_TEMPORARILY_LOCKED';

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 20),
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  /// Logs the user in using the backend authentication endpoint.
  ///
  /// The resulting authenticated session is stored in both session stores
  /// because existing authentication screens use [AuthSessionStore], while
  /// the authenticated user area uses [SessionStore].
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    required bool rememberMe,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/auth/login',
        data: {'email': email.trim().toLowerCase(), 'password': password},
      );

      final data = _asMap(_unwrap(response.data));

      final accessToken = data['accessToken']?.toString().trim() ?? '';

      final refreshToken = data['refreshToken']?.toString().trim() ?? '';

      final user = _asMap(data['user']);

      if (accessToken.isEmpty || refreshToken.isEmpty || user.isEmpty) {
        throw const AuthException(
          message: 'The login response is incomplete.',
          title: 'Sign in failed',
          code: 'INCOMPLETE_LOGIN_RESPONSE',
        );
      }

      await AuthSessionStore.instance.saveLoginSession(
        data,
        rememberMe: rememberMe,
      );

      await SessionStore.instance.saveSession(
        accessToken: accessToken,
        refreshToken: refreshToken,
        user: user,
        rememberMe: rememberMe,
      );

      return data;
    } on DioException catch (error) {
      throw _buildLoginException(error);
    } on AuthSessionException catch (error) {
      throw AuthException(message: error.message, title: 'Sign in failed');
    }
  }

  /// Registers a new account.
  ///
  /// If a guest session exists, its cookie is forwarded to the backend so
  /// guest-generated ideas can be attached to the new account.
  Future<Map<String, dynamic>> register({
    required String fullName,
    required String email,
    required String password,
    required String userType,
  }) async {
    try {
      final guestCookie = await _storage.read(_guestCookieStorageKey);

      final response = await _dio.post<dynamic>(
        '/auth/register',
        data: {
          'fullName': fullName.trim(),
          'email': email.trim().toLowerCase(),
          'password': password,
          'userType': userType,
        },
        options: guestCookie == null || guestCookie.trim().isEmpty
            ? null
            : Options(headers: {'Cookie': guestCookie}),
      );

      await _storage.delete(_guestCookieStorageKey);

      return _asMap(_unwrap(response.data));
    } on DioException catch (error) {
      final message = _readRegisterMessage(error);

      final normalizedMessage = message.toLowerCase();

      final accountWasCreated =
          normalizedMessage.contains('account was created') &&
          normalizedMessage.contains('verification email');

      if (accountWasCreated) {
        await _storage.delete(_guestCookieStorageKey);
      }

      throw AuthException(message: message);
    }
  }

  /// Verifies the user's email address.
  ///
  /// Only numeric verification-code characters are sent.
  Future<Map<String, dynamic>> verifyEmail({
    required String email,
    required String code,
  }) async {
    try {
      final digitsOnly = code.replaceAll(RegExp(r'\D'), '');

      final normalizedCode = digitsOnly.length > 6
          ? digitsOnly.substring(0, 6)
          : digitsOnly;

      final response = await _dio.post<dynamic>(
        '/auth/email/verify',
        data: {'email': email.trim().toLowerCase(), 'code': normalizedCode},
      );

      return _asMap(_unwrap(response.data));
    } on DioException catch (error) {
      throw AuthException(message: _readEmailVerificationMessage(error));
    }
  }

  /// Resends an email verification code.
  Future<Map<String, dynamic>> resendVerification(String email) async {
    try {
      final response = await _dio.post<dynamic>(
        '/auth/email/resend-verification',
        data: {'email': email.trim().toLowerCase()},
      );

      return _asMap(_unwrap(response.data));
    } on DioException catch (error) {
      throw AuthException(message: _readEmailVerificationMessage(error));
    }
  }

  /// Sends a forgot-password request.
  ///
  /// Native mobile requests identify themselves to the backend so the
  /// generated reset link can use the mobile deep-link scheme.
  Future<Map<String, dynamic>> requestPasswordReset(String email) async {
    try {
      final response = await _dio.post<dynamic>(
        '/auth/password/forgot',
        data: {'email': email.trim().toLowerCase()},
        options: ApiConfig.isNativeMobile
            ? Options(headers: const {'X-Voxidence-Client': 'mobile'})
            : null,
      );

      return _asMap(_unwrap(response.data));
    } on DioException catch (error) {
      throw AuthException(message: _readRecoveryMessage(error));
    }
  }

  /// Compatibility alias for pages that still call `forgotPassword`.
  Future<void> forgotPassword(String email) async {
    await requestPasswordReset(email);
  }

  /// Resets the password using the reset token sent to the user.
  ///
  /// Any existing local authentication session is cleared after a
  /// successful password reset.
  Future<Map<String, dynamic>> resetPassword({
    required String token,
    required String newPassword,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        '/auth/password/reset',
        data: {'token': token.trim(), 'newPassword': newPassword},
      );

      await _clearLocalSession();

      return _asMap(_unwrap(response.data));
    } on DioException catch (error) {
      throw AuthException(message: _readRecoveryMessage(error));
    }
  }

  /// Attempts to refresh the current authenticated session.
  ///
  /// Refresh is allowed while the application is running even when
  /// "Remember me" was not selected. Remember-me only controls persistence
  /// across application restarts.
  Future<bool> refreshSession() async {
    final refreshToken = await AuthSessionStore.instance.getRefreshToken();

    final user = await AuthSessionStore.instance.getUser();

    if (refreshToken == null || refreshToken.trim().isEmpty || user == null) {
      return false;
    }

    try {
      final response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken.trim()},
      );

      final data = _asMap(_unwrap(response.data));

      final accessToken = data['accessToken']?.toString().trim() ?? '';

      final nextRefreshToken = data['refreshToken']?.toString().trim() ?? '';

      if (accessToken.isEmpty || nextRefreshToken.isEmpty) {
        await _clearLocalSession();

        return false;
      }

      await AuthSessionStore.instance.updateTokens(
        accessToken: accessToken,
        refreshToken: nextRefreshToken,
      );

      final rememberMe = await AuthSessionStore.instance.getRememberMe();

      await SessionStore.instance.saveSession(
        accessToken: accessToken,
        refreshToken: nextRefreshToken,
        user: user,
        rememberMe: rememberMe,
      );

      return true;
    } on DioException catch (error) {
      final status = error.response?.statusCode;

      if (status == 401 || status == 403) {
        await _clearLocalSession();

        return false;
      }

      throw AuthException(message: _readMessage(error));
    }
  }

  /// Logs the user out from the backend and clears both local session stores.
  Future<void> logout() async {
    final refreshToken = await AuthSessionStore.instance.getRefreshToken();

    try {
      if (refreshToken != null && refreshToken.trim().isNotEmpty) {
        await _dio.post<void>(
          '/auth/logout',
          data: {'refreshToken': refreshToken.trim()},
        );
      }
    } on DioException {
      // Local logout must still succeed when the backend is unavailable.
    } finally {
      await _clearLocalSession();
    }
  }

  /// Clears all locally stored authentication state.
  Future<void> _clearLocalSession() async {
    await AuthSessionStore.instance.clear();
    await SessionStore.instance.clear();
  }

  /// Converts backend login errors into structured errors suitable for the UI.
  AuthException _buildLoginException(DioException error) {
    final response = error.response;

    final data = response?.data;

    final body = data is Map
        ? Map<String, dynamic>.from(data)
        : <String, dynamic>{};

    final status = response?.statusCode;

    final code = body['code']?.toString();

    final isLocked = code == accountTemporarilyLockedCode || status == 429;

    if (isLocked) {
      return AuthException(
        message: 'Your account is temporarily locked.',
        title: 'Account temporarily locked',
        type: 'locked',
        code: accountTemporarilyLockedCode,
        statusCode: status,
        attemptsRemaining: _asInt(body['attemptsRemaining']),
        remainingSeconds: _remainingSeconds(error, body),
        lockDurationMinutes: _asInt(body['lockDurationMinutes']),
        lockedUntil: body['lockedUntil']?.toString(),
        justLocked:
            body['justLocked'] == true ||
            body['newlyLocked'] == true ||
            body['lockApplied'] == true,
      );
    }

    final attemptsRemaining = _asInt(body['attemptsRemaining']);

    if (code == 'LOGIN_ATTEMPTS_WARNING' &&
        (attemptsRemaining == 1 || attemptsRemaining == 2)) {
      return AuthException(
        message:
            _backendMessage(body) ??
            'Invalid email or password. '
                'You have $attemptsRemaining '
                '${attemptsRemaining == 1 ? 'attempt' : 'attempts'} '
                'remaining before your account is temporarily locked.',
        title: 'Incorrect password',
        type: 'warning',
        code: code,
        statusCode: status,
        attemptsRemaining: attemptsRemaining,
      );
    }

    if (status == 400 || status == 401 || status == 403 || status == 404) {
      return AuthException(
        message: 'Invalid email or password.',
        title: 'Sign in failed',
        type: 'error',
        code: code ?? 'INVALID_CREDENTIALS',
        statusCode: status,
      );
    }

    return AuthException(
      message: _readMessage(error),
      title: 'Sign in failed',
      type: 'error',
      code: code,
      statusCode: status,
    );
  }

  /// Calculates the remaining temporary-account-lock duration.
  int? _remainingSeconds(DioException error, Map<String, dynamic> body) {
    final lockedUntilText = body['lockedUntil']?.toString();

    if (lockedUntilText != null) {
      final lockedUntil = DateTime.tryParse(lockedUntilText)?.toLocal();

      if (lockedUntil != null) {
        final seconds = lockedUntil.difference(DateTime.now()).inSeconds;

        if (seconds > 0) {
          return seconds + 1;
        }
      }
    }

    final bodySeconds = _asInt(body['remainingSeconds']);

    if (bodySeconds != null && bodySeconds > 0) {
      return bodySeconds;
    }

    final retryAfter = error.response?.headers.value('retry-after');

    if (retryAfter == null || retryAfter.trim().isEmpty) {
      return null;
    }

    final seconds = int.tryParse(retryAfter.trim());

    if (seconds != null && seconds > 0) {
      return seconds;
    }

    final retryDate = DateTime.tryParse(retryAfter)?.toLocal();

    if (retryDate == null) {
      return null;
    }

    return math.max(0, retryDate.difference(DateTime.now()).inSeconds + 1);
  }

  /// Reads a registration-specific backend error.
  String _readRegisterMessage(DioException error) {
    final backendMessage = _messageFromResponse(error);

    if (backendMessage != null) {
      return backendMessage;
    }

    if (_isTimeout(error)) {
      return 'The request took too long. Please try again.';
    }

    if (error.response == null) {
      return 'The server is currently unavailable. '
          'Please check your connection.';
    }

    return 'Registration could not be completed. '
        'Please try again.';
  }

  /// Reads an email-verification-specific backend error.
  String _readEmailVerificationMessage(DioException error) {
    final backendMessage = _messageFromResponse(error);

    if (backendMessage != null) {
      return backendMessage;
    }

    if (_isTimeout(error)) {
      return 'The request took too long. Please try again.';
    }

    if (error.response == null) {
      return 'The server is currently unavailable. '
          'Please check your connection.';
    }

    return 'Email verification could not be completed. '
        'Please try again.';
  }

  /// Extracts a readable backend message when one exists.
  String? _messageFromResponse(DioException error) {
    final data = error.response?.data;

    if (data is! Map) {
      return null;
    }

    final message = data['message'];

    if (message is List && message.isNotEmpty) {
      return message.join(' ');
    }

    if (message is String && message.trim().isNotEmpty) {
      return message.trim();
    }

    if (message is Map && message['message'] != null) {
      final nested = message['message'].toString().trim();

      return nested.isEmpty ? null : nested;
    }

    return null;
  }

  /// Returns true when the request failed because of a timeout.
  bool _isTimeout(DioException error) {
    return error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout;
  }

  /// Reads password-recovery errors.
  String _readRecoveryMessage(DioException error) {
    final status = error.response?.statusCode;

    if (status == 429) {
      return 'Too many attempts. '
          'Please wait a moment and try again.';
    }

    if (status != null && status >= 500) {
      return 'The server could not complete '
          'the request. Please try again.';
    }

    return _readMessage(error);
  }

  /// Converts a generic Dio error into a user-readable message.
  String _readMessage(DioException error) {
    final backendMessage = _messageFromResponse(error);

    if (backendMessage != null) {
      return backendMessage;
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return 'Unable to reach the server. '
          'Check your connection and try again.';
    }

    return 'Something went wrong. '
        'Please try again.';
  }

  /// Reads a message directly from a decoded backend response body.
  String? _backendMessage(Map<String, dynamic> body) {
    final message = body['message'];

    if (message is List) {
      return message.join(' ');
    }

    if (message is String && message.trim().isNotEmpty) {
      return message.trim();
    }

    if (message is Map && message['message'] != null) {
      final nested = message['message'].toString().trim();

      return nested.isEmpty ? null : nested;
    }

    return null;
  }

  /// Unwraps common `{ data: ... }` response envelopes.
  dynamic _unwrap(dynamic value) {
    dynamic current = value;

    for (var i = 0; i < 2; i++) {
      if (current is Map &&
          current.length == 1 &&
          current.containsKey('data')) {
        current = current['data'];
      } else {
        break;
      }
    }

    return current;
  }

  /// Converts an arbitrary map-like value to a typed Dart map.
  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  /// Safely converts backend numeric values to integers.
  int? _asInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.round();
    }

    return int.tryParse(value?.toString() ?? '');
  }
}

/// Structured authentication exception used by the mobile authentication UI.
///
/// @author Eman
class AuthException implements Exception {
  const AuthException({
    required this.message,
    this.title = 'Something went wrong',
    this.type = 'error',
    this.code,
    this.statusCode,
    this.attemptsRemaining,
    this.remainingSeconds,
    this.lockDurationMinutes,
    this.lockedUntil,
    this.justLocked = false,
  });

  final String message;

  final String title;

  final String type;

  final String? code;

  final int? statusCode;

  final int? attemptsRemaining;

  final int? remainingSeconds;

  final int? lockDurationMinutes;

  final String? lockedUntil;

  final bool justLocked;

  bool get isLocked => type == 'locked';

  bool get isWarning => type == 'warning';

  @override
  String toString() => message;
}
