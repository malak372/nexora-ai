import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PaymentPurpose } from '@prisma/client';
import * as nodemailer from 'nodemailer';

/**
 * Options required to send an email.
 *
 * Both HTML and plain-text content may be provided.
 * Supplying a plain-text version improves compatibility
 * with email clients that do not render HTML.
 */
type EmailOptions = {
  /**
   * Recipient email address.
   */
  readonly to: string;

  /**
   * Email subject.
   */
  readonly subject: string;

  /**
   * Complete HTML email content.
   */
  readonly html: string;

  /**
   * Optional plain-text alternative.
   */
  readonly text?: string;
};

/**
 * Service responsible for sending Voxidence application emails.
 *
 * Centralizes email-delivery logic used across the system,
 * including:
 * - Authentication.
 * - Payments.
 * - Credit management.
 * - Administrator alerts.
 * - Contact-message replies.
 *
 * The service uses:
 * - One shared SMTP transporter.
 * - One internal sending method.
 * - One unified HTML template.
 * - Shared HTML escaping for dynamic content.
 *
 * Supported email flows:
 * - Password reset.
 * - Welcome email.
 * - Email verification.
 * - Successful payment receipt.
 * - Failed payment notification.
 * - Credit purchase confirmation.
 * - Low credit balance warning.
 * - Administrator alert.
 * - Contact Us reply.
 *
 * @author Eman
 * @author Malak
 */
@Injectable()
export class MailService {
  /**
   * Logger used to record SMTP failures without exposing
   * provider details to the API consumer.
   */
  private readonly logger = new Logger(MailService.name);

  /**
   * SMTP port parsed from the application environment.
   *
   * Port 465 commonly uses an immediately secured TLS connection,
   * while ports such as 587 usually start without immediate TLS
   * and upgrade through STARTTLS.
   */
  private readonly smtpPort = Number(process.env.SMTP_PORT);

