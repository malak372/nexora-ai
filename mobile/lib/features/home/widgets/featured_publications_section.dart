import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../api/home_public_api.dart';
import '../models/public_publication.dart';
import 'common.dart';

/// Backend-connected Featured Ideas section.
///
/// @author Eman
class BackendFeaturedIdeasSection extends StatefulWidget {
  const BackendFeaturedIdeasSection({
    super.key,
    required this.onViewIdeaPressed,
    required this.onCreateAccountPressed,
  });

  final ValueChanged<String> onViewIdeaPressed;
  final VoidCallback onCreateAccountPressed;

  @override
  State<BackendFeaturedIdeasSection> createState() =>
      _BackendFeaturedIdeasSectionState();
}

class _BackendFeaturedIdeasSectionState
    extends State<BackendFeaturedIdeasSection> {
  static const double _cardHeight = 286;

  late Future<PublicPublicationPage> _future;

  @override
  void initState() {
    super.initState();

    _future = _load();
  }

  Future<PublicPublicationPage> _load() {
    return HomePublicApi.instance.getFeaturedPublications(limit: 3);
  }

  void _retry() {
    setState(() {
      _future = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 36, 0, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: SectionHeading(
              eyebrow: 'COMMUNITY DISCOVERIES',
              title: 'Explore ideas shaped by real community evidence.',
              description:
                  'A curated look at public software opportunities discovered, evaluated, and shared through Voxidence.',
            ),
          ),
          const SizedBox(height: 18),
          FutureBuilder<PublicPublicationPage>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _FeaturedLoadingState();
              }

              if (snapshot.hasError) {
                return _FeaturedErrorState(
                  message: _errorMessage(snapshot.error),
                  onRetry: _retry,
                );
              }

              final publications =
                  snapshot.data?.items ?? const <PublicPublication>[];

              if (publications.isEmpty) {
                return _FeaturedEmptyState(
                  onCreateAccountPressed: widget.onCreateAccountPressed,
                );
              }

              return LayoutBuilder(
                builder: (context, constraints) {
                  final cardWidth = _resolveCardWidth(constraints.maxWidth);

                  return SizedBox(
                    height: _cardHeight,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 0, 20, 0),
                      itemCount: publications.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 12),
                      itemBuilder: (context, index) {
                        final publication = publications[index];

                        return _PublicationCard(
                          publication: publication,
                          index: index,
                          width: cardWidth,
                          height: _cardHeight,
                          onPressed: () {
                            widget.onViewIdeaPressed(publication.id);
                          },
                        );
                      },
                    ),
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }

  double _resolveCardWidth(double availableWidth) {
    if (availableWidth <= 340) {
      return availableWidth * 0.86;
    }

    if (availableWidth <= 390) {
      return availableWidth * 0.82;
    }

    if (availableWidth <= 430) {
      return availableWidth * 0.79;
    }

    return (availableWidth * 0.76).clamp(305.0, 370.0);
  }

  String _errorMessage(Object? error) {
    if (error is HomePublicException) {
      return error.message;
    }

    return 'Public ideas could not be loaded.';
  }
}

class _PublicationCard extends StatelessWidget {
  const _PublicationCard({
    required this.publication,
    required this.index,
    required this.width,
    required this.height,
    required this.onPressed,
  });

  final PublicPublication publication;
  final int index;
  final double width;
  final double height;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final usePink = index.isOdd;

    final accent = usePink ? AppColors.pink : AppColors.primary;

    final accentDark = usePink
        ? const Color(0xFFB8697C)
        : AppColors.primaryDark;

    final soft = usePink ? AppColors.pinkSoft : AppColors.primarySoft;

