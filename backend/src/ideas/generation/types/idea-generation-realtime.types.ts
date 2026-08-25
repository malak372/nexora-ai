import {
  IdeaGenerationRunStatus,
  IdeaGenerationStageStatus,
  IdeaGenerationType,
} from '@prisma/client';
import type { Socket } from 'socket.io';

/**
 * Mutable data attached to one authenticated idea-generation socket.
 *
 * Socket.IO's default data type is `any`. Supplying this explicit type keeps
 * authentication state fully type-safe and prevents unsafe member access.
 *
 * @author Malak
 */
export type IdeaGenerationSocketData = {
  userId?: string;
};

/**
 * Snapshot sent immediately after a user joins one generation-run room.
 *
 * @author Malak
 */
export type IdeaGenerationRealtimeSnapshot = {
  readonly runId: string;
  readonly generationType: IdeaGenerationType;
  readonly status: IdeaGenerationRunStatus;
  readonly progressPercent: number;
  readonly currentStageKey: string | null;
  readonly ideaId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
  readonly stages: readonly IdeaGenerationRealtimeStagePayload[];
};

/**
 * Stable payload emitted whenever a persisted pipeline stage changes state.
 *
 * @author Malak
 */
export type IdeaGenerationRealtimeStagePayload = {
  readonly runId: string;
  readonly stageKey: string;
  readonly displayName: string;
  readonly sequence: number;
  readonly status: IdeaGenerationStageStatus;
  readonly progressPercent: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly resultPreview: unknown;
  readonly errorMessage: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
};

/**
 * Payload emitted whenever the parent generation run changes lifecycle state.
 *
 * @author Malak
 */
export type IdeaGenerationRealtimeRunPayload = {
  readonly runId: string;
  readonly generationType?: IdeaGenerationType;
  readonly status: IdeaGenerationRunStatus;
  readonly progressPercent: number;
  readonly currentStageKey: string | null;
  readonly ideaId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly cancelRequestedAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
};

/**
 * Client request used to join or leave a run-specific Socket.IO room.
 *
 * @author Malak
 */
export type IdeaGenerationRoomRequest = {
  readonly runId: string;
};

/**
 * Standard acknowledgement returned by room subscription operations.
 *
 * @author Malak
 */
export type IdeaGenerationRoomAcknowledgement = {
  readonly success: boolean;
  readonly runId?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
};

/** Events accepted by the gateway from connected clients. */
type IdeaGenerationClientToServerEvents = {
  'idea-generation.join': (
    request: IdeaGenerationRoomRequest,
    acknowledge?: (result: IdeaGenerationRoomAcknowledgement) => void,
  ) => void;
  'idea-generation.leave': (
    request: IdeaGenerationRoomRequest,
    acknowledge?: (result: IdeaGenerationRoomAcknowledgement) => void,
  ) => void;
};

/** Events emitted by the gateway to connected clients. */
type IdeaGenerationServerToClientEvents = {
  'idea-generation.snapshot': (payload: IdeaGenerationRealtimeSnapshot) => void;
  'idea-generation.run.updated': (
    payload: IdeaGenerationRealtimeRunPayload,
  ) => void;
  'idea-generation.stage.updated': (
    payload: IdeaGenerationRealtimeStagePayload,
  ) => void;
};

/** Internal Socket.IO server events; currently no custom events are required. */
type IdeaGenerationInterServerEvents = {
  healthCheck: () => void;
};

/**
 * Authenticated Socket.IO connection used by idea-generation monitoring.
 *
 * The fourth Socket.IO generic explicitly defines `client.data`, avoiding the
 * library default of `any` while preserving strongly typed emitted events.
 *
 * @author Malak
 */
export type AuthenticatedIdeaGenerationSocket = Socket<
  IdeaGenerationClientToServerEvents,
  IdeaGenerationServerToClientEvents,
  IdeaGenerationInterServerEvents,
  IdeaGenerationSocketData
>;