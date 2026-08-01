import {
  BrainCircuit,
  CheckCircle2,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { getStoredUser } from '../../../auth/shared/auth.storage';
import { getApiErrorMessage } from '../../shared/api/normalUserApi';
import { createContactMessage } from '../api/dashboardApi';

const INITIAL_FORM = {
  subject: '',
  message: '',
};

export default function DashboardContactSection() {
  const user = useMemo(() => getStoredUser() ?? {}, []);
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!form.subject.trim() || !form.message.trim()) {
      setError('Please enter a subject and message.');
      return;
    }

    setSubmitting(true);

    try {
      await createContactMessage({
        fullName: user.fullName || user.name || 'Nexora user',
        email: user.email,
        subject: form.subject.trim(),
        message: form.message.trim(),
      });

      setForm(INITIAL_FORM);
      setSuccess('Your message was sent to the Nexora team successfully.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Your message could not be sent.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="normal-dashboard-info-grid">
      <article className="normal-ai-story-card">
        <div className="normal-ai-story-card__orb" aria-hidden="true">
          <BrainCircuit size={52} />
          <Sparkles size={21} />
        </div>
        <div>
          <span className="normal-eyebrow"><Sparkles size={14} /> About Nexora AI</span>
          <h2>AI that starts with real community needs.</h2>
          <p>
            Nexora collects public signals, analyzes repeated problems with NLP,
            compares multiple AI-generated candidates, and returns one structured,
            validated software opportunity.
          </p>
          <div className="normal-ai-story-card__points">
            <span><CheckCircle2 size={16} /> Evidence-driven discovery</span>
            <span><ShieldCheck size={16} /> Safe public publication</span>
            <span><BrainCircuit size={16} /> Multi-model evaluation</span>
          </div>
        </div>
      </article>

      <article className="normal-contact-card">
        <div className="normal-contact-card__heading">
          <span className="normal-eyebrow"><MessageSquareText size={14} /> Contact us</span>
          <h2>Need help or have feedback?</h2>
          <p>Your message is stored directly in the Nexora backend for the team to review.</p>
        </div>

        <form onSubmit={submit}>
          <label>
            <span>Subject</span>
            <input
              value={form.subject}
              maxLength={200}
              placeholder="How can we help?"
              onChange={(event) => updateField('subject', event.target.value)}
            />
          </label>

          <label>
            <span>Message</span>
            <textarea
              value={form.message}
              rows={5}
              maxLength={5000}
              placeholder="Describe your question or feedback..."
              onChange={(event) => updateField('message', event.target.value)}
            />
          </label>

          {user.email ? <small className="normal-contact-card__email"><Mail size={14} /> Reply will be sent to {user.email}</small> : null}
          {error ? <p className="normal-contact-card__notice is-error">{error}</p> : null}
          {success ? <p className="normal-contact-card__notice is-success">{success}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="normal-contact-spin" size={17} /> : <Send size={17} />}
            {submitting ? 'Sending...' : 'Send message'}
          </button>
        </form>
      </article>
    </section>
  );
}