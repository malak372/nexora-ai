import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/network/api_config.dart';
import '../../../core/network/dio_browser_credentials.dart';
import '../models/public_publication.dart';

/// Public Home API used by the Voxidence mobile application.
///
/// It mirrors the public web requests for:
/// - Featured publications.
/// - Public publication details.
/// - Contact Us submissions.
/// - Guest publication ratings, votes, and feedback.
///
/// @author Eman
class HomePublicApi {
  HomePublicApi._() {
    enableBrowserCredentials(_dio);
  }

  static final HomePublicApi instance = HomePublicApi._();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static const String _cookieStorageKey = 'guest_session_cookie';

  static const String _cookieName = 'nexora_guest_session';

  String? _guestCookieMemory;
  bool _guestCookieHydrated = false;
  Future<void>? _guestSessionFuture;

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 25),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 30),
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ),
  );

  Future<PublicPublicationPage> getFeaturedPublications({int limit = 3}) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/publications',
        queryParameters: {
          'page': 1,
          'limit': limit,
          'sortBy': 'publishedAt',
          'sortOrder': 'desc',
        },
      );

      return PublicPublicationPage.fromJson(
        response.data ?? const <String, dynamic>{},
      );
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<PublicPublication> getPublicPublication(String publicationId) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/publications/$publicationId',
      );

      return PublicPublication.fromJson(
        response.data ?? const <String, dynamic>{},
      );
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<Map<String, dynamic>> submitContactMessage({
    required String fullName,
    required String email,
    required String subject,
    required String message,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/contact',
        data: {
          'fullName': fullName.trim(),
          'email': email.trim().toLowerCase(),
          'subject': subject.trim(),
          'message': message.trim(),
        },
      );

      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<void> ensureGuestSession({bool force = false}) async {
    if (!force) {
      final existingCookie = await _readGuestCookie();
      if (existingCookie != null && existingCookie.isNotEmpty) {
        return;
      }

      final inFlight = _guestSessionFuture;
      if (inFlight != null) {
        return inFlight;
      }
    }

    final request = _createGuestSession();
    _guestSessionFuture = request;

    try {
      await request;
    } finally {
      if (identical(_guestSessionFuture, request)) {
        _guestSessionFuture = null;
      }
    }
  }

  Future<void> _createGuestSession() async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/guest-session',
        options: await _optionsWithGuestCookie(),
      );

      await _saveGuestCookie(response.headers);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<int> getGuestRating(String publicationId) async {
    final data = await _guestGet('/publications/$publicationId/guest-rating');

    return _asInt(data['value']);
  }

  Future<void> setGuestRating(String publicationId, int value) async {
    await _guestPut(
      '/publications/$publicationId/guest-rating',
      <String, dynamic>{'value': value},
    );
  }

  Future<String> getGuestVote(String publicationId) async {
    final data = await _guestGet('/publications/$publicationId/guest-vote');

    return data['value']?.toString().trim().toUpperCase() ?? '';
  }

  Future<void> setGuestVote(String publicationId, String value) async {
    await _guestPut(
      '/publications/$publicationId/guest-vote',
      <String, dynamic>{'value': value.trim().toUpperCase()},
    );
  }

  Future<String> getGuestFeedback(String publicationId) async {
    final data = await _guestGet('/publications/$publicationId/guest-feedback');

    return data['comment']?.toString() ?? '';
  }

  Future<void> setGuestFeedback(String publicationId, String comment) async {
    await _guestPut(
      '/publications/$publicationId/guest-feedback',
      <String, dynamic>{'comment': comment.trim()},
    );
  }

  Future<Map<String, dynamic>> _guestGet(
    String path, {
    bool retrySession = true,
  }) async {
    try {
      final response = await _dio.get<dynamic>(
        path,
        options: await _optionsWithGuestCookie(),
      );

      final data = response.data;

      if (data is Map) {
        return Map<String, dynamic>.from(data);
      }

      return <String, dynamic>{};
    } on DioException catch (error) {
      final status = error.response?.statusCode;

      if (status == 404) {
        return <String, dynamic>{};
      }

      if (retrySession && (status == 401 || status == 403)) {
        await _refreshGuestSession();
        return _guestGet(path, retrySession: false);
      }

      throw _toException(error);
    }
  }

  Future<void> _guestPut(
    String path,
    Map<String, dynamic> data, {
    bool retrySession = true,
  }) async {
    try {
      await _dio.put<dynamic>(
        path,
        data: data,
        options: await _optionsWithGuestCookie(),
      );
    } on DioException catch (error) {
      final status = error.response?.statusCode;

      if (retrySession && (status == 401 || status == 403)) {
        await _refreshGuestSession();
        await _guestPut(path, data, retrySession: false);
        return;
      }

      throw _toException(error);
    }
  }

  Future<void> _refreshGuestSession() async {
    _guestCookieMemory = null;
    _guestCookieHydrated = true;
    await _storage.delete(key: _cookieStorageKey);
    await ensureGuestSession(force: true);
  }

  Future<Options> _optionsWithGuestCookie() async {
    final cookie = await _readGuestCookie();

    if (cookie == null || cookie.isEmpty) {
      return Options();
    }

    return Options(headers: <String, dynamic>{'Cookie': cookie});
  }

  Future<String?> _readGuestCookie() async {
    if (_guestCookieHydrated) {
      return _guestCookieMemory;
    }

    final stored = await _storage.read(key: _cookieStorageKey);
    final cookie = stored?.trim();

    _guestCookieMemory = cookie == null || cookie.isEmpty ? null : cookie;
    _guestCookieHydrated = true;

    return _guestCookieMemory;
  }

  Future<void> _saveGuestCookie(Headers headers) async {
    final setCookies = headers.map['set-cookie'] ?? const <String>[];

    for (final rawCookie in setCookies) {
      final firstPart = rawCookie.split(';').first.trim();

      if (firstPart.startsWith('$_cookieName=')) {
        _guestCookieMemory = firstPart;
        _guestCookieHydrated = true;
        await _storage.write(key: _cookieStorageKey, value: firstPart);

        return;
      }
    }
  }

  HomePublicException _toException(DioException error) {
    final data = error.response?.data;

    var message = 'We could not complete this request. Please try again.';

    if (data is Map) {
      final serverMessage = data['message'];

      if (serverMessage is List && serverMessage.isNotEmpty) {
        message = serverMessage.first.toString();
      } else if (serverMessage is String && serverMessage.trim().isNotEmpty) {
        message = serverMessage.trim();
      }
    }

    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.connectionError) {
      message =
          'Unable to reach the server. Check your connection and try again.';
    } else if (error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      message = 'The request took too long. Please try again.';
    }

    return HomePublicException(
      message: message,
      statusCode: error.response?.statusCode,
    );
  }

  int _asInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}

class HomePublicException implements Exception {
  const HomePublicException({required this.message, this.statusCode});

  final String message;
  final int? statusCode;

  bool get isNotFound => statusCode == 404;

  @override
  String toString() => message;
}
