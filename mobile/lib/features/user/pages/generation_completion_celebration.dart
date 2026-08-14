// Premium-aware full-screen generation completion celebration.
//
// The countdown is intentionally card-free: it floats over a blurred view of
// the current workspace, then resolves into a compact mobile reveal. Premium
// runs receive richer motion, sparkle density, and glass highlights while
// Normal runs keep the same rhythm with a quieter finish.
//
// @author Eman

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

Future<bool?> showGenerationCompletionCelebration(
  BuildContext context, {
  required bool isPremium,
  required String ideaTitle,
}) {
  return showGeneralDialog<bool>(
    context: context,
    barrierDismissible: false,
    barrierLabel: 'Generation complete',
    barrierColor: Colors.transparent,
    transitionDuration: const Duration(milliseconds: 260),
    pageBuilder: (_, _, _) => _GenerationCompletionCelebration(
      isPremium: isPremium,
      ideaTitle: ideaTitle,
    ),
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      );

      return FadeTransition(
        opacity: curved,
        child: child,
      );
    },
  );
}

class _GenerationCompletionCelebration extends StatefulWidget {
  const _GenerationCompletionCelebration({
    required this.isPremium,
    required this.ideaTitle,
  });

  final bool isPremium;
  final String ideaTitle;

  @override
  State<_GenerationCompletionCelebration> createState() =>
      _GenerationCompletionCelebrationState();
}

