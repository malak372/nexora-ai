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
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock3, LayoutDashboard, Radio, RefreshCw, X } from 'lucide-react';
import { motion } from 'framer-motion';

import { cancelGenerationRun } from '../api/ideaGenerationApi';
import CompletionCelebration from '../components/CompletionCelebration';
import PipelineStage from '../components/PipelineStage';
import { COMPLETED_RUN_STATUSES, TERMINAL_RUN_STATUSES } from '../constants/generation.constants';
import { useIdeaGenerationSocket } from '../hooks/useIdeaGenerationSocket';
import { clearActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import { getVisualPipeline } from '../utils/pipeline.utils';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import '../styles/generation.css';

function useSmoothBackendProgress(value) {
  const target = Math.max(0, Math.min(100, Number(value ?? 0)));
  const [displayed, setDisplayed] = useState(target);
  const frameRef = useRef(null);
  const currentRef = useRef(target);

  useEffect(() => {
    const animate = () => {
      const distance = target - currentRef.current;
      if (Math.abs(distance) < 0.06) {
        currentRef.current = target;
        setDisplayed(target);
        return;
      }
      const speed = Math.min(0.11, Math.max(0.045, Math.abs(distance) / 240));
      currentRef.current += distance * speed;
      setDisplayed(currentRef.current);
      frameRef.current = requestAnimationFrame(animate);
    };

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target]);

  return displayed;
}

export default function GenerationProgressPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { run, connectionState, error, errorStatus, refresh } = useIdeaGenerationSocket(runId);
  const { isPremium } = useAccountAccess();
  const displayedProgress = useSmoothBackendProgress(run?.progressPercent);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pipeline = useMemo(
    () => getVisualPipeline(run?.stages ?? [], run?.currentStageKey ?? null),
    [run?.currentStageKey, run?.stages],
  );

  const isComplete = COMPLETED_RUN_STATUSES.has(run?.status) && Boolean(run?.ideaId);
  const isTerminal = TERMINAL_RUN_STATUSES.has(run?.status);
  const completedCount = pipeline.filter((stage) => stage.status === 'completed').length;
  const activeStage = pipeline.find((stage) => stage.status === 'active') ?? pipeline[0];
  const preparingStage = pipeline.find((stage) => stage.key === 'prepare');
  const preparingStageKeys = preparingStage?.stageKeys ?? [];
  const currentStageKey = run?.currentStageKey ?? null;
  const hasMovedBeyondPreparing = Boolean(currentStageKey) && !preparingStageKeys.includes(currentStageKey);
  const canCancel = !isTerminal && (preparingStage?.status === 'completed' || hasMovedBeyondPreparing);


  useEffect(() => {
    if (isTerminal) return undefined;

    const startedAt = run?.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };

    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [isTerminal, run?.startedAt]);

  useEffect(() => {
    if (run?.cancelRequestedAt) setCancelRequested(true);
    if (TERMINAL_RUN_STATUSES.has(run?.status)) clearActiveGenerationRunId();
  }, [run?.cancelRequestedAt, run?.status]);

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

      <section className="nx-generation-progress__hero">
        <div className="nx-generation-progress__hero-copy">
          <span className="nx-kicker">
            <Radio size={14} />
            {connectionState === 'connected' ? 'Live generation' : 'Reconnecting safely'}
          </span>

          <h1>Your idea is taking shape.</h1>

          <div className="nx-generation-progress__current">
            <span>{String(activeStage?.number ?? 1).padStart(2, '0')}</span>
            <div>
              <small>Now working on</small>
              <strong>{activeStage?.title ?? 'Preparing'}</strong>
            </div>
          </div>
        </div>

        <div className="nx-progress-summary-card">
          <div className="nx-progress-ring" style={{ '--progress': `${displayedProgress * 3.6}deg` }}>
            <strong>{Math.round(displayedProgress)}%</strong>
            <span>{run.status}</span>
          </div>

          <div className="nx-progress-summary-card__copy">
            <small>Elapsed time</small>
            <b>{elapsedSeconds}s</b>
            <span><Clock3 size={13} />Live backend progress</span>
          </div>
        </div>
      </section>

      <section className="nx-horizontal-pipeline-card">
        <div className="nx-horizontal-pipeline-card__head">
          <div>
            <span>LIVE PIPELINE</span>
            <h2>Generation progress</h2>
          </div>

          <div className="nx-stage-counter">
            <b>{completedCount}</b>
            <span>of {pipeline.length} complete</span>
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
          <p><Clock3 size={17} />You can leave this page while generation continues.</p>
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
          isPremium={isPremium}
          onOpenIdea={(ideaId) => navigate(`/normal/ideas/${ideaId}`, { replace: true })}
        />
      ) : null}
    </main>
  );
}