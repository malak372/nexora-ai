/**
 * Accepted publication workspace rendered with the same visual language as
 * the private Open Idea workspace. Advanced outputs stay protected by the
 * acceptance API while Premium-only AI Chat follows account access.
 */
import {
  ArrowLeft,
  Bot,
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

import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { getDiscoveryById, getMyAcceptance } from '../api/discoveriesApi';
import '../../idea-workspace/styles/idea-workspace.css';
import '../styles/accepted-idea-workspace.css';

const humanizeKey = (value) =>
  String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value
        .split(/\r?\n|(?:^|\s)[•*-]\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [value];
}

function hasMeaningfulContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulContent);
  if (typeof value === 'object') return Object.values(value).some(hasMeaningfulContent);
  return true;
}

function getOutputContent(output) {
  return hasMeaningfulContent(output?.structuredContent)
    ? output.structuredContent
    : output?.content;
}

function getSourceIdeaId(publication, acceptance) {
  return (
    acceptance?.ideaId ||
    acceptance?.idea?.id ||
    acceptance?.acceptedIdeaId ||
    publication?.ideaId ||
    publication?.idea?.id ||
    publication?.sourceIdeaId ||
    null
  );
}

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
            <span className="workspace-list__copy">
              {typeof item === 'object' && item !== null
                ? JSON.stringify(item, null, 2)
                : String(item)}
            </span>
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
              <strong>{humanizeKey(key)}</strong>
            </div>
            <WorkspaceContent value={item} />
          </section>
        ))}
      </div>
    );
  }

  const lines = normalizeList(value);

  if (lines.length > 1) return <WorkspaceContent value={lines} />;

  return (
    <div className="workspace-paragraphs">
      <article>
        <span className="workspace-paragraphs__marker">
          <Sparkles size={15} />
        </span>
        <p>{lines[0] || 'Not available yet.'}</p>
      </article>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="workspace-state workspace-state--loading">
      <span className="workspace-state__orb">
        <WandSparkles size={24} />
      </span>
      <div>
        <h1>Preparing your accepted idea</h1>
        <p>Opening the protected brief and advanced execution outputs.</p>
      </div>
      <span className="workspace-state__progress" aria-hidden="true"><i /></span>
    </section>
  );
}

