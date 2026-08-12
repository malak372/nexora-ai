/// Shared client-side authentication validation rules.
///
/// These rules mirror the web authentication screens so mobile and web show
/// the same validation behavior before the backend performs final validation.
///
/// @author Eman
class AuthValidators {
  AuthValidators._();

  static final RegExp _loginEmailPattern = RegExp(
    r"""^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$""",
    caseSensitive: false,
  );

  static final RegExp _basicEmailPattern = RegExp(
    r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
  );

  static bool isValidLoginEmail(String email) {
    final normalizedEmail = email.trim();

    return normalizedEmail.isNotEmpty &&
        normalizedEmail.length <= 254 &&
        !normalizedEmail.contains('..') &&
        _loginEmailPattern.hasMatch(normalizedEmail);
  }

  static String? loginEmail(String? value) {
    final email = value?.trim() ?? '';

    if (email.isEmpty) {
      return 'Email address is required.';
    }

    if (!isValidLoginEmail(email)) {
      return 'Enter a valid email address, such as name@example.com.';
    }

    return null;
  }

  static String? loginPassword(String? value) {
    final password = value ?? '';

    if (password.isEmpty) {
      return 'Password is required.';
    }

    if (password.length < 8) {
      return 'Password must contain at least 8 characters.';
    }

    return null;
  }

  static String? registerFullName(String? value) {
    final fullName = value?.trim() ?? '';

    if (fullName.isEmpty) {
      return 'Full name is required.';
    }

    return null;
  }

  static String? registerEmail(String? value) {
    final email = value?.trim() ?? '';

    if (email.isEmpty) {
      return 'Email address is required.';
    }

    if (!_basicEmailPattern.hasMatch(email)) {
      return 'Enter a valid email address.';
    }

    return null;
  }

  static String? registerPassword(String? value) {
    final password = value ?? '';

    if (password.isEmpty) {
      return 'Password is required.';
    }

    final hasMinimumLength = password.length >= 6;
    final hasLetter = RegExp(r'[A-Za-z]').hasMatch(password);
    final hasNumber = RegExp(r'\d').hasMatch(password);

    if (!hasMinimumLength || !hasLetter || !hasNumber) {
      return 'Use at least 6 characters with one letter and one number.';
    }

    return null;
  }

  static String? confirmRegistrationPassword({
    required String? value,
    required String password,
  }) {
    final confirmation = value ?? '';

    if (confirmation.isEmpty) {
      return 'Confirm your password.';
    }

    if (confirmation != password) {
      return 'Passwords do not match.';
    }

    return null;
  }

  static String? recoveryEmail(String? value) {
    final email = value?.trim() ?? '';

    if (!_basicEmailPattern.hasMatch(email)) {
      return 'Enter a valid email address.';
    }

    return null;
  }

  static bool isSixDigitVerificationCode(String value) {
    return RegExp(r'^\d{6}$').hasMatch(value.trim());
  }
}
