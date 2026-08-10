/// Shared visual system for the Voxidence Flutter application.
///
/// @author Eman

import 'package:flutter/material.dart';

abstract final class AppColors {
  // Palette matched to the Voxidence web landing page.
  static const background = Color(0xFFFAF9F6);
  static const surface = Color(0xFFFFFDFC);
  static const surfaceMuted = Color(0xFFF2F6F3);

  static const primary = Color(0xFF5CBDB9);
  static const primaryDark = Color(0xFF2F7774);
  static const primaryDeep = Color(0xFF315F57);
  static const primarySoft = Color(0xFFEAF5F2);
  static const mint = Color(0xFFDCE8E2);

  static const pink = Color(0xFFD98FA0);
  static const pinkSoft = Color(0xFFFBEFF2);

  static const warm = Color(0xFFFAF9F6);
  static const warmSoft = Color(0xFFFFFDFC);

  static const textPrimary = Color(0xFF263B37);
  static const textSecondary = Color(0xFF667A76);
  static const textMuted = Color(0xFF84908C);

  static const border = Color(0xFFE4ECE8);
  static const borderStrong = Color(0xFFD6E3DE);
}

abstract final class AppTheme {
  static ThemeData get light {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: Brightness.light,
      surface: AppColors.surface,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,
      visualDensity: VisualDensity.standard,

      appBarTheme: const AppBarTheme(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        foregroundColor: AppColors.textPrimary,
      ),

      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          fontSize: 38,
          height: 1.05,
          fontWeight: FontWeight.w900,
          color: AppColors.textPrimary,
          letterSpacing: -1.25,
        ),
        headlineMedium: TextStyle(
          fontSize: 29,
          height: 1.08,
          fontWeight: FontWeight.w900,
          color: AppColors.textPrimary,
          letterSpacing: -0.8,
        ),
        titleLarge: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: AppColors.textPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: AppColors.textPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: 15,
          height: 1.58,
          color: AppColors.textSecondary,
        ),
        bodyMedium: TextStyle(
          fontSize: 13.5,
          height: 1.5,
          color: AppColors.textSecondary,
        ),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryDark,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 17),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        labelStyle: const TextStyle(color: AppColors.textSecondary),
        prefixIconColor: AppColors.primaryDark,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
      ),
    );
  }
}
