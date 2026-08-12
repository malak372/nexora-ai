// Lightweight mobile models for authenticated Voxidence users.
//
// @author  Malak

class UserSummary {
  const UserSummary({
    required this.id,
    required this.fullName,
    required this.email,
    required this.accountStatus,
    required this.creditBalance,
    required this.remainingFreeGenerations,
    required this.ideasCount,
    required this.publishedIdeasCount,
    required this.favoriteIdeasCount,
    required this.unreadNotificationsCount,
    this.avatarUrl,
    this.freeIdeasCount = 0,
    this.premiumIdeasCount = 0,
    this.openComplaintsCount = 0,
    this.resolvedComplaintsCount = 0,
    this.totalPayments = 0,
    this.totalCreditsPurchased = 0,
    this.userType,
    this.latestIdea,
  });

  final String id;
  final String fullName;
  final String email;
  final String accountStatus;
  final int creditBalance;
  final int remainingFreeGenerations;
  final int ideasCount;
  final int publishedIdeasCount;
  final int favoriteIdeasCount;
  final int unreadNotificationsCount;
  final String? avatarUrl;
  final int freeIdeasCount;
  final int premiumIdeasCount;
  final int openComplaintsCount;
  final int resolvedComplaintsCount;
  final int totalPayments;
  final int totalCreditsPurchased;
  final String? userType;
  final Map<String, dynamic>? latestIdea;

  bool get isPremium => accountStatus.toUpperCase() == 'PREMIUM';

  factory UserSummary.fromJson(Map<String, dynamic> json) {
    return UserSummary(
      id: '${json['id'] ?? ''}',
      fullName: '${json['fullName'] ?? 'Voxidence User'}',
      email: '${json['email'] ?? ''}',
      accountStatus: '${json['accountStatus'] ?? 'NORMAL'}',
      creditBalance: _asInt(json['creditBalance']),
      remainingFreeGenerations: _asInt(json['remainingFreeGenerations']),
      ideasCount: _asInt(json['ideasCount']),
      publishedIdeasCount: _asInt(json['publishedIdeasCount']),
      favoriteIdeasCount: _asInt(json['favoriteIdeasCount']),
      unreadNotificationsCount: _asInt(json['unreadNotificationsCount']),
      avatarUrl: json['avatarUrl']?.toString(),
      freeIdeasCount: _asInt(json['freeIdeasCount']),
      premiumIdeasCount: _asInt(json['premiumIdeasCount']),
      openComplaintsCount: _asInt(json['openComplaintsCount']),
      resolvedComplaintsCount: _asInt(json['resolvedComplaintsCount']),
      totalPayments: _asInt(json['totalPayments']),
      totalCreditsPurchased: _asInt(json['totalCreditsPurchased']),
      userType: json['userType']?.toString(),
      latestIdea: json['latestIdea'] is Map
          ? Map<String, dynamic>.from(json['latestIdea'] as Map)
          : null,
    );
  }

  /// Builds a safe local snapshot while the network summary is loading.
  /// Counts intentionally default to zero until the backend replaces them.
  factory UserSummary.fromSessionSnapshot(Map<String, dynamic> json) {
    return UserSummary(
      id: '${json['id'] ?? ''}',
      fullName: '${json['fullName'] ?? 'Voxidence User'}',
      email: '${json['email'] ?? ''}',
      accountStatus: '${json['accountStatus'] ?? 'NORMAL'}',
      creditBalance: _asInt(json['creditBalance']),
      remainingFreeGenerations: _asInt(json['remainingFreeGenerations']),
      ideasCount: _asInt(json['ideasCount']),
      publishedIdeasCount: _asInt(json['publishedIdeasCount']),
      favoriteIdeasCount: _asInt(json['favoriteIdeasCount']),
      unreadNotificationsCount: _asInt(json['unreadNotificationsCount']),
      avatarUrl: json['avatarUrl']?.toString(),
      userType: json['userType']?.toString(),
    );
  }