    return SizedBox(
      width: width,
      height: height,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(25),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(25),
          child: Ink(
            padding: const EdgeInsets.fromLTRB(17, 16, 17, 15),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Colors.white, soft.withValues(alpha: 0.20)],
              ),
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: accent.withValues(alpha: 0.18)),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primaryDeep.withValues(alpha: 0.045),
                  blurRadius: 20,
                  offset: const Offset(0, 9),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 41,
                      height: 41,
                      decoration: BoxDecoration(
                        color: soft,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Icon(
                        Icons.lightbulb_outline_rounded,
                        size: 20,
                        color: accent,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.86),
                        borderRadius: BorderRadius.circular(99),
                        border: Border.all(
                          color: accent.withValues(alpha: 0.10),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 5,
                            height: 5,
                            decoration: BoxDecoration(
                              color: accent,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Public discovery',
                            style: TextStyle(
                              color: accentDark,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _MetaLine(
                        icon: Icons.person_outline_rounded,
                        text: publication.publisherName,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _MetaLine(
                      icon: Icons.calendar_today_outlined,
                      text: _formatDate(publication.publishedAt),
                    ),
                  ],
                ),
                const SizedBox(height: 11),
                Text(
                  publication.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 19,
                    height: 1.14,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  publication.summary,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.8,
                    height: 1.42,
                  ),
                ),
                const SizedBox(height: 10),
                Expanded(
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(11, 9, 11, 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF7FBFA),
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(
                        color: AppColors.border.withValues(alpha: 0.85),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'SELECTED DIRECTION',
                          style: TextStyle(
                            color: accentDark,
                            fontSize: 8.2,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 0.65,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Expanded(
                          child: Text(
                            publication.selectedDirection,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 9.8,
                              height: 1.35,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _Signal(
                      icon: Icons.star_outline_rounded,
                      value: publication.averageRating.toStringAsFixed(1),
                    ),
                    const SizedBox(width: 12),
                    _Signal(
                      icon: Icons.chat_bubble_outline_rounded,
                      value: '${publication.feedbackCount}',
                    ),
                    const Spacer(),
                    Text(
                      'Open idea',
                      style: TextStyle(
                        color: accentDark,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 16,
                      color: accentDark,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime? value) {
    if (value == null) {
      return 'Recently';
    }

    return DateFormat('MMM d, yyyy').format(value.toLocal());
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: AppColors.textMuted),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 8.9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class _Signal extends StatelessWidget {
  const _Signal({required this.icon, required this.value});

  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AppColors.primaryDark),
        const SizedBox(width: 4),
        Text(
          value,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 9.7,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _FeaturedLoadingState extends StatelessWidget {
  const _FeaturedLoadingState();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: _BackendFeaturedIdeasSectionState._cardHeight,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 20, 0),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (_, _) {
          return Container(
            width: 300,
            padding: const EdgeInsets.all(17),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.85),
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: AppColors.border),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Skeleton(width: 41, height: 41, radius: 14),
                SizedBox(height: 20),
                _Skeleton(width: 205, height: 11),
                SizedBox(height: 17),
                _Skeleton(width: 230, height: 22),
                SizedBox(height: 12),
                _Skeleton(width: double.infinity, height: 11),
                SizedBox(height: 8),
                _Skeleton(width: 245, height: 11),
                SizedBox(height: 20),
                _Skeleton(width: double.infinity, height: 70, radius: 15),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton({
    required this.width,
    required this.height,
    this.radius = 99,
  });

  final double width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFFEAF3F1),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class _FeaturedErrorState extends StatelessWidget {
  const _FeaturedErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: HomeCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const HomeIconBox(
              icon: Icons.lightbulb_outline_rounded,
              size: 43,
              iconSize: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Public ideas could not be loaded.',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 10.8,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SecondaryButton(
                    label: 'Try again',
                    onPressed: onRetry,
                    icon: Icons.refresh_rounded,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeaturedEmptyState extends StatelessWidget {
  const _FeaturedEmptyState({required this.onCreateAccountPressed});

  final VoidCallback onCreateAccountPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: HomeCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const HomeIconBox(icon: Icons.lightbulb_outline_rounded),
            const SizedBox(height: 14),
            const Text(
              'No public ideas yet.',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            const Text(
              'The first published discoveries will appear here automatically.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11.2,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 13),
            PrimaryButton(
              label: 'Create an account',
              onPressed: onCreateAccountPressed,
              icon: Icons.arrow_forward_rounded,
            ),
          ],
        ),
      ),
    );
  }
}
