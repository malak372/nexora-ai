// Voxidence mobile dashboard — Normal + Premium.
//
// This screen intentionally mirrors the information architecture of the web
// dashboard while using a mobile-native vertical composition.
//
// Web-parity sections:
// 1. Intelligence hero + access state.
// 2. Animated signal / multi-model core.
// 3. AI discovery prompt.
// 4. Workspace metrics.
// 5. Active generation resume banner.
// 6. Latest validated workspace.
// 7. About Voxidence.
// 8. Authenticated contact form.
//
// The bottom navigation and floating bulb live in UserShell and are not
// modified by this file.
//
// @author  Malak

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_config.dart';
import '../../../core/theme/app_theme.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';
import '../widgets/user_ui.dart';
import 'generation_progress_page.dart';
import 'idea_workspace_page.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({
    super.key,
    required this.onOpenGenerate,
    required this.onOpenGenerateWithProblem,
    required this.onOpenLibrary,
    required this.onOpenDiscover,
  });

  final VoidCallback onOpenGenerate;
  final ValueChanged<String> onOpenGenerateWithProblem;
  final VoidCallback onOpenLibrary;
  final VoidCallback onOpenDiscover;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  final UserSessionController _session = UserSessionController.instance;

  Map<String, dynamic>? _activeRun;
  bool _loadingActiveRun = false;

  @override
  void initState() {
    super.initState();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_session.summary == null) {
        _session.load();
      }
      _loadSecondary();
    });
  }

  Future<void> _loadSecondary({bool force = false}) async {
    if (_loadingActiveRun) return;

    if (mounted) {
      setState(() => _loadingActiveRun = true);
    }

    try {
      final run = await UserApi.instance.getActiveGenerationRun(force: force);

      if (!mounted) return;

      setState(() => _activeRun = run);
    } catch (_) {
      if (!mounted) return;

      setState(() => _activeRun = null);
    } finally {
      if (mounted) {
        setState(() => _loadingActiveRun = false);
      }
    }
  }

  Future<void> _refresh() async {
    await _session.load(force: true);
    await _loadSecondary(force: true);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _session,
      builder: (context, _) {
        final summary = _session.summary;

        return _DashboardBackdrop(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 122),
              children: [
                if (summary == null && _session.loading)
                  const LoadingList(count: 5)
                else if (summary == null)
                  _ConnectionState(error: _session.error, onRetry: _refresh)
                else ...[
                  if (_session.error != null) ...[
                    InlineNotice(
                      icon: Icons.wifi_off_rounded,
                      title: _session.usingCachedSnapshot
                          ? 'Using saved workspace data'
                          : 'Some dashboard data may be delayed',
                      message:
                          'Voxidence could not refresh from ${ApiConfig.baseUrl}. You can keep working and retry safely.',
                      actionLabel: 'Retry',
                      onAction: _refresh,
                    ),
                    const SizedBox(height: 12),
                  ],

                  _Reveal(
                    delay: 0,
                    child: _WebStyleHero(
                      summary: summary,
                      onGenerate: widget.onOpenGenerate,
                      onIdeas: widget.onOpenLibrary,
                    ),
                  ),

                  const SizedBox(height: 16),

                  _Reveal(
                    delay: 70,
                    child: _IdeaLauncher(
                      onOpenGenerate: widget.onOpenGenerate,
                      onStart: widget.onOpenGenerateWithProblem,
                    ),
                  ),

                  const SizedBox(height: 19),

                  _Reveal(delay: 120, child: _MetricsSection(summary: summary)),

                  if (_activeRun != null) ...[
                    const SizedBox(height: 8),
                    _Reveal(
                      delay: 170,
                      child: _ActiveRunCard(run: _activeRun!),
                    ),
                  ],

                  const SizedBox(height: 14),

                  _Reveal(
                    delay: 210,
                    child: _LatestWorkspaceSection(
                      summary: summary,
                      onViewAll: widget.onOpenLibrary,
                      onGenerate: widget.onOpenGenerate,
                    ),
                  ),

                  const SizedBox(height: 20),

                  _Reveal(delay: 260, child: const _AboutSection()),

                  const SizedBox(height: 12),

                  _Reveal(delay: 310, child: _ContactSection(summary: summary)),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Dashboard-only atmospheric background.
///
/// The shared workspace background still sits underneath this widget. This
/// layer adds the finer mesh, rose/mint bloom and floating points used by the
/// web dashboard without changing the visual language of the other pages.
class _DashboardBackdrop extends StatefulWidget {
  const _DashboardBackdrop({required this.child});

  final Widget child;

  @override
  State<_DashboardBackdrop> createState() => _DashboardBackdropState();
}

class _DashboardBackdropState extends State<_DashboardBackdrop>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 16),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      child: widget.child,
      builder: (context, child) {
        final phase = _controller.value * math.pi * 2;

        return Stack(
          children: [
            Positioned(
              right: -122 + math.cos(phase * .6) * 16,
              top: 42 + math.sin(phase * .7) * 15,
              child: _Glow(
                size: 260,
                color: AppColors.primary.withValues(alpha: .075),
              ),
            ),
            Positioned(
              left: -150 + math.sin(phase * .52) * 18,
              top: 355 + math.cos(phase * .55) * 13,
              child: _Glow(
                size: 285,
                color: AppColors.pinkLight.withValues(alpha: .11),
              ),
            ),
            Positioned(
              right: -130 + math.cos(phase * .44) * 14,
              bottom: 150 + math.sin(phase * .58) * 17,
              child: _Glow(
                size: 260,
                color: const Color(0xFFB8DDD5).withValues(alpha: .10),
              ),
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: _DashboardMeshPainter(progress: _controller.value),
                ),
              ),
            ),
            Positioned.fill(child: child!),
          ],
        );
      },
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
        ),
      ),
    );
  }
}

