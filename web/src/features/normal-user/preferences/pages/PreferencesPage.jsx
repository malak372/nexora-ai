/**
 * Server-backed discovery and generation preferences.
 *
 * The page presents a premium personalization studio with:
 * - animated landing hero
 * - location and language controls
 * - scroll-reveal preference groups
 * - interactive selection cards
 * - sticky save bar
 *
 * @author Malak
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CreditCard,
  Globe2,
  LoaderCircle,
  MapPin,
  Save,
  Sparkles,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getMyPreferences,
  getPreferenceCatalog,
  savePreferences,
} from '../api/preferencesApi';
import {
  PAYMENT_CURRENCIES,
  storePaymentCurrency,
} from '../../payments/utils/paymentCurrency';
import { useUserExperience } from '../../../../system/user-experience';
import NormalPageHero from '../../shared/components/NormalPageHero';
import '../styles/preferences.css';

const LANGUAGE_OPTIONS = ['EN', 'AR', 'FR', 'ES', 'DE', 'TR', 'ANY'];

const LOCATION_FIELDS = [
  {
    key: 'preferredCountry',
    label: 'Country',
    placeholder: 'e.g. Palestine',
  },
  {
    key: 'preferredCity',
    label: 'City',
    placeholder: 'e.g. Nablus',
  },
  {
    key: 'preferredRegion',
    label: 'Region',
    placeholder: 'e.g. West Bank',
  },
];

const revealVariants = {
  hidden: {
    opacity: 0,
    y: 36,
    scale: 0.985,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.65,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

export default function PreferencesPage() {
  const { t, language: uiLanguage } = useUserExperience();
  const shouldReduceMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({
    preferredLanguage: 'EN',
    preferredCountry: '',
    preferredCity: '',
    preferredRegion: '',
    paymentCurrency: 'USD',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const returnTo = typeof location.state?.returnTo === 'string'
    ? location.state.returnTo
    : '';

  const returnLabel = typeof location.state?.returnLabel === 'string'
    ? location.state.returnLabel
    : 'Back';

  const goBack = () => {
    if (returnTo) {
      navigate(returnTo);
      return;
    }

    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
      return;
    }

    navigate(workspacePath('/normal/dashboard'));
  };

  useEffect(() => {
    Promise.all([getPreferenceCatalog(), getMyPreferences()])
      .then(([groups, preferences]) => {
        setCatalog(groups ?? []);
        setSelected(
          new Set(
            (preferences?.selections ?? []).map((selection) => selection.id),
          ),
        );
        setForm({
          preferredLanguage: preferences?.preferredLanguage || 'EN',
          preferredCountry: preferences?.preferredCountry || '',
          preferredCity: preferences?.preferredCity || '',
          preferredRegion: preferences?.preferredRegion || '',
          paymentCurrency: preferences?.paymentCurrency || 'USD',
        });
      })
      .catch((error) => {
        setMessage(error?.message || 'Unable to load your preferences.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const selectedCount = selected.size;

  const completionLabel = useMemo(() => {
    if (selectedCount < 3) {
      return uiLanguage === 'ar'
        ? `اختر ${3 - selectedCount} اهتمامًا إضافيًا`
        : `${3 - selectedCount} more to personalize`;
    }

    return uiLanguage === 'ar'
      ? `تم اختيار ${selectedCount} اهتمامات`
      : `${selectedCount} interests selected`;
  }, [selectedCount, uiLanguage]);

  const togglePreference = (id) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const updateField = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const submit = async () => {
    if (selected.size < 3) {
      setMessage('Choose at least three interests.');
      return;
    }

    try {
      setSaving(true);
      setMessage('');

      const saved = await savePreferences({
        ...form,
        preferenceOptionIds: [...selected],
      });

      storePaymentCurrency(saved?.paymentCurrency || form.paymentCurrency);
      setMessage('Preferences saved successfully.');
    } catch (error) {
      setMessage(error?.message || 'Unable to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const motionProps = shouldReduceMotion
    ? {}
    : {
      initial: 'hidden',
      whileInView: 'visible',
      viewport: { once: true, amount: 0.18 },
      variants: revealVariants,
    };

  return (
    <main className="preferences-page reveal-page">
      <div className="preferences-backbar">
        <button type="button" onClick={goBack}>
          <ArrowLeft size={17} />
          <span>{t(returnLabel)}</span>
        </button>
      </div>

      <NormalPageHero
        variant="preferences"
        eyebrow={t('Personalization studio')}
        title={t('Tune Voxidence around how you discover and create.')}
        description={t('Set your local context, preferred language, interests, and generation defaults so every new discovery starts closer to what matters to you.')}
        chips={[t('Smarter discovery'), t('Local relevance'), t('Better generation defaults')]}
        stats={[
          { label: t('Selected interests'), value: selectedCount },
          { label: t('Language'), value: form.preferredLanguage },
        ]}
        footnote={<span>{completionLabel}</span>}
        compact
      />

      {loading ? (
        <section className="preferences-state">
          <LoaderCircle className="spin" size={28} />
          <h2>{t('Preparing your personalization studio')}</h2>
          <p>{t('Loading your current preferences and available options.')}</p>
        </section>
      ) : (
        <>
          <motion.section
            className="preferences-section preferences-section--location"
            {...motionProps}
          >
            <div className="preferences-section__heading">
              <div>
                <span>{t('Step 01')}</span>
                <h2>{t('Set your local context')}</h2>
                <p>{t('These defaults help Voxidence localize ideas, opportunities, and generation results.')}</p>
              </div>

              <div className="preferences-section__badge">
                <MapPin size={17} />
                {t('Location aware')}
              </div>
            </div>

            <div className="preferences-location">
              <label className="preferences-field preferences-field--select">
                <span className="preferences-field__icon">
                  <Globe2 size={17} />
                </span>
                <span className="preferences-field__copy">
                  <small>{t('Language')}</small>
                  <strong>{t('Preferred language')}</strong>
                </span>

                <div className="preferences-select-wrap">
                  <select
                    value={form.preferredLanguage}
                    onChange={(event) =>
                      updateField('preferredLanguage', event.target.value)
                    }
                  >
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              {LOCATION_FIELDS.map((field) => (
                <label className="preferences-field" key={field.key}>
                  <span className="preferences-field__icon">
                    <MapPin size={17} />
                  </span>
                  <span className="preferences-field__copy">
                    <small>{t(field.label)}</small>
                    <strong>{t(field.label)}</strong>
                  </span>

                  <input
                    value={form[field.key]}
                    placeholder={t(field.placeholder)}
                    onChange={(event) =>
                      updateField(field.key, event.target.value)
                    }
                  />
                </label>
              ))}
            </div>
          </motion.section>

          <motion.section
            className="preferences-section preferences-section--payment"
            {...motionProps}
          >
            <div className="preferences-section__heading">
              <div>
                <span>{t('Step 02')}</span>
                <h2>{t('Choose your payment currency once')}</h2>
                <p>{t('Voxidence will remember this choice and use it automatically for credit purchases, direct unlocks, and paid publication access.')}</p>
              </div>

              <div className="preferences-section__badge is-payment">
                <CreditCard size={17} />
                {form.paymentCurrency}
              </div>
            </div>

            <div className="preferences-payment-currencies" role="radiogroup" aria-label={t('Preferred payment currency')}>
              {PAYMENT_CURRENCIES.map((currency) => {
                const active = form.paymentCurrency === currency.code;

                return (
                  <button
                    type="button"
                    key={currency.code}
                    className={active ? 'is-selected' : ''}
                    role="radio"
                    aria-checked={active}
                    onClick={() => updateField('paymentCurrency', currency.code)}
                  >
                    <span>{currency.symbol}</span>
                    <div>
                      <strong>{currency.code}</strong>
                      <small>{t(currency.name)}</small>
                    </div>
                    <i>{active ? <Check size={15} /> : null}</i>
                  </button>
                );
              })}
            </div>

            <div className="preferences-payment-note">
              <CreditCard size={16} />
              <span>{t("Prices are converted by the backend from the administrator's base pricing currency into your saved payment currency.")}</span>
            </div>
          </motion.section>

          <motion.section
            className="preferences-section preferences-section--interests"
            {...motionProps}
          >
            <div className="preferences-section__heading">
              <div>
                <span>{t('Step 03')}</span>
                <h2>{t('Choose what you care about')}</h2>
                <p>{t('Select at least three interests. Voxidence uses them to tune discovery and future generation suggestions.')}</p>
              </div>

              <div className="preferences-section__badge is-purple">
                <Sparkles size={17} />
                {selectedCount} {t('selected')}
              </div>
            </div>

            <div className="preferences-groups">
              {catalog.map((group, groupIndex) => (
                <motion.article
                  key={group.category}
                  className="preferences-group"
                  initial={shouldReduceMotion ? undefined : { opacity: 0, y: 30 }}
                  whileInView={
                    shouldReduceMotion ? undefined : { opacity: 1, y: 0 }
                  }
                  viewport={{ once: true, amount: 0.18 }}
                  transition={{
                    duration: 0.55,
                    delay: shouldReduceMotion ? 0 : groupIndex * 0.06,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <div className="preferences-group__heading">
                    <div>
                      <span>{String(groupIndex + 1).padStart(2, '0')}</span>
                      <h3>{t(group.category.replaceAll('_', ' '))}</h3>
                    </div>

                    <small>
                      {
                        group.options.filter((option) =>
                          selected.has(option.id),
                        ).length
                      }{' '}
                      {t('selected')}
                    </small>
                  </div>

                  <div className="preferences-options">
                    {group.options.map((option, optionIndex) => {
                      const isSelected = selected.has(option.id);

                      return (
                        <motion.button
                          key={option.id}
                          type="button"
                          className={`preference-option ${isSelected ? 'is-selected' : ''
                            }`}
                          onClick={() => togglePreference(option.id)}
                          whileHover={
                            shouldReduceMotion
                              ? undefined
                              : { y: -5, scale: 1.01 }
                          }
                          whileTap={
                            shouldReduceMotion
                              ? undefined
                              : { scale: 0.985 }
                          }
                          transition={{ duration: 0.18 }}
                          style={{
                            '--option-index': optionIndex,
                          }}
                        >
                          <span className="preference-option__check">
                            {isSelected && <Check size={15} />}
                          </span>

                          <span className="preference-option__number">
                            {String(optionIndex + 1).padStart(2, '0')}
                          </span>

                          <strong>{t(option.name)}</strong>
                          <small>{t(option.description)}</small>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.article>
              ))}
            </div>
          </motion.section>

          <footer className="preferences-savebar">
            <div>
              <span className={message ? 'has-message' : ''}>
                {message || completionLabel}
              </span>
              <small>{t('Your choices are saved securely and can be changed anytime.')}</small>
            </div>

            <button type="button" onClick={submit} disabled={saving}>
              {saving ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Save size={17} />
              )}
              {t(saving ? 'Saving…' : 'Save preferences')}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}