import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';

class AdminApi {
  AdminApi._();

  static final AdminApi instance = AdminApi._();

  final ApiClient _api = ApiClient.instance;

  Future<Map<String, dynamic>> verifySensitiveAccess(
    String scope,
    String password,
  ) async {
    return _map(
      await _api.post(
        '/admin/sensitive-access/verify',
        data: {'scope': scope, 'password': password},
      ),
    );
  }

  Future<Map<String, dynamic>> getSensitiveWorkspace(
    String path,
    String accessToken, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        path,
        force: force,
        options: Options(headers: {'X-Admin-Sensitive-Token': accessToken}),
      ),
    );
  }

  Future<Map<String, dynamic>> inviteAdministrator({
    required String fullName,
    required String email,
    required String accessToken,
  }) async {
    final response = await _api.post(
      '/admin/administrators/invitations',
      data: {'fullName': fullName.trim(), 'email': email.trim().toLowerCase()},
      receiveTimeout: const Duration(seconds: 60),
      options: Options(headers: {'X-Admin-Sensitive-Token': accessToken}),
    );

    _api.invalidate('/admin/administrators');

    return _map(response);
  }

  Future<Map<String, dynamic>> patchSensitive(
    String path,
    Map<String, dynamic> body,
    String accessToken,
  ) async {
    return _map(
      await _api.patch(
        path,
        data: body,
        options: Options(headers: {'X-Admin-Sensitive-Token': accessToken}),
      ),
    );
  }

  Future<Map<String, dynamic>> getDashboard({
    bool force = false,
    String period = 'all',
  }) async {
    return _map(
      await _api.get(
        '/admin/dashboard',
        query: {'period': period},
        cacheFor: const Duration(minutes: 2),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> getList(
    String path, {
    int page = 1,
    int limit = 20,
    String? search,
    String? status,
    String sortBy = 'createdAt',
    String sortOrder = 'desc',
    bool force = false,
    Map<String, dynamic> extra = const {},
  }) async {
    final raw = await _api.get(
      path,
      query: {
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null && status.trim().isNotEmpty) 'status': status.trim(),
        'sortBy': sortBy,
        'sortOrder': sortOrder,
        ...extra,
      },
      cacheFor: const Duration(minutes: 1),
      force: force,
      unwrapResponse: false,
    );

    return _normalizeList(raw);
  }

  Future<Map<String, dynamic>> getSummary(
    String path, {
    bool force = false,
    Map<String, dynamic> query = const {},
  }) async {
    return _map(
      await _api.get(
        path,
        query: query,
        cacheFor: const Duration(minutes: 2),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> getDetail(
    String path, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(path, cacheFor: const Duration(minutes: 2), force: force),
    );
  }

  Future<Map<String, dynamic>> updateComplaint(
    String id, {
    required String status,
    String? priority,
    String? adminReply,
  }) async {
    final value = _map(
      await _api.patch(
        '/admin/complaints/$id',
        data: {
          'status': status,
          if (priority != null && priority.trim().isNotEmpty)
            'priority': priority.trim(),
          if (adminReply != null) 'adminReply': adminReply.trim(),
        },
      ),
    );

    _invalidateSupport();

    return value;
  }

  Future<Map<String, dynamic>> updateContactMessage(
    String id, {
    required String status,
    String? adminReply,
  }) async {
    final normalizedReply = adminReply?.trim();

    final value = _map(
      await _api.patch(
        '/admin/contact-messages/$id',
        data: {
          'status': status,
          if (normalizedReply != null && normalizedReply.isNotEmpty)
            'adminReply': normalizedReply,
        },
      ),
    );

    _api.invalidate('/admin/contact-messages');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> reviewPublicationReport(
    String id, {
    required String status,
    required String moderationAction,
    String? adminNote,
    String? publisherMessage,
    bool notifyReporter = true,
    String? reporterMessage,
  }) async {
    final value = _map(
      await _api.patch(
        '/admin/publication-reports/$id/review',
        data: {
          'status': status,
          'moderationAction': moderationAction,
          if (adminNote != null && adminNote.trim().isNotEmpty)
            'adminNote': adminNote.trim(),
          if (publisherMessage != null && publisherMessage.trim().isNotEmpty)
            'publisherMessage': publisherMessage.trim(),
          'notifyReporter': notifyReporter,
          if (notifyReporter &&
              reporterMessage != null &&
              reporterMessage.trim().isNotEmpty)
            'reporterMessage': reporterMessage.trim(),
        },
      ),
    );

    _api.invalidate('/admin/publication-reports');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> updateUser(
    String id,
    Map<String, dynamic> body,
  ) async {
    final value = _map(await _api.patch('/admin/users/$id', data: body));

    _api.invalidate('/admin/users');
    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> sendUserPasswordReset(String id) async {
    return _map(await _api.post('/admin/users/$id/send-password-reset-email'));
  }

  Future<Map<String, dynamic>> moveUserToDeleted(String id) async {
    final value = _map(await _api.delete('/admin/users/$id'));

    _api.invalidate('/admin/users');
    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> setUserStatus(String id, bool isActive) async {
    final value = _map(
      await _api.patch('/admin/users/$id/status', data: {'isActive': isActive}),
    );

    _api.invalidate('/admin/users');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> adjustCredits({
    required String userId,
    required int amount,
    required String description,
  }) async {
    final value = _map(
      await _api.post(
        '/admin/credits/adjust',
        data: {
          'userId': userId,
          'amount': amount,
          'description': description.trim(),
        },
      ),
    );

    _api.invalidate('/admin/credits');
    _api.invalidate('/admin/users');
    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<List<int>> exportPaymentsCsv({
    String? search,
    String? status,
    String? paymentPurpose,
    String? paymentMethodKey,
    String? providerKey,
    String? fromDate,
    String? toDate,
    String? sortBy,
    String? sortOrder,
  }) {
    return _api.getBytes(
      '/admin/payments/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null && status.trim().isNotEmpty) 'status': status.trim(),
        if (paymentPurpose != null && paymentPurpose.trim().isNotEmpty)
          'paymentPurpose': paymentPurpose.trim(),
        if (paymentMethodKey != null && paymentMethodKey.trim().isNotEmpty)
          'paymentMethodKey': paymentMethodKey.trim(),
        if (providerKey != null && providerKey.trim().isNotEmpty)
          'providerKey': providerKey.trim(),
        if (fromDate != null && fromDate.trim().isNotEmpty)
          'fromDate': fromDate.trim(),
        if (toDate != null && toDate.trim().isNotEmpty) 'toDate': toDate.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
      },
    );
  }

  Future<List<int>> exportCreditsCsv({
    String? search,
    String? type,
    String? fromDate,
    String? toDate,
    String? sortBy,
    String? sortOrder,
  }) {
    return _api.getBytes(
      '/admin/credits/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (type != null && type.trim().isNotEmpty) 'type': type.trim(),
        if (fromDate != null && fromDate.trim().isNotEmpty)
          'fromDate': fromDate.trim(),
        if (toDate != null && toDate.trim().isNotEmpty) 'toDate': toDate.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
      },
    );
  }

  Future<List<int>> exportAuditLogsCsv({
    String? search,
    String? action,
    String? targetType,
    String? targetId,
    String? actorId,
    String? fromDate,
    String? toDate,
    String? sortBy,
    String? sortOrder,
  }) {
    return _api.getBytes(
      '/audit-logs/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (action != null && action.trim().isNotEmpty) 'action': action.trim(),
        if (targetType != null && targetType.trim().isNotEmpty)
          'targetType': targetType.trim(),
        if (targetId != null && targetId.trim().isNotEmpty)
          'targetId': targetId.trim(),
        if (actorId != null && actorId.trim().isNotEmpty)
          'actorId': actorId.trim(),
        if (fromDate != null && fromDate.trim().isNotEmpty)
          'fromDate': fromDate.trim(),
        if (toDate != null && toDate.trim().isNotEmpty) 'toDate': toDate.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> unpublishPublication(
    String id,
    String reason,
  ) async {
    final value = _map(
      await _api.patch(
        '/admin/publications/$id/unpublish',
        data: {'reason': reason.trim()},
      ),
    );

    _invalidateIdeas();

    return value;
  }

  Future<List<int>> exportUsersCsv({
    String? search,
    String? sortBy,
    String? sortOrder,
    bool? isActive,
    bool deletedOnly = false,
  }) {
    return _api.getBytes(
      '/admin/users/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
        if (isActive != null) 'isActive': isActive.toString(),
        if (deletedOnly) 'deletedOnly': 'true',
      },
    );
  }

  Future<List<int>> exportIdeasCsv({
    bool publishedOnly = false,
    String? search,
    String? sortBy,
    String? sortOrder,
    bool? isUnlocked,
  }) {
    return _api.getBytes(
      publishedOnly
          ? '/admin/ideas/published/export/csv'
          : '/admin/ideas/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (!publishedOnly && sortBy != null && sortBy.trim().isNotEmpty)
          'sortBy': sortBy.trim(),
        if (!publishedOnly && sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
        if (!publishedOnly && isUnlocked != null)
          'isUnlocked': isUnlocked ? 'true' : 'false',
      },
    );
  }

  Future<List<int>> exportComplaintsCsv({
    String? search,
    String? status,
    String? sortBy,
    String? sortOrder,
  }) {
    return _api.getBytes(
      '/admin/complaints/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null &&
            status.trim().isNotEmpty &&
            status.trim().toUpperCase() != 'ALL')
          'status': status.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
      },
    );
  }

  Future<List<int>> exportContactMessagesCsv({
    String? search,
    String? status,
    String? sortBy,
    String? sortOrder,
  }) {
    return _api.getBytes(
      '/admin/contact-messages/export/csv',
      query: {
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null &&
            status.trim().isNotEmpty &&
            status.trim().toUpperCase() != 'ALL')
          'status': status.trim(),
        if (sortBy != null && sortBy.trim().isNotEmpty) 'sortBy': sortBy.trim(),
        if (sortOrder != null && sortOrder.trim().isNotEmpty)
          'sortOrder': sortOrder.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> hidePublication(String id, String reason) async {
    final value = _map(
      await _api.patch(
        '/admin/publications/$id/hide',
        data: {'reason': reason.trim()},
      ),
    );

    _invalidateIdeas();

    return value;
  }

  Future<Map<String, dynamic>> restorePublication(String id) async {
    final value = _map(
      await _api.patch('/admin/publications/$id/restore', data: const {}),
    );

    _invalidateIdeas();

    return value;
  }

  Future<Map<String, dynamic>> archivePublication(
    String id,
    String reason,
  ) async {
    final value = _map(
      await _api.patch(
        '/admin/publications/$id/archive',
        data: {'reason': reason.trim()},
      ),
    );

    _invalidateIdeas();

    return value;
  }

  Future<Map<String, dynamic>> sendAlert(Map<String, dynamic> body) async {
    final value = _map(await _api.post('/admin/alerts/send', data: body));

    _api.invalidate('/admin/alerts');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> setDomainStatus(String id, bool isActive) async {
    final value = _map(
      await _api.patch('/admin/domains/$id', data: {'isActive': isActive}),
    );

    _api.invalidate('/admin/domains');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  Future<Map<String, dynamic>> createDataSource(
    Map<String, dynamic> body,
  ) async {
    final value = _map(
      await _api.post('/admin/data-sources', data: body),
    );

    _invalidateDataSources();

    return value;
  }

  Future<Map<String, dynamic>> updateDataSource(
    String id,
    Map<String, dynamic> body,
  ) async {
    final value = _map(
      await _api.patch('/admin/data-sources/$id', data: body),
    );

    _invalidateDataSources();

    return value;
  }

  Future<Map<String, dynamic>> deleteDataSource(String id) async {
    final value = _map(
      await _api.delete('/admin/data-sources/$id'),
    );

    _invalidateDataSources();

    return value;
  }

  Future<Map<String, dynamic>> synchronizeDataSources() async {
    final value = _map(
      await _api.post('/admin/data-sources/synchronize', data: const {}),
    );

    _invalidateDataSources();

    return value;
  }

  Future<Map<String, dynamic>> setDataSourceStatus(
    String id,
    bool isActive,
  ) async {
    final value = _map(
      await _api.patch(
        '/admin/data-sources/$id/status',
        data: {'isActive': isActive},
      ),
    );

    _invalidateDataSources();

    return value;
  }

  void _invalidateDataSources() {
    _api.invalidate('/admin/data-sources');
    _api.invalidate('/admin/dashboard');
  }

  Future<Map<String, dynamic>> setAiModelStatus(
    String id,
    bool isActive,
  ) async {
    final value = _map(
      await _api.patch(
        isActive ? '/ai-models/$id/activate' : '/ai-models/$id/deactivate',
        data: const {},
      ),
    );

    _api.invalidate('/ai-models');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  void _invalidateSupport() {
    _api.invalidate('/admin/complaints');

    _api.invalidate('/admin/dashboard');
  }

  void _invalidateIdeas() {
    _api.invalidate('/admin/ideas');

    _api.invalidate('/admin/publication-reports');

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
        'meta': {'total': rows.length, 'page': 1, 'totalPages': 1},
      };
    }

    final body = _map(raw);

    final rows = _listFrom(body);

    final meta = _metaFrom(body, rows.length);

    return {'items': rows, 'meta': meta};
  }

  List<Map<String, dynamic>> _listFrom(Map<String, dynamic> body) {
    dynamic source;

    for (final key in const [
      'items',
      'data',
      'users',
      'ideas',
      'payments',
      'transactions',
      'domains',
      'comments',
      'complaints',
      'messages',
      'reports',
      'alerts',
      'sources',
      'models',
      'logs',
      'jobs',
      'history',
    ]) {
      if (body[key] is List) {
        source = body[key];
        break;
      }
    }

    if (source is! List) {
      return const [];
    }

    return source
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  Map<String, dynamic> _metaFrom(Map<String, dynamic> body, int count) {
    final raw = body['meta'] ?? body['pagination'];

    final meta = raw is Map
        ? Map<String, dynamic>.from(raw)
        : <String, dynamic>{};

    return {
      'total': _int(meta['total'] ?? body['total'] ?? count),
      'page': _int(meta['page'] ?? body['page'] ?? 1),
      'totalPages': _int(
        meta['totalPages'] ?? body['totalPages'] ?? 1,
      ).clamp(1, 999999).toInt(),
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