export default function AcceptedIdeaWorkspacePage() {
  const { publicationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const { isPremium } = useAccountAccess();

  const [publication, setPublication] = useState(null);
  const [acceptance, setAcceptance] = useState(null);
  const [activeKey, setActiveKey] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    void (async () => {
      setLoading(true);
      setError('');

      try {
        const [publicationPayload, acceptancePayload] = await Promise.all([
          getDiscoveryById(publicationId, {
            forceRefresh: Boolean(location.state?.forceRefresh),
          }),
          getMyAcceptance(publicationId, {
            forceRefresh: Boolean(location.state?.forceRefresh),
          }),
        ]);

        if (!mounted) return;

        const nextPublication = publicationPayload?.publication ?? publicationPayload;
        const nextAcceptance = acceptancePayload?.acceptance ?? acceptancePayload;

        if (!nextAcceptance?.advancedUnlockedAt && !nextAcceptance?.hasAdvancedAccess) {
          throw new Error('Advanced access is required before opening this idea.');
        }

        setPublication(nextPublication);
        setAcceptance(nextAcceptance);
      } catch (requestError) {
        if (mounted) {
          setError(requestError?.message || 'The accepted idea could not be loaded.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [location.state?.forceRefresh, publicationId]);

  const sections = useMemo(() => {
    if (!publication) return [];

    const advancedOutputs = Array.isArray(publication.advancedOutputs)
      ? publication.advancedOutputs
          .filter((output) => hasMeaningfulContent(getOutputContent(output)))
          .filter(
            (output, index, items) =>
              items.findIndex(
                (candidate) =>
                  (candidate.outputKey || candidate.key || candidate.id) ===
                  (output.outputKey || output.key || output.id),
              ) === index,
          )
      : [];

    const explicitBusinessModel = publication.businessModel;

    /*
     * Prefer the dedicated IdeaBusinessModel returned by the backend.
     * For compatibility with older generated datasets, also recognize an
     * advanced output whose key/title identifies it as a business model.
     */
    const legacyBusinessModelOutput = advancedOutputs.find((output) =>
      /business[-_ ]?model/i.test(
        `${output.outputKey || ''} ${output.key || ''} ${output.title || ''}`,
      ),
    );

    const businessModel = explicitBusinessModel
      ? explicitBusinessModel
      : legacyBusinessModelOutput
        ? {
            content: getOutputContent(legacyBusinessModelOutput),
            businessModelTemplate: {
              name: legacyBusinessModelOutput.title || 'Business model',
              description: 'Business strategy and operating model',
            },
          }
        : null;

    const businessModelContent = businessModel?.content;
    const hasBusinessModel = hasMeaningfulContent(businessModelContent);

    return [
      {
        key: 'overview',
        title: 'Overview',
        caption: 'The complete accepted idea narrative',
        icon: FileText,
        content: publication.publicAbstract,
      },
      {
        key: 'problem',
        title: 'Problem',
        caption: 'The validated need behind the idea',
        icon: Layers3,
        content: publication.publicProblem,
      },
      {
        key: 'objectives',
        title: 'Objectives',
        caption: 'What the solution is designed to achieve',
        icon: Rocket,
        content: normalizeList(publication.publicObjectives),
      },
      {
        key: 'users',
        title: 'Target users',
        caption: 'The audience this opportunity serves',
        icon: Globe2,
        content: normalizeList(publication.publicTargetUsers),
      },
      ...advancedOutputs
        .filter(
          (output) =>
            output !== legacyBusinessModelOutput,
        )
        .map((output) => ({
          key: output.outputKey || output.key || output.id,
          title: output.title || humanizeKey(output.outputKey || output.key),
          caption: 'Advanced execution output',
          icon: Sparkles,
          content: getOutputContent(output),
        })),
      ...(hasBusinessModel
        ? [
            {
              key: 'business-model',
              title: businessModel?.businessModelTemplate?.name || 'Business model',
              caption:
                businessModel?.businessModelTemplate?.description ||
                'Business strategy and operating model',
              icon: BriefcaseBusiness,
              content: businessModelContent,
            },
          ]
        : []),
    ];
  }, [publication]);

  const current = sections.find((section) => section.key === activeKey) ?? sections[0];
  const sourceIdeaId = getSourceIdeaId(publication, acceptance);
  const businessModelSection = sections.find((section) =>
    /business[-_ ]?model/i.test(`${section.key} ${section.title}`),
  );
  const advancedCount = Number(
    publication?.advancedOutputsCount ?? Math.max(0, sections.length - 4),
  );

  if (loading) return <LoadingState />;

  if (error || !publication || !current) {
    return (
      <section className="workspace-state">
        <span className="workspace-state__orb workspace-state__orb--error">
          <LockKeyhole size={24} />
        </span>
        <div>
          <h1>Idea unavailable</h1>
          <p>{error || 'This accepted idea could not be opened.'}</p>
        </div>
        <button type="button" onClick={() => navigate('/normal/ideas?view=accepted')}>
          <ArrowLeft size={17} />
          Accepted ideas
        </button>
      </section>
    );
  }

  const acceptedDate = acceptance?.acceptedAt
    ? new Date(acceptance.acceptedAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Accepted';

  return (
    <motion.main
      className="idea-workspace accepted-open-idea"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <button
        className="workspace-back"
        type="button"
        onClick={() => navigate('/normal/ideas?view=accepted')}
      >
        <ArrowLeft size={17} />
        <span>Accepted ideas</span>
      </button>

      <motion.section
        className="workspace-hero accepted-open-idea__hero"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="workspace-hero__orb workspace-hero__orb--one" />
        <div className="workspace-hero__orb workspace-hero__orb--two" />
        <div className="workspace-hero__grid" aria-hidden="true" />

        <div className="workspace-hero__content">
          <span className="workspace-eyebrow">
            <CheckCircle2 size={14} />
            Accepted idea · advanced access
          </span>

          <h1>{publication.publicTitle}</h1>

          <p>
            {publication.domain?.name || publication.domainName || 'Accepted opportunity'}
            <span aria-hidden="true">·</span>
            {advancedCount} advanced outputs unlocked
          </p>

          <div className="workspace-hero__status">
            <span className="is-unlocked">
              <CheckCircle2 size={14} />
              Advanced workspace
            </span>
            <span>
              <CalendarDays size={14} />
              Accepted {acceptedDate}
            </span>
          </div>
        </div>

        <div className="workspace-actions accepted-workspace-hero-actions">
          {isPremium && sourceIdeaId ? (
            <button
              className="workspace-premium-chat accepted-workspace-hero-action"
              type="button"
              onClick={() =>
                navigate(`/normal/ideas/${sourceIdeaId}/chat`, {
                  state: {
                    chatOrigin: 'accepted-publication',
                    publicationId,
                    returnTo: `/normal/accepted/${publicationId}/workspace`,
                    returnLabel: 'Accepted idea',
                    ideaTitle: publication.publicTitle,
                  },
                })
              }
            >
              <Bot size={17} />
              <span>
                <strong>AI Chat</strong>
                <small>Discuss this accepted idea</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : null}

          {sourceIdeaId ? (
            <button
              type="button"
              className="accepted-workspace-business-model accepted-workspace-hero-action"
              onClick={() =>
                navigate(`/normal/ideas/${sourceIdeaId}/business-model`, {
                  state: {
                    businessModelOrigin: 'accepted-publication',
                    publicationId,
                    returnTo: `/normal/accepted/${publicationId}/workspace`,
                    returnLabel: 'Accepted idea',
                    ideaTitle: publication.publicTitle,
                  },
                })
              }
            >
              <BriefcaseBusiness size={17} />
              <span>
                <strong>
                  {businessModelSection
                    ? 'Business Model'
                    : 'Build Business Model'}
                </strong>
                <small>
                  {businessModelSection
                    ? publication.businessModel?.businessModelTemplate?.name ||
                      'Open your strategy canvas'
                    : 'Create your model from this accepted idea'}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : null}
        </div>
      </motion.section>

      <section className="accepted-open-idea__quick-stats">
        <article>
          <FileText size={18} />
          <span><small>Idea document</small><strong>{sections.length} sections</strong></span>
        </article>
        <article>
          <Sparkles size={18} />
          <span><small>Advanced package</small><strong>{advancedCount} outputs</strong></span>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <span><small>Access</small><strong>Unlocked</strong></span>
        </article>
      </section>

      <motion.section
        className="workspace-body accepted-open-idea__body"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <aside aria-label="Accepted idea sections">
          <div className="workspace-nav__intro">
            <span><FileText size={16} /></span>
            <div>
              <strong>Idea document</strong>
              <small>Select a section — no long page scroll</small>
            </div>
          </div>

          <div className="workspace-nav__list accepted-open-idea__nav">
            {sections.map((section, index) => {
              const Icon = section.icon || FileText;
              const isActive = current.key === section.key;

              return (
                <motion.button
                  key={section.key}
                  type="button"
                  className={isActive ? 'is-active' : ''}
                  onClick={() => setActiveKey(section.key)}
                  whileHover={shouldReduceMotion ? undefined : { x: 3 }}
                >
                  <span className="workspace-nav__number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="workspace-nav__icon"><Icon size={16} /></span>
                  <span className="workspace-nav__copy">
                    <strong>{section.title}</strong>
                    <small>{section.caption}</small>
                  </span>
                  <ChevronRight className="workspace-nav__arrow" size={15} />
                </motion.button>
              );
            })}
          </div>
        </aside>

        <article className="workspace-document accepted-open-idea__document">
          <div className="workspace-document__header">
            <div>
              <span>Accepted idea workspace</span>
              <h2>{current.title}</h2>
              <p>{current.caption}</p>
            </div>
            <span className="workspace-document__badge">
              {String(Math.max(1, sections.findIndex((section) => section.key === current.key) + 1)).padStart(2, '0')}
            </span>
          </div>

          <motion.div
            className="workspace-copy accepted-open-idea__copy"
            key={current.key}
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <WorkspaceContent value={current.content} />
          </motion.div>
        </article>
      </motion.section>
    </motion.main>
  );
}