class _DashboardMeshPainter extends CustomPainter {
  const _DashboardMeshPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: .028)
      ..strokeWidth = .7;

    const step = 34.0;

    for (double x = 0; x <= size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), grid);
    }

    for (double y = 0; y <= size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }

    final pulse = (math.sin(progress * math.pi * 2) + 1) / 2;

    final points = <Offset>[
      Offset(size.width * .08, 88),
      Offset(size.width * .83, 176),
      Offset(size.width * .18, 486),
      Offset(size.width * .91, 622),
      Offset(size.width * .52, 840),
    ];

    for (var i = 0; i < points.length; i++) {
      final rose = i.isOdd;
      final color = rose ? AppColors.pink : AppColors.primary;

      canvas.drawCircle(
        points[i],
        3 + pulse,
        Paint()..color = color.withValues(alpha: .11 + pulse * .06),
      );

      canvas.drawCircle(
        points[i],
        1.3,
        Paint()..color = color.withValues(alpha: .50),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _DashboardMeshPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _WebStyleHero extends StatelessWidget {
  const _WebStyleHero({
    required this.summary,
    required this.onGenerate,
    required this.onIdeas,
  });

  final UserSummary summary;
  final VoidCallback onGenerate;
  final VoidCallback onIdeas;

  @override
  Widget build(BuildContext context) {
    final premium = summary.isPremium;
    final accessTitle = premium
        ? '${summary.creditBalance} premium credit${summary.creditBalance == 1 ? '' : 's'} ready'
        : summary.remainingFreeGenerations > 0
        ? '${summary.remainingFreeGenerations} free discover${summary.remainingFreeGenerations == 1 ? 'y' : 'ies'} ready'
        : 'Explore first. Unlock only when you choose.';

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(30),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFFFFAFB), Color(0xFFF3FAF8)],
          stops: [0, .56, 1],
        ),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .075),
            blurRadius: 34,
            offset: const Offset(0, 15),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: Stack(
          children: [
            const Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: _HeroDotsPainter()),
              ),
            ),
            Positioned(
              right: -95,
              top: -105,
              child: _Glow(
                size: 245,
                color: const Color(0xFFBDE2DB).withValues(alpha: .30),
              ),
            ),
            Positioned(
              left: -120,
              bottom: -135,
              child: _Glow(
                size: 265,
                color: AppColors.pinkLight.withValues(alpha: .23),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 19, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _EyebrowPill(
                    icon: premium
                        ? Icons.auto_awesome_rounded
                        : Icons.travel_explore_rounded,
                    label: premium
                        ? 'Premium intelligence'
                        : 'Evidence-first discovery',
                    premium: premium,
                  ),
                  const SizedBox(height: 14),
                  RichText(
                    text: TextSpan(
                      style: Theme.of(context).textTheme.headlineMedium
                          ?.copyWith(
                            color: AppColors.textPrimary,
                            fontSize: 28,
                            height: 1.04,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1.05,
                          ),
                      children: const [
                        TextSpan(text: 'Turn real signals into\n'),
                        TextSpan(
                          text: 'software worth building.',
                          style: TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Voxidence listens across communities, connects repeated needs with evidence, compares multiple AI candidates, and returns one validated direction.',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 10.6,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 15),
                  _SignalCore(
                    premium: premium,
                    count: premium
                        ? summary.creditBalance
                        : summary.remainingFreeGenerations,
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: onGenerate,
                          icon: const Icon(
                            Icons.rocket_launch_rounded,
                            size: 16,
                          ),
                          label: const Text('Start discovering'),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(49),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 9),
                      SizedBox(
                        width: 116,
                        child: OutlinedButton(
                          onPressed: onIdeas,
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(49),
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            backgroundColor: Colors.white.withValues(
                              alpha: .72,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          child: const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.lightbulb_outline_rounded, size: 16),
                              SizedBox(width: 6),
                              Text('My ideas'),
                              SizedBox(width: 4),
                              Icon(Icons.arrow_forward_rounded, size: 14),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .68),
                      borderRadius: BorderRadius.circular(15),
                      border: Border.all(
                        color: AppColors.primaryDark.withValues(alpha: .08),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: AppColors.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            accessTitle,
                            style: const TextStyle(
                              color: AppColors.primaryDark,
                              fontSize: 9.8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        Text(
                          premium ? 'FULL ACCESS' : 'NORMAL ACCESS',
                          style: TextStyle(
                            color: premium
                                ? AppColors.success
                                : AppColors.textMuted,
                            fontSize: 7.4,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .48,
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

class _HeroDotsPainter extends CustomPainter {
  const _HeroDotsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: .055);

    const spacing = 27.0;

    for (double x = 14; x < size.width; x += spacing) {
      for (double y = 14; y < size.height; y += spacing) {
        if (x < size.width * .35 && y < 180) continue;

        canvas.drawCircle(Offset(x, y), .75, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _HeroDotsPainter oldDelegate) => false;
}

class _EyebrowPill extends StatelessWidget {
  const _EyebrowPill({
    required this.icon,
    required this.label,
    required this.premium,
  });

  final IconData icon;
  final String label;
  final bool premium;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .72),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .10)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 12.5,
            color: premium ? AppColors.pinkDeep : AppColors.primaryDark,
          ),
          const SizedBox(width: 6),
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 7.9,
              fontWeight: FontWeight.w900,
              letterSpacing: .76,
            ),
          ),
        ],
      ),
    );
  }
}

/// Mobile translation of the rotating multi-model intelligence core from web.

class _SignalCore extends StatefulWidget {
  const _SignalCore({required this.premium, required this.count});

  final bool premium;
  final int count;

  @override
  State<_SignalCore> createState() => _SignalCoreState();
}

class _SignalCoreState extends State<_SignalCore>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 7),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 128,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        color: Colors.white.withValues(alpha: .58),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .07)),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(22),
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final phase = _controller.value * math.pi * 2;
            return Stack(
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: _SignalPathPainter(progress: _controller.value),
                  ),
                ),
                Positioned(
                  left: 18,
                  top: 18 + math.sin(phase) * 3,
                  child: const _SignalNode(
                    icon: Icons.groups_2_outlined,
                    label: 'Voices',
                  ),
                ),
                Positioned(
                  right: 18,
                  top: 18 + math.cos(phase * .9) * 3,
                  child: const _SignalNode(
                    icon: Icons.hub_outlined,
                    label: 'Evidence',
                  ),
                ),
                Align(
                  alignment: Alignment.center,
                  child: Transform.translate(
                    offset: Offset(0, math.sin(phase * 1.2) * 2.2),
                    child: Container(
                      width: 62,
                      height: 62,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [Color(0xFF6CC7C1), Color(0xFF4AA9A3)],
                        ),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: .92),
                          width: 1.4,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primaryDark.withValues(alpha: .18),
                            blurRadius: 22,
                            offset: const Offset(0, 9),
                          ),
                        ],
                      ),
                      child: _DiscoveryCoreGlyph(phase: phase),
                    ),
                  ),
                ),
                Positioned(
                  left: 14,
                  right: 14,
                  bottom: 10,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const _MiniProof(
                        icon: Icons.verified_outlined,
                        text: 'Validated',
                      ),
                      const SizedBox(width: 7),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .88),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: AppColors.primaryDark.withValues(alpha: .07),
                          ),
                        ),
                        child: Text(
                          widget.premium
                              ? '${widget.count} credits'
                              : '${widget.count} free',
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 8.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 7),
                      const _MiniProof(
                        icon: Icons.auto_awesome_rounded,
                        text: 'Multi-model',
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DiscoveryCoreGlyph extends StatelessWidget {
  const _DiscoveryCoreGlyph({required this.phase});

  final double phase;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        SizedBox(
          width: 43,
          height: 43,
          child: CustomPaint(painter: _DiscoveryCoreGlyphPainter(phase: phase)),
        ),
        Positioned(
          top: 9,
          right: 9,
          child: Transform.rotate(
            angle: phase * .18,
            child: const Icon(
              Icons.auto_awesome_rounded,
              color: Color(0xFFFFF1B1),
              size: 9,
            ),
          ),
        ),
      ],
    );
  }
}

