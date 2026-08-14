// Reusable mobile workspace UI components.
//
// The animated pearl/mint/rose background is intentionally lightweight and
// shared across the authenticated workspace so Dashboard, Discover, Generate,
// My Ideas and Profile feel like one coherent Voxidence product.
//
// @author Eman

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../models/user_models.dart';
import '../state/user_session_controller.dart';


class WorkspaceReturnTarget {
  const WorkspaceReturnTarget({
    required this.title,
    required this.route,
  });

  final String title;
  final String route;
}

WorkspaceReturnTarget workspaceReturnTarget(
  BuildContext context, {
  String fallbackTitle = 'Profile',
  String fallbackRoute = '/normal/profile',
}) {
  final arguments = ModalRoute.of(context)?.settings.arguments;

  if (arguments is Map) {
    final rawTitle = arguments['returnTitle']?.toString().trim() ?? '';
    final rawRoute = arguments['returnRoute']?.toString().trim() ?? '';

    return WorkspaceReturnTarget(
      title: rawTitle.isEmpty ? fallbackTitle : rawTitle,
      route: rawRoute.isEmpty ? fallbackRoute : rawRoute,
    );
  }

  return WorkspaceReturnTarget(
    title: fallbackTitle,
    route: fallbackRoute,
  );
}

void returnFromWorkspacePage(
  BuildContext context, {
  String fallbackTitle = 'Profile',
  String fallbackRoute = '/normal/profile',
}) {
  final navigator = Navigator.of(context);

  if (navigator.canPop()) {
    navigator.pop();
    return;
  }

  final target = workspaceReturnTarget(
    context,
    fallbackTitle: fallbackTitle,
    fallbackRoute: fallbackRoute,
  );

  navigator.pushNamedAndRemoveUntil(
    target.route,
    (route) => route.isFirst,
  );
}

class WorkspaceBackground extends StatefulWidget {
  const WorkspaceBackground({super.key, required this.child});

  final Widget child;

  @override
  State<WorkspaceBackground> createState() => _WorkspaceBackgroundState();
}

/// Ambient pearl/mint/rose workspace background.
///
/// Motion is intentionally slow so the interface feels alive without competing
/// with reading or touch interactions.
class _WorkspaceBackgroundState extends State<WorkspaceBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 14),
  )..repeat();

  @override
  void dispose() {
    _ambient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFFFFDFC),
            Color(0xFFFBFAF7),
            Color(0xFFF5FBF9),
            Color(0xFFFFFAFB),
          ],
          stops: [0, .34, .70, 1],
        ),
      ),
      child: AnimatedBuilder(
        animation: _ambient,
        child: widget.child,
        builder: (context, child) {
          final t = _ambient.value * math.pi * 2;

          return Stack(
            children: [
              Positioned(
                top: -112 + (math.sin(t) * 13),
                right: -78 + (math.cos(t * .7) * 11),
                child: const _AmbientGlow(size: 236, color: Color(0x35A9DDD6)),
              ),
              Positioned(
                top: 215 + (math.cos(t * .8) * 17),
                left: -118 + (math.sin(t * .65) * 12),
                child: const _AmbientGlow(size: 244, color: Color(0x2CF3C9D3)),
              ),
              Positioned(
                bottom: 55 + (math.sin(t * .55) * 20),
                right: -126 + (math.cos(t * .62) * 12),
                child: const _AmbientGlow(size: 230, color: Color(0x24DCE8E2)),
              ),
              Positioned.fill(
                child: IgnorePointer(
                  child: CustomPaint(
                    painter: _WorkspaceAmbientPainter(progress: _ambient.value),
                  ),
                ),
              ),
              Positioned.fill(child: child!),
            ],
          );
        },
      ),
    );
  }
}

class _AmbientGlow extends StatelessWidget {
  const _AmbientGlow({required this.size, required this.color});

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

class _WorkspaceAmbientPainter extends CustomPainter {
  const _WorkspaceAmbientPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final curvePaint = Paint()
      ..color = AppColors.primary.withValues(alpha: .075)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.15
      ..strokeCap = StrokeCap.round;

