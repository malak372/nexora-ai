import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for shared user operations.
 *
 * This service provides reusable functionality
 * shared across user services.
 *
 * @author Eman
 */
@Injectable()
export class UserCommonService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Finds a user by ID.
     *
     * @param userId - User ID.
     * @returns The user record.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async findUserOrThrow(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }
}