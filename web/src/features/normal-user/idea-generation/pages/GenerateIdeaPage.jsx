import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  MapPin,
  Mic,
  MicOff,
  Search,
  ShoppingCart,
  Sparkles,
  Sprout,
  Truck,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { useUserExperience } from '../../../../system/user-experience';
import { getNormalUserSummary } from '../../dashboard/api/dashboardApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import useVoiceTyping from '../../shared/components/useVoiceTyping';
import { getActiveGenerationRun, getAvailableDomains, startIdeaGeneration } from '../api/ideaGenerationApi';
import { GENERATION_TYPES, LANGUAGE_OPTIONS } from '../constants/generation.constants';
import { saveActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import { useGenerationDraftStore } from '../store/generationDraft.store';
import { normalizeGenerationStartResponse } from '../utils/pipeline.utils';
import '../styles/generation.css';

const MAX_SELECTED_DOMAINS = 3;
const list = (value) => (Array.isArray(value) ? value : value?.data ?? value?.items ?? value?.results ?? []);

function domainIconFor(domain) {
  const name = String(domain?.name ?? domain?.displayName ?? '').toLowerCase();
  if (name.includes('educat')) return GraduationCap;
  if (name.includes('health') || name.includes('medical') || name.includes('dental')) return HeartPulse;
  if (name.includes('financ') || name.includes('bank')) return Landmark;
  if (name.includes('agric') || name.includes('farm')) return Sprout;
  if (name.includes('commerce') || name.includes('retail') || name.includes('business')) return ShoppingCart;
  if (name.includes('transport') || name.includes('mobility') || name.includes('logistic')) return Truck;
  if (name.includes('energy')) return Zap;
  if (name.includes('environment')) return Leaf;
  if (name.includes('gov')) return Building2;
  return Sparkles;
}

function DiscoveryGlobe() {
  return (
    <div className="vx-discovery-globe" aria-hidden="true">
      <span className="vx-discovery-globe__halo" />
      <span className="vx-discovery-globe__mist" />
      <span className="vx-discovery-globe__mesh" />
      <span className="vx-discovery-globe__shadow" />
      <span className="vx-discovery-globe__spark vx-discovery-globe__spark--one" />
      <span className="vx-discovery-globe__spark vx-discovery-globe__spark--two" />
      <span className="vx-discovery-globe__spark vx-discovery-globe__spark--three" />
      <span className="vx-discovery-globe__orbit vx-discovery-globe__orbit--one" />
      <span className="vx-discovery-globe__orbit vx-discovery-globe__orbit--two" />
      <span className="vx-discovery-globe__orbit vx-discovery-globe__orbit--three" />
      <span className="vx-discovery-globe__dot vx-discovery-globe__dot--1" />
      <span className="vx-discovery-globe__dot vx-discovery-globe__dot--2" />
      <span className="vx-discovery-globe__dot vx-discovery-globe__dot--3" />
      <span className="vx-discovery-globe__dot vx-discovery-globe__dot--4" />
      <span className="vx-discovery-globe__node vx-discovery-globe__node--one"><Search size={11} /></span>
      <span className="vx-discovery-globe__node vx-discovery-globe__node--two"><UsersRound size={11} /></span>
      <span className="vx-discovery-globe__node vx-discovery-globe__node--three"><Check size={11} /></span>
      <motion.span
        className="vx-discovery-globe__sphere"
        animate={{ y: [0, -7, 0], rotate: [0, 3, 0, -3, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <i className="vx-discovery-globe__shine" />
        <i className="vx-discovery-globe__glass" />
        <i className="vx-discovery-globe__land vx-discovery-globe__land--1" />
        <i className="vx-discovery-globe__land vx-discovery-globe__land--2" />
        <i className="vx-discovery-globe__land vx-discovery-globe__land--3" />
        <span className="vx-discovery-globe__core"><Sparkles size={22} /></span>
      </motion.span>
    </div>
  );
}

function SectionHeader({ number, title, subtitle, collapsed, onToggle }) {
  return (
    <header className="vx-generate-section__header">
      <span className="vx-generate-section__number">{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <button
        type="button"
        className="vx-generate-section__collapse"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={title}
      >
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>
    </header>
  );
}

function PipelinePreview({ t }) {
  const stages = [
    ['Preparing', 'We understand your signal and set up the right discovery plan.'],
    ['Broad collection', 'We scan millions of signals across news, research, social & more.'],
    ['Community AI analysis', 'Our community AI reads, understands, and extracts key insights.'],
    ['Core idea generation', 'We synthesize the strongest patterns into core idea directions.'],
    ['Validation', 'We validate ideas with real-world evidence and opportunity signals.'],
    ['Workspace ready', 'Your validated idea lands in the pipeline with full evidence and next steps.'],
  ];

  return (
    <aside className="vx-generate-next">
      <DiscoveryGlobe />
      <div className="vx-generate-next__title">
        <strong>{t('What happens next')}</strong>
        <Sparkles size={15} />
      </div>
      <p>{t('Your discovery stack flows through our pipeline.')}</p>
      <div className="vx-generate-next__timeline">
        {stages.map(([title, description], index) => (
          <article key={title}>
            <span className={`vx-generate-next__icon is-${index + 1}`}>
              {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Search size={15} /> : index === 2 ? <UsersRound size={15} /> : index === 3 ? <Sparkles size={15} /> : index === 4 ? <Check size={15} /> : <WalletCards size={15} />}
            </span>
            <div>
              <strong>{t(title)}</strong>
              <small>{t(description)}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="vx-generate-next__note">
        {t('This multi-step flow happens in the background — so you can focus on what matters.')}
      </div>
    </aside>
  );
}

export default function GenerateIdeaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, language: uiLanguage } = useUserExperience();
  const { draft, updateDraft } = useGenerationDraftStore();

  const [domains, setDomains] = useState([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState('');
  const [activeRunConflictOpen, setActiveRunConflictOpen] = useState(false);
  const [accessModal, setAccessModal] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({
    signal: false,
    domains: false,
    context: false,
    review: false,
  });
  const [accessSnapshot, setAccessSnapshot] = useState({
    isPremium: false,
    creditBalance: 0,
    remainingFreeGenerations: null,
    premiumIdeaCreditCost: null,
  });

  const selectedDomainIds = useMemo(() => {
    const stored = Array.isArray(draft.domainIds) ? draft.domainIds : [];
    return stored.length ? stored : draft.domainId ? [draft.domainId] : [];
  }, [draft.domainId, draft.domainIds]);

  const selectedDomains = useMemo(
    () => selectedDomainIds
      .map((id) => domains.find((domain) => String(domain.id) === String(id)))
      .filter(Boolean),
    [domains, selectedDomainIds],
  );

  const selectedDomainNames = useMemo(
    () => selectedDomains
      .map((domain) => String(domain.name ?? domain.displayName ?? '').trim())
      .filter(Boolean),
    [selectedDomains],
  );

  const hasSignal = Boolean(draft.description.trim());
  const hasManualDomains = selectedDomainIds.length > 0;
  const autoDetectActive = hasSignal && !hasManualDomains;
  const personalizedDiscoveryActive = !hasSignal && !hasManualDomains;

  const voiceLanguage = draft.language === 'AR'
    ? 'AR'
    : draft.language === 'EN'
      ? 'EN'
      : uiLanguage === 'ar'
        ? 'AR'
        : 'EN';

  const {
    isListening: listening,
    error: voiceError,
    toggle: toggleVoice,
  } = useVoiceTyping({
    value: draft.description,
    onChange: (description) => updateDraft({ description }),
    preferredLanguage: voiceLanguage,
    maxLength: 2000,
    disabled: submitting,
  });

  useEffect(() => {
    const problem = params.get('problem');
    if (problem && !draft.description) {
      updateDraft({ description: problem.slice(0, 2000) });
    }
  }, [draft.description, params, updateDraft]);

  useEffect(() => {
    updateDraft({
      autoDetectDomains: autoDetectActive,
      personalizedDiscovery: personalizedDiscoveryActive,
    });
  }, [autoDetectActive, personalizedDiscoveryActive, updateDraft]);

  useEffect(() => {
    let active = true;
    getAvailableDomains()
      .then((value) => {
        if (active) setDomains(list(value));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingDomains(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshGenerationAccess = async ({ force = false, openOnBlocked = false } = {}) => {
    setCheckingAccess(true);
    try {
      const [summary, pricing] = await Promise.all([
        getNormalUserSummary({ force }),
        getPaymentPricing(1, { force }),
      ]);

      const isPremium = Boolean(summary?.isPremium || summary?.accountStatus === 'PREMIUM');
      const creditBalance = Math.max(0, Number(summary?.creditBalance ?? 0));
      const remainingFreeGenerations = Math.max(0, Number(summary?.remainingFreeGenerations ?? 0));
      const premiumIdeaCreditCost = Math.max(0, Number(pricing?.premiumIdeaCreditCost ?? 0));
      const blocked = isPremium
        ? premiumIdeaCreditCost <= 0 || creditBalance < premiumIdeaCreditCost
        : remainingFreeGenerations <= 0;

      const snapshot = {
        isPremium,
        creditBalance,
        remainingFreeGenerations,
        premiumIdeaCreditCost,
      };
      setAccessSnapshot(snapshot);

      if (blocked && openOnBlocked) {
        setAccessModal(snapshot);
      }

      return { ...snapshot, blocked };
    } catch {
      return { ...accessSnapshot, blocked: false, unavailable: true };
    } finally {
      setCheckingAccess(false);
    }
  };

  useEffect(() => {
    void refreshGenerationAccess();
    // Initial access read only. The Generate button performs the mandatory fresh check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDomain = (domainId) => {
    const exists = selectedDomainIds.some((id) => String(id) === String(domainId));
    const nextDomainIds = exists
      ? selectedDomainIds.filter((id) => String(id) !== String(domainId))
      : selectedDomainIds.length < MAX_SELECTED_DOMAINS
        ? [...selectedDomainIds, domainId]
        : selectedDomainIds;

    updateDraft({
      domainIds: nextDomainIds,
      domainId: nextDomainIds[0] ?? '',
    });
  };

  const removeDomain = (domainId) => {
    const nextDomainIds = selectedDomainIds.filter((id) => String(id) !== String(domainId));
    updateDraft({ domainIds: nextDomainIds, domainId: nextDomainIds[0] ?? '' });
  };

  const toggleSection = (sectionKey) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const activateAutoDetect = () => {
    if (!hasSignal) {
      setError(t('Add a signal first, then Voxidence can detect the best domains automatically.'));
      return;
    }

    setError('');
    updateDraft({
      domainIds: [],
      domainId: '',
      autoDetectDomains: true,
      personalizedDiscovery: false,
    });
  };

  const activatePersonalizedDiscovery = () => {
    setError('');
    updateDraft({
      description: '',
      domainIds: [],
      domainId: '',
      autoDetectDomains: false,
      personalizedDiscovery: true,
    });
  };

  const submit = async () => {
    if (submitting || checkingAccess) return;
    if (!draft.country.trim()) {
      setError(t('Choose a country before generating.'));
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      // Mandatory fresh entitlement check on every Generate click. This prevents
      // a stale navbar/dashboard balance from launching a premium request that
      // the backend will reject for insufficient credits.
      const latestAccess = await refreshGenerationAccess({ force: true, openOnBlocked: true });
      if (latestAccess.unavailable) {
        setError(t('We could not verify your current generation balance. Please try again.'));
        return;
      }
      if (latestAccess.blocked) return;

      const description = draft.description.trim();
      const noSignalAndNoDomains = !description && selectedDomainIds.length === 0;
      const textOnly = Boolean(description) && selectedDomainIds.length === 0;

      updateDraft({
        personalizedDiscovery: noSignalAndNoDomains,
        autoDetectDomains: textOnly,
      });

      const response = await startIdeaGeneration({
        ...(selectedDomainIds.length
          ? {
            domainIds: selectedDomainIds,
            domainId: selectedDomainIds[0],
            ...(selectedDomainNames.length === selectedDomainIds.length
              ? { domainNames: selectedDomainNames }
              : {}),
          }
          : {}),
        generationType: latestAccess.isPremium
          ? GENERATION_TYPES.PREMIUM_CREDIT
          : GENERATION_TYPES.NORMAL_FREE,
        ...(!noSignalAndNoDomains && description ? { description } : {}),
        country: draft.country.trim(),
        ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
        ...(draft.region.trim() ? { region: draft.region.trim() } : {}),
        language: draft.language,
        outputLanguage: description ? 'ANY' : (uiLanguage === 'ar' ? 'AR' : 'EN'),
        forceRefresh: Boolean(draft.forceRefresh),
        keywords: draft.keywords,
      });

      const result = normalizeGenerationStartResponse(response);
      if (!result.runId) throw new Error('Generation started without a run identifier.');

      saveActiveGenerationRunId(result.runId);
      navigate(`/normal/generation/${result.runId}`, {
        state: {
          initialRun: {
            id: result.runId,
            runId: result.runId,
            status: result.status || 'QUEUED',
            progressPercent: 0,
            currentStageKey: null,
            stages: [],
          },
        },
      });
    } catch (requestError) {
      const responseBody = requestError?.response?.data;
      const backendCode = String(
        responseBody?.code ?? responseBody?.error?.code ?? responseBody?.details?.code ?? '',
      ).toUpperCase();

      if (backendCode === 'FREE_LIMIT_REACHED' || backendCode === 'INSUFFICIENT_CREDITS') {
        const requiredCredits = Number(responseBody?.requiredCredits ?? responseBody?.details?.requiredCredits ?? accessSnapshot.premiumIdeaCreditCost ?? 0);
        const availableCredits = Number(responseBody?.availableCredits ?? responseBody?.details?.availableCredits ?? accessSnapshot.creditBalance ?? 0);
        const isPremium = backendCode === 'INSUFFICIENT_CREDITS' || accessSnapshot.isPremium;
        const snapshot = {
          ...accessSnapshot,
          isPremium,
          premiumIdeaCreditCost: requiredCredits || accessSnapshot.premiumIdeaCreditCost,
          creditBalance: availableCredits,
          remainingFreeGenerations: backendCode === 'FREE_LIMIT_REACHED' ? 0 : accessSnapshot.remainingFreeGenerations,
        };
        setAccessSnapshot(snapshot);
        setAccessModal(snapshot);
        return;
      }

      if (backendCode.startsWith('DOMAIN_SELECTION_')) {
        try {
          const refreshedDomains = await getAvailableDomains({ force: true });
          setDomains(list(refreshedDomains));
        } catch {
          // Keep the current catalogue if refresh fails.
        }
        setError(t('Your domain selection changed or is out of sync. Please reselect the domains and try again.'));
        return;
      }

      const rawBackendMessage = responseBody?.message ?? responseBody?.error?.message ?? '';
      const backendMessage = (Array.isArray(rawBackendMessage) ? rawBackendMessage.join(' ') : String(rawBackendMessage)).toLowerCase();
      const generationAlreadyRunning = backendCode === 'GENERATION_ALREADY_RUNNING'
        || backendMessage.includes('an idea-generation run is already active for this owner')
        || (requestError?.response?.status === 409 && backendMessage.includes('generation') && (backendMessage.includes('already active') || backendMessage.includes('already running')));

      if (generationAlreadyRunning) {
        setActiveRunConflictOpen(true);
        return;
      }

      if (!requestError?.response) {
        try {
          const activeRun = await getActiveGenerationRun({ force: true });
          const recoveredRunId = String(activeRun?.runId ?? activeRun?.id ?? '').trim();
          if (recoveredRunId) {
            saveActiveGenerationRunId(recoveredRunId);
            navigate(`/normal/generation/${recoveredRunId}`, {
              state: { initialRun: activeRun },
            });
            return;
          }
        } catch {
          // Fall through to the friendly error.
        }
      }

      setError(t("We couldn't generate your idea this time. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLocation = [draft.country, draft.city, draft.region].filter(Boolean).join(', ');
  const languageLabel = LANGUAGE_OPTIONS.find((item) => item.value === draft.language)?.label ?? 'Any language';
  const signalSummary = draft.description.trim()
    || (selectedDomains.length
      ? `${t('Cross-domain discovery')}: ${selectedDomains.map((domain) => t(domain.name ?? domain.displayName ?? '')).join(' + ')}`
      : t('Personalized discovery from your interests and preferences'));

  return (
    <main className="vx-generate-page">
      <section className="vx-generate-layout">
        <div className="vx-generate-stack">
          <section className={`vx-generate-section${collapsedSections.signal ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="1"
              title={t('Signal')}
              subtitle={t("What's the problem or opportunity you want to explore?")}
              collapsed={collapsedSections.signal}
              onToggle={() => toggleSection('signal')}
            />
            {!collapsedSections.signal ? (
              <div className="vx-generate-section__body">
                <div className="vx-signal-block">
                  <div className="vx-signal-block__heading">
                    <span className="vx-signal-block__icon"><Sparkles size={15} /></span>
                    <div>
                      <strong>{t('Write your idea, problem, or opportunity here...')}</strong>
                      <small>{t('Describe the real situation in your own words. Voxidence will understand the signal and shape the discovery path around it.')}</small>
                    </div>
                  </div>
                  <div className="vx-signal-input">
                  <textarea
                    value={draft.description}
                    dir="auto"
                    maxLength={2000}
                    onChange={(event) => updateDraft({ description: event.target.value })}
                    placeholder={t("Example: 'College students in small cities struggle to find affordable, healthy meal options delivered quickly.'")}
                  />
                  <div className="vx-signal-input__footer">
                    <button type="button" onClick={toggleVoice} disabled={submitting} className={listening ? 'is-listening' : ''}>
                      {listening ? <MicOff size={17} /> : <Mic size={17} />}
                      <span>{t(listening ? 'Listening…' : 'Speak')}</span>
                    </button>
                    <span>{draft.description.length} / 2000</span>
                  </div>
                  </div>
                </div>

                <button
                  type="button"
                  className={`vx-personalized-mode${personalizedDiscoveryActive ? ' is-active' : ''}`}
                  onClick={activatePersonalizedDiscovery}
                >
                  <span className="vx-personalized-mode__icon"><UsersRound size={18} /></span>
                  <span className="vx-personalized-mode__copy">
                    <strong>{t('Generate from my interests')}</strong>
                    <small>{t('Skip the signal and domains. Voxidence will discover a direction from your saved interests and preferences.')}</small>
                  </span>
                  <span className="vx-personalized-mode__state">
                    {personalizedDiscoveryActive ? <Check size={14} /> : <Sparkles size={14} />}
                  </span>
                </button>

                {voiceError ? <p className="vx-inline-warning">{t(voiceError)}</p> : null}
              </div>
            ) : null}
          </section>

          <section className={`vx-generate-section${collapsedSections.domains ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="2"
              title={t('Domains')}
              subtitle={t('Choose up to 3 domains that best fit your idea.')}
              collapsed={collapsedSections.domains}
              onToggle={() => toggleSection('domains')}
            />
            {!collapsedSections.domains ? (
            <div className="vx-generate-section__body">
              <button
                type="button"
                className={`vx-auto-domain-mode${autoDetectActive ? ' is-active' : ''}`}
                onClick={activateAutoDetect}
                disabled={!hasSignal}
              >
                <span className="vx-auto-domain-mode__icon"><Sparkles size={18} /></span>
                <span className="vx-auto-domain-mode__copy">
                  <strong>{t('Auto-detect by Voxidence')}</strong>
                  <small>{t('No domain picking required — Voxidence resolves the strongest domain blend directly from your signal.')}</small>
                </span>
                <span className="vx-auto-domain-mode__state">
                  {autoDetectActive ? <Check size={14} /> : <Search size={14} />}
                </span>
              </button>

              <div className="vx-domain-divider"><span>{t('or choose manually')}</span></div>

              <div className="vx-domain-grid">
                {loadingDomains ? (
                  <div className="vx-domain-loading">{t('Loading domains…')}</div>
                ) : domains.map((domain) => {
                  const isSelected = selectedDomainIds.some((id) => String(id) === String(domain.id));
                  const isBlocked = !isSelected && selectedDomainIds.length >= MAX_SELECTED_DOMAINS;
                  const DomainIcon = domainIconFor(domain);
                  return (
                    <button
                      type="button"
                      key={domain.id}
                      className={isSelected ? 'is-selected' : ''}
                      disabled={isBlocked}
                      aria-pressed={isSelected}
                      onClick={() => toggleDomain(domain.id)}
                    >
                      <DomainIcon size={18} />
                      <span>{t(domain.name ?? domain.displayName ?? '')}</span>
                      {isSelected ? <i><Check size={11} /></i> : null}
                    </button>
                  );
                })}
              </div>
              <div className="vx-domain-selected">
                <strong>{t('Selected')} ({selectedDomainIds.length}/{MAX_SELECTED_DOMAINS})</strong>
                <div>
                  {selectedDomains.map((domain) => (
                    <button type="button" key={domain.id} onClick={() => removeDomain(domain.id)}>
                      {t(domain.name ?? domain.displayName ?? '')}
                      <X size={11} />
                    </button>
                  ))}
                  {!selectedDomains.length ? (
                    <span>
                      {t(hasSignal
                        ? 'Auto-detect is active — Voxidence will resolve the domains from your signal.'
                        : 'No domains selected — Voxidence will use your interests and preferences.')}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            ) : null}
          </section>

          <section className={`vx-generate-section${collapsedSections.context ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="3"
              title={t('Context')}
              subtitle={t('Where is this happening?')}
              collapsed={collapsedSections.context}
              onToggle={() => toggleSection('context')}
            />
            {!collapsedSections.context ? (
            <div className="vx-generate-section__body vx-context-grid">
              <label>
                <span>{t('Country')}</span>
                <div className="vx-context-field"><MapPin size={14} /><input value={draft.country} maxLength={100} dir="auto" placeholder={t('Country')} onChange={(event) => updateDraft({ country: event.target.value })} /></div>
              </label>
              <label>
                <span>{t('City')}</span>
                <div className="vx-context-field"><Building2 size={14} /><input value={draft.city} maxLength={100} dir="auto" placeholder={t('City')} onChange={(event) => updateDraft({ city: event.target.value })} /></div>
              </label>
              <label>
                <span>{t('Region (Optional)')}</span>
                <div className="vx-context-field"><MapPin size={14} /><input value={draft.region} maxLength={100} dir="auto" placeholder={t('Region')} onChange={(event) => updateDraft({ region: event.target.value })} /></div>
              </label>
              <label>
                <span>{t('Community language')}</span>
                <div className={`vx-context-language ${languageMenuOpen ? 'is-open' : ''}`}>
                  <button type="button" onClick={() => setLanguageMenuOpen((value) => !value)}>
                    <BookOpen size={14} />
                    <span>{t(languageLabel)}</span>
                    <ChevronDown size={14} />
                  </button>
                  {languageMenuOpen ? (
                    <div className="vx-context-language__menu">
                      {LANGUAGE_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={option.value}
                          className={draft.language === option.value ? 'is-selected' : ''}
                          onClick={() => {
                            updateDraft({ language: option.value });
                            setLanguageMenuOpen(false);
                          }}
                        >
                          {t(option.label)}
                          {draft.language === option.value ? <Check size={12} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
            </div>
            ) : null}
          </section>

          <section className={`vx-generate-section vx-generate-review${collapsedSections.review ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="4"
              title={t('Launch Review')}
              subtitle={t('Review your discovery stack before we begin.')}
              collapsed={collapsedSections.review}
              onToggle={() => toggleSection('review')}
            />
            {!collapsedSections.review ? (
            <div className="vx-generate-section__body">
              <div className="vx-review-row">
                <article className="vx-review-row__signal">
                  <small>{t('Your signal')}</small>
                  <strong dir="auto">{signalSummary}</strong>
                </article>
                <article>
                  <small>{t('Domains')}{selectedDomainIds.length ? ` (${selectedDomainIds.length})` : ''}</small>
                  <strong>
                    {selectedDomains.length
                      ? selectedDomains.map((domain) => t(domain.name ?? domain.displayName ?? '')).join(' · ')
                      : t(hasSignal ? 'Auto-detect' : 'From my interests')}
                  </strong>
                </article>
                <article>
                  <small>{t('Place')}</small>
                  <strong dir="auto">{selectedLocation || t('Not specified')}</strong>
                </article>
                <article>
                  <small>{t('Language')}</small>
                  <strong>{t(languageLabel)}</strong>
                </article>
                <article className="vx-review-row__toggle">
                  <small>{t('Collect fresh evidence')}</small>
                  <label>
                    <span>{draft.forceRefresh ? t('On') : t('Off')}</span>
                    <input type="checkbox" checked={Boolean(draft.forceRefresh)} onChange={(event) => updateDraft({ forceRefresh: event.target.checked })} />
                    <i />
                  </label>
                </article>
              </div>
              <div className="vx-review-note">
                <Check size={15} />
                <div>
                  <strong>{t('Voxidence chooses the best sources automatically.')}</strong>
                  <span>{t('We scan social signals, reviews, research, and more to bring you the most credible and relevant insights.')}</span>
                </div>
              </div>
            </div>
            ) : null}
          </section>

          {error ? <div className="vx-generate-error">{Array.isArray(error) ? error.join(' ') : error}</div> : null}

          <button
            type="button"
            className="vx-generate-button"
            onClick={submit}
            disabled={submitting || checkingAccess}
            aria-busy={submitting || checkingAccess}
          >
            <Sparkles size={20} />
            <span>
              <strong>{t(checkingAccess ? 'Checking generation access…' : submitting ? 'Launching intelligence…' : 'Generate validated idea')}</strong>
              <small>{t('We’ll gather evidence and surface the strongest validated ideas.')}</small>
            </span>
          </button>
        </div>

        <PipelinePreview t={t} />
      </section>

      {activeRunConflictOpen ? createPortal(
        <div className="vx-generate-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setActiveRunConflictOpen(false)}>
          <motion.section className="vx-generate-modal" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
            <span className="vx-generate-modal__icon"><Sparkles size={24} /></span>
            <small>{t('Generation in progress')}</small>
            <h2>{t('Another idea is already being generated.')}</h2>
            <p>{t('Voxidence is still working on your current generation. Please try later after it finishes.')}</p>
            <button type="button" onClick={() => setActiveRunConflictOpen(false)}>{t('Close')}</button>
          </motion.section>
        </div>,
        document.body,
      ) : null}

      {accessModal ? createPortal(
        <div className="vx-generate-modal-backdrop">
          <motion.section className="vx-generate-modal vx-generate-modal--credits" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
            <button type="button" className="vx-generate-modal__close" onClick={() => setAccessModal(null)}><X size={17} /></button>
            <span className="vx-generate-modal__icon"><CircleDollarSign size={24} /></span>
            <small>{t('Generation access')}</small>
            <h2>{t(accessModal.isPremium ? 'More credits are needed to generate again.' : 'Your free generations are complete.')}</h2>
            <p>{t(accessModal.isPremium ? 'The Generate button checked your live balance before starting, and there are not enough credits for this idea.' : 'You have used the free generations available on this account.')}</p>
            <div className="vx-credit-check-grid">
              <article><span>{t(accessModal.isPremium ? 'Available credits' : 'Free generations left')}</span><strong>{accessModal.isPremium ? accessModal.creditBalance : accessModal.remainingFreeGenerations}</strong></article>
              <article><span>{t(accessModal.isPremium ? 'Credits required' : 'Continue with')}</span><strong>{accessModal.isPremium ? (accessModal.premiumIdeaCreditCost ?? '—') : t('Premium')}</strong></article>
            </div>
            <div className="vx-generate-modal__actions">
              <button type="button" className="is-secondary" onClick={() => setAccessModal(null)}>{t('Close')}</button>
              <button type="button" onClick={() => navigate('/normal/credits')}>{t(accessModal.isPremium ? 'Buy more credits' : 'Upgrade workspace')}<ArrowRight size={16} /></button>
            </div>
          </motion.section>
        </div>,
        document.body,
      ) : null}
    </main>
  );
}
