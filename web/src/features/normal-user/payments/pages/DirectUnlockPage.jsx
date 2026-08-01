/**
 * Premium direct-unlock checkout page using provider-hosted test environments.
 *
 * Stripe opens Test Checkout and PayPal opens Sandbox Checkout.
 *
 * @author Malak
 */

import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { createDirectUnlockCheckout } from '../api/directUnlockApi';
import '../styles/direct-unlock.css';

const PAYMENT_METHODS = [
  {
    key: 'card',
    title: 'Credit or debit card',
    description: 'Visa or Mastercard through Stripe Test Checkout',
    icon: CreditCard,
    badge: 'Most popular',
  },
  {
    key: 'paypal',
    title: 'PayPal',
    description: 'Continue securely through PayPal Sandbox Checkout',
    icon: WalletCards,
    badge: 'Sandbox',
  },
];

const BENEFITS = [
  'Full abstract and complete technical stack',
  'System architecture, database design, MVP and timeline',
  'Business, feasibility, market and budget outputs',
  'Business-model studio with polished PDF export',
];

export default function DirectUnlockPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const checkout = async () => {
    setBusy(true);
    setError('');

    try {
      const origin = window.location.origin;

      const result = await createDirectUnlockCheckout({
        ideaId,
        paymentMethodKey: method,
        successUrl: `${origin}/normal/ideas/${ideaId}/unlock/success`,
        cancelUrl: `${origin}/normal/ideas/${ideaId}/unlock`,
      });

      if (!result?.checkoutUrl) {
        throw new Error(
          'The payment provider did not return a checkout URL.',
        );
      }

      window.location.assign(result.checkoutUrl);
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to open secure checkout.',
      );
      setBusy(false);
    }
  };

  return (
    <motion.main
      className="unlock-page"
      initial={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
            }
      }
      animate={{
        opacity: 1,
      }}
      transition={{
        duration: 0.35,
      }}
    >
      <button
        className="unlock-back"
        type="button"
        onClick={() =>
          navigate(`/normal/ideas/${ideaId}`)
        }
      >
        <ArrowLeft size={17} />
        Back to idea
      </button>

      <section className="unlock-shell">
        <motion.article
          className="unlock-story"
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
          <div className="unlock-story__orb unlock-story__orb--one" />
          <div className="unlock-story__orb unlock-story__orb--two" />
          <div className="unlock-story__grid" />

          <div className="unlock-story__content">
            <span className="unlock-story__eyebrow">
              <Sparkles size={15} />
              Direct unlock
            </span>

            <h1>
              Turn one promising idea into a
              <em>complete execution workspace.</em>
            </h1>

            <p>
              Unlock the full execution package for this idea through a secure,
              provider-hosted checkout.
            </p>

            <div className="unlock-benefits">
              {BENEFITS.map((benefit, index) => (
                <motion.div
                  key={benefit}
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
                    duration: 0.45,
                    delay: shouldReduceMotion
                      ? 0
                      : 0.18 + index * 0.08,
                  }}
                >
                  <span>
                    <CheckCircle2 size={16} />
                  </span>

                  <div>
                    <small>
                      {String(index + 1).padStart(2, '0')}
                    </small>
                    <strong>{benefit}</strong>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="unlock-story__trust">
            <span>
              <ShieldCheck size={15} />
              Provider verified
            </span>

            <span>
              <LockKeyhole size={15} />
              Secure redirect
            </span>
          </div>
        </motion.article>

        <motion.aside
          className="unlock-checkout"
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
          <div className="unlock-lock">
            <LockKeyhole size={25} />
          </div>

          <span className="unlock-checkout__eyebrow">
            Secure checkout
          </span>

          <h2>Unlock this idea</h2>

          <p>
            Choose a payment method. Nexora sends you to the provider's secure
            checkout and unlocks access only after verified confirmation.
          </p>

          <div className="unlock-methods">
            {PAYMENT_METHODS.map((paymentMethod) => {
              const Icon = paymentMethod.icon;
              const isSelected =
                method === paymentMethod.key;

              return (
                <motion.label
                  key={paymentMethod.key}
                  className={
                    isSelected ? 'selected' : ''
                  }
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : {
                          y: -3,
                        }
                  }
                  whileTap={
                    shouldReduceMotion
                      ? undefined
                      : {
                          scale: 0.99,
                        }
                  }
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={paymentMethod.key}
                    checked={isSelected}
                    onChange={() =>
                      setMethod(paymentMethod.key)
                    }
                  />

                  <span className="unlock-methods__icon">
                    <Icon size={20} />
                  </span>

                  <span className="unlock-methods__copy">
                    <span>
                      <strong>
                        {paymentMethod.title}
                      </strong>
                      <small>
                        {paymentMethod.badge}
                      </small>
                    </span>

                    <em>
                      {paymentMethod.description}
                    </em>
                  </span>

                  <span className="unlock-methods__check">
                    {isSelected ? (
                      <CheckCircle2 size={17} />
                    ) : null}
                  </span>
                </motion.label>
              );
            })}
          </div>

          {error ? (
            <div className="unlock-error">
              {error}
            </div>
          ) : null}

          <motion.button
            className="unlock-pay"
            type="button"
            disabled={busy}
            onClick={checkout}
            whileHover={
              shouldReduceMotion || busy
                ? undefined
                : {
                    y: -3,
                  }
            }
            whileTap={
              shouldReduceMotion || busy
                ? undefined
                : {
                    scale: 0.985,
                  }
            }
          >
            {busy ? (
              <>
                <LoaderCircle
                  size={18}
                  className="unlock-spin"
                />
                Opening secure checkout…
              </>
            ) : (
              <>
                Continue to payment
                <CreditCard size={18} />
              </>
            )}
          </motion.button>

          <div className="unlock-secure">
            <ShieldCheck size={15} />

            <span>
              <strong>Protected payment flow</strong>
              <small>
                Access is granted only after the provider webhook is verified.
              </small>
            </span>
          </div>
        </motion.aside>
      </section>
    </motion.main>
  );
}