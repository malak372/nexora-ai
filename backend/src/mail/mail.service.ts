import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaymentMethod, PaymentPurpose } from '@prisma/client';
import * as nodemailer from 'nodemailer';

/**
 * Service responsible for sending application emails.
 *
 * Supports:
 * - Password reset emails.
 * - Welcome emails after successful registration.
 * - Email verification emails.
 * - Payment receipt emails.
 * - Credit purchase confirmation emails.
 * - Low credit balance warning emails.
 * - Admin alert emails.
 *
 * @author Eman
 * @author Malak
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
   * @author Eman
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
            If you did not request this password reset, you can safely ignore this email.
          </p>
        `,
      });
    } catch {
      throw new InternalServerErrorException(
        'Failed to send password reset email',
      );
    }

    /**
     * Sends a welcome email after successful user registration.
     *
     * @param email Recipient email address.
     * @param fullName Registered user's full name.
     */
    async sendWelcomeEmail(email: string, fullName: string): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Welcome to Nexora AI',
                html: `
        <h2>Welcome, ${fullName}</h2>
        <p>Your Nexora AI account has been created successfully.</p>
        <p>You now have 3 free idea generations.</p>
      `,
            });
        } catch {
            throw new InternalServerErrorException('Failed to send welcome email');
        }
    }
    
    /**
     * Sends an email verification link.
     *
     * @param email Recipient email address.
     * @param verificationLink Email verification URL.
     */
    async sendVerificationEmail(
        email: string,
        verificationLink: string,
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Verify your Nexora AI email',
                html: `
        <h2>Email Verification</h2>
        <p>Please verify your email by clicking the button below:</p>
        <a
          href="${verificationLink}"
          style="
            display:inline-block;
            padding:12px 24px;
            background:#2563eb;
            color:white;
            text-decoration:none;
            border-radius:6px;
          "
        >
          Verify Email
        </a>
        <p>If you did not create this account, simply ignore this email.</p>
      `,
            });
        } catch {
            throw new InternalServerErrorException('Failed to send verification email');
        }
    }

    /**
     * Sends a payment receipt email after a successful payment.
     *
     * @param email Recipient email address.
     * @param amount Paid amount.
     * @param currency Payment currency.
     * @param paymentMethod Payment method used.
     * @param paymentPurpose Purpose of the payment.
     * @param transactionReference Optional payment transaction reference.
     */
    async sendPaymentReceipt(
        email: string,
        amount: number,
        currency: string,
        paymentMethod: PaymentMethod,
        paymentPurpose: PaymentPurpose,
        transactionReference?: string,
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Nexora AI Payment Receipt',
                html: `
        <h2>Payment Successful</h2>
        <p>Your payment has been completed successfully.</p>
        <p><strong>Amount:</strong> ${amount} ${currency}</p>
        <p><strong>Payment Method:</strong> ${paymentMethod}</p>
        <p><strong>Purpose:</strong> ${paymentPurpose}</p>
        <p><strong>Transaction:</strong> ${transactionReference ?? 'N/A'}</p>
      `,
            });
        } catch {
            throw new InternalServerErrorException('Failed to send payment receipt email');
        }
    }

    /**
     * Sends a credit purchase confirmation email.
     *
     * @param email Recipient email address.
     * @param creditsAmount Number of purchased credits.
     * @param bonusCredits Number of bonus credits added.
     * @param currentBalance User's current credit balance after purchase.
     */
    async sendCreditPurchaseEmail(
        email: string,
        creditsAmount: number,
        bonusCredits: number,
        currentBalance: number,
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Credits Added to Your Nexora AI Account',
                html: `
        <h2>Credits Added Successfully</h2>
        <p><strong>Purchased Credits:</strong> ${creditsAmount}</p>
        <p><strong>Bonus Credits:</strong> ${bonusCredits}</p>
        <p><strong>Current Balance:</strong> ${currentBalance}</p>
      `,
            });
        } catch {
            throw new InternalServerErrorException('Failed to send credit purchase email');
        }
    }

    /**
     * Sends a low credit balance warning email.
     *
     * @param email Recipient email address.
     * @param currentBalance Current user credit balance.
     */
    async sendLowCreditBalanceEmail(
        email: string,
        currentBalance: number,
    ): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: 'Low Credit Balance - Nexora AI',
                html: `
        <h2>Low Credit Balance</h2>

        <p>Your Nexora AI credit balance is running low.</p>

        <p>
          <strong>Current Balance:</strong> ${currentBalance} credits
        </p>

        <p>
          Please purchase more credits if you want to continue generating premium project ideas.
        </p>
      `,
            });
        } catch {
            throw new InternalServerErrorException(
                'Failed to send low credit balance email',
            );
        }
    }
  }

  /**
   * Sends an administrator email alert.
   *
   * Used when an administrator sends
   * a notification email to one user
   * or broadcasts it to all users.
   *
   * @param email Recipient email address.
   * @param subject Email subject.
   * @param message Email body.
   * @param fullName Recipient full name.
   * @author Malak
   */
  async sendAdminAlertEmail(
    email: string,
    subject: string,
    message: string,
    fullName?: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject,
        html: `
          <h2>${subject}</h2>

          <p>
            Hello ${fullName ?? 'User'},
          </p>

          <p>
            ${message}
          </p>

          <br>

          <p>
            Regards,
          </p>

          <p>
            Nexora AI Team
          </p>
        `,
      });
    } catch {
      throw new InternalServerErrorException(
        'Failed to send admin alert email',
      );
    }
  }
}