// Public publication details page for the Voxidence mobile application.
//
// Displays the public idea information and supports the same guest
// community interactions used by the web application.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_theme.dart';
import '../api/home_public_api.dart';
import '../models/public_publication.dart';

class PublicPublicationDetailsPage extends StatefulWidget {
  const PublicPublicationDetailsPage({super.key, required this.publicationId});

  final String publicationId;

  @override
  State<PublicPublicationDetailsPage> createState() {
    return _PublicPublicationDetailsPageState();
  }
}

class _PublicPublicationDetailsPageState
    extends State<PublicPublicationDetailsPage> {
  final TextEditingController _feedbackController = TextEditingController();

  PublicPublication? _publication;

  bool _isLoading = true;
  bool _isLoadingInteractions = false;
  bool _isSubmittingRating = false;
  bool _isSubmittingVote = false;
  bool _isSubmittingFeedback = false;

  String? _errorMessage;

  int _guestRating = 0;
  String _guestVote = '';
  String _savedFeedback = '';

  @override
  void initState() {
    super.initState();

    _loadPublication();
  }

  @override
  void dispose() {
    _feedbackController.dispose();

    super.dispose();
  }

  Future<void> _loadPublication() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final publication = await HomePublicApi.instance.getPublicPublication(
        widget.publicationId,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _publication = publication;
        _isLoading = false;
      });

      await _loadGuestInteractions();
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;

        if (error is HomePublicException) {
          _errorMessage = error.message;
        } else {
          _errorMessage = 'We could not load this publication right now.';
        }
      });
    }
  }

  Future<void> _loadGuestInteractions() async {
    final publication = _publication;

    if (publication == null) {
      return;
    }

    if (!publication.allowRatings &&
        !publication.allowVoting &&
        !publication.allowFeedback) {
      return;
    }

    setState(() {
      _isLoadingInteractions = true;
    });

    try {
      await HomePublicApi.instance.ensureGuestSession();

      final results = await Future.wait<dynamic>([
        publication.allowRatings
            ? HomePublicApi.instance.getGuestRating(publication.id)
            : Future<int>.value(0),
        publication.allowVoting
            ? HomePublicApi.instance.getGuestVote(publication.id)
            : Future<String>.value(''),
        publication.allowFeedback
            ? HomePublicApi.instance.getGuestFeedback(publication.id)
            : Future<String>.value(''),
      ]);

      if (!mounted) {
        return;
      }

      final rating = results[0] as int;
      final vote = results[1] as String;
      final feedback = results[2] as String;

      _feedbackController.text = feedback;

      setState(() {
        _guestRating = rating;
        _guestVote = vote;
        _savedFeedback = feedback;
        _isLoadingInteractions = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoadingInteractions = false;
      });
    }
  }

  Future<void> _setRating(int value) async {
    final publication = _publication;

    if (publication == null ||
        !publication.allowRatings ||
        _isSubmittingRating) {
      return;
    }

    final previousRating = _guestRating;

    setState(() {
      _guestRating = value;
      _isSubmittingRating = true;
    });

    try {
      await HomePublicApi.instance.ensureGuestSession();
      await HomePublicApi.instance.setGuestRating(publication.id, value);

      if (!mounted) {
        return;
      }

      setState(() => _isSubmittingRating = false);
      _showMessage('Your rating was saved.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _guestRating = previousRating;
        _isSubmittingRating = false;
      });

      _showMessage(
        error is HomePublicException
            ? error.message
            : 'We could not save your rating.',
        error: true,
      );
    }
  }

  Future<void> _setVote(String value) async {
    final publication = _publication;

    if (publication == null || !publication.allowVoting || _isSubmittingVote) {
      return;
    }

    final previousVote = _guestVote;

    setState(() {
      _guestVote = value;
      _isSubmittingVote = true;
    });

    try {
      await HomePublicApi.instance.ensureGuestSession();
      await HomePublicApi.instance.setGuestVote(publication.id, value);

      if (!mounted) {
        return;
      }

      setState(() => _isSubmittingVote = false);
      _showMessage('Your vote was saved.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _guestVote = previousVote;
        _isSubmittingVote = false;
      });

      _showMessage(
        error is HomePublicException
            ? error.message
            : 'We could not save your vote.',
        error: true,
      );
    }
  }

  Future<void> _submitFeedback() async {
    final publication = _publication;

    if (publication == null ||
        !publication.allowFeedback ||
        _isSubmittingFeedback) {
      return;
    }

    final comment = _feedbackController.text.trim();

    if (comment.isEmpty) {
      _showMessage('Please write your feedback first.', error: true);

      return;
    }

    final previousFeedback = _savedFeedback;

    setState(() {
      _savedFeedback = comment;
      _isSubmittingFeedback = true;
    });

    try {
      await HomePublicApi.instance.ensureGuestSession();
      await HomePublicApi.instance.setGuestFeedback(publication.id, comment);

      if (!mounted) {
        return;
      }

      setState(() => _isSubmittingFeedback = false);
      _showMessage('Your feedback was saved.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _savedFeedback = previousFeedback;
        _isSubmittingFeedback = false;
      });

      _showMessage(
        error is HomePublicException
            ? error.message
            : 'We could not save your feedback.',
        error: true,
      );
    }
  }

  void _showMessage(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
          backgroundColor: error
              ? const Color(0xFF9B5D68)
              : AppColors.primaryDark,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          content: Text(
            message,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          onPressed: () {
            Navigator.maybePop(context);
          },
          icon: const Icon(
            Icons.arrow_back_rounded,
            color: AppColors.primaryDark,
          ),
        ),
        title: const Text(
          'Community Idea',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.primary),
      );
    }

    if (_errorMessage != null) {
      return _buildErrorState();
    }

    final publication = _publication;

    if (publication == null) {
      return _buildErrorState();
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _loadPublication,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: EdgeInsets.fromLTRB(
          16,
          8,
          16,
          MediaQuery.paddingOf(context).bottom + 32,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHero(publication),

            const SizedBox(height: 15),

            if (publication.problem.isNotEmpty)
              _InformationCard(
                icon: Icons.search_rounded,
                eyebrow: 'PROBLEM',
                title: 'The need behind this idea',
                child: Text(
                  publication.problem,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                    height: 1.55,
                  ),
                ),
              ),

            if (publication.problem.isNotEmpty) const SizedBox(height: 12),

            if (publication.abstractText.isNotEmpty)
              _InformationCard(
                icon: Icons.auto_awesome_rounded,
                eyebrow: 'PUBLIC ABSTRACT',
                title: 'Opportunity direction',
                child: Text(
                  publication.abstractText,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                    height: 1.55,
                  ),
                ),
              ),

            if (publication.abstractText.isNotEmpty) const SizedBox(height: 12),

            if (publication.objectives.isNotEmpty)
              _InformationCard(
                icon: Icons.flag_outlined,
                eyebrow: 'OBJECTIVES',
                title: 'What the idea aims to achieve',
                child: Column(
                  children: publication.objectives
                      .map((objective) => _BulletItem(text: objective))
                      .toList(),
                ),
              ),

            if (publication.objectives.isNotEmpty) const SizedBox(height: 12),

            if (publication.targetUsers.isNotEmpty)
              _InformationCard(
                icon: Icons.groups_2_outlined,
                eyebrow: 'TARGET USERS',
                title: 'Who this idea is for',
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: publication.targetUsers
                      .map((user) => _UserChip(label: user))
                      .toList(),
                ),
              ),

            if (publication.targetUsers.isNotEmpty) const SizedBox(height: 16),

            _buildCommunitySection(publication),
          ],
        ),
      ),
    );
  }

  Widget _buildHero(PublicPublication publication) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(19),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Colors.white, Color(0xFFF1F7F4)],
        ),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.16)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.05),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Icon(
                  Icons.lightbulb_outline_rounded,
                  color: AppColors.primaryDark,
                  size: 22,
                ),
              ),

              const Spacer(),

              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(99),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: 0.16),
                  ),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.public_rounded,
                      color: AppColors.primaryDark,
                      size: 13,
                    ),
                    SizedBox(width: 5),
                    Text(
                      'PUBLIC IDEA',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.7,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 18),

          Text(
            publication.title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 25,
              height: 1.08,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.7,
            ),
          ),

          const SizedBox(height: 10),

          Text(
            publication.summary,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13,
              height: 1.5,
            ),
          ),

          const SizedBox(height: 17),

          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _MetaChip(
                icon: Icons.person_outline_rounded,
                label: publication.publisherName,
              ),
              _MetaChip(
                icon: Icons.calendar_today_outlined,
                label: _formatDate(publication.publishedAt),
              ),
            ],
          ),

          const SizedBox(height: 17),

          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.74),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _StatItem(
                    icon: Icons.star_rounded,
                    value: publication.averageRating.toStringAsFixed(1),
                    label: 'Rating',
                  ),
                ),

                _verticalDivider(),

                Expanded(
                  child: _StatItem(
                    icon: Icons.thumb_up_alt_outlined,
                    value: '${publication.upvotesCount}',
                    label: 'Upvotes',
                  ),
                ),

                _verticalDivider(),

                Expanded(
                  child: _StatItem(
                    icon: Icons.chat_bubble_outline_rounded,
                    value: '${publication.feedbackCount}',
                    label: 'Feedback',
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCommunitySection(PublicPublication publication) {
    if (!publication.allowRatings &&
        !publication.allowVoting &&
        !publication.allowFeedback) {
      return const SizedBox.shrink();
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.045),
            blurRadius: 22,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'COMMUNITY SIGNAL',
            style: TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9,
              fontWeight: FontWeight.w900,
              letterSpacing: 1,
            ),
          ),

          const SizedBox(height: 5),

          const Text(
            'Share your perspective',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),

          const SizedBox(height: 5),

          const Text(
            'Your response helps the community understand how useful this direction feels.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 11.5,
              height: 1.45,
            ),
          ),

          if (_isLoadingInteractions) ...[
            const SizedBox(height: 18),

            const Center(
              child: CircularProgressIndicator(
                color: AppColors.primary,
                strokeWidth: 2.5,
              ),
            ),
          ] else ...[
            if (publication.allowRatings) ...[
              const SizedBox(height: 20),

              const Text(
                'Rate this idea',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 9),

              Row(
                children: List.generate(5, (index) {
                  final value = index + 1;
                  final selected = _guestRating >= value;

                  return IconButton(
                    onPressed: _isSubmittingRating
                        ? null
                        : () => _setRating(value),
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.all(3),
                    icon: Icon(
                      selected ? Icons.star_rounded : Icons.star_border_rounded,
                      color: selected
                          ? const Color(0xFFC59B4D)
                          : AppColors.textMuted,
                      size: 29,
                    ),
                  );
                }),
              ),
            ],

            if (publication.allowVoting) ...[
              const SizedBox(height: 17),

              const Text(
                'Would you support this direction?',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 10),

              Row(
                children: [
                  Expanded(
                    child: _VoteButton(
                      selected: _guestVote == 'UP',
                      icon: Icons.thumb_up_alt_outlined,
                      label: 'Upvote',
                      onPressed: _isSubmittingVote
                          ? null
                          : () => _setVote('UP'),
                    ),
                  ),

                  const SizedBox(width: 10),

                  Expanded(
                    child: _VoteButton(
                      selected: _guestVote == 'DOWN',
                      icon: Icons.thumb_down_alt_outlined,
                      label: 'Downvote',
                      onPressed: _isSubmittingVote
                          ? null
                          : () => _setVote('DOWN'),
                    ),
                  ),
                ],
              ),
            ],

            if (publication.allowFeedback) ...[
              const SizedBox(height: 19),

              const Text(
                'Leave feedback',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 9),

              TextField(
                controller: _feedbackController,
                minLines: 3,
                maxLines: 5,
                maxLength: 1000,
                decoration: InputDecoration(
                  hintText: 'What do you think about this idea?',
                  filled: true,
                  fillColor: const Color(0xFFF8FBFA),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide(color: AppColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide(color: AppColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: const BorderSide(
                      color: AppColors.primary,
                      width: 1.3,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 10),

              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton.icon(
                  onPressed: _isSubmittingFeedback ? null : _submitFeedback,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                  icon: Icon(
                    _isSubmittingFeedback
                        ? Icons.hourglass_top_rounded
                        : Icons.send_rounded,
                    size: 17,
                  ),
                  label: Text(
                    _isSubmittingFeedback
                        ? 'Saving feedback...'
                        : _savedFeedback.isNotEmpty
                        ? 'Update feedback'
                        : 'Send feedback',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: AppColors.pinkSoft,
                  borderRadius: BorderRadius.circular(17),
                ),
                child: const Icon(
                  Icons.error_outline_rounded,
                  color: AppColors.primaryDark,
                ),
              ),

              const SizedBox(height: 14),

              const Text(
                'Publication unavailable',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),

              const SizedBox(height: 7),

              Text(
                _errorMessage ?? 'This publication could not be loaded.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                  height: 1.5,
                ),
              ),

              const SizedBox(height: 18),

              FilledButton.icon(
                onPressed: _loadPublication,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                ),
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text(
                  'Try again',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _verticalDivider() {
    return Container(width: 1, height: 36, color: AppColors.border);
  }

  String _formatDate(DateTime? date) {
    if (date == null) {
      return 'Recently';
    }

    return DateFormat('MMM d, yyyy').format(date.toLocal());
  }
}

class _InformationCard extends StatelessWidget {
  const _InformationCard({
    required this.icon,
    required this.eyebrow,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String eyebrow;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(23),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, size: 19, color: AppColors.primaryDark),
              ),

              const SizedBox(width: 11),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow,
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.9,
                      ),
                    ),

                    const SizedBox(height: 3),

                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 15),

          child,
        ],
      ),
    );
  }
}

class _BulletItem extends StatelessWidget {
  const _BulletItem({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 7,
            height: 7,
            margin: const EdgeInsets.only(top: 6),
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
          ),

          const SizedBox(width: 9),

          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12.5,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UserChip extends StatelessWidget {
  const _UserChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.15)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.primaryDark,
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(icon, size: 17, color: AppColors.primaryDark),

        const SizedBox(height: 3),

        Text(
          value,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 12,
            fontWeight: FontWeight.w900,
          ),
        ),

        const SizedBox(height: 1),

        Text(
          label,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 8.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _VoteButton extends StatelessWidget {
  const _VoteButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.primarySoft : const Color(0xFFF8FBFA),
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          height: 46,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 17,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.textSecondary,
              ),
              const SizedBox(width: 7),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDark
                      : AppColors.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
