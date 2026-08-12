// Global navigation hooks used by the authenticated API layer.
//
// @author  Malak

import 'package:flutter/material.dart';

abstract final class AppNavigator {
  static final navigatorKey = GlobalKey<NavigatorState>();

  static void goToLogin() {
    final navigator = navigatorKey.currentState;
    if (navigator == null) return;
    navigator.pushNamedAndRemoveUntil('/login', (route) => false);
  }
}
