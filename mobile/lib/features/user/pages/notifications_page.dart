// Mobile notification center with web-parity read filters and message detail.
//
// @author  Malak

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
      final items = await UserApi.instance.getNotifications(
        force: force,
      );

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
          showAppSnackBar(
            context,
            error.message,
            error: true,
          );
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
        showAppSnackBar(
          context,
          'All notifications marked as read.',
        );
      }
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

      final typeMatches =
          _typeFilter == 'ALL' ||
          type == _typeFilter;

      return readMatches && typeMatches;
    }).toList();
  }

  List<String> get _types {
    final values = _items
        .map((item) => _typeLabel(item.type))
        .toSet()
        .toList()
      ..sort();

    return [
      'ALL',
      ...values,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final unread = _items
        .where((item) => !item.isRead)
        .length;

    final visible = _visibleItems;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: WorkspaceBackground(
        child: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () => _load(force: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(
                18,
                14,
                18,
                34,
              ),
              children: [
                WorkspacePageHeader(
                  eyebrow: 'NOTIFICATION CENTER',
                  title: 'Your updates, clearly organized.',
                  subtitle:
                      'Review important activity across ideas, publishing, payments, feedback, and account security.',
                  onBack: () => Navigator.maybePop(context),
                  trailing: unread == 0
                      ? const StatusChip(
                          label: 'ALL READ',
                          icon: Icons.done_all_rounded,
                          positive: true,
                        )
                      : Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 9,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.pinkSoft,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            '$unread unread',
                            style: const TextStyle(
                              color: AppColors.pinkDeep,
                              fontSize: 8.8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                ),

                if (unread > 0) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: _markingAll
                          ? null
                          : _markAll,
                      icon: _markingAll
                          ? const SizedBox(
                              width: 15,
                              height: 15,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(
                              Icons.done_all_rounded,
                              size: 16,
                            ),
                      label: const Text(
                        'Mark all read',
                      ),
                    ),
                  ),
                ],

                const SizedBox(height: 8),

                Row(
                  children: [
                    Expanded(
                      child: _SummaryCard(
                        icon: Icons.notifications_none_rounded,
                        value: '${_items.length}',
                        label: 'Total',
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: _SummaryCard(
                        icon: Icons.mark_email_unread_outlined,
                        value: '$unread',
                        label: 'Unread',
                        rose: true,
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 14),

                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      'ALL',
                      'UNREAD',
                      'READ',
                    ].map(
                      (value) {
                        return Padding(
                          padding: const EdgeInsets.only(
                            right: 7,
                          ),
                          child: ChoiceChip(
                            selected:
                                _readFilter == value,
                            label: Text(
                              _pretty(value),
                            ),
                            onSelected: (_) {
                              setState(() {
                                _readFilter = value;
                              });
                            },
                          ),
                        );
                      },
                    ).toList(),
                  ),
                ),

                if (_types.length > 1) ...[
                  const SizedBox(height: 7),

                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: _types.map(
                        (value) {
                          return Padding(
                            padding: const EdgeInsets.only(
                              right: 7,
                            ),
                            child: FilterChip(
                              selected:
                                  _typeFilter == value,
                              label: Text(
                                value == 'ALL'
                                    ? 'All categories'
                                    : _pretty(value),
                              ),
                              onSelected: (_) {
                                setState(() {
                                  _typeFilter = value;
                                });
                              },
                            ),
                          );
                        },
                      ).toList(),
                    ),
                  ),
                ],

                const SizedBox(height: 14),

                if (_loading && _items.isEmpty)
                  const LoadingList(
                    count: 5,
                  )
                else if (_error != null &&
                    _items.isEmpty)
                  EmptyState(
                    icon: Icons.cloud_off_rounded,
                    title:
                        'Notifications unavailable',
                    message: _error.toString(),
                    action: FilledButton(
                      onPressed: () =>
                          _load(force: true),
                      child: const Text(
                        'Retry',
                      ),
                    ),
                  )
                else if (visible.isEmpty)
                  const EmptyState(
                    icon:
                        Icons.notifications_none_rounded,
                    title:
                        'Nothing in this filter',
                    message:
                        'Try All or another category.',
                  )
                else
                  ...visible.map(
                    (item) => Padding(
                      padding:
                          const EdgeInsets.only(
                        bottom: 10,
                      ),
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
          ? AppColors.pinkSoft.withValues(
              alpha: .58,
            )
          : AppColors.primarySoft.withValues(
              alpha: .58,
            ),
      child: Row(
        children: [
          SoftIconBadge(
            icon: icon,
            rose: rose,
            size: 38,
          ),
          const SizedBox(width: 9),
          Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
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
  const _NotificationCard({
    required this.item,
    required this.onTap,
  });

  final AppNotification item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final meta = _notificationMeta(
      item.type,
    );

    return VoxCard(
      onTap: onTap,
      tint: item.isRead
          ? null
          : AppColors.primarySoft.withValues(
              alpha: .67,
            ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          SoftIconBadge(
            icon: meta.$1,
            rose: meta.$2,
            size: 40,
          ),

          const SizedBox(width: 11),

          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.title.isEmpty
                            ? 'Voxidence update'
                            : item.title,
                        style:
                            const TextStyle(
                          color:
                              AppColors.textPrimary,
                          fontWeight:
                              FontWeight.w900,
                          fontSize: 12.7,
                        ),
                      ),
                    ),

                    if (!item.isRead)
                      Container(
                        width: 7,
                        height: 7,
                        decoration:
                            const BoxDecoration(
                          color:
                              AppColors.pink,
                          shape:
                              BoxShape.circle,
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
                  overflow:
                      TextOverflow.ellipsis,
                  style:
                      const TextStyle(
                    color:
                        AppColors.textSecondary,
                    fontSize: 10.6,
                    height: 1.42,
                  ),
                ),

                const SizedBox(height: 8),

                Row(
                  children: [
                    StatusChip(
                      label: _pretty(
                        _typeLabel(
                          item.type,
                        ),
                      ),
                      icon: meta.$1,
                      rose: meta.$2,
                    ),
                    const Spacer(),
                    Text(
                      _date(
                        item.createdAt,
                      ),
                      style:
                          const TextStyle(
                        color:
                            AppColors.textMuted,
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

class _NotificationDetail
    extends StatelessWidget {
  const _NotificationDetail({
    required this.item,
  });

  final AppNotification item;

  @override
  Widget build(BuildContext context) {
    final meta = _notificationMeta(
      item.type,
    );

    return DraggableScrollableSheet(
      initialChildSize: .58,
      minChildSize: .42,
      maxChildSize: .88,
      builder: (
        context,
        controller,
      ) {
        return Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius:
                BorderRadius.vertical(
              top: Radius.circular(28),
            ),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(
              20,
              10,
              20,
              28,
            ),
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.silver,
                    borderRadius:
                        BorderRadius.circular(
                      99,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 18),

              Row(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  SoftIconBadge(
                    icon: meta.$1,
                    rose: meta.$2,
                    size: 46,
                  ),

                  const SizedBox(width: 12),

                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Text(
                          item.title.isEmpty
                              ? 'Voxidence update'
                              : item.title,
                          style:
                              Theme.of(context)
                                  .textTheme
                                  .titleLarge,
                        ),

                        const SizedBox(
                          height: 5,
                        ),

                        Row(
                          children: [
                            StatusChip(
                              label: _pretty(
                                _typeLabel(
                                  item.type,
                                ),
                              ),
                              icon: meta.$1,
                              rose: meta.$2,
                            ),

                            const SizedBox(
                              width: 7,
                            ),

                            Text(
                              _date(
                                item.createdAt,
                              ),
                              style:
                                  const TextStyle(
                                color: AppColors
                                    .textMuted,
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
                tint: AppColors.surfaceMuted
                    .withValues(
                  alpha: .66,
                ),
                child: Text(
                  item.message.isEmpty
                      ? 'No additional message was provided.'
                      : item.message,
                  style:
                      const TextStyle(
                    color:
                        AppColors.textSecondary,
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
(IconData, bool) _notificationMeta(
  String? type,
) {
  final key = _typeLabel(type);

  if (key == 'PAYMENT' ||
      key == 'CREDITS' ||
      key == 'CREDIT LOW' ||
      key == 'CREDIT EXHAUSTED') {
    return (
      Icons.account_balance_wallet_outlined,
      false,
    );
  }

  if (key == 'PUBLICATION') {
    return (
      Icons.public_rounded,
      false,
    );
  }

  if (key == 'FEEDBACK') {
    return (
      Icons.forum_outlined,
      true,
    );
  }

  if (key == 'SECURITY' ||
      key == 'ADMIN') {
    return (
      Icons.shield_outlined,
      true,
    );
  }

  if (key == 'GENERATION') {
    return (
      Icons.auto_awesome_rounded,
      false,
    );
  }

  if (key == 'IDEA') {
    return (
      Icons.lightbulb_outline_rounded,
      false,
    );
  }

  return (
    Icons.notifications_none_rounded,
    false,
  );
}

String _typeLabel(String? value) {
  return (value ?? 'SYSTEM')
      .replaceAll('_', ' ')
      .trim()
      .toUpperCase();
}

String _pretty(String value) {
  final lower =
      value.trim().toLowerCase();

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