class _GenerationCompletionCelebrationState
    extends State<_GenerationCompletionCelebration>
    with TickerProviderStateMixin {
  Timer? _countdownTimer;

  int _countdown = 3;
  bool _revealed = false;

  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: Duration(
      milliseconds: widget.isPremium ? 4300 : 5600,
    ),
  )..repeat();

  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 820),
  )..repeat(reverse: true);

  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 850),
  );

  @override
  void initState() {
    super.initState();

    _countdownTimer = Timer.periodic(
      const Duration(milliseconds: 900),
      (timer) {
        if (!mounted) return;

        if (_countdown <= 1) {
          timer.cancel();

          setState(() {
            _countdown = 0;
            _revealed = true;
          });

          _reveal.forward(from: 0);
          return;
        }

        setState(() {
          _countdown -= 1;
        });

        _pulse.forward(from: 0);
      },
    );
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _ambient.dispose();
    _pulse.dispose();
    _reveal.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final darkOverlay = widget.isPremium
        ? const Color(0xA92A3B38)
        : const Color(0x96313F3B);

    return PopScope(
      canPop: false,
      child: Material(
        color: Colors.transparent,
        child: AnimatedBuilder(
          animation: Listenable.merge([
            _ambient,
            _pulse,
            _reveal,
          ]),
          builder: (context, _) {
            return Stack(
              fit: StackFit.expand,
              children: [
                BackdropFilter(
                  filter: ui.ImageFilter.blur(
                    sigmaX: widget.isPremium ? 18 : 14,
                    sigmaY: widget.isPremium ? 18 : 14,
                  ),
                  child: ColoredBox(
                    color: darkOverlay,
                  ),
                ),

                _SoftGlow(
                  alignment: Alignment(
                    -.88 + .08 * math.sin(_ambient.value * math.pi * 2),
                    -.84,
                  ),
                  size: widget.isPremium ? 280 : 230,
                  color: AppColors.primary.withValues(
                    alpha: widget.isPremium ? .23 : .14,
                  ),
                ),

                _SoftGlow(
                  alignment: Alignment(
                    .92,
                    .78 + .07 * math.cos(_ambient.value * math.pi * 2),
                  ),
                  size: widget.isPremium ? 270 : 210,
                  color: AppColors.pink.withValues(
                    alpha: widget.isPremium ? .17 : .09,
                  ),
                ),

                if (widget.isPremium)
                  _SoftGlow(
                    alignment: Alignment(
                      .78,
                      -.65 + .08 * math.sin(_ambient.value * math.pi * 2),
                    ),
                    size: 170,
                    color: Colors.white.withValues(alpha: .09),
                  ),

                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(
                      painter: _CelebrationParticlesPainter(
                        progress: _ambient.value,
                        revealed: _revealed,
                        premium: widget.isPremium,
                      ),
                    ),
                  ),
                ),

                SafeArea(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 20,
                      ),
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 440),
                        reverseDuration: const Duration(milliseconds: 260),
                        switchInCurve: Curves.easeOutBack,
                        switchOutCurve: Curves.easeInCubic,
                        transitionBuilder: (child, animation) {
                          return FadeTransition(
                            opacity: animation,
                            child: ScaleTransition(
                              scale: Tween<double>(
                                begin: .94,
                                end: 1,
                              ).animate(animation),
                              child: child,
                            ),
                          );
                        },
                        child: _revealed
                            ? _RevealPanel(
                                key: const ValueKey('reveal'),
                                isPremium: widget.isPremium,
                                ideaTitle: widget.ideaTitle,
                                ambientValue: _ambient.value,
                                revealValue: _reveal.value,
                                onOpen: () {
                                  Navigator.of(context).pop(true);
                                },
                              )
                            : _CountdownMoment(
                                key: ValueKey(_countdown),
                                value: _countdown,
                                isPremium: widget.isPremium,
                                ambientValue: _ambient.value,
                                pulseValue: _pulse.value,
                              ),
                      ),
                    ),
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

class _CountdownMoment extends StatelessWidget {
  const _CountdownMoment({
    super.key,
    required this.value,
    required this.isPremium,
    required this.ambientValue,
    required this.pulseValue,
  });

  final int value;
  final bool isPremium;
  final double ambientValue;
  final double pulseValue;

  String get _eyebrow {
    return switch (value) {
      3 => 'EVIDENCE LOCKED',
      2 => 'SIGNALS ALIGNED',
      _ => 'READY TO REVEAL',
    };
  }

  String get _line {
    return switch (value) {
      3 => 'The strongest evidence made the cut.',
      2 => 'Your opportunity is taking its final shape.',
      _ => isPremium
          ? 'Your premium workspace is ready.'
          : 'Your validated idea is ready.',
    };
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final orbit = math.min(screen.width * .63, 248.0);
    final core = math.min(screen.width * .31, 118.0);

    final pulseScale = 1 + (.025 * pulseValue);

    return Semantics(
      liveRegion: true,
      label: '$_eyebrow. $value. $_line',
      child: Column(
        key: ValueKey(value),
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 11,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: Colors.white.withValues(alpha: .18),
              ),
            ),
            child: Text(
              _eyebrow,
              style: TextStyle(
                color: Colors.white.withValues(alpha: .88),
                fontSize: 8.2,
                fontWeight: FontWeight.w900,
                letterSpacing: 1.45,
              ),
            ),
          ),

          const SizedBox(height: 24),

          Transform.scale(
            scale: pulseScale,
            child: SizedBox(
              width: orbit,
              height: orbit,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Transform.rotate(
                    angle: ambientValue * math.pi * 2,
                    child: _OrbitRing(
                      size: orbit,
                      premium: isPremium,
                      strong: true,
                    ),
                  ),
                  Transform.rotate(
                    angle: -ambientValue * math.pi * 1.35,
                    child: _OrbitRing(
                      size: orbit * .76,
                      premium: isPremium,
                      strong: false,
                    ),
                  ),
                  if (isPremium)
                    Transform.rotate(
                      angle: ambientValue * math.pi * 2.7,
                      child: SizedBox(
                        width: orbit * .90,
                        height: orbit * .90,
                        child: const Stack(
                          children: [
                            Positioned(
                              top: 8,
                              right: 31,
                              child: _TinySpark(size: 13),
                            ),
                            Positioned(
                              left: 13,
                              bottom: 42,
                              child: _TinySpark(size: 9),
                            ),
                          ],
                        ),
                      ),
                    ),
                  Container(
                    width: core,
                    height: core,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withValues(
                        alpha: isPremium ? .15 : .11,
                      ),
                      border: Border.all(
                        color: Colors.white.withValues(
                          alpha: isPremium ? .32 : .22,
                        ),
                        width: 1.2,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withValues(
                            alpha: isPremium ? .36 : .22,
                          ),
                          blurRadius: isPremium ? 48 : 34,
                          spreadRadius: isPremium ? 5 : 2,
                        ),
                        if (isPremium)
                          BoxShadow(
                            color: AppColors.pink.withValues(alpha: .18),
                            blurRadius: 60,
                            spreadRadius: 8,
                          ),
                      ],
                    ),
                    child: Text(
                      '$value',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: isPremium ? 58 : 54,
                        height: .92,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -2.2,
                        shadows: [
                          Shadow(
                            color: AppColors.primary.withValues(alpha: .35),
                            blurRadius: 24,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 20),

          Text(
            value == 1
                ? (isPremium ? 'One last spark.' : 'Almost there.')
                : (isPremium ? 'Building something special.' : 'Almost ready.'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 15,
              height: 1.15,
              fontWeight: FontWeight.w900,
              letterSpacing: -.18,
            ),
          ),

          const SizedBox(height: 7),

          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 290),
            child: Text(
              _line,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white.withValues(alpha: .72),
                fontSize: 9.4,
                height: 1.45,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),

          const SizedBox(height: 18),

          Row(
            mainAxisSize: MainAxisSize.min,
            children: List.generate(3, (index) {
              final completed = index >= value - 1;

              return AnimatedContainer(
                duration: const Duration(milliseconds: 260),
                width: completed ? 24 : 12,
                height: 3,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: completed
                      ? Colors.white.withValues(alpha: .86)
                      : Colors.white.withValues(alpha: .22),
                  borderRadius: BorderRadius.circular(999),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

class _RevealPanel extends StatelessWidget {
  const _RevealPanel({
    super.key,
    required this.isPremium,
    required this.ideaTitle,
    required this.ambientValue,
    required this.revealValue,
    required this.onOpen,
  });

  final bool isPremium;
  final String ideaTitle;
  final double ambientValue;
  final double revealValue;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final width = math.min(screen.width - 28, 390.0);
    final titleSize = screen.width < 370 ? 18.0 : 19.5;

    final card = Container(
      width: width,
      constraints: BoxConstraints(
        maxHeight: math.max(390, screen.height - 48),
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(30),
        color: const Color(0xFFFDFDFB).withValues(alpha: .95),
        border: Border.all(
          color: Colors.white.withValues(alpha: .92),
          width: 1.25,
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF172A26).withValues(alpha: .28),
            blurRadius: 56,
            offset: const Offset(0, 22),
          ),
          if (isPremium)
            BoxShadow(
              color: AppColors.primary.withValues(alpha: .17),
              blurRadius: 70,
              spreadRadius: 3,
            ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: Stack(
          children: [
            Positioned(
              top: -86,
              right: -72,
              child: _PanelOrb(
                size: 190,
                color: AppColors.primary.withValues(
                  alpha: isPremium ? .17 : .09,
                ),
              ),
            ),
            Positioned(
              left: -62,
              bottom: -72,
              child: _PanelOrb(
                size: 150,
                color: AppColors.pink.withValues(
                  alpha: isPremium ? .10 : .05,
                ),
              ),
            ),
            if (isPremium)
              Positioned(
                top: -80,
                bottom: -80,
                left: -95 + (width + 190) * ambientValue,
                child: Transform.rotate(
                  angle: -.22,
                  child: Container(
                    width: 46,
                    color: Colors.white.withValues(alpha: .23),
                  ),
                ),
              ),

            SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(
                20,
                20,
                20,
                18,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ScaleTransitionLike(
                    value: revealValue,
                    child: _RevealMark(
                      premium: isPremium,
                      ambientValue: ambientValue,
                    ),
                  ),

                  const SizedBox(height: 13),

                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: isPremium
                          ? AppColors.primarySoft.withValues(alpha: .92)
                          : Colors.white.withValues(alpha: .72),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: isPremium
                            ? AppColors.primary.withValues(alpha: .16)
                            : AppColors.border.withValues(alpha: .82),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isPremium
                              ? Icons.auto_awesome_rounded
                              : Icons.verified_rounded,
                          size: 12,
                          color: AppColors.primaryDark,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          isPremium
                              ? 'PREMIUM WORKSPACE COMPLETE'
                              : 'VALIDATED IDEA READY',
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 7.8,
                            fontWeight: FontWeight.w900,
                            letterSpacing: .86,
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 13),

                  Text(
                    isPremium
                        ? 'Your idea just became a complete workspace.'
                        : 'Your strongest idea is ready.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: isPremium ? 17.5 : 16.5,
                      height: 1.12,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -.34,
                    ),
                  ),

                  const SizedBox(height: 8),

                  Text(
                    ideaTitle,
                    textAlign: TextAlign.center,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: AppColors.primaryDeep,
                      fontSize: titleSize,
                      height: 1.10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -.44,
                    ),
                  ),

                  const SizedBox(height: 9),

                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 310),
                    child: Text(
                      isPremium
                          ? 'Evidence, advanced outputs, and the execution layer are prepared and saved to your private workspace.'
                          : 'The evidence-backed result has been saved. Open the workspace to review the idea and its core outputs.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 9.3,
                        height: 1.45,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),

                  const SizedBox(height: 15),

                  if (isPremium)
                    const Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _RevealChip(
                          icon: Icons.layers_outlined,
                          label: 'Advanced outputs',
                        ),
                        _RevealChip(
                          icon: Icons.verified_user_outlined,
                          label: 'Evidence saved',
                        ),
                        _RevealChip(
                          icon: Icons.bolt_rounded,
                          label: 'Workspace ready',
                          rose: true,
                        ),
                      ],
                    )
                  else
                    const _RevealChip(
                      icon: Icons.check_circle_outline_rounded,
                      label: 'Validated & saved',
                    ),

                  const SizedBox(height: 17),

                  SizedBox(
                    width: double.infinity,
                    height: 47,
                    child: FilledButton.icon(
                      onPressed: onOpen,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        shadowColor: AppColors.primary.withValues(alpha: .22),
                        elevation: isPremium ? 3 : 0,
                      ),
                      icon: Icon(
                        isPremium
                            ? Icons.auto_awesome_rounded
                            : Icons.arrow_forward_rounded,
                        size: 17,
                      ),
                      label: Text(
                        isPremium
                            ? 'Enter premium workspace'
                            : 'Open idea workspace',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 9),

                  Text(
                    isPremium
                        ? 'A richer celebration for a complete premium generation.'
                        : 'Your generation is complete.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 7.8,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    return Transform.scale(
      scale: .96 + (.04 * Curves.easeOutBack.transform(revealValue)),
      child: Opacity(
        opacity: revealValue.clamp(0.0, 1.0).toDouble(),
        child: card,
      ),
    );
  }
}

class _RevealMark extends StatelessWidget {
  const _RevealMark({
    required this.premium,
    required this.ambientValue,
  });

  final bool premium;
  final double ambientValue;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: premium ? 78 : 68,
      height: premium ? 78 : 68,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (premium)
            Transform.rotate(
              angle: ambientValue * math.pi * 2,
              child: Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: AppColors.primary.withValues(alpha: .20),
                  ),
                ),
              ),
            ),
          Container(
            width: premium ? 58 : 54,
            height: premium ? 58 : 54,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(premium ? 20 : 18),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: premium
                    ? const [
                        Color(0xFF70CCC5),
                        Color(0xFF4DA9A3),
                        Color(0xFF3D8580),
                      ]
                    : const [
                        Color(0xFFE9F6F3),
                        Color(0xFFDCEBE6),
                      ],
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(
                    alpha: premium ? .28 : .12,
                  ),
                  blurRadius: premium ? 28 : 18,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Icon(
              premium
                  ? Icons.auto_awesome_rounded
                  : Icons.lightbulb_outline_rounded,
              color: premium ? Colors.white : AppColors.primaryDark,
              size: premium ? 27 : 25,
            ),
          ),
          if (premium)
            const Positioned(
              top: 1,
              right: 2,
              child: _TinySpark(
                size: 13,
                dark: true,
              ),
            ),
        ],
      ),
    );
  }
}

class _RevealChip extends StatelessWidget {
  const _RevealChip({
    required this.icon,
    required this.label,
    this.rose = false,
  });

  final IconData icon;
  final String label;
  final bool rose;

  @override
  Widget build(BuildContext context) {
    final foreground = rose ? AppColors.pinkDeep : AppColors.primaryDark;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 7,
      ),
      decoration: BoxDecoration(
        color: rose
            ? AppColors.pinkSoft.withValues(alpha: .84)
            : AppColors.primarySoft.withValues(alpha: .84),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: foreground.withValues(alpha: .10),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 11,
            color: foreground,
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontSize: 7.7,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _OrbitRing extends StatelessWidget {
  const _OrbitRing({
    required this.size,
    required this.premium,
    required this.strong,
  });

  final double size;
  final bool premium;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(
                    alpha: strong ? .18 : .11,
                  ),
                  width: strong ? 1.1 : .8,
                ),
              ),
            ),
          ),
          Positioned(
            top: strong ? 8 : 3,
            right: strong ? 24 : 18,
            child: Container(
              width: premium ? 7 : 5,
              height: premium ? 7 : 5,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: strong
                    ? AppColors.primary
                    : AppColors.pinkLight,
                boxShadow: [
                  BoxShadow(
                    color: Colors.white.withValues(alpha: .48),
                    blurRadius: 9,
                  ),
                ],
              ),
            ),
          ),
          if (premium && strong)
            const Positioned(
              left: 18,
              bottom: 36,
              child: _TinySpark(size: 10),
            ),
        ],
      ),
    );
  }
}

