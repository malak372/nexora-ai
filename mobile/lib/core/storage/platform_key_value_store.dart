// Platform-aware small key/value storage for Voxidence.
//
// Web builds use SharedPreferences to avoid browser WebCrypto failures from
// stale flutter_secure_storage values. Native mobile/desktop builds keep using
// FlutterSecureStorage for sensitive values.
//
// @author  Malak

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PlatformKeyValueStore {
  PlatformKeyValueStore._();

  static final PlatformKeyValueStore instance = PlatformKeyValueStore._();

  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  Future<String?> read(String key) async {
    try {
      if (kIsWeb) {
        final preferences = await SharedPreferences.getInstance();
        return preferences.getString(key);
      }

      return await _secureStorage.read(key: key);
    } catch (_) {
      // Storage must never crash app bootstrap or an API interceptor.
      return null;
    }
  }

  Future<void> write(String key, String value) async {
    if (kIsWeb) {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(key, value);
      return;
    }

    await _secureStorage.write(key: key, value: value);
  }

  Future<void> delete(String key) async {
    try {
      if (kIsWeb) {
        final preferences = await SharedPreferences.getInstance();
        await preferences.remove(key);
        return;
      }

      await _secureStorage.delete(key: key);
    } catch (_) {
      // Cleanup should be best-effort.
    }
  }
}
