// Mobile content sections for the Voxidence public Home screen.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../guest_idea/api/guest_idea_api.dart';
import '../models/home_models.dart';
import 'common.dart';

class AboutSection extends StatelessWidget {
  const AboutSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 34, 16, 12),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Colors.white.withValues(alpha: 0.88),
              const Color(0xFFF4FBF9).withValues(alpha: 0.76),
            ],
          ),
          borderRadius: BorderRadius.circular(31),
          border: Border.all(color: Colors.white.withValues(alpha: 0.88)),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: 0.07),
              blurRadius: 32,
              offset: const Offset(0, 16),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned(
              right: -70,
              top: -60,
              child: Container(
                width: 190,
                height: 190,
                decoration: BoxDecoration(
                  color: AppColors.pinkLight.withValues(alpha: 0.13),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Positioned(
              left: -46,
              bottom: -58,
              child: Container(
                width: 150,
                height: 150,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.18),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(21),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEEF9F7).withValues(alpha: 0.88),
                      borderRadius: BorderRadius.circular(99),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: 0.22),
                      ),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          size: 13,
                          color: AppColors.primaryDark,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'WHY VOXIDENCE',
                          style: TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 9.8,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 0.7,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Ideas should begin with\nreal human needs.',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 29,
                      height: 1.06,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.9,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Instead of guessing from a blank prompt, Voxidence listens first, evaluates repeated community signals, compares AI directions, and keeps the evidence attached to the result.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 12.5,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 19),
                  const _AboutFeatureGrid(),
                  const SizedBox(height: 15),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.64),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: 0.12),
                      ),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.track_changes_rounded,
                          color: Color(0xFFF3C9D3),
                          size: 19,
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Mission: help students, developers, and innovators build software that responds to genuine problems rather than assumptions.',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 11.3,
                              height: 1.42,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
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

class _AboutFeatureGrid extends StatelessWidget {
  const _AboutFeatureGrid();

  @override
  Widget build(BuildContext context) {
    return const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _AboutFeature(
                icon: Icons.fact_check_outlined,
                title: 'Evidence first',
                subtitle: 'Grounded decisions',
              ),
            ),
            SizedBox(width: 9),
            Expanded(
              child: _AboutFeature(
                icon: Icons.psychology_alt_outlined,
                title: 'Multi-model',
                subtitle: 'Compared directions',
              ),
            ),
          ],
        ),
        SizedBox(height: 9),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _AboutFeature(
                icon: Icons.public_rounded,
                title: 'Community-led',
                subtitle: 'Real public signals',
              ),
            ),
            SizedBox(width: 9),
            Expanded(
              child: _AboutFeature(
                icon: Icons.dashboard_customize_outlined,
                title: 'Build-ready',
                subtitle: 'Structured outputs',
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _AboutFeature extends StatelessWidget {
  const _AboutFeature({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.86),
            const Color(0xFFFFFCFC).withValues(alpha: 0.70),
          ],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.12)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.primaryDark),
          const SizedBox(height: 12),
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 11.4,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.4,
            ),
          ),
        ],
      ),
    );
  }
}

class DomainsSection extends StatefulWidget {
  const DomainsSection({super.key});

  @override
  State<DomainsSection> createState() => _DomainsSectionState();
}

class _DomainsSectionState extends State<DomainsSection> {
  static const int _initialVisibleCount = 5;

  bool _isExpanded = false;
  bool _isLoading = true;

  String? _errorMessage;

  List<DomainItem> _domains = const [];

  @override
  void initState() {
    super.initState();
    _loadDomains();
  }

  Future<void> _loadDomains() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final response = await GuestIdeaApi.instance.getAvailableDomains();

      final domains = response
          .map(_domainFromApi)
          .whereType<DomainItem>()
          .toList(growable: false);

      if (!mounted) {
        return;
      }

