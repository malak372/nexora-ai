import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/network/api_config.dart';

/// Handles guest idea-generation API requests.
///
/// Uses the same backend base URL used by authentication.
/// Guest sessions are maintained using the guest session cookie.
///
/// @author Eman
class GuestIdeaApi {
  GuestIdeaApi._();

  static final GuestIdeaApi instance = GuestIdeaApi._();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _cookieStorageKey = 'guest_session_cookie';

  static const String _cookieName = 'nexora_guest_session';

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 30),
      headers: const {'Content-Type': 'application/json'},
    ),
  );

  /// Creates or restores the backend guest session.
  Future<Map<String, dynamic>> ensureGuestSession() async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/guest-session',
        options: await _optionsWithGuestCookie(),
      );

      await _saveGuestCookie(response.headers);

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  /// Returns the same available domains used by the web application.
  Future<List<Map<String, dynamic>>> getAvailableDomains() async {
    try {
      final response = await _dio.get<dynamic>('/domains/available');

      return _normalizeList(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  /// Returns the supported idea languages.
  Future<List<Map<String, dynamic>>> getAvailableLanguages() async {
    try {
      final response = await _dio.get<dynamic>('/public-metadata/languages');

      return _normalizeList(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  /// Starts guest idea generation.
  Future<Map<String, dynamic>> generateIdea(
    Map<String, dynamic> payload,
  ) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/guest/ideas/generate',
        data: payload,
        options: await _optionsWithGuestCookie(),
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  /// Gets the generation-run status/results.
  Future<Map<String, dynamic>> getGenerationRun(String runId) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/guest/idea-generation-runs/$runId',
        options: await _optionsWithGuestCookie(),
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<Options> _optionsWithGuestCookie() async {
    final cookie = await _storage.read(key: _cookieStorageKey);

    if (cookie == null || cookie.trim().isEmpty) {
      return Options();
    }

    return Options(headers: {'Cookie': cookie});
  }

  Future<void> _saveGuestCookie(Headers headers) async {
    final setCookies = headers.map['set-cookie'] ?? const <String>[];

    for (final rawCookie in setCookies) {
      final firstPart = rawCookie.split(';').first.trim();

      if (firstPart.startsWith('$_cookieName=')) {
        await _storage.write(key: _cookieStorageKey, value: firstPart);

        return;
      }
    }
  }

  List<Map<String, dynamic>> _normalizeList(dynamic payload) {
    dynamic rawItems = payload;

    if (payload is Map<String, dynamic>) {
      rawItems = payload['data'] ?? payload['items'] ?? const <dynamic>[];
    }

    if (rawItems is! List) {
      return const <Map<String, dynamic>>[];
    }

    return rawItems
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  GuestIdeaException _toException(DioException error) {
    final data = error.response?.data;

    String? code;
    String? activeRunId;

    String message = 'We could not complete this request. Please try again.';

    if (data is Map) {
      final map = Map<String, dynamic>.from(data);

      code = map['code']?.toString();

      activeRunId = map['activeRunId']?.toString();

      final rawMessage = map['message'];

      if (rawMessage is List) {
        message = rawMessage.join(' ');
      } else if (rawMessage is String && rawMessage.trim().isNotEmpty) {
        message = rawMessage.trim();
      }
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout) {
      message =
          'Unable to reach the server. '
          'Check your connection and try again.';
    }

    return GuestIdeaException(
      message: message,
      statusCode: error.response?.statusCode,
      code: code,
      activeRunId: activeRunId,
    );
  }
}

/// Exception returned by guest idea generation.
///
/// @author Eman
class GuestIdeaException implements Exception {
  const GuestIdeaException({
    required this.message,
    this.statusCode,
    this.code,
    this.activeRunId,
  });

  final String message;

  final int? statusCode;

  final String? code;

  final String? activeRunId;

  bool get isGenerationAlreadyRunning {
    final normalizedCode = code?.toUpperCase() ?? '';

    return normalizedCode == 'GENERATION_ALREADY_RUNNING' ||
        message.toLowerCase().contains(
          'an idea-generation run is already active for this owner',
        );
  }

  bool get isGuestLimitReached {
    if (isGenerationAlreadyRunning) {
      return false;
    }

    final normalizedCode = code?.toUpperCase() ?? '';

    final normalizedMessage = message.toLowerCase();

    const limitCodes = <String>{
      'GUEST_GENERATION_LIMIT_REACHED',
      'GUEST_FREE_GENERATION_USED',
      'GUEST_GENERATION_ALREADY_USED',
    };

    return <int>{403, 409, 429}.contains(statusCode) &&
        (limitCodes.contains(normalizedCode) ||
            (normalizedMessage.contains('guest') &&
                (normalizedMessage.contains('limit') ||
                    normalizedMessage.contains('free attempt') ||
                    normalizedMessage.contains('already used') ||
                    normalizedMessage.contains('one-time') ||
                    normalizedMessage.contains('one idea'))));
  }

  @override
  String toString() => message;
}
