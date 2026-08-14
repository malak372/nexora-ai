// Shared mobile authentication layout for Voxidence.
//
// @author Eman

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_theme.dart';
import '../../home/widgets/common.dart';

class AuthShell extends StatelessWidget {
  const AuthShell({super.key, required this.child, this.maxWidth = 520});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const Positioned.fill(child: _AuthBackground()),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                return SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: constraints.maxHeight - 38,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(maxWidth: maxWidth),
                        child: child,
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

class AuthBrandBar extends StatelessWidget {
  const AuthBrandBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        InkWell(
          onTap: () {
            Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
          },
          borderRadius: BorderRadius.circular(16),
          child: const Padding(
            padding: EdgeInsets.all(2),
            child: Row(
              children: [
                BrandMark(size: 37),
                SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Voxidence',
                      style: TextStyle(
                        color: AppColors.primaryDark,
                        fontSize: 16.5,
                        height: 1,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.45,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Real voices. Better ideas.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 9.1,
                        height: 1,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const Spacer(),
        Material(
          color: Colors.white.withValues(alpha: 0.78),
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            onTap: () {
              Navigator.pushNamedAndRemoveUntil(context, '/', (_) => false);
            },
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
                Icons.arrow_back_rounded,
                size: 19,
                color: AppColors.primaryDark,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class AuthCard extends StatelessWidget {
  const AuthCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(18, 20, 18, 18),
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.84),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.13)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: 0.09),
            blurRadius: 34,
            offset: const Offset(0, 15),
          ),
        ],
      ),
      child: child,
    );
  }
}

class AuthEyebrow extends StatelessWidget {
  const AuthEyebrow({
    super.key,
    required this.label,
    this.icon = Icons.auto_awesome_rounded,
  });

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primaryDark),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 9.1,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.55,
            ),
          ),
        ],
      ),
    );
  }
}

class AuthTitle extends StatelessWidget {
  const AuthTitle({
    super.key,
    required this.title,
    required this.highlight,
    required this.description,
  });

  final String title;
  final String highlight;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RichText(
          text: TextSpan(
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 27,
              height: 1.05,
              fontWeight: FontWeight.w900,
              letterSpacing: -0.9,
            ),
            children: [
              TextSpan(text: '$title\n'),
              TextSpan(
                text: highlight,
                style: const TextStyle(color: AppColors.primary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          description,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 11.7,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

class AuthField extends StatelessWidget {
  const AuthField({
    super.key,
    required this.controller,
    required this.label,
    required this.hint,
    required this.icon,
    this.keyboardType,
    this.textInputAction,
    this.validator,
    this.obscureText = false,
    this.suffixIcon,
    this.onChanged,
    this.onFieldSubmitted,
    this.onFocusChanged,
    this.focusNode,
    this.enabled = true,
    this.maxLength,
    this.inputFormatters,
    this.autofillHints,
    this.autovalidateMode,
    this.formFieldKey,
    this.validState = false,
    this.validLabel,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final IconData icon;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final String? Function(String?)? validator;
  final bool obscureText;
  final Widget? suffixIcon;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onFieldSubmitted;
  final ValueChanged<bool>? onFocusChanged;
  final FocusNode? focusNode;
  final bool enabled;
  final int? maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final Iterable<String>? autofillHints;
  final AutovalidateMode? autovalidateMode;
  final GlobalKey<FormFieldState<String>>? formFieldKey;
  final bool validState;
  final String? validLabel;

  @override
  Widget build(BuildContext context) {
    const validColor = AppColors.primaryDark;

    final field = TextFormField(
      key: formFieldKey,
      controller: controller,
      focusNode: focusNode,
      enabled: enabled,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      validator: validator,
      obscureText: obscureText,
      onChanged: onChanged,
      onFieldSubmitted: onFieldSubmitted,
      maxLength: maxLength,
      inputFormatters: inputFormatters,
      autofillHints: autofillHints,
      autovalidateMode: autovalidateMode,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
      decoration: InputDecoration(
        hintText: hint,

        prefixIcon: Icon(icon, size: 18),

        // Only explicit suffix widgets are shown.
        // Valid email state no longer adds
        // a check icon inside the text field.
        suffixIcon: suffixIcon,

        counterText: '',
        isDense: true,

        enabledBorder: validState
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(15),
                borderSide: const BorderSide(color: validColor, width: 1.15),
              )
            : null,

        focusedBorder: validState
            ? OutlineInputBorder(
                borderRadius: BorderRadius.circular(15),
                borderSide: const BorderSide(color: validColor, width: 1.35),
              )
            : null,
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.primaryDeep,
                  fontSize: 11.1,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),

            // Keep "Valid format" above
            // the field with its subtle check.
            if (validState && validLabel != null) ...[
              const Icon(Icons.check_rounded, size: 13, color: validColor),
              const SizedBox(width: 4),
              Text(
                validLabel!,
                style: const TextStyle(
                  color: validColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 6),
        if (onFocusChanged == null)
          field
        else
          Focus(onFocusChange: onFocusChanged, child: field),
      ],
    );
  }
}

class AuthPrimaryButton extends StatelessWidget {
  const AuthPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    required this.loading,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.48),
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
        ),
        child: loading
            ? const SizedBox(
                width: 19,
                height: 19,
                child: CircularProgressIndicator(
                  strokeWidth: 2.1,
                  color: Colors.white,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 12.4,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.arrow_forward_rounded, size: 17),
                ],
              ),
      ),
    );
  }
}

class AuthErrorBox extends StatelessWidget {
  const AuthErrorBox({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.pinkSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.pink.withValues(alpha: 0.22)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            size: 15,
            color: Color(0xFF9F4F61),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Color(0xFF9F4F61),
                fontSize: 9.8,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class AuthSwitchPrompt extends StatelessWidget {
  const AuthSwitchPrompt({
    super.key,
    required this.text,
    required this.action,
    required this.onPressed,
  });

  final String text;
  final String action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 3,
        runSpacing: 3,
        children: [
          Text(
            text,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 10.4),
          ),
          InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 3),
              child: Text(
                action,
                style: const TextStyle(
                  color: AppColors.primaryDark,
                  fontSize: 10.4,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class AuthSecurityLine extends StatelessWidget {
  const AuthSecurityLine({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.shield_outlined, size: 14, color: AppColors.pink),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 9.5,
              height: 1.3,
            ),
          ),
        ),
      ],
    );
  }
}

class _AuthBackground extends StatelessWidget {
  const _AuthBackground();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFCFBFF), Color(0xFFF8F5FF), Color(0xFFF8FCFF)],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -145,
            right: -125,
            child: _Glow(
              size: 320,
              color: AppColors.primary.withValues(alpha: 0.16),
            ),
          ),
          Positioned(
            top: 170,
            left: -180,
            child: _Glow(
              size: 330,
              color: AppColors.pinkLight.withValues(alpha: 0.11),
            ),
          ),
          Positioned(
            right: -150,
            bottom: -150,
            child: _Glow(
              size: 340,
              color: AppColors.pinkLight.withValues(alpha: 0.10),
            ),
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
