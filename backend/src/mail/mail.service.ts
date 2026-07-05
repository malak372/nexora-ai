import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaymentMethod, PaymentPurpose } from '@prisma/client';
import * as nodemailer from 'nodemailer';

type EmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Service responsible for sending Nexora AI application emails.
 *
 * Centralizes all email delivery logic used across the system,
 * including authentication, payments, credits, and admin alerts.
 *
 * This service uses a shared internal sender and a unified HTML
 * layout to reduce duplication and keep all emails consistent
 * in branding, structure, and footer content.
 *
 * Supported email flows:
 * - Password reset.
 * - Welcome email.
 * - Email verification.
 * - Payment receipt.
 * - Credit purchase confirmation.
 * - Low credit balance warning.
 * - Admin alert email.
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
    tls: {
      rejectUnauthorized: false,
    },
  });

  /**
   * Sends an email using the configured SMTP transporter.
   *
   * This method is the single sending entry point inside
   * MailService. All public email methods use it to keep
   * sender configuration and error handling centralized.
   *
   * @param options Email sending options.
   * @throws InternalServerErrorException if email delivery fails.
   */
  private async sendEmail(options: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
    } catch (error) {
      console.error('SMTP Error:', error);

      throw new InternalServerErrorException('Failed to send email');
    }
  }

  /**
   * Builds a consistent HTML layout for all Nexora AI emails.
   *
   * This shared template provides a unified structure for all
   * outgoing emails while keeping the design independent from
   * the frontend branding. Once the application's visual identity
   * is finalized, the layout can be updated here without changing
   * individual email methods.
   *
   * The template includes:
   * - A unified content container.
   * - Email title.
   * - Dynamic email content.
   * - A shared footer with a no-reply notice.
   *
   * @param title Email heading.
   * @param content Email body HTML.
   * @returns Complete HTML email template.
   */
  private buildEmailTemplate(title: string, content: string): string {
    return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      max-width:640px;
      margin:32px auto;
      padding:32px;
      background:#ffffff;
      border:1px solid #e5e7eb;
      border-radius:8px;
      color:#111827;
      line-height:1.6;
      box-sizing:border-box;
    ">

      <h2 style="
        margin-top:0;
        margin-bottom:16px;
      ">
        ${title}
      </h2>

      ${content}

      <hr style="
        margin:32px 0 16px;
        border:none;
        border-top:1px solid #e5e7eb;
      " />

      <p style="
        margin:0;
        font-size:13px;
        color:#6b7280;
      ">
        This is an automated message from
        <strong>Nexora AI</strong>.
        Please do not reply to this email.
      </p>

      <p style="
        margin-top:8px;
        font-size:13px;
        color:#6b7280;
      ">
        Need help?
        You can contact the Nexora AI team through the
        Complaints section in the platform.
      </p>

    </div>
  `;
  }

  /**
   * Builds a styled email action button.
   *
   * @param label Button text.
   * @param url Button destination URL.
   * @returns HTML anchor styled as a button.
   */
  private buildActionButton(label: string, url: string): string {
    return `
      <a
        href="${url}"
        style="
          display:inline-block;
          padding:12px 24px;
          background:#2563eb;
          color:white;
          text-decoration:none;
          border-radius:6px;
          margin:12px 0;
        "
      >
        ${label}
      </a>
    `;
  }

  /**
   * Sends a password reset email.
   *
   * Used by the authentication module when a user requests
   * to reset their account password.
   *
   * @param email Recipient email address.
   * @param resetLink Password reset URL.
   */
  async sendPasswordResetEmail(
    email: string,
    resetLink: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Reset your Nexora AI password',
      text: `
Nexora AI Password Reset

Hello,

A password reset request was received for your Nexora AI account.

If you requested this change, open the link below:
${resetLink}

This link expires in 15 minutes.

If you did not request this password reset, you can safely ignore this email.

This email was sent automatically by Nexora AI. Please do not reply.
      `,
      html: this.buildEmailTemplate(
        'Nexora AI Password Reset',
        `
          <p>Hello,</p>

          <p>
            A password reset request was received for your Nexora AI account.
          </p>

          <p>
            If you requested this change, click the button below.
            Otherwise, you can safely ignore this email.
          </p>

          ${this.buildActionButton('Reset Password', resetLink)}

          <p>This link expires in 15 minutes.</p>

          <p>
            If the button does not work, copy and paste this link into your browser:
          </p>

          <p>
            <a href="${resetLink}">${resetLink}</a>
          </p>
        `,
      ),
    });
  }

  /**
   * Sends a welcome email after successful account verification.
   *
   * @param email Recipient email address.
   * @param fullName Registered user's full name.
   */
  async sendWelcomeEmail(
    email: string,
    fullName: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Welcome to Nexora AI',
      html: this.buildEmailTemplate(
        `Welcome, ${fullName}`,
        `
          <p>Your Nexora AI account has been created successfully.</p>

          <p>
            You now have <strong>3 free idea generations</strong>
            to start discovering software project ideas.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends an email verification link.
   *
   * Used after registration or when a user requests a new
   * verification email.
   *
   * @param email Recipient email address.
   * @param verificationLink Email verification URL.
   */
  async sendVerificationEmail(
    email: string,
    verificationLink: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify your Nexora AI email',
      html: this.buildEmailTemplate(
        'Email Verification',
        `
          <p>Please verify your email by clicking the button below:</p>

          ${this.buildActionButton('Verify Email', verificationLink)}

          <p>If you did not create this account, simply ignore this email.</p>
        `,
      ),
    });
  }

  /**
   * Sends a payment receipt email after a successful payment.
   *
   * This method should be called by the payment processing
   * service after the payment status becomes SUCCESS.
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
    await this.sendEmail({
      to: email,
      subject: 'Nexora AI Payment Receipt',
      html: this.buildEmailTemplate(
        'Payment Successful',
        `
          <p>Your payment has been completed successfully.</p>

          <p><strong>Amount:</strong> ${amount} ${currency}</p>
          <p><strong>Payment Method:</strong> ${paymentMethod}</p>
          <p><strong>Purpose:</strong> ${paymentPurpose}</p>
          <p><strong>Transaction:</strong> ${transactionReference ?? 'N/A'}</p>
        `,
      ),
    });
  }

  /**
   * Sends a credit purchase confirmation email.
   *
   * This method should be called after credits are successfully
   * added to the user's account.
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
    await this.sendEmail({
      to: email,
      subject: 'Credits Added to Your Nexora AI Account',
      html: this.buildEmailTemplate(
        'Credits Added Successfully',
        `
          <p>Your credits have been added successfully.</p>

          <p><strong>Purchased Credits:</strong> ${creditsAmount}</p>
          <p><strong>Bonus Credits:</strong> ${bonusCredits}</p>
          <p><strong>Current Balance:</strong> ${currentBalance}</p>
        `,
      ),
    });
  }

  /**
   * Sends a low credit balance warning email.
   *
   * This method should be called by credit-related business
   * logic after a credit deduction causes the balance to reach
   * the configured low-balance threshold.
   *
   * @param email Recipient email address.
   * @param currentBalance Current user credit balance.
   */
  async sendLowCreditBalanceEmail(
    email: string,
    currentBalance: number,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Low Credit Balance - Nexora AI',
      html: this.buildEmailTemplate(
        'Low Credit Balance',
        `
          <p>Your Nexora AI credit balance is running low.</p>

          <p>
            <strong>Current Balance:</strong>
            ${currentBalance} credits
          </p>

          <p>
            Please purchase more credits if you want to continue
            generating premium project ideas.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends an administrator email alert.
   *
   * Used when an administrator sends a notification email
   * to one user or broadcasts it to all users.
   *
   * @param email Recipient email address.
   * @param subject Email subject.
   * @param message Email body.
   * @param fullName Optional recipient full name.
   */
  async sendAdminAlertEmail(
    email: string,
    subject: string,
    message: string,
    fullName?: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject,
      html: this.buildEmailTemplate(
        subject,
        `
          <p>Hello ${fullName ?? 'User'},</p>

          <p>${message}</p>

          <br />

          <p>Regards,</p>

          <p>Nexora AI Team</p>
        `,
      ),
    });
  }
}