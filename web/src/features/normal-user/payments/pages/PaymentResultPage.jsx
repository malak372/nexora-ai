/**
 * Verifies a provider payment and waits until the related Voxidence access is
 * fully applied. The backend remains the only authority for payment success.
 */

import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { updateStoredUser } from '../../../auth/shared/auth.storage';
import { getPaymentState, reconcilePayment } from '../api/paymentFlowApi';
import { refreshPaymentDestination } from '../utils/paymentCacheInvalidation';
import {
  clearPaymentReturnReference,
  readPaymentReturnReference,
} from '../utils/paymentReturn.storage';
import '../styles/payment-result.css';

const MAX_STATUS_ATTEMPTS = 10;
const STATUS_POLL_DELAY_MS = 300;

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isFulfillmentComplete(payment) {
  if (!payment || payment.status !== 'SUCCEEDED') return false;

  // DIRECT_UNLOCK is intentionally considered complete as soon as the
  // provider payment is trusted. Advanced-output generation continues in the
  // idea workspace instead of blocking this confirmation screen.
  if (payment.paymentPurpose === 'DIRECT_UNLOCK') {
    return true;
  }

  if (payment.paymentPurpose === 'ACCEPT_PUBLICATION') {
    return payment.publicationAccepted === true;
  }

  if (payment.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED') {
    return payment.advancedPublicationAccess === true;
  }

  return true;
}

function getProcessingMessage(payment) {
  if (payment?.paymentPurpose === 'DIRECT_UNLOCK') {
    return 'Your payment is verified. Voxidence is generating and attaching the advanced idea outputs now.';
  }

  if (payment?.paymentPurpose === 'ACCEPT_PUBLICATION') {
    return 'Your payment is verified. Voxidence is opening the accepted publication details now.';
  }

  if (payment?.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED') {
    return 'Your payment is verified. Voxidence is attaching the advanced publication outputs now.';
  }

  return 'Voxidence is verifying the provider session and applying your access safely.';
}

