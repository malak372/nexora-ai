/**
 * Nexora normal-user discovery dashboard.
 *
 * Payment is intentionally absent from the dashboard. Users generate and review
 * the free result first; Direct Unlock is offered only inside the idea workspace.
 * Upgrade to Premium remains available in the global header.
 */
import {
  ArrowRight,
  BookOpenCheck,
  Bookmark,
  BrainCircuit,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
  Rocket,
  Sparkles,
  Radio,
  Clock3,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getApiErrorMessage } from '../../shared/api/normalUserApi';
import { getActiveGenerationRun } from '../../idea-generation/api/ideaGenerationApi';
import { clearActiveGenerationRunId, saveActiveGenerationRunId } from '../../idea-generation/store/activeGenerationRun.storage';
import { getNormalUserSummary, getPublishedIdeasCount } from '../api/dashboardApi';
import IdeaLauncher from '../components/IdeaLauncher';
import LatestIdeaCard from '../components/LatestIdeaCard';
import MetricCard from '../components/MetricCard';
import DashboardContactSection from '../components/DashboardContactSection';
import '../normal-dashboard.css';

const getFirstName = (fullName) => fullName?.trim().split(/\s+/)[0] || 'there';

const signalNodes = [
  { label: 'Community signals', icon: Sparkles },
  { label: 'NLP intelligence', icon: BrainCircuit },
  { label: 'Multi-model reasoning', icon: Lightbulb },
  { label: 'Validated idea', icon: CheckCircle2 },
];

