import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_AVATAR_BUCKET = 'avatars';
const PUBLIC_OBJECT_PATH_SEGMENT = '/storage/v1/object/public/';

/**
 * Stores user avatars in Supabase Storage.
 *
 * The Supabase secret/service-role key is used only on the backend and must
 * never be exposed to the web or mobile applications.
 *
 * @author Eman
 */
@Injectable()
export class AvatarStorageService {
  private readonly logger = new Logger(AvatarStorageService.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService
      .get<string>('SUPABASE_URL')
      ?.trim();

    const supabaseSecretKey =
      this.configService.get<string>('SUPABASE_SECRET_KEY')?.trim() ||
      this.configService
        .get<string>('SUPABASE_SERVICE_ROLE_KEY')
        ?.trim();

    this.bucket =
      this.configService
        .get<string>('SUPABASE_AVATAR_BUCKET', DEFAULT_AVATAR_BUCKET)
        .trim() || DEFAULT_AVATAR_BUCKET;

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is required for avatar storage.');
    }

    if (!supabaseSecretKey) {
      throw new Error(
        'SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required for avatar storage.',
      );
    }

    this.client = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async uploadAvatar(params: {
    userId: string;
    filename: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<{ path: string; publicUrl: string }> {
    const path = `${params.userId}/${params.filename}`;

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, params.buffer, {
        contentType: params.contentType,
        cacheControl: '31536000',
        upsert: false,
      });

    if (error) {
      this.logger.error(
        `Failed to upload avatar to Supabase Storage: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Unable to store the profile image right now.',
      );
    }

    const { data } = this.client.storage
      .from(this.bucket)
      .getPublicUrl(path);

    return {
      path,
      publicUrl: data.publicUrl,
    };
  }

  async deleteAvatarByUrl(avatarUrl: string | null): Promise<void> {
    const path = this.getObjectPathFromPublicUrl(avatarUrl);
    if (!path) return;

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([path]);

    if (error) {
      this.logger.warn(
        `Failed to remove avatar from Supabase Storage (${path}): ${error.message}`,
      );
    }
  }

  private getObjectPathFromPublicUrl(avatarUrl: string | null): string | null {
    if (!avatarUrl) return null;

    try {
      const url = new URL(avatarUrl);
      const marker = `${PUBLIC_OBJECT_PATH_SEGMENT}${this.bucket}/`;
      const markerIndex = url.pathname.indexOf(marker);

      if (markerIndex < 0) return null;

      const encodedPath = url.pathname.slice(markerIndex + marker.length);
      if (!encodedPath) return null;

      return encodedPath
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      return null;
    }
  }
}