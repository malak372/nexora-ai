import 'dart:async';

import 'package:dio/dio.dart';

import '../../features/auth/api/auth_api.dart';
import '../../features/auth/session/auth_session_store.dart';
import 'api_config.dart';
import 'dio_browser_credentials.dart';

/// Shared authenticated API client used for protected backend requests.
///
/// The client automatically attaches the current access token to outgoing
/// requests. If a protected request returns HTTP 401, it attempts to refresh
/// the authentication session and retry the original request once.
///
/// Multiple simultaneous 401 responses share the same token-refresh process
/// to avoid sending duplicate refresh requests to the backend.
///
/// @author Eman
class AuthenticatedApiClient {
  AuthenticatedApiClient._() {
    enableBrowserCredentials(_dio);

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Attach the current access token to the outgoing request.
          final token = await AuthSessionStore.instance.getAccessToken();

          if (token != null && token.trim().isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }

          handler.next(options);
        },
        onError: (error, handler) async {
          final statusCode = error.response?.statusCode;

          final alreadyRetried =
              error.requestOptions.extra['_authRetried'] == true;

          final isAuthEndpoint = error.requestOptions.path.startsWith('/auth/');

          // Only refresh authentication for unauthorized protected requests
          // that have not already been retried.
          if (statusCode != 401 || alreadyRetried || isAuthEndpoint) {
            handler.next(error);
            return;
          }

          try {
            final refreshed = await _refreshTokensOnce();

            if (!refreshed) {
              handler.next(error);
              return;
            }

            final nextToken = await AuthSessionStore.instance.getAccessToken();

            if (nextToken == null || nextToken.trim().isEmpty) {
              handler.next(error);
              return;
            }

            final request = error.requestOptions;

            // Mark the request so it cannot enter an infinite retry loop.
            request.extra['_authRetried'] = true;

            request.headers['Authorization'] = 'Bearer $nextToken';

            final response = await _dio.fetch<dynamic>(request);

            handler.resolve(response);
          } on DioException catch (refreshError) {
            handler.next(refreshError);
          } on AuthException {
            handler.next(error);
          }
        },
      ),
    );
  }

  /// Shared singleton instance used throughout the application.
  static final AuthenticatedApiClient instance = AuthenticatedApiClient._();

  /// Dio client configured with the backend base URL, default headers,
  /// and network timeouts.
  final Dio _dio = Dio(
    BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 25),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 30),
      headers: const {'Content-Type': 'application/json'},
    ),
  );

  /// Tracks the currently running token-refresh operation.
  ///
  /// This prevents multiple simultaneous requests from triggering
  /// duplicate refresh requests when they all receive HTTP 401.
  Completer<bool>? _refreshCompleter;

  /// Exposes the configured authenticated Dio instance.
  Dio get dio => _dio;

  /// Sends an authenticated GET request to [path].
  ///
  /// The response body is returned as a [Map<String, dynamic>].
  /// If the response body is not a map, an empty map is returned.
  Future<Map<String, dynamic>> getMap(String path) async {
    final response = await _dio.get<dynamic>(path);

    final data = response.data;

    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }

    return <String, dynamic>{};
  }

  /// Refreshes the authentication session while preventing duplicate
  /// refresh operations.
  ///
  /// If another refresh request is already running, this method waits for
  /// the existing operation and returns its result.
  ///
  /// Otherwise, a new refresh operation is started through [AuthApi].
  Future<bool> _refreshTokensOnce() async {
    final existing = _refreshCompleter;

    if (existing != null) {
      return existing.future;
    }

    final completer = Completer<bool>();
    _refreshCompleter = completer;

    try {
      final refreshed = await AuthApi.instance.refreshSession();

      completer.complete(refreshed);

      return refreshed;
    } catch (error, stackTrace) {
      completer.completeError(error, stackTrace);

      rethrow;
    } finally {
      _refreshCompleter = null;
    }
  }
}
