import { Body, Controller, Post } from '@nestjs/common';

import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

/**
 * Public controller for Contact Us messages.
 *
 * Base route:
 * /contact
 *
 * @author Malak
 */
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /**
   * Creates a new Contact Us message.
   *
   * Endpoint:
   * POST /contact
   */
  @Post()
  createContactMessage(@Body() body: CreateContactMessageDto) {
    return this.contactService.createContactMessage(body);
  }
}
