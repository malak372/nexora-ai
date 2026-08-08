/**
 * Workspace for an accepted publication after advanced access is unlocked.
 *
 * The page reads the accepted publication from the backend and renders the
 * protected basic brief together with every advanced output returned for the
 * authenticated acceptance. No price or access decision is made in the UI.
 *
 * @author Voxidence Team
 */
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe2,
  Layers3,
  LockKeyhole,
  Rocket,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getDiscoveryById, getMyAcceptance } from '../api/discoveriesApi';
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
  if (typeof value === 'object') {
    return Object.values(value).some(hasMeaningfulContent);
  }
  return true;
}

function getOutputContent(output) {
  return hasMeaningfulContent(output?.structuredContent)
    ? output.structuredContent
    : output?.content;
}

function WorkspaceContent({ value }) {
  if (Array.isArray(value)) {
    return (
      <ul className="accepted-workspace-list">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>
            <span className="accepted-workspace-list__icon">
              <CheckCircle2 size={16} />
            </span>
            <span>{String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <div className="accepted-workspace-structured">
        {Object.entries(value).map(([key, item]) => (
          <article key={key}>
            <div className="accepted-workspace-structured__header">
              <span />
              <strong>{humanizeKey(key)}</strong>
            </div>
            <WorkspaceContent value={item} />
          </article>
        ))}
      </div>
    );
  }

  const lines = normalizeList(value);

  if (lines.length > 1) {
    return <WorkspaceContent value={lines} />;
  }

  return (
    <p className="accepted-workspace-copy">
      {lines[0] || 'Not available yet.'}
    </p>
  );
}

export default function AcceptedIdeaWorkspacePage() {
  const { publicationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

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
          getMyAcceptance(publicationId),
        ]);

        if (!mounted) return;

        const nextPublication =
          publicationPayload?.publication ?? publicationPayload;
        const nextAcceptance =
          acceptancePayload?.acceptance ?? acceptancePayload;

        if (
          !nextAcceptance?.advancedUnlockedAt &&
          !nextAcceptance?.hasAdvancedAccess
        ) {
          throw new Error(
            'Advanced access is required before opening this workspace.',
          );
        }

        setPublication(nextPublication);
        setAcceptance(nextAcceptance);
      } catch (requestError) {
        if (mounted) {
          setError(
            requestError?.message ||
              'The accepted workspace could not be loaded.',
          );
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
          .filter((output) =>
            hasMeaningfulContent(getOutputContent(output)),
          )
          .filter(
            (output, index, items) =>
              items.findIndex(
                (candidate) =>
                  (candidate.outputKey ||
                    candidate.key ||
                    candidate.id) ===
                  (output.outputKey || output.key || output.id),
              ) === index,
          )
      : [];

    return [
      {
        key: 'overview',
        title: 'Overview',
        caption: 'The accepted opportunity narrative',
        icon: FileText,
        content: publication.publicAbstract,
        group: 'Core brief',
      },
      {
        key: 'problem',
        title: 'Problem',
        caption: 'The validated need behind the idea',
        icon: Layers3,
        content: publication.publicProblem,
        group: 'Core brief',
      },
      {
        key: 'objectives',
        title: 'Objectives',
        caption: 'What the solution is designed to achieve',
        icon: Rocket,
        content: normalizeList(publication.publicObjectives),
        group: 'Core brief',
      },
      {
        key: 'users',
        title: 'Target users',
        caption: 'The audience this opportunity serves',
        icon: Globe2,
        content: normalizeList(publication.publicTargetUsers),
        group: 'Core brief',
      },
      ...advancedOutputs.map((output) => ({
        key: output.outputKey || output.key,
        title:
          output.title ||
          humanizeKey(output.outputKey || output.key),
        caption: 'Advanced execution output',
        icon: Sparkles,
        content: getOutputContent(output),
        group: 'Advanced package',
      })),
    ];
  }, [publication]);

  const currentIndex = Math.max(
    0,
    sections.findIndex((section) => section.key === activeKey),
  );
  const current = sections[currentIndex] ?? sections[0];
  const advancedCount = Math.max(0, sections.length - 4);

  function openRelativeSection(offset) {
    if (!sections.length) return;
    const nextIndex = Math.min(
      sections.length - 1,
      Math.max(0, currentIndex + offset),
    );
    setActiveKey(sections[nextIndex].key);
  }

  if (loading) {
    return (
      <section className="accepted-workspace-state">
        <div className="accepted-workspace-state__orb">
          <WandSparkles className="accepted-workspace-spin" />
        </div>
        <span>ADVANCED WORKSPACE</span>
        <h1>Preparing your accepted idea</h1>
        <p>Loading the complete brief and unlocked execution outputs.</p>
      </section>
    );
  }

  if (error || !publication || !current) {
    return (
      <section className="accepted-workspace-state accepted-workspace-state--error">
        <div className="accepted-workspace-state__orb">
          <LockKeyhole />
        </div>
        <span>ACCESS NOTICE</span>
        <h1>Workspace unavailable</h1>
        <p>{error || 'The accepted workspace could not be opened.'}</p>
        <button
          type="button"
          onClick={() => navigate(`/normal/discover/${publicationId}`)}
        >
          <ArrowLeft size={17} />
          Return to accepted brief
        </button>
      </section>
    );
  }

  const CurrentIcon = current.icon;

  return (
    <main className="accepted-workspace-page">
      <div className="accepted-workspace-ambient accepted-workspace-ambient--one" />
      <div className="accepted-workspace-ambient accepted-workspace-ambient--two" />

      <header className="accepted-workspace-topbar">
        <button
          type="button"
          className="accepted-workspace-back"
          onClick={() => navigate('/normal/ideas?view=accepted')}
        >
          <ArrowLeft size={17} />
          Accepted ideas
        </button>

        <div className="accepted-workspace-topbar__identity">
          <span>ADVANCED ACCESS UNLOCKED</span>
          <strong title={publication.publicTitle}>{publication.publicTitle}</strong>
        </div>

        <div className="accepted-workspace-topbar__meta">
          <div>
            <small>Sections</small>
            <strong>{sections.length}</strong>
          </div>
          <div>
            <small>Advanced</small>
            <strong>{advancedCount}</strong>
          </div>
        </div>
      </header>

      <section className="accepted-workspace-shell">
        <aside className="accepted-workspace-sidebar">
          <div className="accepted-workspace-sidebar__heading">
            <div className="accepted-workspace-sidebar__mark">
              <Sparkles size={21} />
            </div>
            <div>
              <span>VOXIDENCE WORKSPACE</span>
              <strong>Idea document</strong>
              <p>{sections.length} curated sections</p>
            </div>
          </div>

          <nav>
            {sections.map((section, index) => {
              const Icon = section.icon;
              const isActive = section.key === current.key;

              return (
                <button
                  type="button"
                  key={section.key}
                  className={isActive ? 'active' : ''}
                  onClick={() => setActiveKey(section.key)}
                >
                  <small>{String(index + 1).padStart(2, '0')}</small>

                  <i>
                    <Icon size={18} />
                  </i>

                  <span>
                    <strong>{section.title}</strong>
                    <em>{section.caption}</em>
                  </span>

                  <ArrowRight size={15} />
                </button>
              );
            })}
          </nav>

          <div className="accepted-workspace-sidebar__footer">
            <CheckCircle2 size={17} />
            <div>
              <strong>Verified access</strong>
              <span>
                Accepted{' '}
                {acceptance?.acceptedAt
                  ? new Date(acceptance.acceptedAt).toLocaleDateString()
                  : 'opportunity'}
              </span>
            </div>
          </div>
        </aside>

        <article className="accepted-workspace-document">
          <div className="accepted-workspace-document__hero">
            <div>
              <span>{current.group}</span>
              <h1>{current.title}</h1>
              <p>{current.caption}</p>
            </div>

            <div className="accepted-workspace-document__number">
              {String(currentIndex + 1).padStart(2, '0')}
            </div>
          </div>

          <div className="accepted-workspace-content">
            <div className="accepted-workspace-content__icon">
              <CurrentIcon size={22} />
            </div>

            <div className="accepted-workspace-content__body">
              <WorkspaceContent value={current.content} />
            </div>
          </div>

          <footer className="accepted-workspace-document__footer">
            <div>
              <span>
                Section {currentIndex + 1} of {sections.length}
              </span>
              <strong>{advancedCount} advanced outputs unlocked</strong>
            </div>

            <div className="accepted-workspace-document__actions">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => openRelativeSection(-1)}
              >
                <ChevronLeft size={18} />
                Previous
              </button>

              <button
                type="button"
                className="is-primary"
                disabled={currentIndex === sections.length - 1}
                onClick={() => openRelativeSection(1)}
              >
                Next section
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        </article>
      </section>
    </main>
  );
}