export default function NormalDashboardPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeRun, setActiveRun] = useState(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [summaryResult, activeRunResult, publishedCount] = await Promise.all([
        getNormalUserSummary(),
        getActiveGenerationRun().catch(() => null),
        getPublishedIdeasCount().catch(() => null),
      ]);
      setSummary({
        ...summaryResult,
        publishedIdeasCount:
          publishedCount ?? summaryResult?.publishedIdeasCount ?? 0,
      });
      setActiveRun(activeRunResult);
      if (activeRunResult?.id) saveActiveGenerationRunId(activeRunResult.id);
      else clearActiveGenerationRunId();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'We could not load your workspace.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const freeGenerations = Number(summary?.remainingFreeGenerations ?? 0);
  const accessMessage = useMemo(() => {
    if (freeGenerations > 1) return `${freeGenerations} free discoveries ready`;
    if (freeGenerations === 1) return 'One free discovery remains';
    return 'Generate and unlock only the idea you choose';
  }, [freeGenerations]);

  const reveal = reduceMotion ? {} : {
    initial: { opacity: 0, y: 34, filter: 'blur(10px)' },
    whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
    viewport: { once: true, amount: 0.16, margin: '0px 0px -70px 0px' },
    transition: { duration: 0.72, ease: [0.22, 1, 0.36, 1] },
  };

  const metricsContainer = reduceMotion ? {} : {
    initial: 'hidden',
    whileInView: 'visible',
    viewport: { once: true, amount: 0.2 },
    variants: {
      hidden: {},
      visible: {
        transition: { staggerChildren: 0.09, delayChildren: 0.05 },
      },
    },
  };

  const metricItem = reduceMotion ? {} : {
    variants: {
      hidden: { opacity: 0, y: 34, scale: 0.965, filter: 'blur(9px)' },
      visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        transition: { duration: 0.56, ease: [0.22, 1, 0.36, 1] },
      },
    },
  };

  if (isLoading) {
    return <div className="normal-dashboard-state" role="status"><span className="normal-dashboard-spinner" /><strong>Preparing your Nexora workspace...</strong></div>;
  }

  if (error) {
    return <div className="normal-dashboard-state"><h2>Workspace unavailable</h2><p>{error}</p><button className="normal-primary-button" type="button" onClick={loadSummary}><RefreshCw size={17} />Try again</button></div>;
  }

  return (
    <div className="normal-dashboard-page normal-dashboard-page--v4">
      <motion.section className="normal-dashboard-hero normal-dashboard-hero--core" {...reveal}>
        <div className="normal-dashboard-hero__mesh" aria-hidden="true" />
        <div className="normal-dashboard-hero__copy">
          <span className="normal-eyebrow"><Sparkles size={14} />Intelligent discovery workspace</span>
          <h1>Welcome back, <span>{getFirstName(summary?.fullName)}.</span></h1>
          <p>Describe a real need. Nexora listens across communities, finds repeated evidence, compares multiple AI candidates, and returns one validated software direction.</p>
          <div className="normal-dashboard-hero__actions">
            <motion.button className="normal-primary-button" type="button" onClick={() => navigate('/normal/generate')} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}><Rocket size={18} />Start discovering</motion.button>
            <button className="normal-secondary-button" type="button" onClick={() => navigate('/normal/ideas')}>Open my ideas <ArrowRight size={17} /></button>
          </div>
          <div className="normal-dashboard-hero__access"><strong>{accessMessage}</strong><span>Review the result first. Direct payment appears only when you choose to unlock that specific idea.</span></div>
        </div>

        <div className="normal-signal-core" aria-label="Animated Nexora intelligence pipeline">
          <motion.div className="normal-signal-core__ring normal-signal-core__ring--one" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 24, ease: 'linear' }} />
          <motion.div className="normal-signal-core__ring normal-signal-core__ring--two" animate={{ rotate: -360 }} transition={{ repeat: Infinity, duration: 17, ease: 'linear' }} />
          <motion.div className="normal-signal-core__beam" animate={{ scaleY: [0.72, 1.12, 0.72], opacity: [0.35, 0.9, 0.35] }} transition={{ repeat: Infinity, duration: 3 }} />
          <motion.div className="normal-signal-core__brain" animate={{ y: [-6, 6, -6], rotate: [-2, 2, -2] }} transition={{ repeat: Infinity, duration: 4.2 }}><BrainCircuit size={55} /><Sparkles size={19} /></motion.div>
          {signalNodes.map(({ label, icon: Icon }, index) => (
            <motion.div key={label} className={`normal-signal-core__node normal-signal-core__node--${index + 1}`} animate={{ y: [0, -7, 0], rotate: [0, index % 2 ? 3 : -3, 0] }} transition={{ repeat: Infinity, duration: 3.2 + index * 0.35, delay: index * 0.22 }} title={label}><Icon size={19} /></motion.div>
          ))}
          {Array.from({ length: 9 }, (_, index) => <motion.i key={index} style={{ '--i': index }} animate={{ opacity: [0.18, 0.85, 0.18], y: [0, -14, 0] }} transition={{ repeat: Infinity, duration: 2.5 + index * 0.1, delay: index * 0.14 }} />)}
          <div className="normal-signal-core__counter"><strong>{freeGenerations}</strong><span>free discoveries</span></div>
        </div>
      </motion.section>

      <motion.section className="normal-dashboard-launch normal-dashboard-launch--v4" {...reveal}>
        <div className="normal-dashboard-launch__heading"><span className="normal-eyebrow">AI discovery prompt</span><h2>What should Nexora investigate?</h2><p>Type naturally or speak. Domain and evidence sources are resolved automatically by the backend.</p></div>
        <IdeaLauncher compact />
      </motion.section>

      <motion.section
        className="normal-dashboard-metrics normal-dashboard-metrics--v4"
        {...metricsContainer}
      >
        <motion.div {...metricItem}><MetricCard icon={Lightbulb} label="Ideas created" value={summary?.ideasCount ?? 0} helper="All generated idea workspaces" tone="violet" index="01" onClick={() => navigate('/normal/ideas')} /></motion.div>
        <motion.div {...metricItem}><MetricCard icon={CheckCircle2} label="Validated ideas" value={summary?.validatedIdeasCount ?? summary?.ideasCount ?? 0} helper="Passed the Nexora quality pipeline" tone="blue" index="02" onClick={() => navigate('/normal/ideas?status=validated')} /></motion.div>
        <motion.div {...metricItem}><MetricCard icon={Bookmark} label="Saved ideas" value={summary?.favoriteIdeasCount ?? 0} helper="Your shortlisted opportunities" tone="mint" index="03" onClick={() => navigate('/normal/favorites')} /></motion.div>
        <motion.div {...metricItem}><MetricCard icon={BookOpenCheck} label="Published ideas" value={summary?.publishedIdeasCount ?? 0} helper="Ideas shared with the community" tone="amber" index="04" onClick={() => navigate('/normal/published')} /></motion.div>
      </motion.section>


      {activeRun ? (
        <motion.button
          className="normal-active-generation"
          type="button"
          onClick={() => navigate(`/normal/generation/${activeRun.id}`)}
          {...reveal}
        >
          <span className="normal-active-generation__icon"><Radio size={20} /></span>
          <span className="normal-active-generation__copy">
            <small>Generation in progress</small>
            <strong>{activeRun.currentStageLabel || activeRun.currentStageKey || 'Preparing your idea'}</strong>
            <em><Clock3 size={14} />You can safely continue tracking this run</em>
          </span>
          <span className="normal-active-generation__progress">
            <b>{Math.round(Number(activeRun.progressPercent ?? 0))}%</b>
            <i><span style={{ width: `${Math.max(0, Math.min(100, Number(activeRun.progressPercent ?? 0)))}%` }} /></i>
          </span>
          <span className="normal-active-generation__action">Continue tracking <ArrowRight size={17} /></span>
        </motion.button>
      ) : null}

      <motion.section className="normal-dashboard-latest" {...reveal}>
        <div className="normal-section-heading"><div><span className="normal-eyebrow">Continue building</span><h2>Your latest workspace</h2></div><button className="normal-text-button" type="button" onClick={() => navigate('/normal/ideas')}>View all ideas <ArrowRight size={17} /></button></div>
        <LatestIdeaCard idea={summary?.latestIdea ?? null} />
      </motion.section>

      <motion.div {...reveal}>
        <DashboardContactSection />
      </motion.div>

    </div>
  );
}