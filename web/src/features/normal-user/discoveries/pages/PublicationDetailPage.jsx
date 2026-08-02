/**
 * Public discovery details with pre-acceptance engagement and protected brief.
 *
 * Users can rate, vote, and leave feedback before acceptance when enabled by
 * the publisher. Acceptance remains a separate workflow that opens the full
 * public problem, objectives, and target-user brief.
 *
 * @author Malak
 */
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Flag,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  acceptPublication,
  createPublicationAdvancedUnlockCheckout,
  unlockPublicationAdvancedWithCredits,
  getDiscoveryById,
  getMyAcceptance,
  getMyFeedback,
  getMyRating,
  getMyVote,
  setFeedback,
  setRating,
  setVote,
  reportPublication,
} from '../api/discoveriesApi';
import { getStoredUser } from '../../../auth/shared/auth.storage';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { storePaymentReturnReference } from '../../payments/utils/paymentReturn.storage';
import '../styles/publication-detail.css';

function parseList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  }

  if (!value) return [];
  if (typeof value !== 'string') return [String(value)];

  const trimmed = value.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Regular text is normalized below.
  }

  return trimmed
    .split(/\r?\n|(?:^|\s)[•*-]\s+|;(?=\s*[A-Z])/)
    .map((item) =>
      item.replace(/^\s*[\u005B",]+|[\u005D",]+\s*$/g, '').trim(),
    )
    .filter(Boolean);
}

