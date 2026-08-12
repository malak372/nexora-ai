// Shared authenticated-account state for the mobile workspace.
//
// The controller hydrates the last authenticated user immediately, then
// replaces it with the fresh dashboard summary. This prevents a temporary API
// or browser-host mismatch from turning the entire workspace into a blank
// "Dashboard unavailable" card.
//
// @author Eman

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/storage/session_store.dart';
import '../api/user_api.dart';
import '../models/user_models.dart';

class UserSessionController extends ChangeNotifier {
  UserSessionController._();

  static final UserSessionController instance = UserSessionController._();

  UserSummary? summary;
  bool loading = false;
  Object? error;
  bool usingCachedSnapshot = false;

  bool _premiumWelcomeShownForSession = false;

  bool get isPremium => summary?.isPremium ?? false;

  /// True when the current authenticated Premium session has not yet shown
  /// its welcome celebration.
  bool get canShowPremiumWelcome =>
      isPremium && !_premiumWelcomeShownForSession;

  /// Atomically consumes the Premium welcome for this authenticated session.
  ///
  /// Returning false means the user is not Premium or the celebration already
  /// ran. [reset] clears the flag during logout so the next sign-in can
  /// celebrate again.
  bool consumePremiumWelcome() {
    if (!canShowPremiumWelcome) return false;
    _premiumWelcomeShownForSession = true;
    return true;
  }

  Future<void> load({bool force = false}) async {
    if (loading && !force) return;

    if (summary == null) {
      final snapshot = await SessionStore.instance.readUser();
      if (snapshot != null && snapshot.isNotEmpty) {
        summary = UserSummary.fromSessionSnapshot(snapshot);
        usingCachedSnapshot = true;
        notifyListeners();
      }
    }

    loading = true;
    error = null;
    notifyListeners();

    try {
      final fresh = await UserApi.instance.getSummary(force: force);
      summary = fresh;
      usingCachedSnapshot = false;

      await SessionStore.instance.updateUser({
        'id': fresh.id,
        'fullName': fresh.fullName,
        'email': fresh.email,
        'userType': fresh.userType,
        'accountStatus': fresh.accountStatus,
        'creditBalance': fresh.creditBalance,
        'remainingFreeGenerations': fresh.remainingFreeGenerations,
        'ideasCount': fresh.ideasCount,
        'publishedIdeasCount': fresh.publishedIdeasCount,
        'favoriteIdeasCount': fresh.favoriteIdeasCount,
        'unreadNotificationsCount': fresh.unreadNotificationsCount,
        'avatarUrl': fresh.avatarUrl,
      });
    } catch (e) {
      error = e;

      // If the summary endpoint is temporarily unavailable but authenticated
      // profile access still works, keep the shell useful instead of replacing
      // everything with an error screen.
      if (summary == null || summary!.id.isEmpty) {
        try {
          final profile = await UserApi.instance.getProfile(force: force);
          summary = UserSummary.fromSessionSnapshot(profile);
          usingCachedSnapshot = true;
        } catch (_) {
          // Keep the original summary error. The dashboard will expose Retry.
        }
      }
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void updateUnreadCount(int value) {
    final current = summary;
    if (current == null) return;
    summary = current.copyWith(unreadNotificationsCount: value);
    notifyListeners();
  }

  void applyProfile({
    String? fullName,
    String? email,
    String? userType,
    String? avatarUrl,
    bool clearAvatar = false,
  }) {
    final current = summary;
    if (current == null) return;

    summary = current.copyWith(
      fullName: fullName,
      email: email,
      userType: userType,
      avatarUrl: avatarUrl,
      clearAvatar: clearAvatar,
    );

    final updated = summary!;

    // Persist the lightweight account snapshot without blocking the UI.
    unawaited(
      SessionStore.instance.updateUser({
        'fullName': updated.fullName,
        'email': updated.email,
        'userType': updated.userType,
        'accountStatus': updated.accountStatus,
        'creditBalance': updated.creditBalance,
        'remainingFreeGenerations': updated.remainingFreeGenerations,
        'ideasCount': updated.ideasCount,
        'publishedIdeasCount': updated.publishedIdeasCount,
        'favoriteIdeasCount': updated.favoriteIdeasCount,
        'unreadNotificationsCount': updated.unreadNotificationsCount,
        'avatarUrl': updated.avatarUrl,
      }),
    );

    notifyListeners();
  }

  void reset() {
    summary = null;
    error = null;
    loading = false;
    usingCachedSnapshot = false;
    _premiumWelcomeShownForSession = false;
    notifyListeners();
  }
}