export default function PaymentResultPage() {
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const storedReference = useMemo(() => readPaymentReturnReference(), []);

  const paymentId = query.get('paymentId') || storedReference?.paymentId || null;
  const fallbackIdeaId = query.get('ideaId') || storedReference?.ideaId || null;
  const fallbackPublicationId =
    query.get('publicationId') || storedReference?.publicationId || null;
  const alreadyUnlocked = query.get('alreadyUnlocked') === '1';

  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState({
    loading: true,
    error: '',
    payment: null,
    processingMessage: 'Voxidence is verifying the provider session and applying your access safely.',
  });

  const confirmPayment = useCallback(async () => {
    if (!paymentId && alreadyUnlocked && fallbackIdeaId) {
      void refreshPaymentDestination({ ideaId: fallbackIdeaId });
      clearPaymentReturnReference();
      setState({
        loading: false,
        error: '',
        payment: {
          paymentPurpose: 'DIRECT_UNLOCK',
          ideaId: fallbackIdeaId,
          ideaUnlocked: true,
          amount: '0.00',
          currency: 'USD',
          accountStatus: 'NORMAL',
        },
        processingMessage: '',
      });
      return;
    }

    if (!paymentId) {
      setState({
        loading: false,
        error:
          'The payment reference was not returned by the provider. Return to the idea and try again; you will not be charged twice for an already completed unlock.',
        payment: null,
        processingMessage: '',
      });
      return;
    }

    setState((current) => ({
      ...current,
      loading: true,
      error: '',
    }));

    let latestPayment = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_STATUS_ATTEMPTS; attempt += 1) {
      try {
        // Read the local payment row first. In the common webhook-success case
        // this completes immediately without contacting Stripe again.
        let payment = await getPaymentState(paymentId, { force: true });

        // If the redirect reached the app before the webhook, perform one
        // trusted server-to-server reconciliation and wait for its fresh state.
        // The backend now commits the payment before starting expensive AI work,
        // so this normally returns in a single provider round-trip.
        if (payment?.status === 'PENDING' && attempt === 0) {
          try {
            payment = await reconcilePayment(paymentId);
          } catch (reconcileError) {
            lastError = reconcileError;
          }
        }

        latestPayment = payment;

        updateStoredUser({
          accountStatus: payment.accountStatus,
          creditBalance: payment.creditsBalance,
          creditsBalance: payment.creditsBalance,
        });

        if (payment.status === 'SUCCEEDED') {
          lastError = null;
          window.dispatchEvent(new CustomEvent('voxidence :credits-updated'));
        }

        if (payment.status === 'FAILED') {
          setState({
            loading: false,
            error: payment.failureReason || 'Payment failed.',
            payment,
            processingMessage: '',
          });
          return;
        }

        if (isFulfillmentComplete(payment)) {
          void refreshPaymentDestination({
            ideaId: payment.ideaId || fallbackIdeaId,
            publicationId: payment.publicationId || fallbackPublicationId,
          });

          clearPaymentReturnReference();

          if (payment.paymentPurpose === 'DIRECT_UNLOCK') {
            const destinationIdeaId = payment.ideaId || fallbackIdeaId;

            if (destinationIdeaId) {
              navigate(`/normal/ideas/${destinationIdeaId}`, {
                replace: true,
                state: {
                  forceRefresh: true,
                  unlockProcessing: payment.ideaUnlocked !== true,
                  paymentId,
                  paymentCompletedAt: Date.now(),
                },
              });
              return;
            }
          }

          setState({
            loading: false,
            error: '',
            payment,
            processingMessage: '',
          });
          return;
        }

        setState({
          loading: true,
          error: '',
          payment,
          processingMessage: getProcessingMessage(payment),
        });
      } catch (error) {
        lastError = error;
      }

      if (attempt < MAX_STATUS_ATTEMPTS - 1) {
        await wait(STATUS_POLL_DELAY_MS);
      }
    }

    const paymentWasVerified = latestPayment?.status === 'SUCCEEDED';

    setState({
      loading: false,
      error: paymentWasVerified
        ? 'Your payment is confirmed, but the unlock is still being completed. Press “Check again” to continue safely without paying again.'
        : lastError?.message ||
          'Payment confirmation is taking longer than expected. Press “Check again”; you will not be charged twice.',
      payment: latestPayment,
      processingMessage: '',
    });
  }, [
    alreadyUnlocked,
    fallbackIdeaId,
    fallbackPublicationId,
    navigate,
    paymentId,
  ]);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!active) return;
      await confirmPayment();
    })();

    return () => {
      active = false;
    };
  }, [confirmPayment, retryToken]);

  const payment = state.payment;

  const goToDestination = () => {
    const ideaId = payment?.ideaId || fallbackIdeaId;
    const publicationId = payment?.publicationId || fallbackPublicationId;

    if (payment?.paymentPurpose === 'DIRECT_UNLOCK' && ideaId) {
      navigate(`/normal/ideas/${ideaId}`, {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED' && publicationId) {
      navigate(`/normal/accepted/${publicationId}/workspace`, {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.paymentPurpose === 'ACCEPT_PUBLICATION' && publicationId) {
      navigate(`/normal/discover/${publicationId}`, {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.accountStatus === 'PREMIUM') {
      navigate('/premium/dashboard');
      return;
    }

    navigate('/normal/dashboard');
  };

  const returnToRelevantPage = () => {
    if (fallbackIdeaId) {
      navigate(`/normal/ideas/${fallbackIdeaId}/unlock`);
      return;
    }

    if (fallbackPublicationId) {
      navigate(`/normal/discover/${fallbackPublicationId}`);
      return;
    }

    navigate('/normal/dashboard');
  };

  return createPortal(
    <main className="payment-result-page">
      <section className={`payment-result-pop ${state.error ? 'is-error' : ''}`}>
        {state.loading ? (
          <>
            <div className="payment-result-icon">
              <LoaderCircle className="payment-result-spin" />
            </div>
            <span>
              <Clock3 /> SECURE CONFIRMATION
            </span>
            <h1>Completing your access…</h1>
            <p>{state.processingMessage}</p>
          </>
        ) : state.error ? (
          <>
            <div className="payment-result-icon">
              <XCircle />
            </div>
            <span>PAYMENT NEEDS ATTENTION</span>
            <h1>We could not finish the confirmation yet.</h1>
            <p>{state.error}</p>

            {paymentId ? (
              <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
                Check again
              </button>
            ) : (
              <button type="button" onClick={returnToRelevantPage}>
                Return safely
              </button>
            )}
          </>
        ) : (
          <>
            <div className="payment-result-icon">
              <CheckCircle2 />
            </div>
            <span>
              <Sparkles /> PAYMENT CONFIRMED
            </span>
            <h1>
              {payment.paymentPurpose === 'BUY_CREDITS'
                ? 'Welcome to Premium.'
                : payment.paymentPurpose === 'DIRECT_UNLOCK'
                  ? 'Your advanced workspace is open.'
                  : payment.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED'
                    ? 'Your accepted idea workspace is ready.'
                    : 'The opportunity brief is unlocked.'}
            </h1>
            <p>
              The backend verified the provider payment and completed the related
              Voxidence access.
            </p>
            <div className="payment-result-facts">
              <b>
                <ShieldCheck /> {payment.amount} {payment.currency}
              </b>
              <b>{payment.accountStatus} account</b>
            </div>
            <button type="button" onClick={goToDestination}>
              {payment.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED'
                ? 'Go to idea workspace'
                : 'Continue to your workspace'}
            </button>
          </>
        )}
      </section>
    </main>
    ,
    document.body,
  );
}