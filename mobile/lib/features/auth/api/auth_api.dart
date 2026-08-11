import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthApi {
  AuthApi._();

  static final AuthApi instance = AuthApi._();

  static const _storage = FlutterSecureStorage();

  static const _guestCookieStorageKey = 'guest_session_cookie';

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: dotenv.env['API_BASE_URL'] ?? 'http://10.0.2.2:3000',

      connectTimeout: const Duration(seconds: 12),

      receiveTimeout: const Duration(seconds: 20),

      headers: {'Content-Type': 'application/json'},
    ),
  );

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

      final accessToken = data['accessToken']?.toString();

      final refreshToken = data['refreshToken']?.toString();

      if (accessToken != null && accessToken.isNotEmpty) {
        await _storage.write(key: 'access_token', value: accessToken);
      }

      if (rememberMe && refreshToken != null && refreshToken.isNotEmpty) {
        await _storage.write(key: 'refresh_token', value: refreshToken);
      } else {
        await _storage.delete(key: 'refresh_token');
      }

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
      throw AuthException(_readMessage(error));
    }
  }

  Future<void> verifyEmail({
    required String email,
    required String code,
  }) async {
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

  String _readMessage(DioException error) {
    final data = error.response?.data;

    if (data is Map<String, dynamic>) {
      final message = data['message'];

      if (message is List) {
        return message.join(' ');
      }

      if (message is String && message.trim().isNotEmpty) {
        return message.trim();
      }
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout) {
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