class _DiscoveryCoreGlyphPainter extends CustomPainter {
  const _DiscoveryCoreGlyphPainter({required this.phase});

  final double phase;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final linePaint = Paint()
      ..color = Colors.white.withValues(alpha: .72)
      ..strokeWidth = 1.35
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    final nodePaint = Paint()..color = Colors.white;
    final softNodePaint = Paint()
      ..color = const Color(0xFFDDF6F1).withValues(alpha: .92);

    final radius = size.width * .31;
    final points = List<Offset>.generate(4, (index) {
      final angle = phase * .16 + index * math.pi / 2 + math.pi / 4;
      return center + Offset(math.cos(angle), math.sin(angle)) * radius;
    });

    for (final point in points) {
      canvas.drawLine(center, point, linePaint);
      canvas.drawCircle(point, 2.25, softNodePaint);
      canvas.drawCircle(point, .95, nodePaint);
    }

    final diamond = Path()
      ..moveTo(center.dx, center.dy - 7)
      ..lineTo(center.dx + 7, center.dy)
      ..lineTo(center.dx, center.dy + 7)
      ..lineTo(center.dx - 7, center.dy)
      ..close();

    canvas.drawPath(
      diamond,
      Paint()..color = Colors.white.withValues(alpha: .96),
    );
    canvas.drawCircle(
      center,
      2.4,
      Paint()..color = AppColors.primaryDark.withValues(alpha: .80),
    );
  }

  @override
  bool shouldRepaint(covariant _DiscoveryCoreGlyphPainter oldDelegate) {
    return oldDelegate.phase != phase;
  }
}

