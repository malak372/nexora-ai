import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  LockKeyhole,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRYING', 'PAUSED']);

function formatDate(value) {
  if (!value) return 'Recently created';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function resolveStatus(idea) {
  const runStatus = String(idea?.generationRun?.status ?? '').toUpperCase();

  if (ACTIVE_RUN_STATUSES.has(runStatus)) {
    return {
      label: runStatus === 'PAUSED' ? 'Paused' : 'Generating',
      tone: 'processing',
      icon: Clock3,
    };
  }

  if (idea?.publication?.status === 'PUBLISHED') {
    return { label: 'Published', tone: 'published', icon: Globe2 };
  }

  if (idea?.isUnlocked) {
    return { label: 'Unlocked', tone: 'unlocked', icon: CheckCircle2 };
  }

  return { label: 'Core idea', tone: 'core', icon: LockKeyhole };
}

export default function IdeaLibraryCard({ idea, onOpen, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = resolveStatus(idea);
  const StatusIcon = status.icon;
  const progress = Math.max(
    0,
    Math.min(100, Number(idea?.generationRun?.progressPercent ?? 0)),
  );
  const abstract =
    idea?.limitedAbstract ||
    idea?.partialAbstract ||
    idea?.problemStatement ||
    'Open the workspace to review the generated concept and its direction.';

  return (
    <article className="idea-tile">
      <div className="idea-tile__accent" aria-hidden="true" />

      <header className="idea-tile__topbar">
        <span className={`idea-tile__status idea-tile__status--${status.tone}`}>
          <StatusIcon size={13} />
          {status.label}
        </span>

        <div className="idea-tile__menu">
          <button
            type="button"
            aria-label="Idea actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreHorizontal size={18} />
          </button>

          {menuOpen && (
            <div className="idea-tile__popover">
              <button type="button" onClick={onOpen}>
                <ArrowUpRight size={15} /> Open workspace
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete?.();
                }}
              >
                <Trash2 size={15} /> Delete idea
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="idea-tile__domain">
        <span><Sparkles size={14} /></span>
        {idea?.domain?.name || 'General innovation'}
      </div>

      <h2>{idea?.title || 'Untitled idea'}</h2>
      <p>{abstract}</p>

      {status.tone === 'processing' && (
        <div className="idea-tile__progress" aria-label={`Generation ${progress}% complete`}>
          <div>
            <span>Generation progress</span>
            <strong>{progress}%</strong>
          </div>
          <span className="idea-tile__track"><i style={{ width: `${progress}%` }} /></span>
        </div>
      )}

      <footer>
        <span><CalendarDays size={14} /> {formatDate(idea?.createdAt)}</span>
        <button type="button" onClick={onOpen}>
          {status.tone === 'processing' ? 'Track progress' : 'Open idea'}
          <ArrowUpRight size={16} />
        </button>
      </footer>
    </article>
  );
}