import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Opens invoice PDF bytes safely on Android, iOS and desktop.
///
/// Native platforms should not launch a `data:application/pdf;base64,...` URL.
/// Android browsers can display the encoded payload as text instead of opening
/// the PDF, which is what caused the long base64 string on the screen.
///
/// This implementation writes a real `.pdf` file first, then asks the platform
/// to open it with a PDF-capable application. If no app accepts the file, the
/// native share sheet is used as a fallback.
///
/// @author Eman
Future<bool> downloadInvoicePdfBytes(
  List<int> bytes, {
  required String fileName,
}) async {
  if (bytes.isEmpty) return false;

  final directory = await getTemporaryDirectory();

  final normalizedName = fileName.toLowerCase().endsWith('.pdf')
      ? fileName
      : '$fileName.pdf';

  final file = File(
    '${directory.path}${Platform.pathSeparator}$normalizedName',
  );

  await file.writeAsBytes(
    bytes,
    flush: true,
  );

  final result = await OpenFilex.open(
    file.path,
    type: 'application/pdf',
  );

  if (result.type == ResultType.done) {
    return true;
  }

  try {
    await SharePlus.instance.share(
      ShareParams(
        title: 'Voxidence invoice',
        subject: normalizedName,
        text: 'Voxidence invoice PDF',
        files: <XFile>[
          XFile(
            file.path,
            mimeType: 'application/pdf',
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
