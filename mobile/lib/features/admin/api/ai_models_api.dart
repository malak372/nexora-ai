import '../../../core/network/api_client.dart';

/// API gateway dedicated to the administrator AI-model registry.
///
/// It mirrors the operations exposed by the web admin workspace while keeping
/// the Flutter page independent from the generic admin resource API.
///
/// @author Eman
class AiModelsApi {
  AiModelsApi._();

  static final AiModelsApi instance = AiModelsApi._();

  final ApiClient _api = ApiClient.instance;

  Future<Map<String, dynamic>> list({
    int page = 1,
    int limit = 20,
    String search = '',
    String providerKey = '',
    String healthStatus = '',
    bool? isActive,
    bool? isDefault,
    String sortBy = 'priority',
    String sortOrder = 'desc',
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/ai-models',
      query: {
        'page': page,
        'limit': limit,
        if (search.trim().isNotEmpty) 'search': search.trim(),
        if (providerKey.trim().isNotEmpty) 'providerKey': providerKey.trim(),
        if (healthStatus.trim().isNotEmpty)
          'healthStatus': healthStatus.trim().toUpperCase(),
        'isActive': ?isActive,
        'isDefault': ?isDefault,
        'sortBy': sortBy,
        'sortOrder': sortOrder,
      },
      cacheFor: const Duration(seconds: 25),
      force: force,
      unwrapResponse: false,
    );

    return _normalizeList(raw);
  }

  Future<Map<String, dynamic>> summary({bool force = false}) async {
    return _map(
      await _api.get(
        '/ai-models/summary',
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  Future<List<Map<String, dynamic>>> providers({bool force = false}) async {
    final raw = await _api.get(
      '/ai-models/providers',
      cacheFor: const Duration(minutes: 5),
      force: force,
    );

    final value = raw is List ? raw : _map(raw)['providers'];

    if (value is! List) {
      return const [];
    }

    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  Future<Map<String, dynamic>> detail(String id, {bool force = false}) async {
    return _map(
      await _api.get(
        '/ai-models/$id',
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> body) async {
    final value = _map(await _api.post('/ai-models', data: body));

    _invalidate();

    return value;
  }

  Future<Map<String, dynamic>> update(
    String id,
    Map<String, dynamic> body,
  ) async {
    final value = _map(await _api.patch('/ai-models/$id', data: body));

    _invalidate();

    return value;
  }

  Future<Map<String, dynamic>> setDefault(String id) async {
    final value = _map(
      await _api.patch('/ai-models/$id/default', data: const {}),
    );

    _invalidate();

    return value;
  }

  Future<Map<String, dynamic>> setActive(String id, bool isActive) async {
    final value = _map(
      await _api.patch(
        isActive ? '/ai-models/$id/activate' : '/ai-models/$id/deactivate',
        data: const {},
      ),
    );

    _invalidate();

    return value;
  }

  Future<void> remove(String id) async {
    await _api.delete('/ai-models/$id');

    _invalidate();
  }

  void _invalidate() {
    _api.invalidate('/ai-models');
    _api.invalidate('/admin/ai-monitoring');
    _api.invalidate('/admin/ai/analytics');
    _api.invalidate('/admin/dashboard');
  }

  Map<String, dynamic> _normalizeList(dynamic raw) {
    if (raw is List) {
      final rows = raw
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();

      return {
        'items': rows,
        'meta': {
          'total': rows.length,
          'page': 1,
          'limit': rows.length,
          'totalPages': 1,
        },
      };
    }

    final outer = _map(raw);
    final envelopeData = outer['data'];

    Map<String, dynamic> body = outer;

    if (envelopeData is Map) {
      final nested = Map<String, dynamic>.from(envelopeData);

      final nestedHasList =
          nested['data'] is List ||
          nested['items'] is List ||
          nested['models'] is List;

      if (nestedHasList) {
        body = nested;
      }
    }

    dynamic source;

    for (final key in const ['data', 'items', 'models']) {
      if (body[key] is List) {
        source = body[key];
        break;
      }
    }

    final rows = source is List
        ? source
              .whereType<Map>()
              .map((item) => Map<String, dynamic>.from(item))
              .toList()
        : const <Map<String, dynamic>>[];

    final rawMeta = body['meta'] ?? body['pagination'] ?? outer['meta'];

    final meta = rawMeta is Map
        ? Map<String, dynamic>.from(rawMeta)
        : <String, dynamic>{};

    final total = _int(meta['total'] ?? body['total'] ?? rows.length);

    final limit = _int(
      meta['limit'] ?? body['limit'] ?? 20,
    ).clamp(1, 1000).toInt();

    final page = _int(
      meta['page'] ?? body['page'] ?? 1,
    ).clamp(1, 999999).toInt();

    final totalPages = _int(
      meta['totalPages'] ??
          body['totalPages'] ??
          ((total + limit - 1) ~/ limit),
    ).clamp(1, 999999).toInt();

    return {
      'items': rows,
      'meta': {
        'total': total,
        'page': page,
        'limit': limit,
        'totalPages': totalPages,
      },
    };
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  int _int(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
