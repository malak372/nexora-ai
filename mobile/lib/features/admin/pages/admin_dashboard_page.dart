import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/storage/platform_key_value_store.dart';
import '../../../core/storage/session_store.dart';
import '../../../core/theme/app_theme.dart';
import '../api/admin_api.dart';

class AdminDashboardPage extends StatefulWidget {
  const AdminDashboardPage({super.key, required this.onOpen});

  final ValueChanged<String> onOpen;

  @override
  State<AdminDashboardPage> createState() => _AdminDashboardPageState();
}

class _AdminDashboardPageState extends State<AdminDashboardPage> {
  static const _snapshotKeyBase = 'voxidence_admin_dashboard_snapshot_v3';
  static const _snapshotMaxAge = Duration(minutes: 30);

  final AdminApi _api = AdminApi.instance;
  final PlatformKeyValueStore _storage = PlatformKeyValueStore.instance;

  Map<String, dynamic>? _data;

  String _adminName = 'Admin';
  String _error = '';
  String _overviewPeriod = 'week';

  bool _loading = true;
  bool _refreshing = false;
  int _requestId = 0;

  @override
  void initState() {
    super.initState();

    unawaited(_loadIdentity());
    unawaited(_bootstrapDashboard());
  }

  Future<void> _loadIdentity() async {
    final user = await SessionStore.instance.readUser();

    if (!mounted) {
      return;
    }

    final fullName = user?['fullName']?.toString().trim() ?? '';

    setState(() {
      _adminName = fullName.isEmpty
          ? 'Admin'
          : fullName.split(RegExp(r'\s+')).first;
    });
  }

  Future<void> _bootstrapDashboard() async {
    final requestId = ++_requestId;
    final snapshotFuture = _readDashboardSnapshot(_overviewPeriod);
    final requestFuture = _api.getDashboard(period: _overviewPeriod);

    final snapshot = await snapshotFuture;
    if (mounted && requestId == _requestId && snapshot != null) {
      setState(() {
        _data = snapshot;
        _loading = false;
        _refreshing = true;
        _error = '';
      });
    }

    try {
      final data = await requestFuture;
      if (!mounted || requestId != _requestId) return;

      setState(() {
        _data = data;
        _loading = false;
        _refreshing = false;
        _error = '';
      });
      unawaited(_writeDashboardSnapshot(data, _overviewPeriod));
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _refreshing = false;
      });
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = 'Could not load the admin dashboard.';
        _loading = false;
        _refreshing = false;
      });
    }
  }

  Future<void> _load({bool force = false}) async {
    final requestId = ++_requestId;
    final hasData = _data != null;

    setState(() {
      _loading = !hasData;
      _refreshing = hasData;
      _error = '';
    });

    try {
      final data = await _api.getDashboard(
        force: force,
        period: _overviewPeriod,
      );
      if (!mounted || requestId != _requestId) return;

      setState(() {
        _data = data;
        _loading = false;
        _refreshing = false;
      });
      unawaited(_writeDashboardSnapshot(data, _overviewPeriod));
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _refreshing = false;
      });
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = 'Could not load the admin dashboard.';
        _loading = false;
        _refreshing = false;
      });
    }
  }

  Future<Map<String, dynamic>?> _readDashboardSnapshot(String period) async {
    try {
      final values = await Future.wait<dynamic>([
        SessionStore.instance.readUser(),
        _storage.read('$_snapshotKeyBase:$period'),
      ]);
      final user = values[0] is Map
          ? Map<String, dynamic>.from(values[0] as Map)
          : <String, dynamic>{};
      final raw = values[1]?.toString() ?? '';
      if (raw.isEmpty) return null;

      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final envelope = Map<String, dynamic>.from(decoded);
      final currentUserId = user['id']?.toString().trim() ?? '';
      final savedUserId = envelope['userId']?.toString().trim() ?? '';
      final savedAt = DateTime.tryParse(envelope['savedAt']?.toString() ?? '');
      final payload = envelope['data'];

      if (currentUserId.isEmpty || savedUserId != currentUserId) return null;
      if (savedAt == null || DateTime.now().difference(savedAt) > _snapshotMaxAge) {
        return null;
      }
      if (payload is! Map) return null;
      return Map<String, dynamic>.from(payload);
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeDashboardSnapshot(
    Map<String, dynamic> data,
    String period,
  ) async {
    try {
      final user = await SessionStore.instance.readUser();
      final userId = user?['id']?.toString().trim() ?? '';
      if (userId.isEmpty) return;
      await _storage.write(
        '$_snapshotKeyBase:$period',
        jsonEncode({
          'userId': userId,
          'savedAt': DateTime.now().toIso8601String(),
          'data': data,
        }),
      );
    } catch (_) {}
  }

  Future<void> _changeOverviewPeriod(String period) async {
    if (period == _overviewPeriod || _loading) return;

    final requestId = ++_requestId;

    setState(() {
      _overviewPeriod = period;
      _refreshing = true;
      _error = '';
    });

    final snapshot = await _readDashboardSnapshot(period);

    if (mounted && requestId == _requestId && snapshot != null) {
      setState(() {
        _data = snapshot;
        _loading = false;
      });
    }

    try {
      final data = await _api.getDashboard(period: period);
      if (!mounted || requestId != _requestId) return;

      setState(() {
        _data = data;
        _loading = false;
        _refreshing = false;
        _error = '';
      });

      unawaited(_writeDashboardSnapshot(data, period));
    } on ApiException catch (error) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _refreshing = false;
      });
    } catch (_) {
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _error = 'Could not update the dashboard period.';
        _loading = false;
        _refreshing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;

    return Stack(
      children: [
        const Positioned.fill(child: _DashboardBackdrop()),
        RefreshIndicator(
          color: AppColors.primary,
          backgroundColor: AppColors.surface,
          onRefresh: () => _load(force: true),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 132),
                sliver: SliverList.list(
                  children: [
                    _DashboardHeader(
                      adminName: _adminName,
                      refreshing: _refreshing,
                      onRefresh: () => _load(force: true),
                    ),
                    const SizedBox(height: 24),
                    if (_loading && data == null)
                      const _DashboardSkeleton()
                    else if (data == null)
                      _DashboardUnavailable(
                        message: _error.isEmpty
                            ? 'Dashboard data is unavailable right now.'
                            : _error,
                        onRetry: () => _load(force: true),
                      )
                    else ...[
                      _TodayActivityCard(data: data),
                      if (_error.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        _InlineError(
                          message: _error,
                          onRetry: () => _load(force: true),
                        ),
                      ],
                      const SizedBox(height: 28),
                      _OverviewHeader(
                        period: _overviewPeriod,
                        onChanged: _changeOverviewPeriod,
                      ),
                      const SizedBox(height: 14),
                      _OverviewGrid(data: data, onOpen: widget.onOpen),
                      const SizedBox(height: 26),
                      _UserGrowthCard(
                        data: data,
                        refreshing: _refreshing,
                        onRefresh: () => _load(force: true),
                      ),
                      const SizedBox(height: 18),
                      _MonthlyPulseCard(data: data),
                      const SizedBox(height: 18),
                      _RecentUsersCard(data: data, onOpen: widget.onOpen),
                      const SizedBox(height: 18),
                      _RecentSystemActivityCard(
                        data: data,
                        onOpen: widget.onOpen,
                      ),
                      const SizedBox(height: 18),
                      _SystemHealthCard(data: data),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DashboardBackdrop extends StatelessWidget {
  const _DashboardBackdrop();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppColors.surface,
              AppColors.background,
              AppColors.background,
            ],
            stops: const [0, .34, 1],
          ),
        ),
        child: CustomPaint(painter: _BackdropPainter()),
      ),
    );
  }
}

