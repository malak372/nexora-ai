import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Central API and Socket.IO configuration for the Voxidence mobile app.
///
/// Development URL rules:
/// - Flutter Web follows the browser host when a local-only host is configured.
/// - Android emulator rewrites localhost / 127.0.0.1 to 10.0.2.2.
/// - Physical devices should use the development computer LAN IP through the
///   platform-specific environment variable.
///
/// @author Eman
abstract final class ApiConfig {
  static const _androidEmulatorHost = '10.0.2.2';

  static const _localOnlyHosts = <String>{
    'localhost',
    '127.0.0.1',
    '10.0.2.2',
    '10.0.3.2',
  };

  /// Returns true for native Android or iOS builds.
  static bool get isNativeMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  /// Resolved backend HTTP base URL.
  ///
  /// Preferred environment variables:
  /// - Web: API_WEB_BASE_URL, then API_BASE_URL.
  /// - Android: API_ANDROID_BASE_URL, then API_BASE_URL.
  /// - iOS: API_IOS_BASE_URL, then API_BASE_URL.
  /// - Desktop: API_BASE_URL.
  static String get baseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['API_WEB_BASE_URL'],
        shared: dotenv.env['API_BASE_URL'],
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final explicit = _firstConfigured(<String?>[
        dotenv.env['API_ANDROID_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      if (explicit != null) {
        return _androidSafe(explicit);
      }

      return 'http://$_androidEmulatorHost:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final explicit = _firstConfigured(<String?>[
        dotenv.env['API_IOS_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      if (explicit != null) {
        return _normalize(explicit);
      }

      return 'http://127.0.0.1:3000';
    }

    final shared = _firstConfigured(<String?>[dotenv.env['API_BASE_URL']]);

    return shared == null ? 'http://127.0.0.1:3000' : _normalize(shared);
  }

  /// Resolved Socket.IO backend URL.
  static String get socketBaseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['SOCKET_WEB_BASE_URL'],
        shared: _firstConfigured(<String?>[
          dotenv.env['SOCKET_BASE_URL'],
          dotenv.env['API_WEB_BASE_URL'],
          dotenv.env['API_BASE_URL'],
        ]),
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final explicit = _firstConfigured(<String?>[
        dotenv.env['SOCKET_ANDROID_BASE_URL'],
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
        dotenv.env['API_ANDROID_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      if (explicit != null) {
        return _androidSafe(explicit);
      }

      return 'http://$_androidEmulatorHost:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final explicit = _firstConfigured(<String?>[
        dotenv.env['SOCKET_IOS_BASE_URL'],
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
        dotenv.env['API_IOS_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return explicit == null ? 'http://127.0.0.1:3000' : _normalize(explicit);
    }

    final shared = _firstConfigured(<String?>[
      dotenv.env['SOCKET_BASE_URL'],
      dotenv.env['API_BASE_URL'],
    ]);

    return shared == null ? baseUrl : _normalize(shared);
  }

  /// Chooses the first non-empty environment value.
  static String? _firstConfigured(List<String?> values) {
    for (final raw in values) {
      final value = raw?.trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return null;
  }

  /// Resolves a backend URL that is reachable from the current browser host.
  static String _resolveWeb({String? explicit, String? shared}) {
    final configured = _firstConfigured(<String?>[explicit, shared]);
    if (configured == null) return _browserHostDefault();
    return _webSafe(configured);
  }

  /// Resolves local Flutter Web API URLs to a browser-reachable host.
  ///
  /// Chrome can resolve `localhost` to IPv6 (`::1`) while the Nest server is
  /// listening on IPv4 (`0.0.0.0`). Using `127.0.0.1` for same-machine web
  /// development avoids that mismatch. When Flutter Web is opened through a
  /// LAN address, the browser host is used so another device can reach the
  /// same backend machine.
  static String _webSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);

    if (uri == null || !_localOnlyHosts.contains(uri.host.toLowerCase())) {
      return normalized;
    }

    final browserHost = Uri.base.host.trim();
    if (browserHost.isEmpty) {
      return _normalize(uri.replace(host: '127.0.0.1').toString());
    }

    final browserHostLower = browserHost.toLowerCase();

    if (browserHostLower == 'localhost' ||
        browserHostLower == '127.0.0.1') {
      return _normalize(uri.replace(host: '127.0.0.1').toString());
    }

    if (_localOnlyHosts.contains(browserHostLower)) {
      return normalized;
    }

    return _normalize(uri.replace(host: browserHost).toString());
  }

  /// Converts localhost into the Android emulator host alias.
  ///
  /// For a physical Android phone, set API_ANDROID_BASE_URL to the computer's
  /// LAN address, for example http://192.168.1.20:3000.
  static String _androidSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);

    if (uri == null) return normalized;

    final host = uri.host.toLowerCase();
    if (host != 'localhost' && host != '127.0.0.1') {
      return normalized;
    }

    return _normalize(uri.replace(host: _androidEmulatorHost).toString());
  }

  /// Returns a local-development URL using the current Flutter Web host.
  static String _browserHostDefault() {
    final browserHost = Uri.base.host.trim();

    if (browserHost.isEmpty || browserHost.toLowerCase() == 'localhost') {
      return 'http://127.0.0.1:3000';
    }

    return 'http://$browserHost:3000';
  }

  /// Trims whitespace and trailing slashes from a base URL.
  static String _normalize(String value) {
    return value.trim().replaceAll(RegExp(r'/+$'), '');
  }
}
