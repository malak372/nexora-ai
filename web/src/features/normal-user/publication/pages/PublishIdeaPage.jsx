/**
 * Publication studio for converting a private idea into a safe public card.
 *
 * The page deliberately submits only the public snapshot fields accepted by
 * the publication API. It never sends advanced outputs, architecture details,
 * budgets, or other private workspace content.
 */
import {
  ArrowLeft,
  Eye,
  Globe2,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  generatePublicationDescription,
  getIdeaForPublication,
  publishIdea,
  savePublicationDraft,
} from '../api/publicationApi';
import '../styles/publish-idea.css';

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
};

/** Converts an array-or-string backend value into editable text. */
function toEditableText(value, separator = '\n') {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(separator);
  }

  return value ?? '';
}

/** Finds generated publication copy across supported backend response shapes. */
function extractGeneratedAbstract(result) {
  return (
    result?.description ??
    result?.publicAbstract ??
    result?.abstract ??
    result?.text ??
    ''
  );
}

export default function PublishIdeaPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();

  const [idea, setIdea] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadIdea() {
      setError('');

      try {
        const value = await getIdeaForPublication(ideaId);

        if (!isMounted) {
          return;
        }

        const publication = value?.publication ?? {};
        setIdea(value);
        setForm({
          visibility: publication.visibility ?? 'PUBLIC',
          publicTitle: publication.publicTitle ?? value?.title ?? '',
          publicAbstract:
            publication.publicAbstract ??
            value?.fullAbstract ??
            value?.partialAbstract ??
            value?.limitedAbstract ??
            '',
          publicProblem:
            publication.publicProblem ?? value?.problemStatement ?? '',
          publicObjectives:
            publication.publicObjectives ??
            toEditableText(value?.objectives),
          publicTargetUsers:
            publication.publicTargetUsers ??
            toEditableText(value?.targetUsers, ', '),
          allowRatings: publication.allowRatings ?? true,
          allowFeedback: publication.allowFeedback ?? true,
          allowVoting: publication.allowVoting ?? true,
        });
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message);
        }
      }
    }

    loadIdea();

    return () => {
      isMounted = false;
    };
  }, [ideaId]);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  /**
   * Keep the payload explicit so private idea fields cannot accidentally leak
   * when the idea object changes in the future.
   */
  const publicationPayload = useMemo(
    () => ({
      visibility: form.visibility,
      publicTitle: form.publicTitle.trim(),
      publicAbstract: form.publicAbstract.trim(),
      publicProblem: form.publicProblem.trim(),
      publicObjectives: form.publicObjectives.trim(),
      publicTargetUsers: form.publicTargetUsers.trim(),
      allowRatings: form.allowRatings,
      allowFeedback: form.allowFeedback,
      allowVoting: form.allowVoting,
    }),
    [form],
  );

  const canPublish = Boolean(
    form.publicTitle.trim() && form.publicAbstract.trim(),
  );

  const handleSaveDraft = async () => {
    setBusyAction('save');
    setError('');
    setNotice('');

    try {
      await savePublicationDraft(ideaId, publicationPayload);
      setNotice('Publication draft saved successfully.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusyAction('');
    }
  };

  const handleGenerateDescription = async () => {
    setBusyAction('generate');
    setError('');
    setNotice('');

    try {
      const result = await generatePublicationDescription(ideaId, {});
      const generatedAbstract = extractGeneratedAbstract(result);

      if (!generatedAbstract) {
        throw new Error(
          'The generator completed without returning a public description.',
        );
      }

      updateField('publicAbstract', generatedAbstract);
      setNotice('A new public abstract was generated. Review it before saving.');
    } catch (generateError) {
      setError(generateError.message);
    } finally {
      setBusyAction('');
    }
  };

  const handlePublish = async () => {
    if (!canPublish) {
      setError('Public title and public abstract are required.');
      return;
    }

    setBusyAction('publish');
    setError('');
    setNotice('');

    try {
      // Publishing changes status only after a valid draft exists.
      await savePublicationDraft(ideaId, publicationPayload);
      await publishIdea(ideaId);

      setNotice('Your idea is now published.');
      window.setTimeout(() => navigate('/normal/published'), 700);
    } catch (publishError) {
      setError(publishError.message);
    } finally {
      setBusyAction('');
    }
  };

  if (!idea && !error) {
    return (
      <section className="publish-state">
        <LoaderCircle className="pub-spin" size={24} />
        Preparing publication studio…
      </section>
    );
  }

  if (!idea && error) {
    return (
      <section className="publish-state publish-state--error">
        <ShieldCheck size={28} />
        <h1>Publication studio could not be opened</h1>
        <p>{error}</p>
        <button
          type="button"
          onClick={() => navigate(`/normal/ideas/${ideaId}`)}
        >
          Back to idea workspace
        </button>
      </section>
    );
  }

  return (
    <main className="publish-page">
      <button
        type="button"
        className="publish-back"
        onClick={() => navigate(`/normal/ideas/${ideaId}`)}
      >
        <ArrowLeft size={17} />
        Idea workspace
      </button>

      <section className="publish-hero">
        <div>
          <span>
            <Sparkles size={14} /> PUBLICATION STUDIO
          </span>
          <h1>Share the opportunity, protect the execution.</h1>
          <p>
            Create a safe public snapshot without exposing premium outputs or
            internal implementation details.
          </p>
        </div>
        <ShieldCheck size={70} />
      </section>

      <section className="publish-layout">
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="publish-section-title">
            <div>
              <span>01</span>
              <h2>Public story</h2>
            </div>
            <button
              type="button"
              onClick={handleGenerateDescription}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'generate' ? (
                <LoaderCircle className="pub-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Draft with AI
            </button>
          </div>

          <label>
            Public title
            <input
              value={form.publicTitle}
              maxLength={200}
              onChange={(event) =>
                updateField('publicTitle', event.target.value)
              }
            />
          </label>

          <label>
            Public abstract
            <textarea
              rows={6}
              value={form.publicAbstract}
              maxLength={5000}
              onChange={(event) =>
                updateField('publicAbstract', event.target.value)
              }
            />
          </label>

          <div className="publish-two">
            <label>
              Public problem
              <textarea
                rows={5}
                value={form.publicProblem}
                onChange={(event) =>
                  updateField('publicProblem', event.target.value)
                }
              />
            </label>

            <label>
              Target users
              <textarea
                rows={5}
                value={form.publicTargetUsers}
                onChange={(event) =>
                  updateField('publicTargetUsers', event.target.value)
                }
              />
            </label>
          </div>

          <label>
            Public objectives
            <textarea
              rows={5}
              value={form.publicObjectives}
              onChange={(event) =>
                updateField('publicObjectives', event.target.value)
              }
            />
          </label>

          <div className="publish-section-title">
            <div>
              <span>02</span>
              <h2>Visibility and community</h2>
            </div>
          </div>

          <div className="publish-visibility">
            {['PUBLIC', 'PRIVATE'].map((visibility) => (
              <button
                type="button"
                key={visibility}
                className={
                  form.visibility === visibility ? 'active' : undefined
                }
                onClick={() => updateField('visibility', visibility)}
              >
                <Globe2 size={17} />
                <strong>
                  {visibility === 'PUBLIC'
                    ? 'Public discovery'
                    : 'Private draft'}
                </strong>
                <small>
                  {visibility === 'PUBLIC'
                    ? 'Visible in Discover after publishing.'
                    : 'Keep the snapshot hidden.'}
                </small>
              </button>
            ))}
          </div>

          <div className="publish-toggles">
            {[
              ['allowRatings', 'Ratings'],
              ['allowFeedback', 'Written feedback'],
              ['allowVoting', 'Voting'],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) =>
                    updateField(key, event.target.checked)
                  }
                />
              </label>
            ))}
          </div>

          {error && <p className="publish-error">{error}</p>}
          {notice && <p className="publish-notice">{notice}</p>}

          <footer>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'save' ? (
                <LoaderCircle className="pub-spin" size={17} />
              ) : (
                <Save size={17} />
              )}
              Save draft
            </button>

            <button
              type="button"
              className="publish-submit"
              onClick={handlePublish}
              disabled={Boolean(busyAction) || !canPublish}
            >
              {busyAction === 'publish' ? (
                <LoaderCircle className="pub-spin" />
              ) : (
                <Globe2 size={17} />
              )}
              Publish idea
            </button>
          </footer>
        </form>

        <aside>
          <span>
            <Eye size={15} /> LIVE PREVIEW
          </span>
          <article>
            <small>{idea?.domain?.name ?? 'Innovation'}</small>
            <h2>{form.publicTitle || 'Your public title'}</h2>
            <p>
              {form.publicAbstract ||
                'Your public abstract will appear here.'}
            </p>
            <div>
              <strong>{form.publicProblem || 'Problem statement'}</strong>
              <span>{form.publicTargetUsers || 'Target audience'}</span>
            </div>
          </article>
          <p className="publish-safety">
            <ShieldCheck size={16} />
            Only the fields in this preview are submitted to the public
            publication endpoint.
          </p>
        </aside>
      </section>
    </main>
  );
}