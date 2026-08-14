// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;
import 'dart:typed_data';

/// Downloads invoice PDF bytes directly in Flutter Web.
///
/// Using a Blob download avoids opening an enormous data: URL in a new tab,
/// which can render as a blank page in Chrome.
///
/// @author Eman
Future<bool> downloadInvoicePdfBytes(
  List<int> bytes, {
  required String fileName,
}) async {
  if (bytes.isEmpty) return false;

  final blob = html.Blob(
    <Object>[Uint8List.fromList(bytes)],
    'application/pdf',
  );

  final objectUrl = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: objectUrl)
    ..download = fileName
    ..style.display = 'none';

  html.document.body?.children.add(anchor);
  anchor.click();
  anchor.remove();

  Future<void>.delayed(
    const Duration(seconds: 1),
    () => html.Url.revokeObjectUrl(objectUrl),
  );

  return true;
}