class _SignalNode extends StatelessWidget {
  const _SignalNode({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .88),
        borderRadius: BorderRadius.circular(13),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .06),
            blurRadius: 13,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(icon, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 7.7,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniProof extends StatelessWidget {
  const _MiniProof({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 11, color: AppColors.primary),
        const SizedBox(width: 3),
        Text(
          text,
          style: const TextStyle(
            color: AppColors.textMuted,
            fontSize: 7.1,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _SignalPathPainter extends CustomPainter {
  const _SignalPathPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(22, size.height * .47)
      ..cubicTo(
        size.width * .28,
        size.height * .20,
        size.width * .35,
        size.height * .75,
        size.width * .50,
        size.height * .48,
      )
      ..cubicTo(
        size.width * .64,
        size.height * .18,
        size.width * .73,
        size.height * .72,
        size.width - 22,
        size.height * .42,
      );

    final line = Paint()
      ..color = AppColors.primaryDark.withValues(alpha: .17)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.15;

    canvas.drawPath(path, line);

    final metric = path.computeMetrics().first;
    final moving = metric.getTangentForOffset(metric.length * progress);

    if (moving != null) {
      canvas.drawCircle(
        moving.position,
        5.5,
        Paint()..color = AppColors.primary.withValues(alpha: .12),
      );
      canvas.drawCircle(
        moving.position,
        2.4,
        Paint()..color = AppColors.primary,
      );
    }

    canvas.drawCircle(
      Offset(size.width * .19, size.height * .55),
      2.5,
      Paint()..color = AppColors.pink.withValues(alpha: .68),
    );
    canvas.drawCircle(
      Offset(size.width * .81, size.height * .54),
      2.5,
      Paint()..color = AppColors.primaryDark.withValues(alpha: .56),
    );
  }

  @override
  bool shouldRepaint(covariant _SignalPathPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _IdeaLauncher extends StatefulWidget {
  const _IdeaLauncher({
    required this.onOpenGenerate,
    required this.onStart,
  });

  final VoidCallback onOpenGenerate;
  final ValueChanged<String> onStart;

  @override
  State<_IdeaLauncher> createState() => _IdeaLauncherState();
}

class _IdeaLauncherState extends State<_IdeaLauncher> {
  static const _examples = <String>[
    'University scheduling problems',
    'Healthcare appointment delays',
    'Public transport reliability',
  ];

  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _useExample(String value) {
    _controller
      ..text = value
      ..selection = TextSelection.collapsed(offset: value.length);

    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final hasText = _controller.text.trim().isNotEmpty;

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFFFFAFB), Color(0xFFF4FBF9)],
        ),
        border: Border.all(
          color: AppColors.primaryDark.withValues(alpha: .085),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .065),
            blurRadius: 30,
            offset: const Offset(0, 13),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 17),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SectionEyebrow(
              icon: Icons.auto_awesome_rounded,
              text: 'AI discovery prompt',
            ),
            const SizedBox(height: 9),
            Text(
              'What should Voxidence investigate?',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontSize: 23,
                height: 1.05,
                letterSpacing: -.6,
              ),
            ),
            const SizedBox(height: 7),
            const Text(
              'Type naturally or speak. Domain and evidence sources are resolved automatically by the backend.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 10.4,
                height: 1.48,
              ),
            ),
            const SizedBox(height: 13),
            Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFFFFFBFC), Color(0xFFF5FBF9)],
                ),
                borderRadius: BorderRadius.circular(21),
                border: Border.all(
                  color: hasText
                      ? AppColors.primary.withValues(alpha: .84)
                      : AppColors.borderStrong,
                  width: hasText ? 1.35 : 1,
                ),
              ),
              child: Column(
                children: [
                  TextField(
                    controller: _controller,
                    minLines: 4,
                    maxLines: 6,
                    maxLength: 2000,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      hintText: 'Describe the challenge in your own words...',
                      counterText: '',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: EdgeInsets.fromLTRB(15, 15, 15, 10),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(13, 0, 10, 10),
                    child: Row(
                      children: [
                        Text(
                          '${_controller.text.trim().isEmpty ? 0 : _controller.text.trim().split(RegExp(r'\s+')).length}/120 words',
                          style: const TextStyle(
                            color: AppColors.textMuted,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const Spacer(),
                        SizedBox(
                          width: 42,
                          height: 42,
                          child: OutlinedButton(
                            onPressed: widget.onOpenGenerate,
                            style: OutlinedButton.styleFrom(
                              padding: EdgeInsets.zero,
                              backgroundColor: Colors.white.withValues(
                                alpha: .78,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                            child: const Icon(Icons.mic_none_rounded, size: 18),
                          ),
                        ),
                        const SizedBox(width: 8),
                        FilledButton.icon(
                          onPressed: hasText
                              ? () => widget.onStart(_controller.text.trim())
                              : widget.onOpenGenerate,
                          icon: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                          ),
                          label: Text(
                            hasText ? 'Start discovery' : 'Open wizard',
                          ),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 42),
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 11),
            Row(
              children: [
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: 13,
                  color: AppColors.primaryDark,
                ),
                const SizedBox(width: 5),
                const Text(
                  'Try an example',
                  style: TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SizedBox(
                    height: 34,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _examples.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 6),
                      itemBuilder: (context, index) {
                        final example = _examples[index];

                        return ActionChip(
                          label: Text(
                            example,
                            style: const TextStyle(
                              fontSize: 8.1,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          side: BorderSide(
                            color: AppColors.primaryDark.withValues(alpha: .08),
                          ),
                          backgroundColor: Colors.white.withValues(alpha: .78),
                          onPressed: () => _useExample(example),
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricsSection extends StatelessWidget {
  const _MetricsSection({required this.summary});

  final UserSummary summary;

  @override
  Widget build(BuildContext context) {
    final items = <_MetricData>[
      _MetricData(
        index: '01',
        icon: Icons.lightbulb_outline_rounded,
        value: '${summary.ideasCount}',
        label: 'Ideas created',
        helper: 'Generated workspaces',
        route: '/normal/ideas',
        tint: const Color(0xFFFFF4F7),
        accent: AppColors.pinkDeep,
      ),
      _MetricData(
        index: '02',
        icon: Icons.verified_outlined,
        value: '${summary.ideasCount}',
        label: 'Validated ideas',
        helper: 'Passed quality checks',
        route: '/normal/ideas',
        tint: const Color(0xFFF2FAF9),
        accent: AppColors.primaryDark,
      ),
      _MetricData(
        index: '03',
        icon: Icons.favorite_border_rounded,
        value: '${summary.favoriteIdeasCount}',
        label: 'Favorite ideas',
        helper: 'Ideas you saved',
        route: '/normal/favorites',
        tint: const Color(0xFFF7FAEF),
        accent: Color(0xFF6F8D54),
      ),
      _MetricData(
        index: '04',
        icon: summary.isPremium ? Icons.toll_rounded : Icons.public_rounded,
        value: summary.isPremium
            ? '${summary.creditBalance}'
            : '${summary.publishedIdeasCount}',
        label: summary.isPremium ? 'Premium credits' : 'Published ideas',
        helper: summary.isPremium ? 'Available to generate' : 'Shared publicly',
        route: summary.isPremium ? '/normal/credits' : '/normal/published',
        tint: const Color(0xFFFFF7E9),
        accent: Color(0xFFC38222),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionEyebrow(
          icon: Icons.insights_outlined,
          text: 'Workspace pulse',
        ),
        const SizedBox(height: 6),
        Text(
          'Your momentum',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            fontSize: 20,
            letterSpacing: -.45,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          summary.isPremium
              ? 'Premium activity and capacity at a glance.'
              : 'A live snapshot of your Voxidence workspace.',
          style: const TextStyle(color: AppColors.textMuted, fontSize: 9.2),
        ),
        const SizedBox(height: 9),
        GridView.builder(
          padding: EdgeInsets.zero,
          itemCount: items.length,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 1.18,
          ),
          itemBuilder: (context, index) => _MetricCard(data: items[index]),
        ),
      ],
    );
  }
}

class _MetricData {
  const _MetricData({
    required this.index,
    required this.icon,
    required this.value,
    required this.label,
    required this.helper,
    required this.route,
    required this.tint,
    required this.accent,
  });

  final String index;
  final IconData icon;
  final String value;
  final String label;
  final String helper;
  final String route;
  final Color tint;
  final Color accent;
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.data});

  final _MetricData data;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => Navigator.pushNamed(
          context,
          data.route,
          arguments: const <String, String>{
            'returnTitle': 'Home',
            'returnRoute': '/normal/dashboard',
          },
        ),
        child: Ink(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withValues(alpha: .97),
                data.tint.withValues(alpha: .90),
              ],
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: data.accent.withValues(alpha: .09)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .045),
                blurRadius: 18,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: Stack(
            children: [
              Positioned(
                right: -24,
                top: -28,
                child: _Glow(
                  size: 88,
                  color: data.accent.withValues(alpha: .10),
                ),
              ),
              Positioned(
                right: 11,
                top: 9,
                child: Text(
                  data.index,
                  style: TextStyle(
                    color: data.accent.withValues(alpha: .075),
                    fontSize: 25,
                    height: 1,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 33,
                      height: 33,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .88),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(data.icon, color: data.accent, size: 17),
                    ),
                    const Spacer(),
                    Text(
                      data.value,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 23,
                        height: 1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.7,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      data.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 9.2,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      data.helper,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 7.1,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Container(
                      height: 3,
                      decoration: BoxDecoration(
                        color: data.accent.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(99),
                      ),
                      alignment: Alignment.centerLeft,
                      child: FractionallySizedBox(
                        widthFactor: .58,
                        child: Container(
                          decoration: BoxDecoration(
                            color: data.accent.withValues(alpha: .50),
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveRunCard extends StatelessWidget {
  const _ActiveRunCard({required this.run});

  final Map<String, dynamic> run;

  @override
  Widget build(BuildContext context) {
    final id = '${run['id'] ?? run['runId'] ?? ''}';

    final stage =
        '${run['currentStageLabel'] ?? run['currentStageKey'] ?? 'Preparing your idea'}';

    final progress = _asDouble(run['progressPercent']).clamp(0, 100).toDouble();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(23),
        onTap: id.isEmpty
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => GenerationProgressPage(runId: id),
                ),
              ),
        child: Ink(
          padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFFFDFC), Color(0xFFF2FAF9)],
            ),
            borderRadius: BorderRadius.circular(23),
            border: Border.all(color: AppColors.primary.withValues(alpha: .18)),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .07),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 45,
                height: 45,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF67C5BF), Color(0xFF4DAEA9)],
                  ),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Icon(
                  Icons.wifi_tethering_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'GENERATION IN PROGRESS',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 7.8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .8,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      stage,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 10.9,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 7),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: LinearProgressIndicator(
                        value: progress / 100,
                        minHeight: 5,
                        color: AppColors.primary,
                        backgroundColor: AppColors.primary.withValues(
                          alpha: .10,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                children: [
                  Text(
                    '${progress.round()}%',
                    style: const TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  const Icon(
                    Icons.arrow_forward_rounded,
                    size: 17,
                    color: AppColors.primaryDark,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LatestWorkspaceSection extends StatelessWidget {
  const _LatestWorkspaceSection({
    required this.summary,
    required this.onViewAll,
    required this.onGenerate,
  });

  final UserSummary summary;
  final VoidCallback onViewAll;
  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    final idea = summary.latestIdea;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionEyebrow(
                    icon: Icons.arrow_forward_rounded,
                    text: 'Continue building',
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Latest workspace',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontSize: 20,
                      letterSpacing: -.45,
                    ),
                  ),
                ],
              ),
            ),
            TextButton.icon(
              onPressed: onViewAll,
              iconAlignment: IconAlignment.end,
              icon: const Icon(Icons.arrow_forward_rounded, size: 14),
              label: const Text('View all'),
              style: TextButton.styleFrom(
                textStyle: const TextStyle(
                  fontSize: 9.4,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (idea == null || idea.isEmpty)
          _EmptyLatest(onGenerate: onGenerate)
        else
          _LatestIdeaCard(idea: idea, premium: summary.isPremium),
      ],
    );
  }
}

class _EmptyLatest extends StatelessWidget {
  const _EmptyLatest({required this.onGenerate});

  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFF4FBF9), Color(0xFFFFF6F8)],
        ),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
      ),
      child: Column(
        children: [
          const _MiniOrbitVisual(icon: Icons.lightbulb_outline_rounded),
          const SizedBox(height: 13),
          Text(
            'Your next validated idea starts here',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 6),
          const Text(
            'Describe a repeated real-world pain and Voxidence will turn evidence into one focused software direction.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 13),
          FilledButton.icon(
            onPressed: onGenerate,
            icon: const Icon(Icons.rocket_launch_rounded, size: 17),
            label: const Text('Start discovering'),
          ),
        ],
      ),
    );
  }
}

class _LatestIdeaCard extends StatelessWidget {
  const _LatestIdeaCard({required this.idea, required this.premium});

  final Map<String, dynamic> idea;
  final bool premium;

  @override
  Widget build(BuildContext context) {
    final id = '${idea['id'] ?? ''}';
    final title = '${idea['title'] ?? 'Untitled idea'}';
    final abstract =
        '${idea['limitedAbstract'] ?? idea['partialAbstract'] ?? idea['fullAbstract'] ?? idea['problemStatement'] ?? ''}';
    final unlocked = idea['isUnlocked'] == true;
    final domain = idea['domain'] is Map
        ? '${(idea['domain'] as Map)['name'] ?? 'General'}'
        : '${idea['domainName'] ?? 'General'}';
    final createdAt = DateTime.tryParse('${idea['createdAt'] ?? ''}');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: id.isEmpty
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => IdeaWorkspacePage(ideaId: id),
                ),
              ),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFFFDFC), Color(0xFFFFF9FA), Color(0xFFF2FAF8)],
            ),
            border: Border.all(
              color: AppColors.primaryDark.withValues(alpha: .08),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primaryDeep.withValues(alpha: .055),
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Stack(
              children: [
                Positioned(
                  right: -40,
                  top: -50,
                  child: SizedBox(
                    width: 155,
                    height: 155,
                    child: CustomPaint(painter: _EditorialIdeaOrbPainter()),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(15, 14, 15, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const _SectionEyebrow(
                        icon: Icons.auto_awesome_rounded,
                        text: 'Latest validated idea',
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          StatusChip(
                            label: domain,
                            icon: Icons.category_outlined,
                          ),
                          const SizedBox(width: 6),
                          StatusChip(
                            label: unlocked ? 'FULL WORKSPACE' : 'NORMAL',
                            icon: unlocked
                                ? Icons.verified_outlined
                                : Icons.lock_outline_rounded,
                            positive: unlocked,
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 315),
                        child: Text(
                          title,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(
                                fontSize: 17,
                                height: 1.12,
                                letterSpacing: -.25,
                              ),
                        ),
                      ),
                      if (createdAt != null) ...[
                        const SizedBox(height: 7),
                        Row(
                          children: [
                            const Icon(
                              Icons.calendar_month_outlined,
                              color: AppColors.textMuted,
                              size: 12.5,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              'Created ${_date(createdAt)}',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 8.2,
                              ),
                            ),
                          ],
                        ),
                      ],
                      if (abstract.trim().isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text(
                          abstract,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 9.25,
                            height: 1.42,
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: unlocked
                              ? AppColors.primarySoft.withValues(alpha: .50)
                              : Colors.white.withValues(alpha: .68),
                          borderRadius: BorderRadius.circular(15),
                          border: Border.all(
                            color: AppColors.primaryDark.withValues(alpha: .07),
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 31,
                              height: 31,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .82),
                                borderRadius: BorderRadius.circular(11),
                              ),
                              child: Icon(
                                unlocked
                                    ? Icons.verified_outlined
                                    : Icons.arrow_outward_rounded,
                                size: 15,
                                color: AppColors.primaryDark,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    unlocked
                                        ? 'Advanced workspace ready'
                                        : 'Continue building this idea',
                                    style: const TextStyle(
                                      color: AppColors.textPrimary,
                                      fontSize: 9.2,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    unlocked
                                        ? premium
                                              ? 'Advanced outputs and eligible AI Chat remain available.'
                                              : 'Your unlocked outputs remain available.'
                                        : 'Open the workspace whenever you are ready.',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: AppColors.textMuted,
                                      fontSize: 7.7,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(
                              Icons.arrow_forward_rounded,
                              size: 16,
                              color: AppColors.primaryDark,
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

class _EditorialIdeaOrbPainter extends CustomPainter {
  const _EditorialIdeaOrbPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width * .56, size.height * .48);

    canvas.drawCircle(
      center,
      70,
      Paint()..color = AppColors.primary.withValues(alpha: .045),
    );

    for (final radius in [29.0, 45.0, 61.0]) {
      canvas.drawCircle(
        center,
        radius,
        Paint()
          ..color = AppColors.primaryDark.withValues(alpha: .095)
          ..style = PaintingStyle.stroke
          ..strokeWidth = .8,
      );
    }

    final nodes = [
      Offset(center.dx - 45, center.dy + 12),
      Offset(center.dx + 36, center.dy - 34),
      Offset(center.dx + 49, center.dy + 28),
    ];

    for (var i = 0; i < nodes.length; i++) {
      canvas.drawCircle(
        nodes[i],
        3.2,
        Paint()
          ..color = i == 1
              ? AppColors.pink.withValues(alpha: .82)
              : AppColors.primary.withValues(alpha: .72),
      );
    }

    final diamond = Path()
      ..moveTo(center.dx, center.dy - 8)
      ..lineTo(center.dx + 8, center.dy)
      ..lineTo(center.dx, center.dy + 8)
      ..lineTo(center.dx - 8, center.dy)
      ..close();

    canvas.drawPath(
      diamond,
      Paint()..color = AppColors.primary.withValues(alpha: .30),
    );
  }

  @override
  bool shouldRepaint(covariant _EditorialIdeaOrbPainter oldDelegate) => false;
}

class _MiniOrbitVisual extends StatelessWidget {
  const _MiniOrbitVisual({
    required this.icon,
    // ignore: unused_element_parameter
    this.inverted = false,
  });

  final IconData icon;
  final bool inverted;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 74,
      height: 74,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: inverted
            ? Colors.white.withValues(alpha: .12)
            : AppColors.primarySoft,
        border: Border.all(
          color: inverted
              ? Colors.white.withValues(alpha: .30)
              : AppColors.primaryDark.withValues(alpha: .10),
        ),
        boxShadow: [
          BoxShadow(
            color: inverted
                ? Colors.white.withValues(alpha: .12)
                : AppColors.primary.withValues(alpha: .11),
            blurRadius: 24,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Container(
        width: 49,
        height: 49,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: inverted
              ? Colors.white.withValues(alpha: .14)
              : Colors.white.withValues(alpha: .86),
          border: Border.all(
            color: inverted
                ? Colors.white.withValues(alpha: .34)
                : Colors.white,
          ),
        ),
        child: Icon(
          icon,
          color: inverted ? Colors.white : AppColors.primaryDark,
          size: 23,
        ),
      ),
    );
  }
}

class _AboutSection extends StatelessWidget {
  const _AboutSection();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(17, 18, 17, 17),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFFFF9FA), Color(0xFFF3FAF8)],
        ),
        border: Border.all(color: AppColors.primaryDark.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .055),
            blurRadius: 25,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionEyebrow(
            icon: Icons.auto_awesome_rounded,
            text: 'About Voxidence',
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 66,
                height: 66,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF72CAC4), Color(0xFF4DAFA9)],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.primary.withValues(alpha: .18),
                      blurRadius: 22,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.psychology_alt_rounded,
                  color: Colors.white,
                  size: 31,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Text(
                  'AI that starts with real community needs.',
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontSize: 18, height: 1.12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Voxidence collects public signals, analyzes repeated problems with NLP, compares multiple AI-generated candidates, and returns one structured, validated software opportunity.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.1,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 13),
          const _AboutPoint(
            icon: Icons.verified_outlined,
            text: 'Evidence-driven discovery',
          ),
          const _AboutPoint(
            icon: Icons.shield_outlined,
            text: 'Safe public publication',
          ),
          const _AboutPoint(
            icon: Icons.psychology_alt_outlined,
            text: 'Multi-model evaluation',
          ),
        ],
      ),
    );
  }
}

class _AboutPoint extends StatelessWidget {
  const _AboutPoint({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, color: AppColors.primary, size: 16),
          const SizedBox(width: 8),
          Text(
            text,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10.1,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContactSection extends StatefulWidget {
  const _ContactSection({required this.summary});

  final UserSummary summary;

  @override
  State<_ContactSection> createState() => _ContactSectionState();
}

class _ContactSectionState extends State<_ContactSection> {
  final TextEditingController _subject = TextEditingController();
  final TextEditingController _message = TextEditingController();

  bool _sending = false;
  String _notice = '';
  bool _noticeError = false;

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_sending) return;

    final subject = _subject.text.trim();
    final message = _message.text.trim();

    if (subject.length < 3 || message.length < 10) {
      setState(() {
        _notice =
            'Please enter a subject and a little more detail in your message.';
        _noticeError = true;
      });
      return;
    }

    setState(() {
      _sending = true;
      _notice = '';
    });

    try {
      await UserApi.instance.sendContactMessage(
        fullName: widget.summary.fullName,
        email: widget.summary.email,
        subject: subject,
        message: message,
      );

      if (!mounted) return;

      _subject.clear();
      _message.clear();

      setState(() {
        _notice = 'Your message was sent to the Voxidence team successfully.';
        _noticeError = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;

      setState(() {
        _notice = error.message;
        _noticeError = true;
      });
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(17, 18, 17, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFFDFC), Color(0xFFFFF9FA)],
        ),
        border: Border.all(color: AppColors.pinkDeep.withValues(alpha: .08)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 22,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionEyebrow(
            icon: Icons.message_outlined,
            text: 'Contact us',
            rose: true,
          ),
          const SizedBox(height: 8),
          Text(
            'Need help or have feedback?',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontSize: 20,
              letterSpacing: -.4,
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'Send a note directly to the Voxidence team.',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 9.8,
              height: 1.42,
            ),
          ),
          const SizedBox(height: 15),
          const _FieldLabel('Subject'),
          const SizedBox(height: 6),
          TextField(
            controller: _subject,
            maxLength: 150,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'How can we help?',
              counterText: '',
              filled: true,
              fillColor: Colors.white.withValues(alpha: .78),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 14,
              ),
            ),
          ),
          const SizedBox(height: 5),
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              '${_subject.text.length}/150',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 8),
            ),
          ),
          const SizedBox(height: 10),
          const _FieldLabel('Message'),
          const SizedBox(height: 6),
          TextField(
            controller: _message,
            minLines: 4,
            maxLines: 6,
            maxLength: 2000,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Describe your question or feedback...',
              counterText: '',
              filled: true,
              fillColor: Colors.white.withValues(alpha: .78),
              contentPadding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
            ),
          ),
          const SizedBox(height: 5),
          Align(
            alignment: Alignment.centerRight,
            child: Text(
              '${_message.text.length}/2000',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 8),
            ),
          ),
          if (widget.summary.email.isNotEmpty) ...[
            const SizedBox(height: 9),
            Row(
              children: [
                const Icon(
                  Icons.mail_outline_rounded,
                  size: 13,
                  color: AppColors.textMuted,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    'Reply will be sent to ${widget.summary.email}',
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 8.5,
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (_notice.isNotEmpty) ...[
            const SizedBox(height: 10),
            InlineNotice(
              icon: _noticeError
                  ? Icons.error_outline_rounded
                  : Icons.check_circle_outline_rounded,
              message: _notice,
              error: _noticeError,
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _sending ? null : _send,
              icon: _sending
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_rounded, size: 16),
              label: Text(_sending ? 'Sending...' : 'Send message'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 9.6,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

class _SectionEyebrow extends StatelessWidget {
  const _SectionEyebrow({
    required this.icon,
    required this.text,
    this.rose = false,
  });

  final IconData icon;
  final String text;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final color = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Row(
      children: [
        Icon(icon, size: 12.5, color: color),
        const SizedBox(width: 6),
        Text(
          text.toUpperCase(),
          style: TextStyle(
            color: color,
            fontSize: 8.2,
            fontWeight: FontWeight.w900,
            letterSpacing: .78,
          ),
        ),
      ],
    );
  }
}

class _Reveal extends StatelessWidget {
  const _Reveal({required this.child, required this.delay});

  final Widget child;
  final int delay;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: Duration(milliseconds: 620 + delay),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        final normalized = ((value * (620 + delay) - delay) / 620)
            .clamp(0.0, 1.0)
            .toDouble();

        return Opacity(
          opacity: normalized,
          child: Transform.translate(
            offset: Offset(0, 20 * (1 - normalized)),
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}

class _ConnectionState extends StatelessWidget {
  const _ConnectionState({required this.error, required this.onRetry});

  final Object? error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 30, 20, 28),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        color: AppColors.surface.withValues(alpha: .94),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .07),
            blurRadius: 26,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primarySoft,
            ),
            child: const Icon(
              Icons.cloud_off_rounded,
              color: AppColors.primaryDark,
              size: 28,
            ),
          ),
          const SizedBox(height: 15),
          Text(
            'Workspace connection needs attention',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 7),
          Text(
            error?.toString() ??
                'Voxidence could not load your authenticated workspace.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10.5,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 15),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 17),
            label: const Text('Reconnect'),
          ),
        ],
      ),
    );
  }
}

double _asDouble(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse('$value') ?? 0;
}

String _date(DateTime value) {
  final local = value.toLocal();

  const months = [
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

  return '${months[local.month - 1]} ${local.day}, ${local.year}';
}
