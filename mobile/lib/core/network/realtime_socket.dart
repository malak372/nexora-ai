// Shared authenticated Socket.IO factory for Voxidence realtime features.
//
// @author  Malak

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../storage/session_store.dart';
import 'api_client.dart';
import 'api_config.dart';

class RealtimeSocket {
  const RealtimeSocket._();

  static Future<io.Socket> connect(String namespace) async {
    final token = await SessionStore.instance.getAccessToken();
    if (token == null || token.trim().isEmpty) {
      throw const ApiException('Your session has expired.', statusCode: 401);
    }

    final normalizedNamespace = namespace.startsWith('/')
        ? namespace
        : '/$namespace';

    final socket = io.io(
      '${ApiConfig.socketBaseUrl}$normalizedNamespace',
      <String, dynamic>{
        'transports': <String>['websocket'],
        'autoConnect': false,
        'reconnection': true,
        'reconnectionAttempts': 6,
        'reconnectionDelay': 800,
        'timeout': 10000,
        'auth': <String, dynamic>{'token': token},
      },
    );

    return socket;
  }
}
