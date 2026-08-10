// Author: Eman

import 'package:flutter/material.dart';

import '../../home/widgets/common.dart';

class AuthShell extends StatelessWidget {
  const AuthShell({super.key, required this.form});

  final Widget form;

  static const teal = Color(0xFF5CBDB9);
  static const darkTeal = Color(0xFF315F57);
  static const bodyTeal = Color(0xFF2F7774);
  static const pink = Color(0xFFD98FA0);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFB),
      body: Stack(
        children: [
          const Positioned.fill(child: _AuthBackground()),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                // Mobile breakpoint used across the auth screens.
                final isMobile = constraints.maxWidth < 700;

                return SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: EdgeInsets.fromLTRB(
                    isMobile ? 14 : 28,
                    isMobile ? 14 : 26,
                    isMobile ? 14 : 28,
                    isMobile ? 22 : 30,
                  ),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: constraints.maxHeight - (isMobile ? 36 : 56),
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 650),
                        child: form,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// Shared Voxidence branding used by login and registration.
class AuthBrand extends StatelessWidget {
  const AuthBrand({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    // Smaller branding keeps the mobile header clean and balanced.
    final logoSize = compact ? 34.0 : 46.0;
    final brandFontSize = compact ? 16.5 : 19.0;

    return InkWell(
      onTap: () {
        Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
      },
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            BrandMark(size: logoSize),
            SizedBox(width: compact ? 8 : 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Voxidence',
                  style: TextStyle(
                    color: AuthShell.darkTeal,
                    fontSize: brandFontSize,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -.35,
                  ),
                ),

                // Keep the supporting tagline only on wider layouts.
                if (!compact) ...[
                  const SizedBox(height: 1),
                  const Text(
                    'Ideas built from real needs',
                    style: TextStyle(
                      color: Color(0xFF637B76),
                      fontSize: 10.2,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// Small auth context row shown below the brand.
class AuthEyebrow extends StatelessWidget {
  const AuthEyebrow({super.key, required this.isMobile});

  final bool isMobile;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: isMobile ? 27 : 30,
          height: isMobile ? 27 : 30,
          decoration: BoxDecoration(
            color: AuthShell.teal.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(9),
          ),
          child: const Icon(
            Icons.shield_outlined,
            size: 16,
            color: AuthShell.teal,
          ),
        ),

        const SizedBox(width: 9),

        Expanded(
          child: Text(
            'YOUR WORKSPACE AWAITS',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AuthShell.teal,
              fontSize: isMobile ? 10 : 11,
              fontWeight: FontWeight.w900,
              letterSpacing: .9,
            ),
          ),
        ),

        const SizedBox(width: 8),

        InkWell(
          onTap: () {
            Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
          },
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: isMobile ? 9 : 12,
              vertical: isMobile ? 8 : 9,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .78),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFFDCEBE8)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.arrow_back_rounded,
                  color: AuthShell.teal,
                  size: 15,
                ),
                if (!isMobile) ...[
                  const SizedBox(width: 6),
                  const Text(
                    'Back to home',
                    style: TextStyle(
                      color: AuthShell.teal,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// Shared security footer used across auth pages.
class AuthFooter extends StatelessWidget {
  const AuthFooter({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(height: 1, color: const Color(0xFFE5EFED)),
        const SizedBox(height: 14),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.shield_outlined, size: 16, color: AuthShell.pink),
            const SizedBox(width: 7),
            Flexible(
              child: Text(
                text,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF738783),
                  fontSize: 10.8,
                  height: 1.3,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// Soft branded background used behind the auth card.
class _AuthBackground extends StatelessWidget {
  const _AuthBackground();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF7F8FC), Color(0xFFFFFCFC), Color(0xFFF2FAF8)],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -190,
            left: -130,
            child: _Glow(
              size: 390,
              color: const Color(0xFFF2CCD6).withValues(alpha: .28),
            ),
          ),
          Positioned(
            top: -180,
            right: -140,
            child: _Glow(
              size: 390,
              color: const Color(0xFFC4E9E5).withValues(alpha: .25),
            ),
          ),
          Positioned(
            right: -150,
            bottom: -170,
            child: _Glow(
              size: 410,
              color: const Color(0xFF5CBDB9).withValues(alpha: .18),
            ),
          ),
          Positioned(
            left: -180,
            bottom: -210,
            child: _Glow(
              size: 420,
              color: const Color(0xFFF2CCD6).withValues(alpha: .16),
            ),
          ),
          const Positioned.fill(
            child: IgnorePointer(child: CustomPaint(painter: _DotsPainter())),
          ),
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, color: color),
    );
  }
}

// Decorative edge dots matching the Voxidence palette.
class _DotsPainter extends CustomPainter {
  const _DotsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final tealPaint = Paint()..color = AuthShell.teal.withValues(alpha: .10);

    final pinkPaint = Paint()..color = AuthShell.pink.withValues(alpha: .06);

    const gap = 34.0;

    for (double y = 20; y < size.height; y += gap) {
      for (double x = 12; x < size.width; x += gap) {
        final edge = x < 120 || x > size.width - 120;

        if (!edge) {
          continue;
        }

        final paint = ((x + y) ~/ gap).isEven ? tealPaint : pinkPaint;

        canvas.drawCircle(Offset(x, y), 1.45, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return false;
  }
}
