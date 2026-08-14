// Authenticated Dio client with refresh-token rotation, short memory caching,
// overlapping GET request de-duplication, and resilient response-envelope
// handling shared by all Voxidence mobile user screens.
//
// @author  Malak

import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../navigation/app_navigator.dart';
import '../storage/session_store.dart';
import 'api_config.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class _CacheEntry {
  const _CacheEntry(this.value, this.expiresAt);

  final dynamic value;
  final DateTime expiresAt;
}

class ApiClient {
  ApiClient._() {
    _dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 22),
        sendTimeout: const Duration(seconds: 15),
        headers: const {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      ),
    );

    _refreshDio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 15),
        headers: const {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await SessionStore.instance.getAccessToken();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          final unauthorized = error.response?.statusCode == 401;
          final alreadyRetried = request.extra['voxidence_retry'] == true;
          final isRefresh = request.path.contains('/auth/refresh');

          if (!unauthorized || alreadyRetried || isRefresh) {
            handler.next(error);
            return;
          }

          try {
            final accessToken = await _refreshAccessToken();
            request.extra['voxidence_retry'] = true;
            request.headers['Authorization'] = 'Bearer $accessToken';
            final response = await _dio.fetch<dynamic>(request);
            handler.resolve(response);
          } catch (_) {
            await SessionStore.instance.clear();
            clearCache();
            AppNavigator.goToLogin();
            handler.next(error);
          }
        },
      ),
    );
  }

  static final ApiClient instance = ApiClient._();

  static String get baseUrl => ApiConfig.baseUrl;

  late final Dio _dio;
  late final Dio _refreshDio;

  final Map<String, _CacheEntry> _cache = {};
  final Map<String, Future<dynamic>> _inFlightGets = {};
  Future<String>? _refreshFuture;

  /// Removes ordinary HTTP/Nest response wrappers while preserving paginated
  /// envelopes. A response such as `{ data: [...], meta: { total: 222 } }`
  /// must stay intact so list screens can read the real total and totalPages.
  ///
  /// The previous implementation unwrapped that response to the nine visible
  /// rows only, which made My Ideas report `9 ideas` even when the account had
  /// hundreds of ideas.
  dynamic unwrap(dynamic value) {
    dynamic current = value;

    for (var i = 0; i < 4; i++) {
      if (current is! Map || !current.containsKey('data')) break;

      final map = Map<String, dynamic>.from(current);
      final keys = map.keys.toSet();
      const wrapperKeys = {
        'data',
        'success',
        'message',
        'meta',
        'pagination',
        'statusCode',
        'timestamp',
      };

      final looksLikeEnvelope =
          map.length == 1 || keys.every(wrapperKeys.contains);
      if (!looksLikeEnvelope) break;

      final data = map['data'];
      final hasPagination =
          map['meta'] is Map ||
          map['pagination'] is Map;

      // Preserve paginated list envelopes. UserApi._paged() understands both
      // `meta` and `pagination` and needs those fields to expose all pages.
      if (hasPagination && data is List) {
        return map;
      }

      // Some backends wrap an object that itself contains items + metadata.
      // Unwrap one level and allow the next iteration to preserve that inner
      // paginated envelope when appropriate.
      current = data;
    }

    return current;
  }

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? query,
    Duration cacheFor = Duration.zero,
    bool force = false,
  }) async {
    final cacheKey = _requestKey(path, query);
    final cached = _cache[cacheKey];

    if (!force && cached != null && cached.expiresAt.isAfter(DateTime.now())) {
      return cached.value;
    }

    final existing = _inFlightGets[cacheKey];
    if (!force && existing != null) return existing;

    final request = () async {
      try {
        final response = await _dio.get<dynamic>(path, queryParameters: query);
        final value = unwrap(response.data);
        if (cacheFor > Duration.zero) {
          _cache[cacheKey] = _CacheEntry(value, DateTime.now().add(cacheFor));
        }
        return value;
      } on DioException catch (error) {
        throw _toException(error);
      } finally {
        _inFlightGets.remove(cacheKey);
      }
    }();

    _inFlightGets[cacheKey] = request;
    return request;
  }

  Future<List<int>> getBytes(String path, {Map<String, dynamic>? query}) async {
    try {
      final response = await _dio.get<List<int>>(
        path,
        queryParameters: query,
        options: Options(responseType: ResponseType.bytes),
      );
      return response.data ?? const <int>[];
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<String> getText(String path, {Map<String, dynamic>? query}) async {
    try {
      final response = await _dio.get<String>(
        path,
        queryParameters: query,
        options: Options(
          responseType: ResponseType.plain,
          headers: const {'Accept': 'text/html,text/plain,*/*'},
        ),
      );
      return response.data ?? '';
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<dynamic> patchMultipart(
    String path, {
    required String fieldName,
    required List<int> bytes,
    required String fileName,
  }) async {
    try {
      final form = FormData.fromMap({
        fieldName: MultipartFile.fromBytes(bytes, filename: fileName),
      });
      final response = await _dio.patch<dynamic>(
        path,
        data: form,
        options: Options(contentType: 'multipart/form-data'),
      );
      return unwrap(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<dynamic> post(
    String path, {
    dynamic data,
    Duration? receiveTimeout,
  }) async {
    try {
      final response = await _dio.post<dynamic>(
        path,
        data: data,
        options: receiveTimeout == null
            ? null
            : Options(receiveTimeout: receiveTimeout),
      );
      return unwrap(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<dynamic> put(String path, {dynamic data}) async {
    try {
      final response = await _dio.put<dynamic>(path, data: data);
      return unwrap(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<dynamic> patch(String path, {dynamic data, Options? options}) async {
    try {
      final response = await _dio.patch<dynamic>(
        path,
        data: data,
        options: options,
      );
      return unwrap(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  Future<dynamic> delete(String path, {dynamic data}) async {
    try {
      final response = await _dio.delete<dynamic>(path, data: data);
      return unwrap(response.data);
    } on DioException catch (error) {
      throw _toException(error);
    }
  }

  void invalidate(String pathPrefix) {
    _cache.removeWhere((key, _) => key.contains(pathPrefix));
  }

  void clearCache() {
    _cache.clear();
    _inFlightGets.clear();
  }

  Future<String> _refreshAccessToken() {
    final existing = _refreshFuture;
    if (existing != null) return existing;

    final request = () async {
      final refreshToken = await SessionStore.instance.getRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        throw const ApiException('Your session has expired.', statusCode: 401);
      }

      try {
        final response = await _refreshDio.post<dynamic>(
          '/auth/refresh',
          data: {'refreshToken': refreshToken},
        );
        final payload = unwrap(response.data);
        if (payload is! Map) {
          throw const ApiException('Invalid refresh response.');
        }

        final access = payload['accessToken']?.toString() ?? '';
        final refresh = payload['refreshToken']?.toString() ?? '';
        if (access.isEmpty || refresh.isEmpty) {
          throw const ApiException('Invalid refresh response.');
        }

        await SessionStore.instance.saveTokens(
          accessToken: access,
          refreshToken: refresh,
        );
        return access;
      } on DioException catch (error) {
        throw _toException(error);
      }
    }();

    _refreshFuture = request.whenComplete(() => _refreshFuture = null);
    return _refreshFuture!;
  }

  String _requestKey(String path, Map<String, dynamic>? query) {
    final normalized = <String, dynamic>{};
    final keys = <String>[...?query?.keys];
    keys.sort();
    for (final key in keys) {
      final value = query![key];
      if (value != null) normalized[key] = value;
    }
    return '$path?${jsonEncode(normalized)}';
  }

  ApiException _toException(DioException error) {
    final message =
        _extractMessage(error.response?.data) ??
        switch (error.type) {
          DioExceptionType.connectionTimeout ||
          DioExceptionType.connectionError =>
            'Unable to reach the server at $baseUrl. Check the API address and your connection.',
          DioExceptionType.receiveTimeout =>
            'The server took too long to respond. Please try again.',
          DioExceptionType.badCertificate =>
            'The server certificate could not be verified.',
          _ => 'Something went wrong. Please try again.',
        };

    return ApiException(message, statusCode: error.response?.statusCode);
  }

  String? _extractMessage(dynamic data) {
    dynamic current = data;

    for (var i = 0; i < 4; i++) {
      if (current is Map) {
        final raw = current['message'];
        if (raw is List) {
          final text = raw.join(' ').trim();
          if (text.isNotEmpty) return text;
        }
        if (raw is String && raw.trim().isNotEmpty) return raw.trim();
        if (raw is Map) {
          current = raw;
          continue;
        }
        if (current['error'] is String &&
            current['error'].toString().trim().isNotEmpty) {
          return current['error'].toString().trim();
        }
        if (current.containsKey('data')) {
          current = current['data'];
          continue;
        }
      }
      break;
    }

    return null;
  }
}
