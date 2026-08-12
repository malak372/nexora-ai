// Mobile compliance and complaint workspace matching the web feature set.
//
// @author  Malak

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
      final matchesStatus = _filter == 'ALL' ||
          '${item['status'] ?? 'OPEN'}'.toUpperCase() == _filter;
      final idea = item['idea'] is Map ? item['idea'] as Map : const {};
      final searchable = <String>[
        '${item['subject'] ?? ''}',
        '${item['message'] ?? ''}',
        '${item['adminReply'] ?? ''}',
        '${idea['title'] ?? ''}',
      ].join(' ').toLowerCase();
      return matchesStatus && (query.isEmpty || searchable.contains(query));
    }).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Compliance & support')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createCase,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New case'),
      ),
      body: WorkspaceBackground(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(force: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 94),
            children: [
              const WorkspacePageHeader(
                eyebrow: 'SUPPORT',
                title: 'A clear place for every case',
                subtitle:
                    'Submit a concern, link it to one of your ideas, follow its review status, and read administration replies.',
              ),
              const SizedBox(height: 16),
              const _CaseJourney(),
              const SizedBox(height: 12),
              _CaseStats(items: _items),
              const SizedBox(height: 12),
              const _ReviewStandards(),
              const SizedBox(height: 14),
              TextField(
                controller: _search,
                decoration: InputDecoration(
                  hintText: 'Search cases',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: _search.clear,
                          icon: const Icon(Icons.close_rounded, size: 18),
                        ),
                ),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']
                      .map(
                        (value) => Padding(
                          padding: const EdgeInsets.only(right: 7),
                          child: ChoiceChip(
                            label: Text(_label(value)),
                            selected: _filter == value,
                            selectedColor: AppColors.primarySoft,
                            side: const BorderSide(color: AppColors.border),
                            labelStyle: TextStyle(
                              color: _filter == value
                                  ? AppColors.primaryDark
                                  : AppColors.textMuted,
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                            ),
                            onSelected: (_) => setState(() => _filter = value),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
              const SizedBox(height: 12),
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
                  title: _filter == 'ALL' ? (_search.text.trim().isEmpty ? 'No cases yet' : 'No matching cases')
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

class _CaseJourney extends StatelessWidget {
  const _CaseJourney();

  @override
  Widget build(BuildContext context) {
    const steps = [
      (Icons.inbox_outlined, 'Submit', 'Your concern enters a protected queue.'),
      (Icons.manage_search_rounded, 'Review', 'A reviewer checks the case and its context.'),
      (Icons.mark_chat_read_outlined, 'Response', 'The decision and reply stay in your record.'),
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
              padding: EdgeInsets.only(bottom: index == steps.length - 1 ? 0 : 10),
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
      ('01', Icons.shield_outlined, 'Protected intake', 'Your report is scoped to your account and authorized reviewers.'),
      ('02', Icons.manage_search_rounded, 'Structured review', 'The team reviews context, linked ideas, and platform records fairly.'),
      ('03', Icons.mark_chat_read_outlined, 'Visible resolution', 'Status changes and the final administration response stay in your case.'),
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
                    child: Icon(item.$2, size: 15, color: AppColors.primaryDark),
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
  const _MetaTile({required this.icon, required this.label, required this.value});

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
                Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 8.2)),
                const SizedBox(height: 1),
                Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textPrimary, fontSize: 9.3, fontWeight: FontWeight.w800)),
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
        Text(text, style: const TextStyle(color: AppColors.textMuted, fontSize: 8.2, fontWeight: FontWeight.w700)),
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
      final result = await UserApi.instance.getMyIdeas();
      if (mounted) setState(() => _ideas = result.items);
    } catch (_) {
      // Linking an idea is optional.
    } finally {
      if (mounted) setState(() => _loadingIdeas = false);
    }
  }

  Future<void> _submit() async {
    final subject = _subject.text.trim();
    final message = _message.text.trim();

    if (subject.length < 3) {
      showAppSnackBar(context, 'Subject must contain at least 3 characters.', error: true);
      return;
    }
    if (message.length < 10) {
      showAppSnackBar(context, 'Message must contain at least 10 characters.', error: true);
      return;
    }

    setState(() => _sending = true);
    try {
      await UserApi.instance.createComplaint(
        subject: subject,
        message: message,
        ideaId: _ideaId,
      );
      if (!mounted) return;
      showAppSnackBar(context, 'Case submitted securely.');
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .82,
      maxChildSize: .95,
      minChildSize: .58,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: ListView(
          controller: controller,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 30),
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
            const WorkspacePageHeader(
              eyebrow: 'NEW SECURE CASE',
              title: 'Tell us what needs review',
              subtitle:
                  'Clear context helps the team investigate fairly and respond with the right next step.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _subject,
              maxLength: 150,
              decoration: const InputDecoration(
                labelText: 'Case subject',
                prefixIcon: Icon(Icons.subject_rounded),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _message,
              minLines: 6,
              maxLines: 9,
              maxLength: 2000,
              decoration: const InputDecoration(
                labelText: 'What happened?',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              initialValue: _ideaId,
              decoration: const InputDecoration(
                labelText: 'Related idea (optional)',
                prefixIcon: Icon(Icons.lightbulb_outline_rounded),
              ),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('This case is not related to a specific idea'),
                ),
                ..._ideas.map(
                  (idea) => DropdownMenuItem<String?>(
                    value: idea.id,
                    child: Text(
                      idea.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
              onChanged: _loadingIdeas
                  ? null
                  : (value) => setState(() => _ideaId = value),
            ),
            const SizedBox(height: 15),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _sending ? null : _submit,
                icon: _sending
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.send_rounded),
                label: Text(_sending ? 'Submitting securely...' : 'Submit secure case'),
              ),
            ),
          ],
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
                action: FilledButton(onPressed: _load, child: const Text('Retry')),
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
                      value: _ComplaintDetailSheetState._date(item['updatedAt']),
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