class _BackdropPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final mintPaint = Paint()
      ..color = AppColors.primarySoft.withValues(alpha: .56)
      ..style = PaintingStyle.fill;

    final rosePaint = Paint()
      ..color = AppColors.pinkSoft.withValues(alpha: .52)
      ..style = PaintingStyle.fill;

    canvas.drawCircle(Offset(size.width + 38, 70), 115, mintPaint);

    canvas.drawCircle(Offset(-58, size.height * .58), 95, rosePaint);

    final linePaint = Paint()
      ..color = AppColors.primary.withValues(alpha: .055)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (var index = 0; index < 4; index++) {
      final path = Path()
        ..moveTo(size.width * .48, 104 + (index * 9))
        ..cubicTo(
          size.width * .67,
          65 + (index * 7),
          size.width * .80,
          150 + (index * 7),
          size.width + 18,
          102 + (index * 9),
        );

      canvas.drawPath(path, linePaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({
    required this.adminName,
    required this.refreshing,
    required this.onRefresh,
  });

  final String adminName;
  final bool refreshing;
  final VoidCallback onRefresh;

  String get _displayName {
    final value = adminName.trim();

    if (value.isEmpty) {
      return 'Admin';
    }

    if (value.length == 1) {
      return value.toUpperCase();
    }

    return '${value[0].toUpperCase()}${value.substring(1)}';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFF3FAF7), Color(0xFFFFFAF9)],
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: AppColors.borderStrong.withValues(alpha: .72),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .055),
            blurRadius: 28,
            offset: const Offset(0, 11),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: Stack(
          children: [
            const Positioned(
              right: -42,
              top: -62,
              child: _HeaderGlow(size: 164, color: Color(0xFFDCEEE9)),
            ),
            const Positioned(
              left: -55,
              bottom: -92,
              child: _HeaderGlow(size: 154, color: Color(0xFFFFEAF0)),
            ),
            Positioned(
              right: 6,
              bottom: 0,
              child: IgnorePointer(
                child: Opacity(
                  opacity: .34,
                  child: CustomPaint(
                    size: const Size(160, 78),
                    painter: _HeaderLinesPainter(),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 17, 17, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.primarySoft.withValues(alpha: .82),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: AppColors.borderStrong.withValues(
                              alpha: .62,
                            ),
                          ),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.admin_panel_settings_outlined,
                              size: 14,
                              color: AppColors.primaryDark,
                            ),
                            SizedBox(width: 6),
                            Text(
                              'ADMINISTRATION',
                              style: TextStyle(
                                color: AppColors.primaryDark,
                                fontSize: 8.7,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 1.15,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: refreshing ? null : onRefresh,
                          borderRadius: BorderRadius.circular(17),
                          child: Ink(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: AppColors.surface.withValues(alpha: .92),
                              borderRadius: BorderRadius.circular(17),
                              border: Border.all(
                                color: AppColors.borderStrong.withValues(
                                  alpha: .70,
                                ),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: AppColors.primaryDark.withValues(
                                    alpha: .045,
                                  ),
                                  blurRadius: 14,
                                  offset: const Offset(0, 6),
                                ),
                              ],
                            ),
                            child: Center(
                              child: refreshing
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.primaryDark,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.refresh_rounded,
                                      size: 22,
                                      color: AppColors.primaryDark,
                                    ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Welcome back,',
                    style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: .1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    _displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 33,
                      height: 1,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -1.25,
                    ),
                  ),
                  const SizedBox(height: 9),
                  const Text(
                    'Everything you need to run the platform.',
                    maxLines: 2,
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 10.5,
                      height: 1.35,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 17),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.surface.withValues(alpha: .72),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: AppColors.border.withValues(alpha: .82),
                          ),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _HeaderStatusDot(),
                            SizedBox(width: 7),
                            Text(
                              'Platform live',
                              style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 8.8,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.surface.withValues(alpha: .68),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: AppColors.border.withValues(alpha: .78),
                          ),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.space_dashboard_outlined,
                              size: 13,
                              color: AppColors.primary,
                            ),
                            SizedBox(width: 6),
                            Text(
                              'Control center',
                              style: TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.7,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
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

class _HeaderGlow extends StatelessWidget {
  const _HeaderGlow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withValues(alpha: .70),
        shape: BoxShape.circle,
      ),
    );
  }
}

