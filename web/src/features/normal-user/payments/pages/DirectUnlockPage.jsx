/**
 * Premium direct-unlock checkout page using Stripe-hosted Test Checkout.
 *
 * @author Malak
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useUserExperience } from '../../../../system/user-experience';

import {
  createDirectUnlockCheckout,
  unlockIdeaWithCredit,
} from '../api/directUnlockApi';
import { getPaymentPricing } from '../api/paymentFlowApi';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { storePaymentReturnReference } from '../utils/paymentReturn.storage';
import {
  getStoredPaymentCurrency,
  loadPreferredPaymentCurrency,
} from '../utils/paymentCurrency';
import '../styles/direct-unlock.css';

const PAYMENT_METHODS = [
  {
    key: 'card',
    title: 'Credit or debit card',
    description: 'Visa or Mastercard through Stripe Test Checkout',
    icon: CreditCard,
    badge: 'Most popular',
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
  const { t, isArabic } = useUserExperience();
  const { isPremium, creditBalance, refresh } = useAccountAccess();

  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pricing, setPricing] = useState(null);
  const [currency, setCurrency] = useState(getStoredPaymentCurrency);

  useEffect(() => {
    let mounted = true;

    loadPreferredPaymentCurrency({ force: true })
      .then((preferredCurrency) => {
        if (!mounted) return null;
        setCurrency(preferredCurrency);
        return getPaymentPricing(1, { currency: preferredCurrency });
      })
      .then((data) => {
        if (mounted && data) {
          setPricing(data);
          setError('');
        }
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const requiredCredits = Number(pricing?.premiumIdeaCreditCost);
  const hasCreditCost = Number.isInteger(requiredCredits) && requiredCredits > 0;
  const creditLabel = hasCreditCost
    ? `${requiredCredits} ${t(requiredCredits === 1 ? 'credit' : 'credits')}`
    : t('Loading credit cost…');

  const checkout = async () => {
    setBusy(true);
    setError('');

    try {
      if (isPremium) {
        await unlockIdeaWithCredit(ideaId);
        await refresh();
        window.dispatchEvent(new Event('nexora:credits-updated'));
        navigate(workspacePath(`/normal/ideas/${ideaId}`), {
          replace: true,
          state: { unlockedWithCredit: true },
        });
        return;
      }

      const origin = window.location.origin;
      const result = await createDirectUnlockCheckout({
        ideaId,
        paymentMethodKey: method,
        currency,
        successUrl: `${origin}${workspacePath(`/normal/payments/success`)}`,
        cancelUrl: `${origin}${workspacePath(`/normal/ideas/${ideaId}/unlock`)}`,
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
          navigate(workspacePath(`/normal/ideas/${ideaId}`))
        }
      >
        <ArrowLeft size={17} />
        {t('Back to idea')}
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
              {t(isPremium ? 'Unlock idea' : 'Direct unlock')}
            </span>

            <h1>
              {t('Turn one promising idea into a')}
              <em>{t('complete execution workspace.')}</em>
            </h1>

            <p>
              {isPremium
                ? hasCreditCost
                  ? (isArabic ? `استخدم ${creditLabel} لفتح الميزات المتقدمة ومحادثة الذكاء الاصطناعي لهذه الفكرة المجانية.` : `Spend ${creditLabel} to unlock the advanced features and AI Chat for this free idea.`)
                  : 'Loading the required credit amount from your workspace settings…'
                : t('Unlock the full execution package for this idea through a secure, provider-hosted checkout.')}
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
                    <strong>{t(benefit)}</strong>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="unlock-story__trust">
            <span>
              <ShieldCheck size={15} />
              {t(isPremium ? 'No direct payment' : 'Provider verified')}
            </span>

            <span>
              <LockKeyhole size={15} />
              {isPremium ? (hasCreditCost ? `${creditLabel} ${t('only')}` : t('Database-priced credits')) : t('Secure redirect')}
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
            {t(isPremium ? 'Premium credit access' : 'Secure checkout')}
          </span>

          <h2>{t('Unlock this idea')}</h2>
          <div className="unlock-backend-price">
            {isPremium
              ? hasCreditCost
                ? `${creditLabel} · ${creditBalance} available`
                : t('Loading credit cost…')
              : pricing
                ? `${pricing.directUnlockPrice} ${pricing.currency}`
                : t('Loading price…')}
          </div>

          <p>
            {isPremium
              ? hasCreditCost
                ? (isArabic ? `مستخدمو بريميوم لا يدفعون مباشرة هنا. عند التأكيد سيتم خصم ${creditLabel} وتجهيز مساحة العمل المتقدمة.` : `Premium users do not pay directly here. Confirming will deduct ${creditLabel} and generate the advanced workspace.`)
                : 'Loading the required credit amount from the database…'
              : t("Choose a payment method. Voxidence sends you to the provider's secure checkout and unlocks access only after verified confirmation.")}
          </p>

          {!isPremium ? (
            <div className="unlock-currency-preference">
              <span><CreditCard size={16} /></span>
              <div>
                <small>{t('Payment currency')}</small>
                <strong dir="ltr" data-no-auto-translate="true">{currency}</strong>
                <p>{t('Saved once and used automatically for checkout.')}</p>
              </div>
              <Link
                to={workspacePath("/normal/preferences")}
                state={{
                  returnTo: workspacePath(`/normal/ideas/${ideaId}/unlock`),
                  returnLabel: 'Back to direct unlock',
                }}
              >
                {t('Change in Preferences')}
              </Link>
            </div>
          ) : null}

          {!isPremium ? <div className="unlock-methods">
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
          </div> : null}

          {error ? (
            <div className="unlock-error">
              {error}
            </div>
          ) : null}

          <motion.button
            className="unlock-pay"
            type="button"
            disabled={busy || (!isPremium && !pricing) || (isPremium && !hasCreditCost)}
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
                {isPremium ? 'Unlocking advanced workspace…' : 'Opening secure checkout…'}
              </>
            ) : (
              <>
                {isPremium ? `Use ${creditLabel}` : 'Continue to payment'}
                {isPremium ? <Sparkles size={18} /> : <CreditCard size={18} />}
              </>
            )}
          </motion.button>

          <div className="unlock-secure">
            <ShieldCheck size={15} />

            <span>
              <strong>{isPremium ? 'Credit-protected unlock' : 'Protected payment flow'}</strong>
              <small>
                {isPremium
                  ? hasCreditCost
                    ? `${creditLabel} ${requiredCredits === 1 ? 'is' : 'are'} deducted only for this free idea. Failed generation is refunded automatically.`
                    : 'The required credit amount is loaded from system settings before unlock.'
                  : 'Access is granted only after the provider webhook is verified.'}
              </small>
            </span>
          </div>
        </motion.aside>
      </section>
    </motion.main>
  );
}