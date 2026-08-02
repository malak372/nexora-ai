/**
 * Workspace for an accepted publication after advanced access is unlocked.
 *
 * The page reads the accepted publication from the backend and renders the
 * protected basic brief together with every advanced output returned for the
 * authenticated acceptance. No price or access decision is made in the UI.
 *
 * @author Nexora Team
 */
import {
  ArrowLeft,
  CheckCircle2,
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
            <CheckCircle2 size={17} />
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
            <strong>{humanizeKey(key)}</strong>
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

  return <p className="accepted-workspace-copy">{lines[0] || 'Not available yet.'}</p>;
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

        if (!nextAcceptance?.advancedUnlockedAt && !nextAcceptance?.hasAdvancedAccess) {
          throw new Error('Advanced access is required before opening this workspace.');
        }

        setPublication(nextPublication);
        setAcceptance(nextAcceptance);
      } catch (requestError) {
        if (mounted) {
          setError(requestError?.message || 'The accepted workspace could not be loaded.');
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

    return [
      {
        key: 'overview',
        title: 'Overview',
        caption: 'The accepted opportunity narrative',
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
      ...advancedOutputs.map((output) => ({
        key: output.outputKey || output.key,
        title: output.title || humanizeKey(output.outputKey || output.key),
        caption: 'Advanced execution output',
        icon: Sparkles,
        content: getOutputContent(output),
      })),
    ];
  }, [publication]);

  const current = sections.find((section) => section.key === activeKey) ?? sections[0];

  if (loading) {
    return (
      <section className="accepted-workspace-state">
        <WandSparkles className="accepted-workspace-spin" />
        <h1>Preparing your accepted-idea workspace</h1>
        <p>Loading the basic brief and all unlocked advanced outputs.</p>
      </section>
    );
  }

  if (error || !publication || !current) {
    return (
      <section className="accepted-workspace-state accepted-workspace-state--error">
        <LockKeyhole />
        <h1>Workspace unavailable</h1>
        <p>{error || 'The accepted workspace could not be opened.'}</p>
        <button type="button" onClick={() => navigate(`/normal/discover/${publicationId}`)}>
          <ArrowLeft size={17} /> Return to accepted brief
        </button>
      </section>
    );
  }

  const CurrentIcon = current.icon;

  return (
    <main className="accepted-workspace-page">
      <header className="accepted-workspace-topbar">
        <button type="button" onClick={() => navigate('/normal/ideas?view=accepted')}>
          <ArrowLeft size={17} /> Accepted ideas
        </button>
        <div>
          <span><CheckCircle2 size={15} /> ADVANCED ACCESS UNLOCKED</span>
          <strong>{publication.publicTitle}</strong>
        </div>
      </header>

      <section className="accepted-workspace-shell">
        <aside className="accepted-workspace-sidebar">
          <div className="accepted-workspace-sidebar__heading">
            <Sparkles size={21} />
            <div>
              <strong>Idea workspace</strong>
              <span>{sections.length} sections available</span>
            </div>
          </div>

          <nav>
            {sections.map((section, index) => {
              const Icon = section.icon;
              return (
                <button
                  type="button"
                  key={section.key}
                  className={section.key === current.key ? 'active' : ''}
                  onClick={() => setActiveKey(section.key)}
                >
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <i><Icon size={18} /></i>
                  <span>
                    <strong>{section.title}</strong>
                    <em>{section.caption}</em>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <article className="accepted-workspace-document">
          <header>
            <div>
              <span>PREMIUM IDEA DOCUMENT</span>
              <h1>{current.title}</h1>
              <p>{current.caption}</p>
            </div>
            <b>{String(sections.indexOf(current) + 1).padStart(2, '0')}</b>
          </header>

          <div className="accepted-workspace-content">
            <i><CurrentIcon size={22} /></i>
            <WorkspaceContent value={current.content} />
          </div>

          <footer>
            <span>Accepted {acceptance?.acceptedAt ? new Date(acceptance.acceptedAt).toLocaleDateString() : 'opportunity'}</span>
            <span>{Math.max(0, sections.length - 4)} advanced outputs unlocked</span>
          </footer>
        </article>
      </section>
    </main>
  );
}