function ContentBlock({ value, fallback }) {
  const items = useMemo(() => parseList(value), [value]);

  if (items.length > 1) {
    return (
      <ul className="publication-detail-list">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>
            <CheckCircle2 size={17} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  return <p>{items[0] || fallback}</p>;
}

function extractAcceptance(payload) {
  return payload?.acceptance ?? payload ?? null;
}

export default function PublicationDetailPage() {
  const { publicationId } = useParams();
  const navigate = useNavigate();

  const [publication, setPublication] = useState(null);
  const [acceptance, setAcceptance] = useState(null);
  const [rating, setRatingValue] = useState(0);
  const [vote, setVoteValue] = useState('');
  const [feedback, setFeedbackValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [advancedPaymentOpen, setAdvancedPaymentOpen] = useState(false);
  const [reportReason, setReportReason] = useState('MISLEADING');
  const [reportDetails, setReportDetails] = useState('');
  const [paymentPricing, setPaymentPricing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      // Load the publication first so disabled engagement features are never
      // queried or rendered. This avoids unnecessary 403 responses and keeps
      // the page visually clean when the publisher turns a feature off.
      const publicationPayload = await getDiscoveryById(publicationId);
      const nextPublication = publicationPayload?.publication ?? publicationPayload;
      setPublication(nextPublication);

      const engagementRequests = [getMyAcceptance(publicationId)];
      const engagementKeys = ['acceptance'];

      if (nextPublication.allowRatings !== false) {
        engagementRequests.push(getMyRating(publicationId));
        engagementKeys.push('rating');
      }

      if (nextPublication.allowVoting !== false) {
        engagementRequests.push(getMyVote(publicationId));
        engagementKeys.push('vote');
      }

      if (nextPublication.allowFeedback !== false) {
        engagementRequests.push(getMyFeedback(publicationId));
        engagementKeys.push('feedback');
      }

      const engagementResults = await Promise.allSettled(engagementRequests);

      engagementResults.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;

        const key = engagementKeys[index];
        const payload = result.value;

        if (key === 'acceptance') {
          setAcceptance(extractAcceptance(payload));
        } else if (key === 'rating') {
          setRatingValue(Number(payload?.rating?.value ?? payload?.value ?? 0));
        } else if (key === 'vote') {
          setVoteValue(payload?.vote?.value ?? payload?.value ?? '');
        } else if (key === 'feedback') {
          setFeedbackValue(payload?.feedback?.comment ?? payload?.comment ?? '');
        }
      });
    } catch (error) {
      setErrorMessage(error?.message || 'This discovery could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { getPaymentPricing().then(setPaymentPricing).catch(() => undefined); }, []);

  const effectiveAcceptance = acceptance ?? publication?.acceptance ?? null;
  const accepted = Boolean(
    effectiveAcceptance?.id || effectiveAcceptance?.acceptedAt,
  );
  const hasAdvancedAccess = Boolean(
    effectiveAcceptance?.advancedUnlockedAt ||
    effectiveAcceptance?.hasAdvancedAccess ||
    publication?.hasAdvancedAccess,
  );
  const advancedOutputsAvailable = Boolean(
    publication?.advancedOutputsAvailable ||
    Number(publication?.advancedOutputsCount ?? 0) > 0 ||
    (Array.isArray(publication?.advancedOutputs) &&
      publication.advancedOutputs.length > 0),
  );
  const currentUser = getStoredUser();
  const isPremiumUser = currentUser?.accountStatus === 'PREMIUM';
  const ratingsEnabled = publication?.allowRatings !== false;
  const votingEnabled = publication?.allowVoting !== false;
  const feedbackEnabled = publication?.allowFeedback !== false;
  const enabledEngagementCount = [
    ratingsEnabled,
    votingEnabled,
    feedbackEnabled,
  ].filter(Boolean).length;

  const hasPublicEngagement = enabledEngagementCount > 0;

  const engagementLayoutClass = [
    'publication-engagement',
    'publication-engagement--public',
    `publication-engagement--count-${enabledEngagementCount}`,
    feedbackEnabled ? 'publication-engagement--has-feedback' : '',
  ]
    .filter(Boolean)
    .join(' ');

  async function handleAccept() {
    setBusyAction('accept');
    setErrorMessage('');
    setNotice('');

    try {
      const result = await acceptPublication(publicationId, paymentMethod);
      const checkoutUrl = result?.checkoutUrl ?? result?.payment?.checkoutUrl;

      if (checkoutUrl) {
        const payment = result?.payment ?? result;

        storePaymentReturnReference({
          paymentId: payment?.paymentId,
          paymentPurpose: payment?.paymentPurpose ?? 'ACCEPT_PUBLICATION',
          publicationId,
        });

        window.location.assign(checkoutUrl);
        return;
      }

      setAcceptance(extractAcceptance(result));
      setNotice('Accepted successfully. The complete public brief is now open.');
      await load();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handleAdvancedUnlock() {
    setBusyAction('advanced-unlock');
    setErrorMessage('');
    setNotice('');

    try {
      const result = await createPublicationAdvancedUnlockCheckout(
        publicationId,
        paymentMethod,
      );
      const checkoutUrl = result?.checkoutUrl ?? result?.payment?.checkoutUrl;
      const payment = result?.payment ?? result;

      if (!checkoutUrl) {
        await load();
        setAdvancedPaymentOpen(false);
        setNotice('Advanced access is already available for this opportunity.');
        return;
      }

      storePaymentReturnReference({
        paymentId: payment?.paymentId,
        paymentPurpose:
          payment?.paymentPurpose ?? 'UNLOCK_PUBLICATION_ADVANCED',
        publicationId,
      });

      window.location.assign(checkoutUrl);
    } catch (error) {
      setErrorMessage(
        error?.message || 'The advanced-output checkout could not be created.',
      );
    } finally {
      setBusyAction('');
    }
  }

  async function handlePremiumAdvancedUnlock() {
    setBusyAction('premium-advanced-unlock');
    setErrorMessage('');
    setNotice('');

    try {
      await unlockPublicationAdvancedWithCredits(publicationId);
      setNotice('Advanced access was unlocked with your Premium credits.');
      await load();
    } catch (error) {
      setErrorMessage(
        error?.message || 'Advanced access could not be unlocked.',
      );
    } finally {
      setBusyAction('');
    }
  }

  async function handleRating(value) {
    setBusyAction('rating');
    setErrorMessage('');

    try {
      const result = await setRating(publicationId, value);
      setRatingValue(value);
      setPublication((current) => ({
        ...current,
        averageRating:
          result?.publicationRating?.averageRating ?? current?.averageRating,
        ratingsCount:
          result?.publicationRating?.ratingsCount ?? current?.ratingsCount,
      }));
      setNotice('Your rating was saved.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handleVote(value) {
    setBusyAction('vote');
    setErrorMessage('');

    try {
      const result = await setVote(publicationId, value);
      setVoteValue(value);
      const summary = result?.publicationVoting ?? result?.counters ?? result;
      setPublication((current) => ({
        ...current,
        upvotesCount: summary?.upvotesCount ?? current?.upvotesCount,
        downvotesCount: summary?.downvotesCount ?? current?.downvotesCount,
      }));
      setNotice('Your vote was saved.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handleFeedback(event) {
    event.preventDefault();
    const comment = feedback.trim();
    if (!comment) return;

    setBusyAction('feedback');
    setErrorMessage('');

    try {
      const result = await setFeedback(publicationId, comment);
      setPublication((current) => ({
        ...current,
        feedbackCount: result?.feedbackCount ?? current?.feedbackCount,
      }));
      setNotice('Your feedback was saved.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }


  async function handleReport(event) {
    event.preventDefault();
    setBusyAction('report');
    setErrorMessage('');

    try {
      await reportPublication(publicationId, {
        reason: reportReason,
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
      });
      setReportOpen(false);
      setReportDetails('');
      setNotice('Your report was sent privately to the moderation team.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }

  if (loading) {
    return (
      <section className="publication-detail-state">
        <LoaderCircle className="publication-spin" />
        Opening discovery…
      </section>
    );
  }

  if (!publication) {
    return (
      <section className="publication-detail-state publication-detail-state--error">
        <ShieldCheck size={30} />
        <h1>Discovery unavailable</h1>
        <p>{errorMessage}</p>
        <button type="button" onClick={() => navigate('/normal/discover')}>
          Back to Discover
        </button>
      </section>
    );
  }

  return (
    <main className="publication-detail-page reveal-page">
      <button
        type="button"
        className="publication-detail-back"
        onClick={() => navigate('/normal/discover')}
      >
        <ArrowLeft size={17} /> Discover
      </button>

      <section className="publication-detail-hero">
        <div className="publication-detail-visual" aria-hidden="true">
          <span />
          <span />
          <i><Sparkles size={42} /></i>
        </div>

        <div className="publication-detail-copy">
          <span className="publication-detail-label">
            <Sparkles size={14} /> Community discovery
          </span>
          <h1>{publication.publicTitle || 'Untitled discovery'}</h1>
          <ContentBlock
            value={publication.publicAbstract}
            fallback="No public abstract was provided."
          />
          <div className="publication-detail-author-row">
            <div className="publication-detail-author">
              <UserRound size={17} /> Published by{' '}
              <strong>{publication?.publisher?.fullName || 'Nexora creator'}</strong>
            </div>
            {publication?.publisher?.id !== getStoredUser()?.id ? (
              <button type="button" className="publication-report-trigger" onClick={() => setReportOpen(true)}>
                <Flag size={15} /> Report publication
              </button>
            ) : null}
          </div>
          {hasPublicEngagement ? (
            <div className="publication-detail-metrics">
              {ratingsEnabled ? (
                <span><Star size={16} />{Number(publication.averageRating ?? 0).toFixed(1)} rating</span>
              ) : null}
              {votingEnabled ? (
                <span><ThumbsUp size={16} />{publication.upvotesCount ?? 0} upvotes</span>
              ) : null}
              {feedbackEnabled ? (
                <span><MessageCircleMore size={16} />{publication.feedbackCount ?? 0} feedback</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {hasPublicEngagement ? (
        <section className={engagementLayoutClass}>
          {ratingsEnabled ? (
            <article className="publication-engagement-card publication-engagement-card--rating">
              <span className="publication-engagement__eyebrow">COMMUNITY SIGNAL</span>
              <h2>Rate this opportunity</h2>
              <p>You can rate the public concept before deciding whether to accept it.</p>
              <div className="rating-row">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={value <= rating ? 'active' : ''}
                    disabled={busyAction === 'rating'}
                    onClick={() => handleRating(value)}
                    aria-label={`Rate ${value} out of 5`}
                  >
                    <Star size={22} />
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          {votingEnabled ? (
            <article className="publication-engagement-card publication-engagement-card--vote">
              <span className="publication-engagement__eyebrow">YOUR SIGNAL</span>
              <h2>Vote on the direction</h2>
              <p>Upvote promising opportunities or flag weak directions.</p>
              <div className="vote-row">
                <button
                  type="button"
                  className={vote === 'UP' ? 'active' : ''}
                  disabled={busyAction === 'vote'}
                  onClick={() => handleVote('UP')}
                >
                  <ThumbsUp /> Upvote
                </button>
                <button
                  type="button"
                  className={vote === 'DOWN' ? 'active' : ''}
                  disabled={busyAction === 'vote'}
                  onClick={() => handleVote('DOWN')}
                >
                  <ThumbsDown /> Downvote
                </button>
              </div>
            </article>
          ) : null}

          {feedbackEnabled ? (
            <form className="publication-engagement-card publication-engagement-card--feedback" onSubmit={handleFeedback}>
              <span className="publication-engagement__eyebrow">CONSTRUCTIVE REVIEW</span>
              <h2>Written feedback</h2>
              <p>Share useful feedback before or after acceptance.</p>
              <textarea
                value={feedback}
                maxLength={2000}
                onChange={(event) => setFeedbackValue(event.target.value)}
                placeholder="What is strong, unclear, or worth validating?"
              />
              <button
                type="submit"
                disabled={!feedback.trim() || busyAction === 'feedback'}
              >
                {busyAction === 'feedback' ? <LoaderCircle className="publication-spin" /> : <MessageCircleMore />}
                Save feedback
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {!accepted ? (
        <section className="publication-access-card">
          <div>
            <span><LockKeyhole size={16} /> PROTECTED OPPORTUNITY BRIEF</span>
            <h2>Accept the opportunity to open the complete public brief.</h2>
            <p>
              The public title and abstract stay available before acceptance.
              Accepting opens the public problem, objectives, and target users.
              Normal accounts continue to secure sandbox checkout; Premium
              accounts accept the basic brief immediately.
            </p>
          </div>

          <div className="publication-access-action">
            <div className="publication-access-action__price">
              <small>One-time protected access</small>
              <strong>{paymentPricing ? `${paymentPricing.publicationAcceptancePrice} ${paymentPricing.currency}` : 'Open the complete opportunity'}</strong>
              <span><ShieldCheck size={15} /> Secure sandbox checkout</span>
            </div>
            <button type="button" className="accept-button" onClick={() => setPaymentOpen(true)}>
              <LockKeyhole /> Unlock protected brief
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="publication-accepted-banner publication-accepted-banner--clean">
            <CheckCircle2 size={24} />
            <div>
              <strong>Accepted opportunity</strong>
              <span>The protected basic brief is available below.</span>
            </div>
          </section>


          <section className="publication-detail-grid">
            <article>
              <span>01</span>
              <h2>Problem overview</h2>
              <ContentBlock value={publication.publicProblem} fallback="No problem statement was provided." />
            </article>
            <article>
              <span>02</span>
              <h2>Objectives</h2>
              <ContentBlock value={publication.publicObjectives} fallback="No objectives were provided." />
            </article>
            <article>
              <span>03</span>
              <h2>Target users</h2>
              <ContentBlock value={publication.publicTargetUsers} fallback="No target-user description was provided." />
            </article>
          </section>

          {advancedOutputsAvailable ? (
            <section className={`publication-advanced-card ${hasAdvancedAccess ? 'is-unlocked' : ''}`}>
              <div className="publication-advanced-card__visual" aria-hidden="true">
                {hasAdvancedAccess ? <CheckCircle2 size={28} /> : <Sparkles size={28} />}
              </div>

              <div className="publication-advanced-card__copy">
                <span>{hasAdvancedAccess ? 'ADVANCED ACCESS READY' : 'ADVANCED EXECUTION LAYER'}</span>
                <h2>
                  {hasAdvancedAccess
                    ? 'Your complete accepted-idea workspace is ready.'
                    : 'Unlock the complete execution package.'}
                </h2>
                <p>
                  {hasAdvancedAccess
                    ? `Open ${publication.advancedOutputsCount ?? 'all'} available advanced outputs in one premium workspace.`
                    : 'This opportunity contains completed premium outputs, including architecture, technology, feasibility, implementation, and business planning.'}
                </p>
              </div>

              <div className="publication-advanced-card__action">
                {hasAdvancedAccess ? (
                  <button
                    type="button"
                    className="publication-workspace-button"
                    onClick={() =>
                      navigate(`/normal/accepted/${publicationId}/workspace`, {
                        state: { forceRefresh: true },
                      })
                    }
                  >
                    Open premium workspace <ArrowUpRight size={18} />
                  </button>
                ) : isPremiumUser ? (
                  <>
                    <div>
                      <small>Premium credit unlock</small>
                      <strong>Use account credits</strong>
                      <span><ShieldCheck size={15} /> Verified by the backend</span>
                    </div>
                    <button
                      type="button"
                      className="publication-advanced-pay-button"
                      disabled={busyAction === 'premium-advanced-unlock'}
                      onClick={handlePremiumAdvancedUnlock}
                    >
                      {busyAction === 'premium-advanced-unlock' ? (
                        <LoaderCircle className="publication-spin" size={18} />
                      ) : (
                        <Sparkles size={18} />
                      )}
                      Unlock with credits
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <small>One-time advanced access</small>
                      <strong>
                        {paymentPricing
                          ? `${paymentPricing.normalPublicationAdvancedPrice} ${paymentPricing.currency}`
                          : 'Loading price…'}
                      </strong>
                      <span><ShieldCheck size={15} /> Backend-controlled pricing</span>
                    </div>
                    <button
                      type="button"
                      className="publication-advanced-pay-button"
                      disabled={!paymentPricing}
                      onClick={() => setAdvancedPaymentOpen(true)}
                    >
                      <Sparkles size={18} /> Unlock advanced outputs
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}

      {notice ? <p className="publication-notice">{notice}</p> : null}
      {errorMessage ? <p className="publication-error">{errorMessage}</p> : null}


      {paymentOpen ? (
        <div className="publication-payment-modal" role="dialog" aria-modal="true" aria-label="Choose payment method">
          <button className="publication-payment-modal__backdrop" type="button" aria-label="Close payment" onClick={() => setPaymentOpen(false)} />
          <section className="publication-payment-modal__panel">
            <header>
              <div className="publication-payment-modal__icon"><LockKeyhole size={24} /></div>
              <div><span>PROTECTED ACCESS</span><h2>Unlock the complete opportunity brief</h2><p>Choose a secure test payment method. Access is granted only after verified provider confirmation.</p></div>
              <button type="button" className="publication-payment-modal__close" onClick={() => setPaymentOpen(false)}><X size={20} /></button>
            </header>
            <div className="publication-payment-modal__benefits">
              <span><CheckCircle2 size={16} /> Problem statement</span>
              <span><CheckCircle2 size={16} /> Objectives</span>
              <span><CheckCircle2 size={16} /> Target users</span>
              <span><CheckCircle2 size={16} /> Accepted ideas library</span>
            </div>
            <div className="publication-payment-modal__methods">
              <button type="button" className={paymentMethod === 'card' ? 'active' : ''} onClick={() => setPaymentMethod('card')}>
                <i><CreditCard size={22} /></i><span><strong>Card checkout</strong><small>Visa or Mastercard · Stripe test mode</small></span><b>{paymentMethod === 'card' ? 'Selected' : 'Choose'}</b>
              </button>
              <button type="button" className={paymentMethod === 'paypal' ? 'active' : ''} onClick={() => setPaymentMethod('paypal')}>
                <i className="is-paypal">PP</i><span><strong>PayPal</strong><small>Continue securely in PayPal Sandbox</small></span><b>{paymentMethod === 'paypal' ? 'Selected' : 'Choose'}</b>
              </button>
            </div>
            <footer>
              <div><ShieldCheck size={17} /><span><strong>Secure provider checkout</strong><small>Access is granted only after verified payment confirmation.</small></span></div>
              <button type="button" disabled={busyAction === 'accept'} onClick={handleAccept}>
                {busyAction === 'accept' ? <LoaderCircle className="publication-spin" /> : <LockKeyhole />}
                {busyAction === 'accept' ? 'Creating checkout…' : 'Continue securely'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}


      {advancedPaymentOpen ? (
        <div className="publication-payment-modal" role="dialog" aria-modal="true" aria-label="Choose advanced-output payment method">
          <button className="publication-payment-modal__backdrop" type="button" aria-label="Close payment" onClick={() => setAdvancedPaymentOpen(false)} />
          <section className="publication-payment-modal__panel publication-payment-modal__panel--advanced">
            <header>
              <div className="publication-payment-modal__icon"><Sparkles size={24} /></div>
              <div>
                <span>ADVANCED OPPORTUNITY ACCESS</span>
                <h2>Open the complete idea workspace</h2>
                <p>The backend determines the price and grants access only after the provider payment is verified.</p>
              </div>
              <button type="button" className="publication-payment-modal__close" onClick={() => setAdvancedPaymentOpen(false)}><X size={20} /></button>
            </header>

            <div className="publication-payment-modal__price">
              <small>Advanced outputs · one-time payment</small>
              <strong>{paymentPricing?.normalPublicationAdvancedPrice} {paymentPricing?.currency}</strong>
            </div>

            <div className="publication-payment-modal__benefits">
              <span><CheckCircle2 size={16} /> Full abstract</span>
              <span><CheckCircle2 size={16} /> Technology and architecture</span>
              <span><CheckCircle2 size={16} /> Feasibility and implementation</span>
              <span><CheckCircle2 size={16} /> Business and market outputs</span>
            </div>

            <div className="publication-payment-modal__methods">
              <button type="button" className={paymentMethod === 'card' ? 'active' : ''} onClick={() => setPaymentMethod('card')}>
                <i><CreditCard size={22} /></i><span><strong>Card checkout</strong><small>Visa or Mastercard · Stripe test mode</small></span><b>{paymentMethod === 'card' ? 'Selected' : 'Choose'}</b>
              </button>
              <button type="button" className={paymentMethod === 'paypal' ? 'active' : ''} onClick={() => setPaymentMethod('paypal')}>
                <i className="is-paypal">PP</i><span><strong>PayPal</strong><small>Continue securely in PayPal Sandbox</small></span><b>{paymentMethod === 'paypal' ? 'Selected' : 'Choose'}</b>
              </button>
            </div>

            <footer>
              <div><ShieldCheck size={17} /><span><strong>Verified fulfillment</strong><small>The workspace opens only after backend reconciliation succeeds.</small></span></div>
              <button type="button" disabled={busyAction === 'advanced-unlock'} onClick={handleAdvancedUnlock}>
                {busyAction === 'advanced-unlock' ? <LoaderCircle className="publication-spin" /> : <Sparkles />}
                {busyAction === 'advanced-unlock' ? 'Creating checkout…' : 'Continue to payment'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {reportOpen ? (
        <div className="publication-report-modal" role="dialog" aria-modal="true" aria-label="Report publication">
          <button type="button" className="publication-report-modal__backdrop" aria-label="Close report" onClick={() => setReportOpen(false)} />
          <form onSubmit={handleReport}>
            <header>
              <div><span>TRUST & SAFETY</span><h2>Report this publication</h2><p>Your report is private and reviewed by the Nexora moderation team.</p></div>
              <button type="button" onClick={() => setReportOpen(false)}><X size={19} /></button>
            </header>
            <label>
              <span>Reason</span>
              <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                <option value="MISLEADING">Misleading information</option>
                <option value="SPAM">Spam or manipulation</option>
                <option value="OFFENSIVE">Offensive content</option>
                <option value="COPYRIGHT">Copyright concern</option>
                <option value="PRIVACY">Privacy concern</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              <span>Additional details</span>
              <textarea value={reportDetails} minLength={5} maxLength={1000} onChange={(event) => setReportDetails(event.target.value)} placeholder="Explain what the moderation team should review." />
            </label>
            <footer>
              <button type="button" onClick={() => setReportOpen(false)}>Cancel</button>
              <button type="submit" className="is-primary" disabled={busyAction === 'report'}><Flag size={16} /> Submit report</button>
            </footer>
          </form>
        </div>
      ) : null}
    </main>
  );
}