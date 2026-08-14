import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

/// Provides the shared background for administrative workspace pages.
///
/// The background intentionally uses only the existing Voxidence project
/// palette and avoids large dark areas or unrelated color gradients.
///
/// @author Eman
class AdminWorkspaceBackground extends StatelessWidget {
  const AdminWorkspaceBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(color: AppColors.background, child: child);
  }
}

/// Reusable card used throughout the administrative interface.
///
/// @author Eman
class AdminGlassCard extends StatelessWidget {
  const AdminGlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.tint,
    this.radius = 20,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? tint;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final decoration = BoxDecoration(
      color: tint ?? AppColors.surface,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.border),
      boxShadow: [
        BoxShadow(
          color: AppColors.primaryDark.withValues(alpha: .035),
          blurRadius: 18,
          offset: const Offset(0, 7),
        ),
      ],
    );

    if (onTap == null) {
      return Container(padding: padding, decoration: decoration, child: child);
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: Ink(padding: padding, decoration: decoration, child: child),
      ),
    );
  }
}

/// Reusable header displayed at the top of administrative pages.
///
/// @author Eman
class AdminPageHeader extends StatelessWidget {
  const AdminPageHeader({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    this.eyebrow,
    this.trailing,
    this.onBack,
  });

  final String title;

  final String subtitle;

  final IconData icon;

  final String? eyebrow;

  final Widget? trailing;

  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onBack != null) ...[
          _SquareIconButton(
            icon: Icons.arrow_back_ios_new_rounded,
            onTap: onBack!,
          ),
          const SizedBox(width: 10),
        ] else ...[
          AdminIconBadge(
            icon: icon,
            size: 43,
            tone: AppColors.primarySoft,
            iconColor: AppColors.primaryDark,
          ),
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
                    fontSize: 8.6,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 3),
              ],

              Text(
                title,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 23,
                  height: 1.06,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -.45,
                ),
              ),

              const SizedBox(height: 4),

              Text(
                subtitle,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 10.6,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),

        if (trailing != null) ...[const SizedBox(width: 8), trailing!],
      ],
    );
  }
}

/// Displays an icon inside a project-colored rounded badge.
///
/// @author Eman
class AdminIconBadge extends StatelessWidget {
  const AdminIconBadge({
    super.key,
    required this.icon,
    this.size = 42,
    this.tone = AppColors.primarySoft,
    this.iconColor = AppColors.primaryDark,
  });

  final IconData icon;

  final double size;

  final Color tone;

  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(size * .32),
        border: Border.all(color: AppColors.border.withValues(alpha: .76)),
      ),
      child: Icon(icon, size: size * .46, color: iconColor),
    );
  }
}

class _SquareIconButton extends StatelessWidget {
  const _SquareIconButton({required this.icon, required this.onTap});

  final IconData icon;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.border),
          ),
          child: Icon(icon, size: 16, color: AppColors.primaryDeep),
        ),
      ),
    );
  }
}

/// Displays a summarized administrative metric.
///
/// This component is retained for other admin pages that reuse it.
///
/// @author Eman
class AdminMetricCard extends StatelessWidget {
  const AdminMetricCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.meta,
    this.tone = AppColors.primarySoft,
    this.iconColor = AppColors.primaryDark,
  });

  final String label;

  final String value;

  final String? meta;

  final IconData icon;

  final Color tone;

  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AdminIconBadge(
                icon: icon,
                size: 36,
                tone: tone,
                iconColor: iconColor,
              ),

              const Spacer(),

              if (meta != null)
                Flexible(
                  child: Text(
                    meta!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),

          const SizedBox(height: 13),

          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 19,
              fontWeight: FontWeight.w900,
              letterSpacing: -.25,
            ),
          ),

          const SizedBox(height: 2),

          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// Displays an administrative resource status using a colored pill.
///
/// @author Eman
class AdminStatusChip extends StatelessWidget {
  const AdminStatusChip(this.value, {super.key});

  final String value;

  @override
  Widget build(BuildContext context) {
    final normalized = value.trim().toUpperCase();

    final (background, foreground) = switch (normalized) {
      'ACTIVE' ||
      'SUCCESS' ||
      'PAID' ||
      'RESOLVED' ||
      'REPLIED' ||
      'APPROVED' => (const Color(0xFFE8F7F0), AppColors.success),
      'FAILED' ||
      'BLOCKED' ||
      'REJECTED' ||
      'ARCHIVED' ||
      'CLOSED' => (AppColors.pinkSoft, AppColors.danger),
      'PENDING' ||
      'OPEN' ||
      'REVIEWING' ||
      'IN_PROGRESS' ||
      'PROCESSING' => (const Color(0xFFFFF5E8), AppColors.warning),
      _ => (AppColors.primarySoft, AppColors.primaryDark),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _readable(normalized),
        style: TextStyle(
          color: foreground,
          fontSize: 9.2,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }

  String _readable(String value) {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .split(' ')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }
}

/// Reusable search input for administrative list pages.
///
/// @author Eman
class AdminSearchField extends StatelessWidget {
  const AdminSearchField({
    super.key,
    required this.controller,
    required this.hint,
    this.onSubmitted,
    this.onChanged,
  });

  final TextEditingController controller;

  final String hint;

  final ValueChanged<String>? onSubmitted;

  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onSubmitted: onSubmitted,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded, size: 20),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                onPressed: () {
                  controller.clear();

                  onChanged?.call('');

                  onSubmitted?.call('');
                },
                icon: const Icon(Icons.close_rounded, size: 18),
              ),
      ),
    );
  }
}

/// Displays an empty, unavailable, or failed state for an admin page.
///
/// @author Eman
class AdminEmptyState extends StatelessWidget {
  const AdminEmptyState({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.onRetry,
  });

  final String title;

  final String message;

  final IconData icon;

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return AdminGlassCard(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: Column(
          children: [
            AdminIconBadge(icon: icon, size: 50),

            const SizedBox(height: 13),

            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),

            const SizedBox(height: 5),

            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 11.5,
                height: 1.45,
              ),
            ),

            if (onRetry != null) ...[
              const SizedBox(height: 14),

              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 17),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Displays placeholder cards while an administrative list is loading.
///
/// @author Eman
class AdminLoadingList extends StatelessWidget {
  const AdminLoadingList({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (index) => Padding(
          padding: const EdgeInsets.only(bottom: 11),
          child: AdminGlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 120 + index * 13,
                  height: 13,
                  decoration: BoxDecoration(
                    color: AppColors.mint.withValues(alpha: .75),
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),

                const SizedBox(height: 10),

                Container(
                  width: double.infinity,
                  height: 9,
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),

                const SizedBox(height: 7),

                Container(
                  width: 170,
                  height: 9,
                  decoration: BoxDecoration(
                    color: AppColors.primarySoft,
                    borderRadius: BorderRadius.circular(99),
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
