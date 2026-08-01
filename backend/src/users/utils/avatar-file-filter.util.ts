import { BadRequestException } from '@nestjs/common';

export type SupportedAvatar = {
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function beginsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

/**
 * Detects the real image type from binary magic bytes.
 * The browser-provided MIME type and filename are intentionally not trusted.
 */
export function detectSupportedAvatar(buffer: Buffer): SupportedAvatar {
  if (buffer.length < 12) {
    throw new BadRequestException('The selected image file is invalid.');
  }

  if (beginsWith(buffer, JPEG_SIGNATURE)) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }

  if (beginsWith(buffer, PNG_SIGNATURE)) {
    return { extension: 'png', mimeType: 'image/png' };
  }

  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (isWebp) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  throw new BadRequestException(
    'Only genuine JPEG, PNG, and WebP images are supported.',
  );
}

/**
 * Returns a safe local avatar filename from a stored public URL.
 * External URLs and path-traversal attempts are ignored.
 */
export function getLocalAvatarFilename(avatarUrl: string | null): string | null {
  if (!avatarUrl?.startsWith('/uploads/avatars/')) {
    return null;
  }

  const filename = avatarUrl.slice('/uploads/avatars/'.length);

  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null;
  }

  return filename;
}