class _HeaderStatusDot extends StatelessWidget {
  const _HeaderStatusDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(
        color: AppColors.primary,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: .28),
            blurRadius: 6,
            spreadRadius: 2,
          ),
        ],
      ),
    );
  }
}

class _HeaderLinesPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primary.withValues(alpha: .20)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (var index = 0; index < 4; index++) {
      final y = 17.0 + (index * 10);

      final path = Path()
        ..moveTo(0, y)
        ..cubicTo(
          size.width * .28,
          y - 16,
          size.width * .56,
          y + 18,
          size.width,
          y - 4,
        );

      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _TodayActivityCard extends StatelessWidget {
  const _TodayActivityCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final today = _map(data['todayStats']);

    final items = <_TodayMetric>[
      _TodayMetric(
        icon: Icons.groups_2_rounded,
        value: _formatNumber(_int(today['users'])),
        label: 'New users',
      ),
      _TodayMetric(
        icon: Icons.lightbulb_outline_rounded,
        value: _formatNumber(_int(today['ideas'])),
        label: 'Ideas',
      ),
      _TodayMetric(
        icon: Icons.monetization_on_outlined,
        value: _money(_double(today['revenue'])),
        label: 'Revenue',
      ),
    ];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 17, 18, 20),
      decoration: BoxDecoration(
        color: AppColors.primarySoft.withValues(alpha: .82),
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: AppColors.borderStrong),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .06),
            blurRadius: 24,
            offset: const Offset(0, 11),
          ),
        ],
      ),
      child: Stack(
        children: [
          const Positioned.fill(child: _ActivityCardPattern()),
          Column(
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 9),
                  const Text(
                    'TODAY',
                    style: TextStyle(
                      color: AppColors.primaryDark,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.3,
                    ),
                  ),
                  const Spacer(),
                  const Icon(
                    Icons.monitor_heart_outlined,
                    size: 17,
                    color: AppColors.primary,
                  ),
                  const SizedBox(width: 7),
                  const Flexible(
                    child: Text(
                      'Live platform activity',
                      maxLines: 2,
                      textAlign: TextAlign.end,
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 10,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: List.generate(items.length * 2 - 1, (index) {
                  if (index.isOdd) {
                    return Container(
                      width: 1,
                      height: 82,
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      color: AppColors.borderStrong.withValues(alpha: .75),
                    );
                  }

                  return Expanded(
                    child: _TodayMetricItem(data: items[index ~/ 2]),
                  );
                }),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActivityCardPattern extends StatelessWidget {
  const _ActivityCardPattern();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: CustomPaint(painter: _ActivityPatternPainter()),
    );
  }
}

class _ActivityPatternPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primary.withValues(alpha: .07)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (var index = 0; index < 5; index++) {
      final y = size.height - 18 - (index * 8);

      final path = Path()
        ..moveTo(size.width * .68, y)
        ..cubicTo(
          size.width * .79,
          y - 24,
          size.width * .89,
          y + 18,
          size.width + 10,
          y - 10,
        );

      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}

class _TodayMetric {
  const _TodayMetric({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;
}

class _TodayMetricItem extends StatelessWidget {
  const _TodayMetricItem({required this.data});

  final _TodayMetric data;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 43,
            height: 43,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .72),
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.borderStrong.withValues(alpha: .9),
              ),
            ),
            child: Icon(data.icon, size: 19, color: AppColors.primaryDark),
          ),
          const SizedBox(height: 9),
          SizedBox(
            width: double.infinity,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.center,
              child: Text(
                data.value,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 22,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.5,
                ),
              ),
            ),
          ),
          const SizedBox(height: 7),
          SizedBox(
            height: 30,
            width: double.infinity,
            child: Center(
              child: Text(
                data.label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.visible,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 9.4,
                  height: 1.25,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OverviewHeader extends StatelessWidget {
  const _OverviewHeader({
    required this.period,
    required this.onChanged,
  });

  final String period;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 41,
          height: 41,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border),
          ),
          child: const Icon(
            Icons.spa_outlined,
            size: 20,
            color: AppColors.primary,
          ),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Overview',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.35,
                ),
              ),
              SizedBox(height: 5),
              Text(
                'Core platform numbers',
                style: TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        PopupMenuButton<String>(
          initialValue: period,
          tooltip: 'Change overview period',
          color: AppColors.surface,
          surfaceTintColor: Colors.transparent,
          elevation: 8,
          position: PopupMenuPosition.under,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: AppColors.border),
          ),
          onSelected: onChanged,
          itemBuilder: (context) => const [
            PopupMenuItem(
              value: 'day',
              child: _OverviewPeriodMenuItem(
                icon: Icons.today_outlined,
                label: 'This day',
              ),
            ),
            PopupMenuItem(
              value: 'week',
              child: _OverviewPeriodMenuItem(
                icon: Icons.date_range_outlined,
                label: 'This week',
              ),
            ),
            PopupMenuItem(
              value: 'month',
              child: _OverviewPeriodMenuItem(
                icon: Icons.calendar_month_outlined,
                label: 'This month',
              ),
            ),
            PopupMenuItem(
              value: 'all',
              child: _OverviewPeriodMenuItem(
                icon: Icons.all_inclusive_rounded,
                label: 'All time',
              ),
            ),
          ],
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: .92),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.borderStrong),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _overviewPeriodLabel(period),
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(width: 7),
                const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 17,
                  color: AppColors.primary,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OverviewPeriodMenuItem extends StatelessWidget {
  const _OverviewPeriodMenuItem({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primarySoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 15, color: AppColors.primary),
        ),
        const SizedBox(width: 9),
        Text(
          label,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 11.2,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

String _overviewPeriodLabel(String value) {
  return switch (value) {
    'day' => 'This day',
    'month' => 'This month',
    'all' => 'All time',
    _ => 'This week',
  };
}

class _OverviewGrid extends StatelessWidget {
  const _OverviewGrid({required this.data, required this.onOpen});

  final Map<String, dynamic> data;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final cards = <_OverviewMetricData>[
      _OverviewMetricData(
        icon: Icons.groups_2_rounded,
        label: 'PLATFORM USERS',
        value: _formatNumber(_int(data['users'])),
        detail: '${_formatNumber(_int(data['premiumUsers']))} premium',
        accent: AppColors.primaryDark,
        iconTone: AppColors.primarySoft,
        waveTone: AppColors.primary,
        destination: 'users',
      ),
      _OverviewMetricData(
        icon: Icons.lightbulb_outline_rounded,
        label: 'GENERATED IDEAS',
        value: _formatNumber(_int(data['ideas'])),
        detail: '${_formatNumber(_int(data['unlockedIdeas']))} unlocked',
        accent: AppColors.primaryDark,
        iconTone: const Color(0xFFF0F4E8),
        waveTone: AppColors.sage,
        destination: 'ideas',
      ),
      _OverviewMetricData(
        icon: Icons.payments_outlined,
        label: 'TOTAL REVENUE',
        value: _money(_double(data['revenueTotal'])),
        detail: '${_formatNumber(_int(data['successfulPaymentsCount']))} paid',
        accent: AppColors.pinkDeep,
        iconTone: AppColors.pinkSoft,
        waveTone: AppColors.pink,
        destination: 'payments',
      ),
      _OverviewMetricData(
        icon: Icons.psychology_alt_outlined,
        label: 'AI SUCCESS RATE',
        value: '${_double(data['aiSuccessRate']).toStringAsFixed(1)}%',
        detail: '${_formatNumber(_int(data['aiRequests']))} requests',
        accent: AppColors.primaryDark,
        iconTone: AppColors.primarySoft,
        waveTone: AppColors.primary,
        destination: 'ai-monitoring',
      ),
      _OverviewMetricData(
        icon: Icons.toll_outlined,
        label: 'CREDITS SOLD',
        value: _formatNumber(_int(data['creditsSold'])),
        detail: '${_money(_double(data['refundsTotal']))} refunds',
        accent: AppColors.primaryDark,
        iconTone: const Color(0xFFF1F4ED),
        waveTone: AppColors.sage,
        destination: 'credits',
      ),
      _OverviewMetricData(
        icon: Icons.monitor_heart_outlined,
        label: 'AVG AI RESPONSE',
        value: '${_double(data['averageResponseTime']).toStringAsFixed(0)} ms',
        detail: '${_money(_double(data['aiCost']))} AI cost',
        accent: AppColors.primaryDark,
        iconTone: AppColors.primarySoft,
        waveTone: AppColors.primary,
        destination: 'ai-monitoring',
      ),
      _OverviewMetricData(
        icon: Icons.warning_amber_rounded,
        label: 'OPEN COMPLAINTS',
        value: _formatNumber(_int(data['openComplaints'])),
        detail:
            '${_formatNumber(_int(data['inProgressComplaints']))} in progress',
        accent: AppColors.pinkDeep,
        iconTone: AppColors.pinkSoft,
        waveTone: AppColors.pink,
        destination: 'complaints',
      ),
      _OverviewMetricData(
        icon: Icons.auto_awesome_rounded,
        label: 'GENERATED OUTPUTS',
        value: _formatNumber(_int(data['generatedOutputs'])),
        detail:
            '${_formatNumber(_int(_map(data['todayStats'])['ideas']))} today',
        accent: AppColors.primaryDark,
        iconTone: AppColors.primarySoft,
        waveTone: AppColors.primary,
        destination: 'ideas',
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final cardWidth = constraints.maxWidth < 325
            ? constraints.maxWidth
            : (constraints.maxWidth - 12) / 2;

        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: cards
              .map(
                (item) => SizedBox(
                  width: cardWidth,
                  child: _OverviewMetricCard(
                    data: item,
                    onTap: () => onOpen(item.destination),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class _OverviewMetricData {
  const _OverviewMetricData({
    required this.icon,
    required this.label,
    required this.value,
    required this.detail,
    required this.accent,
    required this.iconTone,
    required this.waveTone,
    required this.destination,
  });

  final IconData icon;

  final String label;
  final String value;
  final String detail;

  final Color accent;
  final Color iconTone;
  final Color waveTone;

  final String destination;
}

class _OverviewMetricCard extends StatelessWidget {
  const _OverviewMetricCard({required this.data, required this.onTap});

  final _OverviewMetricData data;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Ink(
          height: 118,
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: .98),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.graphite.withValues(alpha: .045),
                blurRadius: 15,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: Stack(
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: _MetricWavePainter(color: data.waveTone),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 13, 13, 19),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: data.iconTone,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: AppColors.border.withValues(alpha: .82),
                          ),
                        ),
                        child: Icon(data.icon, size: 20, color: data.accent),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              data.label,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: data.accent,
                                fontSize: 8.5,
                                height: 1.16,
                                fontWeight: FontWeight.w800,
                                letterSpacing: .32,
                              ),
                            ),
                            const SizedBox(height: 7),
                            SizedBox(
                              width: double.infinity,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  data.value,
                                  maxLines: 1,
                                  style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 18,
                                    height: 1,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -.25,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              data.detail,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.2,
                                height: 1.1,
                                fontWeight: FontWeight.w600,
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
        ),
      ),
    );
  }
}

class _MetricWavePainter extends CustomPainter {
  const _MetricWavePainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final fillPaint = Paint()
      ..color = color.withValues(alpha: .11)
      ..style = PaintingStyle.fill;

    final strokePaint = Paint()
      ..color = color.withValues(alpha: .29)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.05;

    final path = Path()
      ..moveTo(0, size.height - 17)
      ..cubicTo(
        size.width * .17,
        size.height - 28,
        size.width * .34,
        size.height - 12,
        size.width * .52,
        size.height - 19,
      )
      ..cubicTo(
        size.width * .69,
        size.height - 26,
        size.width * .84,
        size.height - 11,
        size.width,
        size.height - 19,
      );

    final fillPath = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();

    canvas.drawPath(fillPath, fillPaint);

    canvas.drawPath(path, strokePaint);
  }

  @override
  bool shouldRepaint(covariant _MetricWavePainter oldDelegate) {
    return oldDelegate.color != color;
  }
}

