import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';

/**
 * Root application module.
 *
 * Imports and configures the application's feature modules,
 * controllers, and services.
 */
@Module({
  imports: [AuthModule, PrismaModule, UsersModule],
  imports: [
    AuthModule,
    PrismaModule,
    UsersModule,
  ],
  imports: [AuthModule, PrismaModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }