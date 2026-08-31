/**
 * Verifies a provider payment and waits until the related Voxidence access is
 * fully applied. The backend remains the only authority for payment success.
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useUserExperience } from '../../../../system/user-experience';

import { updateStoredUser } from '../../../auth/shared/auth.storage';
import { getPaymentState, reconcilePayment } from '../api/paymentFlowApi';
import { refreshPaymentDestination } from '../utils/paymentCacheInvalidation';
import {
  clearPaymentReturnReference,
  readPaymentReturnReference,
} from '../utils/paymentReturn.storage';
import { getStoredPaymentCurrency } from '../utils/paymentCurrency';
import '../styles/payment-result.css';

const MAX_STATUS_ATTEMPTS = 7;
const STATUS_POLL_DELAY_MS = 240;

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
  const { t } = useUserExperience();
  const storedReference = useMemo(() => readPaymentReturnReference(), []);
  const confirmationRunRef = useRef(0);

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

  const confirmPayment = useCallback(async (runId) => {
    const isCurrentRun = () => confirmationRunRef.current === runId;

    if (!paymentId && alreadyUnlocked && fallbackIdeaId) {
      void refreshPaymentDestination({ ideaId: fallbackIdeaId });
      clearPaymentReturnReference();

      if (!isCurrentRun()) return;

      setState({
        loading: false,
        error: '',
        payment: {
          paymentPurpose: 'DIRECT_UNLOCK',
          ideaId: fallbackIdeaId,
          ideaUnlocked: true,
          amount: '0.00',
          currency: getStoredPaymentCurrency(),
          accountStatus: 'NORMAL',
        },
        processingMessage: '',
      });
      return;
    }

    if (!paymentId) {
      if (!isCurrentRun()) return;

      setState({
        loading: false,
        error:
          'The payment reference was not returned by the provider. Return to the idea and try again; you will not be charged twice for an already completed unlock.',
        payment: null,
        processingMessage: '',
      });
      return;
    }

    if (!isCurrentRun()) return;

    setState((current) => ({
      ...current,
      loading: true,
      error: '',
    }));

    let latestPayment = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_STATUS_ATTEMPTS; attempt += 1) {
      if (!isCurrentRun()) return;

      try {
        /*
         * Read the trusted local status first. In the common case the Stripe
         * webhook has already completed before the browser returns, so one
         * quick database read is enough. Reconcile with the provider only when
         * that first read is still pending.
         */
        let payment = await getPaymentState(paymentId, {
          force: true,
        });

        if (attempt === 0 && payment.status === 'PENDING') {
          try {
            payment = await reconcilePayment(paymentId);
          } catch (reconcileError) {
            lastError = reconcileError;
          }
        }

        if (!isCurrentRun()) return;

        latestPayment = payment;

        updateStoredUser({
          accountStatus: payment.accountStatus,
          creditBalance: payment.creditsBalance,
          creditsBalance: payment.creditsBalance,
        });

        if (payment.status === 'SUCCEEDED') {
          lastError = null;
          window.dispatchEvent(
            new CustomEvent('nexora:credits-updated'),
          );
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
            publicationId:
              payment.publicationId || fallbackPublicationId,
          });

          clearPaymentReturnReference();

          if (payment.paymentPurpose === 'DIRECT_UNLOCK') {
            const destinationIdeaId =
              payment.ideaId || fallbackIdeaId;

            if (destinationIdeaId) {
              navigate(workspacePath(`/normal/ideas/${destinationIdeaId}`), {
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

    if (!isCurrentRun()) return;

    const paymentWasVerified =
      latestPayment?.status === 'SUCCEEDED';

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
    const runId = confirmationRunRef.current + 1;
    confirmationRunRef.current = runId;

    void confirmPayment(runId);

    return () => {
      if (confirmationRunRef.current === runId) {
        confirmationRunRef.current += 1;
      }
    };
  }, [confirmPayment, retryToken]);

  const payment = state.payment;

  const goToDestination = () => {
    const ideaId = payment?.ideaId || fallbackIdeaId;
    const publicationId = payment?.publicationId || fallbackPublicationId;

    if (payment?.paymentPurpose === 'DIRECT_UNLOCK' && ideaId) {
      navigate(workspacePath(`/normal/ideas/${ideaId}`), {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED' && publicationId) {
      navigate(workspacePath(`/normal/accepted/${publicationId}/workspace`), {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.paymentPurpose === 'ACCEPT_PUBLICATION' && publicationId) {
      navigate(workspacePath(`/normal/discover/${publicationId}`), {
        replace: true,
        state: { forceRefresh: true, paymentCompletedAt: Date.now() },
      });
      return;
    }

    if (payment?.accountStatus === 'PREMIUM') {
      navigate('/premium/dashboard');
      return;
    }

    navigate(workspacePath('/normal/dashboard'));
  };

  const returnToRelevantPage = () => {
    if (fallbackIdeaId) {
      navigate(workspacePath(`/normal/ideas/${fallbackIdeaId}/unlock`));
      return;
    }

    if (fallbackPublicationId) {
      navigate(workspacePath(`/normal/discover/${fallbackPublicationId}`));
      return;
    }

    navigate(workspacePath('/normal/dashboard'));
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
              <Clock3 /> {t('SECURE CONFIRMATION')}
            </span>
            <h1>{t('Completing your access…')}</h1>
            <p>{t(state.processingMessage)}</p>
          </>
        ) : state.error ? (
          <>
            <div className="payment-result-icon">
              <XCircle />
            </div>
            <span>{t('PAYMENT NEEDS ATTENTION')}</span>
            <h1>{t('We could not finish the confirmation yet.')}</h1>
            <p>{state.error}</p>

            {paymentId ? (
              <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
                {t('Check again')}
              </button>
            ) : (
              <button type="button" onClick={returnToRelevantPage}>
                {t('Return safely')}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="payment-result-icon">
              <CheckCircle2 />
            </div>
            <span>
              <Sparkles /> {t('PAYMENT CONFIRMED')}
            </span>
            <h1>
              {payment.paymentPurpose === 'BUY_CREDITS'
                ? t('Welcome to Premium.')
                : payment.paymentPurpose === 'DIRECT_UNLOCK'
                  ? t('Your advanced workspace is open.')
                  : payment.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED'
                    ? t('Your accepted idea workspace is ready.')
                    : t('The opportunity brief is unlocked.')}
            </h1>
            <p>
              {t('The backend verified the provider payment and completed the related Voxidence access.')}
            </p>
            <div className="payment-result-facts">
              <b>
                <ShieldCheck /> {payment.amount} {payment.currency}
              </b>
              <b>{t(payment.accountStatus)} {t('account')}</b>
            </div>
            <button type="button" onClick={goToDestination}>
              {payment.paymentPurpose === 'UNLOCK_PUBLICATION_ADVANCED'
                ? t('Go to idea workspace')
                : t('Continue to your workspace')}
            </button>
          </>
        )}
      </section>
    </main>
    ,
    document.body,
  );
}