      setState(() {
        _domains = domains;
        _isLoading = false;
        _isExpanded = false;
      });
    } on GuestIdeaException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _domains = const [];
        _isLoading = false;
        _errorMessage = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _domains = const [];
        _isLoading = false;
        _errorMessage = 'Domains could not be loaded. Please try again.';
      });
    }
  }

  DomainItem? _domainFromApi(Map<String, dynamic> item) {
    final rawName = item['name'] ?? item['title'] ?? item['label'];

    final name = rawName?.toString().trim() ?? '';

    if (name.isEmpty) {
      return null;
    }

    return DomainItem(
      title: name,
      description: _domainDescription(name),
      icon: _domainIcon(name),
    );
  }

  String _domainDescription(String name) {
    final value = name.toLowerCase();

    if (_has(value, ['education', 'learning', 'school', 'university'])) {
      return 'Smarter learning experiences';
    }

    if (_has(value, ['health', 'medical', 'medicine'])) {
      return 'Accessible digital care';
    }

    if (_has(value, ['business', 'enterprise', 'startup'])) {
      return 'Better everyday operations';
    }

    if (_has(value, ['environment', 'climate', 'sustainability'])) {
      return 'Sustainable local solutions';
    }

    if (_has(value, ['community', 'social'])) {
      return 'Services people actually need';
    }

    if (_has(value, ['finance', 'fintech', 'banking'])) {
      return 'Simpler financial experiences';
    }

    if (_has(value, ['food', 'restaurant', 'hospitality'])) {
      return 'Better food and service experiences';
    }

    if (_has(value, ['government', 'public sector', 'civic'])) {
      return 'More accessible public services';
    }

    if (_has(value, ['human resources', 'recruitment', 'hiring', 'jobs']) ||
        value == 'hr') {
      return 'Smarter people and hiring workflows';
    }

    if (_has(value, ['internet of things', 'iot', 'smart devices'])) {
      return 'Connected solutions for daily needs';
    }

    if (_has(value, ['agriculture', 'farming', 'agritech'])) {
      return 'Smarter tools for agriculture';
    }

    if (_has(value, ['retail', 'ecommerce', 'e commerce', 'shopping'])) {
      return 'Better shopping experiences';
    }

    if (_has(value, ['logistics', 'delivery', 'shipping', 'supply chain'])) {
      return 'Smoother delivery and supply flows';
    }

    if (_has(value, ['transport', 'transportation', 'mobility'])) {
      return 'More efficient mobility solutions';
    }

    if (_has(value, ['tourism', 'travel'])) {
      return 'Better travel experiences';
    }

    if (_has(value, ['industry', 'manufacturing', 'factory'])) {
      return 'Smarter industrial operations';
    }

    if (_has(value, ['energy', 'electricity', 'power', 'renewable'])) {
      return 'More efficient energy solutions';
    }

    if (_has(value, ['technology', 'software', 'artificial intelligence']) ||
        value == 'ai') {
      return 'Tools for emerging challenges';
    }

    return 'Evidence-backed opportunities in this domain';
  }

  IconData _domainIcon(String name) {
    final value = name.toLowerCase();

    if (_has(value, ['education', 'learning', 'school', 'university'])) {
      return Icons.school_outlined;
    }

    if (_has(value, ['health', 'medical', 'medicine'])) {
      return Icons.favorite_border_rounded;
    }

    if (_has(value, ['business', 'enterprise', 'startup'])) {
      return Icons.business_center_outlined;
    }

    if (_has(value, ['environment', 'climate', 'sustainability', 'green'])) {
      return Icons.eco_outlined;
    }

    if (_has(value, ['community', 'social'])) {
      return Icons.groups_2_outlined;
    }

    if (_has(value, ['finance', 'fintech', 'banking', 'insurance'])) {
      return Icons.account_balance_wallet_outlined;
    }

    if (_has(value, ['food', 'restaurant', 'hospitality'])) {
      return Icons.restaurant_outlined;
    }

    if (_has(value, ['government', 'public sector', 'civic'])) {
      return Icons.account_balance_outlined;
    }

    if (_has(value, ['human resources', 'recruitment', 'hiring', 'jobs']) ||
        value == 'hr') {
      return Icons.person_search_outlined;
    }

    if (_has(value, ['internet of things', 'iot', 'smart devices'])) {
      return Icons.router_outlined;
    }

    if (_has(value, ['agriculture', 'farming', 'agritech'])) {
      return Icons.agriculture_outlined;
    }

    if (_has(value, ['retail', 'ecommerce', 'e commerce', 'shopping'])) {
      return Icons.shopping_bag_outlined;
    }

    if (_has(value, ['logistics', 'delivery', 'shipping', 'supply chain'])) {
      return Icons.local_shipping_outlined;
    }

    if (_has(value, ['transport', 'transportation', 'mobility'])) {
      return Icons.directions_bus_outlined;
    }

    if (_has(value, ['tourism', 'travel'])) {
      return Icons.flight_takeoff_outlined;
    }

    if (_has(value, ['industry', 'manufacturing', 'factory'])) {
      return Icons.precision_manufacturing_outlined;
    }

    if (_has(value, ['energy', 'electricity', 'power', 'renewable'])) {
      return Icons.bolt_outlined;
    }

    if (_has(value, ['technology', 'software', 'artificial intelligence']) ||
        value == 'ai') {
      return Icons.memory_outlined;
    }

    return Icons.layers_outlined;
  }

  bool _has(String value, List<String> terms) {
    return terms.any(value.contains);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 36, 16, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeading(
            eyebrow: 'OPPORTUNITY DOMAINS',
            title: 'Explore where real needs are emerging.',
            description:
                'Voxidence can surface evidence-backed project opportunities across practical domains that matter to everyday communities.',
          ),
          const SizedBox(height: 18),
          if (_isLoading)
            const _DomainsLoading()
          else if (_errorMessage != null)
            _DomainsError(message: _errorMessage!, onRetry: _loadDomains)
          else if (_domains.isEmpty)
            const _DomainsEmpty()
          else
            _buildDomains(),
        ],
      ),
    );
  }

  Widget _buildDomains() {
    final firstDomains = _domains
        .take(_initialVisibleCount)
        .toList(growable: false);

    final moreDomains = _domains
        .skip(_initialVisibleCount)
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _DomainGrid(
          children: [
            for (var i = 0; i < firstDomains.length; i++)
              _DomainCard(domain: firstDomains[i], usePink: i == 1 || i == 4),
            if (moreDomains.isNotEmpty)
              _ExploreMoreCard(
                count: moreDomains.length,
                expanded: _isExpanded,
                onTap: () {
                  setState(() {
                    _isExpanded = !_isExpanded;
                  });
                },
              ),
          ],
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: _isExpanded && moreDomains.isNotEmpty
              ? Padding(
                  padding: const EdgeInsets.only(top: 18),
                  child: _ExpandedDomains(
                    domains: moreDomains,
                    onCollapse: () {
                      setState(() {
                        _isExpanded = false;
                      });
                    },
                  ),
                )
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

class _DomainGrid extends StatelessWidget {
  const _DomainGrid({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 10.0;

        final twoColumns = constraints.maxWidth >= 350;

        final width = twoColumns
            ? (constraints.maxWidth - gap) / 2
            : constraints.maxWidth;

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final child in children)
              SizedBox(width: width, height: 154, child: child),
          ],
        );
      },
    );
  }
}