class _TinySpark extends StatelessWidget {
  const _TinySpark({
    required this.size,
    this.dark = false,
  });

  final double size;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Icon(
      Icons.auto_awesome_rounded,
      size: size,
      color: dark
          ? AppColors.pinkDeep
          : Colors.white.withValues(alpha: .90),
    );
  }
}

class _SoftGlow extends StatelessWidget {
  const _SoftGlow({
    required this.alignment,
    required this.size,
    required this.color,
  });

  final Alignment alignment;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(
              colors: [
                color,
                color.withValues(alpha: 0),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PanelOrb extends StatelessWidget {
  const _PanelOrb({
    required this.size,
    required this.color,
  });

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
          color: color,
        ),
      ),
    );
  }
}

class ScaleTransitionLike extends StatelessWidget {
  const ScaleTransitionLike({
    super.key,
    required this.value,
    required this.child,
  });

  final double value;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final curved = Curves.easeOutBack.transform(
      value.clamp(0.0, 1.0).toDouble(),
    );

    return Transform.scale(
      scale: .82 + (.18 * curved),
      child: Opacity(
        opacity: value.clamp(0.0, 1.0).toDouble(),
        child: child,
      ),
    );
  }
}

class _CelebrationParticlesPainter extends CustomPainter {
  const _CelebrationParticlesPainter({
    required this.progress,
    required this.revealed,
    required this.premium,
  });

