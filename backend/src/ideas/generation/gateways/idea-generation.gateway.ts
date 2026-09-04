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

type CorsOriginCallback = (error: Error | null, allow?: boolean) => void;


type GenerationRunWatcher = {
  readonly ownerId: string;
  readonly subscribers: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  lastFingerprint: string;
  polling: boolean;
};

const configuredGenerationOrigins = new Set(
  [
    process.env.FRONTEND_URL ?? '',
    process.env.APP_FRONTEND_URL ?? '',
    'https://voxidence.web.app',
  ]
    .join(',')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/**
 * Durable fallback cadence for room snapshots.
 *
 * Direct pipeline events remain immediate. This sub-second database watcher is
 * only a safety bridge for deployments where generation work and the WebSocket
 * gateway do not share the same Node.js process (where an in-memory
 * EventEmitter cannot cross the process boundary).
 */
const GENERATION_ROOM_WATCH_INTERVAL_MS = 650;

function isLoopbackGenerationOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function isLocalGenerationOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1') {
      return true;
    }

    if (/^10\./u.test(host) || /^192\.168\./u.test(host)) {
      return true;
    }

    const private172Match = /^172\.(\d{1,2})\./u.exec(host);

    if (!private172Match) {
      return false;
    }

    const secondOctet = Number(private172Match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  } catch {
    return false;
  }
}