class _DomainCard extends StatelessWidget {
  const _DomainCard({required this.domain, required this.usePink});

  final DomainItem domain;
  final bool usePink;

  @override
  Widget build(BuildContext context) {
    final soft = usePink ? AppColors.pinkSoft : AppColors.primarySoft;

    final accent = usePink ? AppColors.pink : AppColors.primaryDark;

    return SizedBox.expand(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Colors.white.withValues(alpha: 0.97),
              soft.withValues(alpha: 0.50),
            ],
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: 0.035),
              blurRadius: 16,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: soft,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(domain.icon, size: 20, color: accent),
            ),
            const SizedBox(height: 12),
            Text(
              domain.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 14.2,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            Expanded(
              child: Text(
                domain.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.9,
                  height: 1.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExploreMoreCard extends StatelessWidget {
  const _ExploreMoreCard({
    required this.count,
    required this.expanded,
    required this.onTap,
  });

  final int count;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Ink(
          width: double.infinity,
          height: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.primarySoft.withValues(alpha: 0.92),
                Colors.white.withValues(alpha: 0.96),
              ],
            ),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.24),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(
                      Icons.layers_outlined,
                      size: 20,
                      color: Colors.white,
                    ),
                  ),
                  const Spacer(),
                  AnimatedRotation(
                    turns: expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 220),
                    child: const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      size: 20,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 11),
              Text(
                expanded ? 'Hide More' : 'Explore More',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 14.2,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '$count additional domain${count == 1 ? '' : 's'} available',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.7,
                  height: 1.25,
                ),
              ),
              const Spacer(),
              Text(
                expanded ? 'Show less' : 'View all domains',
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 9.2,
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

class _ExpandedDomains extends StatelessWidget {
  const _ExpandedDomains({required this.domains, required this.onCollapse});

  final List<DomainItem> domains;
  final VoidCallback onCollapse;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${domains.length} more domain${domains.length == 1 ? '' : 's'}',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 12.4,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            TextButton(
              onPressed: onCollapse,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primaryDark,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Show less',
                    style: TextStyle(
                      fontSize: 9.4,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(width: 3),
                  Icon(Icons.keyboard_arrow_up_rounded, size: 15),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _DomainGrid(
          children: [
            for (var i = 0; i < domains.length; i++)
              _DomainCard(domain: domains[i], usePink: i.isOdd),
          ],
        ),
      ],
    );
  }
}

