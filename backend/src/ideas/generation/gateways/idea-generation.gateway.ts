import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';

import { PrismaService } from '../../../prisma/prisma.service';
import { IdeaGenerationRealtimeService } from '../services/idea-generation-realtime.service';
import type {
  AuthenticatedIdeaGenerationSocket,
  IdeaGenerationRealtimeRunPayload,
  IdeaGenerationRealtimeSnapshot,
  IdeaGenerationRealtimeStagePayload,
  IdeaGenerationRoomAcknowledgement,
  IdeaGenerationRoomRequest,
} from '../types/idea-generation-realtime.types';

/** Public Socket.IO event names used by generation monitoring clients. */
export const IDEA_GENERATION_SOCKET_EVENTS = {
  JOIN_RUN: 'idea-generation.join',
  LEAVE_RUN: 'idea-generation.leave',
  SNAPSHOT: 'idea-generation.snapshot',
  RUN_UPDATED: 'idea-generation.run.updated',
  STAGE_UPDATED: 'idea-generation.stage.updated',
} as const;

type AccessTokenPayload = {
  readonly sub?: string;
  readonly iat?: number;
};

/**
 * Socket.IO gateway exposing authenticated realtime generation progress.
 *
 * Clients connect to `/idea-generation`, provide the access token through
 * `handshake.auth.token`, and explicitly join a run room they own. The gateway
 * never executes or mutates pipeline business logic.
 *
 * @author Malak
 */
