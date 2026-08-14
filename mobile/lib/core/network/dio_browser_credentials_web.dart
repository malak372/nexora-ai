import 'package:dio/browser.dart';
import 'package:dio/dio.dart';

/// Enables browser-managed cookies for Flutter Web requests.
///
/// HttpOnly cookies cannot be read or manually written by Dart code in
/// the browser, so the browser must attach them to requests.
///
/// @author Eman
void enableBrowserCredentials(Dio dio) {
  final adapter = dio.httpClientAdapter;

  if (adapter is BrowserHttpClientAdapter) {
    adapter.withCredentials = true;
    return;
  }

  dio.httpClientAdapter = BrowserHttpClientAdapter(withCredentials: true);
}