  /**
   * Shared Nodemailer SMTP transporter.
   *
   * The transporter is created once with the service rather than
   * being recreated for every outgoing email.
   */
  private readonly transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: this.smtpPort || 587,
    secure: this.smtpPort === 465,
    requireTLS: this.smtpPort !== 465,
    auth: {
      user: process.env.SMTP_USER?.trim(),
      pass: process.env.SMTP_PASS?.replace(/\s+/g, ''),
    },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized:
        process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
  });

  /**
   * Sends an email using the configured SMTP transporter.
   *
   * This is the only method that communicates directly with
   * Nodemailer. All public email methods delegate to this method
   * to keep sender configuration and error handling centralized.
   *
   * SMTP error details are written to the application logs.
   * A generic exception is returned to prevent exposing SMTP
   * credentials or provider-specific information.
   *
   * @param options Email-delivery options.
   * @throws InternalServerErrorException when delivery fails.
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
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to send email to ${options.to}: ${errorMessage}`,
        errorStack,
      );

      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * Builds a consistent HTML layout for Voxidence emails.
   *
   * The provided title and content must already be escaped when
   * they contain dynamic or user-provided values.
   *
   * The shared layout contains:
   * - Main content container.
   * - Email heading.
   * - Dynamic message content.
   * - Automated-message notice.
   * - Support instructions.
   *
   * @param title Safe email heading.
   * @param content Safe email body HTML.
   * @returns Complete HTML email document.
   */
  private buildEmailTemplate(title: string, content: string): string {
    return `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <title>${title}</title>
        </head>

        <body style="
          margin:0;
          padding:16px;
          background:#f8fafc;
        ">
          <div style="
            font-family:Arial, Helvetica, sans-serif;
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
              <strong>Voxidence</strong>.
              Please do not reply to this email.
            </p>

            <p style="
              margin-top:8px;
              margin-bottom:0;
              font-size:13px;
              color:#6b7280;
            ">
              Need help? You can contact the Voxidence team
              through the Complaints or Contact Us section
              in the platform.
            </p>
          </div>
        </body>
      </html>
    `.trim();
  }

  /**
   * Builds a styled email action button.
   *
   * The URL is escaped before being included in the HTML
   * attribute to prevent malformed markup.
   *
   * @param label Button text.
   * @param url Button destination URL.
   * @returns HTML anchor styled as an action button.
   */
  private buildActionButton(label: string, url: string): string {
    const safeLabel = this.escapeHtml(label);
    const safeUrl = this.escapeHtml(url);

    return `
      <a
        href="${safeUrl}"
        style="
          display:inline-block;
          padding:12px 24px;
          background:#2563eb;
          color:#ffffff;
          text-decoration:none;
          border-radius:6px;
          margin:12px 0;
          font-weight:600;
        "
      >
        ${safeLabel}
      </a>
    `;
  }

  /**
   * Escapes a dynamic string before inserting it into HTML.
   *
   * This prevents user-provided content from being interpreted
   * as HTML markup inside outgoing emails.
   *
   * Characters escaped:
   * - Ampersand.
   * - Less-than sign.
   * - Greater-than sign.
   * - Double quotation mark.
   * - Single quotation mark.
   *
   * @param value Raw dynamic value.
   * @returns HTML-safe string.
   */
  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /**
   * Converts a payment-purpose enum value into a readable label.
   *
   * @param paymentPurpose Payment purpose stored in Prisma.
   * @returns User-friendly payment-purpose label.
   */
  private formatPaymentPurpose(paymentPurpose: PaymentPurpose): string {
    switch (paymentPurpose) {
      case PaymentPurpose.BUY_CREDITS:
        return 'Credit Purchase';

      case PaymentPurpose.DIRECT_UNLOCK:
        return 'Direct Idea Unlock';

      default:
        return paymentPurpose;
    }
  }

  /**
   * Converts a payment-method key into a readable label.
   *
   * Examples:
   * - card -> Card
   * - paypal -> Paypal
   * - local_wallet -> Local Wallet
   *
   * @param paymentMethodKey Payment method registry key.
   * @returns Human-readable payment-method name.
   */
  private formatPaymentMethod(paymentMethodKey: string): string {
    return paymentMethodKey
      .trim()
      .replaceAll('-', ' ')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  /**
   * Formats a monetary value for display.
   *
   * Falls back to a simple amount-and-currency representation
   * when the supplied currency is not recognized.
   *
   * @param amount Payment amount.
   * @param currency ISO currency code.
   * @returns Formatted monetary value.
   */
  private formatAmount(amount: number, currency: string): string {
    const normalizedCurrency = currency.trim().toUpperCase();

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: normalizedCurrency,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${normalizedCurrency}`;
    }
  }

  /**
   * Sends a password-reset email.
   *
   * Used by the authentication module after a user requests
   * a password reset.
   *
   * @param email Recipient email address.
   * @param resetLink Password-reset URL.
   */
  async sendPasswordResetEmail(
    email: string,
    resetLink: string,
  ): Promise<void> {
    const safeResetLink = this.escapeHtml(resetLink);

    await this.sendEmail({
      to: email,
      subject: 'Reset your Voxidence password',
      text: `
Voxidence Password Reset

Hello,

A password reset request was received for your Voxidence account.

If you requested this change, open the link below:
${resetLink}

This link expires in 15 minutes.

If you did not request this password reset, you can safely ignore this email.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Voxidence Password Reset',
        `
          <p>Hello,</p>

          <p>
            A password reset request was received for your
            Voxidence account.
          </p>

          <p>
            If you requested this change, click the button below.
            Otherwise, you can safely ignore this email.
          </p>

          ${this.buildActionButton('Reset Password', resetLink)}

          <p>
            This link expires in
            <strong>15 minutes</strong>.
          </p>

          <p>
            If the button does not work, copy and paste this
            link into your browser:
          </p>

          <p style="word-break:break-all;">
            <a href="${safeResetLink}">
              ${safeResetLink}
            </a>
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
  async sendWelcomeEmail(email: string, fullName: string): Promise<void> {
    const safeFullName = this.escapeHtml(fullName.trim()) || 'User';

    await this.sendEmail({
      to: email,
      subject: 'Welcome to Voxidence',
      text: `
Welcome to Voxidence, ${fullName.trim() || 'User'}!

Your account has been created and verified successfully.

You now have 3 free idea generations to start discovering software project ideas.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        `Welcome, ${safeFullName}`,
        `
          <p>
            Your Voxidence account has been created and
            verified successfully.
          </p>

          <p>
            You now have
            <strong>3 free idea generations</strong>
            to start discovering software project ideas.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends an email-verification code.
   *
   * Used after registration or when a user requests another
   * verification email.
   *
   * @param email Recipient email address.
   * @param verificationCode Six-digit verification code.
   * @param expiresInMinutes Code lifetime in minutes.
   */
  async sendVerificationEmail(
    email: string,
    verificationCode: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const safeCode = this.escapeHtml(verificationCode);

    await this.sendEmail({
      to: email,
      subject: 'Your Voxidence verification code',
      text: `Voxidence email verification code: ${verificationCode}. The code expires in ${expiresInMinutes} minutes. If you did not create this account, ignore this email.`,
      html: this.buildEmailTemplate(
        'Verify your email',
        `
          <p>Enter this code in Voxidence to verify your email address:</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:10px;text-align:center;padding:20px;background:#f1f5f9;border-radius:10px;margin:22px 0;color:#0f172a;">
            ${safeCode}
          </div>
          <p>This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
          <p>If you did not create this account, you can safely ignore this email.</p>
        `,
      ),
    });
  }

  /** Sends the first approval code to the account's current email address. */
  async sendCurrentEmailChangeApprovalCode(
    currentEmail: string,
    fullName: string,
    newEmail: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const safeName = this.escapeHtml(fullName);
    const safeNewEmail = this.escapeHtml(newEmail);
    const safeCode = this.escapeHtml(code);

    await this.sendEmail({
      to: currentEmail,
      subject: 'Approve your Voxidence email change',
      text: `Hello ${fullName}, use code ${code} to approve changing your Voxidence sign-in email to ${newEmail}. The code expires in ${expiresInMinutes} minutes. If you did not request this, do not share the code.`,
      html: this.buildEmailTemplate(
        'Approve your email change',
        `
          <p>Hello <strong>${safeName}</strong>,</p>
          <p>A request was made to change your Voxidence sign-in email to:</p>
          <p style="font-weight:700;">${safeNewEmail}</p>
          <p>Use this code to approve the request:</p>
          <div style="font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;padding:18px;background:#f1f5f9;border-radius:8px;margin:20px 0;">
            ${safeCode}
          </div>
          <p>This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
          <p><strong>If you did not request this change, do not share the code and change your password.</strong></p>
        `,
      ),
    });
  }

  /** Sends the second ownership-verification code to the requested new address. */
  async sendNewEmailChangeVerificationCode(
    newEmail: string,
    fullName: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const safeName = this.escapeHtml(fullName);
    const safeCode = this.escapeHtml(code);

    await this.sendEmail({
      to: newEmail,
      subject: 'Verify your new Voxidence email',
      text: `Hello ${fullName}, your Voxidence new-email verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      html: this.buildEmailTemplate(
        'Verify your new email',
        `
          <p>Hello <strong>${safeName}</strong>,</p>
          <p>The current account email approved this change.</p>
          <p>Use this code to verify this address as your new Voxidence sign-in email:</p>
          <div style="font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;padding:18px;background:#f1f5f9;border-radius:8px;margin:20px 0;">
            ${safeCode}
          </div>
          <p>This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
          <p>If you did not expect this message, do not share the code.</p>
        `,
      ),
    });
  }

  /** Notifies the previous address after an email change succeeds. */
  async sendEmailChangedNotice(
    oldEmail: string,
    fullName: string,
    newEmail: string,
  ): Promise<void> {
    const safeName = this.escapeHtml(fullName);
    const safeNewEmail = this.escapeHtml(newEmail);

    await this.sendEmail({
      to: oldEmail,
      subject: 'Your Voxidence email was changed',
      text: `Hello ${fullName}, the sign-in email for your Voxidence account was changed to ${newEmail}. If this was not you, contact support immediately.`,
      html: this.buildEmailTemplate(
        'Your email was changed',
        `
          <p>Hello <strong>${safeName}</strong>,</p>
          <p>The sign-in email for your Voxidence account was changed to:</p>
          <p style="font-weight:700;">${safeNewEmail}</p>
          <p>If you made this change, no further action is required.</p>
          <p><strong>If you did not make this change, contact Voxidence support immediately and change your password.</strong></p>
        `,
      ),
    });
  }

  /**
   * Sends a payment receipt after a payment is confirmed
   * as SUCCEEDED.
   *
   * The payment method is represented by a registry key because
   * Payment.paymentMethodKey is stored as a String in Prisma.
   *
   * @param email Recipient email address.
   * @param amount Paid amount.
   * @param currency Payment currency.
   * @param paymentMethodKey Payment method registry key.
   * @param paymentPurpose Purpose of the payment.
   * @param transactionReference Optional provider transaction reference.
   */
  async sendPaymentReceipt(
    email: string,
    amount: number,
    currency: string,
    paymentMethodKey: string,
    paymentPurpose: PaymentPurpose,
    transactionReference?: string,
  ): Promise<void> {
    const formattedAmount = this.formatAmount(amount, currency);

    const formattedMethod = this.formatPaymentMethod(paymentMethodKey);

    const formattedPurpose = this.formatPaymentPurpose(paymentPurpose);

    const safeTransactionReference = this.escapeHtml(
      transactionReference?.trim() || 'N/A',
    );

    await this.sendEmail({
      to: email,
      subject: 'Voxidence Payment Receipt',
      text: `
Voxidence Payment Receipt

Your payment has been completed successfully.

Amount: ${formattedAmount}
Payment Method: ${formattedMethod}
Purpose: ${formattedPurpose}
Transaction Reference: ${transactionReference?.trim() || 'N/A'}

Thank you for using Voxidence.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Payment Successful',
        `
          <p>
            Your payment has been completed successfully.
          </p>

          <p>
            <strong>Amount:</strong>
            ${this.escapeHtml(formattedAmount)}
          </p>

          <p>
            <strong>Payment Method:</strong>
            ${this.escapeHtml(formattedMethod)}
          </p>

          <p>
            <strong>Purpose:</strong>
            ${this.escapeHtml(formattedPurpose)}
          </p>

          <p>
            <strong>Transaction Reference:</strong>
            ${safeTransactionReference}
          </p>

          <p>
            Thank you for using Voxidence.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends a notification after a payment is confirmed
   * as FAILED.
   *
   * Provider failure details are intentionally not included in
   * the recipient email because they may contain technical or
   * sensitive payment-provider information.
   *
   * The original failure reason remains accepted for compatibility
   * with payment-processing callers and internal logging.
   *
   * @param email Recipient email address.
   * @param amount Attempted payment amount.
   * @param currency Payment currency.
   * @param paymentMethodKey Payment method registry key.
   * @param paymentPurpose Purpose of the attempted payment.
   * @param _failureReason Internal provider failure reason.
   * @param transactionReference Optional transaction reference.
   */
  async sendPaymentFailedEmail(
    email: string,
    amount: number,
    currency: string,
    paymentMethodKey: string,
    paymentPurpose: PaymentPurpose,
    _failureReason?: string,
    transactionReference?: string,
  ): Promise<void> {
    const safeFailureReason =
      'Your payment could not be completed. Please verify your payment details or try again using another available payment method. If the problem persists, contact your payment provider or Voxidence support.';

    const formattedAmount = this.formatAmount(amount, currency);

    const formattedMethod = this.formatPaymentMethod(paymentMethodKey);

    const formattedPurpose = this.formatPaymentPurpose(paymentPurpose);

    const normalizedTransactionReference =
      transactionReference?.trim() || 'N/A';

    await this.sendEmail({
      to: email,
      subject: 'Voxidence Payment Failed',
      text: `
Voxidence Payment Failed

Unfortunately, your payment could not be completed.

Amount: ${formattedAmount}
Payment Method: ${formattedMethod}
Purpose: ${formattedPurpose}
Transaction Reference: ${normalizedTransactionReference}
Reason: ${safeFailureReason}

No credits were added and no idea was unlocked.

Please try again or use another available payment method.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Payment Failed',
        `
          <p>
            Unfortunately, your payment could not be completed.
          </p>

          <p>
            <strong>Amount:</strong>
            ${this.escapeHtml(formattedAmount)}
          </p>

          <p>
            <strong>Payment Method:</strong>
            ${this.escapeHtml(formattedMethod)}
          </p>

          <p>
            <strong>Purpose:</strong>
            ${this.escapeHtml(formattedPurpose)}
          </p>

          <p>
            <strong>Transaction Reference:</strong>
            ${this.escapeHtml(normalizedTransactionReference)}
          </p>

          <p>
            <strong>Reason:</strong>
            ${this.escapeHtml(safeFailureReason)}
          </p>

          <p>
            No credits were added and no idea was unlocked.
          </p>

          <p>
            Please try again or use another available
            payment method.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends a credit-purchase confirmation.
   *
   * This method should be called only after:
   * - The payment is confirmed.
   * - Purchased credits are added.
   * - Bonus credits are calculated and added.
   * - The final balance is persisted.
   *
   * @param email Recipient email address.
   * @param creditsAmount Number of purchased credits.
   * @param bonusCredits Number of granted bonus credits.
   * @param currentBalance Balance after the credit purchase.
   */
  async sendCreditPurchaseEmail(
    email: string,
    creditsAmount: number,
    bonusCredits: number,
    currentBalance: number,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Credits Added to Your Voxidence Account',
      text: `
Voxidence Credits Added

Your credits have been added successfully.

Purchased Credits: ${creditsAmount}
Bonus Credits: ${bonusCredits}
Current Balance: ${currentBalance}

You can now use your credits to generate premium project ideas.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Credits Added Successfully',
        `
          <p>
            Your credits have been added successfully.
          </p>

          <p>
            <strong>Purchased Credits:</strong>
            ${creditsAmount}
          </p>

          <p>
            <strong>Bonus Credits:</strong>
            ${bonusCredits}
          </p>

          <p>
            <strong>Current Balance:</strong>
            ${currentBalance}
          </p>

          <p>
            You can now use your credits to generate
            premium project ideas.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends a low-credit-balance warning.
   *
   * This method should be triggered by credit-related business
   * logic after a deduction reaches the configured warning level.
   *
   * The service does not decide what balance is considered low;
   * that decision belongs to the credit domain.
   *
   * @param email Recipient email address.
   * @param currentBalance Current user credit balance.
   */
  async sendLowCreditBalanceEmail(
    email: string,
    currentBalance: number,
  ): Promise<void> {
    const balanceMessage =
      currentBalance === 0
        ? 'Your credit balance is exhausted.'
        : 'Your credit balance is running low.';

    await this.sendEmail({
      to: email,
      subject:
        currentBalance === 0
          ? 'Credit Balance Exhausted - Voxidence'
          : 'Low Credit Balance - Voxidence',
      text: `
Voxidence Credit Balance

${balanceMessage}

Current Balance: ${currentBalance} credits

Please purchase more credits to continue generating premium project ideas.

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        currentBalance === 0
          ? 'Credit Balance Exhausted'
          : 'Low Credit Balance',
        `
          <p>
            ${this.escapeHtml(balanceMessage)}
          </p>

          <p>
            <strong>Current Balance:</strong>
            ${currentBalance} credits
          </p>

          <p>
            Please purchase more credits to continue
            generating premium project ideas.
          </p>
        `,
      ),
    });
  }

  /**
   * Sends an email alert created by an administrator.
   *
   * Dynamic administrator-provided values are escaped before
   * being inserted into the HTML template.
   *
   * @param email Recipient email address.
   * @param subject Email subject.
   * @param message Administrator-provided alert message.
   * @param fullName Optional recipient full name.
   */
  async sendAdminAlertEmail(
    email: string,
    subject: string,
    message: string,
    fullName?: string,
  ): Promise<void> {
    const normalizedSubject = subject.trim() || 'Voxidence Notification';

    const normalizedMessage = message.trim();

    const recipientName = fullName?.trim() || 'User';

    const safeSubject = this.escapeHtml(normalizedSubject);

    const safeMessage = this.escapeHtml(normalizedMessage);

    const safeRecipientName = this.escapeHtml(recipientName);

    await this.sendEmail({
      to: email,
      subject: normalizedSubject,
      text: `
Hello ${recipientName},

${normalizedMessage}

Regards,
Voxidence Team

This email was sent automatically by Voxidence.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        safeSubject,
        `
          <p>Hello ${safeRecipientName},</p>

          <div style="white-space:pre-line;">
            ${safeMessage}
          </div>

          <p style="margin-top:24px;">
            Regards,<br />
            <strong>Voxidence Team</strong>
          </p>
        `,
      ),
    });
  }

  /**
   * Sends an email reply for a Contact Us message.
   *
   * Used when an administrator responds to a contact message
   * from the administration panel.
   *
   * ContactMessagesService remains responsible for:
   * - Saving the administrator reply.
   * - Updating the contact-message status.
   * - Creating the appropriate audit record.
   *
   * This method is responsible only for email delivery.
   *
   * @param email Recipient email address.
   * @param fullName Recipient full name.
   * @param originalSubject Original contact-message subject.
   * @param reply Administrator reply content.
   */
  async sendContactReplyEmail(
    email: string,
    fullName: string,
    originalSubject: string,
    reply: string,
  ): Promise<void> {
    const normalizedReply = reply.trim();

    const recipientName = fullName.trim() || 'User';

    const normalizedSubject = originalSubject.trim() || 'Contact Request';

    const safeRecipientName = this.escapeHtml(recipientName);

    const safeSubject = this.escapeHtml(normalizedSubject);

    const safeReply = this.escapeHtml(normalizedReply);

    await this.sendEmail({
      to: email,
      subject: `Voxidence Support - ${normalizedSubject}`,
      text: `
Dear ${recipientName},

Thank you for contacting Voxidence.

We have reviewed your inquiry regarding:
${normalizedSubject}

The Voxidence Support Team has provided the following reply:

${normalizedReply}

If you require additional assistance, please submit another Contact Us request through the Voxidence platform.

Sincerely,
Voxidence Support Team

This email was sent by Voxidence Support.
Please do not reply directly to this email.
      `.trim(),
      html: this.buildEmailTemplate(
        'Response to Your Contact Request',
        `
          <p>Dear ${safeRecipientName},</p>

          <p>
            Thank you for contacting
            <strong>Voxidence</strong>.
            We have reviewed your inquiry regarding:
          </p>

          <p style="
            margin:12px 0 20px;
            font-weight:600;
            color:#111827;
          ">
            ${safeSubject}
          </p>

          <p>
            The Voxidence Support Team has provided
            the following reply:
          </p>

          <div style="
            background:#f8fafc;
            border:1px solid #dbeafe;
            border-left:4px solid #2563eb;
            padding:16px;
            border-radius:6px;
            margin:20px 0;
            white-space:pre-line;
          ">
            ${safeReply}
          </div>

          <p>
            If you require additional assistance or have
            further questions, please submit another Contact Us
            request through the Voxidence platform.
          </p>

          <p>
            Sincerely,<br />
            <strong>Voxidence Support Team</strong>
          </p>
        `,
      ),
    });
  }
}