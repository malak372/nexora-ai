// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;

/// Opens the printable business-model presentation in a browser tab.
///
/// @author Eman
Future<bool> openBusinessModelPrintableHtml(
  String content, {
  required String fileName,
  required String shareTitle,
}) async {
  if (content.trim().isEmpty) return false;

  final blob = html.Blob(<Object>[content], 'text/html;charset=utf-8');
  final url = html.Url.createObjectUrlFromBlob(blob);
  html.window.open(url, '_blank');

  Future<void>.delayed(
    const Duration(seconds: 8),
    () => html.Url.revokeObjectUrl(url),
  );

  return true;
}
