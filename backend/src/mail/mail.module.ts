import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Mail module.
 *
 * Provides email-sending services that can be reused
 * across application modules.
 *
 * @author Eman
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule { }
