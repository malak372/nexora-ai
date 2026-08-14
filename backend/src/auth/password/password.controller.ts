import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentUser } from '../decorators/current-user.decorator';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

import { AuthPasswordService } from './password.service';

const PASSWORD_ACTION_TTL_MS = 60_000;

/**
 * Controller responsible for password management.
 *
 * Handles:
 * - Authenticated password changes.
 * - Password-reset requests.
 * - Password resets using valid reset tokens.
 *
 * Base route:
 * /auth/password
 *
 * @author Eman
 */
@Controller('auth/password')
export class PasswordController {
  constructor(
    private readonly authPasswordService:
      AuthPasswordService,
  ) { }

  /**
   * Changes the authenticated user's password.
   *
   * Endpoint:
   * PATCH /auth/password/change
   */
  @Patch('change')
  @UseGuards(JwtAuthGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  changePassword(
    @CurrentUser()
    user: AuthenticatedUser,

    @Body()
    dto: ChangePasswordDto,

    @Req()
    request: Request,
  ) {
    return this.authPasswordService.changePassword(
      user.id,
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
    );
  }

  /**
   * Requests a password-reset email.
   *
   * Web requests receive the normal web URL.
   * Mobile requests receive the voxidence:// deep link.
   *
   * Endpoint:
   * POST /auth/password/forgot
   */
  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 3,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  forgotPassword(
    @Body()
    dto: ForgotPasswordDto,

    @Req()
    request: Request,
  ) {
    const requestedClient =
      request.headers[
      'x-voxidence-client'
      ];

    const resetClient =
      typeof requestedClient ===
        'string' &&
        requestedClient
          .trim()
          .toLowerCase() ===
        'mobile'
        ? 'mobile'
        : 'web';

    const mobileResetBridgeUrl =
      resetClient === 'mobile'
        ? this.buildMobileResetBridgeUrl(request)
        : undefined;

    return this.authPasswordService.forgotPassword(
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
      resetClient,
      mobileResetBridgeUrl,
    );
  }

  /**
   * Opens a mobile password-reset link through a browser-safe bridge.
   *
   * Mobile email clients commonly block non-http links such as
   * voxidence:// directly inside email buttons. The email therefore opens
   * this normal HTTP/HTTPS endpoint first. The endpoint immediately forwards
   * the user into the installed Voxidence application using:
   *
   * voxidence://reset-password?token=...
   *
   * Endpoint:
   * GET /auth/password/open-reset?token=...
   *
   * @author Eman
   */
  @Get('open-reset')
  openMobilePasswordReset(
    @Query('token')
    token: string | undefined,

    @Res()
    response: Response,
  ) {
    const normalizedToken =
      token?.trim() ?? '';

    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );

    response.setHeader(
      'Pragma',
      'no-cache',
    );

    response.setHeader(
      'Referrer-Policy',
      'no-referrer',
    );

    response.type('html');

    if (!normalizedToken) {
      return response
        .status(HttpStatus.BAD_REQUEST)
        .send(
          this.buildMobileResetBridgeHtml(),
        );
    }

    const deepLink =
      `voxidence://reset-password?token=${encodeURIComponent(
        normalizedToken,
      )}`;

    return response
      .status(HttpStatus.OK)
      .send(
        this.buildMobileResetBridgeHtml(
          deepLink,
        ),
      );
  }

  /**
   * Builds the public bridge URL used inside mobile reset emails.
   *
   * In local development this automatically becomes the same LAN address
   * that the Android/iOS app used to reach the backend, for example:
   *
   * http://192.168.88.5:3000/auth/password/open-reset
   *
   * In production MOBILE_RESET_BRIDGE_URL may be configured explicitly.
   */
  private buildMobileResetBridgeUrl(
    request: Request,
  ): string | undefined {
    const configured =
      process.env
        .MOBILE_RESET_BRIDGE_URL
        ?.trim();

    if (configured) {
      return configured.replace(
        /\/$/,
        '',
      );
    }

    const forwardedProtocolHeader =
      request.headers[
        'x-forwarded-proto'
      ];

    const forwardedHostHeader =
      request.headers[
        'x-forwarded-host'
      ];

    const forwardedProtocol =
      Array.isArray(
        forwardedProtocolHeader,
      )
        ? forwardedProtocolHeader[0]
        : forwardedProtocolHeader
            ?.split(',')[0]
            ?.trim();

    const forwardedHost =
      Array.isArray(
        forwardedHostHeader,
      )
        ? forwardedHostHeader[0]
        : forwardedHostHeader
            ?.split(',')[0]
            ?.trim();

    const protocol =
      forwardedProtocol ||
      request.protocol ||
      'http';

    const host =
      forwardedHost ||
      request.get('host');

    if (!host) {
      return undefined;
    }

    return `${protocol}://${host}/auth/password/open-reset`;
  }

