/**
 * Publication studio with public, registered-member, and selected-audience
 * visibility modes supported by the backend publication DTO.
 *
 * @author Malak
 */
import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  Eye,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
  Vote,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  generatePublicationDescription,
  getIdeaForPublication,
  publishIdea,
  savePublicationDraft,
} from '../api/publicationApi';
import { useUserExperience } from '../../../../system/user-experience';
import '../styles/publish-idea.css';

const USER_TYPES = [
  { value: 'STUDENT', label: 'Students' },
  { value: 'DEVELOPER', label: 'Developers' },
  { value: 'COMPANY', label: 'Companies' },
  { value: 'RESEARCHER', label: 'Researchers' },
  { value: 'OTHER', label: 'Other members' },
];

const INITIAL_FORM = {
  visibility: 'PUBLIC',
  publicTitle: '',
  publicAbstract: '',
  publicProblem: '',
  publicObjectives: '',
  publicTargetUsers: '',
  allowRatings: true,
  allowFeedback: true,
  allowVoting: true,
  allowAdoption: true,
  selectedUserTypes: [],
};

function toEditableText(value, separator = '\n') {
  return Array.isArray(value) ? value.filter(Boolean).join(separator) : value ?? '';
}

function extractGeneratedAbstract(result) {
  return result?.description ?? result?.publicAbstract ?? result?.abstract ?? result?.text ?? '';
}


function buildPublicationForm(value) {
  const publication = value?.publication ?? {};
  const selectedUserTypes = (publication.audiences ?? [])
    .filter((audience) => audience.audienceType === 'user-type')
    .map((audience) => audience.audienceValue);

  return {
    visibility: publication.visibility ?? 'PUBLIC',
    publicTitle: publication.publicTitle ?? value?.title ?? '',
    publicAbstract:
      publication.publicAbstract ??
      value?.fullAbstract ??
      value?.partialAbstract ??
      value?.limitedAbstract ??
      '',
    publicProblem:
      publication.publicProblem ??
      value?.problemStatement ??
      '',
    publicObjectives:
      publication.publicObjectives ??
      toEditableText(value?.objectives),
    publicTargetUsers:
      publication.publicTargetUsers ??
      toEditableText(value?.targetUsers, ', '),
    allowRatings: publication.allowRatings ?? true,
    allowFeedback: publication.allowFeedback ?? true,
    allowVoting: publication.allowVoting ?? true,
    allowAdoption: publication.allowAdoption ?? true,
    selectedUserTypes,
  };
}

function buildIdeaSeed(ideaId, publicationSeed) {
  if (!publicationSeed) return null;

  return {
    id: publicationSeed.ideaId ?? ideaId,
    title: publicationSeed.publicTitle ?? 'Published idea',
    fullAbstract: publicationSeed.publicAbstract ?? '',
    problemStatement: publicationSeed.publicProblem ?? '',
    objectives: publicationSeed.publicObjectives ?? '',
    targetUsers: publicationSeed.publicTargetUsers ?? '',
    publication: publicationSeed,
  };
}

