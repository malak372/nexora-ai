import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';

type InvoiceTransaction = Prisma.TransactionClient | PrismaService;

type InvoiceProviderSnapshot = {
  readonly providerPaymentId?: string | null;
  readonly providerSessionId?: string | null;
  readonly transactionReference?: string | null;
  readonly occurredAt?: Date | null;
  readonly invoiceUrl?: string | null;
  readonly receiptUrl?: string | null;
};

/**
 * Creates, repairs, and reads immutable invoice snapshots.
 *
 * Design guarantees:
 * - Every successful payment owns at most one invoice.
 * - Webhook retries are idempotent through the unique paymentId constraint.
 * - Successful payments created before the invoice feature are backfilled.
 * - Missing provider-hosted URLs never prevent an internal Voxidence invoice.
 *
 * @author Eman
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or repairs the invoice for one verified successful payment.
   *
   * This method can run inside the payment transaction. It is safe to call
   * repeatedly because Invoice.paymentId is unique and the write uses upsert.
   */
  async createForSuccessfulPayment(
    paymentId: string,
    confirmation: PaymentConfirmation,
    database: InvoiceTransaction,
  ) {
    return this.ensureInvoiceForPayment(
      paymentId,
      {
        providerPaymentId: confirmation.providerPaymentId,
        providerSessionId: confirmation.providerSessionId,
        transactionReference: confirmation.providerPaymentId,
        occurredAt: confirmation.occurredAt,
        invoiceUrl: confirmation.metadata?.invoiceUrl ?? null,
        receiptUrl: confirmation.metadata?.receiptUrl ?? null,
      },
      database,
    );
  }

  /**
   * Ensures an invoice exists when a repeated successful webhook is received.
   *
   * The payment may already be SUCCEEDED, so fulfillment must not run again,
   * but a missing invoice still needs to be repaired.
   */
  async ensureForAlreadySuccessfulPayment(
    paymentId: string,
    confirmation: PaymentConfirmation,
    database: InvoiceTransaction,
  ) {
    return this.ensureInvoiceForPayment(
      paymentId,
      {
        providerPaymentId: confirmation.providerPaymentId,
        providerSessionId: confirmation.providerSessionId,
        transactionReference: confirmation.providerPaymentId,
        occurredAt: confirmation.occurredAt,
        invoiceUrl: confirmation.metadata?.invoiceUrl ?? null,
        receiptUrl: confirmation.metadata?.receiptUrl ?? null,
      },
      database,
    );
  }

  /**
   * Backfills invoices for successful historical payments owned by one user.
   *
   * This runs before billing history is returned. Therefore payments completed
   * before the invoice feature was deployed appear automatically without a
   * manual database script.
   */
  async synchronizeMissingInvoicesForUser(userId: string) {
    const missingPayments = await this.prisma.payment.findMany({
      where: {
        userId,
        status: PaymentStatus.SUCCEEDED,
        invoice: null,
      },
      orderBy: [
        { paidAt: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
      },
    });

    let created = 0;
    const failed: Array<{ paymentId: string; reason: string }> = [];

    for (const payment of missingPayments) {
      try {
        await this.ensureInvoiceForPayment(payment.id, {}, this.prisma);
        created += 1;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown invoice error';

        failed.push({
          paymentId: payment.id,
          reason,
        });

        this.logger.error(
          `Unable to backfill invoice for payment ${payment.id}: ${reason}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return {
      scanned: missingPayments.length,
      created,
      failed,
    };
  }

  /** Returns paginated invoices belonging only to the authenticated user. */
  async listForUser(userId: string, page = 1, limit = 10) {
    const synchronization =
      await this.synchronizeMissingInvoicesForUser(userId);

    const safePage = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1);
    const safeLimit = Math.min(
      50,
      Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 10),
    );
    const where: Prisma.InvoiceWhereInput = { userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: { issuedAt: 'desc' },
        select: this.invoiceSelect,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items,
      synchronization,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  /** Returns one invoice after enforcing invoice ownership. */
  async getForUser(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      select: this.invoiceSelect,
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  /** Builds a real PDF invoice for download without HTML conversion. */
  async buildDownloadDocument(userId: string, invoiceId: string) {
    const invoice = await this.getForUser(userId, invoiceId);
    const amount = `${invoice.amount.toFixed(2)} ${invoice.currency}`;
    const purpose = this.describePurpose(invoice.paymentPurpose);
    const provider = invoice.providerKey.toUpperCase();
    const issuedAt = new Date(invoice.issuedAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const reference =
      invoice.transactionReference ||
      invoice.providerPaymentId ||
      invoice.paymentId;

    const commands = [
      '0.18 0.25 0.24 rg',
      'BT /F2 30 Tf 52 770 Td (VOXIDENCE) Tj ET',
      '0.14 0.44 0.42 rg',
      'BT /F1 11 Tf 52 748 Td (Official payment invoice) Tj ET',
      '0.90 0.96 0.95 rg',
      '430 750 112 30 re f',
      '0.09 0.48 0.35 rg',
      `BT /F2 11 Tf 449 761 Td (${this.escapePdfText(invoice.status)}) Tj ET`,
      '0.82 0.89 0.87 RG',
      '52 720 m 543 720 l S',
      '0.18 0.25 0.24 rg',
      'BT /F2 22 Tf 52 682 Td (Invoice) Tj ET',
      '0.37 0.48 0.45 rg',
      `BT /F1 12 Tf 52 660 Td (${this.escapePdfText(invoice.invoiceNumber)}) Tj ET`,
      ...this.pdfInfoBox(52, 560, 235, 76, 'Billed to', invoice.customerName, invoice.customerEmail),
      ...this.pdfInfoBox(308, 560, 235, 76, 'Issued', issuedAt, `${provider} - ${invoice.paymentMethodKey}`),
      ...this.pdfInfoBox(52, 462, 235, 76, 'Payment purpose', purpose, ''),
      ...this.pdfInfoBox(308, 462, 235, 76, 'Transaction reference', reference, ''),
      '0.24 0.63 0.60 rg',
      '52 360 491 70 re f',
      '1 1 1 rg',
      'BT /F1 17 Tf 72 389 Td (Total paid) Tj ET',
      `BT /F2 24 Tf 420 384 Td (${this.escapePdfText(amount)}) Tj ET`,
      '0.09 0.48 0.35 rg',
      'BT /F2 12 Tf 52 313 Td (Verified provider confirmation) Tj ET',
      '0.37 0.48 0.45 rg',
      'BT /F1 10 Tf 52 294 Td (Voxidence stores no card or wallet credentials.) Tj ET',
      '0.50 0.58 0.56 rg',
      'BT /F1 9 Tf 52 92 Td (Generated automatically after verified payment confirmation.) Tj ET',
      `BT /F1 9 Tf 52 76 Td (${this.escapePdfText(`Invoice ID: ${invoice.id}`)}) Tj ET`,
    ];

    return this.createPdfBuffer(commands.join('\n'));
  }

  private pdfInfoBox(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    primary: string,
    secondary: string,
  ) {
    const commands = [
      '0.97 0.99 0.98 rg',
      `${x} ${y} ${width} ${height} re f`,
      '0.50 0.58 0.56 rg',
      `BT /F1 9 Tf ${x + 14} ${y + height - 20} Td (${this.escapePdfText(label)}) Tj ET`,
      '0.14 0.36 0.34 rg',
      `BT /F2 11 Tf ${x + 14} ${y + height - 42} Td (${this.escapePdfText(primary)}) Tj ET`,
    ];

    if (secondary) {
      commands.push(
        '0.43 0.52 0.49 rg',
        `BT /F1 9 Tf ${x + 14} ${y + 12} Td (${this.escapePdfText(secondary)}) Tj ET`,
      );
    }

    return commands;
  }

  private escapePdfText(value: unknown) {
    return String(value ?? '')
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .slice(0, 92);
  }

  private createPdfBuffer(content: string) {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ];

    let document = '%PDF-1.4\n%Voxidence\n';
    const offsets = [0];

    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(document, 'latin1'));
      document += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(document, 'latin1');
    document += `xref\n0 ${objects.length + 1}\n`;
    document += '0000000000 65535 f \n';
    offsets.slice(1).forEach((offset) => {
      document += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(document, 'latin1');
  }

  /**
   * Central idempotent invoice writer used by webhooks and historical backfill.
   */
  private async ensureInvoiceForPayment(
    paymentId: string,
    provider: InvoiceProviderSnapshot,
    database: InvoiceTransaction,
  ) {
    const payment = await database.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        amount: true,
        currency: true,
        status: true,
        providerKey: true,
        paymentMethodKey: true,
        paymentPurpose: true,
        providerPaymentId: true,
        providerSessionId: true,
        transactionReference: true,
        paidAt: true,
        createdAt: true,
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new Error(
        `Invoice cannot be created for payment ${payment.id} with status ${payment.status}.`,
      );
    }

    const issuedAt =
      payment.paidAt ??
      provider.occurredAt ??
      payment.createdAt;

    const providerPaymentId =
      provider.providerPaymentId ??
      payment.providerPaymentId;

    const providerSessionId =
      provider.providerSessionId ??
      payment.providerSessionId;

    const transactionReference =
      provider.transactionReference ??
      payment.transactionReference ??
      providerPaymentId;

    return database.invoice.upsert({
      where: {
        paymentId: payment.id,
      },
      create: {
        invoiceNumber: this.buildInvoiceNumber(payment.id, issuedAt),
        paymentId: payment.id,
        userId: payment.userId,
        status: InvoiceStatus.ISSUED,
        providerKey: payment.providerKey,
        paymentMethodKey: payment.paymentMethodKey,
        paymentPurpose: payment.paymentPurpose,
        amount: payment.amount,
        currency: payment.currency,
        customerName: payment.user.fullName,
        customerEmail: payment.user.email,
        providerPaymentId,
        providerSessionId,
        transactionReference,
        providerInvoiceUrl: provider.invoiceUrl ?? null,
        providerReceiptUrl: provider.receiptUrl ?? null,
        issuedAt,
      },
      update: {
        providerPaymentId: providerPaymentId ?? undefined,
        providerSessionId: providerSessionId ?? undefined,
        transactionReference: transactionReference ?? undefined,
        providerInvoiceUrl: provider.invoiceUrl ?? undefined,
        providerReceiptUrl: provider.receiptUrl ?? undefined,
      },
    });
  }

  private buildInvoiceNumber(paymentId: string, issuedAt: Date) {
    const date = issuedAt.toISOString().slice(0, 10).replace(/-/g, '');
    return `NX-${date}-${paymentId.slice(0, 8).toUpperCase()}`;
  }

  private describePurpose(purpose: PaymentPurpose) {
    const labels: Record<PaymentPurpose, string> = {
      BUY_CREDITS: 'Credits purchase',
      DIRECT_UNLOCK: 'Advanced idea unlock',
      ACCEPT_PUBLICATION: 'Publication acceptance',
      UNLOCK_PUBLICATION_ADVANCED: 'Advanced publication unlock',
    };

    return labels[purpose];
  }

  private readonly invoiceSelect = {
    id: true,
    invoiceNumber: true,
    paymentId: true,
    status: true,
    providerKey: true,
    paymentMethodKey: true,
    paymentPurpose: true,
    amount: true,
    currency: true,
    customerName: true,
    customerEmail: true,
    providerPaymentId: true,
    providerSessionId: true,
    transactionReference: true,
    providerInvoiceUrl: true,
    providerReceiptUrl: true,
    issuedAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.InvoiceSelect;
}