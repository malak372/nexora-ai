import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Central API and Socket.IO configuration for the Voxidence mobile app.
///
/// Resolves backend URLs for Flutter Web, Android, iOS, and desktop.
///
/// Development URL rules:
/// - Flutter Web follows the browser host when a local-only host is configured.
/// - Android emulator rewrites localhost / 127.0.0.1 / 0.0.0.0 to 10.0.2.2.
/// - Physical devices should use the development computer LAN IP through the
///   platform-specific or device-specific environment variable.
/// - iOS uses the configured iOS/device/shared URL, with localhost as fallback.
///
/// @author Eman
abstract final class ApiConfig {
  static const String _androidEmulatorHost = '10.0.2.2';

  static const Set<String> _localOnlyHosts = <String>{
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.0.2.2',
    '10.0.3.2',
  };

  /// Returns true when the application runs natively on Android or iOS.
  static bool get isNativeMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  /// Returns the resolved and normalized backend API base URL.
  ///
  /// Environment variable priority:
  /// - Web:
  ///   API_WEB_BASE_URL -> API_BASE_URL
  /// - Android:
  ///   API_ANDROID_BASE_URL -> API_DEVICE_BASE_URL -> API_BASE_URL
  /// - iOS:
  ///   API_IOS_BASE_URL -> API_DEVICE_BASE_URL -> API_BASE_URL
  /// - Desktop:
  ///   API_BASE_URL
  static String get baseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['API_WEB_BASE_URL'],
        shared: dotenv.env['API_BASE_URL'],
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['API_ANDROID_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      if (configured != null) {
        return _androidSafe(configured);
      }

      return 'http://$_androidEmulatorHost:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['API_IOS_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return configured == null
          ? 'http://127.0.0.1:3000'
          : _normalize(configured);
    }

    final shared = _firstConfigured(<String?>[
      dotenv.env['API_BASE_URL'],
    ]);

    return shared == null
        ? 'http://127.0.0.1:3000'
        : _normalize(shared);
  }

  /// Returns the resolved and normalized Socket.IO backend URL.
  ///
  /// Socket-specific variables are preferred first. When they are not
  /// configured, the matching API URL is used as a fallback.
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
      final configured = _firstConfigured(<String?>[
        dotenv.env['SOCKET_ANDROID_BASE_URL'],
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
        dotenv.env['API_ANDROID_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      if (configured != null) {
        return _androidSafe(configured);
      }

      return 'http://$_androidEmulatorHost:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['SOCKET_IOS_BASE_URL'],
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
        dotenv.env['API_IOS_BASE_URL'],
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return configured == null
          ? 'http://127.0.0.1:3000'
          : _normalize(configured);
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

      if (value != null && value.isNotEmpty) {
        return value;
      }
    }

    return null;
  }

  /// Resolves a browser-safe backend URL.
  ///
  /// If the configured URL points to a local-only address, it is rewritten to
  /// the hostname currently used to open Flutter Web. This allows the same web
  /// build to work from localhost and from another device on the local network.
  static String _resolveWeb({
    String? explicit,
    String? shared,
  }) {
    final configured = _firstConfigured(<String?>[
      explicit,
      shared,
    ]);

    if (configured == null) {
      return _browserHostDefault();
    }

    return _webSafe(configured);
  }

  /// Converts local-only backend host aliases to a browser-reachable host.
  ///
  /// Examples:
  /// - Browser opened on localhost + API localhost -> 127.0.0.1
  /// - Browser opened through a LAN IP + API localhost -> browser LAN IP
  /// - API already configured with a remote/LAN host -> preserved as-is
  static String _webSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);

    if (uri == null || uri.host.trim().isEmpty) {
      return normalized;
    }

    final apiHost = uri.host.toLowerCase();

    if (!_localOnlyHosts.contains(apiHost)) {
      return normalized;
    }

    final browserHost = Uri.base.host.trim();

    if (browserHost.isEmpty) {
      return _normalize(
        uri.replace(host: '127.0.0.1').toString(),
      );
    }

    final browserHostLower = browserHost.toLowerCase();

    if (browserHostLower == 'localhost' ||
        browserHostLower == '127.0.0.1') {
      return _normalize(
        uri.replace(host: '127.0.0.1').toString(),
      );
    }

    // If Flutter Web itself is opened through another local alias, preserve
    // the configured URL rather than producing another emulator-only address.
    if (browserHostLower == '10.0.2.2' ||
        browserHostLower == '10.0.3.2' ||
        browserHostLower == '0.0.0.0') {
      return normalized;
    }

    return _normalize(
      uri.replace(host: browserHost).toString(),
    );
  }

  /// Converts local backend aliases into the Android emulator host alias.
  ///
  /// For a physical Android phone, configure API_ANDROID_BASE_URL or
  /// API_DEVICE_BASE_URL with the development computer LAN address, for example:
  /// http://192.168.1.20:3000
  static String _androidSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);

    if (uri == null || uri.host.trim().isEmpty) {
      return normalized;
    }

    final host = uri.host.toLowerCase();

    if (host != 'localhost' &&
        host != '127.0.0.1' &&
        host != '0.0.0.0') {
      return normalized;
    }

    return _normalize(
      uri.replace(host: _androidEmulatorHost).toString(),
    );
  }

  /// Returns a local-development URL using the current Flutter Web host.
  static String _browserHostDefault() {
    final browserHost = Uri.base.host.trim();

    if (browserHost.isEmpty ||
        browserHost.toLowerCase() == 'localhost' ||
        browserHost.toLowerCase() == '127.0.0.1') {
      return 'http://127.0.0.1:3000';
    }

    return 'http://$browserHost:3000';
  }

  /// Trims whitespace and removes trailing slashes from a base URL.
  static String _normalize(String value) {
    return value.trim().replaceAll(RegExp(r'/+$'), '');
  }
}
