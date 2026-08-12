// Central API and Socket.IO configuration for Voxidence mobile.
//
// The same Flutter project can run in Chrome, Android emulator, iOS, desktop,
// or a physical device. Android emulator aliases are never used by Flutter Web.
//
// @author  Malak

import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

abstract final class ApiConfig {
  static String get baseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['API_WEB_BASE_URL'],
        shared: dotenv.env['API_BASE_URL'],
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = dotenv.env['API_ANDROID_BASE_URL']?.trim();
      if (android != null && android.isNotEmpty) return _normalize(android);
      return 'http://10.0.2.2:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final ios = dotenv.env['API_IOS_BASE_URL']?.trim();
      if (ios != null && ios.isNotEmpty) return _normalize(ios);
    }

    final shared = dotenv.env['API_BASE_URL']?.trim();
    if (shared != null && shared.isNotEmpty) return _normalize(shared);

    return 'http://127.0.0.1:3000';
  }

  static String get socketBaseUrl {
    if (kIsWeb) {
      return _resolveWeb(
        explicit: dotenv.env['SOCKET_WEB_BASE_URL'],
        shared: dotenv.env['SOCKET_BASE_URL'] ?? dotenv.env['API_WEB_BASE_URL'],
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

      return 'http://10.0.2.2:3000';
    }

    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final iosSocket = dotenv.env['SOCKET_IOS_BASE_URL']?.trim();
      if (iosSocket != null && iosSocket.isNotEmpty) {
        return _normalize(iosSocket);
      }
    }

    final shared = dotenv.env['SOCKET_BASE_URL']?.trim();
    if (shared != null && shared.isNotEmpty) return _normalize(shared);

    return baseUrl;
  }

  static String _resolveWeb({String? explicit, String? shared}) {
    final selected = explicit?.trim().isNotEmpty == true
        ? explicit!.trim()
        : shared?.trim();

    if (selected != null && selected.isNotEmpty) {
      return _webSafe(selected);
    }

    return _browserHostDefault();
  }

  static String _webSafe(String value) {
    final normalized = _normalize(value);
    final uri = Uri.tryParse(normalized);
    if (uri == null) return normalized;

    const emulatorHosts = {'10.0.2.2', '10.0.3.2'};
    if (!emulatorHosts.contains(uri.host)) return normalized;

    final browserHost = Uri.base.host.trim().isEmpty
        ? '127.0.0.1'
        : Uri.base.host.trim();

    return uri
        .replace(host: browserHost)
        .toString()
        .replaceAll(RegExp(r'/$'), '');
  }

  static String _browserHostDefault() {
    final host = Uri.base.host.trim().isEmpty
        ? '127.0.0.1'
        : Uri.base.host.trim();
    return 'http://$host:3000';
  }

  static String _normalize(String value) {
    return value.replaceAll(RegExp(r'/+$'), '');
  }
}
