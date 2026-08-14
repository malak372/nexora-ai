import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Opens the printable business-model presentation on Android/iOS/desktop.
///
/// The previous implementation launched a data:text/html URL. Native Android
/// browsers commonly refuse external data URLs, so a real temporary HTML file
/// is created instead and opened through the platform file intent.
///
/// If no installed app accepts the HTML file, the platform share sheet is used
/// as a fallback so the user can still open/print/save the presentation.
///
/// @author Eman
Future<bool> openBusinessModelPrintableHtml(
  String html, {
  required String fileName,
  required String shareTitle,
}) async {
  if (html.trim().isEmpty) return false;

  final directory = await getTemporaryDirectory();
  final normalizedName = fileName.toLowerCase().endsWith('.html')
      ? fileName
      : '$fileName.html';
  final file = File('${directory.path}/$normalizedName');

  await file.writeAsString(html, flush: true);

  final result = await OpenFilex.open(
    file.path,
    type: 'text/html',
  );

  if (result.type == ResultType.done) {
    return true;
  }

  try {
    await SharePlus.instance.share(
      ShareParams(
        title: 'Voxidence · Business model',
        subject: shareTitle,
        text: 'Open this Voxidence presentation, then choose Print / Save as PDF.',
        files: <XFile>[
          XFile(
            file.path,
            mimeType: 'text/html',
            name: normalizedName,
          ),
        ],
      ),
    );

    return true;
  } catch (_) {
    return false;
  }
}
