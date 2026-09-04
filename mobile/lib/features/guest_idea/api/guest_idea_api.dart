import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../../core/network/api_config.dart';
import '../../../core/network/dio_browser_credentials.dart';
import '../../../core/storage/platform_key_value_store.dart';

/// Handles guest idea-generation API requests.
///
/// On Flutter Web, the browser manages the secure HttpOnly guest cookie.
/// On native platforms, the cookie value is stored securely and forwarded
/// manually with guest requests.
///
/// @author Eman
class GuestIdeaApi {
  GuestIdeaApi._() {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: const Duration(seconds: 25),
        receiveTimeout: const Duration(seconds: 60),
        sendTimeout: const Duration(seconds: 30),
        headers: const <String, dynamic>{
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      ),
    );

    enableBrowserCredentials(_dio);
  }

  static final GuestIdeaApi instance = GuestIdeaApi._();

  static final PlatformKeyValueStore _storage = PlatformKeyValueStore.instance;

  static const String _cookieStorageKey = 'guest_session_cookie';

  static const String _cookieName = 'nexora_guest_session';

  late final Dio _dio;

  /// Creates or restores the backend guest session.
  ///
  /// Web:
  /// The browser receives and stores the HttpOnly cookie automatically.
  ///
  /// Native:
  /// The Set-Cookie response header is read and the cookie is stored in
  /// secure storage for later requests.
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
  ///
  /// If the backend reports that the guest session cookie is missing,
  /// the API recreates/restores the guest session once and retries the
  /// generation request.
  Future<Map<String, dynamic>> generateIdea(
    Map<String, dynamic> payload,
  ) async {
    try {
      return await _postGenerateIdea(payload);
    } on DioException catch (error) {
      final firstException = _toException(error);

      if (!firstException.isGuestSessionRequired) {
        throw firstException;
      }

      await ensureGuestSession();

      try {
        return await _postGenerateIdea(payload);
      } on DioException catch (retryError) {
        throw _toException(retryError);
      }
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

  Future<Map<String, dynamic>> _postGenerateIdea(
    Map<String, dynamic> payload,
  ) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/guest/ideas/generate',
      data: payload,
      options: await _optionsWithGuestCookie(),
    );

    return response.data ?? <String, dynamic>{};
  }

  /// Creates guest-request options.
  ///
  /// Web browsers do not allow JavaScript/Dart code to manually set the
  /// Cookie header. BrowserHttpClientAdapter handles that automatically
  /// when withCredentials is enabled.
  ///
  /// Native applications can attach the stored cookie manually.
  Future<Options> _optionsWithGuestCookie() async {
    if (kIsWeb) {
      return Options();
    }

    final cookie = await _storage.read(_cookieStorageKey);

    if (cookie == null || cookie.trim().isEmpty) {
      return Options();
    }

    return Options(headers: <String, dynamic>{'Cookie': cookie});
  }

  /// Saves the guest cookie on native platforms.
  ///
  /// Web browsers intentionally hide HttpOnly cookies from frontend code,
  /// so there is nothing to persist manually in Web builds.
  Future<void> _saveGuestCookie(Headers headers) async {
    if (kIsWeb) {
      return;
    }

    final setCookies = headers.map['set-cookie'] ?? const <String>[];

    for (final rawCookie in setCookies) {
      final firstPart = rawCookie.split(';').first.trim();

      if (!firstPart.startsWith('$_cookieName=')) {
        continue;
      }

      await _storage.write(_cookieStorageKey, firstPart);

      return;
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

    var message = 'We could not complete this request. Please try again.';

    if (data is Map) {
      final map = Map<String, dynamic>.from(data);

      code = map['code']?.toString();

      activeRunId = map['activeRunId']?.toString();

      final rawMessage = map['message'];

      if (rawMessage is List) {
        message = rawMessage.map((item) => item.toString()).join(' ');
      } else if (rawMessage is String && rawMessage.trim().isNotEmpty) {
        message = rawMessage.trim();
      }
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout) {
      message =
          'Unable to reach the server. '
          'Check your connection and try again.';
    } else if (error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      message = 'The request took too long. Please try again.';
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

  bool get isGuestSessionRequired {
    final normalizedCode = code?.trim().toUpperCase() ?? '';

    final normalizedMessage = message.toLowerCase();

    return normalizedCode == 'GUEST_SESSION_REQUIRED' ||
        (statusCode == 401 &&
            normalizedMessage.contains('valid guest session'));
  }

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