  UserSummary copyWith({
    String? fullName,
    String? email,
    int? creditBalance,
    int? remainingFreeGenerations,
    int? unreadNotificationsCount,
    String? accountStatus,
    String? userType,
    String? avatarUrl,
    bool clearAvatar = false,
  }) {
    return UserSummary(
      id: id,
      fullName: fullName ?? this.fullName,
      email: email ?? this.email,
      accountStatus: accountStatus ?? this.accountStatus,
      creditBalance: creditBalance ?? this.creditBalance,
      remainingFreeGenerations:
          remainingFreeGenerations ?? this.remainingFreeGenerations,
      ideasCount: ideasCount,
      publishedIdeasCount: publishedIdeasCount,
      favoriteIdeasCount: favoriteIdeasCount,
      unreadNotificationsCount:
          unreadNotificationsCount ?? this.unreadNotificationsCount,
      avatarUrl: clearAvatar ? null : (avatarUrl ?? this.avatarUrl),
      freeIdeasCount: freeIdeasCount,
      premiumIdeasCount: premiumIdeasCount,
      openComplaintsCount: openComplaintsCount,
      resolvedComplaintsCount: resolvedComplaintsCount,
      totalPayments: totalPayments,
      totalCreditsPurchased: totalCreditsPurchased,
      userType: userType ?? this.userType,
      latestIdea: latestIdea,
    );
  }
}

class IdeaSummary {
  const IdeaSummary({
    required this.id,
    required this.title,
    required this.abstractText,
    required this.domainName,
    required this.generationType,
    required this.isUnlocked,
    required this.isFavorite,
    required this.createdAt,
    this.publicationId,
    this.publicationStatus,
  });

  final String id;
  final String title;
  final String abstractText;
  final String domainName;
  final String generationType;
  final bool isUnlocked;
  final bool isFavorite;
  final DateTime? createdAt;
  final String? publicationId;
  final String? publicationStatus;

  bool get isPremiumGenerated => generationType == 'PREMIUM_CREDIT';

  factory IdeaSummary.fromJson(Map<String, dynamic> json) {
    final publication = json['publication'] is Map
        ? Map<String, dynamic>.from(json['publication'] as Map)
        : const <String, dynamic>{};
    final idea = json['idea'] is Map
        ? Map<String, dynamic>.from(json['idea'] as Map)
        : const <String, dynamic>{};
    final domain = json['domain'] is Map
        ? Map<String, dynamic>.from(json['domain'] as Map)
        : idea['domain'] is Map
            ? Map<String, dynamic>.from(idea['domain'] as Map)
            : const <String, dynamic>{};

    final rawIdeaId = json['ideaId'] ??
        idea['id'] ??
        publication['ideaId'] ??
        json['id'];

    return IdeaSummary(
      id: '${rawIdeaId ?? ''}',
      title:
          '${json['title'] ?? json['publicTitle'] ?? idea['title'] ?? publication['publicTitle'] ?? 'Untitled idea'}',
      abstractText:
          '${json['limitedAbstract'] ?? json['partialAbstract'] ?? json['abstract'] ?? json['publicAbstract'] ?? json['problemStatement'] ?? idea['limitedAbstract'] ?? idea['partialAbstract'] ?? publication['publicAbstract'] ?? ''}',
      domainName: '${domain['name'] ?? json['domainName'] ?? 'General'}',
      generationType:
          '${json['generationType'] ?? idea['generationType'] ?? 'NORMAL_FREE'}',
      isUnlocked: json['isUnlocked'] == true || idea['isUnlocked'] == true,
      isFavorite: json['isFavorite'] == true || idea['isFavorite'] == true,
      createdAt: DateTime.tryParse(
        '${json['createdAt'] ?? json['publishedAt'] ?? idea['createdAt'] ?? ''}',
      ),
      publicationId: publication['id']?.toString() ??
          json['publicationId']?.toString() ??
          (json.containsKey('publicTitle') ? json['id']?.toString() : null),
      publicationStatus:
          publication['status']?.toString() ?? json['status']?.toString(),
    );
  }
}

class DiscoveryItem {
  const DiscoveryItem({
    required this.id,
    required this.title,
    required this.description,
    required this.domainName,
    required this.publisherName,
    required this.acceptanceCount,
    required this.ratingAverage,
    required this.publishedAt,
    this.upvotesCount = 0,
    this.downvotesCount = 0,
    this.ratingsCount = 0,
    this.feedbackCount = 0,
    this.isAccepted = false,
  });