class _DashboardSectionCard extends StatelessWidget {
  const _DashboardSectionCard({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.child,
    this.trailing,
  });

  final String eyebrow;
  final String title;
  final String subtitle;

  final IconData icon;

  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(17, 17, 17, 18),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.graphite.withValues(alpha: .055),
            blurRadius: 20,
            offset: const Offset(0, 9),
          ),
        ],
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
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                ),
                child: Icon(icon, size: 20, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      eyebrow.toUpperCase(),
                      style: const TextStyle(
                        color: AppColors.primary,
                        fontSize: 8.3,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.15,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        height: 1.05,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.25,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.7,
                        height: 1.3,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            ],
          ),
          const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}

class _UserGrowthCard extends StatelessWidget {
  const _UserGrowthCard({
    required this.data,
    required this.refreshing,
    required this.onRefresh,
  });

  final Map<String, dynamic> data;

  final bool refreshing;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final points = _list(
      data['usersGrowthChart'],
    ).map(_map).where((point) => point.isNotEmpty).toList();

    final chart = points.length > 12
        ? points.sublist(points.length - 12)
        : points;

    var maxCount = 1;

    for (final point in chart) {
      maxCount = math.max(maxCount, _int(point['count'])).toInt();
    }

    return _DashboardSectionCard(
      eyebrow: 'Growth signal',
      title: 'User growth',
      subtitle: 'Recent account creation trend',
      icon: Icons.trending_up_rounded,
      trailing: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: refreshing ? null : onRefresh,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft.withValues(alpha: .72),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: refreshing
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 1.8,
                      color: AppColors.primaryDark,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                    size: 19,
                    color: AppColors.primaryDark,
                  ),
          ),
        ),
      ),
      child: chart.isEmpty
          ? const _DashboardEmptyState(
              icon: Icons.show_chart_rounded,
              text: 'No growth data yet.',
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final chartWidth = math
                    .max(constraints.maxWidth, chart.length * 47.0)
                    .toDouble();

                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  child: SizedBox(
                    width: chartWidth,
                    height: 158,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: chart.map((point) {
                        final count = _int(point['count']);

                        final ratio = count / maxCount;

                        final barHeight = math
                            .max(12.0, ratio * 100)
                            .toDouble();

                        return Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                Text(
                                  _formatNumber(count),
                                  maxLines: 1,
                                  style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 8.4,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Container(
                                  width: double.infinity,
                                  height: barHeight,
                                  constraints: const BoxConstraints(
                                    maxWidth: 26,
                                  ),
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [
                                        AppColors.primary.withValues(
                                          alpha: .84,
                                        ),
                                        AppColors.primarySoft,
                                      ],
                                    ),
                                    borderRadius: const BorderRadius.vertical(
                                      top: Radius.circular(9),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 7),
                                Text(
                                  _shortDate(point['date']),
                                  maxLines: 1,
                                  overflow: TextOverflow.fade,
                                  style: const TextStyle(
                                    color: AppColors.textMuted,
                                    fontSize: 7.7,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                );
              },
            ),
    );
  }
}

class _MonthlyPulseCard extends StatelessWidget {
  const _MonthlyPulseCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final month = _map(data['monthlyStats']);

    final metrics = <_PulseMetricData>[
      _PulseMetricData(
        label: 'Users this month',
        value: _formatNumber(_int(month['users'])),
        detail: 'new accounts',
        icon: Icons.groups_2_outlined,
      ),
      _PulseMetricData(
        label: 'Ideas this month',
        value: _formatNumber(_int(month['ideas'])),
        detail: 'generated',
        icon: Icons.auto_awesome_outlined,
      ),
      _PulseMetricData(
        label: 'Revenue this month',
        value: _money(_double(month['revenue'])),
        detail: 'total revenue',
        icon: Icons.account_balance_wallet_outlined,
        accent: true,
      ),
    ];

    return _DashboardSectionCard(
      eyebrow: 'This month',
      title: 'Monthly pulse',
      subtitle: 'Platform activity across the current month',
      icon: Icons.calendar_month_outlined,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth < 310
              ? constraints.maxWidth
              : (constraints.maxWidth - 10) / 2;

          return Wrap(
            spacing: 10,
            runSpacing: 10,
            children: metrics
                .map(
                  (metric) => SizedBox(
                    width: width,
                    child: _PulseMetricCard(data: metric),
                  ),
                )
                .toList(),
          );
        },
      ),
    );
  }
}

