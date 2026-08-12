// Authentication API for Voxidence mobile.
// Stores a complete rotating token pair so authenticated mobile requests can
// recover cleanly from expired access tokens.
//
// @author Eman

import 'package:dio/dio.dart';
import '../../../core/network/api_config.dart';
import '../../../core/storage/platform_key_value_store.dart';
import '../../../core/storage/session_store.dart';

class AuthApi {
  AuthApi._();

  static final AuthApi instance = AuthApi._();
  static final _storage = PlatformKeyValueStore.instance;
  static const _guestCookieStorageKey = 'guest_session_cookie';

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      headers: const {'Content-Type': 'application/json', 'Accept': 'application/json'},
    ),
  );

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
      final accessToken = data['accessToken']?.toString() ?? '';
      final refreshToken = data['refreshToken']?.toString() ?? '';
      final user = _asMap(data['user']);

      if (accessToken.isEmpty || refreshToken.isEmpty || user.isEmpty) {
        throw const AuthException('The login response is incomplete.');
      }

      await SessionStore.instance.saveSession(
        accessToken: accessToken,
        refreshToken: refreshToken,
        user: user,
        rememberMe: rememberMe,
      );

      return data;
    } on DioException catch (error) {
      throw AuthException(_readMessage(error));
    }
  }

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
      throw AuthException(_readMessage(error));
    }
  }

  Future<void> verifyEmail({required String email, required String code}) async {
    try {
      await _dio.post<void>(
        '/auth/email/verify',
        data: {'email': email.trim().toLowerCase(), 'code': code.trim()},
      );
    } on DioException catch (error) {
      throw AuthException(_readMessage(error));
    }
  }

  Future<void> resendVerification(String email) async {
    try {
      await _dio.post<void>(
        '/auth/email/resend-verification',
        data: {'email': email.trim().toLowerCase()},
      );
    } on DioException catch (error) {
      throw AuthException(_readMessage(error));
    }
  }

  Future<void> forgotPassword(String email) async {
    try {
      await _dio.post<void>(
        '/auth/password/forgot',
        data: {'email': email.trim().toLowerCase()},
      );
    } on DioException catch (error) {
      throw AuthException(_readMessage(error));
    }
  }

  Future<void> logout() async {
    final refreshToken = await SessionStore.instance.getRefreshToken();
    try {
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken});
      }
    } finally {
      await SessionStore.instance.clear();
    }
  }

  dynamic _unwrap(dynamic value) {
    dynamic current = value;
    for (var i = 0; i < 2; i++) {
      if (current is Map && current.length == 1 && current.containsKey('data')) {
        current = current['data'];
      } else {
        break;
      }
    }
    return current;
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  String _readMessage(DioException error) {
    final data = error.response?.data;
    if (data is Map) {
      final message = data['message'];
      if (message is List) return message.join(' ');
      if (message is String && message.trim().isNotEmpty) return message.trim();
      if (message is Map && message['message'] != null) return message['message'].toString();
    }

    if (error.type == DioExceptionType.connectionError || error.type == DioExceptionType.connectionTimeout) {
      return 'Unable to reach the server. Check your connection and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
}

class AuthException implements Exception {
  const AuthException(this.message);

  final String message;

  @override
  String toString() => message;
}
