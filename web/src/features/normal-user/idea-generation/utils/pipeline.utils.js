/**
 * Visual pipeline helpers.
 *
 * @author Malak
 */

import { VISUAL_PIPELINE_GROUPS } from "../constants/generation.constants";

const COMPLETE_STATUSES = new Set(["COMPLETED", "SUCCEEDED", "SKIPPED"]);
const ACTIVE_STATUSES = new Set(["RUNNING", "IN_PROGRESS", "STARTED"]);
const FAILED_STATUSES = new Set(["FAILED"]);

export function getVisualPipeline(stages = [], currentStageKey = null) {
  const stageMap = new Map(
    stages.map((stage) => [stage.stageKey ?? stage.key, stage]),
  );

  return VISUAL_PIPELINE_GROUPS.map((group) => {
    const matchingStages = group.stageKeys
      .map((key) => stageMap.get(key))
      .filter(Boolean);

    const hasFailure = matchingStages.some((stage) =>
      FAILED_STATUSES.has(stage.status),
    );

    const isActive =
      group.stageKeys.includes(currentStageKey) ||
      matchingStages.some((stage) => ACTIVE_STATUSES.has(stage.status));

    const isComplete =
      matchingStages.length > 0 &&
      matchingStages.every((stage) => COMPLETE_STATUSES.has(stage.status));

    let status = "waiting";

    if (hasFailure) status = "failed";
    else if (isActive) status = "active";
    else if (isComplete) status = "completed";

    return {
      ...group,
      status,
      stages: matchingStages,
      preview:
        [...matchingStages]
          .reverse()
          .find((stage) => stage.resultPreview)?.resultPreview ?? null,
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
