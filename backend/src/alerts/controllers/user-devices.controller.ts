import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { RegisterDeviceDto } from '../dto/register-device.dto';

import { UserDeviceService } from '../services/user-device.service';

/**
 * Manages push-notification devices belonging to authenticated users.
 *
 * Base route:
 * /users/devices
 *
 * Responsibilities:
 * - Register or refresh an FCM device token.
 * - Retrieve the authenticated user's active devices.
 * - Revoke a user-owned device.
 *
 * Device ownership and token persistence are handled by UserDeviceService.
 *
 * @author Eman
 */
@ApiTags('User Devices')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Authentication is required.',
})
@Controller('users/devices')
@UseGuards(JwtAuthGuard)
export class UserDevicesController {
  constructor(private readonly userDeviceService: UserDeviceService) {}

  /**
   * Registers a device or refreshes an existing FCM token.
   *
   * POST /users/devices
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register or refresh a push-notification device',
  })
  @ApiOkResponse({
    description: 'The device was registered or refreshed successfully.',
  })
  registerDevice(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.userDeviceService.registerDevice(currentUser.id, dto);
  }

  /**
   * Retrieves active devices belonging to the authenticated user.
   *
   * The response must not expose raw FCM tokens.
   *
   * GET /users/devices
   */
  @Get()
  @ApiOperation({
    summary: 'Retrieve the authenticated user devices',
  })
  @ApiOkResponse({
    description: 'The active devices were retrieved successfully.',
  })
  getDevices(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.userDeviceService.getActiveDevices(currentUser.id);
  }

  /**
   * Revokes one device belonging to the authenticated user.
   *
   * DELETE /users/devices/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a push-notification device',
  })
  @ApiNoContentResponse({
    description: 'The device was revoked successfully.',
  })
  async revokeDevice(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) deviceId: string,
  ): Promise<void> {
    await this.userDeviceService.revokeDevice(currentUser.id, deviceId);
  }
}