class _PulseMetricData {
  const _PulseMetricData({
    required this.label,
    required this.value,
    required this.detail,
    required this.icon,
    this.accent = false,
  });

  final String label;
  final String value;
  final String detail;

  final IconData icon;

  final bool accent;
}

class _PulseMetricCard extends StatelessWidget {
  const _PulseMetricCard({required this.data});

  final _PulseMetricData data;

  @override
  Widget build(BuildContext context) {
    final surface = data.accent
        ? AppColors.pinkSoft.withValues(alpha: .56)
        : AppColors.background.withValues(alpha: .72);

    final accent = data.accent ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      constraints: const BoxConstraints(minHeight: 125),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 15),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: data.accent
              ? AppColors.pinkLight.withValues(alpha: .45)
              : AppColors.border,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(data.icon, size: 15, color: accent),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  data.label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.7,
                    height: 1.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 13),
          SizedBox(
            width: double.infinity,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.center,
              child: Text(
                data.value,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 22,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.45,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            data.detail,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: accent.withValues(alpha: .76),
              fontSize: 8.3,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentUsersCard extends StatelessWidget {
  const _RecentUsersCard({required this.data, required this.onOpen});

  final Map<String, dynamic> data;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final activity = _map(data['recentActivity']);

    final users = _list(activity['recentUsers']).map(_map).take(6).toList();

    return _DashboardSectionCard(
      eyebrow: 'Community',
      title: 'Recent users',
      subtitle: 'Newest registered accounts',
      icon: Icons.groups_2_outlined,
      trailing: _SectionArrowButton(onTap: () => onOpen('users')),
      child: users.isEmpty
          ? const _DashboardEmptyState(
              icon: Icons.group_off_outlined,
              text: 'No recent users yet.',
            )
          : Column(
              children: List.generate(users.length, (index) {
                final item = users[index];

                final name = _safeText(
                  item['fullName'],
                  fallback: _safeText(item['email'], fallback: 'User'),
                );

                final status = _safeText(
                  item['accountStatus'],
                  fallback: 'UNKNOWN',
                );

                return _ActivityRow(
                  icon: Icons.person_outline_rounded,
                  title: name,
                  meta: '$status · ${_shortDate(item['createdAt'])}',
                  accent: index == 0 ? AppColors.primary : AppColors.sage,
                  showDivider: index != users.length - 1,
                );
              }),
            ),
    );
  }
}

class _RecentSystemActivityCard extends StatelessWidget {
  const _RecentSystemActivityCard({required this.data, required this.onOpen});

  final Map<String, dynamic> data;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final activity = _map(data['recentActivity']);

    final rows = <_RecentActivityData>[];

    final recentPayments = _list(activity['recentPayments'])
        .map(_map)
        .toList();
    final finalizedPaymentTargets = <String>{};

    for (final item in recentPayments) {
      final status = _safeText(item['status'], fallback: 'UNKNOWN').toUpperCase();
      final key = _paymentActivityTargetKey(item);
      if (key.isNotEmpty && status == 'SUCCEEDED') {
        finalizedPaymentTargets.add(key);
      }
    }

    final visiblePayments = recentPayments.where((item) {
      final status = _safeText(item['status'], fallback: 'UNKNOWN').toUpperCase();
      if (status != 'PENDING') return true;
      final key = _paymentActivityTargetKey(item);
      return key.isEmpty || !finalizedPaymentTargets.contains(key);
    }).take(2);

    for (final item in visiblePayments) {
      final user = _map(item['user']);
      final currency = _safeText(item['currency'], fallback: 'USD');
      final status = _safeText(item['status'], fallback: 'UNKNOWN');

      rows.add(
        _RecentActivityData(
          icon: Icons.payments_outlined,
          title:
              '${_paymentMoney(_double(item['amount']), currency)} · '
              '${_safeText(item['paymentPurpose'], fallback: 'Payment')}',
          meta:
              '${_safeText(user['fullName'], fallback: _safeText(user['email'], fallback: 'User'))} · '
              '${status == 'SUCCEEDED' ? 'PAID' : status}',
          accent: AppColors.primary,
        ),
      );
    }

    for (final raw in _list(activity['recentIdeas']).take(2)) {
      final item = _map(raw);

      final domain = _map(item['domain']);

      rows.add(
        _RecentActivityData(
          icon: Icons.lightbulb_outline_rounded,
          title: _safeText(item['title'], fallback: 'Generated idea'),
          meta:
              '${_safeText(domain['name'], fallback: 'No domain')} · '
              '${_shortDate(item['createdAt'])}',
          accent: AppColors.sage,
        ),
      );
    }

    for (final raw in _list(activity['recentComplaints']).take(2)) {
      final item = _map(raw);

      rows.add(
        _RecentActivityData(
          icon: Icons.warning_amber_rounded,
          title: _safeText(item['subject'], fallback: 'Complaint'),
          meta:
              '${_safeText(item['priority'], fallback: 'NORMAL')} · '
              '${_safeText(item['status'], fallback: 'UNKNOWN')}',
          accent: AppColors.pinkDeep,
        ),
      );
    }

    return _DashboardSectionCard(
      eyebrow: 'Operations',
      title: 'Recent system activity',
      subtitle: 'Ideas, payments and complaints',
      icon: Icons.timeline_rounded,
      trailing: _SectionArrowButton(onTap: () => onOpen('alerts')),
      child: rows.isEmpty
          ? const _DashboardEmptyState(
              icon: Icons.history_toggle_off_rounded,
              text: 'No recent activity yet.',
            )
          : Column(
              children: List.generate(rows.length, (index) {
                final row = rows[index];

                return _ActivityRow(
                  icon: row.icon,
                  title: row.title,
                  meta: row.meta,
                  accent: row.accent,
                  showDivider: index != rows.length - 1,
                );
              }),
            ),
    );
  }
}