  final String id;
  final String title;
  final String description;
  final String domainName;
  final String publisherName;
  final int acceptanceCount;
  final double ratingAverage;
  final DateTime? publishedAt;
  final int upvotesCount;
  final int downvotesCount;
  final int ratingsCount;
  final int feedbackCount;
  final bool isAccepted;

  factory DiscoveryItem.fromJson(Map<String, dynamic> json) {
    final idea = json['idea'] is Map
        ? Map<String, dynamic>.from(json['idea'] as Map)
        : const <String, dynamic>{};
    final domain = json['domain'] is Map
        ? Map<String, dynamic>.from(json['domain'] as Map)
        : idea['domain'] is Map
            ? Map<String, dynamic>.from(idea['domain'] as Map)
            : const <String, dynamic>{};
    final user = json['user'] is Map
        ? Map<String, dynamic>.from(json['user'] as Map)
        : json['publisher'] is Map
            ? Map<String, dynamic>.from(json['publisher'] as Map)
            : const <String, dynamic>{};

    return DiscoveryItem(
      id: '${json['id'] ?? json['publicationId'] ?? ''}',
      title:
          '${json['publicTitle'] ?? json['title'] ?? idea['title'] ?? 'Community idea'}',
      description:
          '${json['publicDescription'] ?? json['publicAbstract'] ?? json['description'] ?? idea['limitedAbstract'] ?? idea['partialAbstract'] ?? ''}',
      domainName: '${domain['name'] ?? json['domainName'] ?? 'General'}',
      publisherName:
          '${user['fullName'] ?? json['publisherName'] ?? 'Community member'}',
      acceptanceCount:
          _asInt(json['acceptanceCount'] ?? json['acceptancesCount']),
      ratingAverage:
          _asDouble(json['ratingAverage'] ?? json['averageRating']),
      publishedAt:
          DateTime.tryParse('${json['publishedAt'] ?? json['createdAt'] ?? ''}'),
      upvotesCount: _asInt(json['upvotesCount'] ?? json['upvoteCount']),
      downvotesCount: _asInt(json['downvotesCount'] ?? json['downvoteCount']),
      ratingsCount: _asInt(json['ratingsCount'] ?? json['ratingCount']),
      feedbackCount: _asInt(
        json['feedbackCount'] ??
            json['feedbacksCount'] ??
            json['commentsCount'],
      ),
      isAccepted: json['isAccepted'] == true ||
          json['acceptanceId'] != null ||
          (json['acceptance'] is Map &&
              (json['acceptance'] as Map)['id'] != null),
    );
  }
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.message,
    required this.isRead,
    required this.createdAt,
    this.type,
    this.actionUrl,
  });

  final String id;
  final String title;
  final String message;
  final bool isRead;
  final DateTime? createdAt;
  final String? type;
  final String? actionUrl;

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    final nestedNotification = json['notification'] is Map
        ? Map<String, dynamic>.from(json['notification'] as Map)
        : const <String, dynamic>{};
    final nestedAlert = json['alert'] is Map
        ? Map<String, dynamic>.from(json['alert'] as Map)
        : const <String, dynamic>{};
    final nestedData = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : const <String, dynamic>{};

    return AppNotification(
      id: '${json['id'] ?? ''}',
      title:
          '${json['title'] ?? json['subject'] ?? nestedNotification['title'] ?? nestedAlert['title'] ?? nestedData['title'] ?? 'Voxidence'}',
      message:
          '${json['message'] ?? json['adminMessage'] ?? json['body'] ?? json['content'] ?? nestedNotification['message'] ?? nestedNotification['body'] ?? nestedAlert['message'] ?? nestedData['message'] ?? ''}',
      isRead: json['isRead'] == true,
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
      type: json['type']?.toString(),
      actionUrl: _firstNonEmpty([
        json['actionUrl'],
        json['link'],
        nestedData['url'],
        nestedData['actionUrl'],
      ]),
    );
  }
}


String? _firstNonEmpty(List<dynamic> values) {
  for (final value in values) {
    final text = value?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return null;
}

int _asInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value') ?? 0;
}

double _asDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse('$value') ?? 0;
}
