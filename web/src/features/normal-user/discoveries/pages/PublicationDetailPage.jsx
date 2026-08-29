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
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Flag,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { useUserExperience } from '../../../../system/user-experience';

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
  deleteFeedback,
  deleteRating,
  deleteVote,
  reportPublication,
} from '../api/discoveriesApi';
import { getStoredUser, updateStoredUser } from '../../../auth/shared/auth.storage';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { storePaymentReturnReference } from '../../payments/utils/paymentReturn.storage';
import {
  getStoredPaymentCurrency,
  loadPreferredPaymentCurrency,
} from '../../payments/utils/paymentCurrency';
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
            <span dir="auto" data-idea-content="true">{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (items[0]) {
    return <p dir="auto" data-idea-content="true">{items[0]}</p>;
  }

  return <p>{fallback}</p>;
}

function extractAcceptance(payload) {
  return payload?.acceptance ?? payload ?? null;
}

export default function PublicationDetailPage() {
  const { publicationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useUserExperience();
  const publicationSeed = location.state?.publicationSeed ?? null;

  const [publication, setPublication] = useState(() => publicationSeed);
  const [acceptance, setAcceptance] = useState(null);
  const [rating, setRatingValue] = useState(0);
  const [vote, setVoteValue] = useState('');
  const [feedback, setFeedbackValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(() => !publicationSeed);
  const [busyAction, setBusyAction] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReasonOpen, setReportReasonOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [advancedPaymentOpen, setAdvancedPaymentOpen] = useState(false);
  const [reportReason, setReportReason] = useState('MISLEADING');
  const [reportDetails, setReportDetails] = useState('');
  const [paymentPricing, setPaymentPricing] = useState(null);
  const [paymentCurrency, setPaymentCurrency] = useState(
    getStoredPaymentCurrency,
  );
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [creditUnlockReceipt, setCreditUnlockReceipt] = useState(null);

  const load = useCallback(async () => {
    if (!publicationSeed) {
      setLoading(true);
    }
    setErrorMessage('');

    try {
      /*
       * Publication + acceptance are the only requests needed before the page
       * can safely render. Load them in parallel. Rating/vote/feedback are
       * secondary UI state and must never block the whole publication page.
       */
      const [publicationResult, acceptanceResult] = await Promise.allSettled([
        getDiscoveryById(publicationId),
        getMyAcceptance(publicationId),
      ]);

      if (publicationResult.status !== 'fulfilled') {
        throw publicationResult.reason;
      }

      const publicationPayload = publicationResult.value;
      const nextPublication =
        publicationPayload?.publication ?? publicationPayload;

      const loadedAcceptance =
        acceptanceResult.status === 'fulfilled'
          ? extractAcceptance(acceptanceResult.value)
          : null;

      setPublication(nextPublication);
      setAcceptance(loadedAcceptance);
      setLoading(false);

      /*
       * Load optional engagement state after first paint. These requests are
       * independent, so one slow endpoint no longer keeps the page spinner up.
       */
      const engagementRequests = [];
      const engagementKeys = [];

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

      void Promise.allSettled(engagementRequests).then((engagementResults) => {
        engagementResults.forEach((result, index) => {
          if (result.status !== 'fulfilled') return;

          const key = engagementKeys[index];
          const payload = result.value;

          if (key === 'rating') {
            setRatingValue(Number(payload?.rating?.value ?? payload?.value ?? 0));
          } else if (key === 'vote') {
            setVoteValue(payload?.vote?.value ?? payload?.value ?? '');
          } else if (key === 'feedback') {
            const savedComment =
              payload?.feedback?.comment ?? payload?.comment ?? '';
            setFeedbackValue(savedComment);
            setFeedbackSaved(Boolean(savedComment.trim()));
          }
        });
      });

      /*
       * Premium automatic basic acceptance can also happen after first paint.
       * It updates only the protected access section and no longer blocks the
       * public publication content from appearing.
       */
      const viewer = getStoredUser();
      if (
        viewer?.accountStatus === 'PREMIUM' &&
        nextPublication.allowAdoption !== false &&
        !loadedAcceptance
      ) {
        void acceptPublication(publicationId, 'card')
          .then((autoAcceptResult) => {
            const premiumAcceptance = extractAcceptance(autoAcceptResult);
            if (premiumAcceptance) setAcceptance(premiumAcceptance);
          })
          .catch((acceptError) => {
            console.warn(
              'Premium basic access could not be opened automatically.',
              acceptError,
            );
          });
      }
    } catch (error) {
      setErrorMessage(error?.message || 'This discovery could not be opened.');
      setLoading(false);
    }
  }, [publicationId, publicationSeed]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;

    loadPreferredPaymentCurrency({ force: true }).then((preferredCurrency) => {
      if (active) setPaymentCurrency(preferredCurrency);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    getPaymentPricing(1, { currency: paymentCurrency })
      .then(setPaymentPricing)
      .catch(() => undefined);
  }, [paymentCurrency]);

  useEffect(() => {
    const overlayOpen = paymentOpen || advancedPaymentOpen || reportOpen;
    if (!overlayOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleEscape(event) {
      if (event.key !== 'Escape') return;
      setPaymentOpen(false);
      setAdvancedPaymentOpen(false);
      setReportOpen(false);
      setReportReasonOpen(false);
      setCreditUnlockReceipt(null);
    }

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [advancedPaymentOpen, paymentOpen, reportOpen]);

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
  const acceptanceEnabled = publication?.allowAdoption !== false;
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
      const result = await acceptPublication(
        publicationId,
        paymentMethod,
        paymentCurrency,
      );
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
        paymentCurrency,
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
      const unlockResult = await unlockPublicationAdvancedWithCredits(publicationId);

      // The unlock response contains the authoritative balance produced by the
      // same backend transaction that deducted the credits. Updating the stored
      // user immediately also emits `nexora:user-updated`, so headers/sidebars
      // using useAccountAccess update without requiring a page reload.
      const nextCreditBalance = Number(unlockResult?.creditBalance);

      if (Number.isFinite(nextCreditBalance)) {
        updateStoredUser({
          creditBalance: nextCreditBalance,
          ...(unlockResult?.accountStatus
            ? { accountStatus: unlockResult.accountStatus }
            : {}),
        });
      }

      const backendCost = Number(
        unlockResult?.creditsSpent ??
        paymentPricing?.publicationAdvancedCreditCost,
      );

      setCreditUnlockReceipt({
        spent: Number.isFinite(backendCost) ? backendCost : null,
        balance: Number.isFinite(nextCreditBalance) ? nextCreditBalance : null,
      });
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
      if (rating === value) {
        await deleteRating(publicationId);
        setRatingValue(0);
        setNotice('Your rating was removed.');
        await load();
        return;
      }

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

  async function handleRemoveRating() {
    if (!rating) return;
    setBusyAction('rating');
    setErrorMessage('');

    try {
      const result = await deleteRating(publicationId);
      setRatingValue(0);
      setPublication((current) => ({
        ...current,
        averageRating:
          result?.publicationRating?.averageRating ??
          result?.averageRating ??
          current?.averageRating,
        ratingsCount:
          result?.publicationRating?.ratingsCount ??
          result?.ratingsCount ??
          Math.max(0, Number(current?.ratingsCount ?? 0) - 1),
      }));
      setNotice('Your rating was removed.');
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
      if (vote === value) {
        const result = await deleteVote(publicationId);
        setVoteValue('');
        const summary =
          result?.publicationVotes ??
          result?.publicationVoting ??
          result?.counters ??
          result;

        setPublication((current) => ({
          ...current,
          upvotesCount: summary?.upvotesCount ?? current?.upvotesCount,
          downvotesCount: summary?.downvotesCount ?? current?.downvotesCount,
        }));
        setNotice('Your vote was removed.');
        return;
      }

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
      setFeedbackSaved(true);
      setNotice('Your feedback was saved.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusyAction('');
    }
  }

  async function handleRemoveFeedback() {
    if (!feedbackSaved) return;

    setBusyAction('feedback-remove');
    setErrorMessage('');

    try {
      const result = await deleteFeedback(publicationId);
      setFeedbackValue('');
      setFeedbackSaved(false);
      setPublication((current) => ({
        ...current,
        feedbackCount:
          result?.feedbackCount ??
          Math.max(0, Number(current?.feedbackCount ?? 0) - 1),
      }));
      setNotice('Your feedback was removed.');
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
      setReportReasonOpen(false);
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
        {t('Opening discovery…')}
      </section>
    );
  }

  if (!publication) {
    return (
      <section className="publication-detail-state publication-detail-state--error">
        <ShieldCheck size={30} />
        <h1>{t('Discovery unavailable')}</h1>
        <p>{errorMessage}</p>
        <button type="button" onClick={() => navigate('/normal/discover')}>
          {t('Back to Discover')}
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
        <ArrowLeft size={17} /> {t('Discover')}
      </button>

      <section className="publication-detail-hero">
        <div className="publication-detail-visual" aria-hidden="true">
          <span />
          <span />
          <i><Sparkles size={42} /></i>
        </div>

        <div className="publication-detail-copy">
          <span className="publication-detail-label">
            <Sparkles size={14} /> {t('Community discovery')}
          </span>
          <h1 dir="auto" data-idea-content="true">{publication.publicTitle || t('Untitled discovery')}</h1>
          <div data-idea-content="true" dir="auto"><ContentBlock
            value={publication.publicAbstract}
            fallback={t('No public abstract was provided.')}
          /></div>
          <div className="publication-detail-author-row">
            <div className="publication-detail-author">
              <UserRound size={17} /> {t('Published by')}{' '}
              <strong dir="auto" data-no-auto-translate="true">{publication?.publisher?.fullName || t('Voxidence creator')}</strong>
            </div>
            {publication?.publisher?.id !== getStoredUser()?.id ? (
              <button type="button" className="publication-report-trigger" onClick={() => setReportOpen(true)}>
                <Flag size={15} /> {t('Report publication')}
              </button>
            ) : null}
          </div>
          {hasPublicEngagement ? (
            <div className="publication-detail-metrics">
              {ratingsEnabled ? (
                <span><Star size={16} />{Number(publication.averageRating ?? 0).toFixed(1)} {t('rating')}</span>
              ) : null}
              {votingEnabled ? (
                <span><ThumbsUp size={16} />{publication.upvotesCount ?? 0} {t('upvotes')}</span>
              ) : null}
              {feedbackEnabled ? (
                <span><MessageCircleMore size={16} />{publication.feedbackCount ?? 0} {t('feedback')}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {hasPublicEngagement ? (
        <section className={engagementLayoutClass}>
          {ratingsEnabled ? (
            <article className="publication-engagement-card publication-engagement-card--rating">
              <span className="publication-engagement__eyebrow">{t('COMMUNITY SIGNAL')}</span>
              <h2>{t('Rate this opportunity')}</h2>
              <p>{t('You can rate the public concept before deciding whether to accept it.')}</p>
              <div className="rating-row">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={value <= rating ? 'active' : ''}
                    aria-pressed={rating === value}
                    data-rating-value={value}
                    disabled={busyAction === 'rating'}
                    onClick={() => handleRating(value)}
                    aria-label={
                      rating === value
                        ? t(`Remove ${value} star rating`)
                        : t(`Rate ${value} out of 5`)
                    }
                  >
                    <Star size={22} />
                  </button>
                ))}
              </div>

              {rating ? (
                <button
                  type="button"
                  className="engagement-remove-action"
                  disabled={busyAction === 'rating'}
                  onClick={handleRemoveRating}
                >
                  <X size={15} />
                  {t('Remove rating')}
                </button>
              ) : null}
            </article>
          ) : null}

          {votingEnabled ? (
            <article className="publication-engagement-card publication-engagement-card--vote">
              <span className="publication-engagement__eyebrow">{t('YOUR SIGNAL')}</span>
              <h2>{t('Vote on the direction')}</h2>
              <p>{t('Upvote promising opportunities or flag weak directions.')}</p>
              <div className="vote-row">
                <button
                  type="button"
                  className={`vote-button vote-button--up ${vote === 'UP' ? 'active' : ''}`}
                  aria-pressed={vote === 'UP'}
                  disabled={busyAction === 'vote'}
                  onClick={() => handleVote('UP')}
                >
                  <ThumbsUp />
                  {t(vote === 'UP' ? 'Upvoted' : 'Upvote')}
                </button>
                <button
                  type="button"
                  className={`vote-button vote-button--down ${vote === 'DOWN' ? 'active' : ''}`}
                  aria-pressed={vote === 'DOWN'}
                  disabled={busyAction === 'vote'}
                  onClick={() => handleVote('DOWN')}
                >
                  <ThumbsDown />
                  {t(vote === 'DOWN' ? 'Downvoted' : 'Downvote')}
                </button>
              </div>

              {vote ? (
                <button
                  type="button"
                  className="engagement-remove-action"
                  disabled={busyAction === 'vote'}
                  onClick={() => handleVote(vote)}
                >
                  <X size={15} />
                  {t('Remove my vote')}
                </button>
              ) : null}
            </article>
          ) : null}

          {feedbackEnabled ? (
            <form className="publication-engagement-card publication-engagement-card--feedback" onSubmit={handleFeedback}>
              <span className="publication-engagement__eyebrow">{t('CONSTRUCTIVE REVIEW')}</span>
              <h2>{t('Written feedback')}</h2>
              <p>{t('Share useful feedback before or after acceptance.')}</p>
              <textarea
                dir="auto"
                value={feedback}
                maxLength={2000}
                onChange={(event) => setFeedbackValue(event.target.value)}
                placeholder={t('What is strong, unclear, or worth validating?')}
              />
              <div className="publication-feedback-actions">
                <button
                  type="submit"
                  className="publication-feedback-save"
                  disabled={!feedback.trim() || busyAction === 'feedback'}
                >
                  {busyAction === 'feedback' ? (
                    <LoaderCircle className="publication-spin" />
                  ) : (
                    <MessageCircleMore />
                  )}
                  {t(feedbackSaved ? 'Update feedback' : 'Save feedback')}
                </button>

                {feedbackSaved ? (
                  <button
                    type="button"
                    className="publication-feedback-remove"
                    disabled={busyAction === 'feedback-remove'}
                    onClick={handleRemoveFeedback}
                  >
                    {busyAction === 'feedback-remove' ? (
                      <LoaderCircle className="publication-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {t('Delete my feedback')}
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {!accepted && acceptanceEnabled && !isPremiumUser ? (
        <section className="publication-access-card">
          <div>
            <span><LockKeyhole size={16} /> {t('PROTECTED OPPORTUNITY BRIEF')}</span>
            <h2>{t('Accept the opportunity to open the complete public brief.')}</h2>
            <p>
              {t('The public title and abstract stay available before acceptance. Accepting opens the public problem, objectives, and target users. Continue through secure sandbox checkout to open the protected problem, objectives, and target-user brief.')}
            </p>
          </div>

          <div className="publication-access-action">
            <div className="publication-access-action__price">
              <small>{t('One-time protected access')}</small>
              <strong>
                {paymentPricing
                  ? `${paymentPricing.publicationAcceptancePrice} ${paymentPricing.currency}`
                  : t('Open the complete opportunity')}
              </strong>
              <span>
                <ShieldCheck size={15} />
                {t('Secure sandbox checkout')}
              </span>
            </div>
            <button
              type="button"
              className="accept-button"
              disabled={busyAction === 'accept'}
              onClick={() => setPaymentOpen(true)}
            >
              {busyAction === 'accept' ? (
                <LoaderCircle className="publication-spin" size={18} />
              ) : (
                <LockKeyhole />
              )}
              {t('Unlock protected brief')}
            </button>
          </div>
        </section>
      ) : !accepted && !isPremiumUser ? (
        <section className="publication-access-card">
          <div>
            <span><ShieldCheck size={16} /> {t('ACCEPTANCE PAUSED BY PUBLISHER')}</span>
            <h2>{t('This idea is currently open for discovery only.')}</h2>
            <p>{t('The publisher disabled new acceptances. Existing accepted users keep their access.')}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="publication-accepted-banner publication-accepted-banner--clean">
            <CheckCircle2 size={24} />
            <div>
              <strong>{t('Accepted opportunity')}</strong>
              <span>{t('The protected basic brief is available below.')}</span>
            </div>
          </section>


          <section className="publication-detail-grid">
            <article>
              <span>01</span>
              <h2>{t('Problem overview')}</h2>
              <ContentBlock value={publication.publicProblem} fallback={t('No problem statement was provided.')} />
            </article>
            <article>
              <span>02</span>
              <h2>{t('Objectives')}</h2>
              <ContentBlock value={publication.publicObjectives} fallback={t('No objectives were provided.')} />
            </article>
            <article>
              <span>03</span>
              <h2>{t('Target users')}</h2>
              <ContentBlock value={publication.publicTargetUsers} fallback={t('No target-user description was provided.')} />
            </article>
          </section>

          {advancedOutputsAvailable ? (
            <section className={`publication-advanced-card ${hasAdvancedAccess ? 'is-unlocked' : ''}`}>
              <div className="publication-advanced-card__visual" aria-hidden="true">
                {hasAdvancedAccess ? (
                  <CheckCircle2 size={28} />
                ) : (
                  <VoxidenceMark
                    size={58}
                    className="publication-advanced-card__brand-mark"
                    title={t('Voxidence advanced evidence mark')}
                  />
                )}
              </div>

              <div className="publication-advanced-card__copy">
                <span>{t(hasAdvancedAccess ? 'ADVANCED ACCESS READY' : 'ADVANCED EXECUTION LAYER')}</span>
                <h2>
                  {hasAdvancedAccess
                    ? t('Your complete accepted-idea workspace is ready.')
                    : t('Unlock the complete execution package.')}
                </h2>
                <p>
                  {hasAdvancedAccess
                    ? t(`Open ${publication.advancedOutputsCount ?? 'all'} available advanced outputs in one premium workspace.`)
                    : t('This opportunity contains completed premium outputs, including architecture, technology, feasibility, implementation, and business planning.')}
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
                    {t('Open premium workspace')} <ArrowUpRight size={18} />
                  </button>
                ) : isPremiumUser ? (
                  <>
                    <div>
                      <small>{t('Premium advanced unlock')}</small>
                      <strong>
                        {paymentPricing?.publicationAdvancedCreditCost
                          ? t(`${paymentPricing.publicationAdvancedCreditCost} credits`)
                          : t('Loading credit cost…')}
                      </strong>
                      <span><ShieldCheck size={15} /> {t('Price loaded from backend settings')}</span>
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
                      {t('Unlock advanced outputs')}
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <small>{t('One-time advanced access')}</small>
                      <strong>
                        {paymentPricing
                          ? `${paymentPricing.normalPublicationAdvancedPrice} ${paymentPricing.currency}`
                          : t('Loading price…')}
                      </strong>
                      <span><ShieldCheck size={15} /> {t('Backend-controlled pricing')}</span>
                    </div>
                    <button
                      type="button"
                      className="publication-advanced-pay-button"
                      disabled={!paymentPricing}
                      onClick={() => setAdvancedPaymentOpen(true)}
                    >
                      <Sparkles size={18} /> {t('Unlock advanced outputs')}
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


      {paymentOpen && acceptanceEnabled
        ? createPortal(
          <div className="publication-payment-modal" role="dialog" aria-modal="true" aria-label={t('Choose payment method')}>
            <button className="publication-payment-modal__backdrop" type="button" aria-label={t('Close payment')} onClick={() => setPaymentOpen(false)} />
            <section className="publication-payment-modal__panel">
              <header>
                <div className="publication-payment-modal__icon"><LockKeyhole size={24} /></div>
                <div><span>{t('PROTECTED ACCESS')}</span><h2>{t('Unlock the complete opportunity brief')}</h2><p>{t('Choose a secure test payment method. Access is granted only after verified provider confirmation.')}</p></div>
                <button type="button" className="publication-payment-modal__close" onClick={() => setPaymentOpen(false)}><X size={20} /></button>
              </header>
              <div className="publication-payment-modal__benefits">
                <span><CheckCircle2 size={16} /> {t('Problem statement')}</span>
                <span><CheckCircle2 size={16} /> {t('Objectives')}</span>
                <span><CheckCircle2 size={16} /> {t('Target users')}</span>
                <span><CheckCircle2 size={16} /> {t('Accepted ideas library')}</span>
              </div>
              <div className="publication-payment-modal__currency publication-payment-modal__currency--saved">
                <div>
                  <small>{t('Saved payment currency')}</small>
                  <strong>{paymentCurrency}</strong>
                  <span>{t('Used automatically from your Preferences.')}</span>
                </div>
                <div>
                  <small>{t('Acceptance price')}</small>
                  <strong>
                    {paymentPricing
                      ? `${paymentPricing.publicationAcceptancePrice} ${paymentPricing.currency}`
                      : t('Loading price…')}
                  </strong>
                  <Link
                    to="/normal/preferences"
                    state={{
                      returnTo: `${location.pathname}${location.search}`,
                      returnLabel: 'Back to publication',
                    }}
                  >
                    {t('Change in Preferences')}
                  </Link>
                </div>
              </div>
              <div className="publication-payment-modal__methods">
                <button type="button" className={paymentMethod === 'card' ? 'active' : ''} onClick={() => setPaymentMethod('card')}>
                  <i><CreditCard size={22} /></i><span><strong>{t('Card checkout')}</strong><small>{t('Visa or Mastercard · Stripe test mode')}</small></span><b>{t(paymentMethod === 'card' ? 'Selected' : 'Choose')}</b>
                </button>
              </div>
              <footer>
                <div><ShieldCheck size={17} /><span><strong>{t('Secure provider checkout')}</strong><small>{t('Access is granted only after verified payment confirmation.')}</small></span></div>
                <button type="button" disabled={busyAction === 'accept'} onClick={handleAccept}>
                  {busyAction === 'accept' ? <LoaderCircle className="publication-spin" /> : <LockKeyhole />}
                  {t(busyAction === 'accept' ? 'Creating checkout…' : 'Continue securely')}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
        : null}


      {advancedPaymentOpen
        ? createPortal(
          <div className="publication-payment-modal" role="dialog" aria-modal="true" aria-label={t('Choose advanced-output payment method')}>
            <button className="publication-payment-modal__backdrop" type="button" aria-label={t('Close payment')} onClick={() => setAdvancedPaymentOpen(false)} />
            <section className="publication-payment-modal__panel publication-payment-modal__panel--advanced">
              <header>
                <div className="publication-payment-modal__icon"><LockKeyhole size={24} /></div>
                <div>
                  <span>{t('ADVANCED OPPORTUNITY ACCESS')}</span>
                  <h2>{t('Open the complete idea workspace')}</h2>
                  <p>{t('The backend determines the price and grants access only after the provider payment is verified.')}</p>
                </div>
                <button type="button" className="publication-payment-modal__close" onClick={() => setAdvancedPaymentOpen(false)}><X size={20} /></button>
              </header>

              <div className="publication-payment-modal__price">
                <small>{t('Advanced outputs · one-time payment')}</small>
                <strong>{paymentPricing?.normalPublicationAdvancedPrice} {paymentPricing?.currency}</strong>
              </div>

              <div className="publication-payment-modal__benefits">
                <span><CheckCircle2 size={16} /> {t('Full abstract')}</span>
                <span><CheckCircle2 size={16} /> {t('Technology and architecture')}</span>
                <span><CheckCircle2 size={16} /> {t('Feasibility and implementation')}</span>
                <span><CheckCircle2 size={16} /> {t('Business and market outputs')}</span>
              </div>

              <div className="publication-payment-modal__currency publication-payment-modal__currency--saved">
                <div>
                  <small>{t('Saved payment currency')}</small>
                  <strong>{paymentCurrency}</strong>
                  <span>{t('Used automatically from your Preferences.')}</span>
                </div>
                <div>
                  <small>{t('Advanced workspace price')}</small>
                  <strong>{paymentPricing?.normalPublicationAdvancedPrice} {paymentPricing?.currency}</strong>
                  <Link
                    to="/normal/preferences"
                    state={{
                      returnTo: `${location.pathname}${location.search}`,
                      returnLabel: 'Back to publication',
                    }}
                  >
                    {t('Change in Preferences')}
                  </Link>
                </div>
              </div>
              <div className="publication-payment-modal__methods">
                <button type="button" className={paymentMethod === 'card' ? 'active' : ''} onClick={() => setPaymentMethod('card')}>
                  <i><CreditCard size={22} /></i><span><strong>{t('Card checkout')}</strong><small>{t('Visa or Mastercard · Stripe test mode')}</small></span><b>{t(paymentMethod === 'card' ? 'Selected' : 'Choose')}</b>
                </button>
              </div>

              <footer>
                <div><ShieldCheck size={17} /><span><strong>{t('Verified fulfillment')}</strong><small>{t('The workspace opens only after backend reconciliation succeeds.')}</small></span></div>
                <button type="button" disabled={busyAction === 'advanced-unlock'} onClick={handleAdvancedUnlock}>
                  {busyAction === 'advanced-unlock' ? <LoaderCircle className="publication-spin" /> : <LockKeyhole />}
                  {t(busyAction === 'advanced-unlock' ? 'Creating checkout…' : 'Continue to payment')}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
        : null}

      {reportOpen
        ? createPortal(
          <div className="publication-report-modal" role="dialog" aria-modal="true" aria-label={t('Report publication')}>
            <button type="button" className="publication-report-modal__backdrop" aria-label={t('Close report')} onClick={() => setReportOpen(false)} />
            <form onSubmit={handleReport}>
              <header>
                <div className="publication-report-modal__icon"><Flag size={22} /></div>
                <div className="publication-report-modal__heading">
                  <span>{t('TRUST & SAFETY')}</span>
                  <h2>{t('Report this publication')}</h2>
                  <p>{t('Your report stays private and goes directly to the moderation team.')}</p>
                </div>
                <button
                  type="button"
                  className="publication-report-modal__close"
                  onClick={() => {
                    setReportOpen(false);
                    setReportReasonOpen(false);
                  }}
                >
                  <X size={19} />
                </button>
              </header>
              <label>
                <span>{t('Reason')}</span>
                <div className={`publication-report-reason ${reportReasonOpen ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="publication-report-reason__trigger"
                    aria-haspopup="listbox"
                    aria-expanded={reportReasonOpen}
                    onClick={() => setReportReasonOpen((open) => !open)}
                  >
                    <span>
                      {t({
                        MISLEADING: 'Misleading information',
                        SPAM: 'Spam or manipulation',
                        OFFENSIVE: 'Offensive content',
                        COPYRIGHT: 'Copyright concern',
                        PRIVACY: 'Privacy concern',
                        OTHER: 'Other',
                      }[reportReason])}
                    </span>
                    <ChevronDown size={18} />
                  </button>

                  {reportReasonOpen ? (
                    <div className="publication-report-reason__menu" role="listbox">
                      {[
                        ['MISLEADING', 'Misleading information'],
                        ['SPAM', 'Spam or manipulation'],
                        ['OFFENSIVE', 'Offensive content'],
                        ['COPYRIGHT', 'Copyright concern'],
                        ['PRIVACY', 'Privacy concern'],
                        ['OTHER', 'Other'],
                      ].map(([value, label]) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={reportReason === value}
                          className={reportReason === value ? 'is-selected' : ''}
                          key={value}
                          onClick={() => {
                            setReportReason(value);
                            setReportReasonOpen(false);
                          }}
                        >
                          <span>{t(label)}</span>
                          {reportReason === value ? <Check size={16} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
              <label>
                <span>{t('Additional details')}</span>
                <textarea value={reportDetails} minLength={5} maxLength={1000} onChange={(event) => setReportDetails(event.target.value)} placeholder={t('Explain what the moderation team should review.')} />
              </label>
              <footer className="publication-report-actions">
                <button
                  type="button"
                  className="publication-report-cancel"
                  onClick={() => {
                    setReportOpen(false);
                    setReportReasonOpen(false);
                  }}
                >
                  <X size={16} />
                  {t('Cancel')}
                </button>

                <button
                  type="submit"
                  className="publication-report-submit"
                  disabled={busyAction === 'report'}
                >
                  {busyAction === 'report' ? (
                    <LoaderCircle className="publication-spin" size={17} />
                  ) : (
                    <Flag size={17} />
                  )}
                  {t('Submit report')}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )
        : null}
      {creditUnlockReceipt
        ? createPortal(
          <div
            className="publication-credit-success"
            role="dialog"
            aria-modal="true"
            aria-label={t('Advanced outputs unlocked')}
          >
            <button
              type="button"
              className="publication-credit-success__backdrop"
              aria-label={t('Close success message')}
              onClick={() => setCreditUnlockReceipt(null)}
            />
            <section className="publication-credit-success__panel">
              <div className="publication-credit-success__halo" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="publication-credit-success__icon">
                <CheckCircle2 size={34} />
              </div>
              <span className="publication-credit-success__eyebrow">{t('ADVANCED ACCESS UNLOCKED')}</span>
              <h2>{t('Done — your credits were deducted successfully.')}</h2>
              <p>
                {t('The complete advanced-output workspace is now available for this idea.')}
              </p>

              <div className="publication-credit-success__receipt">
                <div>
                  <small>{t('Credits used')}</small>
                  <strong>
                    {creditUnlockReceipt.spent ?? paymentPricing?.publicationAdvancedCreditCost ?? '—'}
                  </strong>
                </div>
                <i />
                <div>
                  <small>{t('Remaining balance')}</small>
                  <strong>{creditUnlockReceipt.balance ?? '—'}</strong>
                </div>
              </div>

              <div className="publication-credit-success__actions">
                <button type="button" onClick={() => setCreditUnlockReceipt(null)}>
                  {t('Stay here')}
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => {
                    setCreditUnlockReceipt(null);
                    navigate(`/normal/accepted/${publicationId}/workspace`, {
                      state: { forceRefresh: true },
                    });
                  }}
                >
                  {t('Open advanced workspace')} <ArrowUpRight size={18} />
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
        : null}

    </main>
  );
}