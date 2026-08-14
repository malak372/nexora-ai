import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';

/// Provides all administrative API operations used by the mobile
/// administration interface.
///
/// This service acts as a centralized gateway between admin-facing
/// Flutter features and the backend administration endpoints.
///
/// It supports:
/// - Sensitive workspace verification and protected requests.
/// - Dashboard and summary retrieval.
/// - Generic paginated admin resource loading.
/// - Complaint and contact-message moderation.
/// - Publication moderation.
/// - User account status management.
/// - Credit adjustments.
/// - Domain and data-source administration.
/// - AI model activation and deactivation.
/// - Alert delivery.
/// - Local API cache invalidation after mutations.
///
/// The class follows a singleton pattern through [instance] so that
/// all administrative features share the same [ApiClient].
///
/// @author Eman
class AdminApi {
  /// Private constructor used by the singleton instance.
  AdminApi._();

  /// Shared singleton instance of [AdminApi].
  static final AdminApi instance = AdminApi._();

  /// Shared API client used for all backend requests.
  final ApiClient _api = ApiClient.instance;

  /// Verifies that the current administrator is allowed to access
  /// a sensitive administrative workspace.
  ///
  /// The backend validates the administrator password and requested
  /// [scope]. When successful, it returns the data required to access
  /// protected administrative endpoints.
  ///
  /// Parameters:
  /// - [scope]: Identifier of the sensitive area being accessed.
  /// - [password]: Administrator password used for verification.
  ///
  /// Returns the normalized backend response.
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

  /// Retrieves data from a sensitive administrative workspace.
  ///
  /// The provided [accessToken] is attached through the
  /// `X-Admin-Sensitive-Token` header.
  ///
  /// Parameters:
  /// - [path]: Sensitive backend endpoint to request.
  /// - [accessToken]: Token returned after sensitive access verification.
  /// - [force]: Whether to bypass cached responses.
  ///
  /// Returns the normalized workspace response.
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

  /// Sends a one-time administrator invitation from the protected
  /// administrators workspace.
  ///
  /// The backend requires the same sensitive-access token that unlocks
  /// the administrators page.
  ///
  /// A successful request emails the recipient a one-time invitation
  /// code and creates a pending invitation record.
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

  /// Sends an update request to a protected administrative endpoint.
  ///
  /// The [accessToken] is included in the sensitive-access header to
  /// authorize the requested operation.
  ///
  /// Parameters:
  /// - [path]: Protected backend endpoint.
  /// - [body]: Update payload.
  /// - [accessToken]: Verified sensitive-access token.
  ///
  /// Returns the normalized backend response.
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

  /// Retrieves administrative dashboard information.
  ///
  /// Dashboard data is cached for one minute unless [force] is `true`.
  ///
  /// Returns the normalized dashboard response.
  Future<Map<String, dynamic>> getDashboard({bool force = false}) async {
    return _map(
      await _api.get(
        '/admin/dashboard',
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  /// Retrieves and normalizes a generic paginated administrative list.
  ///
  /// This method is shared across multiple admin resources including
  /// users, ideas, payments, domains, comments, models, and logs.
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
      cacheFor: const Duration(seconds: 30),
      force: force,
      unwrapResponse: false,
    );

    return _normalizeList(raw);
  }

  /// Retrieves summary information for an administrative resource.
  Future<Map<String, dynamic>> getSummary(
    String path, {
    bool force = false,
    Map<String, dynamic> query = const {},
  }) async {
    return _map(
      await _api.get(
        path,
        query: query,
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  /// Retrieves detailed information for a specific admin resource.
  Future<Map<String, dynamic>> getDetail(
    String path, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(path, cacheFor: const Duration(minutes: 1), force: force),
    );
  }

  /// Updates the moderation state of a user complaint.
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

  /// Updates an administrative contact-inbox message.
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
          // Match the web inbox: an empty response means a status-only update.
          // Omitting the field also avoids failing the backend's minimum-length
          // validation for adminReply.
          if (normalizedReply != null && normalizedReply.isNotEmpty)
            'adminReply': normalizedReply,
        },
      ),
    );

    _api.invalidate('/admin/contact-messages');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Reviews and moderates a publication report.
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

  /// Activates or deactivates a user account.
  Future<Map<String, dynamic>> setUserStatus(String id, bool isActive) async {
    final value = _map(
      await _api.patch('/admin/users/$id/status', data: {'isActive': isActive}),
    );

    _api.invalidate('/admin/users');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Performs an administrative credit adjustment for a user.
  Future<Map<String, dynamic>> adjustCredits({
    required String userId,
    required int amount,
    required String reason,
  }) async {
    final value = _map(
      await _api.post(
        '/admin/credits/adjust',
        data: {'userId': userId, 'amount': amount, 'reason': reason.trim()},
      ),
    );

    _api.invalidate('/admin/credits');

    _api.invalidate('/admin/users');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Removes a currently published idea from community discovery.
  ///
  /// This mirrors the Ideas workspace moderation action on the web. The
  /// backend also handles notifying the publisher with the supplied reason.
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

  /// Downloads the current Ideas directory as CSV bytes.
  ///
  /// [publishedOnly] selects the dedicated published-ideas export endpoint.
  /// Remaining filters are kept aligned with the server-side directory query
  /// used by the web administration workspace.
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

  /// Exports the complaints queue as CSV bytes using the active filters.
  ///
  /// The method mirrors the export action used by the web administration
  /// support queue and keeps filtering on the backend before generating CSV.
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

  /// Exports the contact inbox as CSV bytes using the active filters.
  ///
  /// Search, status and sort options are sent to the backend so the exported
  /// file matches the current administration view.
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

  /// Hides a publication from public visibility.
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

  /// Restores a previously hidden publication.
  Future<Map<String, dynamic>> restorePublication(String id) async {
    final value = _map(
      await _api.patch('/admin/publications/$id/restore', data: const {}),
    );

    _invalidateIdeas();

    return value;
  }

  /// Archives a publication.
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

  /// Sends an administrative platform alert.
  Future<Map<String, dynamic>> sendAlert(Map<String, dynamic> body) async {
    final value = _map(await _api.post('/admin/alerts/send', data: body));

    _api.invalidate('/admin/alerts');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Activates or deactivates an idea-generation domain.
  Future<Map<String, dynamic>> setDomainStatus(String id, bool isActive) async {
    final value = _map(
      await _api.patch('/admin/domains/$id', data: {'isActive': isActive}),
    );

    _api.invalidate('/admin/domains');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Enables or disables a configured collection data source.
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

    _api.invalidate('/admin/data-sources');

    _api.invalidate('/admin/dashboard');

    return value;
  }

  /// Activates or deactivates a configured AI model.
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

  /// Invalidates cached support-management data.
  void _invalidateSupport() {
    _api.invalidate('/admin/complaints');

    _api.invalidate('/admin/dashboard');
  }

  /// Invalidates cached idea and publication moderation data.
  void _invalidateIdeas() {
    _api.invalidate('/admin/ideas');

    _api.invalidate('/admin/publication-reports');

    _api.invalidate('/admin/dashboard');
  }

  /// Normalizes different list response formats into a consistent shape.
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

  /// Extracts a resource list from a backend response.
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

  /// Extracts and normalizes pagination metadata from a response.
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

  /// Converts an arbitrary value into a string-keyed map.
  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  /// Converts an arbitrary numeric value into an integer.
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
