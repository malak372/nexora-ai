import {
  CheckCircle2,
  CreditCard,
  Crown,
  BotMessageSquare,
  Eye,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { getStoredUser } from '../../../auth/shared/auth.storage';
import { createCreditsCheckout } from '../api/upgradeApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { storePaymentReturnReference } from '../../payments/utils/paymentReturn.storage';
import {
  getStoredPaymentCurrency,
  loadPreferredPaymentCurrency,
} from '../../payments/utils/paymentCurrency';
import '../styles/upgrade.css';

const QUICK_AMOUNTS = [15, 30, 45, 60];

const BENEFITS = [
  {
    icon: Sparkles,
    title: 'Premium idea generation',
    description:
      'Each Premium idea uses the credit cost configured by the system and includes the complete technical, business, feasibility, market, budget, and execution outputs.',
  },
  {
    icon: BotMessageSquare,
    title: 'AI Chat for unlocked ideas',
    description:
      'Use Voxidence Chat while your account is Premium to explore and refine ideas that are already unlocked.',
  },
  {
    icon: Eye,
    title: 'See every active published idea',
    description:
      'Browse all active published ideas even when a publication was originally limited to another audience category.',
  },
  {
    icon: UsersRound,
    title: 'Premium publication access',
    description:
      'Use the Premium acceptance flow for published ideas, then spend the configured credit cost only when unlocking advanced publication outputs.',
  },
  {
    icon: CheckCircle2,
    title: 'Permanent unlocked access',
    description:
      'Ideas and outputs already generated or unlocked remain available even after your credit balance reaches zero.',
  },
  {
    icon: Crown,
    title: 'Premium account capabilities',
    description:
      'Premium status enables the Premium discovery and AI workspace experience while the account remains Premium.',
  },
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
  const shouldReduceMotion = useReducedMotion();
  const storedUser = getStoredUser() || {};

  const [credits, setCredits] = useState(15);
  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingRefreshKey, setPricingRefreshKey] = useState(0);
  const [currency, setCurrency] = useState(getStoredPaymentCurrency);
  const [currencyReady, setCurrencyReady] = useState(false);

  const isAlreadyPremium =
    (pricing?.accountStatus || storedUser.accountStatus) === 'PREMIUM';

  const minimumCredits = useMemo(() => {
    if (isAlreadyPremium) {
      return 1;
    }

    return Math.max(
      1,
      Number(pricing?.minimumCreditsForPremiumActivation) || 1,
    );
  }, [isAlreadyPremium, pricing?.minimumCreditsForPremiumActivation]);

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
    if (!currencyReady) {
      return undefined;
    }

    let active = true;

    setPricingLoading(true);

    getPaymentPricing(credits, { currency })
      .then((value) => {
        if (!active) {
          return;
        }

        setPricing(value);
        setError('');

        const responseIsPremium = value?.accountStatus === 'PREMIUM';
        const requiredMinimum = responseIsPremium
          ? 1
          : Math.max(
            1,
            Number(value?.minimumCreditsForPremiumActivation) || 1,
          );

        setCredits((current) =>
          current < requiredMinimum ? requiredMinimum : current,
        );
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        const message = String(requestError?.message || '').trim();

        setPricing(null);

        if (
          /exchange rate|currency rate|rate is temporarily unavailable/i.test(
            message,
          )
        ) {
          setError(
            `The ${currency} exchange rate could not be refreshed right now. Retry in a moment or change your saved currency in Preferences.`,
          );
        } else if (/internal server error/i.test(message)) {
          setError(
            'Pricing is temporarily unavailable. Please retry in a moment.',
          );
        } else {
          setError(message || 'Pricing could not be loaded.');
        }
      })
      .finally(() => {
        if (active) {
          setPricingLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [credits, currency, currencyReady, pricingRefreshKey]);

  const totalLabel = useMemo(
    () =>
      `${credits} premium credit${credits === 1 ? '' : 's'
      }`,
    [credits],
  );

  const updateCredits = (value) => {
    const parsedValue = Math.floor(Number(value) || minimumCredits);
    const nextValue = Math.max(minimumCredits, parsedValue);

    setCredits(nextValue);
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
        successUrl: `${origin}/normal/payments/success`,
        cancelUrl: `${origin}/normal/credits?payment=cancelled`,
      });

      if (!result?.checkoutUrl) {
        throw new Error(
          'The payment provider did not return a checkout URL.',
        );
      }

      storePaymentReturnReference({
        paymentId: result.paymentId,
        paymentPurpose: result.paymentPurpose ?? 'BUY_CREDITS',
      });

      window.location.assign(result.checkoutUrl);
    } catch (requestError) {
      const message = String(
        requestError?.message ||
        'Checkout could not be created.',
      );

      if (
        /invalid api key|authentication|401|payment session/i.test(
          message,
        )
      ) {
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

  return (
    <motion.main
      className="upgrade-page reveal-page"
      initial={
        shouldReduceMotion
          ? undefined
          : { opacity: 0 }
      }
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <motion.section
        className="upgrade-story"
        initial={
          shouldReduceMotion
            ? undefined
            : {
              opacity: 0,
              x: -26,
              scale: 0.985,
            }
        }
        animate={{
          opacity: 1,
          x: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.68,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="upgrade-story__grid" />
        <div className="upgrade-story__orb upgrade-story__orb--one" />
        <div className="upgrade-story__orb upgrade-story__orb--two" />

        <div className="upgrade-story__content">
          <span className="upgrade-story__eyebrow">
            <Crown size={16} />
            Voxidence premium credits
          </span>

          <h1>
            Unlock premium capabilities
            <em>only when you need them.</em>
          </h1>

          <p>
            {isAlreadyPremium
              ? 'Add more credits to keep using your Premium generation and advanced idea capabilities.'
              : 'Activate your Premium account and add credits for complete idea generation and advanced outputs.'}
          </p>

          <div className="upgrade-benefits">
            {BENEFITS.map((benefit, index) => {
              const BenefitIcon = benefit.icon;

              return (
                <motion.article
                  key={benefit.title}
                  initial={
                    shouldReduceMotion
                      ? undefined
                      : {
                        opacity: 0,
                        y: 18,
                      }
                  }
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.42,
                    delay: shouldReduceMotion
                      ? 0
                      : 0.18 + index * 0.08,
                  }}
                >
                  <span>
                    <BenefitIcon size={16} />
                  </span>

                  <div>
                    <small>
                      {String(index + 1).padStart(
                        2,
                        '0',
                      )}
                    </small>
                    <strong>{benefit.title}</strong>
                    <p>{benefit.description}</p>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>

        <div className="upgrade-story__trust">
          <span>
            <ShieldCheck size={15} />
            Verified provider webhook
          </span>

          <span>
            <Sparkles size={15} />
            Permanent unlocked access
          </span>
        </div>
      </motion.section>

      <motion.aside
        className="upgrade-checkout"
        initial={
          shouldReduceMotion
            ? undefined
            : {
              opacity: 0,
              x: 26,
              scale: 0.985,
            }
        }
        animate={{
          opacity: 1,
          x: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.68,
          delay: shouldReduceMotion ? 0 : 0.08,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <span className="upgrade-summary-kicker">
          {isAlreadyPremium ? 'Additional premium purchase' : 'Premium activation'}
        </span>

        <h2>{isAlreadyPremium ? 'Choose your credit amount' : 'Activate Premium'}</h2>

        <p className="upgrade-summary-copy">
          {isAlreadyPremium
            ? 'Select a shortcut or enter the exact quantity you want to add.'
            : 'Choose your starting credit balance. The backend will activate Premium automatically after the payment is verified.'}
        </p>

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
                whileHover={
                  shouldReduceMotion
                    ? undefined
                    : { y: -2 }
                }
                whileTap={
                  shouldReduceMotion
                    ? undefined
                    : { scale: 0.985 }
                }
              >
                <span className="upgrade-quantity__status">
                  {isSelected ? <CheckCircle2 size={14} /> : null}
                </span>

                <strong>{amount}</strong>

                <small>
                  credit{amount > 1 ? 's' : ''}
                </small>
              </motion.button>
            );
          })}
        </div>

        <div className="upgrade-custom-quantity">
          <div className="upgrade-custom-quantity__heading">
            <span>Custom quantity</span>
            <small>
              {isAlreadyPremium
                ? 'No minimum beyond 1 credit'
                : `Minimum ${minimumCredits} credits to activate Premium`}
            </small>
          </div>

          <div className="upgrade-custom-quantity__control">
            <button
              type="button"
              onClick={() =>
                updateCredits(credits - 1)
              }
              aria-label="Decrease credits"
              disabled={credits <= minimumCredits}
            >
              <Minus size={16} />
            </button>

            <input
              type="number"
              min={minimumCredits}
              value={credits}
              onChange={(event) =>
                updateCredits(event.target.value)
              }
            />

            <button
              type="button"
              onClick={() =>
                updateCredits(credits + 1)
              }
              aria-label="Increase credits"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="upgrade-section-title">
          <span>Payment method</span>
          <small>Provider-hosted checkout</small>
        </div>

        <div className="upgrade-payment-stack">
          <div className="upgrade-currency-preference">
            <span className="upgrade-currency-preference__icon">
              <CreditCard size={17} />
            </span>

            <div>
              <small>Saved payment currency</small>
              <strong>{currency}</strong>
              <p>Used automatically for every checkout.</p>
            </div>

            <Link
              to="/normal/preferences"
              state={{
                returnTo: '/normal/credits',
                returnLabel: 'Back to Premium credits',
              }}
            >
              Change
            </Link>
          </div>

          <div className="upgrade-methods">
            {PAYMENT_METHODS.map(
              (paymentMethod) => {
                const Icon = paymentMethod.icon;
                const isSelected = method === paymentMethod.key;

                return (
                  <motion.label
                    key={paymentMethod.key}
                    className={isSelected ? 'selected' : ''}
                    whileHover={
                      shouldReduceMotion
                        ? undefined
                        : { y: -2 }
                    }
                    whileTap={
                      shouldReduceMotion
                        ? undefined
                        : { scale: 0.99 }
                    }
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      checked={isSelected}
                      onChange={() => setMethod(paymentMethod.key)}
                    />

                    <span className="upgrade-methods__icon">
                      <Icon size={19} />
                    </span>

                    <span className="upgrade-methods__copy">
                      <span>
                        <b>{paymentMethod.title}</b>
                        <small>{paymentMethod.badge}</small>
                      </span>

                      <em>{paymentMethod.description}</em>
                    </span>

                    <span className="upgrade-methods__check">
                      {isSelected ? <CheckCircle2 size={16} /> : null}
                    </span>
                  </motion.label>
                );
              },
            )}
          </div>
        </div>

        <div className="upgrade-pricing-grid">
          <div className="upgrade-credit-price">
            <div>
              <span>Credit price</span>
              <small>Current backend price in your saved currency</small>
            </div>

            <strong>
              {pricingLoading
                ? 'Updating…'
                : pricing
                  ? `1 credit = ${pricing.creditPrice} ${pricing.currency}`
                  : 'Loading…'}
            </strong>
          </div>

          <div
            className={`upgrade-activation-fee ${isAlreadyPremium ? 'is-inactive' : 'is-applicable'
              }`}
          >
            <span>
              <Crown size={16} />
            </span>

            <div>
              <strong>
                {isAlreadyPremium
                  ? 'No Premium activation fee'
                  : 'Premium activation fee'}
              </strong>

              <small>
                {isAlreadyPremium
                  ? 'Already Premium, so this fee is not charged again.'
                  : pricing
                    ? `${pricing.activationFeeApplied} ${pricing.currency} applies when a Normal account activates Premium.`
                    : 'Loading the current activation fee…'}
              </small>
            </div>
          </div>
        </div>

        <div className="upgrade-order-summary">
          <div>
            <span>Selected package</span>
            <small>
              {pricing ? `${credits} credits subtotal: ${pricing.creditPurchaseSubtotal ?? '—'} ${pricing.currency}.` : 'Final amount is calculated by the backend from current database pricing.'}
            </small>
          </div>

          <strong>
            {pricingLoading
              ? 'Updating…'
              : pricing
                ? `${pricing.creditPurchaseTotal} ${pricing.currency}`
                : totalLabel}
          </strong>
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
              Retry
            </button>
          </div>
        ) : null}

        <motion.button
          className="upgrade-checkout-button"
          type="button"
          disabled={busy || pricingLoading || !pricing}
          onClick={checkout}
          whileHover={
            shouldReduceMotion || busy
              ? undefined
              : { y: -3 }
          }
          whileTap={
            shouldReduceMotion || busy
              ? undefined
              : { scale: 0.985 }
          }
        >
          {busy ? (
            <>
              <LoaderCircle
                className="upgrade-spin"
                size={18}
              />
              Creating secure checkout…
            </>
          ) : (
            <>
              Continue to secure payment
              <CreditCard size={18} />
            </>
          )}
        </motion.button>

        <div className="upgrade-secure">
          <ShieldCheck size={15} />

          <span>
            <strong>
              Protected payment flow
            </strong>

            <small>
              {isAlreadyPremium
                ? 'Credits are added only after a verified provider webhook.'
                : 'Premium is activated and credits are added only after a verified provider webhook.'}
            </small>
          </span>
        </div>
      </motion.aside>
    </motion.main>
  );
}