  /**
   * Builds the tiny branded bridge page that launches Voxidence.
   *
   * The automatic launch is followed by a visible Open Voxidence button so
   * browsers that block automatic custom-scheme navigation still give the
   * user a direct, explicit action.
   */
  private buildMobileResetBridgeHtml(
    deepLink?: string,
  ): string {
    const safeDeepLink =
      deepLink
        ? this.escapeHtmlAttribute(
            deepLink,
          )
        : '';

    const scriptTarget =
      JSON.stringify(
        deepLink ?? '',
      ).replace(
        /</g,
        '\\u003c',
      );

    const action =
      deepLink
        ? `
          <a
            class="open-button"
            href="${safeDeepLink}"
          >
            Open Voxidence
          </a>

          <p class="hint">
            If Voxidence does not open automatically, tap the button above.
          </p>
        `
        : `
          <div class="error">
            This reset link is missing its secure token.
          </div>

          <p class="hint">
            Return to Voxidence and request a new password-reset email.
          </p>
        `;

    const launchScript =
      deepLink
        ? `
          <script>
            (function () {
              var target = ${scriptTarget};

              function openVoxidence() {
                if (!target) return;
                window.location.href = target;
              }

              window.setTimeout(openVoxidence, 120);
            })();
          </script>
        `
        : '';

    return `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />

          <meta
            name="color-scheme"
            content="light"
          />

          <title>Open Voxidence</title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              padding: 24px;
              font-family:
                Inter,
                ui-sans-serif,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
              color: #355f59;
              background:
                radial-gradient(
                  circle at 80% 15%,
                  rgba(243, 201, 211, .42),
                  transparent 34%
                ),
                radial-gradient(
                  circle at 10% 85%,
                  rgba(92, 189, 185, .22),
                  transparent 32%
                ),
                #faf9f6;
            }

            .card {
              width: min(100%, 420px);
              padding: 28px 24px;
              text-align: center;
              background: rgba(255, 253, 250, .94);
              border: 1px solid #ddebe8;
              border-radius: 28px;
              box-shadow:
                0 24px 60px rgba(49, 95, 87, .10);
            }

            .mark {
              width: 62px;
              height: 62px;
              margin: 0 auto 18px;
              display: grid;
              place-items: center;
              border-radius: 21px;
              color: #ffffff;
              font-size: 29px;
              background:
                linear-gradient(
                  145deg,
                  #69cec8,
                  #2f7774
                );
              box-shadow:
                0 12px 28px rgba(92, 189, 185, .24);
            }

            .eyebrow {
              margin: 0 0 8px;
              color: #2f7774;
              font-size: 11px;
              font-weight: 800;
              letter-spacing: .12em;
              text-transform: uppercase;
            }

            h1 {
              margin: 0;
              font-size: 25px;
              line-height: 1.12;
              letter-spacing: -.03em;
            }

            .copy {
              margin: 11px auto 20px;
              max-width: 330px;
              color: #60756f;
              font-size: 14px;
              line-height: 1.55;
            }

            .open-button {
              width: 100%;
              min-height: 48px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 12px 18px;
              color: #ffffff;
              background:
                linear-gradient(
                  135deg,
                  #5cbdb9,
                  #397f79
                );
              border-radius: 15px;
              font-size: 14px;
              font-weight: 800;
              text-decoration: none;
              box-shadow:
                0 10px 24px rgba(92, 189, 185, .20);
            }

            .hint {
              margin: 14px 0 0;
              color: #7c8986;
              font-size: 12px;
              line-height: 1.5;
            }

            .error {
              padding: 13px 14px;
              color: #9c5364;
              background: #fff2f5;
              border: 1px solid #f3c9d3;
              border-radius: 14px;
              font-size: 13px;
              font-weight: 700;
            }
          </style>
        </head>

        <body>
          <main class="card">
            <div class="mark">✦</div>

            <p class="eyebrow">
              Voxidence secure recovery
            </p>

            <h1>
              Continue in Voxidence
            </h1>

            <p class="copy">
              Your secure password-reset page opens inside the Voxidence app.
            </p>

            ${action}
          </main>

          ${launchScript}
        </body>
      </html>
    `.trim();
  }

  /**
   * Escapes a value before placing it inside an HTML attribute.
   */
  private escapeHtmlAttribute(
    value: string,
  ): string {
    return value
      .replaceAll(
        '&',
        '&amp;',
      )
      .replaceAll(
        '<',
        '&lt;',
      )
      .replaceAll(
        '>',
        '&gt;',
      )
      .replaceAll(
        '"',
        '&quot;',
      )
      .replaceAll(
        "'",
        '&#039;',
      );
  }

  /**
   * Resets a user's password.
   *
   * Endpoint:
   * POST /auth/password/reset
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 5,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  resetPassword(
    @Body()
    dto: ResetPasswordDto,

    @Req()
    request: Request,
  ) {
    return this.authPasswordService.resetPassword(
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
    );
  }
}