class _RecentActivityData {
  const _RecentActivityData({
    required this.icon,
    required this.title,
    required this.meta,
    required this.accent,
  });

  final IconData icon;
  final String title;
  final String meta;
  final Color accent;
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    required this.icon,
    required this.title,
    required this.meta,
    required this.accent,
    required this.showDivider,
  });

  final IconData icon;

  final String title;
  final String meta;

  final Color accent;

  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: .11),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, size: 18, color: accent),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.6,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 8.7,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (showDivider)
          Divider(
            height: 1,
            thickness: 1,
            color: AppColors.border.withValues(alpha: .72),
          ),
      ],
    );
  }
}

class _SectionArrowButton extends StatelessWidget {
  const _SectionArrowButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.background.withValues(alpha: .75),
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.border),
          ),
          child: const Icon(
            Icons.arrow_forward_rounded,
            size: 17,
            color: AppColors.primaryDark,
          ),
        ),
      ),
    );
  }
}

class _DashboardEmptyState extends StatelessWidget {
  const _DashboardEmptyState({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 20),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 17, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 9.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SystemHealthCard extends StatelessWidget {
  const _SystemHealthCard({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final aiSuccess = _double(data['aiSuccessRate']).clamp(0, 100).toDouble();

    final averageResponse = _double(data['averageResponseTime']);

    final failedRequests = _int(data['failedAiRequests']);

    final domains = _map(data['domainsStatus']);

    final sources = _map(data['dataSourcesStatus']);

    final activeServices = _int(domains['active']) + _int(sources['active']);

    final allServices =
        activeServices + _int(domains['inactive']) + _int(sources['inactive']);

    final serviceAvailability = allServices == 0
        ? 100.0
        : (activeServices / allServices) * 100;

    final performance = ((aiSuccess * .72) + (serviceAvailability * .28))
        .clamp(0, 100)
        .toDouble();

    final operational = failedRequests == 0 && serviceAvailability >= 90;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 19),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.graphite.withValues(alpha: .055),
            blurRadius: 20,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primarySoft,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.monitor_heart_outlined,
                  size: 20,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: 11),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'System health',
                      style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 20,
                        height: 1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.35,
                      ),
                    ),
                    SizedBox(height: 5),
                    Text(
                      'AI performance and service load',
                      style: TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10.2,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _SystemStatusPill(operational: operational),
            ],
          ),
          const SizedBox(height: 20),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 320) {
                return Column(
                  children: [
                    _PerformanceGauge(value: performance),
                    const SizedBox(height: 18),
                    _HealthStats(
                      averageResponse: averageResponse,
                      aiSuccess: aiSuccess,
                      activeServices: activeServices,
                      allServices: allServices,
                    ),
                  ],
                );
              }

              return Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  SizedBox(
                    width: math
                        .min(142.0, constraints.maxWidth * .41)
                        .toDouble(),
                    child: _PerformanceGauge(value: performance),
                  ),
                  const SizedBox(width: 16),
                  Container(width: 1, height: 95, color: AppColors.border),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _HealthStats(
                      averageResponse: averageResponse,
                      aiSuccess: aiSuccess,
                      activeServices: activeServices,
                      allServices: allServices,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _SystemStatusPill extends StatelessWidget {
  const _SystemStatusPill({required this.operational});

  final bool operational;

  @override
  Widget build(BuildContext context) {
    final background = operational ? AppColors.primarySoft : AppColors.pinkSoft;

    final foreground = operational ? AppColors.primaryDark : AppColors.pinkDeep;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: operational ? AppColors.success : AppColors.warning,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 7),
          Text(
            operational ? 'Operational' : 'Monitor',
            style: TextStyle(
              color: foreground,
              fontSize: 8.6,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _PerformanceGauge extends StatelessWidget {
  const _PerformanceGauge({required this.value});

  final double value;

  @override
  Widget build(BuildContext context) {
    final normalized = value.clamp(0, 100).toDouble();

    return Center(
      child: SizedBox(
        width: 122,
        height: 122,
        child: CustomPaint(
          painter: _HealthRingPainter(progress: normalized / 100),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${normalized.toStringAsFixed(0)}%',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 25,
                    height: 1,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.7,
                  ),
                ),
                const SizedBox(height: 5),
                const Text(
                  'Avg. performance',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 8.2,
                    fontWeight: FontWeight.w700,
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

class _HealthRingPainter extends CustomPainter {
  const _HealthRingPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = math.max(8.0, size.width * .075).toDouble();
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (math.min(size.width, size.height) - stroke) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    final track = Paint()
      ..color = AppColors.mint.withValues(alpha: .78)
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    final valuePaint = Paint()
      ..color = AppColors.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, track);
    canvas.drawArc(
      rect,
      -math.pi / 2,
      math.pi * 2 * progress.clamp(0, 1).toDouble(),
      false,
      valuePaint,
    );
  }

  @override
  bool shouldRepaint(covariant _HealthRingPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _HealthStats extends StatelessWidget {
  const _HealthStats({
    required this.averageResponse,
    required this.aiSuccess,
    required this.activeServices,
    required this.allServices,
  });

  final double averageResponse;
  final double aiSuccess;

  final int activeServices;
  final int allServices;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _HealthStatRow(
          dotColor: AppColors.primary,
          label: 'Avg. response time',
          value: '${averageResponse.toStringAsFixed(0)} ms',
        ),
        const SizedBox(height: 14),
        _HealthStatRow(
          dotColor: AppColors.sage,
          label: 'Success rate',
          value: '${aiSuccess.toStringAsFixed(1)}%',
          valueColor: AppColors.success,
        ),
        const SizedBox(height: 14),
        _HealthStatRow(
          dotColor: AppColors.warning,
          label: 'Active services',
          value: allServices == 0 ? '—' : '$activeServices/$allServices',
          valueColor: AppColors.primaryDark,
        ),
      ],
    );
  }
}

class _HealthStatRow extends StatelessWidget {
  const _HealthStatRow({
    required this.dotColor,
    required this.label,
    required this.value,
    this.valueColor = AppColors.textPrimary,
  });

  final Color dotColor;

  final String label;
  final String value;

  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.2,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          value,
          maxLines: 1,
          style: TextStyle(
            color: valueColor,
            fontSize: 10.2,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.pinkLight.withValues(alpha: .58)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_outline_rounded,
            size: 16,
            color: AppColors.pinkDeep,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 9.2,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.pinkDeep,
              minimumSize: const Size(0, 30),
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
            child: const Text(
              'Retry',
              style: TextStyle(fontSize: 8.8, fontWeight: FontWeight.w900),
            ),
          ),
        ],
      ),
    );
  }
}

class _DashboardUnavailable extends StatelessWidget {
  const _DashboardUnavailable({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.graphite.withValues(alpha: .05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(18),
            ),
            child: const Icon(
              Icons.monitor_heart_outlined,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Dashboard unavailable',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 10,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 16),
            label: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}

class _DashboardSkeleton extends StatelessWidget {
  const _DashboardSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const _SkeletonBlock(height: 165, radius: 25),
        const SizedBox(height: 28),
        const Row(
          children: [
            _SkeletonCircle(size: 41),
            SizedBox(width: 12),
            Expanded(child: _SkeletonLine(height: 18)),
            SizedBox(width: 20),
            _SkeletonLine(width: 78, height: 34),
          ],
        ),
        const SizedBox(height: 14),
        LayoutBuilder(
          builder: (context, constraints) {
            final width = (constraints.maxWidth - 12) / 2;

            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: List.generate(
                8,
                (_) => SizedBox(
                  width: width,
                  child: const _SkeletonBlock(height: 118, radius: 22),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 26),
        const _SkeletonBlock(height: 220, radius: 24),
        const SizedBox(height: 18),
        const _SkeletonBlock(height: 240, radius: 24),
        const SizedBox(height: 18),
        const _SkeletonBlock(height: 250, radius: 24),
        const SizedBox(height: 18),
        const _SkeletonBlock(height: 300, radius: 24),
        const SizedBox(height: 18),
        const _SkeletonBlock(height: 190, radius: 24),
      ],
    );
  }
}

class _SkeletonBlock extends StatelessWidget {
  const _SkeletonBlock({required this.height, required this.radius});

  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: .92),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppColors.border),
      ),
    );
  }
}

