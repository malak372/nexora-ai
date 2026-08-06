/**
 * Converts detailed backend checkpoints into six stable visual milestones.
 *
 * Rules:
 * - currentStageKey is authoritative.
 * - only one visual milestone may be active.
 * - stale RUNNING rows from delayed snapshots never create a second spinner.
 * - every group before the active group is shown as completed.
 */
import {
  BACKEND_STAGE_TO_VISUAL_INDEX,
  VISUAL_PIPELINE_GROUPS,
} from "../constants/generation.constants";

const COMPLETE_STATUSES = new Set(["COMPLETED", "SUCCEEDED", "SKIPPED"]);
const ACTIVE_STATUSES = new Set(["RUNNING", "IN_PROGRESS", "STARTED"]);
const FAILED_STATUSES = new Set(["FAILED"]);

function getStageKey(stage) {
  return stage?.stageKey ?? stage?.key ?? null;
}

function getStageStatus(stage) {
  return String(stage?.status ?? "").toUpperCase();
}

function resolveActiveGroupIndex(stageMap, currentStageKey) {
  let resolved = BACKEND_STAGE_TO_VISUAL_INDEX.get(currentStageKey);
  resolved = Number.isInteger(resolved) ? resolved : -1;

  /*
   * Always reconcile with the furthest live/completed backend checkpoint.
   * This protects the UI when currentStageKey is persisted a few seconds later
   * than the stage row or when one socket run-update event is missed.
   */
  for (const [stageKey, stage] of stageMap.entries()) {
    const status = getStageStatus(stage);
    if (
      !ACTIVE_STATUSES.has(status) &&
      !COMPLETE_STATUSES.has(status)
    ) {
      continue;
    }

    const index = BACKEND_STAGE_TO_VISUAL_INDEX.get(stageKey);
    if (Number.isInteger(index)) resolved = Math.max(resolved, index);
  }

  return resolved;
}

export function getVisualPipeline(
  stages = [],
  currentStageKey = null,
  runStatus = 'RUNNING',
) {
  const normalizedStages = Array.isArray(stages) ? stages : [];
  const stageMap = new Map(
    normalizedStages
      .map((stage) => [getStageKey(stage), stage])
      .filter(([key]) => Boolean(key)),
  );

  const resolvedActiveGroupIndex = resolveActiveGroupIndex(
    stageMap,
    currentStageKey,
  );
  const hasConfirmedBackendActivity =
    resolvedActiveGroupIndex >= 0 ||
    normalizedStages.some((stage) => {
      const status = getStageStatus(stage);
      return ACTIVE_STATUSES.has(status) || COMPLETE_STATUSES.has(status);
    });
  const activeGroupIndex = hasConfirmedBackendActivity
    ? resolvedActiveGroupIndex
    : -1;

  return VISUAL_PIPELINE_GROUPS.map((group, groupIndex) => {
    const matchingStages = group.stageKeys
      .map((key) => stageMap.get(key))
      .filter(Boolean);

    const hasFailure = matchingStages.some((stage) =>
      FAILED_STATUSES.has(getStageStatus(stage)),
    );

    const hasCompletedCheckpoint = matchingStages.some((stage) =>
      COMPLETE_STATUSES.has(getStageStatus(stage)),
    );

    const allKnownStagesComplete =
      matchingStages.length > 0 &&
      matchingStages.every((stage) =>
        COMPLETE_STATUSES.has(getStageStatus(stage)),
      );

    let status = "waiting";
    if (hasFailure) {
      status = "failed";
    } else if (groupIndex === activeGroupIndex) {
      status = "active";
    } else if (
      groupIndex < activeGroupIndex ||
      allKnownStagesComplete ||
      (activeGroupIndex < 0 && hasCompletedCheckpoint)
    ) {
      status = "completed";
    }

    const preview = [...matchingStages]
      .reverse()
      .find((stage) => stage?.resultPreview)?.resultPreview ?? null;

    return {
      ...group,
      status,
      stages: matchingStages,
      preview,
    };
  });
}

export function normalizeGenerationStartResponse(response) {
  return {
    runId:
      response?.runId ??
      response?.id ??
      response?.run?.id ??
      response?.data?.runId ??
      null,
    status:
      response?.status ??
      response?.run?.status ??
      response?.data?.status ??
      null,
  };
}
