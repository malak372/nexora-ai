/**
 * Live idea-generation progress page.
 *
 * The backend remains authoritative for run status and percentage. Visual
 * interpolation only smooths abrupt server updates. Cancellation is cooperative:
 * after the request succeeds, the UI shows "Cancellation requested" until the
 * backend reaches CANCELLED at the next safe checkpoint. Visual styling uses
 * the Voxidence eucalyptus-and-rose identity without changing pipeline data.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, LayoutDashboard, Radio, RefreshCw, Sparkles, X } from 'lucide-react';
import { motion } from 'framer-motion';

import { cancelGenerationRun } from '../api/ideaGenerationApi';
import CompletionCelebration from '../components/CompletionCelebration';
import PipelineStage from '../components/PipelineStage';
import { COMPLETED_RUN_STATUSES, TERMINAL_RUN_STATUSES } from '../constants/generation.constants';
import { useIdeaGenerationSocket } from '../hooks/useIdeaGenerationSocket';
import { clearActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import { getVisualPipeline } from '../utils/pipeline.utils';
import { invalidatePaymentPricingCache } from '../../payments/api/paymentFlowApi';
import '../styles/generation.css';


export default function GenerationProgressPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialRun = location.state?.initialRun ?? null;
  const { run, connectionState, error, errorStatus, refresh } = useIdeaGenerationSocket(runId, initialRun);
  const syncedPremiumRunRef = useRef(null);
  const displayedProgress = Math.max(
    0,
    Math.min(100, Number(run?.progressPercent ?? 0)),
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const backendPipeline = useMemo(
    () => getVisualPipeline(
      run?.stages ?? [],
      run?.currentStageKey ?? null,
      run?.status ?? 'QUEUED',
    ),
    [run?.currentStageKey, run?.stages, run?.status],
  );

  const pipeline = backendPipeline;

  const isComplete = COMPLETED_RUN_STATUSES.has(run?.status) && Boolean(run?.ideaId);
  const isTerminal = TERMINAL_RUN_STATUSES.has(run?.status);
  const activeStage = pipeline.find((stage) => stage.status === 'active') ?? null;
  const preparingStage = pipeline.find((stage) => stage.key === 'prepare');
  const preparingStageKeys = preparingStage?.stageKeys ?? [];
  const currentStageKey = run?.currentStageKey ?? null;
  const isFailedRun = run?.status === 'FAILED';
  const hasMovedBeyondPreparing =
    isFailedRun ||
    (Boolean(currentStageKey) && !preparingStageKeys.includes(currentStageKey));
  const canCancel = !isTerminal && (preparingStage?.status === 'completed' || hasMovedBeyondPreparing);


  useEffect(() => {
    if (run?.cancelRequestedAt) setCancelRequested(true);
    if (TERMINAL_RUN_STATUSES.has(run?.status)) clearActiveGenerationRunId();
  }, [run?.cancelRequestedAt, run?.status]);

  useEffect(() => {
    if (
      !isComplete ||
      run?.generationType !== 'PREMIUM_CREDIT' ||
      syncedPremiumRunRef.current === runId
    ) {
      return;
    }

    syncedPremiumRunRef.current = runId;
    invalidatePaymentPricingCache();
    window.dispatchEvent(new CustomEvent('voxidence :credits-updated'));
  }, [isComplete, run?.generationType, runId]);

  const handleCancel = async () => {
    if (isCancelling || isTerminal || !canCancel) return;

    const confirmed = window.confirm(
      'Cancel this generation? The pipeline will stop at its next safe checkpoint.',
    );
    if (!confirmed) return;

    setIsCancelling(true);
    setCancelError('');

    try {
      const result = await cancelGenerationRun(runId, 'Cancelled from the generation progress screen.');
      setCancelRequested(Boolean(result?.cancellationRequested || result?.alreadyRequested));
      await refresh();

      // Cooperative cancellation may need a few seconds to reach CANCELLED.
      window.setTimeout(() => refresh(), 1200);
      window.setTimeout(() => refresh(), 3000);
    } catch (requestError) {
      setCancelError(
        requestError?.response?.data?.message || requestError?.message || 'Could not request cancellation.',
      );
    } finally {
      setIsCancelling(false);
    }
  };

  if (!run && error) {
    const isMissing = errorStatus === 404;
    const isForbidden = errorStatus === 403;

    return (
      <div className="nx-generation-loading nx-generation-loading--error">
        <AlertCircle size={34} />
        <strong>{isMissing ? 'Generation run not found' : isForbidden ? 'Access denied' : 'Could not load this generation run'}</strong>
        <p>{error}</p>
        <div className="nx-generation-error-actions">
          <button type="button" onClick={() => navigate('/normal/dashboard')}><ArrowLeft size={16} />Back to dashboard</button>
          {!isMissing && !isForbidden ? <button type="button" onClick={refresh}><RefreshCw size={16} />Try again</button> : null}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="nx-generation-loading">
        <RefreshCw className="nx-spin" />
        <strong>Connecting to your generation run...</strong>
      </div>
    );
  }

  return (
    <main className="nx-generation-progress nx-generation-progress--horizontal">
      <div className="nx-generation-progress__toolbar">
        <button type="button" className="nx-dashboard-return" onClick={() => navigate('/normal/dashboard')}>
          <ArrowLeft size={17} />
          <LayoutDashboard size={17} />
          <span>Back to dashboard</span>
        </button>
        <span className="nx-run-reference">Run <b>{String(runId).slice(0, 8)}</b></span>
      </div>

      <section className="nx-generation-progress__hero nx-generation-progress__hero--compact">
        <div className="nx-progress-compact-main">
          <div className="nx-progress-compact-kicker">
            <Sparkles size={14} />
            <span>Evidence-led generation</span>
          </div>

          <h1>Building your idea.</h1>
          <p>Voxidence is moving through the evidence pipeline automatically. You can leave this page and come back anytime.</p>
        </div>

        <div className="nx-progress-compact-status" aria-label="Current generation status">
          <span className="nx-progress-compact-spinner" aria-hidden="true">
            <RefreshCw className="nx-spin" size={22} />
          </span>

          <div className="nx-progress-compact-stage">
            <small>Now working on</small>
            <strong>{activeStage?.title ?? 'Waiting for backend start'}</strong>
          </div>

          <span className={`nx-progress-compact-live ${connectionState === 'connected' ? 'is-live' : 'is-reconnecting'}`}>
            <i />
            {connectionState === 'connected' ? 'Live' : 'Reconnecting'}
          </span>
        </div>
      </section>

      <section className="nx-horizontal-pipeline-card">
        <div className="nx-horizontal-pipeline-card__head">
          <div>
            <span>LIVE PIPELINE</span>
            <h2>Generation progress</h2>
          </div>


        </div>

        <div className="nx-horizontal-pipeline" role="list" aria-label="Idea-generation milestones">
          {pipeline.map((stage, index) => (
            <PipelineStage key={stage.key} stage={stage} index={index} isLast={index === pipeline.length - 1} />
          ))}
        </div>

        <div className="nx-progress-track" aria-label={`Generation ${Math.round(displayedProgress)} percent complete`}>
          <motion.span animate={{ width: `${displayedProgress}%` }} transition={{ duration: 0.28, ease: 'easeOut' }} />
        </div>

        <div className="nx-pipeline-meta">
          <p><Radio size={17} />You can leave this page while generation continues. The backend keeps the run durable.</p>
          {!isTerminal ? (
            <button
              className={`nx-cancel-run ${cancelRequested ? 'is-requested' : ''}`}
              type="button"
              onClick={handleCancel}
              disabled={isCancelling || cancelRequested || isTerminal || !canCancel}
            >
              {isCancelling ? <RefreshCw className="nx-spin" size={16} /> : <X size={16} />}
              {isCancelling ? 'Requesting cancellation...' : cancelRequested ? 'Cancellation requested' : !canCancel ? 'Available after Preparing' : 'Cancel generation'}
            </button>
          ) : null}
        </div>

        {cancelError ? <div className="nx-cancel-error"><AlertCircle size={17} /><span>{cancelError}</span></div> : null}
      </section>

      {run.errorMessage ? (
        <div className="nx-run-error">
          <strong>{run.errorCode ?? 'Generation failed'}</strong>
          <p>{run.errorMessage}</p>
          <button type="button" onClick={refresh}>Retry status check</button>
        </div>
      ) : null}

      {isComplete ? (
        <CompletionCelebration
          ideaId={run.ideaId}
          ideaTitle={run.idea?.title}
          isPremium={run?.generationType === 'PREMIUM_CREDIT'}
          onOpenIdea={(ideaId) => navigate(`/normal/ideas/${ideaId}`, { replace: true })}
        />
      ) : null}
    </main>
  );
}