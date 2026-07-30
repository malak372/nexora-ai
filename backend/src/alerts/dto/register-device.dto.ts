import { DevicePlatform } from '@prisma/client';

import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

const FCM_TOKEN_MIN_LENGTH = 20;
const FCM_TOKEN_MAX_LENGTH = 4096;

/**
 * Defines the payload required to register or refresh
 * a device for Firebase Cloud Messaging notifications.
 *
 * The FCM token uniquely identifies one application installation.
 *
 * @author Eman
 */
export class RegisterDeviceDto {
  /**
   * Firebase Cloud Messaging registration token generated
   * by the frontend application for the current device.
   */
  @ApiProperty({
    description:
      'Firebase Cloud Messaging token that uniquely identifies the device.',
    example: 'fcm-registration-token-generated-by-the-client',
    minLength: FCM_TOKEN_MIN_LENGTH,
    maxLength: FCM_TOKEN_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(FCM_TOKEN_MIN_LENGTH)
  @MaxLength(FCM_TOKEN_MAX_LENGTH)
  fcmToken: string;

  /**
   * Platform on which the client application is running.
   */
  @ApiProperty({
    description: 'Platform of the device registering for push notifications.',
    enum: DevicePlatform,
    example: DevicePlatform.ANDROID,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}