class _DomainsLoading extends StatelessWidget {
  const _DomainsLoading();

  @override
  Widget build(BuildContext context) {
    return _DomainGrid(
      children: List.generate(
        6,
        (_) => Container(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.border),
          ),
        ),
      ),
    );
  }
}

class _DomainsError extends StatelessWidget {
  const _DomainsError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.82),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_outlined, color: AppColors.pink, size: 22),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10,
                height: 1.3,
              ),
            ),
          ),
          IconButton(
            onPressed: onRetry,
            tooltip: 'Retry',
            icon: const Icon(
              Icons.refresh_rounded,
              color: AppColors.primaryDark,
            ),
          ),
        ],
      ),
    );
  }
}

class _DomainsEmpty extends StatelessWidget {
  const _DomainsEmpty();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.border),
      ),
      child: const Text(
        'No domains are available yet.',
        style: TextStyle(
          color: AppColors.textSecondary,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class FeaturedIdeasSection extends StatelessWidget {
  const FeaturedIdeasSection({
    super.key,
    required this.onViewIdeaPressed,
    required this.onExploreAllPressed,
  });

  final ValueChanged<String> onViewIdeaPressed;
  final VoidCallback onExploreAllPressed;

  static const double _cardHeight = 248;

  @override
  Widget build(BuildContext context) {
    final ideas = HomeData.featuredIdeas;

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
              title: 'See what the evidence can become.',
              description:
                  'A mobile preview of software directions shaped around recurring public needs instead of random prompts.',
            ),
          ),

          const SizedBox(height: 18),

          LayoutBuilder(
            builder: (context, constraints) {
              final cardWidth = _resolveCardWidth(constraints.maxWidth);

              return SizedBox(
                height: _cardHeight,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  clipBehavior: Clip.hardEdge,
                  padding: const EdgeInsets.fromLTRB(16, 0, 20, 0),
                  itemCount: ideas.length,
                  separatorBuilder: (_, _) {
                    return const SizedBox(width: 12);
                  },
                  itemBuilder: (context, index) {
                    final idea = ideas[index];

                    return _IdeaCard(
                      idea: idea,
                      index: index,
                      width: cardWidth,
                      height: _cardHeight,
                      onPressed: () {
                        onViewIdeaPressed(idea.title);
                      },
                    );
                  },
                ),
              );
            },
          ),

          const SizedBox(height: 16),

          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SecondaryButton(
              label: 'Explore all ideas',
              onPressed: onExploreAllPressed,
              icon: Icons.arrow_forward_rounded,
              expand: true,
            ),
          ),
        ],
      ),
    );
  }

  double _resolveCardWidth(double availableWidth) {
    if (availableWidth <= 340) {
      return availableWidth * 0.82;
    }

    if (availableWidth <= 390) {
      return availableWidth * 0.78;
    }

    if (availableWidth <= 430) {
      return availableWidth * 0.76;
    }

    return (availableWidth * 0.74).clamp(300.0, 360.0);
  }
}

class _IdeaCard extends StatelessWidget {
  const _IdeaCard({
    required this.idea,
    required this.index,
    required this.width,
    required this.height,
    required this.onPressed,
  });

  final FeaturedIdea idea;
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
            width: width,
            height: height,
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
                SizedBox(
                  height: 41,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
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
                        height: 32,
                        constraints: const BoxConstraints(minWidth: 112),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.84),
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(
                            color: accent.withValues(alpha: 0.10),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
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
                            Flexible(
                              child: Text(
                                '${idea.score.toStringAsFixed(0)} evidence score',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: accentDark,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 14),

                SizedBox(
                  height: 14,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      idea.domain.toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: accentDark,
                        fontSize: 9.2,
                        height: 1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.64,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 7),

                SizedBox(
                  height: 26,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      idea.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 19.5,
                        height: 1.15,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.45,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 7),

                Expanded(
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: Text(
                      idea.summary,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10.9,
                        height: 1.42,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 7),

                SizedBox(
                  height: 30,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: accent,
                          shape: BoxShape.circle,
                        ),
                      ),

                      const SizedBox(width: 7),

                      const Expanded(
                        child: Text(
                          'Evidence-backed direction',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 9.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),

                      const SizedBox(width: 8),

                      Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: accent.withValues(alpha: 0.09),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.arrow_forward_rounded,
                          size: 16,
                          color: accentDark,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
