import {
  ArrowRight,
  BotMessageSquare,
  CheckCircle2,
  Coins,
  CreditCard,
  Crown,
  Eye,
  Lightbulb,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { createCreditsCheckout } from '../api/upgradeApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { storePaymentReturnReference } from '../../payments/utils/paymentReturn.storage';
import {
  getStoredPaymentCurrency,
  loadPreferredPaymentCurrency,
} from '../../payments/utils/paymentCurrency';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { workspacePath } from '../../shared/utils/workspacePath';
import { useUserExperience } from '../../../../system/user-experience';
import '../styles/upgrade.css';

const QUICK_AMOUNTS = [15, 30, 45, 60];

const BENEFITS = [
  { icon: Sparkles, title: 'Premium idea generation' },
  { icon: BotMessageSquare, title: 'AI Chat for unlocked ideas' },
  { icon: Eye, title: 'See every active published idea' },
  { icon: UsersRound, title: 'Premium publication access' },
  { icon: CheckCircle2, title: 'Permanent unlocked access' },
  { icon: Crown, title: 'Premium account capabilities' },
];

const PAYMENT_METHODS = [
  {
    key: 'card',
    title: 'Credit or debit card',
    description: 'Visa or Mastercard through Stripe Checkout',
    badge: 'Most popular',
    icon: CreditCard,
  },
];

export default function UpgradePage() {
  const { t } = useUserExperience();
  const { isPremium, isLoading: accessLoading } = useAccountAccess();
  const shouldReduceMotion = useReducedMotion();
  const navigate = useNavigate();

  const [credits, setCredits] = useState(15);
  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingRefreshKey, setPricingRefreshKey] = useState(0);
  const [currency, setCurrency] = useState(getStoredPaymentCurrency);
  const [currencyReady, setCurrencyReady] = useState(false);

  const minimumCredits = useMemo(
    () => Math.max(1, Number(pricing?.minimumCreditsForPremiumActivation) || 1),
    [pricing?.minimumCreditsForPremiumActivation],
  );

  useEffect(() => {
    let active = true;

    loadPreferredPaymentCurrency({ force: true })
      .then((preferredCurrency) => {
        if (active) setCurrency(preferredCurrency);
      })
      .finally(() => {
        if (active) setCurrencyReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currencyReady) return undefined;

    let active = true;
    setPricingLoading(true);

    getPaymentPricing(credits, { currency })
      .then((value) => {
        if (!active) return;

        setPricing(value);
        setError('');

        const requiredMinimum = Math.max(
          1,
          Number(value?.minimumCreditsForPremiumActivation) || 1,
        );

        setCredits((current) =>
          current < requiredMinimum ? requiredMinimum : current,
        );
      })
      .catch((requestError) => {
        if (!active) return;

        const message = String(requestError?.message || '').trim();
        setPricing(null);

        if (/exchange rate|currency rate|rate is temporarily unavailable/i.test(message)) {
          setError(
            `The ${currency} exchange rate could not be refreshed right now. Retry in a moment or change your saved currency in Preferences.`,
          );
        } else if (/internal server error/i.test(message)) {
          setError('Pricing is temporarily unavailable. Please retry in a moment.');
        } else {
          setError(message || 'Pricing could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setPricingLoading(false);
      });

    return () => {
      active = false;
    };
  }, [credits, currency, currencyReady, pricingRefreshKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const totalLabel = useMemo(
    () => `${credits} premium credit${credits === 1 ? '' : 's'}`,
    [credits],
  );

  const updateCredits = (value) => {
    const parsedValue = Math.floor(Number(value) || minimumCredits);
    setCredits(Math.max(minimumCredits, parsedValue));
  };

  const checkout = async () => {
    try {
      setBusy(true);
      setError('');

      const origin = window.location.origin;
      const creditsQuantity = Math.floor(Number(credits) || 0);

      if (creditsQuantity < minimumCredits) {
        throw new Error(
          `At least ${minimumCredits} credits are required for this purchase.`,
        );
      }

      const result = await createCreditsCheckout({
        creditsQuantity,
        paymentMethodKey: method,
        currency,
        successUrl: `${origin}${workspacePath('/normal/payments/success')}`,
        cancelUrl: `${origin}${workspacePath('/normal/upgrade?payment=cancelled')}`,
      });

      if (!result?.checkoutUrl) {
        throw new Error('The payment provider did not return a checkout URL.');
      }

      storePaymentReturnReference({
        paymentId: result.paymentId,
        paymentPurpose: result.paymentPurpose ?? 'BUY_CREDITS',
      });

      window.location.assign(result.checkoutUrl);
    } catch (requestError) {
      const message = String(
        requestError?.message || 'Checkout could not be created.',
      );

      if (/invalid api key|authentication|401|payment session/i.test(message)) {
        setError(
          'The selected payment provider is not configured correctly on the server. Add valid test credentials, restart the backend, then try again.',
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!accessLoading && isPremium) {
    return <Navigate to="/premium/buy-credits" replace />;
  }

  return createPortal(
    <motion.main
      className="upgrade-purchase-overlay"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('Upgrade to Premium')}
    >
      <motion.section
        className="upgrade-modal"
        initial={
          shouldReduceMotion
            ? undefined
            : { opacity: 0, y: 26, scale: 0.975 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <button
          type="button"
          className="upgrade-modal__close"
          onClick={() => navigate(-1)}
          aria-label={t('Close')}
        >
          <X size={20} />
        </button>

        <div className="upgrade-modal__glow upgrade-modal__glow--mint" />
        <div className="upgrade-modal__glow upgrade-modal__glow--rose" />

        <header className="upgrade-modal__hero">
          <div className="upgrade-modal__intro">
            <span className="upgrade-modal__eyebrow">
              <Crown size={15} />
              {t('Voxidence Premium')}
            </span>

            <h1>{t('Unlock premium capabilities')}</h1>
            <p>
              {t('Activate your Premium account and add credits for complete idea generation and advanced outputs.')}
            </p>

            <div className="upgrade-mini-benefits">
              {BENEFITS.map((benefit) => {
                const BenefitIcon = benefit.icon;

                return (
                  <motion.div
                    className="upgrade-mini-benefit"
                    key={benefit.title}
                    initial={shouldReduceMotion ? undefined : { opacity: 0, y: 7 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.34,
                      delay: shouldReduceMotion ? 0 : 0.08 + (BENEFITS.indexOf(benefit) * 0.045),
                    }}
                    whileHover={shouldReduceMotion ? undefined : { y: -2, scale: 1.015 }}
                  >
                    <span><BenefitIcon size={15} /></span>
                    <strong>{t(benefit.title)}</strong>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="upgrade-premium-visual" aria-hidden="true">
            <span className="upgrade-premium-visual__spark upgrade-premium-visual__spark--one">✦</span>
            <span className="upgrade-premium-visual__spark upgrade-premium-visual__spark--two">✦</span>
            <span className="upgrade-premium-visual__spark upgrade-premium-visual__spark--three">✦</span>
            <div className="upgrade-premium-visual__leaf upgrade-premium-visual__leaf--one" />
            <div className="upgrade-premium-visual__leaf upgrade-premium-visual__leaf--two" />
            <div className="upgrade-premium-visual__platform" />
            <div className="upgrade-premium-visual__card">
              <Lightbulb size={58} strokeWidth={1.65} />
            </div>
            <div className="upgrade-premium-visual__coin upgrade-premium-visual__coin--one">
              <Coins size={24} />
            </div>
            <div className="upgrade-premium-visual__coin upgrade-premium-visual__coin--two">
              <Crown size={18} />
            </div>
          </div>
        </header>

        <section className="upgrade-amount-card">
          <div className="upgrade-section-heading">
            <div>
              <span className="upgrade-step">01</span>
              <h2>{t('Choose your starting credits')}</h2>
            </div>
            <small>
              {t('Minimum')} {minimumCredits} {t('credits to activate Premium')}
            </small>
          </div>

          <div className="upgrade-amount-row">
            <div className="upgrade-quantity">
              {QUICK_AMOUNTS.map((amount) => {
                const isSelected = credits === amount;

                return (
                  <motion.button
                    type="button"
                    className={isSelected ? 'selected' : ''}
                    onClick={() => setCredits(amount)}
                    disabled={amount < minimumCredits}
                    key={amount}
                    aria-pressed={isSelected}
                    whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
                  >
                    <span className="upgrade-quantity__status">
                      {isSelected ? <CheckCircle2 size={15} /> : null}
                    </span>
                    <strong>{amount}</strong>
                    <small>{t(amount > 1 ? 'credits' : 'credit')}</small>
                  </motion.button>
                );
              })}
            </div>

            <div className="upgrade-custom-quantity">
              <span>{t('Custom quantity')}</span>
              <div className="upgrade-custom-quantity__control">
                <button
                  type="button"
                  onClick={() => updateCredits(credits - 1)}
                  aria-label={t('Decrease credits')}
                  disabled={credits <= minimumCredits}
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  min={minimumCredits}
                  value={credits}
                  onChange={(event) => updateCredits(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => updateCredits(credits + 1)}
                  aria-label={t('Increase credits')}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="upgrade-modal__bottom">
          <section className="upgrade-payment-card">
            <div className="upgrade-section-heading upgrade-section-heading--compact">
              <div>
                <span className="upgrade-step">02</span>
                <h2>{t('Payment method')}</h2>
              </div>
              <small>
                <ShieldCheck size={13} /> {t('Provider-hosted checkout')}
              </small>
            </div>

            <div className="upgrade-currency-preference">
              <span className="upgrade-currency-preference__icon">
                <CreditCard size={18} />
              </span>
              <div>
                <small>{t('Saved payment currency')}</small>
                <strong dir="ltr" data-no-auto-translate="true">{currency}</strong>
              </div>
              <Link
                to={workspacePath('/normal/preferences')}
                state={{
                  returnTo: workspacePath('/normal/upgrade'),
                  returnLabel: 'Back to Premium upgrade',
                }}
              >
                {t('Change')}
              </Link>
            </div>

            <div className="upgrade-methods">
              {PAYMENT_METHODS.map((paymentMethod) => {
                const Icon = paymentMethod.icon;
                const isSelected = method === paymentMethod.key;

                return (
                  <motion.label
                    key={paymentMethod.key}
                    className={isSelected ? 'selected' : ''}
                    whileHover={shouldReduceMotion ? undefined : { y: -2 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      checked={isSelected}
                      onChange={() => setMethod(paymentMethod.key)}
                    />
                    <span className="upgrade-methods__icon">
                      <Icon size={18} />
                    </span>
                    <span className="upgrade-methods__copy">
                      <span>
                        <b>{t(paymentMethod.title)}</b>
                        <small>{t(paymentMethod.badge)}</small>
                      </span>
                      <em>{t(paymentMethod.description)}</em>
                    </span>
                    <span className="upgrade-methods__check">
                      {isSelected ? <CheckCircle2 size={17} /> : null}
                    </span>
                  </motion.label>
                );
              })}
            </div>
          </section>

          <section className="upgrade-summary-card">
            <div className="upgrade-summary-card__title">
              <span><Sparkles size={15} /></span>
              <h2>{t('Summary')}</h2>
            </div>

            <div className="upgrade-summary-card__rows">
              <div>
                <span>{t('Credits')}</span>
                <strong>{credits}</strong>
              </div>
              <div>
                <span>{t('Credit price')}</span>
                <strong>
                  {pricingLoading
                    ? 'Updating…'
                    : pricing
                      ? `${pricing.creditPrice} ${pricing.currency}`
                      : '—'}
                </strong>
              </div>
              <div>
                <span>{t('Premium activation fee')}</span>
                <strong>
                  {pricingLoading
                    ? 'Updating…'
                    : pricing
                      ? `${pricing.activationFeeApplied} ${pricing.currency}`
                      : '—'}
                </strong>
              </div>
            </div>

            <div className="upgrade-summary-card__total">
              <span>{t('Total')}</span>
              <motion.strong
                key={
                  pricingLoading
                    ? 'loading'
                    : pricing
                      ? `${pricing.creditPurchaseTotal}-${pricing.currency}`
                      : totalLabel
                }
                initial={shouldReduceMotion ? undefined : { opacity: 0.45, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
              >
                {pricingLoading
                  ? 'Updating…'
                  : pricing
                    ? `${pricing.creditPurchaseTotal} ${pricing.currency}`
                    : totalLabel}
              </motion.strong>
            </div>
          </section>
        </div>

        {error ? (
          <div className="upgrade-error">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                setError('');
                setPricingRefreshKey((value) => value + 1);
              }}
              disabled={pricingLoading}
            >
              <RefreshCw size={13} />
              {t('Retry')}
            </button>
          </div>
        ) : null}

        <footer className="upgrade-modal__footer">
          <div className="upgrade-secure-note">
            <ShieldCheck size={17} />
            <span>
              <strong>{t('Protected payment flow')}</strong>
              <small>
                {t('Premium is activated and credits are added only after a verified provider webhook.')}
              </small>
            </span>
          </div>

          <motion.button
            className="upgrade-checkout-button"
            type="button"
            disabled={busy || pricingLoading || !pricing}
            onClick={checkout}
            whileHover={shouldReduceMotion || busy ? undefined : { y: -2 }}
            whileTap={shouldReduceMotion || busy ? undefined : { scale: 0.985 }}
          >
            {busy ? (
              <>
                <LoaderCircle className="upgrade-spin" size={18} />
                {t('Creating secure checkout…')}
              </>
            ) : (
              <>
                {t('Upgrade to Premium')}
                <ArrowRight size={18} />
              </>
            )}
          </motion.button>
        </footer>
      </motion.section>
    </motion.main>,
    document.body,
  );
}