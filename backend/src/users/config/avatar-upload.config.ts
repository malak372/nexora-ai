import { memoryStorage } from 'multer';

/** Maximum accepted avatar size: 5 MiB. */
export const MAX_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Multer configuration for profile-avatar uploads.
 *
 * Files remain in memory until their binary signature is validated by the
 * profile service. This avoids writing spoofed or unsupported files to disk.
 */
export const avatarUploadOptions = {
  storage: memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_AVATAR_FILE_SIZE_BYTES,
  },
};