function allowIdeaGenerationSocketOrigin(
  origin: string | undefined,
  callback: CorsOriginCallback,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (configuredGenerationOrigins.has(origin)) {
    callback(null, true);
    return;
  }

  if (
    isLoopbackGenerationOrigin(origin) ||
    (process.env.NODE_ENV !== 'production' &&
      isLocalGenerationOrigin(origin))
  ) {
    callback(null, true);
    return;
  }

  callback(
    new Error(`Socket.IO CORS blocked origin: ${origin}`),
    false,
  );
}

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
    origin: allowIdeaGenerationSocketOrigin,
    credentials: true,
  },
})
export class IdeaGenerationGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(IdeaGenerationGateway.name);
  private readonly runWatchers = new Map<string, GenerationRunWatcher>();
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

    for (const watcher of this.runWatchers.values()) {
      if (watcher.timer) {
        clearTimeout(watcher.timer);
      }
    }

    this.runWatchers.clear();
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

  /** Stops durable run watchers when a socket disconnects unexpectedly. */
  handleDisconnect(client: AuthenticatedIdeaGenerationSocket): void {
    for (const [runId, watcher] of this.runWatchers.entries()) {
      if (!watcher.subscribers.delete(client.id)) {
        continue;
      }

      if (watcher.subscribers.size === 0) {
        this.stopRunWatcher(runId);
      }
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

    /*
     * A stage may advance between the ownership read above and room join.
     * Reload after joining so the client receives the newest durable state,
     * while any concurrent realtime event is already captured by the room.
     */
    const latestSnapshot =
      (await this.loadOwnedSnapshot(userId, runId)) ?? snapshot;

    this.watchRun(
      runId,
      userId,
      client.id,
      latestSnapshot,
    );

    client.emit(IDEA_GENERATION_SOCKET_EVENTS.SNAPSHOT, latestSnapshot);

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
    this.unwatchRun(runId, client.id);

    return { success: true, runId };
  }

  /**
   * Keeps one authoritative sub-second snapshot stream alive while at least one
   * client is watching a run.
   *
   * This complements direct realtime events. It intentionally does not replace
   * them: direct events provide zero-wait transitions, while this durable bridge
   * guarantees updates when pipeline execution happens in another process.
   */
  private watchRun(
    runId: string,
    ownerId: string,
    socketId: string,
    initialSnapshot: IdeaGenerationRealtimeSnapshot,
  ): void {
    const existing = this.runWatchers.get(runId);

    if (existing) {
      existing.subscribers.add(socketId);
      return;
    }

    const watcher: GenerationRunWatcher = {
      ownerId,
      subscribers: new Set([socketId]),
      lastFingerprint: this.snapshotFingerprint(initialSnapshot),
      polling: false,
    };

    this.runWatchers.set(runId, watcher);
    this.scheduleRunWatch(runId);
  }

  private unwatchRun(runId: string, socketId: string): void {
    const watcher = this.runWatchers.get(runId);
    if (!watcher) {
      return;
    }

    watcher.subscribers.delete(socketId);

    if (watcher.subscribers.size === 0) {
      this.stopRunWatcher(runId);
    }
  }

  private stopRunWatcher(runId: string): void {
    const watcher = this.runWatchers.get(runId);
    if (!watcher) {
      return;
    }

    if (watcher.timer) {
      clearTimeout(watcher.timer);
    }

    this.runWatchers.delete(runId);
  }

  private scheduleRunWatch(runId: string): void {
    const watcher = this.runWatchers.get(runId);

    if (!watcher || watcher.subscribers.size === 0) {
      return;
    }

    if (watcher.timer) {
      clearTimeout(watcher.timer);
    }

    watcher.timer = setTimeout(() => {
      void this.pollWatchedRun(runId);
    }, GENERATION_ROOM_WATCH_INTERVAL_MS);

    watcher.timer.unref?.();
  }

  private async pollWatchedRun(runId: string): Promise<void> {
    const watcher = this.runWatchers.get(runId);

    if (
      !watcher ||
      watcher.polling ||
      watcher.subscribers.size === 0
    ) {
      return;
    }

    watcher.polling = true;

    try {
      const snapshot = await this.loadOwnedSnapshot(
        watcher.ownerId,
        runId,
      );

      if (!snapshot) {
        this.stopRunWatcher(runId);
        return;
      }

      const fingerprint = this.snapshotFingerprint(snapshot);

      if (fingerprint !== watcher.lastFingerprint) {
        watcher.lastFingerprint = fingerprint;

        this.server
          .to(this.roomName(runId))
          .emit(IDEA_GENERATION_SOCKET_EVENTS.SNAPSHOT, snapshot);
      }

      if (
        snapshot.status === 'COMPLETED' ||
        snapshot.status === 'FAILED' ||
        snapshot.status === 'CANCELLED'
      ) {
        /*
         * Keep one final packet path, then stop polling. Connected clients
         * already hold the terminal snapshot and no further stage transition is
         * possible for this run.
         */
        this.stopRunWatcher(runId);
        return;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown watcher error';

      this.logger.debug(
        `Generation room watcher could not refresh run "${runId}": ${message}`,
      );
    } finally {
      const current = this.runWatchers.get(runId);

      if (current) {
        current.polling = false;
        this.scheduleRunWatch(runId);
      }
    }
  }

  private snapshotFingerprint(
    snapshot: IdeaGenerationRealtimeSnapshot,
  ): string {
    return JSON.stringify([
      snapshot.generationType,
      snapshot.status,
      snapshot.progressPercent,
      snapshot.currentStageKey,
      snapshot.ideaId,
      snapshot.errorCode,
      snapshot.errorMessage,
      snapshot.cancelRequestedAt?.toISOString() ?? null,
      snapshot.startedAt?.toISOString() ?? null,
      snapshot.completedAt?.toISOString() ?? null,
      snapshot.updatedAt.toISOString(),
      ...snapshot.stages.map((stage) => [
        stage.stageKey,
        stage.status,
        stage.progressPercent,
        stage.attemptCount,
        stage.updatedAt.toISOString(),
      ]),
    ]);
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
        generationType: true,
        status: true,
        progressPercent: true,
        currentStageKey: true,
        ideaId: true,
        errorCode: true,
        errorMessage: true,
        cancelRequestedAt: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
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
      generationType: run.generationType,
      status: run.status,
      progressPercent: run.progressPercent,
      currentStageKey: run.currentStageKey,
      ideaId: run.ideaId,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      cancelRequestedAt: run.cancelRequestedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      updatedAt: run.updatedAt,
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
      return '[Unserializable result preview]';
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