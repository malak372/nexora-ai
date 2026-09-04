import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Central API and Socket.IO configuration for the Voxidence app.
///
/// Backend selection can be changed without editing Dart code:
/// - BACKEND_MODE=remote -> deployed backend.
/// - BACKEND_MODE=local  -> local development backend.
///
/// A dart-define can override the .env value when needed:
/// --dart-define=VOXIDENCE_BACKEND_MODE=local
///
/// Localhost rules:
/// - Flutter Web: localhost is rewritten to the browser host when necessary.
/// - Android emulator: localhost is rewritten to 10.0.2.2.
/// - iOS simulator/desktop: localhost remains 127.0.0.1.
/// - Physical phones must use the development computer LAN IP through
///   API_DEVICE_BASE_URL / SOCKET_DEVICE_BASE_URL or the matching dart-define.
///
/// @author Eman
abstract final class ApiConfig {
  static const String _androidEmulatorHost = '10.0.2.2';

  static const String _modeDefine = String.fromEnvironment(
    'VOXIDENCE_BACKEND_MODE',
  );

  static const String _deviceApiDefine = String.fromEnvironment(
    'VOXIDENCE_DEVICE_BASE_URL',
  );

  static const String _deviceSocketDefine = String.fromEnvironment(
    'VOXIDENCE_DEVICE_SOCKET_URL',
  );

  static const Set<String> _localOnlyHosts = <String>{
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.0.2.2',
    '10.0.3.2',
  };

  static bool get isNativeMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  static String get backendMode {
    final define = _modeDefine.trim().toLowerCase();
    if (define == 'local' || define == 'remote') {
      return define;
    }

    final env = dotenv.env['BACKEND_MODE']?.trim().toLowerCase() ?? '';
    if (env == 'local' || env == 'remote') {
      return env;
    }

    return 'remote';
  }

  static bool get isLocalBackend => backendMode == 'local';

  static String get baseUrl =>
      isLocalBackend ? _localApiBaseUrl() : _remoteApiBaseUrl();

  static String get socketBaseUrl =>
      isLocalBackend ? _localSocketBaseUrl() : _remoteSocketBaseUrl();

  static String _remoteApiBaseUrl() {
    if (kIsWeb) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['API_REMOTE_WEB_BASE_URL'],
        dotenv.env['API_WEB_BASE_URL'],
        dotenv.env['API_REMOTE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return configured == null
          ? 'https://voxidence-api.onrender.com'
          : _normalize(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['API_REMOTE_ANDROID_BASE_URL'],
        dotenv.env['API_ANDROID_BASE_URL'],
        dotenv.env['API_REMOTE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return configured == null
          ? 'https://voxidence-api.onrender.com'
          : _normalize(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['API_REMOTE_IOS_BASE_URL'],
        dotenv.env['API_IOS_BASE_URL'],
        dotenv.env['API_REMOTE_BASE_URL'],
        dotenv.env['API_BASE_URL'],
      ]);

      return configured == null
          ? 'https://voxidence-api.onrender.com'
          : _normalize(configured);
    }

    final configured = _firstConfigured(<String?>[
      dotenv.env['API_REMOTE_BASE_URL'],
      dotenv.env['API_BASE_URL'],
    ]);

    return configured == null
        ? 'https://voxidence-api.onrender.com'
        : _normalize(configured);
  }

  static String _localApiBaseUrl() {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['API_LOCAL_WEB_BASE_URL'],
        shared: _firstConfigured(<String?>[
          dotenv.env['API_LOCAL_BASE_URL'],
          'http://127.0.0.1:3000',
        ]),
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final configured = _firstConfigured(<String?>[
        _deviceApiDefine,
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_LOCAL_ANDROID_BASE_URL'],
        dotenv.env['API_LOCAL_BASE_URL'],
        'http://127.0.0.1:3000',
      ])!;

      return _androidSafe(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        _deviceApiDefine,
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_LOCAL_IOS_BASE_URL'],
        dotenv.env['API_LOCAL_BASE_URL'],
        'http://127.0.0.1:3000',
      ])!;

      return _normalize(configured);
    }

    final configured = _firstConfigured(<String?>[
      dotenv.env['API_LOCAL_BASE_URL'],
      'http://127.0.0.1:3000',
    ])!;