    final path = Path()
      ..moveTo(-20, size.height * .18)
      ..cubicTo(
        size.width * .20,
        size.height * .11,
        size.width * .28,
        size.height * .31,
        size.width * .47,
        size.height * .22,
      )
      ..cubicTo(
        size.width * .68,
        size.height * .12,
        size.width * .79,
        size.height * .31,
        size.width + 20,
        size.height * .19,
      );

    canvas.drawPath(path, curvePaint);

    final pulse = (math.sin(progress * math.pi * 2) + 1) / 2;
    final dots = <Offset>[
      Offset(size.width * .18, size.height * .16),
      Offset(size.width * .42, size.height * .235),
      Offset(size.width * .78, size.height * .205),
    ];

    for (var i = 0; i < dots.length; i++) {
      final alpha = .10 + (pulse * .08);
      canvas.drawCircle(
        dots[i],
        5.5,
        Paint()
          ..color = (i == 1 ? AppColors.pink : AppColors.primary).withValues(
            alpha: alpha,
          ),
      );
      canvas.drawCircle(
        dots[i],
        1.7,
        Paint()
          ..color = (i == 1 ? AppColors.pink : AppColors.primaryDark)
              .withValues(alpha: .42),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _WorkspaceAmbientPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class VoxCard extends StatelessWidget {
  const VoxCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.tint,
    this.radius = 22,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? tint;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final decoration = BoxDecoration(
      color: tint ?? AppColors.surface.withValues(alpha: 0.95),
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: Colors.white.withValues(alpha: 0.92)),
      boxShadow: [
        BoxShadow(
          color: AppColors.primaryDeep.withValues(alpha: 0.055),
          blurRadius: 26,
          offset: const Offset(0, 10),
        ),
      ],
    );

    if (onTap == null) {
      return Container(padding: padding, decoration: decoration, child: child);
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: Ink(padding: padding, decoration: decoration, child: child),
      ),
    );
  }
}

class WorkspacePageHeader extends StatelessWidget {
  const WorkspacePageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.eyebrow,
    this.trailing,
    this.icon,
    this.onBack,
  });

  final String title;
  final String? subtitle;
  final String? eyebrow;
  final Widget? trailing;
  final IconData? icon;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onBack != null) ...[
          Material(
            color: Colors.white.withValues(alpha: .74),
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: onBack,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(
                  Icons.arrow_back_ios_new_rounded,
                  size: 16,
                  color: AppColors.primaryDeep,
                ),
              ),
            ),
          ),
          const SizedBox(width: 11),
        ] else if (icon != null) ...[
          SoftIconBadge(icon: icon!, size: 42),
          const SizedBox(width: 11),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (eyebrow != null) ...[
                Text(
                  eyebrow!.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.primaryDark,
                    fontSize: 9.2,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.15,
                  ),
                ),
                const SizedBox(height: 5),
              ],
              Text(title, style: Theme.of(context).textTheme.headlineSmall),
              if (subtitle != null) ...[
                const SizedBox(height: 5),
                Text(subtitle!, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 12), trailing!],
      ],
    );
  }
}

class SectionHeading extends StatelessWidget {
  const SectionHeading({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              if (subtitle != null) ...[
                const SizedBox(height: 3),
                Text(subtitle!, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ],
          ),
        ),
        ?trailing,
      ],
    );
  }
}

class SoftIconBadge extends StatelessWidget {
  const SoftIconBadge({
    super.key,
    required this.icon,
    this.rose = false,
    this.size = 42,
  });

  final IconData icon;
  final bool rose;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: rose ? AppColors.pinkSoft : AppColors.primarySoft,
        borderRadius: BorderRadius.circular(size * .34),
      ),
      child: Icon(
        icon,
        color: rose ? AppColors.pinkDeep : AppColors.primaryDark,
        size: size * .46,
      ),
    );
  }
}

