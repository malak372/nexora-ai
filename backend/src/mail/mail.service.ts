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
 * Service responsible for sending Nexora AI application emails.
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
    port: this.smtpPort,
    secure: this.smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
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

      throw new InternalServerErrorException('Failed to send email.');
    }
  }

  /**
   * Builds a consistent HTML layout for Nexora AI emails.
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
              <strong>Nexora AI</strong>.
              Please do not reply to this email.
            </p>

            <p style="
              margin-top:8px;
              margin-bottom:0;
              font-size:13px;
              color:#6b7280;
            ">
              Need help? You can contact the Nexora AI team
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
      subject: 'Reset your Nexora AI password',
      text: `
Nexora AI Password Reset

Hello,

A password reset request was received for your Nexora AI account.

If you requested this change, open the link below:
${resetLink}

This link expires in 15 minutes.

If you did not request this password reset, you can safely ignore this email.

This email was sent automatically by Nexora AI.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Nexora AI Password Reset',
        `
          <p>Hello,</p>

          <p>
            A password reset request was received for your
            Nexora AI account.
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
      subject: 'Welcome to Nexora AI',
      text: `
Welcome to Nexora AI, ${fullName.trim() || 'User'}!

Your account has been created and verified successfully.

You now have 3 free idea generations to start discovering software project ideas.

This email was sent automatically by Nexora AI.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        `Welcome, ${safeFullName}`,
        `
          <p>
            Your Nexora AI account has been created and
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
   * Sends an email-verification link.
   *
   * Used after registration or when a user requests another
   * verification email.
   *
   * @param email Recipient email address.
   * @param verificationLink Email-verification URL.
   */
  async sendVerificationEmail(
    email: string,
    verificationLink: string,
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify your Nexora AI email',
      text: `
Nexora AI Email Verification

Please verify your email address using the link below:

${verificationLink}

If you did not create this account, you can safely ignore this email.

This email was sent automatically by Nexora AI.
Please do not reply.
      `.trim(),
      html: this.buildEmailTemplate(
        'Email Verification',
        `
          <p>
            Please verify your email address by clicking
            the button below:
          </p>

          ${this.buildActionButton('Verify Email', verificationLink)}

          <p>
            If you did not create this account, you can
            safely ignore this email.
          </p>
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
      subject: 'Nexora AI Payment Receipt',
      text: `
Nexora AI Payment Receipt

Your payment has been completed successfully.

Amount: ${formattedAmount}
Payment Method: ${formattedMethod}
Purpose: ${formattedPurpose}
Transaction Reference: ${transactionReference?.trim() || 'N/A'}

Thank you for using Nexora AI.

This email was sent automatically by Nexora AI.
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
            Thank you for using Nexora AI.
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
      'Your payment could not be completed. Please verify your payment details or try again using another available payment method. If the problem persists, contact your payment provider or Nexora AI support.';

    const formattedAmount = this.formatAmount(amount, currency);

    const formattedMethod = this.formatPaymentMethod(paymentMethodKey);

    const formattedPurpose = this.formatPaymentPurpose(paymentPurpose);

    const normalizedTransactionReference =
      transactionReference?.trim() || 'N/A';

    await this.sendEmail({
      to: email,
      subject: 'Nexora AI Payment Failed',
      text: `
Nexora AI Payment Failed

Unfortunately, your payment could not be completed.

Amount: ${formattedAmount}
Payment Method: ${formattedMethod}
Purpose: ${formattedPurpose}
Transaction Reference: ${normalizedTransactionReference}
Reason: ${safeFailureReason}

No credits were added and no idea was unlocked.

Please try again or use another available payment method.

This email was sent automatically by Nexora AI.
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
      subject: 'Credits Added to Your Nexora AI Account',
      text: `
Nexora AI Credits Added

Your credits have been added successfully.

Purchased Credits: ${creditsAmount}
Bonus Credits: ${bonusCredits}
Current Balance: ${currentBalance}

You can now use your credits to generate premium project ideas.

This email was sent automatically by Nexora AI.
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
          ? 'Credit Balance Exhausted - Nexora AI'
          : 'Low Credit Balance - Nexora AI',
      text: `
Nexora AI Credit Balance

${balanceMessage}

Current Balance: ${currentBalance} credits

Please purchase more credits to continue generating premium project ideas.

This email was sent automatically by Nexora AI.
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
    const normalizedSubject = subject.trim() || 'Nexora AI Notification';

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
Nexora AI Team

This email was sent automatically by Nexora AI.
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
            <strong>Nexora AI Team</strong>
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
      subject: `Nexora AI Support - ${normalizedSubject}`,
      text: `
Dear ${recipientName},

Thank you for contacting Nexora AI.

We have reviewed your inquiry regarding:
${normalizedSubject}

The Nexora AI Support Team has provided the following reply:

${normalizedReply}

If you require additional assistance, please submit another Contact Us request through the Nexora AI platform.

Sincerely,
Nexora AI Support Team

This email was sent by Nexora AI Support.
Please do not reply directly to this email.
      `.trim(),
      html: this.buildEmailTemplate(
        'Response to Your Contact Request',
        `
          <p>Dear ${safeRecipientName},</p>

          <p>
            Thank you for contacting
            <strong>Nexora AI</strong>.
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
            The Nexora AI Support Team has provided
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
            request through the Nexora AI platform.
          </p>

          <p>
            Sincerely,<br />
            <strong>Nexora AI Support Team</strong>
          </p>
        `,
      ),
    });
  }
}