    return _normalize(configured);
  }

  static String _remoteSocketBaseUrl() {
    if (kIsWeb) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['SOCKET_REMOTE_WEB_BASE_URL'],
        dotenv.env['SOCKET_WEB_BASE_URL'],
        dotenv.env['SOCKET_REMOTE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
      ]);

      return configured == null ? _remoteApiBaseUrl() : _normalize(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['SOCKET_REMOTE_ANDROID_BASE_URL'],
        dotenv.env['SOCKET_ANDROID_BASE_URL'],
        dotenv.env['SOCKET_REMOTE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
      ]);

      return configured == null ? _remoteApiBaseUrl() : _normalize(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        dotenv.env['SOCKET_REMOTE_IOS_BASE_URL'],
        dotenv.env['SOCKET_IOS_BASE_URL'],
        dotenv.env['SOCKET_REMOTE_BASE_URL'],
        dotenv.env['SOCKET_BASE_URL'],
      ]);

      return configured == null ? _remoteApiBaseUrl() : _normalize(configured);
    }

    final configured = _firstConfigured(<String?>[
      dotenv.env['SOCKET_REMOTE_BASE_URL'],
      dotenv.env['SOCKET_BASE_URL'],
    ]);

    return configured == null ? _remoteApiBaseUrl() : _normalize(configured);
  }

  static String _localSocketBaseUrl() {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['SOCKET_LOCAL_WEB_BASE_URL'],
        shared: _firstConfigured(<String?>[
          dotenv.env['SOCKET_LOCAL_BASE_URL'],
          dotenv.env['API_LOCAL_WEB_BASE_URL'],
          dotenv.env['API_LOCAL_BASE_URL'],
          'http://127.0.0.1:3000',
        ]),
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final configured = _firstConfigured(<String?>[
        _deviceSocketDefine,
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_LOCAL_ANDROID_BASE_URL'],
        dotenv.env['SOCKET_LOCAL_BASE_URL'],
        _deviceApiDefine,
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_LOCAL_ANDROID_BASE_URL'],
        dotenv.env['API_LOCAL_BASE_URL'],
        'http://127.0.0.1:3000',
      ])!;

      return _androidSafe(configured);
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final configured = _firstConfigured(<String?>[
        _deviceSocketDefine,
        dotenv.env['SOCKET_DEVICE_BASE_URL'],
        dotenv.env['SOCKET_LOCAL_IOS_BASE_URL'],
        dotenv.env['SOCKET_LOCAL_BASE_URL'],
        _deviceApiDefine,
        dotenv.env['API_DEVICE_BASE_URL'],
        dotenv.env['API_LOCAL_IOS_BASE_URL'],
        dotenv.env['API_LOCAL_BASE_URL'],
        'http://127.0.0.1:3000',
      ])!;

      return _normalize(configured);
    }

    final configured = _firstConfigured(<String?>[
      dotenv.env['SOCKET_LOCAL_BASE_URL'],
      dotenv.env['API_LOCAL_BASE_URL'],
      'http://127.0.0.1:3000',
    ])!;

    return _normalize(configured);
  }

  static String? _firstConfigured(List<String?> values) {
    for (final raw in values) {
      final value = raw?.trim();
      if (value != null && value.isNotEmpty) {
        return value;
      }
    }

    return null;
  }

  static String _resolveWeb({
    String? explicit,
    String? shared,
  }) {
    final configured = _firstConfigured(<String?>[explicit, shared]);

    if (configured == null) {
      return _browserHostDefault();
    }

    return _webSafe(configured);
  }

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
      return _normalize(uri.replace(host: '127.0.0.1').toString());
    }

    final browserHostLower = browserHost.toLowerCase();

    if (browserHostLower == 'localhost' ||
        browserHostLower == '127.0.0.1') {
      return _normalize(uri.replace(host: '127.0.0.1').toString());
    }

    if (browserHostLower == '10.0.2.2' ||
        browserHostLower == '10.0.3.2' ||
        browserHostLower == '0.0.0.0') {
      return normalized;
    }

    return _normalize(uri.replace(host: browserHost).toString());
  }

  static String _androidSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);

    if (uri == null || uri.host.trim().isEmpty) {
      return normalized;
    }

    final host = uri.host.toLowerCase();

    if (host != 'localhost' && host != '127.0.0.1' && host != '0.0.0.0') {
      return normalized;
    }

    return _normalize(uri.replace(host: _androidEmulatorHost).toString());
  }

  static String _browserHostDefault() {
    final browserHost = Uri.base.host.trim();

    if (browserHost.isEmpty ||
        browserHost.toLowerCase() == 'localhost' ||
        browserHost.toLowerCase() == '127.0.0.1') {
      return 'http://127.0.0.1:3000';
    }

    return 'http://$browserHost:3000';
  }

  static String _normalize(String value) {
    return value.trim().replaceAll(RegExp(r'/+$'), '');
  }
}
