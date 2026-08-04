import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { InvoiceService } from '../services/invoice.service';

/** 
 * Authenticated invoice and billing-history endpoints.
 * @author Eman
 */
@Controller('users/invoices')
@UseGuards(JwtAuthGuard)
export class UserInvoicesController {
  constructor(private readonly invoiceService: InvoiceService) { }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.invoiceService.listForUser(
      user.id,
      Number(page || 1),
      Number(limit || 10),
    );
  }



  /**
   * Repairs missing invoices for historical successful payments.
   *
   * This endpoint is safe to call repeatedly because paymentId is unique
   * on the Invoice model.
   */
  @Post('synchronize')
  synchronize(@CurrentUser() user: AuthenticatedUser) {
    return this.invoiceService.synchronizeMissingInvoicesForUser(user.id);
  }

  @Get(':invoiceId')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.invoiceService.getForUser(user.id, invoiceId);
  }

  @Get(':invoiceId/download')
  @Header('Content-Type', 'application/pdf')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Res() response: Response,
  ) {
    const invoice = await this.invoiceService.getForUser(user.id, invoiceId);
    const document = await this.invoiceService.buildDownloadDocument(user.id, invoiceId);
    response.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    response.send(document);
  }
}