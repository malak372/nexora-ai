// Mobile compliance and complaint workspace matching the web feature set.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class CompliancePage extends StatefulWidget {
  const CompliancePage({super.key});

  @override
  State<CompliancePage> createState() => _CompliancePageState();
}

class _CompliancePageState extends State<CompliancePage> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  Object? _error;
  String _filter = 'ALL';

  @override
  void initState() {
    super.initState();
    _search.addListener(_refreshSearch);
    _load();
  }

  void _refreshSearch() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _search
      ..removeListener(_refreshSearch)
      ..dispose();
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final result = await UserApi.instance.getComplaints(force: force);
      if (mounted) setState(() => _items = result.items);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createCase() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _NewComplaintSheet(),
    );

    if (created == true) {
      await Future.wait([
        _load(force: true),
        UserSessionController.instance.load(force: true),
      ]);
    }
  }

  Future<void> _openCase(Map<String, dynamic> item) async {
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty) return;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ComplaintDetailSheet(complaintId: id),
    );
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();

    final filtered = _items.where((item) {
      final matchesStatus =
          _filter == 'ALL' ||
          '${item['status'] ?? 'OPEN'}'.toUpperCase() == _filter;

      final idea = item['idea'] is Map ? item['idea'] as Map : const {};

      final searchable = <String>[
        '${item['subject'] ?? ''}',
        '${item['message'] ?? ''}',
        '${item['adminReply'] ?? ''}',
        '${idea['title'] ?? ''}',
      ].join(' ').toLowerCase();

      return matchesStatus &&
          (query.isEmpty || searchable.contains(query));
    }).toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      floatingActionButton: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDeep.withValues(alpha: .16),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: FloatingActionButton.extended(
          onPressed: _createCase,
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          icon: const Icon(Icons.add_rounded),
          label: const Text(
            'New case',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
      ),
      body: Column(
        children: [
          _ComplianceRouteHeader(
            onBack: () => returnFromWorkspacePage(context),
          ),
          Expanded(
            child: WorkspaceBackground(
              child: RefreshIndicator(
                color: AppColors.primary,
                onRefresh: () => _load(force: true),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 126),
                  children: [
                    _ComplianceHero(
                      total: _items.length,
                    ),
                    const SizedBox(height: 14),
                    const _CaseJourney(),
                    const SizedBox(height: 12),
                    _CaseStats(items: _items),
                    const SizedBox(height: 14),
                    const _ReviewStandards(),
                    const SizedBox(height: 15),
                    const _ComplianceSectionTitle(
                      eyebrow: 'YOUR CASES',
                      title: 'Track every conversation',
                      subtitle:
                          'Search your reports or narrow the list by review status.',
                    ),
                    const SizedBox(height: 10),
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .78),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: AppColors.border.withValues(alpha: .86),
                        ),
                      ),
                      child: TextField(
                        controller: _search,
                        decoration: InputDecoration(
                          hintText: 'Search cases',
                          prefixIcon: const Icon(
                            Icons.search_rounded,
                            color: AppColors.primaryDark,
                          ),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  tooltip: 'Clear search',
                                  onPressed: _search.clear,
                                  icon: const Icon(
                                    Icons.close_rounded,
                                    size: 18,
                                  ),
                                ),
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                        ),
                      ),
                    ),
                    const SizedBox(height: 9),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          'ALL',
                          'OPEN',
                          'IN_PROGRESS',
                          'RESOLVED',
                          'REJECTED',
                        ].map(
                          (value) => Padding(
                            padding: const EdgeInsets.only(right: 7),
                            child: _CaseFilterPill(
                              label: _label(value),
                              selected: _filter == value,
                              icon: switch (value) {
                                'OPEN' => Icons.inbox_outlined,
                                'IN_PROGRESS' => Icons.manage_search_rounded,
                                'RESOLVED' => Icons.verified_outlined,
                                'REJECTED' => Icons.do_not_disturb_alt_rounded,
                                _ => Icons.grid_view_rounded,
                              },
                              onTap: () {
                                setState(() {
                                  _filter = value;
                                });
                              },
                            ),
                          ),
                        ).toList(),
                      ),
                    ),
                    const SizedBox(height: 14),
                    if (_loading && _items.isEmpty)
                      const LoadingList(count: 4)
                    else if (_error != null && _items.isEmpty)
                      EmptyState(
                        icon: Icons.shield_outlined,
                        title: 'Cases unavailable',
                        message: _error.toString(),
                        action: FilledButton(
                          onPressed: () => _load(force: true),
                          child: const Text('Retry'),
                        ),
                      )
                    else if (filtered.isEmpty)
                      EmptyState(
                        icon: Icons.inbox_outlined,
                        title: _filter == 'ALL'
                            ? (_search.text.trim().isEmpty
                                ? 'No cases yet'
                                : 'No matching cases')
                            : 'No matching cases',
                        message: _filter == 'ALL'
                            ? (_search.text.trim().isEmpty
                                ? 'Your first case will appear here with its live status.'
                                : 'Try another search or status filter.')
                            : 'Try another search or status filter.',
                        action: _filter == 'ALL'
                            ? FilledButton.icon(
                                onPressed: _createCase,
                                icon: const Icon(Icons.add_rounded),
                                label: const Text('Create case'),
                              )
                            : null,
                      )
                    else
                      ...filtered.map(
                        (item) => Padding(
                          padding: const EdgeInsets.only(bottom: 11),
                          child: _ComplaintCard(
                            item: item,
                            onTap: () => _openCase(item),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _label(String status) {
    return switch (status) {
      'ALL' => 'All cases',
      'OPEN' => 'Received',
      'IN_PROGRESS' => 'In review',
      'RESOLVED' => 'Resolved',
      'REJECTED' => 'Closed',
      _ => status.replaceAll('_', ' '),
    };
  }
}

class _ComplianceRouteHeader extends StatelessWidget {
  const _ComplianceRouteHeader({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final returnTitle = workspaceReturnTarget(context).title;

    return Material(
      color: AppColors.surface.withValues(alpha: .985),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(14, 6, 18, 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: AppColors.border.withValues(alpha: .62),
              ),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .025),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Row(
            children: [
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onBack,
                  borderRadius: BorderRadius.circular(14),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Icon(
                        Icons.arrow_back_rounded,
                        size: 26,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Expanded(
                child: GestureDetector(
                  onTap: onBack,
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        returnTitle,
                        style: TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 18.5,
                          height: 1.08,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.28,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'Compliance & support',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.6,
                          height: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComplianceHero extends StatelessWidget {
  const _ComplianceHero({required this.total});

  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: .12),
        ),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFEFD),
            Color(0xFFF4FAF8),
            Color(0xFFFFFAFB),
          ],
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 28,
            offset: const Offset(0, 11),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -48,
            top: -62,
            child: Container(
              width: 160,
              height: 160,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .055),
              ),
            ),
          ),
          Positioned(
            left: -42,
            bottom: -68,
            child: Container(
              width: 125,
              height: 125,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .035),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 15, 15, 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .84),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: AppColors.primary.withValues(alpha: .12),
                    ),
                  ),
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      const Icon(
                        Icons.shield_outlined,
                        size: 22,
                        color: AppColors.primaryDark,
                      ),
                      Positioned(
                        right: 8,
                        top: 8,
                        child: Icon(
                          Icons.auto_awesome_rounded,
                          size: 7,
                          color: AppColors.pinkDeep,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'PRIVATE SUPPORT',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 7.4,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .95,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'A calmer place for every case',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 17.5,
                          height: 1.06,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -.3,
                        ),
                      ),
                      SizedBox(height: 5),
                      Text(
                        'Submit a concern, follow the review and keep every response in one private record.',
                        style: TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 9.1,
                          height: 1.4,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 9),
                Container(
                  constraints: const BoxConstraints(minWidth: 58),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft.withValues(alpha: .92),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    children: [
                      Text(
                        '$total',
                        style: const TextStyle(
                          color: AppColors.primaryDeep,
                          fontSize: 18,
                          height: 1,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        'CASES',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 6.2,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .5,
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
    );
  }
}

class _ComplianceSectionTitle extends StatelessWidget {
  const _ComplianceSectionTitle({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
  });

  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow,
          style: const TextStyle(
            color: AppColors.primaryDark,
            fontSize: 7.4,
            fontWeight: FontWeight.w900,
            letterSpacing: .9,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          title,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 14.8,
            fontWeight: FontWeight.w900,
            letterSpacing: -.2,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          subtitle,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 8.8,
            height: 1.35,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _CaseFilterPill extends StatelessWidget {
  const _CaseFilterPill({
    required this.label,
    required this.selected,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 8,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .95)
                : Colors.white.withValues(alpha: .78),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .28)
                  : AppColors.border.withValues(alpha: .84),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                selected ? Icons.check_rounded : icon,
                size: 14,
                color: selected
                    ? AppColors.primaryDark
                    : AppColors.textMuted,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: selected
                      ? AppColors.primaryDeep
                      : AppColors.textSecondary,
                  fontSize: 8.7,
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

class _CaseJourney extends StatelessWidget {
  const _CaseJourney();

  @override
  Widget build(BuildContext context) {
    const steps = [
      (
        Icons.inbox_outlined,
        'Submit',
        'Your concern enters a protected queue.',
      ),
      (
        Icons.manage_search_rounded,
        'Review',
        'A reviewer checks the case and its context.',
      ),
      (
        Icons.mark_chat_read_outlined,
        'Response',
        'The decision and reply stay in your record.',
      ),
    ];

    return VoxCard(
      tint: AppColors.primarySoft.withValues(alpha: .55),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Expanded(
                child: Text(
                  'Case journey',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              StatusChip(label: 'PRIVATE · TRACEABLE', positive: true),
            ],
          ),
          const SizedBox(height: 11),
          ...steps.indexed.map((entry) {
            final index = entry.$1;
            final step = entry.$2;
            return Padding(
              padding: EdgeInsets.only(
                bottom: index == steps.length - 1 ? 0 : 10,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SoftIconBadge(icon: step.$1, size: 34),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          step.$2,
                          style: const TextStyle(
                            color: AppColors.primaryDeep,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          step.$3,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.4,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${index + 1}'.padLeft(2, '0'),
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 10),
          const InlineNotice(
            icon: Icons.verified_user_outlined,
            message: 'Private · Traceable · Human reviewed',
          ),
        ],
      ),
    );
  }
}

class _ReviewStandards extends StatelessWidget {
  const _ReviewStandards();

  @override
  Widget build(BuildContext context) {
    const standards = [
      (
        '01',
        Icons.shield_outlined,
        'Protected intake',
        'Your report is scoped to your account and authorized reviewers.',
      ),
      (
        '02',
        Icons.manage_search_rounded,
        'Structured review',
        'The team reviews context, linked ideas, and platform records fairly.',
      ),
      (
        '03',
        Icons.mark_chat_read_outlined,
        'Visible resolution',
        'Status changes and the final administration response stay in your case.',
      ),
    ];

    return VoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'REVIEW STANDARDS',
            style: TextStyle(
              color: AppColors.primary,
              fontSize: 8.8,
              fontWeight: FontWeight.w900,
              letterSpacing: .7,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'What happens after you submit?',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 11),
          ...standards.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      item.$2,
                      size: 15,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              item.$1,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.5,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                item.$3,
                                style: const TextStyle(
                                  color: AppColors.textPrimary,
                                  fontSize: 10.3,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.$4,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.1,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaTile extends StatelessWidget {
  const _MetaTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: .75),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 9.3,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TinyMeta extends StatelessWidget {
  const _TinyMeta({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 11, color: AppColors.textMuted),
        const SizedBox(width: 3),
        Text(
          text,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 8.2,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _CaseStats extends StatelessWidget {
  const _CaseStats({required this.items});

  final List<Map<String, dynamic>> items;

  @override
  Widget build(BuildContext context) {
    int count(String status) => items
        .where((item) => '${item['status'] ?? 'OPEN'}'.toUpperCase() == status)
        .length;

    return Row(
      children: [
        Expanded(
          child: MetricPill(
            icon: Icons.inbox_outlined,
            value: '${count('OPEN')}',
            label: 'Received',
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: MetricPill(
            icon: Icons.manage_search_rounded,
            value: '${count('IN_PROGRESS')}',
            label: 'In review',
            accent: AppColors.warning,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: MetricPill(
            icon: Icons.verified_outlined,
            value: '${count('RESOLVED')}',
            label: 'Resolved',
            accent: AppColors.success,
          ),
        ),
      ],
    );
  }
}

class _ComplaintCard extends StatelessWidget {
  const _ComplaintCard({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = '${item['status'] ?? 'OPEN'}'.toUpperCase();
    final message = '${item['message'] ?? ''}';
    final adminReply = '${item['adminReply'] ?? ''}'.trim();
    final priority = '${item['priority'] ?? 'MEDIUM'}'.toUpperCase();
    final rawId = '${item['id'] ?? ''}';
    final shortId = rawId.length > 6 ? rawId.substring(0, 6) : rawId;

    return VoxCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SoftIconBadge(
            icon: adminReply.isNotEmpty
                ? Icons.mark_chat_read_outlined
                : Icons.shield_outlined,
            rose: status == 'REJECTED',
            size: 42,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${item['subject'] ?? 'Support case'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 12.8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusChip(
                      label: _statusLabel(status),
                      positive: status == 'RESOLVED',
                      rose: status == 'REJECTED',
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  message,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 10.2,
                    height: 1.35,
                  ),
                ),
                if (adminReply.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Row(
                    children: [
                      Icon(
                        Icons.chat_bubble_outline_rounded,
                        size: 13,
                        color: AppColors.primaryDark,
                      ),
                      SizedBox(width: 5),
                      Text(
                        'Administration replied',
                        style: TextStyle(
                          color: AppColors.primaryDark,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 5,
                  children: [
                    _TinyMeta(
                      icon: Icons.flag_outlined,
                      text: '$priority PRIORITY',
                    ),
                    _TinyMeta(
                      icon: Icons.tag_rounded,
                      text: 'CASE #${shortId.toUpperCase()}',
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          const Icon(
            Icons.chevron_right_rounded,
            color: AppColors.textMuted,
            size: 20,
          ),
        ],
      ),
    );
  }

  String _statusLabel(String status) {
    return switch (status) {
      'OPEN' => 'Received',
      'IN_PROGRESS' => 'In review',
      'RESOLVED' => 'Resolved',
      'REJECTED' => 'Closed',
      _ => status.replaceAll('_', ' '),
    };
  }
}


class _NewComplaintSheet extends StatefulWidget {
  const _NewComplaintSheet();

  @override
  State<_NewComplaintSheet> createState() => _NewComplaintSheetState();
}

class _NewComplaintSheetState extends State<_NewComplaintSheet> {
  final _subject = TextEditingController();
  final _message = TextEditingController();

  List<IdeaSummary> _ideas = const [];
  String? _ideaId;

  bool _loadingIdeas = true;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _loadIdeas();
  }

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _loadIdeas() async {
    try {
      final collected = <IdeaSummary>[];
      final seenIds = <String>{};

      var page = 1;
      var totalPages = 1;

      do {
        final result = await UserApi.instance.getMyIdeas(
          page: page,
          limit: 100,
          force: true,
        );

        for (final idea in result.items) {
          if (idea.id.isNotEmpty && seenIds.add(idea.id)) {
            collected.add(idea);
          }
        }

        totalPages = result.totalPages < 1 ? 1 : result.totalPages;
        page += 1;
      } while (page <= totalPages);

      collected.sort((a, b) {
        final aDate = a.createdAt;
        final bDate = b.createdAt;

        if (aDate == null && bDate == null) return 0;
        if (aDate == null) return 1;
        if (bDate == null) return -1;

        return bDate.compareTo(aDate);
      });

      if (mounted) {
        setState(() {
          _ideas = collected;
        });
      }
    } catch (_) {
      // Linking an idea is optional. The case can still be submitted.
    } finally {
      if (mounted) {
        setState(() {
          _loadingIdeas = false;
        });
      }
    }
  }

  Future<void> _openIdeaPicker() async {
    if (_loadingIdeas) return;

    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      barrierColor: AppColors.primaryDeep.withValues(alpha: .18),
      builder: (_) => _ComplaintIdeaPickerSheet(
        ideas: _ideas,
        selectedIdeaId: _ideaId,
      ),
    );

    if (!mounted || selected == null) return;

    setState(() {
      _ideaId = selected == '__NONE__' ? null : selected;
    });
  }

  String get _selectedIdeaTitle {
    if (_ideaId == null) {
      return 'No specific idea';
    }

    for (final idea in _ideas) {
      if (idea.id == _ideaId) {
        return idea.title;
      }
    }

    return 'Selected idea';
  }

  Future<void> _submit() async {
    final subject = _subject.text.trim();
    final message = _message.text.trim();

    if (subject.length < 3) {
      showAppSnackBar(
        context,
        'Subject must contain at least 3 characters.',
        error: true,
      );
      return;
    }

    if (message.length < 10) {
      showAppSnackBar(
        context,
        'Message must contain at least 10 characters.',
        error: true,
      );
      return;
    }

    setState(() {
      _sending = true;
    });

    try {
      await UserApi.instance.createComplaint(
        subject: subject,
        message: message,
        ideaId: _ideaId,
      );

      if (!mounted) return;

      showAppSnackBar(
        context,
        'Case submitted securely.',
      );

      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(
          context,
          error.message,
          error: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return DraggableScrollableSheet(
      initialChildSize: .88,
      maxChildSize: .96,
      minChildSize: .62,
      expand: false,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(30),
            ),
          ),
          child: ListView(
            controller: controller,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            physics: const BouncingScrollPhysics(),
            padding: EdgeInsets.fromLTRB(
              16,
              10,
              16,
              24 + bottomInset,
            ),
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver.withValues(alpha: .82),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 15),
              _NewCaseComposerHeader(
                onClose: () => Navigator.of(context).pop(false),
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.fromLTRB(13, 12, 13, 12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppColors.primarySoft.withValues(alpha: .74),
                      Colors.white.withValues(alpha: .92),
                      AppColors.surfaceRose.withValues(alpha: .50),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: .12),
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _CaseStepBadge(
                      icon: Icons.shield_outlined,
                      label: 'Private',
                    ),
                    SizedBox(width: 7),
                    _CaseStepBadge(
                      icon: Icons.manage_search_rounded,
                      label: 'Reviewed',
                    ),
                    SizedBox(width: 7),
                    _CaseStepBadge(
                      icon: Icons.forum_outlined,
                      label: 'Tracked',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              const _ComposerFieldLabel(
                icon: Icons.subject_rounded,
                title: 'Case subject',
                subtitle: 'A short title that helps us route your case.',
              ),
              const SizedBox(height: 7),
              TextField(
                controller: _subject,
                maxLength: 150,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  hintText: 'e.g. Publication access or idea review issue',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.subject_rounded,
                    color: AppColors.primaryDark,
                  ),
                  filled: true,
                  fillColor: Colors.white.withValues(alpha: .82),
                ),
              ),
              const SizedBox(height: 14),
              const _ComposerFieldLabel(
                icon: Icons.notes_rounded,
                title: 'What happened?',
                subtitle: 'Add enough context for a fair and useful review.',
              ),
              const SizedBox(height: 7),
              TextField(
                controller: _message,
                minLines: 5,
                maxLines: 8,
                maxLength: 2000,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText:
                      'Describe what happened, what you expected, and anything the reviewer should know...',
                  alignLabelWithHint: true,
                  filled: true,
                  fillColor: Colors.white.withValues(alpha: .82),
                ),
              ),
              const SizedBox(height: 10),
              const _ComposerFieldLabel(
                icon: Icons.lightbulb_outline_rounded,
                title: 'Related idea',
                subtitle: 'Optional — link this case to one of your ideas.',
              ),
              const SizedBox(height: 7),
              _RelatedIdeaSelector(
                loading: _loadingIdeas,
                title: _selectedIdeaTitle,
                linked: _ideaId != null,
                onTap: _openIdeaPicker,
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
                decoration: BoxDecoration(
                  color: AppColors.primarySoft.withValues(alpha: .42),
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: .08),
                  ),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.lock_outline_rounded,
                      size: 15,
                      color: AppColors.primaryDark,
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Your case is private to your account and the reviewing team.',
                        style: TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 8.7,
                          height: 1.35,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 13),
              SizedBox(
                width: double.infinity,
                height: 49,
                child: FilledButton.icon(
                  onPressed: _sending ? null : _submit,
                  style: FilledButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  icon: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.arrow_forward_rounded,
                          size: 18,
                        ),
                  label: Text(
                    _sending
                        ? 'Submitting securely...'
                        : 'Submit secure case',
                  ),
                ),
              ),
              const SizedBox(height: 4),
            ],
          ),
        );
      },
    );
  }
}

class _NewCaseComposerHeader extends StatelessWidget {
  const _NewCaseComposerHeader({
    required this.onClose,
  });

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 47,
          height: 47,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.primary,
                Color(0xFF4FA9A4),
              ],
            ),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: .18),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: const Icon(
            Icons.support_agent_rounded,
            color: Colors.white,
            size: 22,
          ),
        ),
        const SizedBox(width: 11),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'NEW SECURE CASE',
                style: TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 7.7,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.05,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'Tell us what needs review',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18.6,
                  height: 1.05,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.34,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'Share the details once. We will keep the case private, traceable and easy to follow.',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 9.1,
                  height: 1.38,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Material(
          color: AppColors.primarySoft.withValues(alpha: .66),
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: onClose,
            borderRadius: BorderRadius.circular(12),
            child: const SizedBox(
              width: 34,
              height: 34,
              child: Icon(
                Icons.close_rounded,
                size: 18,
                color: AppColors.primaryDark,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _CaseStepBadge extends StatelessWidget {
  const _CaseStepBadge({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: 8,
          vertical: 8,
        ),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .74),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(
            color: AppColors.border.withValues(alpha: .62),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 12,
              color: AppColors.primaryDark,
            ),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 7.6,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerFieldLabel extends StatelessWidget {
  const _ComposerFieldLabel({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: AppColors.primarySoft.withValues(alpha: .76),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            icon,
            size: 14,
            color: AppColors.primaryDark,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 10.2,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8,
                  height: 1.3,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RelatedIdeaSelector extends StatelessWidget {
  const _RelatedIdeaSelector({
    required this.loading,
    required this.title,
    required this.linked,
    required this.onTap,
  });

  final bool loading;
  final String title;
  final bool linked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: loading ? null : onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(11, 10, 10, 10),
          decoration: BoxDecoration(
            color: linked
                ? AppColors.primarySoft.withValues(alpha: .66)
                : Colors.white.withValues(alpha: .84),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: linked
                  ? AppColors.primary.withValues(alpha: .22)
                  : AppColors.border.withValues(alpha: .88),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: linked
                      ? Colors.white.withValues(alpha: .82)
                      : AppColors.primarySoft.withValues(alpha: .66),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: loading
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(
                          strokeWidth: 1.8,
                          color: AppColors.primary,
                        ),
                      )
                    : Icon(
                        linked
                            ? Icons.lightbulb_rounded
                            : Icons.lightbulb_outline_rounded,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      linked ? 'Linked idea' : 'Optional link',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.7,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      loading ? 'Loading your ideas...' : title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.4,
                        height: 1.25,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .72),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.expand_more_rounded,
                  size: 18,
                  color: AppColors.primaryDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComplaintIdeaPickerSheet extends StatefulWidget {
  const _ComplaintIdeaPickerSheet({
    required this.ideas,
    required this.selectedIdeaId,
  });

  final List<IdeaSummary> ideas;
  final String? selectedIdeaId;

  @override
  State<_ComplaintIdeaPickerSheet> createState() =>
      _ComplaintIdeaPickerSheetState();
}

class _ComplaintIdeaPickerSheetState
    extends State<_ComplaintIdeaPickerSheet> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _search.addListener(_refresh);
  }

  @override
  void dispose() {
    _search
      ..removeListener(_refresh)
      ..dispose();
    super.dispose();
  }

  void _refresh() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();

    final filtered = widget.ideas.where((idea) {
      if (query.isEmpty) return true;

      return [
        idea.title,
        idea.domainName,
        idea.abstractText,
      ].join(' ').toLowerCase().contains(query);
    }).toList(growable: false);

    return DraggableScrollableSheet(
      initialChildSize: .78,
      minChildSize: .52,
      maxChildSize: .94,
      expand: false,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(30),
            ),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver.withValues(alpha: .80),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 15, 12, 10),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppColors.primary,
                            Color(0xFF4FA9A4),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(15),
                        boxShadow: [
                          BoxShadow(
                            color:
                                AppColors.primary.withValues(alpha: .16),
                            blurRadius: 14,
                            offset: const Offset(0, 5),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.lightbulb_outline_rounded,
                        size: 19,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Choose a related idea',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 16.2,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.24,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${widget.ideas.length} ${widget.ideas.length == 1 ? 'idea' : 'ideas'} available in your workspace.',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 8.8,
                              height: 1.3,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close',
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(
                        Icons.close_rounded,
                        color: AppColors.primaryDark,
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .82),
                    borderRadius: BorderRadius.circular(17),
                    border: Border.all(
                      color: AppColors.border.withValues(alpha: .82),
                    ),
                  ),
                  child: TextField(
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      hintText: 'Search your ideas…',
                      prefixIcon: const Icon(
                        Icons.search_rounded,
                        color: AppColors.primaryDark,
                      ),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear',
                              onPressed: _search.clear,
                              icon: const Icon(
                                Icons.close_rounded,
                                size: 18,
                              ),
                            ),
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                    ),
                  ),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: controller,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 22),
                  children: [
                    _ComplaintIdeaOptionTile(
                      icon: Icons.link_off_rounded,
                      title: 'No specific idea',
                      subtitle:
                          'Keep this case independent from a particular idea.',
                      selected: widget.selectedIdeaId == null,
                      rose: true,
                      onTap: () {
                        Navigator.of(context).pop('__NONE__');
                      },
                    ),
                    const SizedBox(height: 10),
                    if (widget.ideas.isEmpty)
                      const InlineNotice(
                        icon: Icons.lightbulb_outline_rounded,
                        title: 'No ideas available',
                        message:
                            'You can still submit this case without linking an idea.',
                      )
                    else if (filtered.isEmpty)
                      const InlineNotice(
                        icon: Icons.search_off_rounded,
                        title: 'No matching ideas',
                        message:
                            'Try another title, domain, or keyword.',
                      )
                    else ...[
                      Row(
                        children: [
                          const Text(
                            'YOUR IDEAS',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 7.2,
                              fontWeight: FontWeight.w900,
                              letterSpacing: .85,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${filtered.length} shown',
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 7.4,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ...filtered.map(
                        (idea) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _ComplaintIdeaOptionTile(
                            icon: Icons.lightbulb_outline_rounded,
                            title: idea.title,
                            subtitle: idea.domainName.trim().isEmpty
                                ? 'Link this case to your idea'
                                : '${idea.domainName} · tap to link',
                            selected: widget.selectedIdeaId == idea.id,
                            onTap: () {
                              Navigator.of(context).pop(idea.id);
                            },
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ComplaintIdeaOptionTile extends StatelessWidget {
  const _ComplaintIdeaOptionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
    this.rose = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final accent = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.fromLTRB(11, 10, 10, 10),
          decoration: BoxDecoration(
            color: selected
                ? (rose
                      ? AppColors.surfaceRose.withValues(alpha: .78)
                      : AppColors.primarySoft.withValues(alpha: .72))
                : Colors.white.withValues(alpha: .82),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected
                  ? accent.withValues(alpha: .20)
                  : AppColors.border.withValues(alpha: .78),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 39,
                height: 39,
                decoration: BoxDecoration(
                  color: selected
                      ? Colors.white.withValues(alpha: .82)
                      : AppColors.primarySoft.withValues(alpha: .50),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  icon,
                  size: 17,
                  color: accent,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: selected
                            ? accent
                            : AppColors.textPrimary,
                        fontSize: 10.5,
                        height: 1.25,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.9,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: selected ? accent : Colors.transparent,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected
                        ? accent
                        : AppColors.silver.withValues(alpha: .72),
                  ),
                ),
                child: Icon(
                  selected
                      ? Icons.check_rounded
                      : Icons.arrow_forward_rounded,
                  size: 15,
                  color: selected
                      ? Colors.white
                      : AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComplaintDetailSheet extends StatefulWidget {
  const _ComplaintDetailSheet({required this.complaintId});

  final String complaintId;

  @override
  State<_ComplaintDetailSheet> createState() => _ComplaintDetailSheetState();
}

class _ComplaintDetailSheetState extends State<_ComplaintDetailSheet> {
  Map<String, dynamic>? _item;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final item = await UserApi.instance.getComplaintById(widget.complaintId);
      if (mounted) setState(() => _item = item);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;

    return DraggableScrollableSheet(
      initialChildSize: .86,
      maxChildSize: .96,
      minChildSize: .58,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 34),
          children: [
            Center(
              child: Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.silver,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 18),
            if (item == null && _error == null)
              const LoadingList(count: 4)
            else if (_error != null)
              EmptyState(
                icon: Icons.cloud_off_rounded,
                title: 'Case unavailable',
                message: _error.toString(),
                action: FilledButton(
                  onPressed: _load,
                  child: const Text('Retry'),
                ),
              )
            else if (item != null) ...[
              Row(
                children: [
                  Expanded(
                    child: WorkspacePageHeader(
                      eyebrow: 'SECURE CASE',
                      title: '${item['subject'] ?? 'Support case'}',
                      subtitle: 'Submitted ${_date(item['createdAt'])}',
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusChip(
                    label: '${item['status'] ?? 'OPEN'}'.replaceAll('_', ' '),
                    positive: '${item['status']}' == 'RESOLVED',
                    rose: '${item['status']}' == 'REJECTED',
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: _MetaTile(
                      icon: Icons.schedule_rounded,
                      label: 'Last updated',
                      value: _ComplaintDetailSheetState._date(
                        item['updatedAt'],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _MetaTile(
                      icon: Icons.priority_high_rounded,
                      label: 'Priority',
                      value: '${item['priority'] ?? 'MEDIUM'}'.toUpperCase(),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              VoxCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Your submission',
                      style: TextStyle(
                        color: AppColors.primaryDeep,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${item['message'] ?? ''}',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    if (item['idea'] is Map) ...[
                      const SizedBox(height: 12),
                      InlineNotice(
                        icon: Icons.lightbulb_outline_rounded,
                        message:
                            'Related idea: ${(item['idea'] as Map)['title'] ?? 'Untitled idea'}',
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
              VoxCard(
                tint: '${item['adminReply'] ?? ''}'.trim().isNotEmpty
                    ? AppColors.primarySoft.withValues(alpha: .8)
                    : AppColors.surfaceRose.withValues(alpha: .8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SoftIconBadge(
                      icon: '${item['adminReply'] ?? ''}'.trim().isNotEmpty
                          ? Icons.mark_chat_read_outlined
                          : Icons.shield_outlined,
                      rose: '${item['adminReply'] ?? ''}'.trim().isEmpty,
                      size: 42,
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${item['adminReply'] ?? ''}'.trim().isNotEmpty
                                ? 'Administration response'
                                : 'Protected review',
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            '${item['adminReply'] ?? ''}'.trim().isNotEmpty
                                ? '${item['adminReply']}'
                                : 'A response will appear here as soon as the review team posts an update.',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _Timeline(item: item),
            ],
          ],
        ),
      ),
    );
  }

  static String _date(dynamic value) {
    final date = DateTime.tryParse('$value')?.toLocal();
    if (date == null) return 'recently';
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final status = '${item['status'] ?? 'OPEN'}'.toUpperCase();
    final reviewDone = status != 'OPEN';
    final finalDone = status == 'RESOLVED' || status == 'REJECTED';

    return VoxCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Review timeline',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          const _TimelineStep(
            title: 'Case submitted',
            subtitle: 'Your concern was securely added to the review queue.',
            complete: true,
          ),
          _TimelineStep(
            title: reviewDone ? 'Compliance review' : 'Awaiting review',
            subtitle: reviewDone
                ? 'The administration reviewed the case and its linked context.'
                : 'A reviewer will inspect the information you provided.',
            complete: reviewDone,
          ),
          _TimelineStep(
            title: status == 'REJECTED' ? 'Case closed' : 'Resolution',
            subtitle: finalDone
                ? 'The final outcome has been recorded.'
                : 'The final decision will appear here when the review is complete.',
            complete: finalDone,
            last: true,
          ),
        ],
      ),
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep({
    required this.title,
    required this.subtitle,
    required this.complete,
    this.last = false,
  });

  final String title;
  final String subtitle;
  final bool complete;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 26,
          child: Column(
            children: [
              Icon(
                complete
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_checked_rounded,
                size: 17,
                color: complete ? AppColors.success : AppColors.textMuted,
              ),
              if (!last)
                Container(
                  width: 1.5,
                  height: 44,
                  margin: const EdgeInsets.symmetric(vertical: 3),
                  color: AppColors.borderStrong,
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 0 : 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.8,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