  final double progress;
  final bool revealed;
  final bool premium;

  @override
  void paint(Canvas canvas, Size size) {
    final count = premium
        ? (revealed ? 46 : 29)
        : (revealed ? 20 : 12);

    final teal = AppColors.primary;
    final rose = AppColors.pinkLight;
    final white = Colors.white;
    final sage = AppColors.sage;

    for (var index = 0; index < count; index += 1) {
      final seed = index * 1.61803398875;
      final speed = premium
          ? .22 + ((index % 7) * .026)
          : .13 + ((index % 5) * .018);

      final normalizedY =
          (seed * .173 + progress * speed + (revealed ? .13 : 0)) % 1;

      final wave = math.sin(
        (progress * math.pi * 2) + seed,
      );

      final normalizedX =
          (seed * .347 + .5 + wave * (premium ? .045 : .025)) % 1;

      final point = Offset(
        normalizedX * size.width,
        normalizedY * size.height,
      );

      final color = switch (index % 4) {
        0 => white,
        1 => teal,
        2 => rose,
        _ => sage,
      };

      final alpha = premium
          ? .28 + ((index % 3) * .13)
          : .18 + ((index % 3) * .08);

      final paint = Paint()
        ..color = color.withValues(alpha: alpha)
        ..style = PaintingStyle.fill;

      if (premium && index % 5 == 0) {
        _drawSpark(
          canvas,
          point,
          2.8 + ((index % 4) * .8),
          paint,
        );
      } else {
        canvas.drawCircle(
          point,
          premium ? 1.5 + ((index % 3) * .55) : 1.2 + ((index % 2) * .45),
          paint,
        );
      }
    }
  }

  void _drawSpark(
    Canvas canvas,
    Offset center,
    double radius,
    Paint paint,
  ) {
    final path = Path()
      ..moveTo(center.dx, center.dy - radius)
      ..lineTo(center.dx + radius * .30, center.dy - radius * .28)
      ..lineTo(center.dx + radius, center.dy)
      ..lineTo(center.dx + radius * .30, center.dy + radius * .28)
      ..lineTo(center.dx, center.dy + radius)
      ..lineTo(center.dx - radius * .30, center.dy + radius * .28)
      ..lineTo(center.dx - radius, center.dy)
      ..lineTo(center.dx - radius * .30, center.dy - radius * .28)
      ..close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _CelebrationParticlesPainter oldDelegate) {
    return oldDelegate.progress != progress ||
        oldDelegate.revealed != revealed ||
        oldDelegate.premium != premium;
  }
}
