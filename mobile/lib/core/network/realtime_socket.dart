// Shared authenticated Socket.IO factory for Voxidence realtime features.
// Reuses warm native connections so opening Premium AI Chat does not pay a
// fresh WebSocket handshake every time.
//
// @author Eman

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../storage/session_store.dart';
import 'api_client.dart';
import 'api_config.dart';

class RealtimeSocket {
  const RealtimeSocket._();

  static final Map<String, io.Socket> _pool = <String, io.Socket>{};
  static final Map<String, String> _poolTokens = <String, String>{};

  static Future<io.Socket> connect(String namespace) async {
    final token = await SessionStore.instance.getAccessToken();
    if (token == null || token.trim().isEmpty) {
      throw const ApiException('Your session has expired.', statusCode: 401);
    }

    final normalizedNamespace = namespace.startsWith('/')
        ? namespace
        : '/$namespace';

    final isolatedAdminChat = normalizedNamespace == '/admin-chat';

    final existing = _pool[normalizedNamespace];
    final existingToken = _poolTokens[normalizedNamespace];

    if (existing != null && existingToken == token) {
      return existing;
    }

    if (existing != null) {
      existing.dispose();
      _pool.remove(normalizedNamespace);
      _poolTokens.remove(normalizedNamespace);
    }

    final socket = io.io(
      '${ApiConfig.socketBaseUrl}$normalizedNamespace',
      <String, dynamic>{
        'transports': kIsWeb
            ? <String>['polling', 'websocket']
            : <String>['websocket'],
        'autoConnect': false,
        'forceNew': isolatedAdminChat,
        'multiplex': !isolatedAdminChat,
        'reconnection': true,
        'reconnectionAttempts': 999999,
        'reconnectionDelay': isolatedAdminChat ? 100 : 180,
        'reconnectionDelayMax': isolatedAdminChat ? 800 : 1200,
        'timeout': isolatedAdminChat ? 3500 : 5000,
        'auth': <String, dynamic>{'token': token},
        if (!kIsWeb)
          'extraHeaders': <String, String>{'Authorization': 'Bearer $token'},
      },
    );

    _pool[normalizedNamespace] = socket;
    _poolTokens[normalizedNamespace] = token;

    return socket;
  }

  static Future<io.Socket> createIsolated(String namespace) async {
    final token = await SessionStore.instance.getAccessToken();
    if (token == null || token.trim().isEmpty) {
      throw const ApiException('Your session has expired.', statusCode: 401);
    }

    final normalizedNamespace = namespace.startsWith('/')
        ? namespace
        : '/$namespace';
    final isolatedAdminChat = normalizedNamespace == '/admin-chat';

    return io.io(
      '${ApiConfig.socketBaseUrl}$normalizedNamespace',
      <String, dynamic>{
        'transports': kIsWeb
            ? <String>['polling', 'websocket']
            : <String>['websocket'],
        'autoConnect': false,
        'forceNew': true,
        'multiplex': false,
        'reconnection': true,
        'reconnectionAttempts': 999999,
        'reconnectionDelay': isolatedAdminChat ? 100 : 180,
        'reconnectionDelayMax': isolatedAdminChat ? 800 : 1200,
        'timeout': isolatedAdminChat ? 3500 : 5000,
        'auth': <String, dynamic>{'token': token},
        if (!kIsWeb)
          'extraHeaders': <String, String>{'Authorization': 'Bearer $token'},
      },
    );
  }

  static Future<void> warm(String namespace) async {
    try {
      final socket = await connect(namespace);
      if (!socket.connected) {
        socket.connect();
      }
    } catch (_) {
      // Warm-up is best effort. The page retries normally when opened.
    }
  }

  static void disposeNamespace(String namespace) {
    final normalizedNamespace = namespace.startsWith('/')
        ? namespace
        : '/$namespace';
    _pool.remove(normalizedNamespace)?.dispose();
    _poolTokens.remove(normalizedNamespace);
  }

  static void disposeAll() {
    for (final socket in _pool.values) {
      socket.dispose();
    }
    _pool.clear();
    _poolTokens.clear();
  }
}
