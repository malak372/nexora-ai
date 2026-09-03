/**
 * Premium direct-unlock checkout page using Stripe-hosted Test Checkout.
 *
 * @author Malak
 */

import {
  BarChart3,
  CheckCircle2,
  CreditCard,
  Database,
  FileText,
  Layers3,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Route,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';

import {
  createDirectUnlockCheckout,
  unlockIdeaWithCredit,
} from '../api/directUnlockApi';
import { getPaymentPricing } from '../api/paymentFlowApi';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { storePaymentReturnReference } from '../utils/paymentReturn.storage';
import '../styles/direct-unlock.css';

const PAYMENT_METHODS = [
  {
    key: 'card',
    title: 'Credit or debit card',
    description: 'Visa or Mastercard via Stripe Checkout',
    icon: CreditCard,
    badge: 'Most popular',
  },
];

const BENEFITS = [
  {
    icon: CheckCircle2,
    label: 'Permanent access',
  },
  {
    icon: Layers3,
    label: 'Execution outputs',
  },
  {
    icon: Route,
    label: 'Architecture and MVP',
  },
  {
    icon: BarChart3,
    label: 'Market and budget',
  },
];

const UNLOCK_ITEMS = [
  {
    icon: FileText,
    title: 'Abstract and tech stack',
  },
  {
    icon: Database,
    title: 'Architecture and timeline',
  },
  {
    icon: BarChart3,
    title: 'Market, budget, feasibility',
  },
  {
    icon: Layers3,
    title: 'Business model PDF',
  },
];

export default function DirectUnlockPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const { isPremium, creditBalance, refresh } = useAccountAccess();

  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    if (!isPremium) {
      getPaymentPricing().then(setPricing).catch((e) => setError(e.message));
    }
  }, [isPremium]);

  const closeModal = () => {
    navigate(`/normal/ideas/${ideaId}`);
  };

  const openPreferences = () => {
    navigate('/normal/preferences', {
      state: {
        returnTo: `/normal/ideas/${ideaId}/unlock`,
        returnLabel: 'Back to direct unlock',
      },
    });
  };

  const checkout = async () => {
    setBusy(true);
    setError('');

    try {
      if (isPremium) {
        await unlockIdeaWithCredit(ideaId);
        await refresh();
        window.dispatchEvent(new Event('credits:updated'));
        navigate(`/normal/ideas/${ideaId}`, {
          replace: true,
          state: { unlockedWithCredit: true },
        });
        return;
      }

      const origin = window.location.origin;
      const result = await createDirectUnlockCheckout({
        ideaId,
        paymentMethodKey: method,
        successUrl: `${origin}/normal/payments/success`,
        cancelUrl: `${origin}/normal/ideas/${ideaId}/unlock`,
      });

      if (!result?.checkoutUrl) {
        throw new Error(
          'The payment provider did not return a checkout URL.',
        );
      }

      storePaymentReturnReference({
        paymentId: result.paymentId,
        paymentPurpose: result.paymentPurpose ?? 'DIRECT_UNLOCK',
        ideaId,
      });

      window.location.assign(result.checkoutUrl);
    } catch (requestError) {
      setError(
        requestError?.message ||
        (isPremium
          ? 'Unable to unlock this idea with a credit.'
          : 'Unable to open secure checkout.'),
      );
      setBusy(false);
    }
  };

  const priceLabel = isPremium
    ? '1 credit'
    : pricing
      ? `${pricing.directUnlockPrice} ${pricing.currency}`
      : 'Loading price…';

  const modal = (
    <div
      className="direct-unlock-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock this idea workspace"
    >
      <button
        type="button"
        className="direct-unlock-modal__backdrop"
        aria-label="Close direct unlock"
        onClick={closeModal}
      />

      <section className="direct-unlock-modal__panel">
        <button
          type="button"
          className="direct-unlock-modal__close"
          aria-label="Close"
          onClick={closeModal}
        >
          <X size={20} />
        </button>

        <div className="direct-unlock-modal__glow direct-unlock-modal__glow--one" />
        <div className="direct-unlock-modal__glow direct-unlock-modal__glow--two" />

        <header className="direct-unlock-modal__hero">
          <div className="direct-unlock-modal__intro">
            <span className="direct-unlock-modal__badge">
              <Sparkles size={14} />
              {isPremium ? 'PREMIUM CREDIT UNLOCK' : 'DIRECT UNLOCK'}
            </span>

            <h1>Unlock this idea workspace</h1>

            <p>
              {isPremium
                ? 'Use one Premium credit to unlock this idea.'
                : 'Unlock the complete workspace through secure checkout.'}
            </p>
          </div>

          <div className="direct-unlock-modal__visual" aria-hidden="true">
            <span className="direct-unlock-modal__spark direct-unlock-modal__spark--one" />
            <span className="direct-unlock-modal__spark direct-unlock-modal__spark--two" />
            <span className="direct-unlock-modal__leaf direct-unlock-modal__leaf--one" />
            <span className="direct-unlock-modal__leaf direct-unlock-modal__leaf--two" />

            <div className="direct-unlock-modal__visual-orbit" />

            <div className="direct-unlock-modal__visual-card">
              <LockKeyhole size={42} />
            </div>

            <div className="direct-unlock-modal__visual-chip direct-unlock-modal__visual-chip--idea">
              <Lightbulb size={16} />
            </div>

            <div className="direct-unlock-modal__visual-chip direct-unlock-modal__visual-chip--data">
              <BarChart3 size={16} />
            </div>
          </div>
        </header>

        <div className="direct-unlock-modal__benefits">
          {BENEFITS.map((benefit) => {
            const BenefitIcon = benefit.icon;

            return (
              <span key={benefit.label}>
                <BenefitIcon size={14} />
                {benefit.label}
              </span>
            );
          })}
        </div>

        <div className="direct-unlock-modal__content">
          <section className="direct-unlock-modal__main">
            <div className="direct-unlock-modal__section">
              <div className="direct-unlock-modal__section-heading">
                <span>01</span>
                <h2>Included</h2>
              </div>

              <div className="direct-unlock-modal__unlock-grid">
                {UNLOCK_ITEMS.map((item) => {
                  const ItemIcon = item.icon;

                  return (
                    <article key={item.title}>
                      <i>
                        <ItemIcon size={18} />
                      </i>
                      <strong>{item.title}</strong>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="direct-unlock-modal__section direct-unlock-modal__payment-section">
              <div className="direct-unlock-modal__section-heading">
                <span>02</span>
                <h2>{isPremium ? 'Confirm unlock' : 'Payment'}</h2>
                {!isPremium ? <small>Secure checkout</small> : null}
              </div>

              {!isPremium ? (
                <div className="direct-unlock-modal__currency">
                  <div className="direct-unlock-modal__currency-icon">
                    <CreditCard size={18} />
                  </div>

                  <div>
                    <small>Currency</small>
                    <strong>{pricing?.currency ?? '—'}</strong>
                    <span>Saved checkout currency.</span>
                  </div>

                  <button type="button" onClick={openPreferences}>
                    Change
                  </button>
                </div>
              ) : (
                <div className="direct-unlock-modal__currency direct-unlock-modal__currency--premium">
                  <div className="direct-unlock-modal__currency-icon">
                    <Sparkles size={18} />
                  </div>

                  <div>
                    <small>Available credits</small>
                    <strong>{creditBalance}</strong>
                    <span>One credit will be used.</span>
                  </div>
                </div>
              )}

              {!isPremium ? (
                <div className="direct-unlock-modal__methods">
                  {PAYMENT_METHODS.map((paymentMethod) => {
                    const Icon = paymentMethod.icon;
                    const isSelected = method === paymentMethod.key;

                    return (
                      <label
                        key={paymentMethod.key}
                        className={isSelected ? 'selected' : ''}
                      >
                        <input
                          type="radio"
                          name="payment-method"
                          value={paymentMethod.key}
                          checked={isSelected}
                          onChange={() => setMethod(paymentMethod.key)}
                        />

                        <i className="direct-unlock-modal__method-icon">
                          <Icon size={20} />
                        </i>

                        <span className="direct-unlock-modal__method-copy">
                          <span>
                            <strong>{paymentMethod.title}</strong>
                            <small>{paymentMethod.badge}</small>
                          </span>
                          <em>{paymentMethod.description}</em>
                        </span>

                        <i className="direct-unlock-modal__method-check">
                          {isSelected ? <CheckCircle2 size={17} /> : null}
                        </i>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {error ? (
                <div className="direct-unlock-modal__error">
                  {error}
                </div>
              ) : null}
            </div>
          </section>

          <aside className="direct-unlock-modal__summary">
            <div className="direct-unlock-modal__summary-title">
              <span>
                <Sparkles size={17} />
              </span>
              <h2>Summary</h2>
            </div>

            <dl>
              <div>
                <dt>{isPremium ? 'Cost' : 'Price'}</dt>
                <dd>{priceLabel}</dd>
              </div>

              <div>
                <dt>Access</dt>
                <dd>Permanent</dd>
              </div>
            </dl>

            <div className="direct-unlock-modal__summary-total">
              <span>Total</span>
              <strong>{priceLabel}</strong>
            </div>
          </aside>
        </div>

        <footer className="direct-unlock-modal__footer">
          <button
            type="button"
            className="direct-unlock-modal__pay"
            disabled={busy}
            onClick={checkout}
          >
            {busy ? (
              <>
                <LoaderCircle
                  size={18}
                  className="direct-unlock-modal__spin"
                />
                {isPremium
                  ? 'Unlocking workspace…'
                  : 'Opening checkout…'}
              </>
            ) : (
              <>
                {isPremium ? 'Use 1 credit' : 'Continue to payment'}
                {isPremium ? <Sparkles size={18} /> : <CreditCard size={18} />}
              </>
            )}
          </button>

          <div className="direct-unlock-modal__secure">
            <ShieldCheck size={15} />
            <span>
              <strong>
                {isPremium ? 'Credit-protected unlock' : 'Protected payment flow'}
              </strong>
              <small>
                {isPremium
                  ? 'A credit is deducted only for this unlock.'
                  : 'Access is granted after payment verification.'}
              </small>
            </span>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
