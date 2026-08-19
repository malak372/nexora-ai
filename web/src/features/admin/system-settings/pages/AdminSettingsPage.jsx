import {
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Coins,
  CreditCard,
  Crown,
  Gift,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import AdminSensitiveAccessGate from '../../shared/components/AdminSensitiveAccessGate';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-settings.css';

const SYSTEM_SETTINGS_SCOPE = 'SYSTEM_SETTINGS';

const PRICING_CURRENCIES = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'ILS', label: 'Israeli New Shekel', symbol: '₪' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ' },
];
const PRICING_CURRENCY_CODES = new Set(PRICING_CURRENCIES.map((item) => item.code));

function PricingCurrencyPicker({ value, onChange, disabled, error }) {
  const [open, setOpen] = useState(false);
  const selected = PRICING_CURRENCIES.find((currency) => currency.code === value) || PRICING_CURRENCIES[0];

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      className={`admin-settings-currency-picker${open ? ' is-open' : ''}${error ? ' is-error' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="admin-settings-currency-picker__trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="admin-settings-currency-picker__symbol">{selected.symbol}</span>
        <span className="admin-settings-currency-picker__selected">
          <strong>{selected.code}</strong>
          <small>{selected.label}</small>
        </span>
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="admin-settings-currency-picker__menu" role="listbox" aria-label="Pricing currency">
          {PRICING_CURRENCIES.map((currency) => {
            const active = currency.code === selected.code;
            return (
              <button
                type="button"
                key={currency.code}
                className={`admin-settings-currency-picker__option${active ? ' is-selected' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(currency.code);
                  setOpen(false);
                }}
                role="option"
                aria-selected={active}
              >
                <span className="admin-settings-currency-picker__option-symbol">{currency.symbol}</span>
                <span className="admin-settings-currency-picker__option-copy">
                  <strong>{currency.code}</strong>
                  <small>{currency.label}</small>
                </span>
                {active && <CheckCircle2 size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


const FIELD_META = {
  creditPrice: {
    money: true,
    label: 'Credit price',
    hint: 'Price charged for one credit in the base pricing currency.',
    suffix: 'currency',
    step: '0.01',
    min: 0.01,
  },
  premiumIdeaCreditCost: {
    label: 'Premium idea cost',
    hint: 'Credits required to generate one Premium idea.',
    suffix: 'credits',
    step: '1',
    min: 1,
  },
  directUnlockPrice: {
    money: true,
    label: 'Direct idea unlock',
    hint: 'Direct payment to unlock advanced outputs for a free idea.',
    suffix: 'currency',
    step: '0.01',
    min: 0.01,
  },
  premiumActivationFee: {
    money: true,
    label: 'Premium activation fee',
    hint: 'One-time fee charged when a NORMAL account becomes Premium.',
    suffix: 'currency',
    step: '0.01',
    min: 0,
  },
  normalAcceptancePrice: {
    money: true,
    label: 'Normal acceptance price',
    hint: 'Fixed price for a NORMAL user to accept a publication.',
    suffix: 'currency',
    step: '0.01',
    min: 0.01,
  },
  normalPublicationAdvancedPrice: {
    money: true,
    label: 'Normal publication advanced',
    hint: 'Direct payment for advanced publication outputs.',
    suffix: 'currency',
    step: '0.01',
    min: 0.01,
  },
  publicationAdvancedCreditCost: {
    label: 'Premium publication advanced',
    hint: 'Credits a Premium user spends to unlock advanced publication outputs.',
    suffix: 'credits',
    step: '1',
    min: 1,
  },
  bonusThreshold: {
    label: 'Bonus threshold',
    hint: 'Minimum purchased credits required before bonus credits apply.',
    suffix: 'credits',
    step: '1',
    min: 0,
  },
  bonusCredits: {
    label: 'Bonus credits',
    hint: 'Additional credits awarded after the threshold is reached.',
    suffix: 'credits',
    step: '1',
    min: 0,
  },
};

const GROUPS = [
  {
    key: 'credits',
    eyebrow: 'CREDIT ECONOMICS',
    title: 'Credits & generation',
    description: 'Core credit pricing and Premium idea-generation cost.',
    icon: Coins,
    fields: ['creditPrice', 'premiumIdeaCreditCost'],
  },
  {
    key: 'premium',
    eyebrow: 'PREMIUM ACCESS',
    title: 'Upgrade & direct unlock',
    description: 'Pricing used when a user upgrades or unlocks an owned free idea.',
    icon: Crown,
    fields: ['premiumActivationFee', 'directUnlockPrice'],
  },
  {
    key: 'publications',
    eyebrow: 'PUBLICATION ACCESS',
    title: 'Acceptance & advanced outputs',
    description: 'Commercial rules for publication acceptance and advanced outputs.',
    icon: CreditCard,
    fields: ['normalAcceptancePrice', 'normalPublicationAdvancedPrice', 'publicationAdvancedCreditCost'],
  },
  {
    key: 'bonus',
    eyebrow: 'PURCHASE INCENTIVES',
    title: 'Bonus policy',
    description: 'Optional credit bonuses applied to qualifying credit purchases.',
    icon: Gift,
    fields: ['bonusThreshold', 'bonusCredits'],
  },
];

function normalizeSettings(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.settings && typeof payload.settings === 'object' ? payload.settings : payload;
}

function numericValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function formFromSettings(settings) {
  return {
    pricingCurrency: String(settings?.pricingCurrency || 'USD').toUpperCase(),
    ...Object.fromEntries(
      Object.keys(FIELD_META).map((key) => [key, numericValue(settings?.[key])]),
    ),
  };
}

function changedKeys(settings, form) {
  const changed = [];

  if (String(settings?.pricingCurrency || 'USD').toUpperCase() !== String(form?.pricingCurrency || '').toUpperCase()) {
    changed.push('pricingCurrency');
  }

  Object.keys(FIELD_META).forEach((key) => {
    if (Number(settings?.[key]) !== Number(form?.[key])) changed.push(key);
  });

  return changed;
}

function validate(form) {
  const errors = {};

  if (!PRICING_CURRENCY_CODES.has(String(form.pricingCurrency || '').toUpperCase())) {
    errors.pricingCurrency = 'Choose a supported base currency.';
  }

  Object.entries(FIELD_META).forEach(([key, meta]) => {
    const value = Number(form[key]);
    if (!Number.isFinite(value)) {
      errors[key] = 'Enter a valid number.';
      return;
    }

    if (value < meta.min) {
      errors[key] = `Minimum allowed value is ${meta.min}.`;
      return;
    }

    if (meta.step === '1' && !Number.isInteger(value)) {
      errors[key] = 'Use a whole number.';
    }
  });

  return errors;
}

function SettingField({ fieldKey, value, onChange, error, pricingCurrency }) {
  const meta = FIELD_META[fieldKey];
  const suffix = meta.money ? pricingCurrency : meta.suffix;

  return (
    <label className={`admin-settings-field ${error ? 'is-error' : ''}`}>
      <span className="admin-settings-field__label">
        <strong>{meta.label}</strong>
        <small>{meta.hint}</small>
      </span>

      <span className="admin-settings-field__input">
        <input
          type="number"
          min={meta.min}
          step={meta.step}
          value={value ?? ''}
          onChange={(event) => onChange(fieldKey, event.target.value)}
        />
        <em>{suffix}</em>
      </span>

      {error && <span className="admin-settings-field__error"><CircleAlert size={12} /> {error}</span>}
    </label>
  );
}

function ReviewModal({ settings, form, changes, busy, onClose, onConfirm }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-settings-modal-layer">
      <div className="admin-settings-modal-backdrop" onMouseDown={busy ? undefined : onClose} />

      <section className="admin-settings-review" role="dialog" aria-modal="true">
        <header>
          <span><ShieldCheck size={21} /></span>
          <div>
            <small>REVIEW CONFIGURATION</small>
            <h2>Confirm system setting changes</h2>
            <p>These values affect live pricing, credits and unlock behavior.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy}><X size={18} /></button>
        </header>

        <div className="admin-settings-review__body">
          <div className="admin-settings-review__notice">
            <CircleAlert size={16} />
            <span>
              <strong>{changes.length} {changes.length === 1 ? 'setting' : 'settings'} will change.</strong>
              <small>The update is recorded in the Audit Trail.</small>
            </span>
          </div>

          <div className="admin-settings-review__changes">
            {changes.map((key) => {
              const isCurrency = key === 'pricingCurrency';
              const label = isCurrency ? 'Base pricing currency' : FIELD_META[key].label;
              const oldSuffix = isCurrency ? '' : (FIELD_META[key].money ? settings.pricingCurrency : FIELD_META[key].suffix);
              const newSuffix = isCurrency ? '' : (FIELD_META[key].money ? form.pricingCurrency : FIELD_META[key].suffix);
              return (
                <article key={key}>
                  <div>
                    <small>{label}</small>
                    <strong>{settings[key]} {oldSuffix && <span>{oldSuffix}</span>}</strong>
                  </div>
                  <span>→</span>
                  <div>
                    <small>New value</small>
                    <strong>{form[key]} {newSuffix && <span>{newSuffix}</span>}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer>
          <button type="button" className="is-quiet" onClick={onClose} disabled={busy}>
            <X size={15} />
            Cancel
          </button>
          <button type="button" className="is-primary" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="admin-settings-spin" size={16} /> : <Save size={16} />}
            Save live settings
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function LockedSettingsPreview({
  gateVisible,
  onLockedClick,
}) {
  return (
    <div
      className={`admin-settings-page admin-sensitive-page-content ${gateVisible ? 'is-sensitive-locked' : ''}`}
      aria-hidden={gateVisible ? 'true' : undefined}
      onClickCapture={onLockedClick}
    >
      <section className="admin-settings-hero">
        <div>
          <span className="admin-settings-eyebrow"><SlidersHorizontal size={16} /> PLATFORM CONFIGURATION</span>
          <h1>System settings</h1>
          <p>Manage live pricing, Premium access, publication unlock costs and purchase bonuses from one governed workspace.</p>
        </div>
        <div className="admin-settings-hero__actions">
          <button type="button" className="admin-settings-button is-quiet" disabled><RefreshCw size={16} /> Refresh</button>
          <button type="button" className="admin-settings-button is-primary" disabled><Save size={16} /> Review & save</button>
        </div>
      </section>

      <section className="admin-settings-overview">
        <header>
          <div>
            <small>LIVE COMMERCIAL POLICY</small>
            <h2>Current configuration</h2>
            <p>Protected values become available after password confirmation.</p>
          </div>
          <span><i /> Locked</span>
        </header>

        <div className="admin-settings-metrics">
          {[BadgeDollarSign, Sparkles, Crown, CreditCard].map((Icon, index) => (
            <article key={index}>
              <span><Icon size={19} /></span>
              <div><small>Protected setting</small><strong>••••</strong><p>Verification required</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-settings-grid">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          return (
            <article className={`admin-settings-card is-${group.key}`} key={group.key}>
              <header>
                <span><Icon size={18} /></span>
                <div>
                  <small>{group.eyebrow}</small>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
              </header>
              <div className="admin-settings-card__fields">
                {group.fields.map((fieldKey) => (
                  <div className="admin-settings-locked-field" key={fieldKey}>
                    <span><strong>{FIELD_META[fieldKey].label}</strong><small>{FIELD_META[fieldKey].hint}</small></span>
                    <i>••••</i>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accessToken, setAccessToken] = useState('');
  const [accessGateOpen, setAccessGateOpen] = useState(true);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [reviewOpen, setReviewOpen] = useState(false);

  const lockWorkspace = useCallback(() => {
    setAccessToken('');
    setAccessGateOpen(true);
    setSettings(null);
    setForm({});
    setFieldErrors({});
    setReviewOpen(false);
    setError('');
  }, []);

  const load = useCallback(async ({ fresh = false, silent = false, token = accessToken } = {}) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError('');

    try {
      const loader = fresh && adminApi.settings.getFresh
        ? adminApi.settings.getFresh
        : adminApi.settings.get;
      const payload = await loader(token);
      const next = normalizeSettings(payload);
      setSettings(next);
      setForm(formFromSettings(next));
      setFieldErrors({});
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setError(getApiErrorMessage(requestError, 'Could not load system settings.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, lockWorkspace]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const changes = useMemo(() => settings ? changedKeys(settings, form) : [], [settings, form]);
  const dirty = changes.length > 0;

  const onChange = (key, rawValue) => {
    setForm((current) => ({
      ...current,
      [key]: rawValue,
    }));

    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const review = () => {
    const errors = validate(form);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setError('Correct the highlighted setting values before saving.');
      return;
    }

    setError('');
    if (dirty) setReviewOpen(true);
  };

  const save = async () => {
    if (!dirty || busy || !accessToken) return;

    setBusy(true);
    setError('');

    try {
      const body = Object.fromEntries(
        changes.map((key) => [
          key,
          key === 'pricingCurrency' ? String(form[key]).toUpperCase() : Number(form[key]),
        ]),
      );

      const result = await adminApi.settings.update(body, accessToken);
      const nextPayload = result?.settings
        ? result.settings
        : await adminApi.settings.getFresh(accessToken);
      const next = normalizeSettings(nextPayload);

      setSettings(next);
      setForm(formFromSettings(next));
      setReviewOpen(false);
      setNotice(result?.updated === false ? 'No setting values changed.' : 'System settings updated successfully.');
    } catch (requestError) {
      if (requestError?.response?.status === 403) {
        lockWorkspace();
        return;
      }
      setError(getApiErrorMessage(requestError, 'Could not update system settings.'));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (!settings) return;
    setForm(formFromSettings(settings));
    setFieldErrors({});
    setError('');
  };

  const refresh = async () => {
    setRefreshing(true);
    await load({ fresh: true, silent: true });
  };

  const closeAccessGate = useCallback(() => {
    const currentPath = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    const returnTo = location.state?.sensitiveReturnTo;

    if (returnTo && returnTo !== currentPath) {
      navigate(returnTo, { replace: true });
      return;
    }

    navigate('/admin/dashboard', { replace: true });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  if (!accessToken) {
    const gateVisible = accessGateOpen;

    return (
      <>
        <LockedSettingsPreview
          gateVisible={gateVisible}
          onLockedClick={(event) => {
            if (gateVisible) return;

            event.preventDefault();
            event.stopPropagation();
            setAccessGateOpen(true);
          }}
        />

        {gateVisible ? (
          <AdminSensitiveAccessGate
            scope={SYSTEM_SETTINGS_SCOPE}
            title="Unlock system settings"
            description="Confirm your current administrator password before viewing or changing live pricing, credits, Premium access, and publication rules."
            onVerified={async (token, verificationResult) => {
              setError('');

              if (verificationResult?.settings) {
                const next = normalizeSettings(verificationResult.settings);
                setSettings(next);
                setForm(formFromSettings(next));
                setFieldErrors({});
                setAccessToken(token);
                setAccessGateOpen(false);
                setNotice('System settings unlocked.');
                return;
              }

              setLoading(true);
              try {
                const payload = await adminApi.settings.get(token);
                const next = normalizeSettings(payload);
                setSettings(next);
                setForm(formFromSettings(next));
                setFieldErrors({});
                setAccessToken(token);
                setAccessGateOpen(false);
                setNotice('System settings unlocked.');
              } catch (requestError) {
                setError(getApiErrorMessage(requestError, 'Could not load system settings.'));
                throw requestError;
              } finally {
                setLoading(false);
              }
            }}
            onClose={closeAccessGate}
          />
        ) : null}
      </>
    );
  }

  if (loading || !settings) {
    return (
      <div className="admin-settings-page">
        <div className="admin-settings-loading">
          <LoaderCircle className="admin-settings-spin" size={27} />
          <strong>Loading system configuration…</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-settings-page">
      <section className="admin-settings-hero">
        <div>
          <span className="admin-settings-eyebrow"><SlidersHorizontal size={16} /> PLATFORM CONFIGURATION</span>
          <h1>System settings</h1>
          <p>Manage live pricing, Premium access, publication unlock costs and purchase bonuses from one governed workspace.</p>
        </div>

        <div className="admin-settings-hero__actions">
          <button type="button" className="admin-settings-button is-quiet" onClick={refresh} disabled={refreshing || busy}>
            <RefreshCw className={refreshing ? 'admin-settings-spin' : ''} size={16} />
            Refresh
          </button>
          <button type="button" className="admin-settings-button is-primary" onClick={review} disabled={!dirty || busy}>
            <Save size={16} />
            Review & save
          </button>
        </div>
      </section>

      {error && (
        <div className="admin-settings-feedback is-error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {notice && (
        <div className="admin-settings-feedback is-success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-settings-currency-panel">
        <div className="admin-settings-currency-panel__copy">
          <span><BadgeDollarSign size={18} /></span>
          <div>
            <small>BASE PRICING CURRENCY</small>
            <h2>Currency used by administrator-entered prices</h2>
            <p>Credit price, activation fee, direct unlock and publication prices below are entered in this currency. Users may still choose another supported checkout currency.</p>
          </div>
        </div>
        <label className={fieldErrors.pricingCurrency ? 'is-error' : ''}>
          <span>Pricing currency</span>
          <PricingCurrencyPicker
            value={form.pricingCurrency || 'USD'}
            onChange={(currency) => onChange('pricingCurrency', currency)}
            disabled={busy}
            error={fieldErrors.pricingCurrency}
          />
          {fieldErrors.pricingCurrency && <em>{fieldErrors.pricingCurrency}</em>}
        </label>
      </section>

      <section className="admin-settings-overview">
        <header>
          <div>
            <small>LIVE COMMERCIAL POLICY</small>
            <h2>Current configuration</h2>
            <p>Changes are applied to the backend immediately after confirmation.</p>
          </div>
          <span className={dirty ? 'is-dirty' : ''}>
            <i />
            {dirty ? `${changes.length} unsaved changes` : 'Configuration synced'}
          </span>
        </header>

        <div className="admin-settings-metrics">
          <article>
            <span><BadgeDollarSign size={19} /></span>
            <div><small>Credit price</small><strong>{Number(form.creditPrice || 0).toFixed(2)} {form.pricingCurrency}</strong><p>Per credit</p></div>
          </article>
          <article>
            <span><Sparkles size={19} /></span>
            <div><small>Premium idea</small><strong>{form.premiumIdeaCreditCost}</strong><p>Credits per generation</p></div>
          </article>
          <article>
            <span><Crown size={19} /></span>
            <div><small>Premium activation</small><strong>{Number(form.premiumActivationFee || 0).toFixed(2)} {form.pricingCurrency}</strong><p>Activation fee</p></div>
          </article>
          <article>
            <span><CreditCard size={19} /></span>
            <div><small>Direct unlock</small><strong>{Number(form.directUnlockPrice || 0).toFixed(2)} {form.pricingCurrency}</strong><p>Owned free idea</p></div>
          </article>
        </div>
      </section>

      <section className="admin-settings-grid">
        {GROUPS.map((group) => {
          const Icon = group.icon;

          return (
            <article className={`admin-settings-card is-${group.key}`} key={group.key}>
              <header>
                <span><Icon size={18} /></span>
                <div>
                  <small>{group.eyebrow}</small>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
              </header>

              <div className="admin-settings-card__fields">
                {group.fields.map((fieldKey) => (
                  <SettingField
                    key={fieldKey}
                    fieldKey={fieldKey}
                    value={form[fieldKey]}
                    onChange={onChange}
                    error={fieldErrors[fieldKey]}
                    pricingCurrency={form.pricingCurrency || 'USD'}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="admin-settings-footerbar">
        <div>
          <ShieldCheck size={15} />
          <span>
            <strong>Governed configuration</strong>
            <small>Every saved update is recorded in the Audit Trail with previous and new values.</small>
          </span>
        </div>

        <div>
          <button type="button" className="admin-settings-button is-quiet" onClick={discard} disabled={!dirty || busy}>
            <RotateCcw size={15} />
            Discard changes
          </button>
          <button type="button" className="admin-settings-button is-primary" onClick={review} disabled={!dirty || busy}>
            <Save size={15} />
            Review & save
          </button>
        </div>
      </section>

      {reviewOpen && (
        <ReviewModal
          settings={settings}
          form={form}
          changes={changes}
          busy={busy}
          onClose={() => setReviewOpen(false)}
          onConfirm={save}
        />
      )}
    </div>
  );
}