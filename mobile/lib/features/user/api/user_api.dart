// Authenticated mobile API facade mapped to the existing Voxidence backend.
//
// @author  Malak

import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import '../../../core/network/api_client.dart';
import '../models/payment_currency.dart';
import '../models/user_models.dart';

class PagedResult<T> {
  const PagedResult({required this.items, this.total = 0, this.totalPages = 1});

  final List<T> items;
  final int total;
  final int totalPages;
}

class UserApi {
  UserApi._();

  static final UserApi instance = UserApi._();
  final ApiClient _api = ApiClient.instance;

  Future<UserSummary> getSummary({bool force = false}) async {
    final raw = await _api.get(
      '/users/summary',
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return UserSummary.fromJson(_map(raw));
  }

  Future<Map<String, dynamic>> getCredits({bool force = false}) async {
    return _map(
      await _api.get(
        '/users/credits',
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  Future<PagedResult<IdeaSummary>> getMyIdeas({
    int page = 1,
    int limit = 18,
    String? search,
    bool? isUnlocked,
    DateTime? fromDate,
    DateTime? toDate,
    bool force = false,
  }) async {
    final query = <String, dynamic>{
      'page': page,
      'limit': limit,
      'sortBy': 'createdAt',
      'sortOrder': 'desc',
    };

    final normalizedSearch = search?.trim();
    if (normalizedSearch != null && normalizedSearch.isNotEmpty) {
      query['search'] = normalizedSearch;
    }
    if (isUnlocked != null) {
      query['isUnlocked'] = isUnlocked;
    }
    if (fromDate != null) {
      query['fromDate'] = _dateOnly(fromDate);
    }
    if (toDate != null) {
      query['toDate'] = _dateOnly(toDate);
    }

    final raw = await _api.get(
      '/users/ideas',
      query: query,
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, IdeaSummary.fromJson);
  }

  Future<List<IdeaSummary>> getFavorites({bool force = false}) async {
    final raw = await _api.get(
      '/users/favorites',
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _list(raw).map((e) => IdeaSummary.fromJson(_map(e))).toList();
  }

  Future<void> addFavorite(String ideaId) async {
    await _api.post('/users/ideas/$ideaId/favorite');
    _api.invalidate('/users/favorites');
    _api.invalidate('/users/ideas');
    _api.invalidate('/users/summary');
  }

  Future<void> removeFavorite(String ideaId) async {
    await _api.delete('/users/ideas/$ideaId/favorite');
    _api.invalidate('/users/favorites');
    _api.invalidate('/users/ideas');
    _api.invalidate('/users/summary');
  }

  Future<PagedResult<IdeaSummary>> getPublished({bool force = false}) async {
    final raw = await _api.get(
      '/users/publications/mine',
      query: const {'page': 1, 'limit': 20},
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, IdeaSummary.fromJson);
  }

  Future<PagedResult<Map<String, dynamic>>> getPublishedRaw({
    int page = 1,
    int limit = 9,
    String? search,
    String? status,
    DateTime? fromDate,
    DateTime? toDate,
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/publications/mine',
      query: {
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (status != null && status.trim().isNotEmpty) 'status': status.trim(),
        if (fromDate != null) 'fromDate': _dateOnly(fromDate),
        if (toDate != null) 'toDate': _dateOnly(toDate),
        'sortBy': 'publishedAt',
        'sortOrder': 'desc',
      },
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, (json) => json);
  }

  Future<Map<String, dynamic>> getReceivedFeedbackDetails(
    String publicationId, {
    int page = 1,
    int limit = 10,
    String? search,
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/publications/$publicationId/received-feedback',
      query: {
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
      cacheFor: const Duration(seconds: 12),
      force: force,
    );
    return _map(raw);
  }

  Future<PagedResult<Map<String, dynamic>>> getReceivedFeedback(
    String publicationId, {
    int page = 1,
    int limit = 20,
    String? search,
    bool force = false,
  }) async {
    final body = await getReceivedFeedbackDetails(
      publicationId,
      page: page,
      limit: limit,
      search: search,
      force: force,
    );

    final responses = body['responses'] is List
        ? body['responses'] as List
        : body['data'] is List
        ? body['data'] as List
        : body['items'] is List
        ? body['items'] as List
        : const <dynamic>[];
    final meta = body['meta'] is Map
        ? _map(body['meta'])
        : body['pagination'] is Map
        ? _map(body['pagination'])
        : const <String, dynamic>{};

    return PagedResult<Map<String, dynamic>>(
      items: responses.map(_map).toList(),
      total: _int(meta['total'] ?? responses.length),
      totalPages: _int(meta['totalPages'] ?? 1).clamp(1, 999999).toInt(),
    );
  }

  Future<Map<String, dynamic>> archivePublication(String ideaId) async {
    final result = _map(
      await _api.post('/users/ideas/$ideaId/publication/archive'),
    );
    _invalidateLibraries();
    return result;
  }

  Future<Map<String, dynamic>> repostPublication(String ideaId) async {
    final result = _map(
      await _api.post('/users/ideas/$ideaId/publication/repost'),
    );
    _invalidateLibraries();
    return result;
  }

  Future<Map<String, dynamic>> updatePublicationAcceptanceSetting(
    String ideaId,
    bool allowAdoption,
  ) async {
    final result = _map(
      await _api.patch(
        '/users/ideas/$ideaId/publication/acceptance-setting',
        data: {'allowAdoption': allowAdoption},
      ),
    );
    _api.invalidate('/users/publications');
    _api.invalidate('/users/ideas/$ideaId');
    return result;
  }

  Future<PagedResult<IdeaSummary>> getAccepted({
    int page = 1,
    int limit = 18,
    String? search,
    DateTime? fromDate,
    DateTime? toDate,
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/publications/accepted',
      query: {
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        if (fromDate != null) 'fromDate': _dateOnly(fromDate),
        if (toDate != null) 'toDate': _dateOnly(toDate),
        'sortBy': 'acceptedAt',
        'sortOrder': 'desc',
      },
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, (json) {
      final publication = json['publication'] is Map
          ? Map<String, dynamic>.from(json['publication'] as Map)
          : Map<String, dynamic>.from(json);
      return IdeaSummary.fromJson({
        ...publication,
        'publicationId': publication['id'],
        'isUnlocked':
            json['advancedUnlockedAt'] != null ||
            json['hasAdvancedAccess'] == true,
      });
    });
  }

  Future<PagedResult<DiscoveryItem>> getDiscoveries({
    int page = 1,
    int limit = 9,
    String? search,
    String sortBy = 'publishedAt',
    String sortOrder = 'desc',
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/publications/discover',
      query: {
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
        'sortBy': sortBy,
        'sortOrder': sortOrder,
      },
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, DiscoveryItem.fromJson);
  }

  Future<Map<String, dynamic>> getDiscovery(
    String publicationId, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/publications/$publicationId',
        cacheFor: const Duration(minutes: 2),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> acceptDiscovery(
    String publicationId, {
    String currency = 'USD',
  }) async {
    final result = _map(
      await _api.post(
        '/users/publications/$publicationId/accept',
        data: {
          'clientRequestId': _clientRequestId(),
          'paymentMethodKey': 'card',
          'currency': currency,
          'successUrl': _paymentSuccessUrl,
          'cancelUrl': _paymentCancelUrl(
            '/normal/discover/$publicationId?cancelled=1',
          ),
        },
      ),
    );
    _invalidateLibraries();
    return result;
  }

  Future<Map<String, dynamic>?> getMyAcceptance(
    String publicationId, {
    bool force = false,
  }) async {
    try {
      final raw = await _api.get(
        '/users/publications/$publicationId/my-acceptance',
        cacheFor: const Duration(minutes: 1),
        force: force,
      );
      if (raw == null) return null;
      return _map(raw);
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> unlockAcceptedAdvancedWithCredits(
    String publicationId,
  ) async {
    final result = _map(
      await _api.post('/users/publications/$publicationId/unlock-advanced'),
    );
    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/accepted');
    _api.invalidate('/users/summary');
    _api.invalidate('/users/credits');
    return result;
  }

  Future<Map<String, dynamic>> createAcceptedAdvancedCheckout(
    String publicationId, {
    String currency = 'USD',
  }) async {
    return _map(
      await _api.post(
        '/users/publications/$publicationId/unlock-advanced/checkout',
        data: {
          'clientRequestId': _clientRequestId(),
          'paymentMethodKey': 'card',
          'currency': currency,
          'successUrl': _paymentSuccessUrl,
          'cancelUrl': _paymentCancelUrl(
            '/normal/discover/$publicationId?advancedCancelled=1',
          ),
        },
      ),
    );
  }

  Future<Map<String, dynamic>?> getMyRating(
    String publicationId, {
    bool force = false,
  }) async {
    try {
      final raw = await _api.get(
        '/users/publications/$publicationId/rating',
        cacheFor: const Duration(seconds: 30),
        force: force,
      );
      return raw == null ? null : _map(raw);
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> setRating(
    String publicationId,
    int value,
  ) async {
    final result = _map(
      await _api.put(
        '/users/publications/$publicationId/rating',
        data: {'value': value},
      ),
    );
    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/rating');
    _api.invalidate('/users/publications/discover');
    return result;
  }

  Future<void> deleteRating(String publicationId) async {
    await deleteRatingReturningResult(publicationId);
  }

  Future<Map<String, dynamic>> deleteRatingReturningResult(
    String publicationId,
  ) async {
    final result = _map(
      await _api.delete('/users/publications/$publicationId/rating'),
    );

    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/rating');
    _api.invalidate('/users/publications/discover');

    return result;
  }

  Future<Map<String, dynamic>?> getMyVote(
    String publicationId, {
    bool force = false,
  }) async {
    try {
      final raw = await _api.get(
        '/users/publications/$publicationId/vote',
        cacheFor: const Duration(seconds: 30),
        force: force,
      );
      return raw == null ? null : _map(raw);
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> setVote(
    String publicationId,
    String value,
  ) async {
    final result = _map(
      await _api.put(
        '/users/publications/$publicationId/vote',
        data: {'value': value},
      ),
    );
    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/vote');
    _api.invalidate('/users/publications/discover');
    return result;
  }

  Future<void> deleteVote(String publicationId) async {
    await deleteVoteReturningResult(publicationId);
  }

  Future<Map<String, dynamic>> deleteVoteReturningResult(
    String publicationId,
  ) async {
    final result = _map(
      await _api.delete('/users/publications/$publicationId/vote'),
    );

    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/vote');
    _api.invalidate('/users/publications/discover');

    return result;
  }

  Future<Map<String, dynamic>?> getMyFeedback(
    String publicationId, {
    bool force = false,
  }) async {
    try {
      final raw = await _api.get(
        '/users/publications/$publicationId/feedback',
        cacheFor: const Duration(seconds: 30),
        force: force,
      );
      return raw == null ? null : _map(raw);
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> setFeedback(
    String publicationId,
    String comment,
  ) async {
    final result = _map(
      await _api.put(
        '/users/publications/$publicationId/feedback',
        data: {'comment': comment.trim()},
      ),
    );
    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/feedback');
    _api.invalidate('/users/publications/discover');
    return result;
  }

  Future<void> deleteFeedback(String publicationId) async {
    await deleteFeedbackReturningResult(publicationId);
  }

  Future<Map<String, dynamic>> deleteFeedbackReturningResult(
    String publicationId,
  ) async {
    final result = _map(
      await _api.delete('/users/publications/$publicationId/feedback'),
    );

    _api.invalidate('/users/publications/$publicationId');
    _api.invalidate('/users/publications/$publicationId/feedback');
    _api.invalidate('/users/publications/discover');

    return result;
  }

  Future<Map<String, dynamic>> reportPublication(
    String publicationId, {
    required String reason,
    String? details,
  }) async {
    return _map(
      await _api.post(
        '/users/publications/$publicationId/reports',
        data: {
          'reason': reason,
          if (details != null && details.trim().isNotEmpty)
            'details': details.trim(),
        },
      ),
    );
  }

  Future<Map<String, dynamic>> sendContactMessage({
    required String fullName,
    required String email,
    required String subject,
    required String message,
  }) async {
    return _map(
      await _api.post(
        '/users/contact-messages',
        data: {
          'fullName': fullName.trim(),
          'email': email.trim().toLowerCase(),
          'subject': subject.trim(),
          'message': message.trim(),
        },
      ),
    );
  }

  Future<List<AppNotification>> getNotifications({bool force = false}) async {
    final raw = await _api.get(
      '/users/notifications',
      query: const {'page': 1, 'limit': 40},
      cacheFor: const Duration(seconds: 30),
      force: force,
    );
    return _list(raw).map((e) => AppNotification.fromJson(_map(e))).toList();
  }

  Future<void> markNotificationRead(String id) async {
    await _api.patch('/users/notifications/$id/read');
    _api.invalidate('/users/notifications');
    _api.invalidate('/users/summary');
  }

  Future<void> markAllNotificationsRead() async {
    await _api.patch('/users/notifications/read-all');
    _api.invalidate('/users/notifications');
    _api.invalidate('/users/summary');
  }

  Future<Map<String, dynamic>> getProfile({bool force = false}) async {
    return _map(
      await _api.get(
        '/users/profile',
        cacheFor: const Duration(minutes: 3),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> updateProfile({
    required String fullName,
    String? userType,
  }) async {
    final result = _map(
      await _api.patch(
        '/users/profile',
        data: {
          'fullName': fullName.trim(),
          if (userType != null && userType.trim().isNotEmpty)
            'userType': userType.trim(),
        },
      ),
    );
    _api.invalidate('/users/profile');
    _api.invalidate('/users/summary');
    return result;
  }

  Future<Map<String, dynamic>> requestEmailChange({
    required String newEmail,
    required String currentPassword,
  }) async {
    final result = _map(
      await _api.post(
        '/users/profile/email-change/request',
        data: {
          'newEmail': newEmail.trim().toLowerCase(),
          'currentPassword': currentPassword,
        },
      ),
    );
    _api.invalidate('/users/profile');
    return result;
  }

  Future<Map<String, dynamic>> verifyCurrentEmailChange(String code) async {
    final result = _map(
      await _api.post(
        '/users/profile/email-change/verify-current',
        data: {'code': code.trim()},
      ),
    );
    _api.invalidate('/users/profile');
    return result;
  }

  Future<Map<String, dynamic>> verifyNewEmailChange(String code) async {
    final result = _map(
      await _api.post(
        '/users/profile/email-change/verify-new',
        data: {'code': code.trim()},
      ),
    );
    _api.invalidate('/users/profile');
    _api.invalidate('/users/summary');
    return result;
  }

  Future<Map<String, dynamic>> cancelEmailChange() async {
    final result = _map(await _api.post('/users/profile/email-change/cancel'));
    _api.invalidate('/users/profile');
    return result;
  }

  Future<Map<String, dynamic>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    return _map(
      await _api.patch(
        '/auth/password/change',
        data: {'currentPassword': currentPassword, 'newPassword': newPassword},
      ),
    );
  }

  Future<List<Map<String, dynamic>>> getSessions({bool force = false}) async {
    final raw = await _api.get(
      '/auth/sessions',
      cacheFor: const Duration(seconds: 30),
      force: force,
    );
    final body = _map(raw);
    final sessions = body['sessions'] is List
        ? body['sessions'] as List
        : body['items'] is List
        ? body['items'] as List
        : raw is List
        ? raw
        : const <dynamic>[];
    return sessions.map(_map).toList();
  }

  Future<void> revokeSession(String sessionId) async {
    await _api.delete('/auth/sessions/$sessionId');
    _api.invalidate('/auth/sessions');
  }

  Future<void> revokeAllSessions() async {
    await _api.delete('/auth/sessions');
    _api.invalidate('/auth/sessions');
  }

  Future<Map<String, dynamic>> uploadProfileAvatar({
    required List<int> bytes,
    required String fileName,
  }) async {
    final result = _map(
      await _api.patchMultipart(
        '/users/profile/avatar',
        fieldName: 'avatar',
        bytes: bytes,
        fileName: fileName,
      ),
    );
    _api.invalidate('/users/profile');
    _api.invalidate('/users/summary');
    return result;
  }

  Future<void> removeProfileAvatar() async {
    await _api.delete('/users/profile/avatar');
    _api.invalidate('/users/profile');
    _api.invalidate('/users/summary');
  }

  Future<void> deleteAccount(String currentPassword) async {
    await _api.delete(
      '/users/account',
      data: {'currentPassword': currentPassword},
    );
    _api.clearCache();
  }

  Future<Map<String, dynamic>> getPreferences({bool force = false}) async {
    return _map(
      await _api.get(
        '/users/preferences',
        cacheFor: const Duration(minutes: 5),
        force: force,
      ),
    );
  }

  Future<dynamic> getPreferenceOptions({bool force = false}) {
    return _api.get(
      '/preferences/options',
      cacheFor: const Duration(minutes: 30),
      force: force,
    );
  }

  Future<Map<String, dynamic>> updatePreferences(
    Map<String, dynamic> data,
  ) async {
    final result = _map(await _api.put('/users/preferences', data: data));

    final savedCurrency = result['paymentCurrency']?.toString();
    if (savedCurrency != null && savedCurrency.trim().isNotEmpty) {
      PaymentCurrencyPreference.current = savedCurrency;
    }

    _api.invalidate('/users/preferences');
    _api.invalidate('/preferences/options');
    _api.invalidate('/users/payments/pricing');
    return result;
  }

  Future<String> getPaymentCurrencyPreference({bool force = false}) async {
    final preferences = await getPreferences(force: force);
    final currency = preferences['paymentCurrency']?.toString();

    if (currency != null && currency.trim().isNotEmpty) {
      PaymentCurrencyPreference.current = currency;
    }

    return PaymentCurrencyPreference.current;
  }

  Future<PagedResult<Map<String, dynamic>>> getInvoices({
    int page = 1,
    int limit = 8,
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/invoices',
      query: {'page': page, 'limit': limit},
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _paged(raw, (json) => json);
  }

  Future<Map<String, dynamic>> synchronizeInvoices() async {
    final result = _map(
      await _api.post('/users/invoices/synchronize', data: const {}),
    );
    _api.invalidate('/users/invoices');
    return result;
  }

  Future<Map<String, dynamic>> getInvoice(
    String invoiceId, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/invoices/$invoiceId',
        cacheFor: const Duration(minutes: 10),
        force: force,
      ),
    );
  }

  Future<List<int>> downloadInvoicePdf(String invoiceId) {
    return _api.getBytes('/users/invoices/$invoiceId/download');
  }

  Future<PagedResult<Map<String, dynamic>>> getComplaints({
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/complaints',
      query: const {
        'page': 1,
        'limit': 100,
        'sortBy': 'updatedAt',
        'sortOrder': 'desc',
      },
      cacheFor: const Duration(minutes: 1),
      force: force,
    );
    return _paged(raw, (json) => json);
  }

  Future<Map<String, dynamic>> getComplaintById(
    String complaintId, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/complaints/$complaintId',
        cacheFor: const Duration(minutes: 1),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> createComplaint({
    required String subject,
    required String message,
    String? ideaId,
  }) async {
    final result = _map(
      await _api.post(
        '/users/complaints',
        data: {
          'subject': subject.trim(),
          'message': message.trim(),
          if (ideaId != null && ideaId.trim().isNotEmpty)
            'ideaId': ideaId.trim(),
        },
      ),
    );
    _api.invalidate('/users/complaints');
    _api.invalidate('/users/summary');
    return result;
  }

  Future<Map<String, dynamic>> unlockIdeaWithCredits(String ideaId) async {
    final result = _map(
      await _api.post(
        '/users/ideas/$ideaId/outputs/unlock-with-credit',
        receiveTimeout: const Duration(minutes: 3),
      ),
    );
    _api.invalidate('/users/ideas/$ideaId/workspace');
    _api.invalidate('/users/summary');
    _api.invalidate('/users/credits');
    return result;
  }

  Future<Map<String, dynamic>> getIdeaDetails(
    String ideaId, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/ideas/$ideaId',
        cacheFor: const Duration(minutes: 3),
        force: force,
      ),
    );
  }

  Future<List<Map<String, dynamic>>> getBusinessModelTemplates({
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/business-model-templates',
      cacheFor: const Duration(minutes: 30),
      force: force,
    );
    return _list(raw).map(_map).toList();
  }

  Future<Map<String, dynamic>?> getCurrentBusinessModel(
    String ideaId, {
    bool force = false,
  }) async {
    try {
      return _map(
        await _api.get(
          '/users/ideas/$ideaId/business-models/current',
          cacheFor: const Duration(minutes: 5),
          force: force,
        ),
      );
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> generateBusinessModel(
    String ideaId,
    String businessModelTemplateId,
  ) async {
    // Business-model generation executes an AI request on the backend.
    // It can legitimately take longer than the normal mobile API timeout,
    // so only this endpoint receives an extended response window.
    final result = _map(
      await _api.post(
        '/users/ideas/$ideaId/business-models',
        data: {'businessModelTemplateId': businessModelTemplateId},
        receiveTimeout: const Duration(seconds: 90),
      ),
    );

    _api.invalidate('/users/ideas/$ideaId/business-models');
    _api.invalidate('/users/ideas/$ideaId/workspace');

    return result;
  }

  Future<String> getBusinessModelPreviewHtml(String ideaId) {
    return _api.getText('/users/ideas/$ideaId/business-models/current/preview');
  }

  Future<List<int>> downloadBusinessModel(String ideaId) {
    return _api.getBytes(
      '/users/ideas/$ideaId/business-models/current/download',
    );
  }

  Future<List<Map<String, dynamic>>> getBusinessModelHistory(
    String ideaId, {
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/users/ideas/$ideaId/business-models/history',
      cacheFor: const Duration(minutes: 3),
      force: force,
    );
    return _list(raw).map(_map).toList();
  }

  Future<Map<String, dynamic>> savePublicationDraft(
    String ideaId,
    Map<String, dynamic> payload,
  ) async {
    final result = _map(
      await _api.put('/users/ideas/$ideaId/publication', data: payload),
    );
    _api.invalidate('/users/ideas/$ideaId');
    _api.invalidate('/users/ideas/$ideaId/workspace');
    _api.invalidate('/users/publications');
    return result;
  }

  Future<Map<String, dynamic>> generatePublicationDescription(
    String ideaId, {
    String language = 'EN',
  }) async {
    return _map(
      await _api.post(
        '/users/ideas/$ideaId/publication/generate-description',
        data: {'language': language, 'maxWords': 180},
        // Publication copy generation invokes AI on the backend and may
        // legitimately outlive the normal mobile request window.
        receiveTimeout: const Duration(seconds: 60),
      ),
    );
  }

  Future<Map<String, dynamic>> publishIdea(String ideaId) async {
    final result = _map(
      await _api.post('/users/ideas/$ideaId/publication/publish'),
    );
    _api.invalidate('/users/ideas/$ideaId');
    _api.invalidate('/users/ideas/$ideaId/workspace');
    _api.invalidate('/users/publications');
    _api.invalidate('/users/summary');
    return result;
  }

  Future<Map<String, dynamic>> getWorkspace(
    String ideaId, {
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/ideas/$ideaId/workspace',
        cacheFor: const Duration(minutes: 5),
        force: force,
      ),
    );
  }

  Future<List<Map<String, dynamic>>> getDomains({bool force = false}) async {
    final raw = await _api.get(
      '/domains/available',
      cacheFor: const Duration(minutes: 30),
      force: force,
    );
    return _list(raw).map(_map).toList();
  }

  Future<Map<String, dynamic>> previewCollection(
    Map<String, dynamic> payload,
  ) async {
    return _map(
      await _api.post(
        '/users/ideas/generate/collection-preview',
        data: payload,
      ),
    );
  }

  Future<Map<String, dynamic>> startGeneration(
    Map<String, dynamic> payload,
  ) async {
    final result = _map(
      await _api.post(
        '/users/ideas/generate',
        data: payload,
        // Request preparation can take longer than the shared mobile receive
        // timeout while the backend is still successfully creating the run.
        // Duration.zero disables only the response wait timeout for this
        // endpoint; progress is then streamed through the realtime socket.
        receiveTimeout: Duration.zero,
      ),
    );
    _api.invalidate('/users/summary');
    _api.invalidate('/users/ideas');
    _api.invalidate('/users/credits');
    return result;
  }

  Future<Map<String, dynamic>?> getActiveGenerationRun({
    bool force = false,
  }) async {
    try {
      final raw = await _api.get(
        '/users/idea-generation-runs/active',
        cacheFor: const Duration(seconds: 10),
        force: force,
      );
      if (raw == null) return null;
      final map = _map(raw);
      return map.isEmpty ? null : map;
    } on ApiException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<void> deleteIdea(String ideaId) async {
    await _api.delete('/users/ideas/$ideaId');
    _invalidateLibraries();
    _api.invalidate('/users/favorites');
  }

  Future<Map<String, dynamic>> getGenerationRun(String runId) async {
    return _map(
      await _api.get('/users/idea-generation-runs/$runId', force: true),
    );
  }

  Future<void> cancelGeneration(String runId) async {
    await _api.post('/users/idea-generation-runs/$runId/cancel');
  }

  Future<List<Map<String, dynamic>>> getChatSessions(String ideaId) async {
    final raw = await _api.get(
      '/ideas/$ideaId/chat/sessions',
      query: const {
        'page': 1,
        'limit': 50,
        'sortBy': 'updatedAt',
        'sortOrder': 'desc',
      },
      cacheFor: const Duration(seconds: 30),
    );
    return _list(raw).map(_map).toList();
  }

  Future<Map<String, dynamic>> createChatSession(String ideaId) async {
    final result = _map(
      await _api.post('/ideas/$ideaId/chat/sessions', data: const {}),
    );
    _api.invalidate('/ideas/$ideaId/chat/sessions');
    return result;
  }

  Future<Map<String, dynamic>> updateChatSession(
    String sessionId, {
    required String title,
  }) async {
    final result = _map(
      await _api.patch(
        '/chat/sessions/$sessionId',
        data: {'title': title.trim()},
      ),
    );
    _api.invalidate('/ideas/');
    return result;
  }

  Future<void> deleteChatSession(String sessionId) async {
    await _api.delete('/chat/sessions/$sessionId');
    _api.invalidate('/ideas/');
  }

  Future<List<Map<String, dynamic>>> getChatMessages(
    String sessionId, {
    bool force = false,
  }) async {
    final raw = await _api.get(
      '/chat/sessions/$sessionId/messages',
      query: const {
        'page': 1,
        'limit': 100,
        'sortBy': 'createdAt',
        'sortOrder': 'asc',
      },
      cacheFor: const Duration(minutes: 2),
      force: force,
    );
    return _list(raw).map(_map).toList();
  }

  Future<Map<String, dynamic>> getPricing({
    int creditsQuantity = 15,
    String currency = 'USD',
    bool force = false,
  }) async {
    return _map(
      await _api.get(
        '/users/payments/pricing',
        query: {'creditsQuantity': creditsQuantity, 'currency': currency},
        cacheFor: const Duration(minutes: 2),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> getPaymentState(
    String paymentId, {
    bool force = true,
  }) async {
    return _map(
      await _api.get(
        '/users/payments/$paymentId/status',
        cacheFor: const Duration(milliseconds: 100),
        force: force,
      ),
    );
  }

  Future<Map<String, dynamic>> reconcilePayment(String paymentId) async {
    final result = _map(
      await _api.post('/users/payments/$paymentId/reconcile'),
    );
    _api.invalidate('/users/payments/pricing');
    _api.invalidate('/users/invoices');
    _api.invalidate('/users/summary');
    _api.invalidate('/users/credits');
    return result;
  }

  Future<Map<String, dynamic>> createDirectUnlockCheckout(
    String ideaId, {
    String currency = 'USD',
  }) async {
    return _map(
      await _api.post(
        '/users/payments/direct-unlock/checkout',
        data: {
          'ideaId': ideaId,
          'paymentMethodKey': 'card',
          'currency': currency,
          'successUrl': _paymentSuccessUrl,
          'cancelUrl': _paymentCancelUrl(
            '/normal/ideas/$ideaId?payment=cancelled',
          ),
        },
      ),
    );
  }

  Future<Map<String, dynamic>> createCreditsCheckout({
    int quantity = 15,
    String currency = 'USD',
  }) async {
    return _map(
      await _api.post(
        '/users/payments/credits/checkout',
        data: {
          'creditsQuantity': quantity,
          'paymentMethodKey': 'card',
          'currency': currency,
          'successUrl': _paymentSuccessUrl,
          'cancelUrl': _paymentCancelUrl('/normal/credits?payment=cancelled'),
        },
      ),
    );
  }

  /// Success URL supplied to the provider checkout session.
  ///
  /// Flutter Web returns to its own origin. Native mobile uses a dedicated
  /// HTTPS path that MobileCheckoutPage intercepts before a website page is
  /// required, keeping payment confirmation inside the app.
  String get _paymentSuccessUrl {
    if (kIsWeb) {
      return '$_paymentReturnBase/normal/payments/success';
    }

    return '$_mobilePaymentReturnBase/mobile/payments/success';
  }

  /// Builds the provider cancel URL while preserving existing web behavior.
  String _paymentCancelUrl(String webPath) {
    if (kIsWeb) {
      return '$_paymentReturnBase$webPath';
    }

    return '$_mobilePaymentReturnBase/mobile/payments/cancel';
  }

  /// Browser return origin used by Flutter Web checkout.
  String get _paymentReturnBase {
    final configured = dotenv.env['PAYMENT_RETURN_BASE_URL']?.trim();
    if (configured != null && configured.isNotEmpty) {
      return configured.replaceAll(RegExp(r'/+$'), '');
    }

    if (kIsWeb) {
      return Uri.base.origin.replaceAll(RegExp(r'/+$'), '');
    }

    return _mobilePaymentReturnBase;
  }

  /// HTTPS return origin used by provider-hosted checkout on native mobile.
  ///
  /// The embedded checkout intercepts /mobile/payments/success and
  /// /mobile/payments/cancel, so the fallback domain does not need to render a
  /// Flutter page for the normal in-app flow.
  String get _mobilePaymentReturnBase {
    final configured = dotenv.env['MOBILE_PAYMENT_RETURN_BASE_URL']?.trim();

    if (configured != null && configured.isNotEmpty) {
      final normalized = configured.replaceAll(RegExp(r'/+$'), '');
      final uri = Uri.tryParse(normalized);

      if (uri != null && uri.scheme == 'https' && uri.host.isNotEmpty) {
        return normalized;
      }
    }

    return 'https://voxidence.app';
  }

  void invalidateSummary() => _api.invalidate('/users/summary');

  void _invalidateLibraries() {
    _api.invalidate('/users/publications');
    _api.invalidate('/users/ideas');
    _api.invalidate('/users/summary');
  }

  PagedResult<T> _paged<T>(
    dynamic raw,
    T Function(Map<String, dynamic>) builder,
  ) {
    final body = _mapOrList(raw);
    List<dynamic> items = const [];
    Map<String, dynamic> meta = const {};
    Map<String, dynamic> container = const {};

    if (body is List) {
      items = body;
    } else {
      container = _map(body);

      final nested = container['data'];
      if (nested is List) {
        items = nested;
      } else if (container['items'] is List) {
        items = container['items'] as List;
      } else if (nested is Map) {
        final nestedMap = _map(nested);
        container = nestedMap;
        if (nestedMap['items'] is List) {
          items = nestedMap['items'] as List;
        } else if (nestedMap['data'] is List) {
          items = nestedMap['data'] as List;
        }
      }

      meta = container['meta'] is Map
          ? _map(container['meta'])
          : container['pagination'] is Map
          ? _map(container['pagination'])
          : container;
    }

    final total = _int(
      meta['total'] ??
          meta['totalItems'] ??
          meta['count'] ??
          container['total'] ??
          container['totalItems'] ??
          items.length,
    );

    final rawTotalPages = _int(
      meta['totalPages'] ??
          meta['pages'] ??
          container['totalPages'] ??
          container['pages'] ??
          1,
    );

    return PagedResult<T>(
      items: items.map((e) => builder(_map(e))).toList(),
      total: total,
      totalPages: rawTotalPages.clamp(1, 999999).toInt(),
    );
  }

  List<dynamic> _list(dynamic raw) {
    if (raw is List) return raw;
    final map = _map(raw);
    if (map['data'] is List) return map['data'] as List;
    if (map['items'] is List) return map['items'] as List;
    if (map['notifications'] is List) return map['notifications'] as List;
    return const [];
  }

  dynamic _mapOrList(dynamic raw) => raw;

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  int _int(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse('$value') ?? 0;
  }

  String _dateOnly(DateTime value) {
    final local = value.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '${local.year}-$month-$day';
  }

  String _clientRequestId() {
    final now = DateTime.now().microsecondsSinceEpoch.toRadixString(16);
    return '00000000-0000-4000-8000-${now.padLeft(12, '0').substring(now.length > 12 ? now.length - 12 : 0)}';
  }
}
