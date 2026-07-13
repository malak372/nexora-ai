import { Body, Controller, Post } from '@nestjs/common';

import { CreateContactMessageDto } from '../dto/create-contact-message.dto';

import { ContactMessagesService } from '../services/contact-messages.service';

/**
 * Public Contact Us controller.
 *
 * Base route:
 * /contact
 *
 * This endpoint is accessible to guests and authenticated users.
 *
 * @author Malak
 */
@Controller('contact')
export class ContactMessagesController {
  constructor(
    private readonly contactMessagesService: ContactMessagesService,
  ) {}

  /**
   * Creates one Contact Us message.
   *
   * POST /contact
   */
  @Post()
  createContactMessage(@Body() body: CreateContactMessageDto) {
    return this.contactMessagesService.createContactMessage(body);
  }
}
