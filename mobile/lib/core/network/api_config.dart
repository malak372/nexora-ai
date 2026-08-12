import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Central API configuration for the mobile application.
///
/// This class resolves the backend base URL from environment variables
/// and applies platform-specific adjustments when needed.
///
/// development machine.
///
/// @author Eman
abstract final class ApiConfig {
  /// Returns `true` when the application is running natively
  /// on either Android or iOS.
  ///
  /// Web builds always return `false`.
  static bool get isNativeMobile =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  /// Returns the normalized backend API base URL.
  ///
  /// The URL is read from the `API_BASE_URL` environment variable.
  /// If the variable is missing or empty, the default value
  /// `http://localhost:3000` is used.
  ///
  /// When running on an Android emulator, localhost addresses are
  /// automatically converted to `10.0.2.2`.
  ///
  /// A trailing slash is removed before returning the final URL.
  static String get baseUrl {
    final configured = dotenv.env['API_BASE_URL']?.trim();

    var value = configured == null || configured.isEmpty
        ? 'http://localhost:3000'
        : configured;

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      value = value
          .replaceFirst('://localhost', '://10.0.2.2')
          .replaceFirst('://127.0.0.1', '://10.0.2.2');
    }

    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }
}