@WebSocketGateway({
  namespace: '/idea-generation',
  cors: {
    origin: process.env.FRONTEND_URL?.trim() || true,
    credentials: true,
  },
})
export class IdeaGenerationGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(IdeaGenerationGateway.name);
  private unsubscribeStage?: () => void;
  private unsubscribeRun?: () => void;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: IdeaGenerationRealtimeService,
  ) {}

  onModuleInit(): void {
    this.unsubscribeStage = this.realtime.onStageUpdated((payload) => {
      this.emitStageUpdated(payload);
    });

    this.unsubscribeRun = this.realtime.onRunUpdated((payload) => {
      this.emitRunUpdated(payload);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeStage?.();
    this.unsubscribeRun?.();
  }

  /** Authenticates each connection before any room subscription is accepted. */
  async handleConnection(
    client: AuthenticatedIdeaGenerationSocket,
  ): Promise<void> {
    try {
      client.data.userId = await this.authenticateClient(client);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Socket authentication failed.';

      this.logger.warn(`Rejected generation socket connection: ${message}`);
      client.disconnect(true);
    }
  }

  /** Joins an owned generation room and immediately emits its current snapshot. */
  @SubscribeMessage(IDEA_GENERATION_SOCKET_EVENTS.JOIN_RUN)
  async joinRun(
    @ConnectedSocket() client: AuthenticatedIdeaGenerationSocket,
    @MessageBody() request: IdeaGenerationRoomRequest,
  ): Promise<IdeaGenerationRoomAcknowledgement> {
    const userId = client.data.userId;
    const runId = this.normalizeRunId(request?.runId);

    if (!userId) {
      return this.failure('UNAUTHORIZED', 'Authentication is required.');
    }

    if (!runId) {
      return this.failure(
        'INVALID_IDEA_GENERATION_RUN_ID',
        'A valid generation-run ID is required.',
      );
    }

    const snapshot = await this.loadOwnedSnapshot(userId, runId);

    if (!snapshot) {
      return this.failure(
        'IDEA_GENERATION_RUN_NOT_FOUND',
        'The requested generation run was not found.',
      );
    }

    await client.join(this.roomName(runId));
    client.emit(IDEA_GENERATION_SOCKET_EVENTS.SNAPSHOT, snapshot);

    return { success: true, runId };
  }

  /** Leaves one generation-run room without affecting pipeline execution. */
  @SubscribeMessage(IDEA_GENERATION_SOCKET_EVENTS.LEAVE_RUN)
  async leaveRun(
    @ConnectedSocket() client: AuthenticatedIdeaGenerationSocket,
    @MessageBody() request: IdeaGenerationRoomRequest,
  ): Promise<IdeaGenerationRoomAcknowledgement> {
    const runId = this.normalizeRunId(request?.runId);

    if (!runId) {
      return this.failure(
        'INVALID_IDEA_GENERATION_RUN_ID',
        'A valid generation-run ID is required.',
      );
    }

    await client.leave(this.roomName(runId));

    return { success: true, runId };
  }

  private emitStageUpdated(payload: IdeaGenerationRealtimeStagePayload): void {
    this.server
      .to(this.roomName(payload.runId))
      .emit(IDEA_GENERATION_SOCKET_EVENTS.STAGE_UPDATED, payload);
  }

  private emitRunUpdated(payload: IdeaGenerationRealtimeRunPayload): void {
    this.server
      .to(this.roomName(payload.runId))
      .emit(IDEA_GENERATION_SOCKET_EVENTS.RUN_UPDATED, payload);
  }

  private async authenticateClient(
    client: AuthenticatedIdeaGenerationSocket,
  ): Promise<string> {
    const token = this.extractAccessToken(client);
    const secret = process.env.JWT_ACCESS_SECRET?.trim();

    if (!token || !secret) {
      throw new UnauthorizedException('Unauthorized');
    }

    const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
      token,
      {
        secret,
      },
    );

    if (!payload.sub) {
      throw new UnauthorizedException('Unauthorized');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        isActive: true,
        isVerified: true,
        deletedAt: true,
        passwordChangedAt: true,
      },
    });

    if (
      !user ||
      !user.isActive ||
      !user.isVerified ||
      user.deletedAt ||
      this.wasIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    return user.id;
  }

  private extractAccessToken(
    client: AuthenticatedIdeaGenerationSocket,
  ): string | null {
    const handshakeAuth: unknown = client.handshake.auth;
    const authToken = this.readStringProperty(handshakeAuth, 'token');

    if (authToken) {
      return authToken.replace(/^Bearer\s+/iu, '');
    }

    const authorization = client.handshake.headers.authorization;

    if (typeof authorization !== 'string') {
      return null;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/iu);
    return match?.[1]?.trim() || null;
  }

  /** Safely reads one non-empty string property from an unknown object. */
  private readStringProperty(value: unknown, key: string): string | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const property: unknown = Reflect.get(value, key);

    if (typeof property !== 'string') {
      return null;
    }

    const normalized = property.trim();
    return normalized || null;
  }

  private async loadOwnedSnapshot(
    userId: string,
    runId: string,
  ): Promise<IdeaGenerationRealtimeSnapshot | null> {
    const run = await this.prisma.ideaGenerationRun.findFirst({
        where: { id: runId, userId },
        select: {
          id: true,
          status: true,
          progressPercent: true,
          currentStageKey: true,
          ideaId: true,
          errorCode: true,
          errorMessage: true,
          completedAt: true,
          stages: {
            orderBy: { sequence: 'asc' },
            select: {
              runId: true,
              stageKey: true,
              displayName: true,
              sequence: true,
              status: true,
              progressPercent: true,
              attemptCount: true,
              maxAttempts: true,
              resultPreview: true,
              errorMessage: true,
              startedAt: true,
              completedAt: true,
              updatedAt: true,
            },
          },
        },
      });

    if (!run) {
      return null;
    }

    return {
      runId: run.id,
      status: run.status,
      progressPercent: run.progressPercent,
      currentStageKey: run.currentStageKey,
      ideaId: run.ideaId,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      completedAt: run.completedAt,
      stages: run.stages.map((stage) => ({
        runId: stage.runId,
        stageKey: stage.stageKey,
        displayName: stage.displayName,
        sequence: stage.sequence,
        status: stage.status,
        progressPercent: stage.progressPercent,
        attemptCount: stage.attemptCount,
        maxAttempts: stage.maxAttempts,
        resultPreview: this.normalizeResultPreview(stage.resultPreview),
        errorMessage: stage.errorMessage,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        updatedAt: stage.updatedAt,
      })),
    };
  }

  /**
   * Converts Prisma JSON preview values into the string form expected by
   * realtime clients.
   */
  private normalizeResultPreview(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized || null;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private wasIssuedBeforePasswordChange(
    issuedAtSeconds: number | undefined,
    passwordChangedAt: Date | null,
  ): boolean {
    if (!passwordChangedAt) {
      return false;
    }

    if (issuedAtSeconds === undefined) {
      return true;
    }

    return issuedAtSeconds * 1_000 < passwordChangedAt.getTime();
  }

  private roomName(runId: string): string {
    return `idea-generation:${runId}`;
  }

  private normalizeRunId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

    return uuidV4.test(normalized) ? normalized : null;
  }

  private failure(
    code: string,
    message: string,
  ): IdeaGenerationRoomAcknowledgement {
    return {
      success: false,
      error: { code, message },
    };
  }
}