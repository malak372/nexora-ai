import 'dart:math' as math;

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/network/api_config.dart';
import '../session/auth_session_store.dart';

/// Handles authentication-related communication with the backend API.
///
/// This service provides operations for:
/// - User login and registration.
/// - Email verification and verification-code resend.
/// - Password recovery and password reset.
/// - Authentication token refresh.
/// - User logout.
/// - Authentication error parsing and account-lock handling.
///
/// Authentication tokens and local session information are managed through
/// [AuthSessionStore], while temporary guest-session information is stored
/// securely using [FlutterSecureStorage].
///
/// @author Eman
class AuthApi {
  AuthApi._();

  static final AuthApi instance = AuthApi._();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _guestCookieStorageKey = 'guest_session_cookie';

  static const String accountTemporarilyLockedCode =
      'ACCOUNT_TEMPORARILY_LOCKED';

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 20),
      headers: const {'Content-Type': 'application/json'},
    ),
  );

  /// Logs the user in using the exact same backend route used by the web app.
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    required bool rememberMe,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/login',
        data: {'email': email.trim().toLowerCase(), 'password': password},
      );

      final data = response.data ?? <String, dynamic>{};

      await AuthSessionStore.instance.saveLoginSession(
        data,
        rememberMe: rememberMe,
      );

      return data;
    } on DioException catch (error) {
      throw _buildLoginException(error);
    } on AuthSessionException catch (error) {
      throw AuthException(message: error.message);
    }
  }

  /// Registers a new account using the same web backend.
  ///
  /// If the user generated an idea as a guest first, the guest
  /// session cookie is also sent during registration.
  Future<Map<String, dynamic>> register({
    required String fullName,
    required String email,
    required String password,
    required String userType,
  }) async {
    try {
      final guestCookie = await _storage.read(key: _guestCookieStorageKey);

      final response = await _dio.post<Map<String, dynamic>>(
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

      await _storage.delete(key: _guestCookieStorageKey);

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      final message = _readRegisterMessage(error);

      final normalizedMessage = message.toLowerCase();

      final accountWasCreated =
          normalizedMessage.contains('account was created') &&
          normalizedMessage.contains('verification email');

      if (accountWasCreated) {
        await _storage.delete(key: _guestCookieStorageKey);
      }

      throw AuthException(message: message);
    }
  }

  /// Verifies the user's email.
  Future<Map<String, dynamic>> verifyEmail({
    required String email,
    required String code,
  }) async {
    try {
      final digitsOnly = code.replaceAll(RegExp(r'\D'), '');

      final normalizedCode = digitsOnly.length > 6
          ? digitsOnly.substring(0, 6)
          : digitsOnly;

      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/email/verify',
        data: {'email': email.trim().toLowerCase(), 'code': normalizedCode},
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw AuthException(message: _readEmailVerificationMessage(error));
    }
  }

  /// Resends the verification code.
  Future<Map<String, dynamic>> resendVerification(String email) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/email/resend-verification',
        data: {'email': email.trim().toLowerCase()},
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw AuthException(message: _readEmailVerificationMessage(error));
    }
  }

  /// Sends a forgot-password request.
  ///
  /// Mobile requests send X-Voxidence-Client: mobile.
  /// The backend then creates a voxidence:// reset link instead
  /// of sending the normal web localhost reset link.
  Future<Map<String, dynamic>> requestPasswordReset(String email) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/password/forgot',
        data: {'email': email.trim().toLowerCase()},
        options: ApiConfig.isNativeMobile
            ? Options(headers: const {'X-Voxidence-Client': 'mobile'})
            : null,
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw AuthException(message: _readRecoveryMessage(error));
    }
  }

  /// Resets the password using the token received in the email.
  Future<Map<String, dynamic>> resetPassword({
    required String token,
    required String newPassword,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/password/reset',
        data: {'token': token.trim(), 'newPassword': newPassword},
      );

      await AuthSessionStore.instance.clear();

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw AuthException(message: _readRecoveryMessage(error));
    }
  }

  /// Refreshes the active session.
  ///
  /// Remember me only determines whether the session survives
  /// after the app is closed. It must NOT prevent refresh while
  /// the app is currently running.
  Future<bool> refreshSession() async {
    final refreshToken = await AuthSessionStore.instance.getRefreshToken();

    final user = await AuthSessionStore.instance.getUser();

    if (refreshToken == null || refreshToken.trim().isEmpty || user == null) {
      return false;
    }

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );

      final data = response.data ?? <String, dynamic>{};

      final accessToken = data['accessToken']?.toString().trim() ?? '';

      final nextRefreshToken = data['refreshToken']?.toString().trim() ?? '';

      if (accessToken.isEmpty || nextRefreshToken.isEmpty) {
        await AuthSessionStore.instance.clear();

        return false;
      }

      await AuthSessionStore.instance.updateTokens(
        accessToken: accessToken,
        refreshToken: nextRefreshToken,
      );

      return true;
    } on DioException catch (error) {
      final status = error.response?.statusCode;

      if (status == 401 || status == 403) {
        await AuthSessionStore.instance.clear();

        return false;
      }

      throw AuthException(message: _readMessage(error));
    }
  }

  /// Logs the user out from the backend and clears local session.
  Future<void> logout() async {
    final refreshToken = await AuthSessionStore.instance.getRefreshToken();

    try {
      if (refreshToken != null && refreshToken.trim().isNotEmpty) {
        await _dio.post<void>(
          '/auth/logout',
          data: {'refreshToken': refreshToken},
        );
      }
    } on DioException {
      // Local logout still succeeds if backend is unavailable.
    } finally {
      await AuthSessionStore.instance.clear();
    }
  }

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

  String _readRegisterMessage(DioException error) {
    final backendMessage = _messageFromResponse(error);

    if (backendMessage != null) {
      return backendMessage;
    }

    if (_isTimeout(error)) {
      return 'The request took too long. Please try again.';
    }

    if (error.response == null) {
      return 'The server is currently unavailable. Please check your connection.';
    }

    return 'Registration could not be completed. Please try again.';
  }

  String _readEmailVerificationMessage(DioException error) {
    final backendMessage = _messageFromResponse(error);

    if (backendMessage != null) {
      return backendMessage;
    }

    if (_isTimeout(error)) {
      return 'The request took too long. Please try again.';
    }

    if (error.response == null) {
      return 'The server is currently unavailable. Please check your connection.';
    }

    return 'Email verification could not be completed. Please try again.';
  }

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

    return null;
  }

  bool _isTimeout(DioException error) {
    return error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout;
  }

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

  String _readMessage(DioException error) {
    final data = error.response?.data;

    if (data is Map) {
      final message = data['message'];

      if (message is List) {
        return message.join(' ');
      }

      if (message is String && message.trim().isNotEmpty) {
        return message.trim();
      }
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return 'Unable to reach the server. '
          'Check your connection and try again.';
    }

    return 'Something went wrong. '
        'Please try again.';
  }

  String? _backendMessage(Map<String, dynamic> body) {
    final message = body['message'];

    if (message is List) {
      return message.join(' ');
    }

    if (message is String && message.trim().isNotEmpty) {
      return message.trim();
    }

    return null;
  }

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

/// Structured authentication exception.
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
