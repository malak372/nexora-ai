/**
 * Local fallback storage for the latest active idea-generation run.
 * The backend remains the source of truth.
 */
const ACTIVE_GENERATION_RUN_KEY = 'nexora_active_generation_run_id';

export function saveActiveGenerationRunId(runId) {
    if (!runId) return;
    localStorage.setItem(ACTIVE_GENERATION_RUN_KEY, runId);
}

export function getActiveGenerationRunId() {
    return localStorage.getItem(ACTIVE_GENERATION_RUN_KEY);
}

export function clearActiveGenerationRunId() {
    localStorage.removeItem(ACTIVE_GENERATION_RUN_KEY);
}