export default function PublishIdeaPage() {
  const { t } = useUserExperience();
  const shouldReduceMotion = useReducedMotion();
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const openedFromPublished =
    location.state?.returnTo === workspacePath('/normal/published') ||
    location.state?.publicationOrigin === 'published';

  const returnTo = openedFromPublished
    ? workspacePath('/normal/published')
    : workspacePath(`/normal/ideas/${ideaId}`);

  const returnLabel = openedFromPublished
    ? 'Published'
    : 'Idea workspace';

  function handleReturn() {
    navigate(returnTo, {
      state: openedFromPublished
        ? undefined
        : {
          returnTo: location.state?.workspaceReturnTo || workspacePath('/normal/ideas'),
          returnLabel: location.state?.workspaceReturnLabel || 'My ideas',
          ideaSeed: location.state?.ideaSeed || undefined,
        },
    });
  }

  const publicationSeed = location.state?.publicationSeed ?? null;
  const routeIdeaSeed = location.state?.ideaSeed ?? null;
  const initialIdea = useMemo(
    () => routeIdeaSeed ?? buildIdeaSeed(ideaId, publicationSeed),
    [ideaId, publicationSeed, routeIdeaSeed],
  );
  const hasEditedRef = useRef(false);

  const [idea, setIdea] = useState(() => initialIdea);
  const [form, setForm] = useState(() =>
    initialIdea ? buildPublicationForm(initialIdea) : INITIAL_FORM,
  );
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isAlreadyPublished = idea?.publication?.status === 'PUBLISHED';

  useEffect(() => {
    let active = true;

    async function loadIdea() {
      try {
        const value = await getIdeaForPublication(ideaId);
        if (!active) return;

        setIdea(value);

        if (!hasEditedRef.current) {
          setForm(buildPublicationForm(value));
        }
      } catch (requestError) {
        if (!active) return;

        if (initialIdea) {
          setNotice(
            'Showing your saved publication immediately. Fresh workspace details will be loaded the next time they are available.',
          );
          return;
        }

        setError(requestError.message);
      }
    }

    void loadIdea();

    return () => {
      active = false;
    };
  }, [ideaId, initialIdea]);

  function updateField(key, value) {
    hasEditedRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleUserType(value) {
    hasEditedRef.current = true;
    setForm((current) => ({
      ...current,
      selectedUserTypes: current.selectedUserTypes.includes(value)
        ? current.selectedUserTypes.filter((item) => item !== value)
        : [...current.selectedUserTypes, value],
    }));
  }

  const publicationPayload = useMemo(() => ({
    visibility: form.visibility,
    publicTitle: form.publicTitle.trim(),
    publicAbstract: form.publicAbstract.trim(),
    publicProblem: form.publicProblem.trim(),
    publicObjectives: form.publicObjectives.trim(),
    publicTargetUsers: form.publicTargetUsers.trim(),
    allowRatings: form.allowRatings,
    allowFeedback: form.allowFeedback,
    allowVoting: form.allowVoting,
    allowAdoption: form.allowAdoption,
    ...(form.visibility === 'SELECTED_AUDIENCE'
      ? {
        audiences: form.selectedUserTypes.map((audienceValue) => ({
          audienceType: 'user-type',
          audienceValue,
        })),
      }
      : { audiences: [] }),
  }), [form]);

  const canSave = Boolean(
    form.publicTitle.trim() &&
    form.publicAbstract.trim() &&
    (form.visibility !== 'SELECTED_AUDIENCE' || form.selectedUserTypes.length > 0),
  );

  async function handleSaveDraft() {
    if (!canSave) {
      setError('Add a title and abstract, and select at least one audience when using selected audience visibility.');
      return;
    }

    setBusyAction('save');
    setError('');
    setNotice('');
    try {
      await savePublicationDraft(ideaId, publicationPayload);
      setNotice('Publication draft saved successfully.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handleGenerateDescription() {
    setBusyAction('generate');
    setError('');
    setNotice('');
    try {
      const result = await generatePublicationDescription(ideaId, {});
      const generated = extractGeneratedAbstract(result);
      if (!generated) throw new Error('The generator returned no public description.');
      updateField('publicAbstract', generated);
      setNotice('AI public copy generated. Review it before publishing.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handlePublish() {
    if (!canSave) {
      setError('Complete the required public fields and audience selection first.');
      return;
    }

    setBusyAction('publish');
    setError('');
    setNotice('');
    try {
      await savePublicationDraft(ideaId, publicationPayload);
      await publishIdea(ideaId);
      setNotice(
        isAlreadyPublished
          ? 'Your publication updates are now live.'
          : 'Your idea is now published.',
      );
      window.setTimeout(
        () => handleReturn(),
        450,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  if (!idea && !error) {
    return <section className="publish-state"><LoaderCircle className="pub-spin" />Preparing publication studio…</section>;
  }

  if (!idea) {
    return (
      <section className="publish-state publish-state--error">
        <ShieldCheck size={28} />
        <h1>Publication studio could not be opened</h1>
        <p>{error}</p>
        <button type="button" onClick={handleReturn}>Back to {returnLabel}</button>
      </section>
    );
  }

  const visibilityOptions = [
    {
      value: 'PUBLIC',
      title: 'Public discovery',
      description: 'Visible to everyone and included in public discovery.',
      icon: Globe2,
    },
    {
      value: 'REGISTERED_USERS',
      title: 'Voxidence members',
      description: 'Visible to authenticated Voxidence users only.',
      icon: UsersRound,
    },
    {
      value: 'SELECTED_AUDIENCE',
      title: 'Selected audience',
      description: 'Visible only to the member categories you choose below.',
      icon: ShieldCheck,
    },
  ];

  return (
    <motion.main
      className="publish-page"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <button type="button" className="publish-back" onClick={handleReturn}>
        <ArrowLeft size={17} /> {returnLabel}
      </button>

      <motion.section
        className={`publish-hero ${isAlreadyPublished ? 'is-editing' : 'is-new'}`}
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
        <div className="publish-hero__orb publish-hero__orb--one" />
        <div className="publish-hero__orb publish-hero__orb--two" />
        <div className="publish-hero__grid" aria-hidden="true" />

        <div className="publish-hero__copy">
          <span>
            <Sparkles size={14} />
            {t(isAlreadyPublished ? 'Edit publication' : 'PUBLICATION STUDIO')}
          </span>
          <h1>{t('Prepare a clear story for the right audience.')}</h1>
          <p>{t('Shape a polished public snapshot while Voxidence keeps advanced execution details protected.')}</p>
        </div>

        <div className="publish-hero__visual" aria-hidden="true">
          <span className="publish-hero__visual-orbit publish-hero__visual-orbit--one" />
          <span className="publish-hero__visual-orbit publish-hero__visual-orbit--two" />
          <span className="publish-hero__visual-line publish-hero__visual-line--one" />
          <span className="publish-hero__visual-line publish-hero__visual-line--two" />
          <span className="publish-hero__visual-sheet">
            <i /><i /><i /><i />
          </span>
          <span className="publish-hero__visual-signal">
            <i /><i /><i /><i /><i />
          </span>
          <span className="publish-hero__visual-dot publish-hero__visual-dot--one" />
          <span className="publish-hero__visual-dot publish-hero__visual-dot--two" />
          <span className="publish-hero__visual-core">
            <ShieldCheck size={38} strokeWidth={1.8} />
          </span>
          <span className="publish-hero__visual-node publish-hero__visual-node--preview">
            <Eye size={18} />
          </span>
          <span className="publish-hero__visual-node publish-hero__visual-node--audience">
            <UsersRound size={18} />
          </span>
          <span className="publish-hero__visual-node publish-hero__visual-node--feedback">
            <MessageSquareText size={17} />
          </span>
          <span className="publish-hero__visual-caption">
            <i />
            {t(isAlreadyPublished ? 'Edit publication' : 'LIVE PREVIEW')}
          </span>
        </div>
      </motion.section>

      <motion.section
        className="publish-layout"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 26 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.form
          onSubmit={(event) => event.preventDefault()}
          initial={shouldReduceMotion ? undefined : { opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.12 }}
          transition={{ duration: 0.52 }}
        >
          <div className="publish-section-title">
            <div><span>01</span><h2>Public story</h2></div>
            <button type="button" onClick={handleGenerateDescription} disabled={Boolean(busyAction)}>
              {busyAction === 'generate' ? <LoaderCircle className="pub-spin" /> : <Sparkles size={16} />}
              Draft with AI
            </button>
          </div>

          <label>Public title<input dir="auto" value={form.publicTitle} maxLength={200} onChange={(event) => updateField('publicTitle', event.target.value)} /></label>
          <label>Public abstract<textarea dir="auto" rows={6} value={form.publicAbstract} maxLength={5000} onChange={(event) => updateField('publicAbstract', event.target.value)} /></label>
          <div className="publish-two">
            <label>Public problem<textarea dir="auto" rows={5} value={form.publicProblem} onChange={(event) => updateField('publicProblem', event.target.value)} /></label>
            <label>Target users<textarea dir="auto" rows={5} value={form.publicTargetUsers} onChange={(event) => updateField('publicTargetUsers', event.target.value)} /></label>
          </div>
          <label>Public objectives<textarea dir="auto" rows={5} value={form.publicObjectives} onChange={(event) => updateField('publicObjectives', event.target.value)} /></label>

          <div className="publish-section-title"><div><span>02</span><h2>Visibility and community</h2></div></div>
          <div className="publish-visibility publish-visibility--three">
            {visibilityOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  type="button"
                  key={option.value}
                  className={form.visibility === option.value ? 'active' : undefined}
                  onClick={() => updateField('visibility', option.value)}
                >
                  <Icon size={18} />
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </button>
              );
            })}
          </div>

          {form.visibility === 'SELECTED_AUDIENCE' ? (
            <section className="publish-audience-picker">
              <span>Choose member categories</span>
              <p>Premium accounts can browse every published idea in their separate Premium experience; this selection controls normal-user discovery.</p>
              <div>
                {USER_TYPES.map((type) => (
                  <button
                    type="button"
                    key={type.value}
                    className={form.selectedUserTypes.includes(type.value) ? 'active' : ''}
                    onClick={() => toggleUserType(type.value)}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="publish-toggles" aria-label="Community interaction settings">
            {[
              {
                key: 'allowRatings',
                label: 'Ratings',
                description: 'Let members score the idea.',
                icon: Star,
              },
              {
                key: 'allowFeedback',
                label: 'Written feedback',
                description: 'Collect detailed community comments.',
                icon: MessageSquareText,
              },
              {
                key: 'allowVoting',
                label: 'Voting',
                description: 'Allow support and oppose votes.',
                icon: Vote,
              },
              {
                key: 'allowAdoption',
                label: 'Allow idea acceptance',
                description: 'Let members accept this idea into their workspace.',
                icon: ShieldCheck,
              },
            ].map(({ key, label, description, icon: Icon }) => (
              <label
                key={key}
                className={form[key] ? 'publish-toggle is-enabled' : 'publish-toggle'}
              >
                <span className="publish-toggle__icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={2.1} />
                </span>
                <span className="publish-toggle__copy">
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => updateField(key, event.target.checked)}
                  aria-label={label}
                />
              </label>
            ))}
          </div>

          {error ? <p className="publish-error">{error}</p> : null}
          {notice ? <p className="publish-notice">{notice}</p> : null}

          <footer className="publish-actions">
            <button type="button" onClick={handleSaveDraft} disabled={Boolean(busyAction)}>
              {busyAction === 'save' ? <LoaderCircle className="pub-spin" size={17} /> : <Save size={17} />}
              Save draft
            </button>
            <button type="button" className="publish-submit" onClick={handlePublish} disabled={Boolean(busyAction) || !canSave}>
              {busyAction === 'publish' ? (
                <LoaderCircle className="pub-spin" />
              ) : isAlreadyPublished ? (
                <RefreshCw size={17} />
              ) : (
                <Globe2 size={17} />
              )}
              {isAlreadyPublished ? 'Republish idea' : 'Publish idea'}
            </button>
          </footer>
        </motion.form>

        <motion.aside
          initial={shouldReduceMotion ? undefined : { opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.12 }}
          transition={{ duration: 0.52, delay: shouldReduceMotion ? 0 : 0.08 }}
        >
          <span><Eye size={15} /> LIVE PREVIEW</span>
          <article className="publish-preview-card">
            <div className="publish-preview-card__shine" aria-hidden="true" />
            <small dir="auto" data-idea-content="true">{idea?.domain?.name ?? t('Innovation')}</small>
            <h2 dir="auto" data-idea-content="true">{form.publicTitle || t('Your public title')}</h2>
            <p dir="auto" data-idea-content="true">{form.publicAbstract || t('Your public abstract will appear here.')}</p>
            <div data-idea-content="true" dir="auto"><strong>{form.publicProblem || t('Problem statement')}</strong><span>{form.publicTargetUsers || t('Target audience')}</span></div>
          </article>
          <p className="publish-safety"><ShieldCheck size={16} />Only the safe public snapshot is submitted.</p>
        </motion.aside>
      </motion.section>
    </motion.main>
  );
}