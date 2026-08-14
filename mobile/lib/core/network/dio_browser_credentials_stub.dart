import 'package:dio/dio.dart';

/// Keeps the native Dio adapter unchanged.
///
/// Browser credential handling is configured only in Web builds.
///
/// @author Eman
void enableBrowserCredentials(Dio dio) {
  // Native platforms do not use BrowserHttpClientAdapter.
}
