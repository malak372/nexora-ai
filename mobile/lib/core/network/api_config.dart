import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Central API and Socket.IO configuration for the Voxidence mobile app.
///
/// Resolves backend URLs for Flutter Web, Android, iOS, and desktop.
///
/// Local development hosts are normalized so Flutter Web and the backend
/// use the same hostname whenever possible. This is especially important
/// for secure browser-managed cookies.
///
/// @author Eman
abstract final class ApiConfig {
  /// Returns true when the application runs natively on Android or iOS.
  static bool get isNativeMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  /// Returns the normalized backend API base URL.
  static String get baseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['API_WEB_BASE_URL'],
        shared: dotenv.env['API_BASE_URL'],
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = dotenv.env['API_ANDROID_BASE_URL']?.trim();

      if (android != null && android.isNotEmpty) {
        return _normalize(android);
      }

      final shared = dotenv.env['API_BASE_URL']?.trim();

      if (shared != null && shared.isNotEmpty) {
        return _androidSafe(shared);
      }

      return 'http://10.0.2.2:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final ios = dotenv.env['API_IOS_BASE_URL']?.trim();

      if (ios != null && ios.isNotEmpty) {
        return _normalize(ios);
      }

      final shared = dotenv.env['API_BASE_URL']?.trim();

      if (shared != null && shared.isNotEmpty) {
        return _normalize(shared);
      }

      return 'http://127.0.0.1:3000';
    }

    final shared = dotenv.env['API_BASE_URL']?.trim();

    if (shared != null && shared.isNotEmpty) {
      return _normalize(shared);
    }

    return 'http://127.0.0.1:3000';
  }

  /// Returns the normalized Socket.IO backend URL.
  static String get socketBaseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['SOCKET_WEB_BASE_URL'],
        shared:
            dotenv.env['SOCKET_BASE_URL'] ??
            dotenv.env['API_WEB_BASE_URL'] ??
            dotenv.env['API_BASE_URL'],
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final androidSocket = dotenv.env['SOCKET_ANDROID_BASE_URL']?.trim();

      if (androidSocket != null && androidSocket.isNotEmpty) {
        return _normalize(androidSocket);
      }

      final androidApi = dotenv.env['API_ANDROID_BASE_URL']?.trim();

      if (androidApi != null && androidApi.isNotEmpty) {
        return _normalize(androidApi);
      }

      final sharedSocket = dotenv.env['SOCKET_BASE_URL']?.trim();

      if (sharedSocket != null && sharedSocket.isNotEmpty) {
        return _androidSafe(sharedSocket);
      }

      final sharedApi = dotenv.env['API_BASE_URL']?.trim();

      if (sharedApi != null && sharedApi.isNotEmpty) {
        return _androidSafe(sharedApi);
      }

      return 'http://10.0.2.2:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final iosSocket = dotenv.env['SOCKET_IOS_BASE_URL']?.trim();

      if (iosSocket != null && iosSocket.isNotEmpty) {
        return _normalize(iosSocket);
      }

      final iosApi = dotenv.env['API_IOS_BASE_URL']?.trim();

      if (iosApi != null && iosApi.isNotEmpty) {
        return _normalize(iosApi);
      }

      final sharedSocket = dotenv.env['SOCKET_BASE_URL']?.trim();

      if (sharedSocket != null && sharedSocket.isNotEmpty) {
        return _normalize(sharedSocket);
      }

      return baseUrl;
    }

    final sharedSocket = dotenv.env['SOCKET_BASE_URL']?.trim();

    if (sharedSocket != null && sharedSocket.isNotEmpty) {
      return _normalize(sharedSocket);
    }

    return baseUrl;
  }

  /// Resolves a browser-safe backend URL.
  static String _resolveWeb({String? explicit, String? shared}) {
    final explicitValue = explicit?.trim();

    if (explicitValue != null && explicitValue.isNotEmpty) {
      return _webSafe(explicitValue);
    }

    final sharedValue = shared?.trim();

    if (sharedValue != null && sharedValue.isNotEmpty) {
      return _webSafe(sharedValue);
    }

    return _browserHostDefault();
  }

  /// Converts local-only backend host aliases to the current browser host.
  ///
  /// For example:
  /// - Flutter Web opened on 127.0.0.1 + API localhost
  /// - Flutter Web opened on localhost + API 10.0.2.2
  ///
  /// will both be normalized to the browser's current host.
  static String _webSafe(String value) {
    final normalized = _normalize(value);

    final uri = Uri.tryParse(normalized);

    if (uri == null || uri.host.trim().isEmpty) {
      return normalized;
    }

    const replaceableLocalHosts = <String>{
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '10.0.2.2',
      '10.0.3.2',
    };

    final apiHost = uri.host.toLowerCase();

    if (!replaceableLocalHosts.contains(apiHost)) {
      return normalized;
    }

    final currentBrowserHost = Uri.base.host.trim();

    if (currentBrowserHost.isEmpty) {
      return normalized;
    }

    return _normalize(uri.replace(host: currentBrowserHost).toString());
  }

  /// Converts localhost URLs into the Android emulator host alias.
  static String _androidSafe(String value) {
    final normalized = _normalize(value);

    final uri = Uri.tryParse(normalized);

    if (uri == null) {
      return normalized;
    }

    if (uri.host != 'localhost' && uri.host != '127.0.0.1') {
      return normalized;
    }

    return _normalize(uri.replace(host: '10.0.2.2').toString());
  }

  /// Returns a development backend URL using the current browser host.
  static String _browserHostDefault() {
    final browserHost = Uri.base.host.trim();

    final host = browserHost.isEmpty ? '127.0.0.1' : browserHost;

    return 'http://$host:3000';
  }

  /// Removes trailing slashes from URLs.
  static String _normalize(String value) {
    return value.trim().replaceAll(RegExp(r'/+$'), '');
  }
}
