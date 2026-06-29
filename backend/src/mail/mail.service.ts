import {
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Service responsible for sending authentication emails.
 *
 * Currently supports:
 * - Password reset emails.
 *
 * @author Eman
 */
@Injectable()
export class MailService {
    private readonly transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    /**
     * Sends a password reset email.
     *
     * @param email Recipient email address.
     * @param resetLink Password reset URL.
     */
    async sendPasswordResetEmail(
        email: string,
        resetLink: string,
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Reset your Nexora AI password',
                html: `
          <h2>Password Reset Request</h2>

          <p>We received a request to reset your password.</p>

          <p>
            Click the button below to create a new password:
          </p>

          <a
            href="${resetLink}"
            style="
              display:inline-block;
              padding:12px 24px;
              background:#2563eb;
              color:white;
              text-decoration:none;
              border-radius:6px;
            "
          >
            Reset Password
          </a>

          <p>
            This link expires in 15 minutes.
          </p>

          <p>
            If you did not request this, simply ignore this email.
          </p>
        `,
            });
        } catch {
            throw new InternalServerErrorException(
                'Failed to send reset email',
            );
        }
    }
}