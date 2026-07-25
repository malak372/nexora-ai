import { Injectable } from '@nestjs/common';
import type { IdeaGenerationRun, IdeaGenerationStage } from '@prisma/client';
import { EventEmitter } from 'node:events';

import type {
  IdeaGenerationRealtimeRunPayload,
  IdeaGenerationRealtimeStagePayload,
} from '../types/idea-generation-realtime.types';

/** Internal application event names used by the generation gateway. */
export const IDEA_GENERATION_REALTIME_INTERNAL_EVENTS = {
  RUN_UPDATED: 'idea-generation.run.updated',
  STAGE_UPDATED: 'idea-generation.stage.updated',
} as const;

/**
 * Application-level event publisher for idea-generation realtime updates.
 *
 * The pipeline publishes immutable snapshots through this service after a
 * database write succeeds. It does not depend on Socket.IO and therefore keeps
 * transport concerns outside the generation business workflow.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationRealtimeService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Multiple gateway listeners may be registered during tests or hot reload.
    this.emitter.setMaxListeners(25);
  }

  /** Publishes one persisted stage snapshot. */
  publishStageUpdated(stage: IdeaGenerationStage): void {
    this.emitter.emit(
      IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.STAGE_UPDATED,
      this.mapStage(stage),
    );
  }

  /** Publishes one persisted generation-run snapshot. */
  publishRunUpdated(run: IdeaGenerationRun): void {
    this.emitter.emit(
      IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.RUN_UPDATED,
      this.mapRun(run),
    );
  }

  /** Registers a listener for stage updates and returns an unsubscribe hook. */
  onStageUpdated(
    listener: (payload: IdeaGenerationRealtimeStagePayload) => void,
  ): () => void {
    this.emitter.on(
      IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.STAGE_UPDATED,
      listener,
    );

    return () => {
      this.emitter.off(
        IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.STAGE_UPDATED,
        listener,
      );
    };
  }

  /** Registers a listener for run updates and returns an unsubscribe hook. */
  onRunUpdated(
    listener: (payload: IdeaGenerationRealtimeRunPayload) => void,
  ): () => void {
    this.emitter.on(
      IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.RUN_UPDATED,
      listener,
    );

    return () => {
      this.emitter.off(
        IDEA_GENERATION_REALTIME_INTERNAL_EVENTS.RUN_UPDATED,
        listener,
      );
    };
  }

  private mapStage(
    stage: IdeaGenerationStage,
  ): IdeaGenerationRealtimeStagePayload {
    return {
      runId: stage.runId,
      stageKey: stage.stageKey,
      displayName: stage.displayName,
      sequence: stage.sequence,
      status: stage.status,
      progressPercent: stage.progressPercent,
      attemptCount: stage.attemptCount,
      maxAttempts: stage.maxAttempts,
      resultPreview: stage.resultPreview,
      errorMessage: stage.errorMessage,
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      updatedAt: stage.updatedAt,
    };
  }

  private mapRun(run: IdeaGenerationRun): IdeaGenerationRealtimeRunPayload {
    return {
      runId: run.id,
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
    };
  }
}
