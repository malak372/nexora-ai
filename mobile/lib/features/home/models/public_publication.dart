/// Public publication models used by the Voxidence mobile Home experience.
///
/// The fields mirror the safe public publication snapshot returned by the
/// backend `/publications` endpoints.
///
/// @author Eman
class PublicPublication {
  const PublicPublication({
    required this.id,
    required this.title,
    required this.abstractText,
    required this.problem,
    required this.objectives,
    required this.targetUsers,
    required this.publisherName,
    required this.publishedAt,
    required this.averageRating,
    required this.ratingsCount,
    required this.upvotesCount,
    required this.downvotesCount,
    required this.feedbackCount,
    required this.allowRatings,
    required this.allowFeedback,
    required this.allowVoting,
  });

  final String id;
  final String title;
  final String abstractText;
  final String problem;
  final List<String> objectives;
  final List<String> targetUsers;
  final String publisherName;
  final DateTime? publishedAt;
  final double averageRating;
  final int ratingsCount;
  final int upvotesCount;
  final int downvotesCount;
  final int feedbackCount;
  final bool allowRatings;
  final bool allowFeedback;
  final bool allowVoting;

  String get summary {
    if (problem.trim().isNotEmpty) {
      return problem.trim();
    }

    if (abstractText.trim().isNotEmpty) {
      return abstractText.trim();
    }

    return 'A public software opportunity discovered through Voxidence.';
  }

  String get selectedDirection {
    for (final objective in objectives) {
      if (objective.trim().isNotEmpty) {
        return objective.trim();
      }
    }

    if (abstractText.trim().isNotEmpty) {
      return abstractText.trim();
    }

    return 'Open this publication to explore the complete opportunity direction.';
  }

  factory PublicPublication.fromJson(Map<String, dynamic> json) {
    final publisher = json['publisher'];

    return PublicPublication(
      id: json['id']?.toString().trim() ?? '',
      title: _text(json['publicTitle'], fallback: 'Untitled software idea'),
      abstractText: _text(json['publicAbstract']),
      problem: _text(json['publicProblem']),
      objectives: _stringList(json['publicObjectives']),
      targetUsers: _stringList(json['publicTargetUsers']),
      publisherName: publisher is Map
          ? _text(publisher['fullName'], fallback: 'Voxidence creator')
          : 'Voxidence creator',
      publishedAt: _date(json['publishedAt']),
      averageRating: _double(json['averageRating']),
      ratingsCount: _int(json['ratingsCount']),
      upvotesCount: _int(json['upvotesCount']),
      downvotesCount: _int(json['downvotesCount']),
      feedbackCount: _int(json['feedbackCount']),
      allowRatings: json['allowRatings'] != false,
      allowFeedback: json['allowFeedback'] != false,
      allowVoting: json['allowVoting'] != false,
    );
  }

  static String _text(dynamic value, {String fallback = ''}) {
    final normalized = value?.toString().trim() ?? '';

    return normalized.isEmpty ? fallback : normalized;
  }

  static List<String> _stringList(dynamic value) {
    if (value is! List) {
      return const <String>[];
    }

    return value
        .map((item) => item?.toString().trim() ?? '')
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }

  static DateTime? _date(dynamic value) {
    final raw = value?.toString().trim() ?? '';

    return raw.isEmpty ? null : DateTime.tryParse(raw);
  }

  static double _double(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  static int _int(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}

class PublicPublicationPage {
  const PublicPublicationPage({
    required this.items,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  final List<PublicPublication> items;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  factory PublicPublicationPage.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    final pagination = json['pagination'];

    final items = rawItems is List
        ? rawItems
              .whereType<Map>()
              .map(
                (item) =>
                    PublicPublication.fromJson(Map<String, dynamic>.from(item)),
              )
              .where((item) => item.id.isNotEmpty)
              .toList(growable: false)
        : const <PublicPublication>[];

    final paginationMap = pagination is Map
        ? Map<String, dynamic>.from(pagination)
        : const <String, dynamic>{};

    int intValue(String key, int fallback) {
      final value = paginationMap[key];

      if (value is int) {
        return value;
      }

      if (value is num) {
        return value.toInt();
      }

      return int.tryParse(value?.toString() ?? '') ?? fallback;
    }

    return PublicPublicationPage(
      items: items,
      page: intValue('page', 1),
      limit: intValue('limit', items.length),
      total: intValue('total', items.length),
      totalPages: intValue('totalPages', items.isEmpty ? 0 : 1),
    );
  }
}