class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({this.width, required this.height});

  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(999),
      ),
    );
  }
}

class _SkeletonCircle extends StatelessWidget {
  const _SkeletonCircle({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        color: AppColors.primarySoft,
        shape: BoxShape.circle,
      ),
    );
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }

  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }

  return const {};
}

int _int(dynamic value) {
  if (value is int) {
    return value;
  }

  if (value is num) {
    return value.toInt();
  }

  return int.tryParse(value?.toString() ?? '') ?? 0;
}

double _double(dynamic value) {
  if (value is num) {
    return value.toDouble();
  }

  return double.tryParse(value?.toString() ?? '') ?? 0;
}

List<dynamic> _list(dynamic value) {
  if (value is List) {
    return value;
  }

  return const [];
}

String _formatNumber(int value) {
  final negative = value < 0;

  final digits = value.abs().toString();

  final buffer = StringBuffer();

  for (var index = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 == 0) {
      buffer.write(',');
    }

    buffer.write(digits[index]);
  }

  return negative ? '-$buffer' : buffer.toString();
}

String _money(double value) {
  final rounded = value.toStringAsFixed(2);

  final parts = rounded.split('.');

  final whole = _formatNumber(int.tryParse(parts.first) ?? 0);

  return '\$$whole.'
      '${parts.length > 1 ? parts[1] : '00'}';
}