class MetricPill extends StatelessWidget {
  const MetricPill({
    super.key,
    required this.icon,
    required this.value,
    required this.label,
    this.accent = AppColors.primary,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: accent, size: 17),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 16.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 9.8,
                    fontWeight: FontWeight.w700,
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

class AccountTierBadge extends StatelessWidget {
  const AccountTierBadge({
    super.key,
    required this.isPremium,
    this.compact = true,
  });

  final bool isPremium;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final session = UserSessionController.instance;

    return AnimatedBuilder(
      animation: session,
      builder: (context, _) {
        final summary = session.summary;

        if (isPremium) {
          return PremiumBadge(
            compact: compact,
            credits: summary?.creditBalance,
          );
        }

        final remaining = summary?.remainingFreeGenerations;

        return _MembershipBadge(
          compact: compact,
          premium: false,
          title: 'Normal',
          subtitle: remaining == null
              ? 'free workspace'
              : compact
                  ? '$remaining free left'
                  : '$remaining free ${remaining == 1 ? 'idea' : 'ideas'} remaining',
        );
      },
    );
  }
}

/// Refined Premium membership seal.
///
/// The badge intentionally avoids the old diamond-heavy treatment. It uses a
/// quiet mint membership seal and surfaces the remaining credit balance so the
/// user can understand account access without opening the Credits page.
///
/// @author Eman
class PremiumBadge extends StatelessWidget {
  const PremiumBadge({
    super.key,
    this.compact = false,
    this.credits,
  });

  final bool compact;
  final int? credits;

  @override
  Widget build(BuildContext context) {
    final value = credits;

    return _MembershipBadge(
      compact: compact,
      premium: true,
      title: 'Premium',
      subtitle: value == null
          ? 'member access'
          : compact
              ? '$value credits'
              : '$value ${value == 1 ? 'credit' : 'credits'} remaining',
    );
  }
}

class _MembershipBadge extends StatelessWidget {
  const _MembershipBadge({
    required this.compact,
    required this.premium,
    required this.title,
    required this.subtitle,
  });

  final bool compact;
  final bool premium;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final accent = premium
        ? const Color(0xFF3D8985)
        : const Color(0xFF657B73);

