import {
    CheckCircle2,
    Coins,
    CreditCard,
    Crown,
    Lightbulb,
    LoaderCircle,
    Minus,
    Plus,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { createCreditsCheckout } from '../api/creditsApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { storePaymentReturnReference } from '../../payments/utils/paymentReturn.storage';
import {
    getStoredPaymentCurrency,
    loadPreferredPaymentCurrency,
} from '../../payments/utils/paymentCurrency';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { workspacePath } from '../../shared/utils/workspacePath';
import { useUserExperience } from '../../../../system/user-experience';
import '../styles/buy-credits.css';

const QUICK_AMOUNTS = [15, 30, 45, 60];

export default function BuyCreditsPage() {
    const { t } = useUserExperience();
    const { creditBalance, isPremium, isLoading: accessLoading } = useAccountAccess();
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

    const updateCredits = (value) => {
        const parsedValue = Math.floor(Number(value) || 1);
        setCredits(Math.max(1, parsedValue));
    };

    const checkout = async () => {
        try {
            setBusy(true);
            setError('');

            const origin = window.location.origin;
            const creditsQuantity = Math.floor(Number(credits) || 0);

            if (creditsQuantity < 1) {
                throw new Error('At least 1 credit is required for this purchase.');
            }

            const result = await createCreditsCheckout({
                creditsQuantity,
                paymentMethodKey: method,
                currency,
                successUrl: `${origin}${workspacePath('/premium/payments/success')}`,
                cancelUrl: `${origin}${workspacePath('/premium/buy-credits?payment=cancelled')}`,
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

    if (!accessLoading && !isPremium) {
        return <Navigate to="/normal/upgrade" replace />;
    }

    if (accessLoading && !isPremium) {
        return null;
    }

    const totalPrice = pricing
        ? `${pricing.creditPurchaseTotal} ${pricing.currency}`
        : '—';
    const nextBalance = Math.max(0, Number(creditBalance || 0)) + credits;

    return createPortal(
        <motion.main
            className="upgrade-purchase-overlay credits-topup-overlay"
            initial={shouldReduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
            role="dialog"
            aria-modal="true"
            aria-label={t('Buy more credits')}
        >
            <motion.section
                className="credits-topup-modal"
                initial={
                    shouldReduceMotion
                        ? undefined
                        : { opacity: 0, y: 18, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            >
                <button
                    type="button"
                    className="credits-topup-close"
                    onClick={() => navigate(-1)}
                    aria-label={t('Close')}
                >
                    <X size={19} />
                </button>

                <span className="credits-topup-glow credits-topup-glow--mint" />
                <span className="credits-topup-glow credits-topup-glow--rose" />

                <header className="credits-topup-header">
                    <div className="credits-topup-copy">
                        <div className="credits-topup-badges">
                            <span className="credits-topup-member-badge">
                                <Crown size={14} />
                                {t('Premium member')}
                            </span>
                            <span className="credits-topup-balance-pill">
                                <Coins size={14} />
                                <strong>{Number(creditBalance || 0).toLocaleString()}</strong>
                                {t('credits available')}
                            </span>
                        </div>

                        <h1>{t('Add more credits')}</h1>
                        <p>{t('Top up your balance and keep creating without interruption.')}</p>
                    </div>

                    <div className="credits-topup-visual" aria-hidden="true">
                        <span className="credits-topup-orbit" />
                        <motion.span
                            className="credits-topup-spark credits-topup-spark--one"
                            animate={
                                shouldReduceMotion
                                    ? undefined
                                    : {
                                        opacity: [0.25, 1, 0.25],
                                        scale: [0.8, 1.15, 0.8],
                                        rotate: [0, 35, 0],
                                    }
                            }
                            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            ✦
                        </motion.span>
                        <motion.span
                            className="credits-topup-spark credits-topup-spark--two"
                            animate={
                                shouldReduceMotion
                                    ? undefined
                                    : { opacity: [1, 0.25, 1], y: [0, -5, 0] }
                            }
                            transition={{ duration: 3.1, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            ✦
                        </motion.span>
                        <motion.div
                            className="credits-topup-idea-token"
                            animate={
                                shouldReduceMotion
                                    ? undefined
                                    : { y: [0, -6, 0], rotate: [5, 2, 5] }
                            }
                            transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <Lightbulb size={38} strokeWidth={1.7} />
                        </motion.div>
                        <motion.div
                            className="credits-topup-coin credits-topup-coin--one"
                            animate={
                                shouldReduceMotion
                                    ? undefined
                                    : { y: [0, -7, 0], rotate: [-10, -2, -10] }
                            }
                            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                        >
                            <Coins size={19} />
                        </motion.div>
                        <motion.div
                            className="credits-topup-coin credits-topup-coin--two"
                            animate={
                                shouldReduceMotion
                                    ? undefined
                                    : { y: [0, 5, 0], rotate: [11, 4, 11] }
                            }
                            transition={{
                                duration: 3.9,
                                repeat: Infinity,
                                ease: 'easeInOut',
                                delay: 0.25,
                            }}
                        >
                            <Crown size={15} />
                        </motion.div>
                    </div>
                </header>

                <section className="credits-topup-section credits-topup-amount-section">
                    <div className="credits-topup-section-title">
                        <div>
                            <span>01</span>
                            <h2>{t('Choose credits')}</h2>
                        </div>
                        <small>{t('No minimum beyond 1 credit')}</small>
                    </div>

                    <div className="credits-topup-amount-layout">
                        <div className="credits-topup-packages">
                            {QUICK_AMOUNTS.map((amount) => {
                                const isSelected = credits === amount;

                                return (
                                    <motion.button
                                        type="button"
                                        key={amount}
                                        className={isSelected ? 'selected' : ''}
                                        onClick={() => setCredits(amount)}
                                        aria-pressed={isSelected}
                                        whileHover={shouldReduceMotion ? undefined : { y: -3 }}
                                        whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                                    >
                                        {isSelected ? (
                                            <span className="credits-topup-package-check">
                                                <CheckCircle2 size={15} />
                                            </span>
                                        ) : null}
                                        <strong>{amount}</strong>
                                        <small>{t('credits')}</small>
                                    </motion.button>
                                );
                            })}
                        </div>

                        <div className="credits-topup-custom-divider" aria-hidden="true">
                            <span />
                            <em>{t('OR')}</em>
                            <span />
                        </div>

                        <div className="credits-topup-custom">
                            <label>{t('Custom amount')}</label>
                            <motion.div
                                whileHover={
                                    shouldReduceMotion
                                        ? undefined
                                        : { y: -2, scale: 1.01 }
                                }
                                transition={{ duration: 0.18 }}
                            >
                                <button
                                    type="button"
                                    onClick={() => updateCredits(credits - 1)}
                                    disabled={credits <= 1}
                                    aria-label={t('Decrease credits')}
                                >
                                    <Minus size={16} />
                                </button>
                                <motion.input
                                    key={`custom-${credits}`}
                                    type="number"
                                    min="1"
                                    value={credits}
                                    onChange={(event) => updateCredits(event.target.value)}
                                    initial={
                                        shouldReduceMotion
                                            ? undefined
                                            : { scale: 0.93, opacity: 0.72 }
                                    }
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ duration: 0.16 }}
                                />
                                <button
                                    type="button"
                                    onClick={() => updateCredits(credits + 1)}
                                    aria-label={t('Increase credits')}
                                >
                                    <Plus size={16} />
                                </button>
                            </motion.div>
                            <small>{t('Choose any amount from 1 credit')}</small>
                        </div>
                    </div>
                </section>

                <div className="credits-topup-lower-grid">
                    <section className="credits-topup-section credits-topup-payment">
                        <div className="credits-topup-section-title credits-topup-section-title--compact">
                            <div>
                                <span>02</span>
                                <h2>{t('Payment')}</h2>
                            </div>
                            <small>
                                <ShieldCheck size={12} /> {t('Secure checkout')}
                            </small>
                        </div>

                        <div className="credits-topup-currency-row">
                            <span className="credits-topup-payment-icon">
                                <CreditCard size={17} />
                            </span>
                            <div>
                                <small>{t('Payment currency')}</small>
                                <strong dir="ltr" data-no-auto-translate="true">{currency}</strong>
                            </div>
                            <Link
                                to={workspacePath('/premium/preferences')}
                                state={{
                                    returnTo: workspacePath('/premium/buy-credits'),
                                    returnLabel: 'Back to credits',
                                }}
                            >
                                {t('Change')}
                            </Link>
                        </div>

                        <label className="credits-topup-method selected">
                            <input
                                type="radio"
                                name="payment-method"
                                checked={method === 'card'}
                                onChange={() => setMethod('card')}
                            />
                            <span className="credits-topup-payment-icon">
                                <CreditCard size={17} />
                            </span>
                            <div>
                                <strong>{t('Credit or debit card')}</strong>
                                <small>{t('Provider-hosted checkout')}</small>
                            </div>
                            <CheckCircle2 size={18} />
                        </label>
                    </section>

                    <section className="credits-topup-section credits-topup-summary">
                        <div className="credits-topup-summary-title">
                            <span><Sparkles size={15} /></span>
                            <h2>{t('Summary')}</h2>
                        </div>

                        <div className="credits-topup-summary-row">
                            <span>{t('Credits')}</span>
                            <motion.strong
                                key={`credits-${credits}`}
                                initial={shouldReduceMotion ? undefined : { opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                +{credits}
                            </motion.strong>
                        </div>
                        <div className="credits-topup-summary-row">
                            <span>{t('Balance after purchase')}</span>
                            <motion.strong
                                key={`balance-${nextBalance}`}
                                initial={
                                    shouldReduceMotion
                                        ? undefined
                                        : { opacity: 0, scale: 0.92 }
                                }
                                animate={{ opacity: 1, scale: 1 }}
                            >
                                {nextBalance.toLocaleString()}
                            </motion.strong>
                        </div>
                        <div className="credits-topup-summary-divider" />
                        <div className="credits-topup-summary-total">
                            <span>{t('Total')}</span>
                            <strong>{pricingLoading ? t('Updating…') : totalPrice}</strong>
                        </div>
                        <small className="credits-topup-no-fee">
                            <Crown size={13} /> {t('No Premium activation fee')}
                        </small>
                    </section>
                </div>

                {error ? (
                    <div className="credits-topup-error">
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

                <footer className="credits-topup-footer">
                    <motion.button
                        type="button"
                        className="credits-topup-checkout"
                        disabled={busy || pricingLoading || !pricing}
                        onClick={checkout}
                        whileHover={shouldReduceMotion || busy ? undefined : { y: -2 }}
                        whileTap={shouldReduceMotion || busy ? undefined : { scale: 0.99 }}
                    >
                        {busy ? (
                            <>
                                <LoaderCircle className="upgrade-spin" size={18} />
                                {t('Creating secure checkout…')}
                            </>
                        ) : (
                            <>
                                <span>
                                    <strong>{t('Add')} {credits} {t('credits')}</strong>
                                    <small>{pricingLoading ? t('Updating…') : totalPrice}</small>
                                </span>
                                <Sparkles size={18} />
                            </>
                        )}
                    </motion.button>
                    <small className="credits-topup-secure-copy">
                        <ShieldCheck size={14} />
                        {t('Credits are added only after your payment is verified.')}
                    </small>
                </footer>
            </motion.section>
        </motion.main>,
        document.body,
    );
}
