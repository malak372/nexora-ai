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

import {
  Check,
  ChevronDown,
  Globe2,
  LoaderCircle,
  MapPin,
  Save,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import {
  getMyPreferences,
  getPreferenceCatalog,
  savePreferences,
} from '../api/preferencesApi';
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
  const shouldReduceMotion = useReducedMotion();

  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({
    preferredLanguage: 'EN',
    preferredCountry: '',
    preferredCity: '',
    preferredRegion: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

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
      return `${3 - selectedCount} more to personalize`;
    }

    return `${selectedCount} interests selected`;
  }, [selectedCount]);

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

      await savePreferences({
        ...form,
        preferenceOptionIds: [...selected],
      });

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
      <section className="preferences-hero">
        <div className="preferences-hero__orb preferences-hero__orb--one" />
        <div className="preferences-hero__orb preferences-hero__orb--two" />
        <div className="preferences-hero__grid" aria-hidden="true" />

        <div className="preferences-hero__content">
          <span className="preferences-hero__eyebrow">
            <SlidersHorizontal size={16} />
            Personalization studio
          </span>

          <h1>Shape a Voxidence experience that feels made for you.</h1>

          <p>
            Fine-tune discovery, localization, and generation defaults so every
            recommendation starts closer to what matters most.
          </p>

          <div className="preferences-hero__chips">
            <span>
              <Sparkles size={15} />
              Smarter discovery
            </span>
            <span>
              <Globe2 size={15} />
              Local relevance
            </span>
            <span>
              <WandSparkles size={15} />
              Better generation defaults
            </span>
          </div>
        </div>

        <div className="preferences-hero__summary">
          <article>
            <span>Selected</span>
            <strong>{selectedCount}</strong>
            <small>interests</small>
          </article>

          <article>
            <span>Language</span>
            <strong>{form.preferredLanguage}</strong>
            <small>default</small>
          </article>

          <div className="preferences-hero__progress">
            <span>
              <i
                style={{
                  width: `${Math.min((selectedCount / 6) * 100, 100)}%`,
                }}
              />
            </span>
            <small>{completionLabel}</small>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="preferences-state">
          <LoaderCircle className="spin" size={28} />
          <h2>Preparing your personalization studio</h2>
          <p>Loading your current preferences and available options.</p>
        </section>
      ) : (
        <>
          <motion.section
            className="preferences-section preferences-section--location"
            {...motionProps}
          >
            <div className="preferences-section__heading">
              <div>
                <span>Step 01</span>
                <h2>Set your local context</h2>
                <p>
                  These defaults help Voxidence localize ideas, opportunities, and
                  generation results.
                </p>
              </div>

              <div className="preferences-section__badge">
                <MapPin size={17} />
                Location aware
              </div>
            </div>

            <div className="preferences-location">
              <label className="preferences-field preferences-field--select">
                <span className="preferences-field__icon">
                  <Globe2 size={17} />
                </span>
                <span className="preferences-field__copy">
                  <small>Language</small>
                  <strong>Preferred language</strong>
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
                    <small>{field.label}</small>
                    <strong>{field.label}</strong>
                  </span>

                  <input
                    value={form[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      updateField(field.key, event.target.value)
                    }
                  />
                </label>
              ))}
            </div>
          </motion.section>

          <motion.section
            className="preferences-section preferences-section--interests"
            {...motionProps}
          >
            <div className="preferences-section__heading">
              <div>
                <span>Step 02</span>
                <h2>Choose what you care about</h2>
                <p>
                  Select at least three interests. Voxidence uses them to tune
                  discovery and future generation suggestions.
                </p>
              </div>

              <div className="preferences-section__badge is-purple">
                <Sparkles size={17} />
                {selectedCount} selected
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
                      <h3>{group.category.replaceAll('_', ' ')}</h3>
                    </div>

                    <small>
                      {
                        group.options.filter((option) =>
                          selected.has(option.id),
                        ).length
                      }{' '}
                      selected
                    </small>
                  </div>

                  <div className="preferences-options">
                    {group.options.map((option, optionIndex) => {
                      const isSelected = selected.has(option.id);

                      return (
                        <motion.button
                          key={option.id}
                          type="button"
                          className={`preference-option ${
                            isSelected ? 'is-selected' : ''
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

                          <strong>{option.name}</strong>
                          <small>{option.description}</small>
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
              <small>
                Your choices are saved securely and can be changed anytime.
              </small>
            </div>

            <button type="button" onClick={submit} disabled={saving}>
              {saving ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Save size={17} />
              )}
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}