    return Container(
      padding: EdgeInsets.fromLTRB(
        compact ? 5 : 6,
        compact ? 4 : 5,
        compact ? 9 : 11,
        compact ? 4 : 5,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: premium
              ? const [
                  Color(0xFFFFFFFF),
                  Color(0xFFF0F8F5),
                  Color(0xFFFFFAFB),
                ]
              : const [
                  Color(0xFFFFFFFF),
                  Color(0xFFF4F8F6),
                ],
        ),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: accent.withValues(alpha: premium ? .16 : .12),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDeep.withValues(alpha: .045),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _MembershipSeal(
            premium: premium,
            size: compact ? 26 : 30,
          ),
          SizedBox(width: compact ? 7 : 8),
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: compact ? 9.2 : 10.3,
                  height: 1,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.10,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: premium
                      ? const Color(0xFF6C837C)
                      : AppColors.textMuted,
                  fontSize: compact ? 5.8 : 6.3,
                  height: 1,
                  fontWeight: FontWeight.w800,
                  letterSpacing: .18,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MembershipSeal extends StatelessWidget {
  const _MembershipSeal({
    required this.premium,
    required this.size,
  });

  final bool premium;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: premium
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFF73C7C0),
                  Color(0xFF4FA7A2),
                  Color(0xFF3E8581),
                ],
              )
            : const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFE9F3EF),
                  Color(0xFFDCEAE4),
                ],
              ),
        borderRadius: BorderRadius.circular(size * .40),
        border: Border.all(
          color: Colors.white.withValues(alpha: .88),
          width: 1,
        ),
        boxShadow: premium
            ? [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: .12),
                  blurRadius: 7,
                  offset: const Offset(0, 3),
                ),
              ]
            : null,
      ),
      alignment: Alignment.center,
      child: Icon(
        premium
            ? Icons.auto_awesome_rounded
            : Icons.explore_outlined,
        size: size * .47,
        color: premium ? Colors.white : AppColors.primaryDark,
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({
    super.key,
    required this.label,
    this.icon,
    this.rose = false,
    this.positive = false,
  });

  final String label;
  final IconData? icon;
  final bool rose;
  final bool positive;

  @override
  Widget build(BuildContext context) {
    final foreground = positive
        ? AppColors.success
        : rose
        ? AppColors.pinkDeep
        : AppColors.primaryDark;
    final background = positive
        ? AppColors.success.withValues(alpha: .11)
        : rose
        ? AppColors.pinkSoft
        : AppColors.primarySoft;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, color: foreground, size: 11.5),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 9.2,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class FeatureTile extends StatelessWidget {
  const FeatureTile({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.rose = false,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool rose;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          child: Row(
            children: [
              SoftIconBadge(icon: icon, rose: rose, size: 38),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 12.8,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 7),
              trailing ??
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppColors.textMuted,
                    size: 20,
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

class InlineNotice extends StatelessWidget {
  const InlineNotice({
    super.key,
    required this.message,
    this.icon = Icons.info_outline_rounded,
    this.error = false,
    this.action,
    this.title,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final IconData icon;
  final bool error;
  final Widget? action;
  final String? title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final accent = error ? AppColors.danger : AppColors.primaryDark;
    final background = error
        ? AppColors.pinkSoft.withValues(alpha: .88)
        : AppColors.primarySoft.withValues(alpha: .85);
    final effectiveAction =
        action ??
        (actionLabel != null && onAction != null
            ? TextButton(
                onPressed: onAction,
                style: TextButton.styleFrom(
                  foregroundColor: accent,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 4,
                  ),
                  minimumSize: const Size(0, 30),
                ),
                child: Text(actionLabel!),
              )
            : null);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: .12)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, color: accent, size: 17),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (title != null) ...[
                  Text(
                    title!,
                    style: TextStyle(
                      color: accent,
                      fontSize: 10.8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                ],
                Text(
                  message,
                  style: TextStyle(
                    color: accent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          if (effectiveAction != null) ...[
            const SizedBox(width: 8),
            effectiveAction,
          ],
        ],
      ),
    );
  }
}

class IdeaMobileCard extends StatelessWidget {
  const IdeaMobileCard({
    super.key,
    required this.idea,
    required this.onTap,
    this.onFavoriteTap,
  });

  final IdeaSummary idea;
  final VoidCallback onTap;
  final VoidCallback? onFavoriteTap;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              StatusChip(
                label: idea.isPremiumGenerated ? 'Premium' : 'Free',
                icon: idea.isPremiumGenerated
                    ? Icons.bolt_rounded
                    : Icons.eco_outlined,
              ),
              const SizedBox(width: 7),
              if (idea.isUnlocked)
                const StatusChip(
                  label: 'Advanced',
                  icon: Icons.lock_open_rounded,
                  rose: true,
                ),
              const Spacer(),
              if (onFavoriteTap != null)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: idea.isFavorite ? 'Remove favorite' : 'Add favorite',
                  onPressed: onFavoriteTap,
                  icon: Icon(
                    idea.isFavorite
                        ? Icons.favorite_rounded
                        : Icons.favorite_border_rounded,
                    color: idea.isFavorite
                        ? AppColors.pink
                        : AppColors.textMuted,
                    size: 18.5,
                  ),
                )
              else if (idea.isFavorite)
                const Icon(
                  Icons.favorite_rounded,
                  color: AppColors.pink,
                  size: 18,
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            idea.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (idea.abstractText.trim().isNotEmpty) ...[
            const SizedBox(height: 7),
            Text(
              idea.abstractText,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(
                Icons.grid_view_rounded,
                size: 13,
                color: AppColors.primaryDark,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  idea.domainName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textMuted,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Icon(
                Icons.arrow_forward_rounded,
                color: AppColors.primaryDark,
                size: 16,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (index) => Padding(
          padding: const EdgeInsets.only(bottom: 11),
          child: Container(
            height: 108,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.68),
              borderRadius: BorderRadius.circular(21),
              border: Border.all(color: AppColors.border),
            ),
          ),
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return VoxCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Column(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: const BoxDecoration(
                color: AppColors.primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: AppColors.primaryDark, size: 24),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 5),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if (action != null) ...[const SizedBox(height: 13), action!],
          ],
        ),
      ),
    );
  }
}

void showAppSnackBar(
  BuildContext context,
  String message, {
  bool error = false,
}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        backgroundColor: error ? AppColors.danger : AppColors.primaryDeep,
        content: Text(message),
      ),
    );
}