String _paymentMoney(double value, String currency) {
  final rounded = value.toStringAsFixed(2);
  final parts = rounded.split('.');
  final whole = _formatNumber(int.tryParse(parts.first) ?? 0);
  final amount = '$whole.${parts.length > 1 ? parts[1] : '00'}';

  switch (currency.trim().toUpperCase()) {
    case 'EUR':
      return '€$amount';
    case 'GBP':
      return '£$amount';
    case 'ILS':
      return '₪$amount';
    case 'AED':
      return 'AED $amount';
    default:
      return '\$$amount';
  }
}

String _paymentActivityTargetKey(Map<String, dynamic> item) {
  final purpose = _safeText(item['paymentPurpose'], fallback: '').toUpperCase();
  if (purpose != 'DIRECT_UNLOCK' &&
      purpose != 'ACCEPT_PUBLICATION' &&
      purpose != 'UNLOCK_PUBLICATION_ADVANCED') {
    return '';
  }

  final user = _map(item['user']);
  final userId = _safeText(
    item['userId'],
    fallback: _safeText(user['id'], fallback: ''),
  );
  final ideaId = _safeText(item['ideaId'], fallback: '');
  final publicationId = _safeText(item['publicationId'], fallback: '');
  final targetId = ideaId.isNotEmpty ? ideaId : publicationId;
  if (userId.isEmpty || targetId.isEmpty) return '';
  return '$userId|$purpose|$targetId';
}

String _shortDate(dynamic value) {
  final text = value?.toString().trim() ?? '';

  if (text.isEmpty) {
    return '—';
  }

  final parsed = DateTime.tryParse(text);

  if (parsed == null) {
    return text.length > 10 ? text.substring(0, 10) : text;
  }

  const months = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return '${months[parsed.month - 1]} '
      '${parsed.day}';
}

String _safeText(dynamic value, {required String fallback}) {
  final text = value?.toString().trim() ?? '';

  return text.isEmpty ? fallback : text;
}
