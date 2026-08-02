import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Globe2,
  Layers3,
  LockKeyhole,
  Rocket,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getIdeaWorkspaceBundle } from '../api/ideaWorkspaceApi';

import '../styles/idea-workspace.css';

const text = (value) => {
  if (Array.isArray(value)) return value.join('\n');
  return value || 'Not available yet.';
};

const humanizeKey = (value) =>
  String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

/**
 * Converts backend generation enums into user-facing product labels.
 * The API value remains unchanged so permissions and business logic are safe.
 */
const formatGenerationType = (generationType) => {
  const labels = {
    NORMAL_FREE: 'Free generation',
    PREMIUM_CREDIT: 'Premium generation',
    GUEST: 'Guest generation',
  };

  return labels[generationType] || humanizeKey(generationType) || 'AI generated';
};

function WorkspaceContent({ value }) {
  if (Array.isArray(value)) {
    return (
      <ul className="workspace-list">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>
            <span className="workspace-list__icon">
              <CheckCircle2 size={17} />
            </span>
            <span className="workspace-list__index">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="workspace-list__copy">{String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <div className="workspace-structured">
        {Object.entries(value).map(([key, item], index) => (
          <section key={key}>
            <div className="workspace-structured__header">
              <span className="workspace-structured__number">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="workspace-structured__label">
                {humanizeKey(key)}
              </span>
            </div>
            <p>
              {Array.isArray(item)
                ? item.join(' · ')
                : typeof item === 'object' && item !== null
                  ? JSON.stringify(item, null, 2)
                  : String(item)}
            </p>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="workspace-paragraphs">
      {text(value)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => (
          <article key={`${line}-${index}`}>
            <span className="workspace-paragraphs__marker">
              <Sparkles size={15} />
            </span>
            <p>{line}</p>
          </article>
        ))}
    </div>
  );
}

function WorkspaceLoadingState() {
  return (
    <section className="workspace-state workspace-state--loading">
      <span className="workspace-state__orb">
        <WandSparkles size={24} />
      </span>
      <div>
        <h1>Preparing your idea workspace</h1>
        <p>Organizing the core brief and available execution outputs.</p>
      </div>
      <span className="workspace-state__progress" aria-hidden="true">
        <i />
      </span>
    </section>
  );
}

export default function IdeaWorkspacePage() {
  const shouldReduceMotion = useReducedMotion();
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [idea, setIdea] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [activeKey, setActiveKey] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { idea: loadedIdea, outputs: loadedOutputs } =
          await getIdeaWorkspaceBundle(ideaId, {
            forceRefresh: Boolean(location.state?.forceRefresh),
          });

        if (!mounted) return;

        setIdea(loadedIdea);
        setOutputs(loadedIdea?.isUnlocked ? loadedOutputs : []);
      } catch (requestError) {
        if (mounted) setError(requestError.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [ideaId, location.state?.forceRefresh]);

  const sections = useMemo(() => {
    if (!idea) return [];

    return [
      {
        key: 'overview',
        title: 'Overview',
        caption: 'The complete idea narrative',
        icon: FileText,
        content:
          idea.fullAbstract ||
          idea.partialAbstract ||
          idea.limitedAbstract,
      },
      {
        key: 'problem',
        title: 'Problem',
        caption: 'The validated need behind the idea',
        icon: Layers3,
        content: idea.problemStatement,
      },
      {
        key: 'objectives',
        title: 'Objectives',
        caption: 'What the solution is designed to achieve',
        icon: Rocket,
        content: idea.objectives,
      },
      {
        key: 'users',
        title: 'Target users',
        caption: 'The audience this opportunity serves',
        icon: Globe2,
        content: idea.targetUsers,
      },
      ...outputs.map((output) => ({
        key: output.outputKey,
        title: output.title,
        caption: 'Advanced execution output',
        icon: Sparkles,
        content: output.content || output.structuredContent,
      })),
    ];
  }, [idea, outputs]);

  const current =
    sections.find((section) => section.key === activeKey) ?? sections[0];

  if (loading) return <WorkspaceLoadingState />;

  if (error || !idea) {
    return (
      <section className="workspace-state">
        <span className="workspace-state__orb workspace-state__orb--error">
          <LockKeyhole size={24} />
        </span>
        <div>
          <h1>Idea unavailable</h1>
          <p>{error || 'This workspace could not be loaded.'}</p>
        </div>
        <button type="button" onClick={() => navigate('/normal/ideas')}>
          <ArrowLeft size={17} />
          Back to My ideas
        </button>
      </section>
    );
  }

  const createdDate = idea.createdAt
    ? new Date(idea.createdAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Not available';

  return (
    <motion.main
      className="idea-workspace"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <button
        className="workspace-back"
        type="button"
        onClick={() => navigate('/normal/ideas')}
      >
        <ArrowLeft size={17} />
        <span>My ideas</span>
      </button>

      <motion.section
        className="workspace-hero"
        initial={
          shouldReduceMotion
            ? undefined
            : { opacity: 0, y: 24, scale: 0.985 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: 0.68,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="workspace-hero__orb workspace-hero__orb--one" />
        <div className="workspace-hero__orb workspace-hero__orb--two" />
        <div className="workspace-hero__grid" aria-hidden="true" />
        <div className="workspace-hero__content">
          <span className="workspace-eyebrow">
            <Sparkles size={14} />
            Private idea workspace
          </span>

          <h1>{idea.title}</h1>

          <p>
            {idea.domain?.name || 'General innovation'}
            <span aria-hidden="true">·</span>
            {idea.selectedRegion || 'Global scope'}
          </p>

          <div className="workspace-hero__status">
            <span className={idea.isUnlocked ? 'is-unlocked' : 'is-core'}>
              {idea.isUnlocked ? (
                <CheckCircle2 size={14} />
              ) : (
                <LockKeyhole size={14} />
              )}
              {idea.isUnlocked ? 'Advanced workspace' : 'Core workspace'}
            </span>

            <span>
              <CalendarDays size={14} />
              Created {createdDate}
            </span>
          </div>
        </div>

        <div className="workspace-actions">
          {!idea.isUnlocked ? (
            <button
              className="workspace-primary"
              type="button"
              onClick={() => navigate(`/normal/ideas/${ideaId}/unlock`)}
            >
              <LockKeyhole size={17} />
              <span>
                <strong>Direct unlock</strong>
                <small>Open advanced outputs</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                navigate(`/normal/ideas/${ideaId}/business-model`)
              }
            >
              <BriefcaseBusiness size={17} />
              <span>
                <strong>Business model</strong>
                <small>Shape the strategy</small>
              </span>
              <ChevronRight size={17} />
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate(`/normal/ideas/${ideaId}/publish`)}
          >
            <Globe2 size={17} />
            <span>
              <strong>
                {idea.publication?.status === 'PUBLISHED'
                  ? 'Manage publication'
                  : 'Publish idea'}
              </strong>
              <small>Prepare the public story</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
      </motion.section>

      <motion.section
        className="workspace-summary-grid"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.5 }}
      >
        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <Rocket size={20} />
          </span>
          <div>
            <span>Generation type</span>
            <strong>{formatGenerationType(idea.generationType)}</strong>
          </div>
        </motion.article>

        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <span>Workspace access</span>
            <strong>{idea.isUnlocked ? 'Unlocked' : 'Core access'}</strong>
          </div>
        </motion.article>

        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <CalendarDays size={20} />
          </span>
          <div>
            <span>Created</span>
            <strong>{createdDate}</strong>
          </div>
        </motion.article>
      </motion.section>

      <motion.section
        className="workspace-body"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <aside aria-label="Idea document sections">
          <div className="workspace-nav__intro">
            <span><FileText size={16} /></span>
            <div>
              <strong>Idea document</strong>
              <small>{sections.length} sections available</small>
            </div>
          </div>

          <div className="workspace-nav__list">
            {sections.map((section, index) => {
              const Icon = section.icon || FileText;
              const isActive = activeKey === section.key;

              return (
                <motion.button
                  key={section.key}
                  className={isActive ? 'is-active' : ''}
                  type="button"
                  onClick={() => setActiveKey(section.key)}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { x: 4 }
                  }
                  whileTap={
                    shouldReduceMotion
                      ? undefined
                      : { scale: 0.985 }
                  }
                >
                  <span className="workspace-nav__number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="workspace-nav__icon">
                    <Icon size={16} />
                  </span>
                  <span className="workspace-nav__copy">
                    <strong>{section.title}</strong>
                    <small>{section.caption}</small>
                  </span>
                  <ChevronRight
                    className="workspace-nav__arrow"
                    size={15}
                  />
                </motion.button>
              );
            })}
          </div>
        </aside>

        <motion.article
          className="workspace-document"
          initial={shouldReduceMotion ? undefined : { opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.55 }}
        >
          <div className="workspace-document__header">
            <div>
              <span>Idea document</span>
              <h2>{current.title}</h2>
              <p>{current.caption}</p>
            </div>

            <span className="workspace-document__badge">
              {String(
                Math.max(
                  1,
                  sections.findIndex((section) => section.key === current.key) +
                    1,
                ),
              ).padStart(2, '0')}
            </span>
          </div>

          <motion.div
            className="workspace-copy"
            key={current.key}
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <WorkspaceContent value={current.content} />
          </motion.div>
        </motion.article>
      </motion.section>
    </motion.main>
  );
}