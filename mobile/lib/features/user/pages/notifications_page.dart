// Mobile notification center with web-parity read filters and message detail.
//
// @author Eman

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List<AppNotification> _items = const [];
  bool _loading = true;
  Object? _error;

  String _readFilter = 'ALL';
  String _typeFilter = 'ALL';

  bool _markingAll = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool force = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final items = await UserApi.instance.getNotifications(force: force);

      if (!mounted) return;

      setState(() {
        _items = items;
      });

      UserSessionController.instance.updateUnreadCount(
        items.where((item) => !item.isRead).length,
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  Future<void> _open(AppNotification item) async {
    if (!item.isRead) {
      try {
        await UserApi.instance.markNotificationRead(item.id);

        await _load(force: true);
      } on ApiException catch (error) {
        if (mounted) {
          showAppSnackBar(context, error.message, error: true);
        }
      }
    }

    if (!mounted) return;

    final openRelated = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _NotificationDetail(item: item),
    );

    if (openRelated == true && mounted && item.actionUrl != null) {
      Navigator.pushNamed(context, item.actionUrl!);
    }
  }

  Future<void> _markAll() async {
    if (_markingAll) return;

    setState(() {
      _markingAll = true;
    });

    try {
      await UserApi.instance.markAllNotificationsRead();

      await _load(force: true);

      if (mounted) {
        showAppSnackBar(context, 'All notifications marked as read.');
      }
    } on ApiException catch (error) {
      if (mounted) {
        showAppSnackBar(context, error.message, error: true);
      }
    } finally {
      if (mounted) {
        setState(() {
          _markingAll = false;
        });
      }
    }
  }

  List<AppNotification> get _visibleItems {
    return _items.where((item) {
      final readMatches =
          _readFilter == 'ALL' ||
          (_readFilter == 'READ' && item.isRead) ||
          (_readFilter == 'UNREAD' && !item.isRead);

      final type = _typeLabel(item.type);

      final typeMatches = _typeFilter == 'ALL' || type == _typeFilter;

      return readMatches && typeMatches;
    }).toList();
  }

  List<String> get _types {
    final values = _items.map((item) => _typeLabel(item.type)).toSet().toList()
      ..sort();

    return ['ALL', ...values];
  }

  @override
  Widget build(BuildContext context) {
    final unread = _items.where((item) => !item.isRead).length;
    final visible = _visibleItems;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          _NotificationsRouteHeader(
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
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 118),
                  children: [
                    _NotificationHero(
                      total: _items.length,
                      unread: unread,
                      markingAll: _markingAll,
                      onMarkAll: unread == 0 ? null : _markAll,
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: _SummaryCard(
                            icon: Icons.notifications_none_rounded,
                            value: '${_items.length}',
                            label: 'All updates',
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _SummaryCard(
                            icon: Icons.mark_email_unread_outlined,
                            value: '$unread',
                            label: 'Needs attention',
                            rose: true,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 15),
                    const _NotificationSectionTitle(
                      eyebrow: 'FILTERS',
                      title: 'Find what matters',
                    ),
                    const SizedBox(height: 9),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: ['ALL', 'UNREAD', 'READ'].map((value) {
                        return _NotificationFilterPill(
                          label: _pretty(value),
                          selected: _readFilter == value,
                          icon: switch (value) {
                            'UNREAD' => Icons.mark_email_unread_outlined,
                            'READ' => Icons.drafts_outlined,
                            _ => Icons.grid_view_rounded,
                          },
                          onTap: () {
                            setState(() {
                              _readFilter = value;
                            });
                          },
                        );
                      }).toList(),
                    ),
                    if (_types.length > 1) ...[
                      const SizedBox(height: 8),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: _types.map((value) {
                            return Padding(
                              padding: const EdgeInsets.only(right: 7),
                              child: _NotificationFilterPill(
                                label: value == 'ALL'
                                    ? 'All categories'
                                    : _pretty(value),
                                selected: _typeFilter == value,
                                icon: value == 'ALL'
                                    ? Icons.category_outlined
                                    : _notificationMeta(value).$1,
                                compact: true,
                                onTap: () {
                                  setState(() {
                                    _typeFilter = value;
                                  });
                                },
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    _NotificationListHeading(
                      count: visible.length,
                      loading: _loading,
                    ),
                    const SizedBox(height: 9),
                    if (_loading && _items.isEmpty)
                      const LoadingList(count: 5)
                    else if (_error != null && _items.isEmpty)
                      EmptyState(
                        icon: Icons.cloud_off_rounded,
                        title: 'Notifications unavailable',
                        message: _error.toString(),
                        action: FilledButton(
                          onPressed: () => _load(force: true),
                          child: const Text('Retry'),
                        ),
                      )
                    else if (visible.isEmpty)
                      const EmptyState(
                        icon: Icons.notifications_none_rounded,
                        title: 'Nothing in this filter',
                        message: 'Try All or another category.',
                      )
                    else
                      ...visible.map(
                        (item) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _NotificationCard(
                            item: item,
                            onTap: () => _open(item),
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
}

class _NotificationsRouteHeader extends StatelessWidget {
  const _NotificationsRouteHeader({required this.onBack});

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
                        'Notifications',
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

class _NotificationHero extends StatelessWidget {
  const _NotificationHero({
    required this.total,
    required this.unread,
    required this.markingAll,
    required this.onMarkAll,
  });

  final int total;
  final int unread;
  final bool markingAll;
  final VoidCallback? onMarkAll;

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
            Color(0xFFF3FAF8),
            Color(0xFFFFF8FA),
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
            top: -56,
            right: -40,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: .055),
              ),
            ),
          ),
          Positioned(
            left: -42,
            bottom: -70,
            child: Container(
              width: 130,
              height: 130,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.pink.withValues(alpha: .04),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 15, 15, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .82),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: AppColors.primary.withValues(alpha: .12),
                        ),
                      ),
                      child: const Icon(
                        Icons.notifications_active_outlined,
                        color: AppColors.primaryDark,
                        size: 21,
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'NOTIFICATION CENTER',
                            style: TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 7.5,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.0,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Updates that stay easy to follow',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 17.3,
                              height: 1.06,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -.3,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Ideas, publishing, payments and account activity in one calm timeline.',
                            style: TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 9.2,
                              height: 1.4,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      constraints: const BoxConstraints(minWidth: 58),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 9,
                      ),
                      decoration: BoxDecoration(
                        color: unread > 0
                            ? AppColors.pinkSoft.withValues(alpha: .92)
                            : AppColors.primarySoft.withValues(alpha: .90),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        children: [
                          Text(
                            '$unread',
                            style: TextStyle(
                              color: unread > 0
                                  ? AppColors.pinkDeep
                                  : AppColors.primaryDark,
                              fontSize: 17,
                              height: 1,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            unread == 1 ? 'UNREAD' : 'UNREAD',
                            style: TextStyle(
                              color: unread > 0
                                  ? AppColors.pinkDeep
                                  : AppColors.primaryDark,
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
                const SizedBox(height: 13),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '$total total update${total == 1 ? '' : 's'}',
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 8.8,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (onMarkAll != null)
                      TextButton.icon(
                        onPressed: markingAll ? null : onMarkAll,
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.primaryDark,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 9,
                            vertical: 6,
                          ),
                        ),
                        icon: markingAll
                            ? const SizedBox(
                                width: 13,
                                height: 13,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.7,
                                ),
                              )
                            : const Icon(
                                Icons.done_all_rounded,
                                size: 15,
                              ),
                        label: const Text(
                          'Mark all read',
                          style: TextStyle(
                            fontSize: 9.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NotificationSectionTitle extends StatelessWidget {
  const _NotificationSectionTitle({
    required this.eyebrow,
    required this.title,
  });

  final String eyebrow;
  final String title;

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
            fontSize: 14.7,
            fontWeight: FontWeight.w900,
            letterSpacing: -.2,
          ),
        ),
      ],
    );
  }
}

class _NotificationFilterPill extends StatelessWidget {
  const _NotificationFilterPill({
    required this.label,
    required this.selected,
    required this.icon,
    required this.onTap,
    this.compact = false,
  });

  final String label;
  final bool selected;
  final IconData icon;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 10 : 12,
            vertical: compact ? 8 : 9,
          ),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.primarySoft.withValues(alpha: .95)
                : Colors.white.withValues(alpha: .76),
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color: selected
                  ? AppColors.primary.withValues(alpha: .28)
                  : AppColors.border.withValues(alpha: .85),
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
                  fontSize: compact ? 8.7 : 9.4,
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

class _NotificationListHeading extends StatelessWidget {
  const _NotificationListHeading({
    required this.count,
    required this.loading,
  });

  final int count;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(
          Icons.auto_awesome_rounded,
          size: 11,
          color: AppColors.primaryDark,
        ),
        const SizedBox(width: 5),
        const Text(
          'ACTIVITY TIMELINE',
          style: TextStyle(
            color: AppColors.primaryDark,
            fontSize: 6.6,
            fontWeight: FontWeight.w900,
            letterSpacing: .75,
          ),
        ),
        const Spacer(),
        if (loading)
          const SizedBox(
            width: 13,
            height: 13,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: AppColors.primary,
            ),
          )
        else
          Text(
            '$count shown',
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 7.7,
              fontWeight: FontWeight.w700,
            ),
          ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.icon,
    required this.value,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String value;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      tint: rose
          ? AppColors.pinkSoft.withValues(alpha: .58)
          : AppColors.primarySoft.withValues(alpha: .58),
      child: Row(
        children: [
          SoftIconBadge(icon: icon, rose: rose, size: 38),
          const SizedBox(width: 9),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 8.8,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.item, required this.onTap});

  final AppNotification item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = _notificationMeta(item.type);

    return VoxCard(
      onTap: onTap,
      tint: item.isRead ? null : AppColors.primarySoft.withValues(alpha: .67),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SoftIconBadge(icon: meta.$1, rose: meta.$2, size: 40),

          const SizedBox(width: 11),

          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.title.isEmpty ? 'Voxidence update' : item.title,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w900,
                          fontSize: 12.7,
                        ),
                      ),
                    ),

                    if (!item.isRead)
                      Container(
                        width: 7,
                        height: 7,
                        decoration: const BoxDecoration(
                          color: AppColors.pink,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),

                const SizedBox(height: 4),

                Text(
                  item.message.isEmpty
                      ? 'Open to view this workspace update.'
                      : item.message,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10.6,
                    height: 1.42,
                  ),
                ),

                const SizedBox(height: 8),

                Row(
                  children: [
                    StatusChip(
                      label: _pretty(_typeLabel(item.type)),
                      icon: meta.$1,
                      rose: meta.$2,
                    ),
                    const Spacer(),
                    Text(
                      _date(item.createdAt),
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.8,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(width: 5),

          const Icon(
            Icons.chevron_right_rounded,
            color: AppColors.textMuted,
            size: 20,
          ),
        ],
      ),
    );
  }
}

class _NotificationDetail extends StatelessWidget {
  const _NotificationDetail({required this.item});

  final AppNotification item;

  @override
  Widget build(BuildContext context) {
    final meta = _notificationMeta(item.type);

    return DraggableScrollableSheet(
      initialChildSize: .58,
      minChildSize: .42,
      maxChildSize: .88,
      builder: (context, controller) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),

              const SizedBox(height: 18),

              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SoftIconBadge(icon: meta.$1, rose: meta.$2, size: 46),

                  const SizedBox(width: 12),

                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.title.isEmpty ? 'Voxidence update' : item.title,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),

                        const SizedBox(height: 5),

                        Row(
                          children: [
                            StatusChip(
                              label: _pretty(_typeLabel(item.type)),
                              icon: meta.$1,
                              rose: meta.$2,
                            ),

                            const SizedBox(width: 7),

                            Text(
                              _date(item.createdAt),
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 9,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 16),

              VoxCard(
                tint: AppColors.surfaceMuted.withValues(alpha: .66),
                child: Text(
                  item.message.isEmpty
                      ? 'No additional message was provided.'
                      : item.message,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11.4,
                    height: 1.55,
                  ),
                ),
              ),

              const SizedBox(height: 13),

              InlineNotice(
                icon: Icons.verified_user_outlined,
                message: _typeLabel(item.type) == 'ADMIN'
                    ? 'Administrator & moderation notice · verified Voxidence message.'
                    : 'Verified Voxidence notice · ${_pretty(_typeLabel(item.type))} activity.',
              ),
              const SizedBox(height: 14),
              if (item.actionUrl?.isNotEmpty ?? false) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => Navigator.pop(context, true),
                    icon: const Icon(Icons.open_in_new_rounded, size: 17),
                    label: const Text('Open related page'),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Close'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Returns the icon and visual style for a notification type.
///
/// The first record field must be [IconData], not [String].
(IconData, bool) _notificationMeta(String? type) {
  final key = _typeLabel(type);

  if (key == 'PAYMENT' ||
      key == 'CREDITS' ||
      key == 'CREDIT LOW' ||
      key == 'CREDIT EXHAUSTED') {
    return (Icons.account_balance_wallet_outlined, false);
  }

  if (key == 'PUBLICATION') {
    return (Icons.public_rounded, false);
  }

  if (key == 'FEEDBACK') {
    return (Icons.forum_outlined, true);
  }

  if (key == 'SECURITY' || key == 'ADMIN') {
    return (Icons.shield_outlined, true);
  }

  if (key == 'GENERATION') {
    return (Icons.auto_awesome_rounded, false);
  }

  if (key == 'IDEA') {
    return (Icons.lightbulb_outline_rounded, false);
  }

  return (Icons.notifications_none_rounded, false);
}

String _typeLabel(String? value) {
  return (value ?? 'SYSTEM').replaceAll('_', ' ').trim().toUpperCase();
}

String _pretty(String value) {
  final lower = value.trim().toLowerCase();

  if (lower.isEmpty) {
    return 'All';
  }

  return '${lower[0].toUpperCase()}${lower.substring(1)}';
}

String _date(DateTime? value) {
  if (value == null) {
    return 'Recently';
  }

  final local = value.toLocal();

  return '${local.year}-'
      '${local.month.toString().padLeft(2, '0')}-'
      '${local.day.toString().padLeft(2, '0')}';
}
